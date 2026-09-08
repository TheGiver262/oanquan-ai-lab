import { createInitialState, getLegalMoves } from "../engine.js";
import { boardValue, exactStrategicStateKey } from "../research/exact-endgame-v4.js";
import { searchPolicyAwarePvsV5 } from "../research/policy-aware-pvs-v5.js";
import {
  applyPolicyMove,
  createPolicyState,
  policyStateKey,
  type PolicyState,
} from "../research/repetition-policy-v5.js";
import { searchTablebasePvsV6, type TablebasePlacementV6 } from "../research/tablebase-pvs-v6.js";
import {
  buildWdlTablebaseEntriesV6,
  createWdlTablebaseV6,
  lookupWdlTablebaseV6,
  serializeWdlTablebaseV6,
  type WdlTablebaseBuildResultV6,
  type WdlTablebaseEntryV6,
} from "../research/wdl-tablebase-v6.js";
import { V3_50M_PV } from "../research/v3-pv-corpus.js";
import type { Direction, PlayerMove } from "../types.js";

const THREEFOLD = { kind: "repeat-draw", occurrences: 3 } as const;
const trainOpening = requiredOpeningArg("--train-opening");
const holdoutOpening = trainOpening === "B3:CW" ? "B3:CCW" : "B3:CW";
const maxBoardValue = intArg("--max-board-value", 12);
const graphNodes = intArg("--graph-nodes", 5_000);
const graphMs = intArg("--graph-ms", 100);
const searchNodes = intArg("--search-nodes", 30_000);
const searchMs = intArg("--search-ms", 300);
const maxDepth = intArg("--max-depth", 12);
const placement = placementArg("--placement", "leaf");

const training = collectOpeningSnapshots(trainOpening, maxBoardValue);
const holdout = collectOpeningSnapshots(holdoutOpening, maxBoardValue);

const buildStarted = performance.now();
const buildResults: Array<{
  line: string;
  ply: number;
  boardValue: number;
  result: WdlTablebaseBuildResultV6;
}> = [];
const entrySets: WdlTablebaseEntryV6[][] = [];
for (const snapshot of training) {
  const result = buildWdlTablebaseEntriesV6(snapshot.state, THREEFOLD, {
    nodeBudget: graphNodes,
    timeBudgetMs: graphMs,
  });
  buildResults.push({
    line: snapshot.line,
    ply: snapshot.ply,
    boardValue: snapshot.boardValue,
    result,
  });
  entrySets.push(result.entries);
}
const tablebase = createWdlTablebaseV6(entrySets);
const buildElapsedMs = performance.now() - buildStarted;
const serialized = JSON.stringify(serializeWdlTablebaseV6(tablebase));

const rows = holdout.map((snapshot) => {
  const baselineStarted = performance.now();
  const baseline = searchPolicyAwarePvsV5(snapshot.state, THREEFOLD, {
    maxDepth,
    nodeBudget: searchNodes,
    timeBudgetMs: searchMs,
    aspirationWindow: 250,
    usePvs: true,
    evaluationFamily: "strategic",
  });
  const baselineElapsedMs = performance.now() - baselineStarted;

  const candidateStarted = performance.now();
  const candidate = searchTablebasePvsV6(snapshot.state, THREEFOLD, {
    maxDepth,
    nodeBudget: searchNodes,
    timeBudgetMs: searchMs,
    aspirationWindow: 250,
    usePvs: true,
    evaluationFamily: "strategic",
    tablebase,
    tablebaseMaxBoardValue: maxBoardValue,
    tablebasePlacement: placement,
  });
  const candidateElapsedMs = performance.now() - candidateStarted;

  const rootProof = lookupWdlTablebaseV6(tablebase, snapshot.state, THREEFOLD);
  const baselineChildProof = baseline.move
    ? childProofForMove(snapshot.state, baseline.move, tablebase)
    : null;
  const baselineProofVerdict = rootProof === null
    ? "root-unknown"
    : baselineChildProof === null
      ? "child-unknown"
      : baselineChildProof.outcome === inverseOutcome(rootProof.outcome)
        ? "preserves-proof"
        : "violates-proof";

  return {
    line: snapshot.line,
    ply: snapshot.ply,
    boardValue: snapshot.boardValue,
    currentPlayer: snapshot.state.game.currentPlayer,
    scores: snapshot.state.game.scores,
    stateKey: exactStrategicStateKey(snapshot.state.game),
    rootProof: rootProof ? {
      outcome: rootProof.outcome,
      proofMove: rootProof.proofMove ? moveKey(rootProof.proofMove) : null,
    } : null,
    baselineChildProof: baselineChildProof ? {
      outcome: baselineChildProof.outcome,
      proofMove: baselineChildProof.proofMove ? moveKey(baselineChildProof.proofMove) : null,
    } : null,
    baselineProofVerdict,
    baseline: {
      move: baseline.move ? moveKey(baseline.move) : null,
      score: baseline.score,
      elapsedMs: round2(baselineElapsedMs),
      completedDepth: baseline.diagnostics.completedDepth,
      nodeCount: baseline.diagnostics.nodeCount,
      budgetReason: baseline.diagnostics.budgetReason,
    },
    tablebasePvs: {
      move: candidate.move ? moveKey(candidate.move) : null,
      score: candidate.score,
      scoreSource: candidate.scoreSource,
      exactWdl: candidate.exactWdl,
      elapsedMs: round2(candidateElapsedMs),
      completedDepth: candidate.diagnostics.completedDepth,
      nodeCount: candidate.diagnostics.nodeCount,
      budgetReason: candidate.diagnostics.budgetReason,
      lookups: candidate.diagnostics.tablebaseLookups,
      hits: candidate.diagnostics.tablebaseHits,
    },
    moveChanged: moveKeyNullable(baseline.move) !== moveKeyNullable(candidate.move),
  };
});

const rootExactRows = rows.filter((row) => row.rootProof !== null);
const aggregate = {
  trainOpening,
  holdoutOpening,
  trainingPositions: training.length,
  holdoutPositions: holdout.length,
  tablebaseEntries: tablebase.entries.size,
  serializedBytes: Buffer.byteLength(serialized, "utf8"),
  offlineBuildElapsedMs: round2(buildElapsedMs),
  buildGraphNodes: buildResults.reduce((sum, row) => sum + row.result.graphNodes, 0),
  buildProvenEntriesBeforeMerge: buildResults.reduce((sum, row) => sum + row.result.provenEntries, 0),
  buildCompleteGraphs: buildResults.filter((row) => row.result.graphComplete).length,
  rootExactPositions: rootExactRows.length,
  rootExactRate: rows.length === 0 ? 0 : rootExactRows.length / rows.length,
  baselineProofVerdicts: countBy(rows.map((row) => row.baselineProofVerdict)),
  moveDifferences: rows.filter((row) => row.moveChanged).length,
  baseline: {
    averageElapsedMs: average(rows.map((row) => row.baseline.elapsedMs)),
    averageCompletedDepth: average(rows.map((row) => row.baseline.completedDepth)),
    averageNodeCount: average(rows.map((row) => row.baseline.nodeCount)),
  },
  tablebasePvs: {
    averageElapsedMs: average(rows.map((row) => row.tablebasePvs.elapsedMs)),
    averageCompletedDepth: average(rows.map((row) => row.tablebasePvs.completedDepth)),
    averageNodeCount: average(rows.map((row) => row.tablebasePvs.nodeCount)),
    totalLookups: rows.reduce((sum, row) => sum + row.tablebasePvs.lookups, 0),
    totalHits: rows.reduce((sum, row) => sum + row.tablebasePvs.hits, 0),
    rootTablebaseReturns: rows.filter((row) => row.tablebasePvs.scoreSource === "tablebase").length,
  },
};

console.log(JSON.stringify({
  methodology: {
    phase: "V6 offline WDL tablebase cross-opening holdout",
    trainTestSplit: `build only from ${trainOpening} V3 deep-PV low-material states; evaluate only on ${holdoutOpening}`,
    offlineAccounting: "tablebase graph construction is excluded from move-clock A/B and reported separately",
    runtimeCandidate: "policy-aware PVS plus history-safe O(1) WDL tablebase lookup; no online graph proof is executed",
    proofRegret: "when the holdout root and baseline child are both tablebase-covered, baseline is checked for preserving exact W/D/L under threefold",
    claimLimit: "V3-PV holdout, not universal tablebase coverage or human-game evidence",
  },
  config: {
    trainOpening,
    holdoutOpening,
    maxBoardValue,
    graphNodes,
    graphMs,
    searchNodes,
    searchMs,
    maxDepth,
    placement,
  },
  aggregate,
  buildResults: buildResults.map((row) => ({
    line: row.line,
    ply: row.ply,
    boardValue: row.boardValue,
    graphComplete: row.result.graphComplete,
    graphNodes: row.result.graphNodes,
    provenEntries: row.result.provenEntries,
    rootOutcome: row.result.rootOutcome,
    unknownNodes: row.result.unknownNodes,
    budgetReason: row.result.budgetReason,
  })),
  rows,
}, null, 2));

type Snapshot = {
  line: string;
  ply: number;
  boardValue: number;
  state: PolicyState;
};

function collectOpeningSnapshots(opening: "B3:CW" | "B3:CCW", threshold: number): Snapshot[] {
  const snapshots: Snapshot[] = [];
  for (const [line, pv] of Object.entries(V3_50M_PV)) {
    if (!line.startsWith(`${opening}:`)) continue;
    snapshots.push(...replayLine(line, opening, pv).filter((snapshot) => (
      snapshot.state.game.status !== "finished"
      && snapshot.state.adjudication === null
      && snapshot.boardValue <= threshold
    )));
  }

  const byPolicyKey = new Map<string, Snapshot>();
  for (const snapshot of snapshots) {
    const key = policyStateKey(snapshot.state, THREEFOLD);
    const existing = byPolicyKey.get(key);
    if (!existing || snapshot.ply > existing.ply) byPolicyKey.set(key, snapshot);
  }
  return [...byPolicyKey.values()].sort((a, b) => a.line.localeCompare(b.line) || a.ply - b.ply);
}

function replayLine(
  line: string,
  openingKey: "B3:CW" | "B3:CCW",
  pv: readonly string[],
): Snapshot[] {
  let state = createPolicyState(createInitialState());
  const snapshots: Snapshot[] = [];
  const keys = [openingKey, ...pv];
  for (let index = 0; index < keys.length; index += 1) {
    if (state.game.status === "finished" || state.adjudication !== null) break;
    const key = keys[index]!;
    const move = findMove(state, key);
    const applied = applyPolicyMove(state, move, THREEFOLD);
    if (!applied.ok) throw new Error(`Failed replay ${line} ply ${index + 1} ${key}: ${applied.error}`);
    state = applied.state;
    snapshots.push({
      line,
      ply: index + 1,
      boardValue: boardValue(state.game),
      state: clonePolicyState(state),
    });
  }
  return snapshots;
}

function findMove(state: PolicyState, key: string): PlayerMove {
  const [pit, dir] = key.split(":") as [PlayerMove["pit"], Direction];
  const move = getLegalMoves(state.game).find((candidate) => candidate.pit === pit && candidate.dir === dir);
  if (!move) throw new Error(`Illegal recorded move ${key} for ${state.game.currentPlayer} at move ${state.game.moveNumber}`);
  return move;
}

function childProofForMove(
  state: PolicyState,
  move: PlayerMove,
  tablebase: ReturnType<typeof createWdlTablebaseV6>,
): WdlTablebaseEntryV6 | null {
  const applied = applyPolicyMove(state, move, THREEFOLD);
  if (!applied.ok) return null;
  if (applied.state.adjudication !== null) {
    return {
      key: "policy-draw",
      outcome: "draw",
      proofMove: null,
    };
  }
  return lookupWdlTablebaseV6(tablebase, applied.state, THREEFOLD);
}

function inverseOutcome(outcome: WdlTablebaseEntryV6["outcome"]): WdlTablebaseEntryV6["outcome"] {
  if (outcome === "win") return "loss";
  if (outcome === "loss") return "win";
  return "draw";
}

function clonePolicyState(state: PolicyState): PolicyState {
  return {
    game: structuredClone(state.game),
    repetitionCounts: new Map(state.repetitionCounts),
    plies: state.plies,
    adjudication: state.adjudication ? structuredClone(state.adjudication) : null,
  };
}

function moveKey(move: PlayerMove): string {
  return `${move.pit}:${move.dir}`;
}

function moveKeyNullable(move: PlayerMove | null): string | null {
  return move ? moveKey(move) : null;
}

function requiredOpeningArg(name: string): "B3:CW" | "B3:CCW" {
  const raw = stringArg(name);
  if (raw !== "B3:CW" && raw !== "B3:CCW") throw new Error(`${name} must be B3:CW or B3:CCW`);
  return raw;
}

function placementArg(name: string, fallback: TablebasePlacementV6): TablebasePlacementV6 {
  const raw = stringArg(name);
  if (raw === null) return fallback;
  if (raw !== "leaf" && raw !== "all-low") throw new Error(`${name} must be leaf or all-low`);
  return raw;
}

function stringArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function intArg(name: string, fallback: number): number {
  const raw = stringArg(name);
  if (raw === null) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return round2(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function countBy(values: readonly string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
