import { applyMove, getLegalMoves, otherPlayer } from "../engine.js";
import type { PlayerId, PlayerMove } from "../types.js";
import { boardValue } from "./exact-endgame-v4.js";
import { evaluateV3, type V3EvaluationFamily } from "./negamax-pvs-v3.js";
import {
  applyPolicyMove,
  policyStateKey,
  validatePolicy,
  type PolicyState,
  type RepetitionPolicy,
} from "./repetition-policy-v5.js";
import { proveWdlByGraphV6, type Wdl } from "./wdl-graph-proof-v6.js";

const INF = 1_000_000_000;
const WDL_TERMINAL = 10_000_000;

export type WdlOraclePlacement = "leaf" | "all-low";

export type HybridWdlOracleV6Options = {
  maxDepth?: number;
  nodeBudget?: number;
  timeBudgetMs?: number;
  aspirationWindow?: number;
  usePvs?: boolean;
  evaluationFamily?: V3EvaluationFamily;

  /** Maximum weighted board value at which the WDL oracle may be queried. */
  wdlMaxBoardValue?: number;
  /** Maximum distinct graph proofs attempted during one root search. */
  wdlMaxProbes?: number;
  /** Strategic-state graph cap for one proof. */
  wdlGraphNodeBudgetPerProbe?: number;
  /** Per-proof wall-clock cap, also clipped by root time remaining. */
  wdlTimeBudgetMsPerProbe?: number;
  /**
   * leaf: query WDL only where bounded PVS would otherwise use heuristic eval.
   * all-low: query every eligible low-material node and allow earlier cutoffs.
   */
  wdlPlacement?: WdlOraclePlacement;
};

export type HybridWdlOracleV6Diagnostics = {
  nodeCount: number;
  completedDepth: number;
  cutoffs: number;
  aspirationResearches: number;
  policyDrawLeaves: number;
  naturalTerminalLeaves: number;
  heuristicLeaves: number;
  budgetReason: "node" | "time" | null;

  wdlPlacement: WdlOraclePlacement;
  wdlProbes: number;
  wdlCacheHits: number;
  wdlSolvedProbes: number;
  wdlUnresolvedProbes: number;
  wdlWins: number;
  wdlDraws: number;
  wdlLosses: number;
  wdlGraphNodes: number;
  wdlGraphEdges: number;
  wdlCompleteGraphs: number;
  wdlNodeBudgetStops: number;
  wdlTimeBudgetStops: number;
  wdlUnsafeSkips: number;
};

export type HybridWdlOracleV6Result = {
  move: PlayerMove | null;
  score: number;
  principalVariation: PlayerMove[];
  policy: RepetitionPolicy;
  evaluationFamily: V3EvaluationFamily;
  scoreSource: "wdl-oracle" | "policy-terminal" | "natural-terminal" | "hybrid-search";
  /** Exact root W/D/L only when scoreSource is wdl-oracle. */
  exactWdl: Exclude<Wdl, "unknown"> | null;
  diagnostics: HybridWdlOracleV6Diagnostics;
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

  wdlMaxBoardValue: number;
  wdlMaxProbes: number;
  wdlGraphNodeBudgetPerProbe: number;
  wdlTimeBudgetMsPerProbe: number;
  wdlPlacement: WdlOraclePlacement;
  wdlProbes: number;
  wdlCacheHits: number;
  wdlSolvedProbes: number;
  wdlUnresolvedProbes: number;
  wdlWins: number;
  wdlDraws: number;
  wdlLosses: number;
  wdlGraphNodes: number;
  wdlGraphEdges: number;
  wdlCompleteGraphs: number;
  wdlNodeBudgetStops: number;
  wdlTimeBudgetStops: number;
  wdlUnsafeSkips: number;
  wdlCache: Map<string, WdlEntry>;
};

type NodeResult = { score: number; pv: PlayerMove[] };

type WdlSolvedEntry = {
  solved: true;
  outcome: Exclude<Wdl, "unknown">;
  score: number;
  proofMove: PlayerMove | null;
};

type WdlUnresolvedEntry = { solved: false };
type WdlEntry = WdlSolvedEntry | WdlUnresolvedEntry;

class BudgetExhausted extends Error {
  constructor(readonly reason: "node" | "time") {
    super(reason);
  }
}

/**
 * Bounded PVS with a conservative graph-WDL proof oracle.
 *
 * The WDL oracle does not claim an exact score margin. A solved node means only
 * exact WIN/DRAW/LOSS under the selected research policy. The root is labelled
 * `wdl-oracle` only when the root itself is proven; proven descendants may guide
 * or cut bounded search without promoting the whole root result to exact.
 *
 * Default placement is heuristic-leaf replacement. This is intentionally
 * conservative for latency: the 5k-node WDL budget sweep showed that most useful
 * proof coverage was already present at the smallest tested graph cap, while
 * 10k added no extra proof on the V3 deep-PV corpus.
 */
export function searchHybridWdlOracleV6(
  root: PolicyState,
  policy: RepetitionPolicy,
  options: HybridWdlOracleV6Options = {},
): HybridWdlOracleV6Result {
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

    wdlMaxBoardValue: options.wdlMaxBoardValue ?? 8,
    wdlMaxProbes: options.wdlMaxProbes ?? 4,
    wdlGraphNodeBudgetPerProbe: options.wdlGraphNodeBudgetPerProbe ?? 5_000,
    wdlTimeBudgetMsPerProbe: options.wdlTimeBudgetMsPerProbe ?? 50,
    wdlPlacement: options.wdlPlacement ?? "leaf",
    wdlProbes: 0,
    wdlCacheHits: 0,
    wdlSolvedProbes: 0,
    wdlUnresolvedProbes: 0,
    wdlWins: 0,
    wdlDraws: 0,
    wdlLosses: 0,
    wdlGraphNodes: 0,
    wdlGraphEdges: 0,
    wdlCompleteGraphs: 0,
    wdlNodeBudgetStops: 0,
    wdlTimeBudgetStops: 0,
    wdlUnsafeSkips: 0,
    wdlCache: new Map<string, WdlEntry>(),
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
      "hybrid-search",
      null,
      context,
      0,
    );
  }

  // Root proof is always worthwhile when the root itself is already in the
  // configured late-game region, independent of leaf/all-low placement.
  const rootWdl = probeWdl(root, context);
  if (rootWdl?.solved) {
    const pv = rootWdl.proofMove ? [rootWdl.proofMove] : [];
    return makeResult(
      rootWdl.proofMove,
      rootWdl.score,
      pv,
      policy,
      evaluationFamily,
      "wdl-oracle",
      rootWdl.outcome,
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

export function wdlToSearchScore(outcome: Exclude<Wdl, "unknown">): number {
  if (outcome === "win") return WDL_TERMINAL;
  if (outcome === "loss") return -WDL_TERMINAL;
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
    throw new Error(`Hybrid WDL PVS player mismatch: state=${state.game.currentPlayer}, expected=${playerToMove}`);
  }

  if (context.wdlPlacement === "all-low") {
    const wdl = probeWdl(state, context);
    if (wdl?.solved) return { score: wdl.score, pv: wdl.proofMove ? [wdl.proofMove] : [] };
  }

  if (depth === 0) {
    if (context.wdlPlacement === "leaf") {
      const wdl = probeWdl(state, context);
      if (wdl?.solved) return { score: wdl.score, pv: wdl.proofMove ? [wdl.proofMove] : [] };
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

function probeWdl(state: PolicyState, context: SearchContext): WdlEntry | null {
  if (context.wdlMaxProbes <= 0) return null;
  if (boardValue(state.game) > context.wdlMaxBoardValue) return null;

  const key = policyStateKey(state, context.policy);
  const cached = context.wdlCache.get(key);
  if (cached) {
    context.wdlCacheHits += 1;
    return cached;
  }
  if (context.wdlProbes >= context.wdlMaxProbes) return null;

  const remainingMs = Math.floor(context.deadline - performance.now());
  if (remainingMs <= 0) throw new BudgetExhausted("time");
  const proofMs = Math.max(1, Math.min(context.wdlTimeBudgetMsPerProbe, remainingMs));

  context.wdlProbes += 1;
  const proof = proveWdlByGraphV6(state, context.policy, {
    nodeBudget: context.wdlGraphNodeBudgetPerProbe,
    timeBudgetMs: proofMs,
  });

  context.wdlGraphNodes += proof.diagnostics.graphNodes;
  context.wdlGraphEdges += proof.diagnostics.graphEdges;
  if (proof.diagnostics.graphComplete) context.wdlCompleteGraphs += 1;
  if (!proof.diagnostics.rootHistorySafe) context.wdlUnsafeSkips += 1;
  if (proof.diagnostics.graphBudgetReason === "node") context.wdlNodeBudgetStops += 1;
  if (proof.diagnostics.graphBudgetReason === "time") context.wdlTimeBudgetStops += 1;

  if (proof.solved && proof.outcome !== "unknown") {
    context.wdlSolvedProbes += 1;
    if (proof.outcome === "win") context.wdlWins += 1;
    if (proof.outcome === "draw") context.wdlDraws += 1;
    if (proof.outcome === "loss") context.wdlLosses += 1;
    const entry: WdlSolvedEntry = {
      solved: true,
      outcome: proof.outcome,
      score: wdlToSearchScore(proof.outcome),
      proofMove: proof.proofMove,
    };
    context.wdlCache.set(key, entry);
    return entry;
  }

  context.wdlUnresolvedProbes += 1;
  const entry: WdlUnresolvedEntry = { solved: false };
  context.wdlCache.set(key, entry);
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
  policy: RepetitionPolicy,
  evaluationFamily: V3EvaluationFamily,
  scoreSource: HybridWdlOracleV6Result["scoreSource"],
  exactWdl: HybridWdlOracleV6Result["exactWdl"],
  context: SearchContext,
  completedDepth: number,
): HybridWdlOracleV6Result {
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
      wdlPlacement: context.wdlPlacement,
      wdlProbes: context.wdlProbes,
      wdlCacheHits: context.wdlCacheHits,
      wdlSolvedProbes: context.wdlSolvedProbes,
      wdlUnresolvedProbes: context.wdlUnresolvedProbes,
      wdlWins: context.wdlWins,
      wdlDraws: context.wdlDraws,
      wdlLosses: context.wdlLosses,
      wdlGraphNodes: context.wdlGraphNodes,
      wdlGraphEdges: context.wdlGraphEdges,
      wdlCompleteGraphs: context.wdlCompleteGraphs,
      wdlNodeBudgetStops: context.wdlNodeBudgetStops,
      wdlTimeBudgetStops: context.wdlTimeBudgetStops,
      wdlUnsafeSkips: context.wdlUnsafeSkips,
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
