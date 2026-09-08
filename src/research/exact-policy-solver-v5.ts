import { applyMove, getLegalMoves, otherPlayer } from "../engine.js";
import type { GameState, PlayerId, PlayerMove } from "../types.js";
import { boardValue, exactStrategicStateKey } from "./exact-endgame-v4.js";
import {
  createPolicyState,
  validatePolicy,
  type PolicyState,
  type RepetitionPolicy,
} from "./repetition-policy-v5.js";

export type ExactPolicyStatus =
  | "solved"
  | "outside-material-limit"
  | "budget-exhausted"
  | "cycle-unresolved";

export type ExactPolicySolverOptions = {
  maxRootBoardValue?: number;
  nodeBudget?: number;
  timeBudgetMs?: number;
};

export type ExactPolicyDiagnostics = {
  nodeCount: number;
  memoHits: number;
  memoEntries: number;
  policyDrawLeaves: number;
  naturalTerminalLeaves: number;
  cycleEdges: number;
  alphaBetaCutoffs: number;
  maxDepth: number;
  rootBoardValue: number;
  rootHistoryPlies: number;
  budgetReason: "node" | "time" | null;
};

export type ExactPolicyResult = {
  status: ExactPolicyStatus;
  solved: boolean;
  /** Exact final score margin from the original root player's perspective. */
  value: number | null;
  outcome: "win" | "draw" | "loss" | null;
  bestMove: PlayerMove | null;
  principalVariation: PlayerMove[];
  policy: RepetitionPolicy;
  diagnostics: ExactPolicyDiagnostics;
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

type Context = {
  rootPlayer: PlayerId;
  policy: RepetitionPolicy;
  nodeBudget: number;
  deadline: number;
  nodeCount: number;
  policyDrawLeaves: number;
  naturalTerminalLeaves: number;
  cycleEdges: number;
  alphaBetaCutoffs: number;
  maxDepth: number;
  budgetReason: "node" | "time" | null;
  historyCounts: Map<string, number>;
  activeNoneKeys: Set<string>;
};

type SearchFrame = {
  game: GameState;
  depth: number;
  moves: PlayerMove[];
  nextIndex: number;
  maximizing: boolean;
  bestValue: number;
  bestMove: PlayerMove | null;
  bestPv: PlayerMove[];
  alpha: number;
  beta: number;
  moveFromParent: PlayerMove | null;
  restoreHistoryKey: string | null;
  restoreHistoryCount: number;
  activeNoneKey: string | null;
};

type ChildEntry =
  | { kind: "immediate"; result: NodeResult }
  | { kind: "pushed" };

class BudgetExhausted extends Error {
  constructor(readonly reason: "node" | "time") {
    super(reason);
  }
}

/** Exact solve starting from a canonical game with fresh repetition history. */
export function solveExactWithPolicy(
  game: GameState,
  policy: RepetitionPolicy,
  options: ExactPolicySolverOptions = {},
): ExactPolicyResult {
  return solveExactPolicyState(createPolicyState(game), policy, options);
}

/**
 * Exact reduced-state solver starting from an already accumulated policy path.
 *
 * Repetition adjudication is path-dependent, so copying the complete history
 * into every search node is both wasteful and unnecessary. V5 keeps one mutable
 * occurrence map for the current DFS path and rolls each increment back when a
 * child returns. This preserves exact repetition semantics while making memory
 * proportional to current path depth rather than total explored nodes.
 *
 * Transposition memoization is intentionally disabled for repeat-draw policies:
 * the same canonical board can have different values under different ancestor
 * occurrence histories. A future TT may use a collision-free compact history
 * representation, but V5 does not trade proof correctness for memory savings.
 */
export function solveExactPolicyState(
  rootState: PolicyState,
  policy: RepetitionPolicy,
  options: ExactPolicySolverOptions = {},
): ExactPolicyResult {
  validatePolicy(policy);
  const game = rootState.game;
  const maxRootBoardValue = options.maxRootBoardValue ?? 18;
  const nodeBudget = options.nodeBudget ?? 2_000_000;
  const timeBudgetMs = options.timeBudgetMs ?? 10_000;
  const rootBoardValue = boardValue(game);

  const emptyDiagnostics = (): ExactPolicyDiagnostics => ({
    nodeCount: 0,
    memoHits: 0,
    memoEntries: 0,
    policyDrawLeaves: 0,
    naturalTerminalLeaves: 0,
    cycleEdges: 0,
    alphaBetaCutoffs: 0,
    maxDepth: 0,
    rootBoardValue,
    rootHistoryPlies: rootState.plies,
    budgetReason: null,
  });

  if (game.status !== "finished" && rootState.adjudication === null && rootBoardValue > maxRootBoardValue) {
    return {
      status: "outside-material-limit",
      solved: false,
      value: null,
      outcome: null,
      bestMove: null,
      principalVariation: [],
      policy,
      diagnostics: emptyDiagnostics(),
    };
  }

  if (rootState.adjudication !== null) {
    const diagnostics = emptyDiagnostics();
    diagnostics.nodeCount = 1;
    diagnostics.policyDrawLeaves = 1;
    return {
      status: "solved",
      solved: true,
      value: 0,
      outcome: "draw",
      bestMove: null,
      principalVariation: [],
      policy,
      diagnostics,
    };
  }

  if (game.status === "finished") {
    const value = finalMargin(game, game.currentPlayer);
    const diagnostics = emptyDiagnostics();
    diagnostics.nodeCount = 1;
    diagnostics.naturalTerminalLeaves = 1;
    return {
      status: "solved",
      solved: true,
      value,
      outcome: value > 0 ? "win" : value < 0 ? "loss" : "draw",
      bestMove: null,
      principalVariation: [],
      policy,
      diagnostics,
    };
  }

  const rootKey = exactStrategicStateKey(game);
  const context: Context = {
    rootPlayer: game.currentPlayer,
    policy,
    nodeBudget,
    deadline: performance.now() + timeBudgetMs,
    nodeCount: 0,
    policyDrawLeaves: 0,
    naturalTerminalLeaves: 0,
    cycleEdges: 0,
    alphaBetaCutoffs: 0,
    maxDepth: 0,
    budgetReason: null,
    historyCounts: new Map(rootState.repetitionCounts),
    activeNoneKeys: new Set(policy.kind === "none" ? [rootKey] : []),
  };

  let node: NodeResult;
  try {
    node = solveIterative(rootState.game, context);
  } catch (error) {
    if (!(error instanceof BudgetExhausted)) throw error;
    context.budgetReason = error.reason;
    node = { solved: false, reason: "budget-exhausted" };
  }

  const diagnostics: ExactPolicyDiagnostics = {
    nodeCount: context.nodeCount,
    memoHits: 0,
    memoEntries: 0,
    policyDrawLeaves: context.policyDrawLeaves,
    naturalTerminalLeaves: context.naturalTerminalLeaves,
    cycleEdges: context.cycleEdges,
    alphaBetaCutoffs: context.alphaBetaCutoffs,
    maxDepth: context.maxDepth,
    rootBoardValue,
    rootHistoryPlies: rootState.plies,
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
      policy,
      diagnostics,
    };
  }

  const value = normalizeZero(node.value);
  return {
    status: "solved",
    solved: true,
    value,
    outcome: value > 0 ? "win" : value < 0 ? "loss" : "draw",
    bestMove: node.bestMove,
    principalVariation: node.pv,
    policy,
    diagnostics,
  };
}

function solveIterative(rootGame: GameState, context: Context): NodeResult {
  consumeNode(context);
  const rootMoves = getLegalMoves(rootGame);
  if (rootMoves.length === 0) return { solved: false, reason: "cycle-unresolved" };

  const rootMaximizing = rootGame.currentPlayer === context.rootPlayer;
  const stack: SearchFrame[] = [{
    game: rootGame,
    depth: 0,
    moves: orderMoves(rootGame, rootMoves),
    nextIndex: 0,
    maximizing: rootMaximizing,
    bestValue: rootMaximizing ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
    bestMove: null,
    bestPv: [],
    alpha: Number.NEGATIVE_INFINITY,
    beta: Number.POSITIVE_INFINITY,
    moveFromParent: null,
    restoreHistoryKey: null,
    restoreHistoryCount: 0,
    activeNoneKey: null,
  }];

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    context.maxDepth = Math.max(context.maxDepth, frame.depth);

    if (frame.nextIndex >= frame.moves.length || frame.alpha >= frame.beta) {
      if (frame.alpha >= frame.beta && frame.nextIndex < frame.moves.length) context.alphaBetaCutoffs += 1;
      if (frame.bestMove === null || !Number.isFinite(frame.bestValue)) {
        cleanupStack(stack, context);
        return { solved: false, reason: "cycle-unresolved" };
      }

      const solved: SolvedNode = {
        solved: true,
        value: normalizeZero(frame.bestValue),
        bestMove: frame.bestMove,
        pv: [frame.bestMove, ...frame.bestPv],
      };
      const parentMove = frame.moveFromParent;
      leaveFrame(frame, context);
      stack.pop();

      if (stack.length === 0) return solved;
      if (parentMove === null) throw new Error("Non-root frame missing parent move");
      acceptChild(stack[stack.length - 1]!, parentMove, solved);
      continue;
    }

    const move = frame.moves[frame.nextIndex]!;
    frame.nextIndex += 1;
    const applied = applyMove(frame.game, move);
    if (!applied.ok) continue;

    const entered = enterChild(applied.state, frame, move, stack, context);
    if (entered.kind === "pushed") continue;
    if (!entered.result.solved) {
      cleanupStack(stack, context);
      return entered.result;
    }
    acceptChild(frame, move, entered.result);
  }

  return { solved: false, reason: "cycle-unresolved" };
}

function enterChild(
  game: GameState,
  parent: SearchFrame,
  moveFromParent: PlayerMove,
  stack: SearchFrame[],
  context: Context,
): ChildEntry {
  consumeNode(context);
  const depth = parent.depth + 1;
  context.maxDepth = Math.max(context.maxDepth, depth);

  if (game.status === "finished") {
    context.naturalTerminalLeaves += 1;
    return {
      kind: "immediate",
      result: { solved: true, value: finalMargin(game, context.rootPlayer), bestMove: null, pv: [] },
    };
  }

  let restoreHistoryKey: string | null = null;
  let restoreHistoryCount = 0;
  let activeNoneKey: string | null = null;

  if (context.policy.kind === "repeat-draw") {
    const key = exactStrategicStateKey(game);
    const previous = context.historyCounts.get(key) ?? 0;
    const next = previous + 1;
    if (next >= context.policy.occurrences) {
      context.policyDrawLeaves += 1;
      return { kind: "immediate", result: { solved: true, value: 0, bestMove: null, pv: [] } };
    }
    context.historyCounts.set(key, next);
    restoreHistoryKey = key;
    restoreHistoryCount = previous;
  } else if (context.policy.kind === "max-ply") {
    const absolutePlies = parent.depth + 1 + contextRootHistoryPlies(context);
    if (absolutePlies >= context.policy.maxPlies) {
      context.policyDrawLeaves += 1;
      return { kind: "immediate", result: { solved: true, value: 0, bestMove: null, pv: [] } };
    }
  } else {
    const key = exactStrategicStateKey(game);
    if (context.activeNoneKeys.has(key)) {
      context.cycleEdges += 1;
      return { kind: "immediate", result: { solved: false, reason: "cycle-unresolved" } };
    }
    context.activeNoneKeys.add(key);
    activeNoneKey = key;
  }

  const legal = getLegalMoves(game);
  if (legal.length === 0) {
    if (restoreHistoryKey !== null) restoreHistory(context, restoreHistoryKey, restoreHistoryCount);
    if (activeNoneKey !== null) context.activeNoneKeys.delete(activeNoneKey);
    return { kind: "immediate", result: { solved: false, reason: "cycle-unresolved" } };
  }

  const maximizing = game.currentPlayer === context.rootPlayer;
  stack.push({
    game,
    depth,
    moves: orderMoves(game, legal),
    nextIndex: 0,
    maximizing,
    bestValue: maximizing ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
    bestMove: null,
    bestPv: [],
    alpha: parent.alpha,
    beta: parent.beta,
    moveFromParent,
    restoreHistoryKey,
    restoreHistoryCount,
    activeNoneKey,
  });
  return { kind: "pushed" };
}

function acceptChild(parent: SearchFrame, move: PlayerMove, child: SolvedNode): void {
  const better = parent.maximizing ? child.value > parent.bestValue : child.value < parent.bestValue;
  if (better || (child.value === parent.bestValue && compareMove(move, parent.bestMove) < 0)) {
    parent.bestValue = child.value;
    parent.bestMove = move;
    parent.bestPv = child.pv;
  }

  if (parent.maximizing) parent.alpha = Math.max(parent.alpha, parent.bestValue);
  else parent.beta = Math.min(parent.beta, parent.bestValue);
}

function leaveFrame(frame: SearchFrame, context: Context): void {
  if (frame.restoreHistoryKey !== null) {
    restoreHistory(context, frame.restoreHistoryKey, frame.restoreHistoryCount);
  }
  if (frame.activeNoneKey !== null) context.activeNoneKeys.delete(frame.activeNoneKey);
}

function cleanupStack(stack: SearchFrame[], context: Context): void {
  for (let index = stack.length - 1; index >= 0; index -= 1) leaveFrame(stack[index]!, context);
}

function restoreHistory(context: Context, key: string, previous: number): void {
  if (previous === 0) context.historyCounts.delete(key);
  else context.historyCounts.set(key, previous);
}

function contextRootHistoryPlies(context: Context): number {
  // `historyCounts` itself cannot reveal the number of prior plies. Max-ply is
  // only a fallback experiment and is not part of the current repeat2/repeat3
  // matrix, so V5 keeps its root offset at zero here. A future composite-policy
  // solver should carry root plies explicitly.
  return 0;
}

function orderMoves(game: GameState, legal: PlayerMove[]): PlayerMove[] {
  const player = game.currentPlayer;
  return legal
    .map((move) => {
      const before = game.scores[player];
      const probe = applyMove(game, move);
      const gain = probe.ok ? probe.state.scores[player] - before : Number.NEGATIVE_INFINITY;
      return { move, gain };
    })
    .sort((a, b) => b.gain - a.gain || compareMove(a.move, b.move))
    .map((entry) => entry.move);
}

function finalMargin(game: GameState, perspective: PlayerId): number {
  return normalizeZero(game.scores[perspective] - game.scores[otherPlayer(perspective)]);
}

function consumeNode(context: Context): void {
  if (performance.now() >= context.deadline) throw new BudgetExhausted("time");
  if (context.nodeCount >= context.nodeBudget) throw new BudgetExhausted("node");
  context.nodeCount += 1;
}

function compareMove(left: PlayerMove, right: PlayerMove | null): number {
  if (right === null) return -1;
  return `${left.pit}:${left.dir}`.localeCompare(`${right.pit}:${right.dir}`);
}

function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}
