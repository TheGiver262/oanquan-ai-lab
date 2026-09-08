import { createInitialState, getLegalMoves } from "../engine.js";
import { boardValue } from "../research/exact-endgame-v4.js";
import {
  proveWdlByGraphV6,
} from "../research/wdl-graph-proof-v6.js";
import {
  applyPolicyMove,
  createPolicyState,
  type PolicyState,
  type RepetitionPolicy,
} from "../research/repetition-policy-v5.js";
import { V3_50M_PV } from "../research/v3-pv-corpus.js";
import type { Direction, PlayerMove } from "../types.js";

const maxBoardValue = intArg("--max-board-value", 16);
const graphNodes = intArg("--graph-nodes", 50_000);
const graphMs = intArg("--graph-ms", 500);
const maxProbesPerLine = intArg("--max-probes-per-line", 12);
const policy: RepetitionPolicy = { kind: "repeat-draw", occurrences: 3 };

const lines = Object.entries(V3_50M_PV).map(([line, pv]) => {
  const openingKey = line.startsWith("B3:CW:") ? "B3:CW" : "B3:CCW";
  const snapshots = replayPolicyPv(openingKey, pv, policy);
  const eligible = snapshots
    .filter((snapshot) => snapshot.state.game.status === "finished" || snapshot.boardValue <= maxBoardValue)
    .sort((a, b) => b.ply - a.ply)
    .slice(0, maxProbesPerLine);

  const probes = eligible.map((snapshot) => {
    const result = proveWdlByGraphV6(snapshot.state, policy, {
      nodeBudget: graphNodes,
      timeBudgetMs: graphMs,
    });
    return {
      ply: snapshot.ply,
      moveApplied: snapshot.moveApplied,
      boardValue: snapshot.boardValue,
      currentPlayer: snapshot.state.game.currentPlayer,
      scores: snapshot.state.game.scores,
      solved: result.solved,
      outcome: result.outcome,
      proofMove: result.proofMove ? moveKey(result.proofMove) : null,
      diagnostics: result.diagnostics,
    };
  });

  return {
    line,
    eligibleSnapshots: eligible.length,
    solved: probes.filter((probe) => probe.solved).length,
    outcomes: countOutcomes(probes.map((probe) => probe.outcome)),
    probes,
  };
});

const all = lines.flatMap((line) => line.probes);
console.log(JSON.stringify({
  methodology: {
    phase: "Hybrid Exact Oracle V6 graph-WDL coverage",
    sourceCorpus: "four V3 50M principal variations",
    policy: "threefold draw with accumulated pre-root PolicyState history",
    proofSemantics: "WIN/LOSS may propagate conservatively through a partial strategic-state graph; DRAW remainder is assigned only when the reachable graph is complete",
    claimLimit: "exact W/D/L only; no exact final score margin is claimed",
  },
  config: { maxBoardValue, graphNodes, graphMs, maxProbesPerLine },
  aggregate: {
    probes: all.length,
    solved: all.filter((probe) => probe.solved).length,
    hitRate: all.length === 0 ? 0 : all.filter((probe) => probe.solved).length / all.length,
    outcomes: countOutcomes(all.map((probe) => probe.outcome)),
    completeGraphs: all.filter((probe) => probe.diagnostics.graphComplete).length,
    nodeBudgetStops: all.filter((probe) => probe.diagnostics.graphBudgetReason === "node").length,
    timeBudgetStops: all.filter((probe) => probe.diagnostics.graphBudgetReason === "time").length,
    totalGraphNodes: all.reduce((sum, probe) => sum + probe.diagnostics.graphNodes, 0),
    totalProvenWins: all.reduce((sum, probe) => sum + probe.diagnostics.provenWins, 0),
    totalProvenLosses: all.reduce((sum, probe) => sum + probe.diagnostics.provenLosses, 0),
    totalProvenDraws: all.reduce((sum, probe) => sum + probe.diagnostics.provenDraws, 0),
    totalUnknownNodes: all.reduce((sum, probe) => sum + probe.diagnostics.unknownNodes, 0),
  },
  lines,
}, null, 2));

type Snapshot = { ply: number; moveApplied: string; boardValue: number; state: PolicyState };

function replayPolicyPv(openingKey: string, pv: readonly string[], policy: RepetitionPolicy): Snapshot[] {
  let state = createPolicyState(createInitialState());
  const openingMove = findMove(state, openingKey);
  const opened = applyPolicyMove(state, openingMove, policy);
  if (!opened.ok) throw new Error(opened.error);
  state = opened.state;
  const snapshots: Snapshot[] = [{
    ply: 1,
    moveApplied: openingKey,
    boardValue: boardValue(state.game),
    state: clonePolicyState(state),
  }];

  for (let index = 0; index < pv.length; index += 1) {
    if (state.game.status === "finished" || state.adjudication !== null) break;
    const key = pv[index]!;
    const move = findMove(state, key);
    const applied = applyPolicyMove(state, move, policy);
    if (!applied.ok) throw new Error(`PV illegal at ply ${index + 2}: ${key}: ${applied.error}`);
    state = applied.state;
    snapshots.push({
      ply: index + 2,
      moveApplied: key,
      boardValue: boardValue(state.game),
      state: clonePolicyState(state),
    });
  }
  return snapshots;
}

function clonePolicyState(state: PolicyState): PolicyState {
  return {
    game: structuredClone(state.game),
    repetitionCounts: new Map(state.repetitionCounts),
    plies: state.plies,
    adjudication: state.adjudication ? structuredClone(state.adjudication) : null,
  };
}

function findMove(state: PolicyState, key: string): PlayerMove {
  const [pit, dir] = key.split(":") as [PlayerMove["pit"], Direction];
  const move = getLegalMoves(state.game).find((candidate) => candidate.pit === pit && candidate.dir === dir);
  if (!move) throw new Error(`Illegal move ${key}`);
  return move;
}

function moveKey(move: PlayerMove): string { return `${move.pit}:${move.dir}`; }
function countOutcomes(values: readonly string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
}
function stringArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}
function intArg(name: string, fallback: number): number {
  const raw = stringArg(name);
  if (raw === null) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
  return value;
}
