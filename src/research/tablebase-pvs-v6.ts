import { applyMove, getLegalMoves, otherPlayer } from "../engine.js";
import type { PlayerId, PlayerMove } from "../types.js";
import { boardValue } from "./exact-endgame-v4.js";
import { evaluateV3, type V3EvaluationFamily } from "./negamax-pvs-v3.js";
import {
  applyPolicyMove,
  validatePolicy,
  type PolicyState,
  type RepetitionPolicy,
} from "./repetition-policy-v5.js";
import {
  lookupWdlTablebaseV6,
  type WdlTablebaseEntryV6,
  type WdlTablebaseV6,
} from "./wdl-tablebase-v6.js";

const INF = 1_000_000_000;
const WDL_TERMINAL = 10_000_000;

export type TablebasePlacementV6 = "leaf" | "all-low";

export type TablebasePvsV6Options = {
  maxDepth?: number;
  nodeBudget?: number;
  timeBudgetMs?: number;
  aspirationWindow?: number;
  usePvs?: boolean;
  evaluationFamily?: V3EvaluationFamily;
  tablebase?: WdlTablebaseV6 | null;
  tablebaseMaxBoardValue?: number;
  tablebasePlacement?: TablebasePlacementV6;
};

export type TablebasePvsV6Diagnostics = {
  nodeCount: number;
  completedDepth: number;
  cutoffs: number;
  aspirationResearches: number;
  policyDrawLeaves: number;
  naturalTerminalLeaves: number;
  heuristicLeaves: number;
  budgetReason: "node" | "time" | null;
  tablebasePlacement: TablebasePlacementV6;
  tablebaseLookups: number;
  tablebaseHits: number;
  tablebaseWins: number;
  tablebaseDraws: number;
  tablebaseLosses: number;
};

export type TablebasePvsV6Result = {
  move: PlayerMove | null;
  score: number;
  principalVariation: PlayerMove[];
  policy: RepetitionPolicy;
  evaluationFamily: V3EvaluationFamily;
  scoreSource: "tablebase" | "policy-terminal" | "natural-terminal" | "bounded-search";
  exactWdl: "win" | "draw" | "loss" | null;
  diagnostics: TablebasePvsV6Diagnostics;
};

type SearchContext = {
  policy: RepetitionPolicy;
  nodeBudget: number;
  deadline: number;
  usePvs: boolean;
  evaluationFamily: V3EvaluationFamily;
  tablebase: WdlTablebaseV6 | null;
  tablebaseMaxBoardValue: number;
  tablebasePlacement: TablebasePlacementV6;
  nodeCount: number;
  cutoffs: number;
  aspirationResearches: number;
  policyDrawLeaves: number;
  naturalTerminalLeaves: number;
  heuristicLeaves: number;
  budgetReason: "node" | "time" | null;
  tablebaseLookups: number;
  tablebaseHits: number;
  tablebaseWins: number;
  tablebaseDraws: number;
  tablebaseLosses: number;
};

type NodeResult = { score: number; pv: PlayerMove[] };

class BudgetExhausted extends Error {
  constructor(readonly reason: "node" | "time") {
    super(reason);
  }
}

/**
 * Policy-aware PVS with an offline W/D/L tablebase.
 *
 * Tablebase generation is deliberately outside this search. Runtime work is
 * limited to history-safety validation, a strategic-state key, and Map lookup;
 * no graph proof or exact DFS is run inside the move clock.
 */
export function searchTablebasePvsV6(
  root: PolicyState,
  policy: RepetitionPolicy,
  options: TablebasePvsV6Options = {},
): TablebasePvsV6Result {
  validatePolicy(policy);
  const maxDepth = options.maxDepth ?? 12;
  const nodeBudget = options.nodeBudget ?? 80_000;
  const timeBudgetMs = options.timeBudgetMs ?? 800;
  const aspirationWindow = options.aspirationWindow ?? 250;
  const usePvs = options.usePvs ?? true;
  const evaluationFamily = options.evaluationFamily ?? "strategic";

  const context: SearchContext = {
    policy,
    nodeBudget,
    deadline: performance.now() + timeBudgetMs,
    usePvs,
    evaluationFamily,
    tablebase: options.tablebase ?? null,
    tablebaseMaxBoardValue: options.tablebaseMaxBoardValue ?? 12,
    tablebasePlacement: options.tablebasePlacement ?? "leaf",
    nodeCount: 0,
    cutoffs: 0,
    aspirationResearches: 0,
    policyDrawLeaves: 0,
    naturalTerminalLeaves: 0,
    heuristicLeaves: 0,
    budgetReason: null,
    tablebaseLookups: 0,
    tablebaseHits: 0,
    tablebaseWins: 0,
    tablebaseDraws: 0,
    tablebaseLosses: 0,
  };

  if (root.adjudication !== null) {
    context.policyDrawLeaves += 1;
    return makeResult(null, 0, [], policy, evaluationFamily, "policy-terminal", "draw", context, 0);
  }

  if (root.game.status === "finished") {
    context.naturalTerminalLeaves += 1;
    const score = evaluateV3(root.game, root.game.currentPlayer, evaluationFamily);
    return makeResult(
      null,
      score,
      [],
      policy,
      evaluationFamily,
      "natural-terminal",
      score > 0 ? "win" : score < 0 ? "loss" : "draw",
      context,
      0,
    );
  }

  const legal = getLegalMoves(root.game);
  if (legal.length === 0) {
    context.heuristicLeaves += 1;
    return makeResult(
      null,
      evaluateV3(root.game, root.game.currentPlayer, evaluationFamily),
      [],
      policy,
      evaluationFamily,
      "bounded-search",
      null,
      context,
      0,
    );
  }

  const rootEntry = probeTablebase(root, context);
  if (rootEntry !== null) {
    return makeResult(
      rootEntry.proofMove,
      wdlScore(rootEntry.outcome),
      rootEntry.proofMove ? [rootEntry.proofMove] : [],
      policy,
      evaluationFamily,
      "tablebase",
      rootEntry.outcome,
      context,
      0,
    );
  }

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

      let iteration = negamax(root, root.game.currentPlayer, depth, alpha, beta, context);
      if (previousScore !== null && (iteration.score <= alpha || iteration.score >= beta)) {
        context.aspirationResearches += 1;
        iteration = negamax(root, root.game.currentPlayer, depth, -INF, INF, context);
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

  return makeResult(
    bestMove,
    bestScore,
    bestPv,
    policy,
    evaluationFamily,
    "bounded-search",
    null,
    context,
    completedDepth,
  );
}

function negamax(
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

  if (state.game.currentPlayer !== playerToMove) {
    throw new Error(`Tablebase PVS player mismatch: state=${state.game.currentPlayer}, expected=${playerToMove}`);
  }

  if (context.tablebasePlacement === "all-low") {
    const entry = probeTablebase(state, context);
    if (entry !== null) {
      return { score: wdlScore(entry.outcome), pv: entry.proofMove ? [entry.proofMove] : [] };
    }
  }

  if (depth === 0) {
    if (context.tablebasePlacement === "leaf") {
      const entry = probeTablebase(state, context);
      if (entry !== null) {
        return { score: wdlScore(entry.outcome), pv: entry.proofMove ? [entry.proofMove] : [] };
      }
    }
    context.heuristicLeaves += 1;
    return { score: evaluateV3(state.game, playerToMove, context.evaluationFamily), pv: [] };
  }

  let alpha = alphaInput;
  const beta = betaInput;
  const ordered = orderMoves(state, playerToMove, context.evaluationFamily);
  if (ordered.length === 0) {
    context.heuristicLeaves += 1;
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

  return { score: bestScore, pv: bestMove ? [bestMove, ...bestChildPv] : [] };
}

function probeTablebase(state: PolicyState, context: SearchContext): WdlTablebaseEntryV6 | null {
  if (context.tablebase === null) return null;
  if (boardValue(state.game) > context.tablebaseMaxBoardValue) return null;
  context.tablebaseLookups += 1;
  const entry = lookupWdlTablebaseV6(context.tablebase, state, context.policy);
  if (entry === null) return null;
  context.tablebaseHits += 1;
  if (entry.outcome === "win") context.tablebaseWins += 1;
  if (entry.outcome === "draw") context.tablebaseDraws += 1;
  if (entry.outcome === "loss") context.tablebaseLosses += 1;
  return entry;
}

function wdlScore(outcome: WdlTablebaseEntryV6["outcome"]): number {
  if (outcome === "win") return WDL_TERMINAL;
  if (outcome === "loss") return -WDL_TERMINAL;
  return 0;
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

function makeResult(
  move: PlayerMove | null,
  score: number,
  pv: PlayerMove[],
  policy: RepetitionPolicy,
  evaluationFamily: V3EvaluationFamily,
  scoreSource: TablebasePvsV6Result["scoreSource"],
  exactWdl: TablebasePvsV6Result["exactWdl"],
  context: SearchContext,
  completedDepth: number,
): TablebasePvsV6Result {
  return {
    move,
    score,
    principalVariation: pv,
    policy,
    evaluationFamily,
    scoreSource,
    exactWdl,
    diagnostics: {
      nodeCount: context.nodeCount,
      completedDepth,
      cutoffs: context.cutoffs,
      aspirationResearches: context.aspirationResearches,
      policyDrawLeaves: context.policyDrawLeaves,
      naturalTerminalLeaves: context.naturalTerminalLeaves,
      heuristicLeaves: context.heuristicLeaves,
      budgetReason: context.budgetReason,
      tablebasePlacement: context.tablebasePlacement,
      tablebaseLookups: context.tablebaseLookups,
      tablebaseHits: context.tablebaseHits,
      tablebaseWins: context.tablebaseWins,
      tablebaseDraws: context.tablebaseDraws,
      tablebaseLosses: context.tablebaseLosses,
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
