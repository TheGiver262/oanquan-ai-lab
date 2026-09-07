import { applyMove, createStateHash, getLegalMoves } from "../engine.js";
import type { GameState, PlayerId } from "../types.js";
import {
  PRODUCTION_TOP_PROFILES,
  enumerateProductionMoves,
  evaluateProductionState,
  type ProductionAiMove,
  type ProductionAiMoveCandidate,
  type ProductionProfile,
  type ProductionTopDifficulty,
} from "./production-ai.js";
import {
  SearchBudgetExhausted,
  searchTrangNguyenBestFirst,
  type TrangNguyenBoundedOutcome,
  type TrangNguyenWdl,
} from "./trang-nguyen-best-first-search.js";
import type { TrangNguyenLearningReader } from "./trang-nguyen-learning.js";

export const PRODUCTION_SOURCE_COMMIT = "4984701ce151ee270a6a5ba5fc9211a6ec2b6996" as const;
export type ProductionStrengthMode = "production-live" | "production-max";

export type ServerProductionOptions = {
  mode?: ProductionStrengthMode;
  learning?: TrangNguyenLearningReader;
  nodeBudget?: number;
  now?: () => number;
  random?: () => number;
  timeBudgetMs?: number;
};

export type ServerProductionDecision = {
  move: ProductionAiMove | null;
  source: "iterative-alpha-beta" | "trang-nguyen-best-first";
  completedDepth: number;
  nodeCount: number;
  budgetReason: "node" | "time" | null;
  learningEnabled: boolean;
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
  outcome?: TrangNguyenBoundedOutcome;
  lowerBound?: TrangNguyenWdl;
  upperBound?: TrangNguyenWdl;
  completedDepth?: number;
  visits?: number;
};
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

const NODE_BUDGET_EXHAUSTED = new Error("AI node budget exhausted");
const TIME_BUDGET_EXHAUSTED = new Error("AI time budget exhausted");
const WIN_SCORE = 1_000_000;
const DIRECTIONS = ["CW", "CCW"] as const;
const DAN_PITS_BY_PLAYER = {
  P0: ["B1", "B2", "B3", "B4", "B5"],
  P1: ["T1", "T2", "T3", "T4", "T5"],
} as const;

export function chooseServerProductionMove(
  state: GameState,
  difficulty: ProductionTopDifficulty,
  aiPlayer = state.currentPlayer,
  options: ServerProductionOptions = {},
): ProductionAiMove | null {
  return chooseServerProductionMoveWithDiagnostics(state, difficulty, aiPlayer, options).move;
}

export function chooseServerProductionMoveWithDiagnostics(
  state: GameState,
  difficulty: ProductionTopDifficulty,
  aiPlayer = state.currentPlayer,
  options: ServerProductionOptions = {},
): ServerProductionDecision {
  return difficulty === "trang-nguyen"
    ? chooseTrangNguyenServerMove(state, aiPlayer, options)
    : chooseIterativeServerMove(state, difficulty, aiPlayer, options);
}

function chooseIterativeServerMove(
  state: GameState,
  difficulty: "tham-hoa" | "bang-nhan",
  aiPlayer: PlayerId,
  options: ServerProductionOptions,
): ServerProductionDecision {
  const profile = PRODUCTION_TOP_PROFILES[difficulty];
  const now = options.now ?? (() => globalThis.performance.now());
  const random = options.random ?? Math.random;
  const startedAtMs = now();
  const candidates = enumerateProductionMoves(state, aiPlayer);
  if (candidates.length === 0) {
    return emptyDecision("iterative-alpha-beta");
  }

  if (profile.useOpeningBook) {
    const openingMove = chooseOpeningBookMove(state, candidates, aiPlayer, profile);
    if (openingMove) {
      return {
        ...emptyDecision("iterative-alpha-beta"),
        move: openingMove,
      };
    }
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
    maxCacheEntries: profile.maxCacheEntries,
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
      const seededDelta =
        (tieBreakByMove.get(moveKey(left.candidate.move)) ?? 0) -
        (tieBreakByMove.get(moveKey(right.candidate.move)) ?? 0);
      if (seededDelta !== 0) return seededDelta;
    }
    return moveTieBreaker(left.candidate.move) - moveTieBreaker(right.candidate.move);
  });

  return {
    move: selectRankedMove(ranked, profile, random, options.mode ?? "production-live"),
    source: "iterative-alpha-beta",
    completedDepth: context.completedDepth,
    nodeCount: context.nodeCount,
    budgetReason: context.budgetReason,
    learningEnabled: false,
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
  const nodeId = context.nodeCount;
  // Intentional parity with production commit: server checks the profile budget here.
  if (context.nodeCount > context.profile.nodeBudget) throw NODE_BUDGET_EXHAUSTED;
  if (depth === 0 || state.status === "finished") {
    return evaluateProductionState(state, context.aiPlayer, context.profile);
  }

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

  const candidates = orderSearchCandidates(
    enumerateProductionMoves(state, state.currentPlayer),
    context,
    state.currentPlayer === context.aiPlayer,
    depth,
    cached?.bestMove ?? null,
  );
  if (candidates.length === 0) {
    return evaluateProductionState(state, context.aiPlayer, context.profile);
  }

  let score: number;
  let bestMove: ProductionAiMove | null = null;
  if (state.currentPlayer === context.aiPlayer) {
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

  if (cacheKey) {
    const bound: SearchBound =
      score <= originalAlpha ? "upper" : score >= originalBeta ? "lower" : "exact";
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
    candidates.map((candidate) => [moveKey(candidate.move), moveOrderingScore(candidate, context)]),
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
  if (!context.profile.useMoveOrdering) return candidates;
  const scored = candidates.map((candidate) => ({
    candidate,
    score: moveOrderingScore(candidate, context),
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

function moveOrderingScore(candidate: ProductionAiMoveCandidate, context: SearchContext): number {
  const opponentThreat = bestImmediateGain(candidate.state, otherPlayer(context.aiPlayer));
  return (
    candidate.immediateGain * context.profile.weights.immediateCapture -
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

function selectRankedMove(
  ranked: RankedCandidate[],
  profile: ProductionProfile,
  random: () => number,
  mode: ProductionStrengthMode,
): ProductionAiMove | null {
  if (ranked.length === 0) return null;
  if (mode === "production-live" && profile.mistakeRate > 0 && random() < profile.mistakeRate) {
    const start = Math.max(1, Math.floor(ranked.length / 2));
    const mistakePool = ranked.slice(start);
    const pool = mistakePool.length > 0 ? mistakePool : ranked;
    return pool[Math.floor(random() * pool.length)]?.candidate.move ?? null;
  }
  return ranked[0]?.candidate.move ?? null;
}

function getSearchCacheKey(state: GameState, context: SearchContext): string | null {
  if (!context.cache) return null;
  context.stateHashComputations += 1;
  return `${context.profile.id}:${createStateHash(state)}`;
}

function getSearchCacheEntry(
  context: SearchContext,
  key: string,
  nodeId: number,
): SearchCacheEntry | undefined {
  if (!context.cache) return undefined;
  if (context.lastCacheLookupNode === nodeId && context.lastCacheLookupKey === key) {
    context.duplicateCacheLookups += 1;
  }
  context.lastCacheLookupNode = nodeId;
  context.lastCacheLookupKey = key;
  context.cacheLookups += 1;
  const entry = context.cache.get(key);
  if (entry) context.cacheHits += 1;
  else context.cacheMisses += 1;
  return entry;
}

function setSearchCacheEntry(context: SearchContext, key: string, entry: SearchCacheEntry): void {
  const cache = context.cache;
  if (!cache || context.maxCacheEntries <= 0) return;
  if (!cache.has(key) && cache.size >= context.maxCacheEntries) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (oldestKey) {
      cache.delete(oldestKey);
      context.cacheEvictions += 1;
    }
  }
  cache.set(key, entry);
  context.peakCacheEntries = Math.max(context.peakCacheEntries, cache.size);
}

function chooseTrangNguyenServerMove(
  state: GameState,
  aiPlayer: PlayerId,
  options: ServerProductionOptions,
): ServerProductionDecision {
  const profile = PRODUCTION_TOP_PROFILES["trang-nguyen"];
  const now = options.now ?? (() => globalThis.performance.now());
  const startedAt = now();
  const deadline = startedAt + (options.timeBudgetMs ?? profile.timeBudgetMs);
  const nodeBudget = options.nodeBudget ?? profile.nodeBudget;
  const random = options.random ?? Math.random;
  const learning = options.learning;
  const candidates = enumerateProductionMoves(state, aiPlayer);
  if (candidates.length === 0) return emptyDecision("trang-nguyen-best-first", Boolean(learning));

  const learnedCandidates = learning
    ? filterLearnedCandidates(state, candidates, aiPlayer, learning)
    : candidates;
  const openingMove = profile.useOpeningBook
    ? chooseOpeningBookMove(state, learnedCandidates, aiPlayer, profile)
    : null;

  let nodeCount = 0;
  const orderedRoot = [...candidates].sort((left, right) => {
    if (openingMove) {
      const leftIsOpening = sameMove(left.move, openingMove);
      const rightIsOpening = sameMove(right.move, openingMove);
      if (leftIsOpening !== rightIsOpening) return leftIsOpening ? -1 : 1;
    }
    return trangNguyenMoveOrderingScore(right, aiPlayer) -
      trangNguyenMoveOrderingScore(left, aiPlayer);
  });
  const rootCandidates = new Map(orderedRoot.map((candidate) => [moveKey(candidate.move), candidate]));
  const shallowScores = new Map<GameState, number>(
    candidates.map((candidate) => [candidate.state, scoreHeuristicCandidate(candidate, aiPlayer, profile)]),
  );

  const result = searchTrangNguyenBestFirst({
    rootState: state,
    perspective: aiPlayer,
    maxDepth: effectiveSearchDepth(state, profile, aiPlayer),
    adapter: {
      currentPlayer: (candidateState) => candidateState.currentPlayer,
      legalMoves: (candidateState) =>
        candidateState === state
          ? orderedRoot.map((candidate) => candidate.move)
          : getLegalMoves(candidateState, candidateState.currentPlayer).map((move) => ({
              pit: move.pit,
              dir: move.dir,
            })),
      applyMove: (candidateState, move) => {
        const applied = applyMove(candidateState, {
          player: candidateState.currentPlayer,
          pit: move.pit,
          dir: move.dir,
        });
        if (!applied.ok) throw new Error(`Server reference search received illegal move ${moveKey(move)}`);
        return applied.state;
      },
      terminalOutcome: (candidateState, perspective) => {
        if (candidateState.status !== "finished") return null;
        if (candidateState.winner === perspective) return "win";
        if (candidateState.winner === null) return "draw";
        return "loss";
      },
      heuristic: (candidateState, perspective) =>
        shallowScores.get(candidateState) ?? evaluateProductionState(candidateState, perspective, profile),
      moveKey,
    },
    budget: {
      shouldStop: () => {
        if (now() >= deadline) return "time";
        if (nodeCount >= nodeBudget) return "node";
        return null;
      },
      consumeNode: () => {
        if (now() >= deadline) throw new SearchBudgetExhausted("time");
        if (nodeCount >= nodeBudget) throw new SearchBudgetExhausted("node");
        nodeCount += 1;
      },
    },
  });

  let ranked: RankedCandidate[] = result.branches.flatMap((branch) => {
    const candidate = rootCandidates.get(moveKey(branch.move));
    return candidate
      ? [{
          candidate,
          score: branch.score,
          outcome: branch.outcome,
          lowerBound: branch.lowerBound,
          upperBound: branch.upperBound,
          completedDepth: branch.completedDepth,
          visits: branch.visits,
        }]
      : [];
  });

  const tieBreakByMove = new Map(ranked.map(({ candidate }) => [moveKey(candidate.move), random()]));
  ranked.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (right.candidate.immediateGain !== left.candidate.immediateGain) {
      return right.candidate.immediateGain - left.candidate.immediateGain;
    }
    if (profile.mistakeRate > 0) {
      const seededDelta =
        (tieBreakByMove.get(moveKey(left.candidate.move)) ?? 0) -
        (tieBreakByMove.get(moveKey(right.candidate.move)) ?? 0);
      if (seededDelta !== 0) return seededDelta;
    }
    return moveTieBreaker(left.candidate.move) - moveTieBreaker(right.candidate.move);
  });

  if (learning && !ranked.some(({ outcome, score }) => outcome === "win" || score >= WIN_SCORE)) {
    const allowed = new Set(
      learning.filterCandidates(state, aiPlayer, ranked.map(({ candidate }) => candidate.move)).map(moveKey),
    );
    const filtered = ranked.filter(({ candidate }) => allowed.has(moveKey(candidate.move)));
    if (filtered.length > 0 && filtered.length < ranked.length) {
      ranked = filtered;
    } else {
      ranked.sort((left, right) => {
        const learnedOrder = learning.compareMoves(
          state,
          aiPlayer,
          left.candidate.move,
          right.candidate.move,
        );
        if (learnedOrder !== 0) return learnedOrder;
        return right.score - left.score;
      });
    }
  }

  const completedDepth = result.branches.reduce(
    (depth, branch) => Math.min(depth, branch.completedDepth),
    result.branches[0]?.completedDepth ?? 0,
  );
  return {
    move: ranked[0]?.candidate.move ?? null,
    source: "trang-nguyen-best-first",
    completedDepth,
    nodeCount,
    budgetReason: result.budgetReason,
    learningEnabled: Boolean(learning),
  };
}

function filterLearnedCandidates(
  state: GameState,
  candidates: ProductionAiMoveCandidate[],
  aiPlayer: PlayerId,
  learning: TrangNguyenLearningReader,
): ProductionAiMoveCandidate[] {
  const allowed = new Set(
    learning.filterCandidates(state, aiPlayer, candidates.map((candidate) => candidate.move)).map(moveKey),
  );
  const filtered = candidates.filter((candidate) => allowed.has(moveKey(candidate.move)));
  return filtered.length > 0 ? filtered : candidates;
}

function trangNguyenMoveOrderingScore(candidate: ProductionAiMoveCandidate, aiPlayer: PlayerId): number {
  const profile = PRODUCTION_TOP_PROFILES["trang-nguyen"];
  const opponentThreat = bestImmediateGain(candidate.state, otherPlayer(aiPlayer));
  return (
    candidate.immediateGain * profile.weights.immediateCapture -
    opponentThreat * profile.weights.opponentThreat +
    evaluateProductionState(candidate.state, aiPlayer, profile) * 0.05
  );
}

function effectiveSearchDepth(
  state: GameState,
  profile: ProductionProfile,
  aiPlayer: PlayerId,
): number {
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

function chooseOpeningBookMove(
  state: GameState,
  candidates: ProductionAiMoveCandidate[],
  aiPlayer: PlayerId,
  profile: ProductionProfile,
): ProductionAiMove | null {
  const preferredMoves: ProductionAiMove[] = [];
  if (state.moveNumber === 0 && aiPlayer === "P0" && profile.id !== "tham-hoa") {
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

function moveTieBreaker(move: ProductionAiMove): number {
  const allPits = [...DAN_PITS_BY_PLAYER.P0, ...DAN_PITS_BY_PLAYER.P1];
  return allPits.indexOf(move.pit) * 2 + DIRECTIONS.indexOf(move.dir);
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

function emptyDecision(
  source: ServerProductionDecision["source"],
  learningEnabled = false,
): ServerProductionDecision {
  return {
    move: null,
    source,
    completedDepth: 0,
    nodeCount: 0,
    budgetReason: null,
    learningEnabled,
  };
}
