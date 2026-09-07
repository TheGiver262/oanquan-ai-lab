import { createStateHash } from "../engine.js";
import type { GameState, PlayerId } from "../types.js";
import {
  PRODUCTION_TOP_PROFILES,
  enumerateProductionMoves,
  evaluateProductionState,
  type ProductionAiMove,
  type ProductionAiMoveCandidate,
  type ProductionProfile,
} from "../reference/production-ai.js";

export type BangNhanOrderingMode = "production-ordering" | "fixed-opponent-ordering";

export type BangNhanExperimentOptions = {
  orderingMode?: BangNhanOrderingMode;
  now?: () => number;
  random?: () => number;
  timeBudgetMs?: number;
};

export type BangNhanExperimentDecision = {
  move: ProductionAiMove | null;
  completedDepth: number;
  nodeCount: number;
  budgetReason: "node" | "time" | null;
};

type SearchBound = "exact" | "lower" | "upper";
type SearchCacheEntry = {
  depth: number;
  score: number;
  bound: SearchBound;
  bestMove: ProductionAiMove | null;
};
type RankedCandidate = {
  candidate: ProductionAiMoveCandidate;
  score: number;
  bound?: SearchBound;
};
type SearchContext = {
  aiPlayer: PlayerId;
  budgetReason: "node" | "time" | null;
  cache: Map<string, SearchCacheEntry>;
  completedDepth: number;
  deadlineMs: number;
  nodeCount: number;
  now: () => number;
  orderingMode: BangNhanOrderingMode;
  profile: ProductionProfile;
  random: () => number;
  startedAtMs: number;
};

const NODE_BUDGET_EXHAUSTED = new Error("AI node budget exhausted");
const TIME_BUDGET_EXHAUSTED = new Error("AI time budget exhausted");
const DIRECTIONS = ["CW", "CCW"] as const;
const DAN_PITS_BY_PLAYER = {
  P0: ["B1", "B2", "B3", "B4", "B5"],
  P1: ["T1", "T2", "T3", "T4", "T5"],
} as const;

export function chooseBangNhanExperimentMove(
  state: GameState,
  aiPlayer = state.currentPlayer,
  options: BangNhanExperimentOptions = {},
): BangNhanExperimentDecision {
  const profile = PRODUCTION_TOP_PROFILES["bang-nhan"];
  const now = options.now ?? (() => globalThis.performance.now());
  const random = options.random ?? Math.random;
  const startedAtMs = now();
  const candidates = enumerateProductionMoves(state, aiPlayer);
  if (candidates.length === 0) {
    return { move: null, completedDepth: 0, nodeCount: 0, budgetReason: null };
  }

  if (profile.useOpeningBook) {
    const openingMove = chooseOpeningBookMove(state, candidates, aiPlayer);
    if (openingMove) {
      return { move: openingMove, completedDepth: 0, nodeCount: 0, budgetReason: null };
    }
  }

  const context: SearchContext = {
    aiPlayer,
    budgetReason: null,
    cache: new Map(),
    completedDepth: 0,
    deadlineMs: startedAtMs + (options.timeBudgetMs ?? profile.timeBudgetMs),
    nodeCount: 0,
    now,
    orderingMode: options.orderingMode ?? "production-ordering",
    profile,
    random,
    startedAtMs,
  };

  const ranked = rankCandidatesWithIterativeDeepening(state, candidates, context);
  ranked.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    const leftBound = left.bound ?? "exact";
    const rightBound = right.bound ?? "exact";
    if (leftBound !== rightBound) {
      if (leftBound === "exact") return -1;
      if (rightBound === "exact") return 1;
    }
    if (right.candidate.immediateGain !== left.candidate.immediateGain) {
      return right.candidate.immediateGain - left.candidate.immediateGain;
    }
    return moveTieBreaker(left.candidate.move) - moveTieBreaker(right.candidate.move);
  });

  return {
    move: ranked[0]?.candidate.move ?? null,
    completedDepth: context.completedDepth,
    nodeCount: context.nodeCount,
    budgetReason: context.budgetReason,
  };
}

function minimax(
  state: GameState,
  context: SearchContext,
  depth: number,
  alpha: number,
  beta: number,
): number {
  if (context.now() >= context.deadlineMs) throw TIME_BUDGET_EXHAUSTED;
  context.nodeCount += 1;
  // Preserve the production behavior exactly for the causal test: profile.nodeBudget is authoritative.
  if (context.nodeCount > context.profile.nodeBudget) throw NODE_BUDGET_EXHAUSTED;
  if (depth === 0 || state.status === "finished") {
    return evaluateProductionState(state, context.aiPlayer, context.profile);
  }

  const originalAlpha = alpha;
  const originalBeta = beta;
  const cacheKey = `${context.profile.id}:${createStateHash(state)}`;
  const cached = context.cache.get(cacheKey);
  if (cached && cached.depth >= depth) {
    if (cached.bound === "exact") return cached.score;
    if (cached.bound === "lower") alpha = Math.max(alpha, cached.score);
    if (cached.bound === "upper") beta = Math.min(beta, cached.score);
    if (alpha >= beta) return cached.score;
  }

  const isAiTurn = state.currentPlayer === context.aiPlayer;
  const candidates = orderSearchCandidates(
    enumerateProductionMoves(state, state.currentPlayer),
    context,
    isAiTurn,
    depth,
    cached?.bestMove ?? null,
  );
  if (candidates.length === 0) {
    return evaluateProductionState(state, context.aiPlayer, context.profile);
  }

  let score: number;
  let bestMove: ProductionAiMove | null = null;
  if (isAiTurn) {
    let maxEval = -Infinity;
    for (const candidate of candidates) {
      const evaluation = minimax(candidate.state, context, depth - 1, alpha, beta);
      if (evaluation > maxEval) {
        maxEval = evaluation;
        bestMove = candidate.move;
      }
      alpha = Math.max(alpha, evaluation);
      if (beta <= alpha) break;
    }
    score = maxEval;
  } else {
    let minEval = Infinity;
    for (const candidate of candidates) {
      const evaluation = minimax(candidate.state, context, depth - 1, alpha, beta);
      if (evaluation < minEval) {
        minEval = evaluation;
        bestMove = candidate.move;
      }
      beta = Math.min(beta, evaluation);
      if (beta <= alpha) break;
    }
    score = minEval;
  }

  const bound: SearchBound =
    score <= originalAlpha ? "upper" : score >= originalBeta ? "lower" : "exact";
  setCache(context, cacheKey, { depth, score, bound, bestMove });
  return score;
}

function rankCandidatesWithIterativeDeepening(
  state: GameState,
  candidates: ProductionAiMoveCandidate[],
  context: SearchContext,
): RankedCandidate[] {
  let completed: RankedCandidate[] = candidates.map((candidate) => ({
    candidate,
    score: scoreHeuristicCandidate(candidate, context.aiPlayer, context.profile),
    bound: "exact",
  }));
  const targetDepth = effectiveSearchDepth(state, context.profile, context.aiPlayer);

  for (let depth = 1; depth <= targetDepth; depth += 1) {
    const ordered = orderRootCandidates(candidates, completed, context);
    const iteration: RankedCandidate[] = [];
    let alpha = -Infinity;
    try {
      for (const candidate of ordered) {
        const score = minimax(candidate.state, context, depth, alpha, Infinity);
        const bound: SearchBound = score > alpha ? "exact" : "upper";
        iteration.push({ candidate, score, bound });
        alpha = Math.max(alpha, score);
      }
    } catch (error) {
      if (error !== NODE_BUDGET_EXHAUSTED && error !== TIME_BUDGET_EXHAUSTED) throw error;
      context.budgetReason = error === TIME_BUDGET_EXHAUSTED ? "time" : "node";
      break;
    }
    completed = iteration;
    context.completedDepth = depth;
  }
  return completed;
}

function orderRootCandidates(
  candidates: ProductionAiMoveCandidate[],
  previous: RankedCandidate[],
  context: SearchContext,
): ProductionAiMoveCandidate[] {
  const previousEntries = new Map(
    previous.map(({ candidate, score, bound }) => [
      moveKey(candidate.move),
      { score, bound: bound ?? "exact" },
    ]),
  );
  const orderingScores = new Map(
    candidates.map((candidate) => [moveKey(candidate.move), moveOrderingScore(candidate, context, true)]),
  );
  return [...candidates].sort((left, right) => {
    const leftEntry = previousEntries.get(moveKey(left.move));
    const rightEntry = previousEntries.get(moveKey(right.move));
    const scoreDelta = (rightEntry?.score ?? -Infinity) - (leftEntry?.score ?? -Infinity);
    if (scoreDelta !== 0) return scoreDelta;
    const leftBound = leftEntry?.bound ?? "exact";
    const rightBound = rightEntry?.bound ?? "exact";
    if (leftBound !== rightBound) {
      if (leftBound === "exact") return -1;
      if (rightBound === "exact") return 1;
    }
    return (orderingScores.get(moveKey(right.move)) ?? 0) -
      (orderingScores.get(moveKey(left.move)) ?? 0);
  });
}

function orderSearchCandidates(
  candidates: ProductionAiMoveCandidate[],
  context: SearchContext,
  isAiTurn: boolean,
  depth: number,
  cachedBestMove: ProductionAiMove | null,
): ProductionAiMoveCandidate[] {
  const scored = candidates.map((candidate) => ({
    candidate,
    score: moveOrderingScore(candidate, context, isAiTurn),
    isCached: cachedBestMove ? sameMove(candidate.move, cachedBestMove) : false,
    tieBreaker: moveTieBreaker(candidate.move),
  }));
  scored.sort((left, right) => {
    if (left.isCached !== right.isCached) return left.isCached ? -1 : 1;
    const scoreDelta = isAiTurn ? right.score - left.score : left.score - right.score;
    if (scoreDelta !== 0) return scoreDelta;
    return left.tieBreaker - right.tieBreaker;
  });
  const ordered = scored.map((item) => item.candidate);
  if (depth <= context.profile.fullWidthDepth) return ordered;
  const maxBranchingMoves = context.profile.maxBranchingMoves +
    (context.aiPlayer === "P1" ? (context.profile.secondPlayerBranchingBonus ?? 0) : 0);
  return ordered.slice(0, maxBranchingMoves);
}

function moveOrderingScore(
  candidate: ProductionAiMoveCandidate,
  context: SearchContext,
  isAiTurn: boolean,
): number {
  const opponentThreat = bestImmediateGain(candidate.state, otherPlayer(context.aiPlayer));
  const immediateGain =
    context.orderingMode === "fixed-opponent-ordering" && !isAiTurn
      ? -candidate.immediateGain
      : candidate.immediateGain;
  return (
    immediateGain * context.profile.weights.immediateCapture -
    opponentThreat * context.profile.weights.opponentThreat +
    evaluateProductionState(candidate.state, context.aiPlayer, context.profile) * 0.05
  );
}

function scoreHeuristicCandidate(
  candidate: ProductionAiMoveCandidate,
  aiPlayer: PlayerId,
  profile: ProductionProfile,
): number {
  const opponent = otherPlayer(aiPlayer);
  const opponentThreat = bestImmediateGain(candidate.state, opponent);
  return (
    candidate.immediateGain * profile.weights.immediateCapture -
    opponentThreat * profile.weights.opponentThreat +
    evaluateProductionState(candidate.state, aiPlayer, profile) * profile.positionWeight -
    candidate.state.scores[opponent] * 20
  );
}

function bestImmediateGain(state: GameState, player: PlayerId): number {
  if (state.status === "finished" || state.currentPlayer !== player) return 0;
  return Math.max(0, ...enumerateProductionMoves(state, player).map((candidate) => candidate.immediateGain));
}

function chooseOpeningBookMove(
  state: GameState,
  candidates: ProductionAiMoveCandidate[],
  aiPlayer: PlayerId,
): ProductionAiMove | null {
  const preferredMoves: ProductionAiMove[] = [];
  if (state.moveNumber === 0 && aiPlayer === "P0") {
    preferredMoves.push(
      { pit: "B3", dir: "CW" },
      { pit: "B3", dir: "CCW" },
      { pit: "B2", dir: "CCW" },
      { pit: "B4", dir: "CW" },
    );
  }
  if (state.moveNumber === 1 && aiPlayer === "P1") {
    const previousMove = state.recentMoves.at(-1);
    if (previousMove?.pit === "B2" && previousMove.dir === "CW") {
      preferredMoves.push(
        { pit: "T3", dir: "CW" },
        { pit: "T5", dir: "CCW" },
        { pit: "T1", dir: "CCW" },
        { pit: "T5", dir: "CW" },
      );
    } else if (previousMove?.pit === "B3" && previousMove.dir === "CW") {
      preferredMoves.push(
        { pit: "T2", dir: "CW" },
        { pit: "T4", dir: "CCW" },
        { pit: "T1", dir: "CW" },
      );
    }
  }
  if (state.moveNumber === 3 && aiPlayer === "P1") {
    const [firstMove, secondMove, thirdMove] = state.recentMoves.slice(-3);
    if (
      firstMove?.player === "P0" && firstMove.pit === "B2" && firstMove.dir === "CW" &&
      secondMove?.player === "P1" && secondMove.pit === "T3" && secondMove.dir === "CW" &&
      thirdMove?.player === "P0" && thirdMove.pit === "B3" && thirdMove.dir === "CW"
    ) {
      preferredMoves.push({ pit: "T5", dir: "CW" });
    }
  }
  for (const preferred of preferredMoves) {
    if (candidates.some((candidate) => sameMove(candidate.move, preferred))) return preferred;
  }
  return null;
}

function effectiveSearchDepth(state: GameState, profile: ProductionProfile, aiPlayer: PlayerId): number {
  let depth = profile.searchDepth;
  if (aiPlayer === "P1") depth += profile.secondPlayerDepthBonus;
  if (profile.useEndgameSolver && isEndgameState(state)) {
    depth += profile.bossBuff?.endgameDepthBonus ?? profile.secondPlayerDepthBonus;
  }
  return depth;
}

function isEndgameState(state: GameState): boolean {
  const quanValue = state.pits
    .filter((pit) => pit.kind === "quan")
    .reduce((sum, pit) => sum + pit.stones + pit.quanStones * 10, 0);
  return quanValue <= 8 || state.moveNumber >= 28;
}

function setCache(context: SearchContext, key: string, entry: SearchCacheEntry): void {
  if (!context.cache.has(key) && context.cache.size >= context.profile.maxCacheEntries) {
    const oldestKey = context.cache.keys().next().value as string | undefined;
    if (oldestKey) context.cache.delete(oldestKey);
  }
  context.cache.set(key, entry);
}

function moveTieBreaker(move: ProductionAiMove): number {
  return DAN_PITS_BY_PLAYER.P0.concat(DAN_PITS_BY_PLAYER.P1).indexOf(move.pit) * 2 +
    DIRECTIONS.indexOf(move.dir);
}

function moveKey(move: ProductionAiMove): string {
  return `${move.pit}:${move.dir}`;
}

function sameMove(left: ProductionAiMove, right: ProductionAiMove): boolean {
  return left.pit === right.pit && left.dir === right.dir;
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === "P0" ? "P1" : "P0";
}
