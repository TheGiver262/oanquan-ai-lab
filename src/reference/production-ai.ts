import { applyMove, createStateHash, getLegalMoves } from "../engine.js";
import type { DanPitId, Direction, GameState, MoveEvent, PlayerId, PlayerMove } from "../types.js";

export const PRODUCTION_TOP_DIFFICULTIES = ["tham-hoa", "bang-nhan", "trang-nguyen"] as const;
export type ProductionTopDifficulty = (typeof PRODUCTION_TOP_DIFFICULTIES)[number];

export type ProductionAiMove = { pit: DanPitId; dir: Direction };
export type ProductionAiMoveCandidate = {
  move: ProductionAiMove;
  state: GameState;
  events: MoveEvent[];
  immediateGain: number;
};

type BossBuff = {
  tieCountsAsAiWin: boolean;
  virtualScoreBonus: number;
  endgameDepthBonus: number;
};

type Weights = {
  score: number;
  side: number;
  refill: number;
  quanPressure: number;
  immediateCapture: number;
  opponentThreat: number;
  mobility: number;
  endgame: number;
};

export type ProductionProfile = {
  id: ProductionTopDifficulty;
  label: string;
  searchDepth: number;
  secondPlayerDepthBonus: number;
  mistakeRate: number;
  captureWeight: number;
  retaliationPenalty: number;
  positionWeight: number;
  useCache: boolean;
  useMoveOrdering: boolean;
  useOpeningBook: boolean;
  useEndgameSolver: boolean;
  fullWidthDepth: number;
  maxBranchingMoves: number;
  secondPlayerBranchingBonus?: number;
  nodeBudget: number;
  timeBudgetMs: number;
  maxCacheEntries: number;
  weights: Weights;
  bossBuff: BossBuff | null;
};

const MASTER_WEIGHTS: Weights = {
  score: 155,
  side: 7,
  refill: 22,
  quanPressure: 2.5,
  immediateCapture: 140,
  opponentThreat: 125,
  mobility: 4,
  endgame: 42,
};
const GRANDMASTER_WEIGHTS: Weights = { ...MASTER_WEIGHTS, opponentThreat: 126 };

// Frozen from O_an_quan/apps/web/src/game/ai-player.ts, main, 2026-09-07.
export const PRODUCTION_TOP_PROFILES: Record<ProductionTopDifficulty, ProductionProfile> = {
  "tham-hoa": {
    id: "tham-hoa",
    label: "Thám hoa",
    searchDepth: 6,
    secondPlayerDepthBonus: 3,
    mistakeRate: 0.05,
    captureWeight: 130,
    retaliationPenalty: 98,
    positionWeight: 1.15,
    useCache: true,
    useMoveOrdering: true,
    useOpeningBook: true,
    useEndgameSolver: false,
    fullWidthDepth: 2,
    maxBranchingMoves: 6,
    secondPlayerBranchingBonus: 2,
    nodeBudget: 36_000,
    timeBudgetMs: 600,
    maxCacheEntries: 7_500,
    weights: {
      score: 145,
      side: 6.5,
      refill: 20,
      quanPressure: 2.25,
      immediateCapture: 132,
      opponentThreat: 115,
      mobility: 3.5,
      endgame: 34,
    },
    bossBuff: { tieCountsAsAiWin: false, virtualScoreBonus: 0, endgameDepthBonus: 1 },
  },
  "bang-nhan": {
    id: "bang-nhan",
    label: "Bảng nhãn",
    searchDepth: 8,
    secondPlayerDepthBonus: 3,
    mistakeRate: 0.01,
    captureWeight: 135,
    retaliationPenalty: 104,
    positionWeight: 1.2,
    useCache: true,
    useMoveOrdering: true,
    useOpeningBook: true,
    useEndgameSolver: true,
    fullWidthDepth: 2,
    maxBranchingMoves: 5,
    nodeBudget: 55_000,
    timeBudgetMs: 900,
    maxCacheEntries: 12_000,
    weights: MASTER_WEIGHTS,
    bossBuff: { tieCountsAsAiWin: false, virtualScoreBonus: 0, endgameDepthBonus: 2 },
  },
  "trang-nguyen": {
    id: "trang-nguyen",
    label: "Trạng nguyên",
    searchDepth: 11,
    secondPlayerDepthBonus: 5,
    mistakeRate: 0,
    captureWeight: 145,
    retaliationPenalty: 112,
    positionWeight: 1.3,
    useCache: true,
    useMoveOrdering: true,
    useOpeningBook: true,
    useEndgameSolver: true,
    fullWidthDepth: 3,
    maxBranchingMoves: 6,
    nodeBudget: 100_000,
    timeBudgetMs: 1_200,
    maxCacheEntries: 20_000,
    weights: GRANDMASTER_WEIGHTS,
    bossBuff: { tieCountsAsAiWin: false, virtualScoreBonus: 0, endgameDepthBonus: 4 },
  },
};

export type ProductionSearchOptions = {
  now?: () => number;
  random?: () => number;
  timeBudgetMs?: number;
  maxCacheEntries?: number;
  nodeBudget?: number;
};
export type ProductionSearchDiagnostics = {
  nodeCount: number;
  elapsedMs: number;
  completedDepth: number;
  stateHashComputations: number;
  duplicateCacheLookups: number;
  cacheLookups: number;
  cacheHits: number;
  cacheMisses: number;
  cacheEvictions: number;
  cacheEntries: number;
  peakCacheEntries: number;
  budgetReason: "node" | "time" | null;
};
export type ProductionDecision = {
  move: ProductionAiMove | null;
  diagnostics: ProductionSearchDiagnostics;
};

type RankedCandidate = { candidate: ProductionAiMoveCandidate; score: number; bound?: SearchBound };
type SearchBound = "exact" | "lower" | "upper";
type SearchCacheEntry = { depth: number; score: number; bound: SearchBound; bestMove: ProductionAiMove | null };
type SearchContext = {
  aiPlayer: PlayerId;
  budgetReason: "node" | "time" | null;
  cache: Map<string, SearchCacheEntry> | null;
  cacheEvictions: number;
  cacheHits: number;
  cacheLookups: number;
  cacheMisses: number;
  completedDepth: number;
  deadlineMs: number;
  duplicateCacheLookups: number;
  lastCacheLookupKey: string | null;
  lastCacheLookupNode: number;
  maxCacheEntries: number;
  nodeBudget: number;
  nodeCount: number;
  now: () => number;
  peakCacheEntries: number;
  profile: ProductionProfile;
  random: () => number;
  stateHashComputations: number;
  startedAtMs: number;
};

const DIRECTIONS: Direction[] = ["CW", "CCW"];
const DAN_PITS_BY_PLAYER: Record<PlayerId, DanPitId[]> = {
  P0: ["B1", "B2", "B3", "B4", "B5"],
  P1: ["T1", "T2", "T3", "T4", "T5"],
};
const WIN_SCORE = 1_000_000;
const NODE_BUDGET_EXHAUSTED = new Error("AI node budget exhausted");
const TIME_BUDGET_EXHAUSTED = new Error("AI time budget exhausted");

export function enumerateProductionMoves(state: GameState, player = state.currentPlayer): ProductionAiMoveCandidate[] {
  return getLegalMoves(state, player).flatMap((move) => {
    const result = applyMove(state, move);
    if (!result.ok) return [];
    return [{
      move: { pit: move.pit, dir: move.dir },
      state: result.state,
      events: result.events,
      immediateGain: scoreGain(state, result.state, player),
    }];
  });
}

export function chooseProductionMove(
  state: GameState,
  difficulty: ProductionTopDifficulty,
  aiPlayer = state.currentPlayer,
  options: ProductionSearchOptions = {},
): ProductionAiMove | null {
  return chooseProductionMoveWithDiagnostics(state, difficulty, aiPlayer, options).move;
}

export function chooseProductionMoveWithDiagnostics(
  state: GameState,
  difficulty: ProductionTopDifficulty,
  aiPlayer = state.currentPlayer,
  options: ProductionSearchOptions = {},
): ProductionDecision {
  const profile = PRODUCTION_TOP_PROFILES[difficulty];
  const now = options.now ?? (() => globalThis.performance.now());
  const random = options.random ?? Math.random;
  const startedAtMs = now();
  const candidates = enumerateProductionMoves(state, aiPlayer);
  if (candidates.length === 0) return { move: null, diagnostics: emptyDiagnostics(now() - startedAtMs) };

  if (profile.useOpeningBook) {
    const openingMove = chooseOpeningBookMove(state, candidates, aiPlayer, profile);
    if (openingMove) return { move: openingMove, diagnostics: emptyDiagnostics(now() - startedAtMs) };
  }

  const context: SearchContext = {
    aiPlayer,
    budgetReason: null,
    cache: profile.useCache ? new Map<string, SearchCacheEntry>() : null,
    cacheEvictions: 0,
    cacheHits: 0,
    cacheLookups: 0,
    cacheMisses: 0,
    completedDepth: 0,
    deadlineMs: startedAtMs + (options.timeBudgetMs ?? profile.timeBudgetMs),
    duplicateCacheLookups: 0,
    lastCacheLookupKey: null,
    lastCacheLookupNode: -1,
    maxCacheEntries: options.maxCacheEntries ?? profile.maxCacheEntries,
    nodeBudget: options.nodeBudget ?? profile.nodeBudget,
    nodeCount: 0,
    now,
    peakCacheEntries: 0,
    profile,
    random,
    stateHashComputations: 0,
    startedAtMs,
  };

  const ranked = rankCandidatesWithIterativeDeepening(state, candidates, context);
  const tieBreakByMove = new Map(ranked.map(({ candidate }) => [moveKey(candidate.move), random()]));
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
    if (profile.mistakeRate > 0) {
      const delta = (tieBreakByMove.get(moveKey(left.candidate.move)) ?? 0) - (tieBreakByMove.get(moveKey(right.candidate.move)) ?? 0);
      if (delta !== 0) return delta;
    }
    return moveTieBreaker(left.candidate.move) - moveTieBreaker(right.candidate.move);
  });

  return { move: selectRankedMove(ranked, profile, random), diagnostics: diagnosticsFromContext(context) };
}

function minimax(state: GameState, context: SearchContext, depth: number, alpha: number, beta: number): number {
  throwIfSearchBudgetExhausted(context);
  context.nodeCount += 1;
  const nodeId = context.nodeCount;
  if (depth === 0 || state.status === "finished") return evaluateProductionState(state, context.aiPlayer, context.profile);

  const originalAlpha = alpha;
  const originalBeta = beta;
  const cacheKey = getSearchCacheKey(state, context);
  const cached = cacheKey ? getSearchCacheEntry(context, cacheKey, nodeId) : undefined;
  if (cached && cached.depth >= depth) {
    if (cached.bound === "exact") return cached.score;
    if (cached.bound === "lower") alpha = Math.max(alpha, cached.score);
    if (cached.bound === "upper") beta = Math.min(beta, cached.score);
    if (alpha >= beta) return cached.score;
  }

  throwIfSearchBudgetExhausted(context);
  const candidates = orderSearchCandidates(
    enumerateProductionMoves(state, state.currentPlayer),
    context,
    state.currentPlayer === context.aiPlayer,
    depth,
    cached?.bestMove ?? null,
  );
  if (candidates.length === 0) return evaluateProductionState(state, context.aiPlayer, context.profile);

  let score: number;
  let bestMove: ProductionAiMove | null = null;
  if (state.currentPlayer === context.aiPlayer) {
    let maxEval = -Infinity;
    for (const candidate of candidates) {
      const evaluation = minimax(candidate.state, context, depth - 1, alpha, beta);
      if (evaluation > maxEval) { maxEval = evaluation; bestMove = candidate.move; }
      alpha = Math.max(alpha, evaluation);
      if (beta <= alpha) break;
    }
    score = maxEval;
  } else {
    let minEval = Infinity;
    for (const candidate of candidates) {
      const evaluation = minimax(candidate.state, context, depth - 1, alpha, beta);
      if (evaluation < minEval) { minEval = evaluation; bestMove = candidate.move; }
      beta = Math.min(beta, evaluation);
      if (beta <= alpha) break;
    }
    score = minEval;
  }

  if (cacheKey) {
    const bound: SearchBound = score <= originalAlpha ? "upper" : score >= originalBeta ? "lower" : "exact";
    setSearchCacheEntry(context, cacheKey, { depth, score, bound, bestMove });
  }
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
    const iteration: RankedCandidate[] = [];
    let alpha = -Infinity;
    try {
      throwIfSearchBudgetExhausted(context);
      const ordered = orderRootCandidates(candidates, completed, context);
      for (const candidate of ordered) {
        throwIfSearchBudgetExhausted(context);
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

function orderRootCandidates(candidates: ProductionAiMoveCandidate[], previous: RankedCandidate[], context: SearchContext): ProductionAiMoveCandidate[] {
  const previousEntries = new Map(previous.map(({ candidate, score, bound }) => [moveKey(candidate.move), { score, bound: bound ?? "exact" }]));
  const orderingScores = new Map(candidates.map((candidate) => [moveKey(candidate.move), moveOrderingScore(candidate, context)]));
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
    return (orderingScores.get(moveKey(right.move)) ?? 0) - (orderingScores.get(moveKey(left.move)) ?? 0);
  });
}

function selectRankedMove(ranked: RankedCandidate[], profile: ProductionProfile, random: () => number): ProductionAiMove | null {
  if (ranked.length === 0) return null;
  if (profile.mistakeRate > 0 && random() < profile.mistakeRate) {
    const start = Math.max(1, Math.floor(ranked.length / 2));
    const mistakePool = ranked.slice(start);
    const pool = mistakePool.length > 0 ? mistakePool : ranked;
    return pool[Math.floor(random() * pool.length)]?.candidate.move ?? null;
  }
  return ranked[0]?.candidate.move ?? null;
}

function scoreHeuristicCandidate(candidate: ProductionAiMoveCandidate, aiPlayer: PlayerId, profile: ProductionProfile): number {
  const opponent = otherPlayer(aiPlayer);
  const opponentThreat = bestImmediateGain(candidate.state, opponent);
  return candidate.immediateGain * profile.weights.immediateCapture -
    opponentThreat * profile.weights.opponentThreat +
    evaluateProductionState(candidate.state, aiPlayer, profile) * profile.positionWeight -
    candidate.state.scores[opponent] * 20;
}

function bestImmediateGain(state: GameState, player: PlayerId, context?: SearchContext): number {
  if (state.status === "finished" || state.currentPlayer !== player) return 0;
  let best = 0;
  for (const candidate of enumerateProductionMoves(state, player)) {
    if (context) throwIfSearchBudgetExhausted(context);
    best = Math.max(best, candidate.immediateGain);
  }
  return best;
}

export function evaluateProductionState(state: GameState, aiPlayer: PlayerId, profile: ProductionProfile): number {
  const opponent = otherPlayer(aiPlayer);
  if (state.status === "finished") {
    if (state.winner === aiPlayer) return WIN_SCORE;
    if (state.winner === opponent) return -WIN_SCORE;
    if (profile.bossBuff?.tieCountsAsAiWin) return WIN_SCORE * 0.9;
    return 0;
  }
  const scoreDelta = state.scores[aiPlayer] + (profile.bossBuff?.virtualScoreBonus ?? 0) - state.scores[opponent];
  const sideDelta = sideValue(state, aiPlayer) - sideValue(state, opponent);
  const refillDelta = refillSafety(state, aiPlayer) - refillSafety(state, opponent);
  const quanPressure = quanPressureValue(state, aiPlayer);
  const mobilityDelta = mobilityValue(state, aiPlayer) - mobilityValue(state, opponent);
  const endgameDelta = isEndgameState(state) ? scoreDelta + sideDelta * 0.25 : 0;
  const w = profile.weights;
  return scoreDelta * w.score + sideDelta * w.side + refillDelta * w.refill +
    quanPressure * w.quanPressure + mobilityDelta * w.mobility + endgameDelta * w.endgame;
}

function sideValue(state: GameState, player: PlayerId): number {
  return DAN_PITS_BY_PLAYER[player].reduce((sum, pitId) => {
    const pit = state.pits.find((candidate) => candidate.id === pitId);
    return sum + (pit?.stones ?? 0) + (pit?.quanStones ?? 0) * 10;
  }, 0);
}
function refillSafety(state: GameState, player: PlayerId): number {
  const stones = sideValue(state, player);
  if (stones > 0) return Math.min(5, stones);
  return state.scores[player] >= 5 ? 1 : -8;
}
function quanValue(state: GameState): number {
  return state.pits.filter((pit) => pit.kind === "quan").reduce((sum, pit) => sum + pit.stones + pit.quanStones * 10, 0);
}
function quanPressureValue(state: GameState, aiPlayer: PlayerId): number {
  const remainingQuanValue = quanValue(state);
  if (remainingQuanValue <= 0) return 0;
  return remainingQuanValue * (state.currentPlayer === aiPlayer ? 1 : -0.5);
}
function mobilityValue(state: GameState, player: PlayerId): number {
  return DAN_PITS_BY_PLAYER[player].reduce((sum, pitId) => sum + (((state.pits.find((p) => p.id === pitId)?.stones ?? 0) > 0) ? 1 : 0), 0);
}
function moveTieBreaker(move: ProductionAiMove): number {
  return DAN_PITS_BY_PLAYER.P0.concat(DAN_PITS_BY_PLAYER.P1).indexOf(move.pit) * 2 + DIRECTIONS.indexOf(move.dir);
}
function moveKey(move: ProductionAiMove): string { return `${move.pit}:${move.dir}`; }
function isSameMove(left: ProductionAiMove, right: ProductionAiMove): boolean { return left.pit === right.pit && left.dir === right.dir; }
function scoreGain(before: GameState, after: GameState, player: PlayerId): number { return after.scores[player] - before.scores[player]; }
function otherPlayer(player: PlayerId): PlayerId { return player === "P0" ? "P1" : "P0"; }

function orderSearchCandidates(
  candidates: ProductionAiMoveCandidate[],
  context: SearchContext,
  isAiTurn: boolean,
  depth: number,
  cachedBestMove: ProductionAiMove | null,
): ProductionAiMoveCandidate[] {
  if (!context.profile.useMoveOrdering) return candidates;
  throwIfSearchBudgetExhausted(context);
  const scored = candidates.map((candidate) => ({
    candidate,
    score: moveOrderingScore(candidate, context),
    isCached: cachedBestMove ? isSameMove(candidate.move, cachedBestMove) : false,
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

function moveOrderingScore(candidate: ProductionAiMoveCandidate, context: SearchContext): number {
  throwIfSearchBudgetExhausted(context);
  const opponentThreat = bestImmediateGain(candidate.state, otherPlayer(context.aiPlayer), context);
  throwIfSearchBudgetExhausted(context);
  return candidate.immediateGain * context.profile.weights.immediateCapture -
    opponentThreat * context.profile.weights.opponentThreat +
    evaluateProductionState(candidate.state, context.aiPlayer, context.profile) * 0.05;
}

function throwIfSearchBudgetExhausted(context: SearchContext): void {
  if (context.now() >= context.deadlineMs) throw TIME_BUDGET_EXHAUSTED;
  if (context.nodeCount >= context.nodeBudget) throw NODE_BUDGET_EXHAUSTED;
}
function effectiveSearchDepth(state: GameState, profile: ProductionProfile, aiPlayer: PlayerId): number {
  let depth = profile.searchDepth;
  if (aiPlayer === "P1") depth += profile.secondPlayerDepthBonus;
  if (profile.useEndgameSolver && isEndgameState(state)) depth += profile.bossBuff?.endgameDepthBonus ?? profile.secondPlayerDepthBonus;
  return depth;
}
function isEndgameState(state: GameState): boolean { return quanValue(state) <= 8 || state.moveNumber >= 28; }

function getSearchCacheKey(state: GameState, context: SearchContext): string | null {
  if (!context.cache) return null;
  context.stateHashComputations += 1;
  return `${context.profile.id}:${createStateHash(state)}`;
}
function getSearchCacheEntry(context: SearchContext, key: string, nodeId: number): SearchCacheEntry | undefined {
  const cache = context.cache;
  if (!cache) return undefined;
  if (context.lastCacheLookupNode === nodeId && context.lastCacheLookupKey === key) context.duplicateCacheLookups += 1;
  context.lastCacheLookupNode = nodeId;
  context.lastCacheLookupKey = key;
  context.cacheLookups += 1;
  const entry = cache.get(key);
  if (entry) context.cacheHits += 1; else context.cacheMisses += 1;
  return entry;
}
function setSearchCacheEntry(context: SearchContext, key: string, entry: SearchCacheEntry): void {
  const cache = context.cache;
  if (!cache || context.maxCacheEntries <= 0) return;
  if (!cache.has(key) && cache.size >= context.maxCacheEntries) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (oldestKey) { cache.delete(oldestKey); context.cacheEvictions += 1; }
  }
  cache.set(key, entry);
  context.peakCacheEntries = Math.max(context.peakCacheEntries, cache.size);
}
function emptyDiagnostics(elapsedMs: number): ProductionSearchDiagnostics {
  return {
    nodeCount: 0, elapsedMs: Math.max(0, elapsedMs), completedDepth: 0,
    stateHashComputations: 0, duplicateCacheLookups: 0, cacheLookups: 0, cacheHits: 0,
    cacheMisses: 0, cacheEvictions: 0, cacheEntries: 0, peakCacheEntries: 0, budgetReason: null,
  };
}
function diagnosticsFromContext(context: SearchContext): ProductionSearchDiagnostics {
  return {
    nodeCount: context.nodeCount,
    elapsedMs: Math.max(0, context.now() - context.startedAtMs),
    completedDepth: context.completedDepth,
    stateHashComputations: context.stateHashComputations,
    duplicateCacheLookups: context.duplicateCacheLookups,
    cacheLookups: context.cacheLookups,
    cacheHits: context.cacheHits,
    cacheMisses: context.cacheMisses,
    cacheEvictions: context.cacheEvictions,
    cacheEntries: context.cache?.size ?? 0,
    peakCacheEntries: context.peakCacheEntries,
    budgetReason: context.budgetReason,
  };
}

function chooseOpeningBookMove(
  state: GameState,
  candidates: ProductionAiMoveCandidate[],
  aiPlayer: PlayerId,
  profile: ProductionProfile,
): ProductionAiMove | null {
  const preferredMoves: ProductionAiMove[] = [];
  if (state.moveNumber === 0 && aiPlayer === "P0" && profile.id !== "tham-hoa") {
    preferredMoves.push(
      { pit: "B3", dir: "CW" }, { pit: "B3", dir: "CCW" },
      { pit: "B2", dir: "CCW" }, { pit: "B4", dir: "CW" },
    );
  }
  if (state.moveNumber === 1 && aiPlayer === "P1") {
    const previousMove = state.recentMoves.at(-1);
    if (previousMove?.pit === "B2" && previousMove.dir === "CW") {
      preferredMoves.push(
        { pit: "T3", dir: "CW" }, { pit: "T5", dir: "CCW" },
        { pit: "T1", dir: "CCW" }, { pit: "T5", dir: "CW" },
      );
    } else if (previousMove?.pit === "B3" && previousMove.dir === "CW") {
      preferredMoves.push(
        { pit: "T2", dir: "CW" }, { pit: "T4", dir: "CCW" }, { pit: "T1", dir: "CW" },
      );
    }
  }
  if (state.moveNumber === 3 && aiPlayer === "P1") {
    const [firstMove, secondMove, thirdMove] = state.recentMoves.slice(-3);
    if (
      firstMove?.player === "P0" && firstMove.pit === "B2" && firstMove.dir === "CW" &&
      secondMove?.player === "P1" && secondMove.pit === "T3" && secondMove.dir === "CW" &&
      thirdMove?.player === "P0" && thirdMove.pit === "B3" && thirdMove.dir === "CW"
    ) preferredMoves.push({ pit: "T5", dir: "CW" });
  }
  for (const preferred of preferredMoves) {
    if (candidates.some((candidate) => isSameMove(candidate.move, preferred))) return preferred;
  }
  return null;
}

export function toPlayerMove(move: ProductionAiMove, player: PlayerId): PlayerMove {
  return { player, pit: move.pit, dir: move.dir };
}
