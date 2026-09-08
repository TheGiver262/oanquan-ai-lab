import { applyMove, getLegalMoves, otherPlayer } from "../engine.js";
import type { GameState, PlayerId, PlayerMove } from "../types.js";
import { boardValue } from "./exact-endgame-v4.js";
import {
  applyPolicyMove,
  createPolicyState,
  isPolicyTerminal,
  policyStateKey,
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
  memoHits: number;
  policyDrawLeaves: number;
  naturalTerminalLeaves: number;
  cycleEdges: number;
  maxDepth: number;
  budgetReason: "node" | "time" | null;
  memo: Map<string, SolvedNode>;
  active: Set<string>;
};

type SearchFrame = {
  state: PolicyState;
  depth: number;
  key: string;
  moves: PlayerMove[];
  nextIndex: number;
  maximizing: boolean;
  bestValue: number;
  bestMove: PlayerMove | null;
  bestPv: PlayerMove[];
  moveFromParent: PlayerMove | null;
};

type EnterResult =
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
 * This is required for V3-PV experiments: repetition counts before the selected
 * deep state materially affect whether later returns are adjudicated.
 *
 * V5 uses an explicit DFS stack rather than JavaScript recursion. Repetition
 * policies can create very long finite simple paths; exhausting the JS call
 * stack is a runtime artifact and must never be mistaken for a game result.
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

  const context: Context = {
    rootPlayer: game.currentPlayer,
    policy,
    nodeBudget,
    deadline: performance.now() + timeBudgetMs,
    nodeCount: 0,
    memoHits: 0,
    policyDrawLeaves: 0,
    naturalTerminalLeaves: 0,
    cycleEdges: 0,
    maxDepth: 0,
    budgetReason: null,
    memo: new Map(),
    active: new Set(),
  };

  let node: NodeResult;
  try {
    node = solveNodeIterative(rootState, context);
  } catch (error) {
    if (!(error instanceof BudgetExhausted)) throw error;
    context.budgetReason = error.reason;
    node = { solved: false, reason: "budget-exhausted" };
  } finally {
    context.active.clear();
  }

  const diagnostics: ExactPolicyDiagnostics = {
    nodeCount: context.nodeCount,
    memoHits: context.memoHits,
    memoEntries: context.memo.size,
    policyDrawLeaves: context.policyDrawLeaves,
    naturalTerminalLeaves: context.naturalTerminalLeaves,
    cycleEdges: context.cycleEdges,
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

function solveNodeIterative(rootState: PolicyState, context: Context): NodeResult {
  const stack: SearchFrame[] = [];
  const rootEntry = enterNode(rootState, 0, null, stack, context);
  if (rootEntry.kind === "immediate") return rootEntry.result;

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;

    if (frame.nextIndex >= frame.moves.length) {
      if (frame.bestMove === null || !Number.isFinite(frame.bestValue)) {
        cleanupActive(stack, context);
        return { solved: false, reason: "cycle-unresolved" };
      }

      const solved: SolvedNode = {
        solved: true,
        value: normalizeZero(frame.bestValue),
        bestMove: frame.bestMove,
        pv: [frame.bestMove, ...frame.bestPv],
      };
      context.memo.set(frame.key, solved);
      context.active.delete(frame.key);
      stack.pop();

      if (stack.length === 0) return solved;
      const parent = stack[stack.length - 1]!;
      const move = frame.moveFromParent;
      if (move === null) throw new Error("Non-root frame missing parent move");
      acceptChild(parent, move, solved);
      continue;
    }

    const move = frame.moves[frame.nextIndex]!;
    frame.nextIndex += 1;
    const applied = applyPolicyMove(frame.state, move, context.policy);
    if (!applied.ok) continue;

    const entered = enterNode(applied.state, frame.depth + 1, move, stack, context);
    if (entered.kind === "pushed") continue;
    if (!entered.result.solved) {
      cleanupActive(stack, context);
      return entered.result;
    }
    acceptChild(frame, move, entered.result);
  }

  return { solved: false, reason: "cycle-unresolved" };
}

function enterNode(
  state: PolicyState,
  depth: number,
  moveFromParent: PlayerMove | null,
  stack: SearchFrame[],
  context: Context,
): EnterResult {
  consumeNode(context);
  context.maxDepth = Math.max(context.maxDepth, depth);

  if (state.adjudication !== null) {
    context.policyDrawLeaves += 1;
    return { kind: "immediate", result: { solved: true, value: 0, bestMove: null, pv: [] } };
  }

  if (state.game.status === "finished") {
    context.naturalTerminalLeaves += 1;
    return {
      kind: "immediate",
      result: {
        solved: true,
        value: finalMargin(state.game, context.rootPlayer),
        bestMove: null,
        pv: [],
      },
    };
  }

  if (isPolicyTerminal(state)) {
    throw new Error("Policy terminal state reached without adjudication or canonical finish");
  }

  const key = policyStateKey(state, context.policy);
  const cached = context.memo.get(key);
  if (cached) {
    context.memoHits += 1;
    return { kind: "immediate", result: cached };
  }

  if (context.active.has(key)) {
    context.cycleEdges += 1;
    return { kind: "immediate", result: { solved: false, reason: "cycle-unresolved" } };
  }

  const legal = getLegalMoves(state.game);
  if (legal.length === 0) {
    return { kind: "immediate", result: { solved: false, reason: "cycle-unresolved" } };
  }

  context.active.add(key);
  const maximizing = state.game.currentPlayer === context.rootPlayer;
  stack.push({
    state,
    depth,
    key,
    moves: orderMoves(state.game, legal),
    nextIndex: 0,
    maximizing,
    bestValue: maximizing ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
    bestMove: null,
    bestPv: [],
    moveFromParent,
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
}

function cleanupActive(stack: SearchFrame[], context: Context): void {
  for (const frame of stack) context.active.delete(frame.key);
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
