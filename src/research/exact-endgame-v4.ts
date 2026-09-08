import { applyMove, getLegalMoves, otherPlayer } from "../engine.js";
import type { GameState, PlayerId, PlayerMove } from "../types.js";

export type ExactEndgameStatus =
  | "solved"
  | "outside-material-limit"
  | "budget-exhausted"
  | "cycle-unresolved";

export type ExactEndgameOptions = {
  /** Maximum weighted value still on the board at the root. Quan stones count as 10. */
  maxRootBoardValue?: number;
  nodeBudget?: number;
  timeBudgetMs?: number;
};

export type ExactEndgameDiagnostics = {
  nodeCount: number;
  memoHits: number;
  memoEntries: number;
  cycleEdges: number;
  maxDepth: number;
  rootBoardValue: number;
  budgetReason: "node" | "time" | null;
};

export type ExactEndgameResult = {
  status: ExactEndgameStatus;
  solved: boolean;
  /** Exact final score margin from the root player-to-move perspective when solved. */
  value: number | null;
  outcome: "win" | "draw" | "loss" | null;
  bestMove: PlayerMove | null;
  principalVariation: PlayerMove[];
  diagnostics: ExactEndgameDiagnostics;
};

type SolvedNode = {
  solved: true;
  value: number;
  bestMove: PlayerMove | null;
  pv: PlayerMove[];
};

type UnresolvedNode = {
  solved: false;
  reason: "budget-exhausted" | "cycle-unresolved";
};

type NodeResult = SolvedNode | UnresolvedNode;

type ExactContext = {
  nodeBudget: number;
  deadline: number;
  nodeCount: number;
  memoHits: number;
  cycleEdges: number;
  maxDepth: number;
  budgetReason: "node" | "time" | null;
  memo: Map<string, SolvedNode>;
  active: Set<string>;
};

class ExactBudgetExhausted extends Error {
  constructor(readonly reason: "node" | "time") {
    super(reason);
  }
}

/**
 * Conservative exact solver for reduced Ô Ăn Quan positions.
 *
 * There is intentionally no heuristic leaf evaluation. A root is marked
 * solved only when every branch needed for the exact minimax value is solved
 * to a real terminal state. Current production rules do not define repetition
 * as a draw, so a repeated strategic state is reported as unresolved rather
 * than silently assigned draw value.
 */
export function solveExactEndgame(
  state: GameState,
  options: ExactEndgameOptions = {},
): ExactEndgameResult {
  const maxRootBoardValue = options.maxRootBoardValue ?? 18;
  const nodeBudget = options.nodeBudget ?? 2_000_000;
  const timeBudgetMs = options.timeBudgetMs ?? 10_000;
  const rootBoardValue = boardValue(state);

  const emptyDiagnostics = (): ExactEndgameDiagnostics => ({
    nodeCount: 0,
    memoHits: 0,
    memoEntries: 0,
    cycleEdges: 0,
    maxDepth: 0,
    rootBoardValue,
    budgetReason: null,
  });

  if (state.status !== "finished" && rootBoardValue > maxRootBoardValue) {
    return {
      status: "outside-material-limit",
      solved: false,
      value: null,
      outcome: null,
      bestMove: null,
      principalVariation: [],
      diagnostics: emptyDiagnostics(),
    };
  }

  const context: ExactContext = {
    nodeBudget,
    deadline: performance.now() + timeBudgetMs,
    nodeCount: 0,
    memoHits: 0,
    cycleEdges: 0,
    maxDepth: 0,
    budgetReason: null,
    memo: new Map<string, SolvedNode>(),
    active: new Set<string>(),
  };

  let node: NodeResult;
  try {
    node = solveNode(state, state.currentPlayer, 0, context);
  } catch (error) {
    if (!(error instanceof ExactBudgetExhausted)) throw error;
    context.budgetReason = error.reason;
    node = { solved: false, reason: "budget-exhausted" };
  }

  const diagnostics: ExactEndgameDiagnostics = {
    nodeCount: context.nodeCount,
    memoHits: context.memoHits,
    memoEntries: context.memo.size,
    cycleEdges: context.cycleEdges,
    maxDepth: context.maxDepth,
    rootBoardValue,
    budgetReason: context.budgetReason,
  };

  if (!node.solved) {
    return {
      status: node.reason,
      solved: false,
      value: null,
      outcome: null,
      bestMove: null,
      principalVariation: [],
      diagnostics,
    };
  }

  return {
    status: "solved",
    solved: true,
    value: node.value,
    outcome: node.value > 0 ? "win" : node.value < 0 ? "loss" : "draw",
    bestMove: node.bestMove,
    principalVariation: node.pv,
    diagnostics,
  };
}

function solveNode(
  state: GameState,
  playerToMove: PlayerId,
  depth: number,
  context: ExactContext,
): NodeResult {
  consumeNode(context);
  context.maxDepth = Math.max(context.maxDepth, depth);

  if (state.status === "finished") {
    const value = finalMargin(state, playerToMove);
    return { solved: true, value, bestMove: null, pv: [] };
  }

  if (state.currentPlayer !== playerToMove) {
    throw new Error(`Exact solver player mismatch: state=${state.currentPlayer}, expected=${playerToMove}`);
  }

  const key = exactStrategicStateKey(state, playerToMove);
  const cached = context.memo.get(key);
  if (cached) {
    context.memoHits += 1;
    return cached;
  }

  if (context.active.has(key)) {
    context.cycleEdges += 1;
    return { solved: false, reason: "cycle-unresolved" };
  }

  context.active.add(key);
  try {
    const legal = orderExactMoves(state, playerToMove);
    if (legal.length === 0) {
      // A non-terminal state with no legal move should normally be resolved by
      // engine refill/no-refill logic. Do not invent a game-theoretic value.
      return { solved: false, reason: "cycle-unresolved" };
    }

    let bestValue = Number.NEGATIVE_INFINITY;
    let bestMove: PlayerMove | null = null;
    let bestChildPv: PlayerMove[] = [];

    for (const move of legal) {
      const applied = applyMove(state, move);
      if (!applied.ok) continue;
      const child = solveNode(applied.state, otherPlayer(playerToMove), depth + 1, context);
      if (!child.solved) return child;

      const candidateValue = -child.value;
      if (
        candidateValue > bestValue
        || (candidateValue === bestValue && compareMove(move, bestMove) < 0)
      ) {
        bestValue = candidateValue;
        bestMove = move;
        bestChildPv = child.pv;
      }
    }

    if (bestMove === null || !Number.isFinite(bestValue)) {
      return { solved: false, reason: "cycle-unresolved" };
    }

    const solved: SolvedNode = {
      solved: true,
      value: bestValue,
      bestMove,
      pv: [bestMove, ...bestChildPv],
    };
    context.memo.set(key, solved);
    return solved;
  } finally {
    context.active.delete(key);
  }
}

function orderExactMoves(state: GameState, player: PlayerId): PlayerMove[] {
  const moves = getLegalMoves(state, player).map((move) => {
    const applied = applyMove(state, move);
    if (!applied.ok) return { move, score: Number.NEGATIVE_INFINITY };
    const captureGain = applied.state.scores[player] - state.scores[player];
    const terminal = applied.state.status === "finished";
    const terminalMargin = terminal ? finalMargin(applied.state, player) : 0;
    return {
      move,
      score: (terminal ? 1_000_000 : 0) + terminalMargin * 10_000 + captureGain * 100,
    };
  });

  moves.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return compareMove(left.move, right.move);
  });
  return moves.map((entry) => entry.move);
}

/**
 * Canonical key for rule-relevant strategic state.
 *
 * `recentMoves` and `skipCounts` are excluded because the current engine does
 * not consult them when deciding legal transitions. Full `moveNumber` is also
 * excluded; only the first-move phase is retained because no_first_quan_v1
 * checks `moveNumber === 0`.
 */
export function exactStrategicStateKey(state: GameState, playerToMove: PlayerId = state.currentPlayer): string {
  const firstMovePhase = state.moveNumber === 0 ? 1 : 0;
  const payload = {
    ruleset: state.ruleset.canonicalRulesetId,
    pits: state.pits.map((pit) => [pit.id, pit.stones, pit.quanStones]),
    currentPlayer: state.currentPlayer,
    playerToMove,
    scores: [state.scores.P0, state.scores.P1],
    status: state.status,
    winner: state.winner,
    firstMovePhase,
  };
  return JSON.stringify(payload);
}

export function boardValue(state: GameState): number {
  return state.pits.reduce((sum, pit) => sum + pit.stones + pit.quanStones * 10, 0);
}

export function totalGameValue(state: GameState): number {
  return state.scores.P0 + state.scores.P1 + boardValue(state);
}

function finalMargin(state: GameState, perspective: PlayerId): number {
  const opponent = otherPlayer(perspective);
  return state.scores[perspective] - state.scores[opponent];
}

function consumeNode(context: ExactContext): void {
  if (performance.now() >= context.deadline) throw new ExactBudgetExhausted("time");
  if (context.nodeCount >= context.nodeBudget) throw new ExactBudgetExhausted("node");
  context.nodeCount += 1;
}

function moveKey(move: PlayerMove): string {
  return `${move.pit}:${move.dir}`;
}

function compareMove(left: PlayerMove, right: PlayerMove | null): number {
  if (right === null) return -1;
  return moveKey(left).localeCompare(moveKey(right));
}
