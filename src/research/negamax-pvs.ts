import { applyMove, createStateHash, getLegalMoves, otherPlayer } from "../engine.js";
import type { GameState, PlayerId, PlayerMove } from "../types.js";

const INF = 1_000_000_000;
const TERMINAL = 10_000_000;

export type NegamaxPvsOptions = {
  maxDepth?: number;
  nodeBudget?: number;
  timeBudgetMs?: number;
  aspirationWindow?: number;
  usePvs?: boolean;
  useTranspositionTable?: boolean;
};

export type NegamaxPvsDiagnostics = {
  nodeCount: number;
  completedDepth: number;
  ttHits: number;
  ttEntries: number;
  cutoffs: number;
  aspirationResearches: number;
  budgetReason: "node" | "time" | null;
};

export type NegamaxPvsResult = {
  move: PlayerMove | null;
  score: number;
  principalVariation: PlayerMove[];
  diagnostics: NegamaxPvsDiagnostics;
};

type Bound = "exact" | "lower" | "upper";
type TtEntry = {
  depth: number;
  score: number;
  bound: Bound;
  bestMoveKey: string | null;
};

type SearchContext = {
  nodeBudget: number;
  deadline: number;
  usePvs: boolean;
  useTranspositionTable: boolean;
  tt: Map<string, TtEntry>;
  nodeCount: number;
  ttHits: number;
  cutoffs: number;
  aspirationResearches: number;
  budgetReason: "node" | "time" | null;
};

type NodeResult = {
  score: number;
  pv: PlayerMove[];
};

class BudgetExhausted extends Error {
  constructor(readonly reason: "node" | "time") {
    super(reason);
  }
}

/**
 * Independent deterministic search baseline for the research lab.
 *
 * This is intentionally not a copy of production Trạng Nguyên evaluation or
 * root-search logic. It uses iterative-deepening Negamax, alpha-beta, PVS,
 * aspiration windows and a transposition table with a deliberately small
 * material/refill heuristic.
 */
export function searchNegamaxPvs(
  state: GameState,
  options: NegamaxPvsOptions = {},
): NegamaxPvsResult {
  const maxDepth = options.maxDepth ?? 12;
  const nodeBudget = options.nodeBudget ?? 100_000;
  const timeBudgetMs = options.timeBudgetMs ?? 1_200;
  const aspirationWindow = options.aspirationWindow ?? 250;
  const usePvs = options.usePvs ?? true;
  const useTranspositionTable = options.useTranspositionTable ?? true;
  const legal = getLegalMoves(state);

  if (state.status === "finished" || legal.length === 0) {
    return {
      move: null,
      score: evaluateIndependent(state, state.currentPlayer),
      principalVariation: [],
      diagnostics: {
        nodeCount: 0,
        completedDepth: 0,
        ttHits: 0,
        ttEntries: 0,
        cutoffs: 0,
        aspirationResearches: 0,
        budgetReason: null,
      },
    };
  }

  const context: SearchContext = {
    nodeBudget,
    deadline: performance.now() + timeBudgetMs,
    usePvs,
    useTranspositionTable,
    tt: new Map<string, TtEntry>(),
    nodeCount: 0,
    ttHits: 0,
    cutoffs: 0,
    aspirationResearches: 0,
    budgetReason: null,
  };

  let bestMove = legal[0] ?? null;
  let bestScore = bestMove ? scoreMoveFallback(state, bestMove) : evaluateIndependent(state, state.currentPlayer);
  let bestPv = bestMove ? [bestMove] : [];
  let completedDepth = 0;
  let previousScore: number | null = null;

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    try {
      let alpha = -INF;
      let beta = INF;
      if (previousScore !== null) {
        alpha = previousScore - aspirationWindow;
        beta = previousScore + aspirationWindow;
      }

      let iteration = negamax(state, state.currentPlayer, depth, alpha, beta, context);
      if (previousScore !== null && (iteration.score <= alpha || iteration.score >= beta)) {
        context.aspirationResearches += 1;
        iteration = negamax(state, state.currentPlayer, depth, -INF, INF, context);
      }

      const iterationMove = iteration.pv[0] ?? null;
      if (iterationMove) {
        bestMove = iterationMove;
        bestScore = iteration.score;
        bestPv = iteration.pv;
      }
      previousScore = iteration.score;
      completedDepth = depth;
    } catch (error) {
      if (!(error instanceof BudgetExhausted)) throw error;
      context.budgetReason = error.reason;
      break;
    }
  }

  return {
    move: bestMove,
    score: bestScore,
    principalVariation: bestPv,
    diagnostics: {
      nodeCount: context.nodeCount,
      completedDepth,
      ttHits: context.ttHits,
      ttEntries: context.tt.size,
      cutoffs: context.cutoffs,
      aspirationResearches: context.aspirationResearches,
      budgetReason: context.budgetReason,
    },
  };
}

export function evaluateIndependent(state: GameState, perspective: PlayerId): number {
  const opponent = otherPlayer(perspective);
  if (state.status === "finished") {
    if (state.winner === null) return 0;
    const margin = state.scores[perspective] - state.scores[opponent];
    return state.winner === perspective ? TERMINAL + margin : -TERMINAL + margin;
  }

  const ownSide = sideStones(state, perspective);
  const opponentSide = sideStones(state, opponent);
  const scoreDelta = state.scores[perspective] - state.scores[opponent];
  const sideDelta = ownSide - opponentSide;
  const refillReserveDelta = refillReserve(state, perspective) - refillReserve(state, opponent);

  // Kept intentionally simple and independent from production tuning.
  return scoreDelta * 20 + sideDelta * 10 + refillReserveDelta * 3;
}

function negamax(
  state: GameState,
  playerToMove: PlayerId,
  depth: number,
  alphaInput: number,
  betaInput: number,
  context: SearchContext,
): NodeResult {
  consumeNode(context);

  if (state.status === "finished" || depth === 0) {
    return { score: evaluateIndependent(state, playerToMove), pv: [] };
  }

  if (state.currentPlayer !== playerToMove) {
    throw new Error(`Negamax player mismatch: state=${state.currentPlayer}, expected=${playerToMove}`);
  }

  const key = `${createStateHash(state)}:${playerToMove}`;
  const originalAlpha = alphaInput;
  const originalBeta = betaInput;
  let alpha = alphaInput;
  let beta = betaInput;
  let ttBestMoveKey: string | null = null;

  if (context.useTranspositionTable) {
    const cached = context.tt.get(key);
    if (cached && cached.depth >= depth) {
      context.ttHits += 1;
      ttBestMoveKey = cached.bestMoveKey;
      if (cached.bound === "exact") return { score: cached.score, pv: [] };
      if (cached.bound === "lower") alpha = Math.max(alpha, cached.score);
      else beta = Math.min(beta, cached.score);
      if (alpha >= beta) return { score: cached.score, pv: [] };
    } else if (cached) {
      ttBestMoveKey = cached.bestMoveKey;
    }
  }

  const ordered = orderMoves(state, playerToMove, ttBestMoveKey);
  if (ordered.length === 0) {
    return { score: evaluateIndependent(state, playerToMove), pv: [] };
  }

  let bestScore = -INF;
  let bestMove: PlayerMove | null = null;
  let bestChildPv: PlayerMove[] = [];

  for (let index = 0; index < ordered.length; index += 1) {
    const move = ordered[index];
    if (!move) continue;
    const applied = applyMove(state, move);
    if (!applied.ok) continue;
    const childPlayer = otherPlayer(playerToMove);

    let child: NodeResult;
    if (!context.usePvs || index === 0) {
      child = negamax(applied.state, childPlayer, depth - 1, -beta, -alpha, context);
      child = { score: -child.score, pv: child.pv };
    } else {
      child = negamax(applied.state, childPlayer, depth - 1, -alpha - 1, -alpha, context);
      child = { score: -child.score, pv: child.pv };
      if (child.score > alpha && child.score < beta) {
        child = negamax(applied.state, childPlayer, depth - 1, -beta, -alpha, context);
        child = { score: -child.score, pv: child.pv };
      }
    }

    if (child.score > bestScore || (child.score === bestScore && compareMove(move, bestMove) < 0)) {
      bestScore = child.score;
      bestMove = move;
      bestChildPv = child.pv;
    }
    alpha = Math.max(alpha, bestScore);
    if (alpha >= beta) {
      context.cutoffs += 1;
      break;
    }
  }

  const pv = bestMove ? [bestMove, ...bestChildPv] : [];
  if (context.useTranspositionTable) {
    const bound: Bound = bestScore <= originalAlpha ? "upper" : bestScore >= originalBeta ? "lower" : "exact";
    context.tt.set(key, {
      depth,
      score: bestScore,
      bound,
      bestMoveKey: bestMove ? moveKey(bestMove) : null,
    });
  }

  return { score: bestScore, pv };
}

function orderMoves(state: GameState, player: PlayerId, ttBestMoveKey: string | null): PlayerMove[] {
  const candidates = getLegalMoves(state, player).map((move) => {
    const applied = applyMove(state, move);
    if (!applied.ok) return { move, orderingScore: -INF };
    const immediateGain = applied.state.scores[player] - state.scores[player];
    const terminalBonus = applied.state.status === "finished"
      ? applied.state.winner === player
        ? 1_000_000
        : applied.state.winner === null
          ? 0
          : -1_000_000
      : 0;
    const staticAfter = evaluateIndependent(applied.state, player);
    const ttBonus = moveKey(move) === ttBestMoveKey ? 100_000_000 : 0;
    return {
      move,
      orderingScore: ttBonus + terminalBonus + immediateGain * 1_000 + staticAfter,
    };
  });

  candidates.sort((left, right) => {
    if (right.orderingScore !== left.orderingScore) return right.orderingScore - left.orderingScore;
    return compareMove(left.move, right.move);
  });
  return candidates.map((candidate) => candidate.move);
}

function scoreMoveFallback(state: GameState, move: PlayerMove): number {
  const applied = applyMove(state, move);
  if (!applied.ok) return -INF;
  return -evaluateIndependent(applied.state, otherPlayer(move.player));
}

function consumeNode(context: SearchContext): void {
  if (performance.now() >= context.deadline) throw new BudgetExhausted("time");
  if (context.nodeCount >= context.nodeBudget) throw new BudgetExhausted("node");
  context.nodeCount += 1;
}

function sideStones(state: GameState, player: PlayerId): number {
  return state.pits
    .filter((pit) => pit.owner === player && pit.kind === "dan")
    .reduce((sum, pit) => sum + pit.stones, 0);
}

function refillReserve(state: GameState, player: PlayerId): number {
  return Math.min(5, state.scores[player]);
}

function moveKey(move: PlayerMove): string {
  return `${move.pit}:${move.dir}`;
}

function compareMove(left: PlayerMove, right: PlayerMove | null): number {
  if (right === null) return -1;
  return moveKey(left).localeCompare(moveKey(right));
}
