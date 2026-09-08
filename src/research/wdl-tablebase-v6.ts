import { otherPlayer } from "../engine.js";
import type { PlayerId, PlayerMove } from "../types.js";
import { exactStrategicStateKey } from "./exact-endgame-v4.js";
import {
  analyzeReachableEndgameGraph,
} from "./endgame-graph-v4.js";
import {
  isGraphWdlHistorySafe,
  terminalOutcomeForPerspectiveV6,
  type Wdl,
} from "./wdl-graph-proof-v6.js";
import type { PolicyState, RepetitionPolicy } from "./repetition-policy-v5.js";

export type WdlTablebaseEntryV6 = {
  key: string;
  outcome: Exclude<Wdl, "unknown">;
  proofMove: PlayerMove | null;
};

export type WdlTablebaseV6 = {
  policy: { kind: "repeat-draw"; occurrences: 3 };
  entries: ReadonlyMap<string, WdlTablebaseEntryV6>;
};

export type WdlTablebaseBuildOptionsV6 = {
  nodeBudget?: number;
  timeBudgetMs?: number;
};

export type WdlTablebaseBuildResultV6 = {
  entries: WdlTablebaseEntryV6[];
  rootOutcome: Wdl;
  graphComplete: boolean;
  graphNodes: number;
  graphEdges: number;
  terminalNodes: number;
  provenEntries: number;
  provenWins: number;
  provenDraws: number;
  provenLosses: number;
  unknownNodes: number;
  budgetReason: "node" | "time" | null;
};

/**
 * Builds reusable exact W/D/L entries from one history-safe threefold root.
 *
 * Unlike the realtime graph oracle, this function is intended for offline
 * tablebase generation. Every exported entry has exact W/D/L provenance under
 * the same conservative attractor semantics as V6 graph proof. Unknown nodes
 * are never serialized as draws.
 */
export function buildWdlTablebaseEntriesV6(
  root: PolicyState,
  policy: RepetitionPolicy,
  options: WdlTablebaseBuildOptionsV6 = {},
): WdlTablebaseBuildResultV6 {
  if (policy.kind !== "repeat-draw" || policy.occurrences !== 3) {
    throw new Error("V6 WDL tablebase currently supports threefold only");
  }
  if (!isGraphWdlHistorySafe(root, policy)) {
    throw new Error("WDL tablebase root history is not safe for board-only threefold proof");
  }

  if (root.adjudication !== null) {
    return {
      entries: [],
      rootOutcome: "draw",
      graphComplete: true,
      graphNodes: 0,
      graphEdges: 0,
      terminalNodes: 0,
      provenEntries: 0,
      provenWins: 0,
      provenDraws: 0,
      provenLosses: 0,
      unknownNodes: 0,
      budgetReason: null,
    };
  }

  const built = analyzeReachableEndgameGraph(root.game, {
    nodeBudget: options.nodeBudget ?? 5_000,
    timeBudgetMs: options.timeBudgetMs ?? 100,
  });
  const nodes = built.nodes;
  const outcomes = new Array<Wdl>(nodes.length).fill("unknown");
  const proofMoves = new Array<PlayerMove | null>(nodes.length).fill(null);
  const rootPlayer = root.game.currentPlayer;

  for (const node of nodes) {
    if (!node.terminal) continue;
    outcomes[node.id] = terminalOutcomeForPerspectiveV6(
      node.state,
      playerAtDepth(rootPlayer, node.depth),
    );
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index]!;
      if (node.terminal || outcomes[node.id] !== "unknown") continue;

      const winningEdge = node.edges.find((edge) => outcomes[edge.target] === "loss");
      if (winningEdge) {
        outcomes[node.id] = "win";
        proofMoves[node.id] = winningEdge.move;
        changed = true;
        continue;
      }

      if (!node.expanded || node.edges.length === 0) continue;
      if (node.edges.every((edge) => outcomes[edge.target] === "win")) {
        outcomes[node.id] = "loss";
        changed = true;
        continue;
      }

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

  if (built.analysis.complete) {
    for (const node of nodes) {
      if (outcomes[node.id] === "unknown") outcomes[node.id] = "draw";
    }
    for (const node of nodes) {
      if (outcomes[node.id] !== "draw" || node.terminal || proofMoves[node.id] !== null) continue;
      proofMoves[node.id] = node.edges.find((edge) => outcomes[edge.target] === "draw")?.move ?? null;
    }
  }

  const entries: WdlTablebaseEntryV6[] = [];
  for (const node of nodes) {
    const outcome = outcomes[node.id] ?? "unknown";
    if (outcome === "unknown") continue;
    entries.push({
      key: exactStrategicStateKey(node.state),
      outcome,
      proofMove: proofMoves[node.id] ?? null,
    });
  }

  const counts = countOutcomes(outcomes);
  return {
    entries,
    rootOutcome: outcomes[0] ?? "unknown",
    graphComplete: built.analysis.complete,
    graphNodes: built.analysis.nodeCount,
    graphEdges: built.analysis.edgeCount,
    terminalNodes: built.analysis.terminalNodeCount,
    provenEntries: entries.length,
    provenWins: counts.win,
    provenDraws: counts.draw,
    provenLosses: counts.loss,
    unknownNodes: counts.unknown,
    budgetReason: built.analysis.budgetReason,
  };
}

/** Merge offline proof sets. Contradictory exact outcomes are treated as a hard error. */
export function createWdlTablebaseV6(
  entrySets: readonly (readonly WdlTablebaseEntryV6[])[],
): WdlTablebaseV6 {
  const entries = new Map<string, WdlTablebaseEntryV6>();
  for (const set of entrySets) {
    for (const entry of set) {
      const existing = entries.get(entry.key);
      if (existing && existing.outcome !== entry.outcome) {
        throw new Error(`Contradictory WDL tablebase proof for ${entry.key}`);
      }
      if (!existing || (existing.proofMove === null && entry.proofMove !== null)) {
        entries.set(entry.key, cloneEntry(entry));
      }
    }
  }
  return {
    policy: { kind: "repeat-draw", occurrences: 3 },
    entries,
  };
}

export function lookupWdlTablebaseV6(
  tablebase: WdlTablebaseV6,
  state: PolicyState,
  policy: RepetitionPolicy,
): WdlTablebaseEntryV6 | null {
  if (policy.kind !== "repeat-draw" || policy.occurrences !== 3) return null;
  if (!isGraphWdlHistorySafe(state, policy)) return null;
  return tablebase.entries.get(exactStrategicStateKey(state.game)) ?? null;
}

export function serializeWdlTablebaseV6(tablebase: WdlTablebaseV6): {
  version: 1;
  policy: { kind: "repeat-draw"; occurrences: 3 };
  entries: WdlTablebaseEntryV6[];
} {
  return {
    version: 1,
    policy: tablebase.policy,
    entries: [...tablebase.entries.values()].sort((left, right) => left.key.localeCompare(right.key)),
  };
}

export function deserializeWdlTablebaseV6(value: {
  version: number;
  policy: { kind: string; occurrences?: number };
  entries: WdlTablebaseEntryV6[];
}): WdlTablebaseV6 {
  if (value.version !== 1) throw new Error(`Unsupported WDL tablebase version ${value.version}`);
  if (value.policy.kind !== "repeat-draw" || value.policy.occurrences !== 3) {
    throw new Error("WDL tablebase policy must be threefold");
  }
  return createWdlTablebaseV6([value.entries]);
}

function playerAtDepth(rootPlayer: PlayerId, depth: number): PlayerId {
  return depth % 2 === 0 ? rootPlayer : otherPlayer(rootPlayer);
}

function countOutcomes(outcomes: readonly Wdl[]): Record<Wdl, number> {
  const counts: Record<Wdl, number> = { win: 0, draw: 0, loss: 0, unknown: 0 };
  for (const outcome of outcomes) counts[outcome] += 1;
  return counts;
}

function cloneEntry(entry: WdlTablebaseEntryV6): WdlTablebaseEntryV6 {
  return {
    key: entry.key,
    outcome: entry.outcome,
    proofMove: entry.proofMove ? { ...entry.proofMove } : null,
  };
}
