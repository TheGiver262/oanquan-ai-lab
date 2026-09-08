import { applyMove, getLegalMoves, otherPlayer } from "../engine.js";
import type { PlayerId, PlayerMove } from "../types.js";
import { evaluateV3, type V3EvaluationFamily } from "./negamax-pvs-v3.js";
import {
  applyPolicyMove,
  validatePolicy,
  type PolicyState,
  type RepetitionPolicy,
} from "./repetition-policy-v5.js";

const INF = 1_000_000_000;

export type PolicyAwarePvsV5Options = {
  maxDepth?: number;
  nodeBudget?: number;
  timeBudgetMs?: number;
  aspirationWindow?: number;
  usePvs?: boolean;
  evaluationFamily?: V3EvaluationFamily;
};

export type PolicyAwarePvsV5Diagnostics = {
  nodeCount: number;
  completedDepth: number;
  cutoffs: number;
  aspirationResearches: number;
  policyDrawLeaves: number;
  naturalTerminalLeaves: number;
  budgetReason: "node" | "time" | null;
};

export type PolicyAwarePvsV5Result = {
  move: PlayerMove | null;
  score: number;
  principalVariation: PlayerMove[];
  policy: RepetitionPolicy;
  evaluationFamily: V3EvaluationFamily;
  diagnostics: PolicyAwarePvsV5Diagnostics;
};

type SearchContext = {
  policy: RepetitionPolicy;
  nodeBudget: number;
  deadline: number;
  usePvs: boolean;
  evaluationFamily: V3EvaluationFamily;
  nodeCount: number;
  cutoffs: number;
  aspirationResearches: number;
  policyDrawLeaves: number;
  naturalTerminalLeaves: number;
  budgetReason: "node" | "time" | null;
};

type NodeResult = { score: number; pv: PlayerMove[] };

class BudgetExhausted extends Error {
  constructor(readonly reason: "node" | "time") {
    super(reason);
  }
}

/**
 * Bounded PVS that treats the research repetition policy as part of the game.
 *
 * There is deliberately no transposition table for repeat-draw policies. A
 * board position does not uniquely determine its value when earlier occurrence
 * counts differ, so a board-only TT would be unsound. The PolicyState supplied
 * by the caller must contain the real game history accumulated so far.
 */
export function searchPolicyAwarePvsV5(
  root: PolicyState,
  policy: RepetitionPolicy,
  options: PolicyAwarePvsV5Options = {},
): PolicyAwarePvsV5Result {
  validatePolicy(policy);
  const maxDepth = options.maxDepth ?? 12;
  const nodeBudget = options.nodeBudget ?? 80_000;
  const timeBudgetMs = options.timeBudgetMs ?? 800;
  const aspirationWindow = options.aspirationWindow ?? 250;
  const usePvs = options.usePvs ?? true;
  const evaluationFamily = options.evaluationFamily ?? "strategic";

  if (root.adjudication !== null) {
    return emptyResult(root, policy, evaluationFamily, 0, true);
  }

  const legal = getLegalMoves(root.game);
  if (root.game.status === "finished" || legal.length === 0) {
    return emptyResult(
      root,
      policy,
      evaluationFamily,
      evaluateV3(root.game, root.game.currentPlayer, evaluationFamily),
      false,
    );
  }

  const context: SearchContext = {
    policy,
    nodeBudget,
    deadline: performance.now() + timeBudgetMs,
    usePvs,
    evaluationFamily,
    nodeCount: 0,
    cutoffs: 0,
    aspirationResearches: 0,
    policyDrawLeaves: 0,
    naturalTerminalLeaves: 0,
    budgetReason: null,
  };

  let bestMove = legal[0] ?? null;
  let bestScore = bestMove ? scoreMoveFallback(root, bestMove, policy, evaluationFamily) : 0;
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

      let iteration = negamaxPolicy(root, root.game.currentPlayer, depth, alpha, beta, context);
      if (previousScore !== null && (iteration.score <= alpha || iteration.score >= beta)) {
        context.aspirationResearches += 1;
        iteration = negamaxPolicy(root, root.game.currentPlayer, depth, -INF, INF, context);
      }

      const move = iteration.pv[0] ?? null;
      if (move) {
        bestMove = move;
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
    policy,
    evaluationFamily,
    diagnostics: {
      nodeCount: context.nodeCount,
      completedDepth,
      cutoffs: context.cutoffs,
      aspirationResearches: context.aspirationResearches,
      policyDrawLeaves: context.policyDrawLeaves,
      naturalTerminalLeaves: context.naturalTerminalLeaves,
      budgetReason: context.budgetReason,
    },
  };
}

function negamaxPolicy(
  state: PolicyState,
  playerToMove: PlayerId,
  depth: number,
  alphaInput: number,
  betaInput: number,
  context: SearchContext,
): NodeResult {
  consumeNode(context);

  if (state.adjudication !== null) {
    context.policyDrawLeaves += 1;
    return { score: 0, pv: [] };
  }

  if (state.game.status === "finished") {
    context.naturalTerminalLeaves += 1;
    return { score: evaluateV3(state.game, playerToMove, context.evaluationFamily), pv: [] };
  }

  if (depth === 0) {
    return { score: evaluateV3(state.game, playerToMove, context.evaluationFamily), pv: [] };
  }

  if (state.game.currentPlayer !== playerToMove) {
    throw new Error(`Policy PVS player mismatch: state=${state.game.currentPlayer}, expected=${playerToMove}`);
  }

  let alpha = alphaInput;
  const beta = betaInput;
  const ordered = orderMoves(state, playerToMove, context.evaluationFamily);
  if (ordered.length === 0) {
    return { score: evaluateV3(state.game, playerToMove, context.evaluationFamily), pv: [] };
  }

  let bestScore = -INF;
  let bestMove: PlayerMove | null = null;
  let bestChildPv: PlayerMove[] = [];

  for (let index = 0; index < ordered.length; index += 1) {
    const move = ordered[index];
    if (!move) continue;
    const applied = applyPolicyMove(state, move, context.policy);
    if (!applied.ok) continue;
    const childPlayer = otherPlayer(playerToMove);

    let child: NodeResult;
    if (!context.usePvs || index === 0) {
      child = negamaxPolicy(applied.state, childPlayer, depth - 1, -beta, -alpha, context);
      child = { score: -child.score, pv: child.pv };
    } else {
      child = negamaxPolicy(applied.state, childPlayer, depth - 1, -alpha - 1, -alpha, context);
      child = { score: -child.score, pv: child.pv };
      if (child.score > alpha && child.score < beta) {
        child = negamaxPolicy(applied.state, childPlayer, depth - 1, -beta, -alpha, context);
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

  return { score: bestScore, pv: bestMove ? [bestMove, ...bestChildPv] : [] };
}

function orderMoves(
  state: PolicyState,
  player: PlayerId,
  family: V3EvaluationFamily,
): PlayerMove[] {
  const candidates = getLegalMoves(state.game, player).map((move) => {
    const applied = applyMove(state.game, move);
    if (!applied.ok) return { move, orderingScore: -INF };
    const immediateGain = applied.state.scores[player] - state.game.scores[player];
    const terminalBonus = applied.state.status === "finished"
      ? applied.state.winner === player
        ? 1_000_000
        : applied.state.winner === null
          ? 0
          : -1_000_000
      : 0;
    const staticAfter = evaluateV3(applied.state, player, family);
    return { move, orderingScore: terminalBonus + immediateGain * 1_000 + staticAfter };
  });

  candidates.sort((left, right) => {
    if (right.orderingScore !== left.orderingScore) return right.orderingScore - left.orderingScore;
    return compareMove(left.move, right.move);
  });
  return candidates.map((candidate) => candidate.move);
}

function scoreMoveFallback(
  state: PolicyState,
  move: PlayerMove,
  policy: RepetitionPolicy,
  family: V3EvaluationFamily,
): number {
  const applied = applyPolicyMove(state, move, policy);
  if (!applied.ok) return -INF;
  if (applied.state.adjudication !== null) return 0;
  return -evaluateV3(applied.state.game, otherPlayer(move.player), family);
}

function emptyResult(
  state: PolicyState,
  policy: RepetitionPolicy,
  evaluationFamily: V3EvaluationFamily,
  score: number,
  policyDraw: boolean,
): PolicyAwarePvsV5Result {
  return {
    move: null,
    score,
    principalVariation: [],
    policy,
    evaluationFamily,
    diagnostics: {
      nodeCount: 0,
      completedDepth: 0,
      cutoffs: 0,
      aspirationResearches: 0,
      policyDrawLeaves: policyDraw ? 1 : 0,
      naturalTerminalLeaves: !policyDraw && state.game.status === "finished" ? 1 : 0,
      budgetReason: null,
    },
  };
}

function consumeNode(context: SearchContext): void {
  if (performance.now() >= context.deadline) throw new BudgetExhausted("time");
  if (context.nodeCount >= context.nodeBudget) throw new BudgetExhausted("node");
  context.nodeCount += 1;
}

function moveKey(move: PlayerMove): string {
  return `${move.pit}:${move.dir}`;
}

function compareMove(left: PlayerMove, right: PlayerMove | null): number {
  if (right === null) return -1;
  return moveKey(left).localeCompare(moveKey(right));
}
