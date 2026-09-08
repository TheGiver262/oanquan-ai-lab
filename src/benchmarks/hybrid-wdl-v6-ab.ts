import { createInitialState, getLegalMoves } from "../engine.js";
import { boardValue } from "../research/exact-endgame-v4.js";
import {
  searchHybridWdlOracleV6,
  type WdlOraclePlacement,
} from "../research/hybrid-wdl-oracle-v6.js";
import { searchPolicyAwarePvsV5 } from "../research/policy-aware-pvs-v5.js";
import {
  applyPolicyMove,
  createPolicyState,
  type PolicyState,
  type RepetitionPolicy,
} from "../research/repetition-policy-v5.js";
import { V3_50M_PV } from "../research/v3-pv-corpus.js";
import type { Direction, PlayerMove } from "../types.js";

const corpusMaxBoardValue = intArg("--corpus-max-board-value", 12);
const wdlMaxBoardValue = intArg("--wdl-max-board-value", 8);
const searchNodes = intArg("--search-nodes", 30_000);
const searchMs = intArg("--search-ms", 300);
const maxDepth = intArg("--max-depth", 12);
const wdlGraphNodes = intArg("--wdl-graph-nodes", 5_000);
const wdlMs = intArg("--wdl-ms", 50);
const wdlMaxProbes = intArg("--wdl-max-probes", 4);
const placementRaw = stringArg("--placement") ?? "leaf";
if (placementRaw !== "leaf" && placementRaw !== "all-low") {
  throw new Error("--placement must be leaf or all-low");
}
const placement: WdlOraclePlacement = placementRaw;
const policy: RepetitionPolicy = { kind: "repeat-draw", occurrences: 3 };

const cases = Object.entries(V3_50M_PV).flatMap(([line, pv]) => {
  const openingKey = line.startsWith("B3:CW:") ? "B3:CW" : "B3:CCW";
  return replayPolicyPv(openingKey, pv, policy)
    .filter((snapshot) => snapshot.state.game.status !== "finished" && snapshot.boardValue <= corpusMaxBoardValue)
    .map((snapshot) => ({ line, ...snapshot }));
});

const rows = cases.map((testCase) => {
  const baselineStart = performance.now();
  const baseline = searchPolicyAwarePvsV5(testCase.state, policy, {
    maxDepth,
    nodeBudget: searchNodes,
    timeBudgetMs: searchMs,
    evaluationFamily: "strategic",
  });
  const baselineElapsedMs = performance.now() - baselineStart;

  const hybridStart = performance.now();
  const hybrid = searchHybridWdlOracleV6(testCase.state, policy, {
    maxDepth,
    nodeBudget: searchNodes,
    timeBudgetMs: searchMs,
    evaluationFamily: "strategic",
    wdlMaxBoardValue,
    wdlMaxProbes,
    wdlGraphNodeBudgetPerProbe: wdlGraphNodes,
    wdlTimeBudgetMsPerProbe: wdlMs,
    wdlPlacement: placement,
  });
  const hybridElapsedMs = performance.now() - hybridStart;

  return {
    line: testCase.line,
    ply: testCase.ply,
    boardValue: testCase.boardValue,
    currentPlayer: testCase.state.game.currentPlayer,
    scores: testCase.state.game.scores,
    baseline: {
      move: baseline.move ? moveKey(baseline.move) : null,
      score: baseline.score,
      elapsedMs: round(baselineElapsedMs),
      completedDepth: baseline.diagnostics.completedDepth,
      nodeCount: baseline.diagnostics.nodeCount,
      budgetReason: baseline.diagnostics.budgetReason,
    },
    hybrid: {
      move: hybrid.move ? moveKey(hybrid.move) : null,
      score: hybrid.score,
      scoreSource: hybrid.scoreSource,
      exactWdl: hybrid.exactWdl,
      elapsedMs: round(hybridElapsedMs),
      completedDepth: hybrid.diagnostics.completedDepth,
      nodeCount: hybrid.diagnostics.nodeCount,
      budgetReason: hybrid.diagnostics.budgetReason,
      wdlProbes: hybrid.diagnostics.wdlProbes,
      wdlSolvedProbes: hybrid.diagnostics.wdlSolvedProbes,
      wdlUnresolvedProbes: hybrid.diagnostics.wdlUnresolvedProbes,
      wdlGraphNodes: hybrid.diagnostics.wdlGraphNodes,
      wdlCacheHits: hybrid.diagnostics.wdlCacheHits,
    },
    moveChanged: moveKeyOrNull(baseline.move) !== moveKeyOrNull(hybrid.move),
  };
});

const rootProofs = rows.filter((row) => row.hybrid.scoreSource === "wdl-oracle");
const moveChanged = rows.filter((row) => row.moveChanged);

console.log(JSON.stringify({
  methodology: {
    phase: "Hybrid WDL Oracle V6 A/B",
    corpus: "all non-terminal V3 50M PV snapshots at or below the configured corpus board-value threshold",
    fairness: "baseline and hybrid receive the same root node and wall-clock budgets; WDL graph work is charged inside the hybrid wall-clock budget",
    baseline: "V5 policy-aware PVS, strategic evaluation",
    hybrid: "same bounded PVS architecture with conservative graph-WDL proof oracle",
    claimLimit: "decision/latency A/B only; move differences are not automatically strength improvements unless separately validated by proof or match outcomes",
  },
  config: {
    corpusMaxBoardValue,
    wdlMaxBoardValue,
    searchNodes,
    searchMs,
    maxDepth,
    wdlGraphNodes,
    wdlMs,
    wdlMaxProbes,
    placement,
  },
  aggregate: {
    positions: rows.length,
    moveDifferences: moveChanged.length,
    rootWdlProofs: rootProofs.length,
    rootWdlOutcomes: countStrings(rootProofs.map((row) => row.hybrid.exactWdl ?? "unknown")),
    baseline: aggregateEngine(rows.map((row) => row.baseline)),
    hybrid: aggregateEngine(rows.map((row) => row.hybrid)),
    totalWdlProbes: sum(rows.map((row) => row.hybrid.wdlProbes)),
    totalWdlSolvedProbes: sum(rows.map((row) => row.hybrid.wdlSolvedProbes)),
    totalWdlGraphNodes: sum(rows.map((row) => row.hybrid.wdlGraphNodes)),
  },
  rows,
}, null, 2));

type Snapshot = { ply: number; moveApplied: string; boardValue: number; state: PolicyState };

function replayPolicyPv(openingKey: string, pv: readonly string[], repetitionPolicy: RepetitionPolicy): Snapshot[] {
  let state = createPolicyState(createInitialState());
  state = play(state, openingKey, repetitionPolicy);
  const snapshots: Snapshot[] = [{
    ply: 1,
    moveApplied: openingKey,
    boardValue: boardValue(state.game),
    state: clonePolicyState(state),
  }];

  for (let index = 0; index < pv.length; index += 1) {
    if (state.game.status === "finished" || state.adjudication !== null) break;
    const key = pv[index]!;
    state = play(state, key, repetitionPolicy);
    snapshots.push({
      ply: index + 2,
      moveApplied: key,
      boardValue: boardValue(state.game),
      state: clonePolicyState(state),
    });
  }
  return snapshots;
}

function play(state: PolicyState, key: string, policyValue: RepetitionPolicy): PolicyState {
  const move = findMove(state, key);
  const applied = applyPolicyMove(state, move, policyValue);
  if (!applied.ok) throw new Error(`Move ${key} failed: ${applied.error}`);
  return applied.state;
}

function findMove(state: PolicyState, key: string): PlayerMove {
  const [pit, dir] = key.split(":") as [PlayerMove["pit"], Direction];
  const move = getLegalMoves(state.game).find((candidate) => candidate.pit === pit && candidate.dir === dir);
  if (!move) throw new Error(`Illegal recorded move ${key}`);
  return move;
}

function clonePolicyState(state: PolicyState): PolicyState {
  return {
    game: structuredClone(state.game),
    repetitionCounts: new Map(state.repetitionCounts),
    plies: state.plies,
    adjudication: state.adjudication ? structuredClone(state.adjudication) : null,
  };
}

function aggregateEngine(values: readonly { elapsedMs: number; completedDepth: number; nodeCount: number }[]) {
  return {
    averageElapsedMs: round(avg(values.map((value) => value.elapsedMs))),
    averageCompletedDepth: round(avg(values.map((value) => value.completedDepth))),
    averageNodeCount: round(avg(values.map((value) => value.nodeCount))),
  };
}

function moveKey(move: PlayerMove): string { return `${move.pit}:${move.dir}`; }
function moveKeyOrNull(move: PlayerMove | null): string | null { return move ? moveKey(move) : null; }
function sum(values: readonly number[]): number { return values.reduce((total, value) => total + value, 0); }
function avg(values: readonly number[]): number { return values.length === 0 ? 0 : sum(values) / values.length; }
function round(value: number): number { return Math.round(value * 100) / 100; }
function countStrings(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
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
