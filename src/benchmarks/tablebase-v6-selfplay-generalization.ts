import { createInitialState, getLegalMoves } from "../engine.js";
import { boardValue } from "../research/exact-endgame-v4.js";
import { chooseMctsMove } from "../research/mcts.js";
import { searchPolicyAwarePvsV5 } from "../research/policy-aware-pvs-v5.js";
import {
  applyPolicyMove,
  createPolicyState,
  policyStateKey,
  type PolicyState,
} from "../research/repetition-policy-v5.js";
import { searchTablebasePvsV6 } from "../research/tablebase-pvs-v6.js";
import {
  buildWdlTablebaseEntriesV6,
  createWdlTablebaseV6,
  lookupWdlTablebaseV6,
  serializeWdlTablebaseV6,
  type WdlTablebaseEntryV6,
} from "../research/wdl-tablebase-v6.js";
import type { PlayerId, PlayerMove } from "../types.js";

const THREEFOLD = { kind: "repeat-draw", occurrences: 3 } as const;
const trainGames = intArg("--train-games", 4);
const testGames = intArg("--test-games", 4);
const seedBase = intArg("--seed", 20260908);
const maxMoves = intArg("--max-moves", 160);
const maxBoardValue = intArg("--max-board-value", 12);
const maxTrainPositions = intArg("--max-train-positions", 24);
const maxTestPositions = intArg("--max-test-positions", 24);
const graphNodes = intArg("--graph-nodes", 5_000);
const graphMs = intArg("--graph-ms", 100);
const testSearchNodes = intArg("--test-search-nodes", 30_000);
const testSearchMs = intArg("--test-search-ms", 300);
const trajectoryPvsNodes = intArg("--trajectory-pvs-nodes", 5_000);
const trajectoryMctsSims = intArg("--trajectory-mcts-sims", 500);

const trainTrajectories = Array.from({ length: trainGames }, (_, index) => (
  playTrajectory(seedBase + index, index % 2 === 0 ? "P0" : "P1")
));
const testTrajectories = Array.from({ length: testGames }, (_, index) => (
  playTrajectory(seedBase + 100_000 + index, index % 2 === 0 ? "P1" : "P0")
));

const training = sampleStates(
  trainTrajectories.flatMap((trajectory) => trajectory.lowMaterialStates),
  maxTrainPositions,
);
const testing = sampleStates(
  testTrajectories.flatMap((trajectory) => trajectory.lowMaterialStates),
  maxTestPositions,
);

const buildStarted = performance.now();
const entrySets: WdlTablebaseEntryV6[][] = [];
let buildGraphNodes = 0;
let buildProvenBeforeMerge = 0;
let completeGraphs = 0;
for (const snapshot of training) {
  const built = buildWdlTablebaseEntriesV6(snapshot.state, THREEFOLD, {
    nodeBudget: graphNodes,
    timeBudgetMs: graphMs,
  });
  entrySets.push(built.entries);
  buildGraphNodes += built.graphNodes;
  buildProvenBeforeMerge += built.provenEntries;
  if (built.graphComplete) completeGraphs += 1;
}
const tablebase = createWdlTablebaseV6(entrySets);
const buildElapsedMs = performance.now() - buildStarted;
const serializedBytes = Buffer.byteLength(JSON.stringify(serializeWdlTablebaseV6(tablebase)), "utf8");

const rows = testing.map((snapshot) => {
  const baselineStarted = performance.now();
  const baseline = searchPolicyAwarePvsV5(snapshot.state, THREEFOLD, {
    maxDepth: 12,
    nodeBudget: testSearchNodes,
    timeBudgetMs: testSearchMs,
    aspirationWindow: 250,
    usePvs: true,
    evaluationFamily: "strategic",
  });
  const baselineElapsedMs = performance.now() - baselineStarted;

  const candidateStarted = performance.now();
  const candidate = searchTablebasePvsV6(snapshot.state, THREEFOLD, {
    maxDepth: 12,
    nodeBudget: testSearchNodes,
    timeBudgetMs: testSearchMs,
    aspirationWindow: 250,
    usePvs: true,
    evaluationFamily: "strategic",
    tablebase,
    tablebaseMaxBoardValue: maxBoardValue,
    tablebasePlacement: "leaf",
  });
  const candidateElapsedMs = performance.now() - candidateStarted;

  const rootProof = lookupWdlTablebaseV6(tablebase, snapshot.state, THREEFOLD);
  const baselineChild = baseline.move ? childProof(snapshot.state, baseline.move, tablebase) : null;
  const proofVerdict = rootProof === null
    ? "root-unknown"
    : baselineChild === null
      ? "child-unknown"
      : baselineChild.outcome === inverseOutcome(rootProof.outcome)
        ? "preserves-proof"
        : "violates-proof";

  return {
    source: snapshot.source,
    game: snapshot.game,
    ply: snapshot.ply,
    opening: snapshot.opening,
    boardValue: snapshot.boardValue,
    currentPlayer: snapshot.state.game.currentPlayer,
    scores: snapshot.state.game.scores,
    rootProof: rootProof?.outcome ?? null,
    proofVerdict,
    baseline: {
      move: moveKeyNullable(baseline.move),
      elapsedMs: round2(baselineElapsedMs),
      depth: baseline.diagnostics.completedDepth,
      nodes: baseline.diagnostics.nodeCount,
    },
    tablebasePvs: {
      move: moveKeyNullable(candidate.move),
      elapsedMs: round2(candidateElapsedMs),
      depth: candidate.diagnostics.completedDepth,
      nodes: candidate.diagnostics.nodeCount,
      lookups: candidate.diagnostics.tablebaseLookups,
      hits: candidate.diagnostics.tablebaseHits,
      scoreSource: candidate.scoreSource,
      exactWdl: candidate.exactWdl,
    },
    moveChanged: moveKeyNullable(baseline.move) !== moveKeyNullable(candidate.move),
  };
});

console.log(JSON.stringify({
  methodology: {
    phase: "V6 seeded self-play tablebase generalization",
    training: "UCT-PB vs policy-aware strategic PVS trajectories with seeded random openings; only training seeds contribute WDL graph proofs",
    holdout: "disjoint seeds and reversed PVS seat assignment; no test state contributes to tablebase generation",
    runtime: "baseline PVS and leaf-tablebase PVS receive equal move-clock budgets; offline graph construction is reported separately",
    objective: "measure unseen-trajectory tablebase coverage, proof-regret, and search-depth preservation before full-game tournament use",
    claimLimit: "small seeded research corpus; not human evidence and not universal endgame coverage",
  },
  config: {
    trainGames,
    testGames,
    seedBase,
    maxMoves,
    maxBoardValue,
    maxTrainPositions,
    maxTestPositions,
    graphNodes,
    graphMs,
    testSearchNodes,
    testSearchMs,
    trajectoryPvsNodes,
    trajectoryMctsSims,
  },
  trajectories: {
    train: trainTrajectories.map(summarizeTrajectory),
    test: testTrajectories.map(summarizeTrajectory),
  },
  aggregate: {
    trainingPositions: training.length,
    testingPositions: testing.length,
    tablebaseEntries: tablebase.entries.size,
    serializedBytes,
    offlineBuildElapsedMs: round2(buildElapsedMs),
    buildGraphNodes,
    buildProvenBeforeMerge,
    completeGraphs,
    rootExactPositions: rows.filter((row) => row.rootProof !== null).length,
    rootExactRate: rows.length === 0 ? 0 : rows.filter((row) => row.rootProof !== null).length / rows.length,
    proofVerdicts: countBy(rows.map((row) => row.proofVerdict)),
    moveDifferences: rows.filter((row) => row.moveChanged).length,
    baseline: {
      averageElapsedMs: average(rows.map((row) => row.baseline.elapsedMs)),
      averageDepth: average(rows.map((row) => row.baseline.depth)),
      averageNodes: average(rows.map((row) => row.baseline.nodes)),
    },
    tablebasePvs: {
      averageElapsedMs: average(rows.map((row) => row.tablebasePvs.elapsedMs)),
      averageDepth: average(rows.map((row) => row.tablebasePvs.depth)),
      averageNodes: average(rows.map((row) => row.tablebasePvs.nodes)),
      totalLookups: rows.reduce((sum, row) => sum + row.tablebasePvs.lookups, 0),
      totalHits: rows.reduce((sum, row) => sum + row.tablebasePvs.hits, 0),
      rootReturns: rows.filter((row) => row.tablebasePvs.scoreSource === "tablebase").length,
    },
  },
  rows,
}, null, 2));

type LowState = {
  source: "train" | "test";
  game: number;
  ply: number;
  opening: string;
  boardValue: number;
  state: PolicyState;
};

type Trajectory = {
  seed: number;
  pvsSeat: PlayerId;
  opening: string;
  moves: number;
  finish: "natural" | "repetition" | "max-moves";
  winner: PlayerId | null;
  lowMaterialStates: LowState[];
};

function playTrajectory(seed: number, pvsSeat: PlayerId): Trajectory {
  const random = seededRandom(seed);
  let state = createPolicyState(createInitialState());
  const initialMoves = getLegalMoves(state.game);
  const openingMove = initialMoves[Math.floor(random() * initialMoves.length)]!;
  const opening = moveKey(openingMove);
  const opened = applyPolicyMove(state, openingMove, THREEFOLD);
  if (!opened.ok) throw new Error(`Failed seeded opening ${opening}: ${opened.error}`);
  state = opened.state;

  const isTrain = seed < seedBase + 100_000;
  const lowMaterialStates: LowState[] = [];
  maybeCollect(state, 1, opening);

  let moves = 1;
  while (moves < maxMoves && state.game.status === "playing" && state.adjudication === null) {
    const move = state.game.currentPlayer === pvsSeat
      ? searchPolicyAwarePvsV5(state, THREEFOLD, {
          maxDepth: 10,
          nodeBudget: trajectoryPvsNodes,
          timeBudgetMs: 1_000,
          aspirationWindow: 250,
          usePvs: true,
          evaluationFamily: "strategic",
        }).move
      : chooseMctsMove(state.game, {
          variant: "uct-pb",
          simulations: trajectoryMctsSims,
          rolloutDepth: 20,
          random,
        }).move;
    if (!move) break;
    const applied = applyPolicyMove(state, move, THREEFOLD);
    if (!applied.ok) throw new Error(`Trajectory move failed at ply ${moves + 1}: ${applied.error}`);
    state = applied.state;
    moves += 1;
    maybeCollect(state, moves, opening);
  }

  return {
    seed,
    pvsSeat,
    opening,
    moves,
    finish: state.game.status === "finished"
      ? "natural"
      : state.adjudication !== null
        ? "repetition"
        : "max-moves",
    winner: state.game.status === "finished" ? state.game.winner : null,
    lowMaterialStates,
  };

  function maybeCollect(candidate: PolicyState, ply: number, openingKey: string): void {
    if (candidate.game.status !== "playing" || candidate.adjudication !== null) return;
    const value = boardValue(candidate.game);
    if (value > maxBoardValue) return;
    lowMaterialStates.push({
      source: isTrain ? "train" : "test",
      game: seed,
      ply,
      opening: openingKey,
      boardValue: value,
      state: clonePolicyState(candidate),
    });
  }
}

function sampleStates(states: readonly LowState[], limit: number): LowState[] {
  const unique = new Map<string, LowState>();
  for (const state of states) {
    const key = policyStateKey(state.state, THREEFOLD);
    if (!unique.has(key)) unique.set(key, state);
  }
  const values = [...unique.values()].sort((a, b) => a.game - b.game || a.ply - b.ply);
  if (values.length <= limit) return values;
  if (limit === 1) return [values[values.length - 1]!];
  const sampled: LowState[] = [];
  for (let index = 0; index < limit; index += 1) {
    const sourceIndex = Math.round(index * (values.length - 1) / (limit - 1));
    sampled.push(values[sourceIndex]!);
  }
  return sampled;
}

function childProof(
  state: PolicyState,
  move: PlayerMove,
  tablebase: ReturnType<typeof createWdlTablebaseV6>,
): WdlTablebaseEntryV6 | null {
  const applied = applyPolicyMove(state, move, THREEFOLD);
  if (!applied.ok) return null;
  if (applied.state.adjudication !== null) {
    return { key: "policy-draw", outcome: "draw", proofMove: null };
  }
  return lookupWdlTablebaseV6(tablebase, applied.state, THREEFOLD);
}

function inverseOutcome(outcome: WdlTablebaseEntryV6["outcome"]): WdlTablebaseEntryV6["outcome"] {
  if (outcome === "win") return "loss";
  if (outcome === "loss") return "win";
  return "draw";
}

function summarizeTrajectory(trajectory: Trajectory) {
  return {
    seed: trajectory.seed,
    pvsSeat: trajectory.pvsSeat,
    opening: trajectory.opening,
    moves: trajectory.moves,
    finish: trajectory.finish,
    winner: trajectory.winner,
    lowMaterialStates: trajectory.lowMaterialStates.length,
  };
}

function clonePolicyState(state: PolicyState): PolicyState {
  return {
    game: structuredClone(state.game),
    repetitionCounts: new Map(state.repetitionCounts),
    plies: state.plies,
    adjudication: state.adjudication ? structuredClone(state.adjudication) : null,
  };
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function moveKey(move: PlayerMove): string {
  return `${move.pit}:${move.dir}`;
}

function moveKeyNullable(move: PlayerMove | null): string | null {
  return move ? moveKey(move) : null;
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
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
