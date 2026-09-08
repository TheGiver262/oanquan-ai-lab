import { applyMove, getLegalMoves, otherPlayer } from "../engine.js";
import type { PlayerId, PlayerMove } from "../types.js";
import { boardValue, solveExactEndgame } from "./exact-endgame-v4.js";
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

export type ExactOracleMode = "policy" | "canonical-acyclic" | "auto";

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
  /**
   * policy: always use the repetition-history-aware exact solver.
   * canonical-acyclic: use the memoized canonical solver only when its result is
   * proof-safe under the selected policy.
   * auto: prefer proof-safe canonical solving; otherwise fall back to policy exact.
   */
  oracleMode?: ExactOracleMode;
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

  oracleMode: ExactOracleMode;
  oracleProbes: number;
  oracleCacheHits: number;
  oracleSolvedProbes: number;
  oracleUnresolvedProbes: number;
  oracleNodeCount: number;
  oraclePolicyDrawLeaves: number;
  oracleNaturalTerminalLeaves: number;
  oracleCycleEdges: number;
  oracleMaxDepth: number;
  oracleNodeBudgetExhaustions: number;
  oracleTimeBudgetExhaustions: number;
  oracleCanonicalProbes: number;
  oracleCanonicalSolvedProbes: number;
  oraclePolicyProbes: number;
  oraclePolicySolvedProbes: number;
  oracleCanonicalUnsafeSkips: number;
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

  oracleMode: ExactOracleMode;
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
  oracleCycleEdges: number;
  oracleMaxDepth: number;
  oracleNodeBudgetExhaustions: number;
  oracleTimeBudgetExhaustions: number;
  oracleCanonicalProbes: number;
  oracleCanonicalSolvedProbes: number;
  oraclePolicyProbes: number;
  oraclePolicySolvedProbes: number;
  oracleCanonicalUnsafeSkips: number;
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
 * enough, V6 asks an exact oracle for a proof. A solved oracle node replaces
 * heuristic evaluation with terminal-scale exact value; an unresolved probe is
 * cached only as unresolved and normal bounded search continues.
 *
 * The canonical-acyclic fast path is proof-safe for threefold only while every
 * position in the already-played history has occurred at most once. If the
 * canonical exact solver then succeeds, it has also proven that no repeated
 * strategic state occurs on any required future path. A pre-root ancestor may
 * therefore occur at most once more, reaching occurrence #2 but never #3.
 * Hence threefold cannot change the canonical exact value in that solved subtree.
 *
 * Exact provenance is deliberately conservative: the root is reported exact
 * only when the root itself is solved by an oracle. Exact descendants do not
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

    oracleMode: options.oracleMode ?? "auto",
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
    oracleCycleEdges: 0,
    oracleMaxDepth: 0,
    oracleNodeBudgetExhaustions: 0,
    oracleTimeBudgetExhaustions: 0,
    oracleCanonicalProbes: 0,
    oracleCanonicalSolvedProbes: 0,
    oraclePolicyProbes: 0,
    oraclePolicySolvedProbes: 0,
    oracleCanonicalUnsafeSkips: 0,
    oracleCache: new Map<string, OracleEntry>(),
  };

  if (root.adjudication !== null) {
    context.policyDrawLeaves += 1;
    return makeResult(null, 0, [], policy, evaluationFamily, "policy-terminal", null, context, 0);
  }

  if (root.game.status === "finished") {
    context.naturalTerminalLeaves += 1;
    return makeResult(
      null,
      evaluateV3(root.game, root.game.currentPlayer, evaluationFamily),
      [],
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

/**
 * Whether a canonical no-repetition exact proof can be reused under `policy`.
 *
 * For no-policy play it is trivially safe. For threefold, it is safe only while
 * no earlier state has already occurred twice. The canonical solver itself will
 * refuse to solve a subtree containing a future cycle.
 */
export function canUseCanonicalAcyclicOracle(
  state: PolicyState,
  policy: RepetitionPolicy,
): boolean {
  if (policy.kind === "none") return true;
  if (policy.kind !== "repeat-draw" || policy.occurrences !== 3) return false;
  for (const count of state.repetitionCounts.values()) {
    if (count > 1) return false;
  }
  return true;
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

  const key = `${context.oracleMode}|${policyStateKey(state, context.policy)}`;
  const cached = context.oracleCache.get(key);
  if (cached) {
    context.oracleCacheHits += 1;
    return cached;
  }

  if (context.oracleProbes >= context.oracleMaxProbes) return null;

  const canonicalSafe = canUseCanonicalAcyclicOracle(state, context.policy);
  if (context.oracleMode === "canonical-acyclic" && !canonicalSafe) {
    context.oracleCanonicalUnsafeSkips += 1;
    const skipped: OracleUnresolvedEntry = { solved: false };
    context.oracleCache.set(key, skipped);
    return skipped;
  }

  if ((context.oracleMode === "canonical-acyclic" || context.oracleMode === "auto") && canonicalSafe) {
    return runCanonicalProbe(state, key, context);
  }

  return runPolicyProbe(state, key, context);
}

function runCanonicalProbe(
  state: PolicyState,
  cacheKey: string,
  context: SearchContext,
): OracleEntry {
  const remainingMs = remainingOracleTime(context);
  context.oracleProbes += 1;
  context.oracleCanonicalProbes += 1;

  const probe = solveExactEndgame(state.game, {
    maxRootBoardValue: context.oracleMaxBoardValue,
    nodeBudget: context.oracleNodeBudgetPerProbe,
    timeBudgetMs: remainingMs,
  });

  context.oracleNodeCount += probe.diagnostics.nodeCount;
  context.oracleCycleEdges += probe.diagnostics.cycleEdges;
  context.oracleMaxDepth = Math.max(context.oracleMaxDepth, probe.diagnostics.maxDepth);
  recordOracleBudget(probe.diagnostics.budgetReason, context);

  if (probe.solved && probe.value !== null) {
    context.oracleSolvedProbes += 1;
    context.oracleCanonicalSolvedProbes += 1;
    const entry: OracleSolvedEntry = {
      solved: true,
      score: exactMarginToSearchScore(probe.value),
      exactMargin: probe.value,
      pv: probe.principalVariation,
    };
    context.oracleCache.set(cacheKey, entry);
    return entry;
  }

  context.oracleUnresolvedProbes += 1;
  const entry: OracleUnresolvedEntry = { solved: false };
  context.oracleCache.set(cacheKey, entry);
  return entry;
}

function runPolicyProbe(
  state: PolicyState,
  cacheKey: string,
  context: SearchContext,
): OracleEntry {
  const remainingMs = remainingOracleTime(context);
  context.oracleProbes += 1;
  context.oraclePolicyProbes += 1;

  const probe = solveExactPolicyState(state, context.policy, {
    maxRootBoardValue: context.oracleMaxBoardValue,
    nodeBudget: context.oracleNodeBudgetPerProbe,
    timeBudgetMs: remainingMs,
  });

  context.oracleNodeCount += probe.diagnostics.nodeCount;
  context.oraclePolicyDrawLeaves += probe.diagnostics.policyDrawLeaves;
  context.oracleNaturalTerminalLeaves += probe.diagnostics.naturalTerminalLeaves;
  context.oracleCycleEdges += probe.diagnostics.cycleEdges;
  context.oracleMaxDepth = Math.max(context.oracleMaxDepth, probe.diagnostics.maxDepth);
  recordOracleBudget(probe.diagnostics.budgetReason, context);

  if (probe.solved && probe.value !== null) {
    context.oracleSolvedProbes += 1;
    context.oraclePolicySolvedProbes += 1;
    const entry: OracleSolvedEntry = {
      solved: true,
      score: exactMarginToSearchScore(probe.value),
      exactMargin: probe.value,
      pv: probe.principalVariation,
    };
    context.oracleCache.set(cacheKey, entry);
    return entry;
  }

  context.oracleUnresolvedProbes += 1;
  const entry: OracleUnresolvedEntry = { solved: false };
  context.oracleCache.set(cacheKey, entry);
  return entry;
}

function remainingOracleTime(context: SearchContext): number {
  const remainingMs = Math.floor(context.deadline - performance.now());
  if (remainingMs <= 0) throw new BudgetExhausted("time");
  return Math.max(1, Math.min(context.oracleTimeBudgetMsPerProbe, remainingMs));
}

function recordOracleBudget(reason: "node" | "time" | null, context: SearchContext): void {
  if (reason === "node") context.oracleNodeBudgetExhaustions += 1;
  if (reason === "time") context.oracleTimeBudgetExhaustions += 1;
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
      oracleMode: context.oracleMode,
      oracleProbes: context.oracleProbes,
      oracleCacheHits: context.oracleCacheHits,
      oracleSolvedProbes: context.oracleSolvedProbes,
      oracleUnresolvedProbes: context.oracleUnresolvedProbes,
      oracleNodeCount: context.oracleNodeCount,
      oraclePolicyDrawLeaves: context.oraclePolicyDrawLeaves,
      oracleNaturalTerminalLeaves: context.oracleNaturalTerminalLeaves,
      oracleCycleEdges: context.oracleCycleEdges,
      oracleMaxDepth: context.oracleMaxDepth,
      oracleNodeBudgetExhaustions: context.oracleNodeBudgetExhaustions,
      oracleTimeBudgetExhaustions: context.oracleTimeBudgetExhaustions,
      oracleCanonicalProbes: context.oracleCanonicalProbes,
      oracleCanonicalSolvedProbes: context.oracleCanonicalSolvedProbes,
      oraclePolicyProbes: context.oraclePolicyProbes,
      oraclePolicySolvedProbes: context.oraclePolicySolvedProbes,
      oracleCanonicalUnsafeSkips: context.oracleCanonicalUnsafeSkips,
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
