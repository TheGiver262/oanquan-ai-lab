import type { GameState, PlayerMove } from "../types.js";
import {
  analyzeReachableEndgameGraph,
  type BuiltEndgameGraph,
} from "./endgame-graph-v4.js";
import type { PolicyState, RepetitionPolicy } from "./repetition-policy-v5.js";

export type Wdl = "win" | "draw" | "loss" | "unknown";

export type GraphWdlProofOptions = {
  nodeBudget?: number;
  timeBudgetMs?: number;
};

export type GraphWdlProofDiagnostics = {
  graphComplete: boolean;
  graphBudgetReason: "node" | "time" | null;
  graphNodes: number;
  graphEdges: number;
  terminalNodes: number;
  cyclicComponents: number;
  closedCyclicComponents: number;
  largestCyclicComponent: number;
  propagationPasses: number;
  provenWins: number;
  provenLosses: number;
  provenDraws: number;
  unknownNodes: number;
  rootHistorySafe: boolean;
};

export type GraphWdlProofResult = {
  solved: boolean;
  outcome: Wdl;
  bestMove: PlayerMove | null;
  /**
   * For win/draw, a move preserving the proven result when one is available.
   * Loss has no escaping move by definition.
   */
  proofMove: PlayerMove | null;
  diagnostics: GraphWdlProofDiagnostics;
};

/**
 * Exact/conservative WDL proof over the strategic-state graph.
 *
 * For threefold repetition, the graph abstraction is exact at a history-safe
 * root (no strategic state has already occurred twice): any infinite play in a
 * finite complete graph must eventually hit a third occurrence, so unresolved
 * non-attractor states are draws. This is the standard win/loss attractor plus
 * draw remainder construction.
 *
 * On an incomplete graph, V6 remains conservative:
 * - WIN may be proven as soon as one legal edge reaches a proven LOSS;
 * - LOSS requires the node to be fully expanded and every legal edge proven WIN;
 * - DRAW is not assigned merely because a partial graph contains a cycle.
 *
 * This solver returns W/D/L only, not exact score margin.
 */
export function proveWdlByGraphV6(
  root: PolicyState,
  policy: RepetitionPolicy,
  options: GraphWdlProofOptions = {},
): GraphWdlProofResult {
  const rootHistorySafe = isGraphWdlHistorySafe(root, policy);
  if (!rootHistorySafe) {
    return {
      solved: false,
      outcome: "unknown",
      bestMove: null,
      proofMove: null,
      diagnostics: emptyDiagnostics(false),
    };
  }

  if (root.adjudication !== null) {
    return {
      solved: true,
      outcome: "draw",
      bestMove: null,
      proofMove: null,
      diagnostics: emptyDiagnostics(true),
    };
  }

  if (root.game.status === "finished") {
    const outcome = terminalOutcome(root.game);
    return {
      solved: true,
      outcome,
      bestMove: null,
      proofMove: null,
      diagnostics: {
        ...emptyDiagnostics(true),
        graphComplete: true,
        graphNodes: 1,
        terminalNodes: 1,
        provenWins: outcome === "win" ? 1 : 0,
        provenLosses: outcome === "loss" ? 1 : 0,
        provenDraws: outcome === "draw" ? 1 : 0,
      },
    };
  }

  const built = analyzeReachableEndgameGraph(root.game, {
    nodeBudget: options.nodeBudget ?? 50_000,
    timeBudgetMs: options.timeBudgetMs ?? 100,
  });
  return solveBuiltGraph(built, policy);
}

/**
 * History condition under which a board-only future graph remains sound for
 * threefold WDL analysis.
 *
 * If every pre-root strategic state has occurred at most once, a future first
 * revisit only creates occurrence #2. Reaching #3 requires an actual repeated
 * state inside the future graph, which the graph model represents as cycling.
 */
export function isGraphWdlHistorySafe(state: PolicyState, policy: RepetitionPolicy): boolean {
  if (policy.kind === "none") return true;
  if (policy.kind !== "repeat-draw" || policy.occurrences !== 3) return false;
  for (const count of state.repetitionCounts.values()) {
    if (count > 1) return false;
  }
  return true;
}

function solveBuiltGraph(
  built: BuiltEndgameGraph,
  policy: RepetitionPolicy,
): GraphWdlProofResult {
  const nodes = built.nodes;
  const outcomes = new Array<Wdl>(nodes.length).fill("unknown");
  const proofMoves = new Array<PlayerMove | null>(nodes.length).fill(null);

  for (const node of nodes) {
    if (node.terminal) outcomes[node.id] = terminalOutcome(node.state);
  }

  let passes = 0;
  let changed = true;
  while (changed) {
    changed = false;
    passes += 1;

    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index]!;
      if (node.terminal || outcomes[node.id] !== "unknown") continue;

      // A target LOSS means the opponent-to-move at the child loses, therefore
      // this node's current player has a proven winning move. One such edge is
      // enough even if the graph expansion later hit a global budget.
      const winningEdge = node.edges.find((edge) => outcomes[edge.target] === "loss");
      if (winningEdge) {
        outcomes[node.id] = "win";
        proofMoves[node.id] = winningEdge.move;
        changed = true;
        continue;
      }

      if (!node.expanded || node.edges.length === 0) continue;

      // If every legal move gives the opponent a proven WIN, this player is
      // proven lost. Full node expansion is required so no legal escape is
      // hidden by graph budget exhaustion.
      if (node.edges.every((edge) => outcomes[edge.target] === "win")) {
        outcomes[node.id] = "loss";
        changed = true;
        continue;
      }

      // Draw propagation is safe before graph completion only if all legal
      // children are already proven and at least one is draw (with no LOSS,
      // which would have been caught as a winning move above).
      if (
        node.edges.every((edge) => outcomes[edge.target] !== "unknown")
        && node.edges.some((edge) => outcomes[edge.target] === "draw")
      ) {
        outcomes[node.id] = "draw";
        proofMoves[node.id] = node.edges.find((edge) => outcomes[edge.target] === "draw")?.move ?? null;
        changed = true;
      }
    }
  }

  // In a complete finite graph under threefold, every state left outside the
  // win/loss attractors is game-theoretically DRAW. Neither player can force a
  // terminal win, and infinite play is converted to draw by repetition.
  if (built.analysis.complete && policy.kind === "repeat-draw" && policy.occurrences === 3) {
    for (const node of nodes) {
      if (outcomes[node.id] === "unknown") outcomes[node.id] = "draw";
    }

    // Pick a draw-preserving edge after the remainder classification.
    for (const node of nodes) {
      if (outcomes[node.id] !== "draw" || node.terminal || proofMoves[node.id] !== null) continue;
      proofMoves[node.id] = node.edges.find((edge) => outcomes[edge.target] === "draw")?.move ?? null;
    }
  }

  const outcome = outcomes[0] ?? "unknown";
  const proofMove = proofMoves[0] ?? null;
  const counts = countOutcomes(outcomes);

  return {
    solved: outcome !== "unknown",
    outcome,
    bestMove: outcome === "win" || outcome === "draw" ? proofMove : null,
    proofMove,
    diagnostics: {
      graphComplete: built.analysis.complete,
      graphBudgetReason: built.analysis.budgetReason,
      graphNodes: built.analysis.nodeCount,
      graphEdges: built.analysis.edgeCount,
      terminalNodes: built.analysis.terminalNodeCount,
      cyclicComponents: built.analysis.cyclicComponentCount,
      closedCyclicComponents: built.analysis.closedCyclicComponentCount,
      largestCyclicComponent: built.analysis.largestCyclicComponentSize,
      propagationPasses: passes,
      provenWins: counts.win,
      provenLosses: counts.loss,
      provenDraws: counts.draw,
      unknownNodes: counts.unknown,
      rootHistorySafe: true,
    },
  };
}

function terminalOutcome(state: GameState): Exclude<Wdl, "unknown"> {
  if (state.winner === null) return "draw";
  // The canonical engine leaves currentPlayer as the player who made the final
  // move when that move ends the game, so winner-vs-currentPlayer is the correct
  // terminal outcome from this graph node's player-to-move perspective.
  return state.winner === state.currentPlayer ? "win" : "loss";
}

function countOutcomes(outcomes: readonly Wdl[]): Record<Wdl, number> {
  const counts: Record<Wdl, number> = { win: 0, draw: 0, loss: 0, unknown: 0 };
  for (const outcome of outcomes) counts[outcome] += 1;
  return counts;
}

function emptyDiagnostics(rootHistorySafe: boolean): GraphWdlProofDiagnostics {
  return {
    graphComplete: false,
    graphBudgetReason: null,
    graphNodes: 0,
    graphEdges: 0,
    terminalNodes: 0,
    cyclicComponents: 0,
    closedCyclicComponents: 0,
    largestCyclicComponent: 0,
    propagationPasses: 0,
    provenWins: 0,
    provenLosses: 0,
    provenDraws: 0,
    unknownNodes: 0,
    rootHistorySafe,
  };
}
