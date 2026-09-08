import { applyMove, createInitialState, getLegalMoves } from "../engine.js";
import { boardValue } from "../research/exact-endgame-v4.js";
import { analyzeReachableEndgameGraph } from "../research/endgame-graph-v4.js";
import {
  V3_50M_PV,
  type V3EvaluationFamily,
  type V3FinalistOpening,
} from "../research/v3-pv-corpus.js";
import type { Direction, GameState, PlayerMove } from "../types.js";

const opening = requiredStringArg("--opening") as V3FinalistOpening;
const family = requiredStringArg("--family") as V3EvaluationFamily;
const nodeBudget = intArg("--nodes", 100_000);
const timeBudgetMs = intArg("--time", 60_000);
const requestedPly = optionalIntArg("--ply");

if (opening !== "B3:CW" && opening !== "B3:CCW") {
  throw new Error("--opening must be B3:CW or B3:CCW");
}
if (family !== "material" && family !== "strategic") {
  throw new Error("--family must be material or strategic");
}

const snapshots = replayRecordedPv(opening, V3_50M_PV[`${opening}:${family}`]);
const selected = requestedPly === null
  ? snapshots[snapshots.length - 1]!
  : snapshots.find((snapshot) => snapshot.ply === requestedPly);
if (!selected) throw new Error(`No recorded state at ply ${requestedPly}`);

const graph = analyzeReachableEndgameGraph(selected.state, { nodeBudget, timeBudgetMs });
const componentSummaries = graph.analysis.components
  .filter((component) => component.cyclic)
  .sort((a, b) => b.members.length - a.members.length || a.id - b.id)
  .slice(0, 20)
  .map((component) => ({
    id: component.id,
    size: component.members.length,
    fullyExpanded: component.fullyExpanded,
    closed: component.closed,
    outgoingComponentIds: component.outgoingComponentIds,
  }));

const witnesses = graph.analysis.cycleWitnesses.map((witness) => ({
  componentId: witness.componentId,
  moves: witness.moves,
  states: witness.stateIds.map((id) => summarizeState(graph.nodes[id]!)),
}));

console.log(JSON.stringify({
  methodology: {
    phase: "Opening Balance V4 SCC analysis",
    purpose: "measure cyclic structure in reachable reduced game graphs before assigning repetition semantics",
    cycleSemantics: "none; SCCs are structural evidence only and are not automatically draws",
    sourceEvidence: "recorded V3 50M PV corpus",
  },
  opening,
  family,
  selectedRoot: summarizeState(selected),
  config: { nodeBudget, timeBudgetMs, requestedPly },
  analysis: {
    complete: graph.analysis.complete,
    budgetReason: graph.analysis.budgetReason,
    nodeCount: graph.analysis.nodeCount,
    expandedNodeCount: graph.analysis.expandedNodeCount,
    edgeCount: graph.analysis.edgeCount,
    terminalNodeCount: graph.analysis.terminalNodeCount,
    componentCount: graph.analysis.componentCount,
    cyclicComponentCount: graph.analysis.cyclicComponentCount,
    closedCyclicComponentCount: graph.analysis.closedCyclicComponentCount,
    largestComponentSize: graph.analysis.largestComponentSize,
    largestCyclicComponentSize: graph.analysis.largestCyclicComponentSize,
    maxDiscoveredDepth: graph.analysis.maxDiscoveredDepth,
    largestCyclicComponents: componentSummaries,
    cycleWitnesses: witnesses,
  },
}, null, 2));

type Snapshot = {
  ply: number;
  moveApplied: string;
  boardValue: number;
  state: GameState;
};

function replayRecordedPv(openingKey: V3FinalistOpening, pv: readonly string[]): Snapshot[] {
  let state = createInitialState();
  state = applyRequired(state, openingKey);
  const snapshots: Snapshot[] = [snapshotOf(state, 1, openingKey)];

  for (let index = 0; index < pv.length; index += 1) {
    if (state.status === "finished") break;
    const key = pv[index]!;
    state = applyRequired(state, key);
    snapshots.push(snapshotOf(state, index + 2, key));
  }
  return snapshots;
}

function applyRequired(state: GameState, key: string): GameState {
  const [pit, dir] = key.split(":") as [PlayerMove["pit"], Direction];
  const move = getLegalMoves(state).find((candidate) => candidate.pit === pit && candidate.dir === dir);
  if (!move) throw new Error(`Illegal recorded move ${key} for ${state.currentPlayer} at move ${state.moveNumber}`);
  const applied = applyMove(state, move);
  if (!applied.ok) throw new Error(`Failed recorded move ${key}: ${applied.error}`);
  return applied.state;
}

function snapshotOf(state: GameState, ply: number, moveApplied: string): Snapshot {
  return { ply, moveApplied, boardValue: boardValue(state), state: structuredClone(state) };
}

function summarizeState(value: Snapshot | { state: GameState; depth?: number; id?: number }): object {
  const state = value.state;
  const prefix = "ply" in value
    ? { ply: value.ply, moveApplied: value.moveApplied }
    : { id: value.id ?? null, depth: value.depth ?? null };
  return {
    ...prefix,
    currentPlayer: state.currentPlayer,
    boardValue: boardValue(state),
    scores: state.scores,
    status: state.status,
    nonEmptyPits: state.pits
      .filter((pit) => pit.stones > 0 || pit.quanStones > 0)
      .map((pit) => ({ id: pit.id, stones: pit.stones, quanStones: pit.quanStones })),
  };
}

function requiredStringArg(name: string): string {
  const value = stringArg(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
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

function optionalIntArg(name: string): number | null {
  const raw = stringArg(name);
  if (raw === null) return null;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}
