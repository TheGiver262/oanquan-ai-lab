import { applyMove, getLegalMoves, otherPlayer } from "../engine.js";
import type { PlayerId, PlayerMove } from "../types.js";
import { boardValue } from "./exact-endgame-v4.js";
import { solveExactPolicyState } from "./exact-policy-solver-v5.js";
import { evaluateV3, type V3EvaluationFamily } from "./negamax-pvs-v3.js";
import {
  applyPolicyMove,
  policyStateKey,
  validatePolicy,
  type PolicyState,
  type RepetitionPolicy,
} from "./repetition-policy-v5.js";

const INF = 1_000_000_000;
const TERMINAL = 10_000_000;

export type HybridExactOracleV6Options = {
  maxDepth?: number;
  nodeBudget?: number;
  timeBudgetMs?: number;
  aspirationWindow?: number;
  usePvs?: boolean;
  evaluationFamily?: V3EvaluationFamily;

  /** Maximum weighted board value at which an exact oracle probe is allowed. */
  oracleMaxBoardValue?: number;
  /** Maximum exact-solver probes attempted during one root search. */
  oracleMaxProbes?: number;
  /** Node cap for one exact-solver probe. */
  oracleNodeBudgetPerProbe?: number;
  /** Wall-clock cap for one exact-solver probe. Also clipped to root time remaining. */
  oracleTimeBudgetMsPerProbe?: number;
};

export type HybridExactOracleV6Diagnostics = {
  nodeCount: number;
  completedDepth: number;
  cutoffs: number;
  aspirationResearches: number;
  policyDrawLeaves: number;
  naturalTerminalLeaves: number;
  heuristicLeaves: number;
  budgetReason: "node" | "time" | null;

  oracleProbes: number;
  oracleCacheHits: number;
  oracleSolvedProbes: number;
  oracleUnresolvedProbes: number;
  oracleNodeCount: number;
  oraclePolicyDrawLeaves: number;
  oracleNaturalTerminalLeaves: number;
  oracleMaxDepth: number;
  oracleNodeBudgetExhaustions: number;
  oracleTimeBudgetExhaustions: number;
};

export type HybridExactOracleV6Result = {
  move: PlayerMove | null;
  score: number;
  principalVariation: PlayerMove[];
  policy: RepetitionPolicy;
  evaluationFamily: V3EvaluationFamily;
  /**
   * `exact-oracle` only means the root itself was fully solved by the exact
   * oracle. A normal hybrid result may contain exact subtrees while the root
   * value still depends on bounded heuristic search.
   */
  scoreSource: "exact-oracle" | "policy-terminal" | "natural-terminal" | "hybrid-search";
  /** Exact final score margin only when scoreSource is exact-oracle. */
  exactMargin: number | null;
  diagnostics: HybridExactOracleV6Diagnostics;
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
  heuristicLeaves: number;
  budgetReason: "node" | "time" | null;

  oracleMaxBoardValue: number;
  oracleMaxProbes: number;
  oracleNodeBudgetPerProbe: number;
  oracleTimeBudgetMsPerProbe: number;
  oracleProbes: number;
  oracleCacheHits: number;
  oracleSolvedProbes: number;
  oracleUnresolvedProbes: number;
  oracleNodeCount: number;
  oraclePolicyDrawLeaves: number;
  oracleNaturalTerminalLeaves: number;
  oracleMaxDepth: number;
  oracleNodeBudgetExhaustions: number;
  oracleTimeBudgetExhaustions: number;
  oracleCache: Map<string, OracleEntry>;
};

type NodeResult = { score: number; pv: PlayerMove[] };

type OracleSolvedEntry = {
  solved: true;
  score: number;
  exactMargin: number;
  pv: PlayerMove[];
};

type OracleUnresolvedEntry = {
  solved: false;
};

type OracleEntry = OracleSolvedEntry | OracleUnresolvedEntry;

class BudgetExhausted extends Error {
  constructor(readonly reason: "node" | "time") {
    super(reason);
  }
}

/**
 * V6 hybrid search.
 *
 * Large-state play remains bounded PVS. When a reached PolicyState is small
 * enough, V6 asks the V5 exact policy solver for a proof. A solved oracle node
 * replaces heuristic evaluation with terminal-scale exact value; an unresolved
 * probe is cached only as unresolved and the normal bounded search continues.
 *
 * Exact provenance is deliberately conservative: the root is reported exact
 * only when the root itself is solved by the oracle. Exact descendants do not
 * promote the whole bounded search to an exact claim.
 */
export function searchHybridExactOracleV6(
  root: PolicyState,
  policy: RepetitionPolicy,
  options: HybridExactOracleV6Options = {},
): HybridExactOracleV6Result {
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
    nodeCount: 0,
    cutoffs: 0,
    aspirationResearches: 0,
    policyDrawLeaves: 0,
    naturalTerminalLeaves: 0,
    heuristicLeaves: 0,
    budgetReason: null,

    oracleMaxBoardValue: options.oracleMaxBoardValue ?? 12,
    oracleMaxProbes: options.oracleMaxProbes ?? 32,
    oracleNodeBudgetPerProbe: options.oracleNodeBudgetPerProbe ?? 50_000,
    oracleTimeBudgetMsPerProbe: options.oracleTimeBudgetMsPerProbe ?? 50,
    oracleProbes: 0,
    oracleCacheHits: 0,
    oracleSolvedProbes: 0,
    oracleUnresolvedProbes: 0,
    oracleNodeCount: 0,
    oraclePolicyDrawLeaves: 0,
    oracleNaturalTerminalLeaves: 0,
    oracleMaxDepth: 0,
    oracleNodeBudgetExhaustions: 0,
    oracleTimeBudgetExhaustions: 0,
    oracleCache: new Map<string, OracleEntry>(),
  };

  if (root.adjudication !== null) {
    context.policyDrawLeaves += 1;
    return makeResult(null, 0, [], root, policy, evaluationFamily, "policy-terminal", null, context, 0);
  }

  if (root.game.status === "finished") {
    context.naturalTerminalLeaves += 1;
    return makeResult(
      null,
      evaluateV3(root.game, root.game.currentPlayer, evaluationFamily),
      [],
      root,
      policy,
      evaluationFamily,
      "natural-terminal",
      null,
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
      root,
      policy,
      evaluationFamily,
      "hybrid-search",
      null,
      context,
      0,
    );
  }

  const rootOracle = probeOracle(root, context);
  if (rootOracle?.solved) {
    return makeResult(
      rootOracle.pv[0] ?? null,
      rootOracle.score,
      rootOracle.pv,
      root,
      policy,
      evaluationFamily,
      "exact-oracle",
      rootOracle.exactMargin,
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

      let iteration = negamaxHybrid(root, root.game.currentPlayer, depth, alpha, beta, context);
      if (previousScore !== null && (iteration.score <= alpha || iteration.score >= beta)) {
        context.aspirationResearches += 1;
        iteration = negamaxHybrid(root, root.game.currentPlayer, depth, -INF, INF, context);
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
    root,
    policy,
    evaluationFamily,
    "hybrid-search",
    null,
    context,
    completedDepth,
  );
}

/** Convert an exact final margin to the same terminal-scale convention used by V3 evaluation. */
export function exactMarginToSearchScore(margin: number): number {
  if (margin > 0) return TERMINAL + margin;
  if (margin < 0) return -TERMINAL + margin;
  return 0;
}

function negamaxHybrid(
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
    throw new Error(`Hybrid PVS player mismatch: state=${state.game.currentPlayer}, expected=${playerToMove}`);
  }

  const oracle = probeOracle(state, context);
  if (oracle?.solved) return { score: oracle.score, pv: oracle.pv };

  if (depth === 0) {
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
      child = negamaxHybrid(applied.state, childPlayer, depth - 1, -beta, -alpha, context);
      child = { score: -child.score, pv: child.pv };
    } else {
      child = negamaxHybrid(applied.state, childPlayer, depth - 1, -alpha - 1, -alpha, context);
      child = { score: -child.score, pv: child.pv };
      if (child.score > alpha && child.score < beta) {
        child = negamaxHybrid(applied.state, childPlayer, depth - 1, -beta, -alpha, context);
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

function probeOracle(state: PolicyState, context: SearchContext): OracleEntry | null {
  if (context.oracleMaxProbes <= 0) return null;
  if (boardValue(state.game) > context.oracleMaxBoardValue) return null;

  const key = policyStateKey(state, context.policy);
  const cached = context.oracleCache.get(key);
  if (cached) {
    context.oracleCacheHits += 1;
    return cached;
  }

  if (context.oracleProbes >= context.oracleMaxProbes) return null;
  const remainingMs = Math.floor(context.deadline - performance.now());
  if (remainingMs <= 0) throw new BudgetExhausted("time");

  context.oracleProbes += 1;
  const probe = solveExactPolicyState(state, context.policy, {
    maxRootBoardValue: context.oracleMaxBoardValue,
    nodeBudget: context.oracleNodeBudgetPerProbe,
    timeBudgetMs: Math.max(1, Math.min(context.oracleTimeBudgetMsPerProbe, remainingMs)),
  });

  context.oracleNodeCount += probe.diagnostics.nodeCount;
  context.oraclePolicyDrawLeaves += probe.diagnostics.policyDrawLeaves;
  context.oracleNaturalTerminalLeaves += probe.diagnostics.naturalTerminalLeaves;
  context.oracleMaxDepth = Math.max(context.oracleMaxDepth, probe.diagnostics.maxDepth);
  if (probe.diagnostics.budgetReason === "node") context.oracleNodeBudgetExhaustions += 1;
  if (probe.diagnostics.budgetReason === "time") context.oracleTimeBudgetExhaustions += 1;

  if (probe.solved && probe.value !== null) {
    context.oracleSolvedProbes += 1;
    const entry: OracleSolvedEntry = {
      solved: true,
      score: exactMarginToSearchScore(probe.value),
      exactMargin: probe.value,
      pv: probe.principalVariation,
    };
    context.oracleCache.set(key, entry);
    return entry;
  }

  context.oracleUnresolvedProbes += 1;
  const entry: OracleUnresolvedEntry = { solved: false };
  context.oracleCache.set(key, entry);
  return entry;
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
  _root: PolicyState,
  policy: RepetitionPolicy,
  evaluationFamily: V3EvaluationFamily,
  scoreSource: HybridExactOracleV6Result["scoreSource"],
  exactMargin: number | null,
  context: SearchContext,
  completedDepth: number,
): HybridExactOracleV6Result {
  return {
    move,
    score,
    principalVariation: pv,
    policy,
    evaluationFamily,
    scoreSource,
    exactMargin,
    diagnostics: {
      nodeCount: context.nodeCount,
      completedDepth,
      cutoffs: context.cutoffs,
      aspirationResearches: context.aspirationResearches,
      policyDrawLeaves: context.policyDrawLeaves,
      naturalTerminalLeaves: context.naturalTerminalLeaves,
      heuristicLeaves: context.heuristicLeaves,
      budgetReason: context.budgetReason,
      oracleProbes: context.oracleProbes,
      oracleCacheHits: context.oracleCacheHits,
      oracleSolvedProbes: context.oracleSolvedProbes,
      oracleUnresolvedProbes: context.oracleUnresolvedProbes,
      oracleNodeCount: context.oracleNodeCount,
      oraclePolicyDrawLeaves: context.oraclePolicyDrawLeaves,
      oracleNaturalTerminalLeaves: context.oracleNaturalTerminalLeaves,
      oracleMaxDepth: context.oracleMaxDepth,
      oracleNodeBudgetExhaustions: context.oracleNodeBudgetExhaustions,
      oracleTimeBudgetExhaustions: context.oracleTimeBudgetExhaustions,
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
