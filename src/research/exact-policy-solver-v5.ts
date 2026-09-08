import { getLegalMoves, otherPlayer } from "../engine.js";
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

class BudgetExhausted extends Error {
  constructor(readonly reason: "node" | "time") {
    super(reason);
  }
}

/**
 * Exact reduced-state solver under an explicit research adjudication policy.
 *
 * Unlike V4's policy-free solver, a repeat-draw or max-ply policy can make a
 * loopy canonical game finite because the adjudication context is included in
 * the search state. `none` preserves V4 semantics and reports unresolved when
 * the same policy state is reached recursively.
 */
export function solveExactWithPolicy(
  game: GameState,
  policy: RepetitionPolicy,
  options: ExactPolicySolverOptions = {},
): ExactPolicyResult {
  validatePolicy(policy);
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
    budgetReason: null,
  });

  if (game.status !== "finished" && rootBoardValue > maxRootBoardValue) {
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

  const rootState = createPolicyState(game);
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
    node = solveNode(rootState, 0, context);
  } catch (error) {
    if (!(error instanceof BudgetExhausted)) throw error;
    context.budgetReason = error.reason;
    node = { solved: false, reason: "budget-exhausted" };
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

function solveNode(state: PolicyState, depth: number, context: Context): NodeResult {
  consumeNode(context);
  context.maxDepth = Math.max(context.maxDepth, depth);

  if (state.adjudication !== null) {
    context.policyDrawLeaves += 1;
    return { solved: true, value: 0, bestMove: null, pv: [] };
  }

  if (state.game.status === "finished") {
    context.naturalTerminalLeaves += 1;
    return {
      solved: true,
      value: finalMargin(state.game, context.rootPlayer),
      bestMove: null,
      pv: [],
    };
  }

  if (isPolicyTerminal(state)) {
    throw new Error("Policy terminal state reached without adjudication or canonical finish");
  }

  const key = policyStateKey(state, context.policy);
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
    const legal = getLegalMoves(state.game);
    if (legal.length === 0) return { solved: false, reason: "cycle-unresolved" };

    const maximizing = state.game.currentPlayer === context.rootPlayer;
    let bestValue = maximizing ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    let bestMove: PlayerMove | null = null;
    let bestPv: PlayerMove[] = [];

    for (const move of orderMoves(state.game, legal)) {
      const applied = applyPolicyMove(state, move, context.policy);
      if (!applied.ok) continue;
      const child = solveNode(applied.state, depth + 1, context);
      if (!child.solved) return child;

      const better = maximizing ? child.value > bestValue : child.value < bestValue;
      if (better || (child.value === bestValue && compareMove(move, bestMove) < 0)) {
        bestValue = child.value;
        bestMove = move;
        bestPv = child.pv;
      }
    }

    if (bestMove === null || !Number.isFinite(bestValue)) {
      return { solved: false, reason: "cycle-unresolved" };
    }

    const solved: SolvedNode = {
      solved: true,
      value: normalizeZero(bestValue),
      bestMove,
      pv: [bestMove, ...bestPv],
    };
    context.memo.set(key, solved);
    return solved;
  } finally {
    context.active.delete(key);
  }
}

function orderMoves(game: GameState, legal: PlayerMove[]): PlayerMove[] {
  const player = game.currentPlayer;
  return legal
    .map((move) => {
      const before = game.scores[player];
      const probe = applyPolicyMove(createPolicyState(game), move, { kind: "none" });
      const gain = probe.ok ? probe.state.game.scores[player] - before : Number.NEGATIVE_INFINITY;
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
