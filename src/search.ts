import { applyMove, createStateHash, getLegalMoves, otherPlayer } from "./engine.js";
import { AI_DIFFICULTY_PROFILES, type AiDifficulty, type AiDifficultyProfile } from "./profiles.js";
import type { GameState, PlayerId, PlayerMove } from "./types.js";

const WIN_SCORE = 1_000_000;

export type SearchAlgorithm = "minimax" | "alpha-beta";
export type SearchOptions = {
  algorithm?: SearchAlgorithm;
  depth?: number;
  nodeBudget?: number;
  timeBudgetMs?: number;
  random?: () => number;
};
export type SearchDiagnostics = {
  nodeCount: number;
  elapsedMs: number;
  completedDepth: number;
  cacheHits: number;
  cacheEntries: number;
  cutoffs: number;
  budgetReason: "node" | "time" | null;
};
export type MoveAnalysis = {
  move: PlayerMove;
  score: number;
  immediateGain: number;
  opponentImmediateThreat: number;
};
export type SearchResult = {
  bestMove: PlayerMove | null;
  rankedMoves: MoveAnalysis[];
  diagnostics: SearchDiagnostics;
};

type CacheEntry = { depth: number; score: number };
type Context = {
  rootPlayer: PlayerId;
  profile: AiDifficultyProfile;
  algorithm: SearchAlgorithm;
  nodeBudget: number;
  deadline: number;
  started: number;
  cache: Map<string, CacheEntry>;
  nodeCount: number;
  cacheHits: number;
  cutoffs: number;
  budgetReason: "node" | "time" | null;
};

export function analyzePosition(
  state: GameState,
  difficulty: AiDifficulty = "trang-nguyen",
  options: SearchOptions = {},
): SearchResult {
  const profile = AI_DIFFICULTY_PROFILES[difficulty];
  const started = performance.now();
  const algorithm = options.algorithm ?? "alpha-beta";
  const targetDepth = options.depth ?? profile.searchDepth + (state.currentPlayer === "P1" ? profile.secondPlayerDepthBonus : 0);
  const context: Context = {
    rootPlayer: state.currentPlayer,
    profile,
    algorithm,
    nodeBudget: options.nodeBudget ?? profile.nodeBudget,
    deadline: started + (options.timeBudgetMs ?? profile.timeBudgetMs),
    started,
    cache: new Map(),
    nodeCount: 0,
    cacheHits: 0,
    cutoffs: 0,
    budgetReason: null,
  };

  const rootMoves = enumerateMoves(state);
  if (rootMoves.length === 0) return { bestMove: null, rankedMoves: [], diagnostics: diagnostics(context, 0) };

  if (targetDepth <= 0) {
    const ranked = rootMoves.map(({ move, state: next, immediateGain }) => {
      const threat = maxImmediateGain(next, next.currentPlayer);
      return {
        move,
        immediateGain,
        opponentImmediateThreat: threat,
        score: immediateGain * profile.captureWeight - threat * profile.retaliationPenalty + evaluateState(next, context.rootPlayer, profile) * profile.positionWeight,
      };
    }).sort((a, b) => b.score - a.score || compareMove(a.move, b.move));
    return { bestMove: chooseWithMistakes(ranked, profile, options.random ?? Math.random)?.move ?? null, rankedMoves: ranked, diagnostics: diagnostics(context, 0) };
  }

  let lastComplete: MoveAnalysis[] = [];
  let completedDepth = 0;
  for (let depth = 1; depth <= targetDepth; depth += 1) {
    try {
      const ranked = rootMoves.map(({ move, state: next, immediateGain }) => ({
        move,
        immediateGain,
        opponentImmediateThreat: maxImmediateGain(next, next.currentPlayer),
        score: search(next, depth - 1, -Infinity, Infinity, context),
      })).sort((a, b) => b.score - a.score || compareMove(a.move, b.move));
      lastComplete = ranked;
      completedDepth = depth;
    } catch (error) {
      if (error !== BUDGET_EXHAUSTED) throw error;
      break;
    }
  }

  if (lastComplete.length === 0) {
    lastComplete = rootMoves.map(({ move, state: next, immediateGain }) => ({
      move,
      immediateGain,
      opponentImmediateThreat: maxImmediateGain(next, next.currentPlayer),
      score: evaluateState(next, context.rootPlayer, profile),
    })).sort((a, b) => b.score - a.score || compareMove(a.move, b.move));
  }

  return {
    bestMove: chooseWithMistakes(lastComplete, profile, options.random ?? Math.random)?.move ?? null,
    rankedMoves: lastComplete,
    diagnostics: diagnostics(context, completedDepth),
  };
}

const BUDGET_EXHAUSTED = new Error("search budget exhausted");

function search(state: GameState, depth: number, alpha: number, beta: number, context: Context): number {
  budget(context);
  context.nodeCount += 1;
  if (depth <= 0 || state.status === "finished") return evaluateState(state, context.rootPlayer, context.profile);

  const cacheKey = `${createStateHash(state)}:${depth}:${context.rootPlayer}`;
  const cached = context.profile.useCache ? context.cache.get(cacheKey) : undefined;
  if (cached && cached.depth >= depth) {
    context.cacheHits += 1;
    return cached.score;
  }

  const maximizing = state.currentPlayer === context.rootPlayer;
  let moves = enumerateMoves(state);
  if (moves.length === 0) return evaluateState(state, context.rootPlayer, context.profile);
  if (context.profile.useMoveOrdering) {
    moves.sort((a, b) => b.immediateGain - a.immediateGain || compareMove(a.move, b.move));
  }
  if (depth > context.profile.fullWidthDepth) {
    const cap = context.profile.maxBranchingMoves + (state.currentPlayer === "P1" ? context.profile.secondPlayerBranchingBonus ?? 0 : 0);
    moves = moves.slice(0, Math.max(1, cap));
  }

  let best = maximizing ? -Infinity : Infinity;
  for (const candidate of moves) {
    const score = search(candidate.state, depth - 1, alpha, beta, context);
    if (maximizing) {
      best = Math.max(best, score);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, score);
      beta = Math.min(beta, best);
    }
    if (context.algorithm === "alpha-beta" && beta <= alpha) {
      context.cutoffs += 1;
      break;
    }
  }
  if (context.profile.useCache && context.cache.size < context.profile.maxCacheEntries) context.cache.set(cacheKey, { depth, score: best });
  return best;
}

export function evaluateState(state: GameState, player: PlayerId, profile: AiDifficultyProfile): number {
  const opponent = otherPlayer(player);
  if (state.status === "finished") {
    if (state.winner === player) return WIN_SCORE + scoreDelta(state, player) * 100;
    if (state.winner === null) return 0;
    return -WIN_SCORE + scoreDelta(state, player) * 100;
  }
  const w = profile.weights;
  const score = scoreDelta(state, player);
  const side = sideValue(state, player) - sideValue(state, opponent);
  const refill = refillSafety(state, player) - refillSafety(state, opponent);
  const mobility = state.currentPlayer === player ? getLegalMoves(state, player).length : -(state.currentPlayer === opponent ? getLegalMoves(state, opponent).length : 0);
  const quanPressure = quanPressureValue(state, player) - quanPressureValue(state, opponent);
  const endgame = isEndgame(state) ? score + side * 0.25 : 0;
  return score * w.score + side * w.side + refill * w.refill + mobility * w.mobility + quanPressure * w.quanPressure + endgame * w.endgame;
}

function enumerateMoves(state: GameState): Array<{ move: PlayerMove; state: GameState; immediateGain: number }> {
  return getLegalMoves(state).flatMap((move) => {
    const before = state.scores[move.player];
    const result = applyMove(state, move);
    if (!result.ok) return [];
    return [{ move, state: result.state, immediateGain: result.state.scores[move.player] - before }];
  });
}
function maxImmediateGain(state: GameState, player: PlayerId): number {
  if (state.status === "finished" || state.currentPlayer !== player) return 0;
  let best = 0;
  for (const move of getLegalMoves(state, player)) {
    const result = applyMove(state, move);
    if (result.ok) best = Math.max(best, result.state.scores[player] - state.scores[player]);
  }
  return best;
}
function sideValue(state: GameState, player: PlayerId): number { return state.pits.filter((p) => p.owner === player).reduce((s, p) => s + p.stones, 0); }
function refillSafety(state: GameState, player: PlayerId): number {
  const stones = sideValue(state, player);
  if (stones === 0) return state.scores[player] >= 5 ? 1 : -2;
  return Math.min(5, stones) / 5;
}
function quanPressureValue(state: GameState, player: PlayerId): number {
  const opponent = otherPlayer(player);
  const ownTurn = state.currentPlayer === player ? 1 : -1;
  const remainingQuan = state.pits.filter((p) => p.kind === "quan").reduce((s, p) => s + p.quanStones * 10 + p.stones, 0);
  return ownTurn * (20 - Math.min(20, remainingQuan)) - (state.scores[opponent] - state.scores[player]) * 0.05;
}
function isEndgame(state: GameState): boolean { return state.pits.reduce((s, p) => s + p.stones + p.quanStones, 0) <= 24; }
function scoreDelta(state: GameState, player: PlayerId): number { return state.scores[player] - state.scores[otherPlayer(player)]; }
function compareMove(a: PlayerMove, b: PlayerMove): number { return `${a.pit}:${a.dir}`.localeCompare(`${b.pit}:${b.dir}`); }
function chooseWithMistakes(ranked: MoveAnalysis[], profile: AiDifficultyProfile, random: () => number): MoveAnalysis | undefined {
  if (ranked.length <= 1 || profile.mistakeRate <= 0 || random() >= profile.mistakeRate) return ranked[0];
  const pool = ranked.slice(1, Math.min(3, ranked.length));
  return pool[Math.floor(random() * pool.length)] ?? ranked[0];
}
function budget(context: Context): void {
  if (context.nodeCount >= context.nodeBudget) { context.budgetReason = "node"; throw BUDGET_EXHAUSTED; }
  if (performance.now() >= context.deadline) { context.budgetReason = "time"; throw BUDGET_EXHAUSTED; }
}
function diagnostics(context: Context, completedDepth: number): SearchDiagnostics {
  return { nodeCount: context.nodeCount, elapsedMs: performance.now() - context.started, completedDepth, cacheHits: context.cacheHits, cacheEntries: context.cache.size, cutoffs: context.cutoffs, budgetReason: context.budgetReason };
}
