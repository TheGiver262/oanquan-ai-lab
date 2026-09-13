import { writeFileSync } from "node:fs";
import { applyMove } from "../engine.js";
import { chooseFrozenPuctV2 } from "../research/puct-v2.js";
import { ReusableScoreBoundedPuct, type PuctV3ADecision } from "../research/puct-v3a.js";
import {
  LIVE_QUAN_BALANCED_POSITIONS,
  replayLiveQuanPosition,
  type LiveQuanPosition,
} from "../research/v3-live-quan-corpus.js";
import type { GameState, PlayerMove } from "../types.js";

const TARGET_IDS = new Set([
  "LQ@5:B2:CW:B2:CW>T5:CCW>B5:CW>T3:CCW>B1:CW",
  "LQ@9:B2:CCW:B2:CCW>T1:CW>B4:CCW>T3:CW>B5:CW>T4:CCW>B4:CCW>T5:CCW>B5:CW",
]);

type Mode = "v3a-p0" | "v2-control";
type RootRow = {
  move: string;
  visits: number;
  meanValue: number;
  prior: number;
  solvedOutcome: -1 | 0 | 1 | null;
};
type PlyTrace = {
  moveNumber: number;
  currentPlayer: "P0" | "P1";
  stateKey: string;
  previousOccurrence: number | null;
  repeatPeriod: number | null;
  engine: "puct-v2" | "puct-v3a";
  chosenMove: string | null;
  v3aDiagnostics: null | {
    simulations: number;
    cycleCutoffs: number;
    reusedRoot: boolean;
    reusedRootVisits: number;
    solvedRoot: -1 | 0 | 1 | null;
    retainedNodes: number;
  };
  rootStats: RootRow[];
};

const simulations = intArg("--simulations", 4_000);
const maxContinuationMoves = intArg("--max-continuation-moves", 512);
const stopAfterRepeatOccurrences = intArg("--stop-after-repeat-occurrences", 6);
const outPath = stringArg("--out");
const positions = LIVE_QUAN_BALANCED_POSITIONS.filter((position) => TARGET_IDS.has(position.id));
if (positions.length !== TARGET_IDS.size) throw new Error(`Expected ${TARGET_IDS.size} trace positions, got ${positions.length}`);

const result = {
  experiment: "R1c-V3A-real-trajectory-cycle-trace",
  evidenceClass: "causal-diagnostic",
  ruleset: "oaq:classic_2p:standard:v1",
  methodology: {
    purpose: "Diagnose persistent V3A=P0 censoring without changing repetition semantics.",
    candidateMode: "V3A controls P0, frozen V2 controls P1.",
    controlMode: "Frozen V2 controls both seats.",
    stateKey: "Same rule-relevant fields as V3A strategicStateKey.",
    repetition: "Observed only; never adjudicated as draw or terminal.",
    resourceMode: "fixed 4000 simulations per decision; no wall-clock cap",
  },
  config: { simulations, maxContinuationMoves, stopAfterRepeatOccurrences },
  positions: positions.map((position) => position.id),
  traces: positions.flatMap((position) => [
    traceGame(position, "v3a-p0"),
    traceGame(position, "v2-control"),
  ]),
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function traceGame(position: LiveQuanPosition, mode: Mode) {
  let state = replayLiveQuanPosition(position);
  const startMove = state.moveNumber;
  const v3a = mode === "v3a-p0" ? new ReusableScoreBoundedPuct() : null;
  const seen = new Map<string, number>();
  const occurrences = new Map<string, number[]>();
  const plies: PlyTrace[] = [];
  let repeatObservations = 0;
  let firstRepeat: null | { key: string; firstMoveNumber: number; repeatMoveNumber: number; period: number } = null;

  while (state.status === "playing" && state.moveNumber - startMove < maxContinuationMoves) {
    const key = strategicStateKey(state);
    const previous = seen.get(key) ?? null;
    if (previous !== null) {
      repeatObservations += 1;
      if (!firstRepeat) {
        firstRepeat = {
          key,
          firstMoveNumber: previous,
          repeatMoveNumber: state.moveNumber,
          period: state.moveNumber - previous,
        };
      }
    } else {
      seen.set(key, state.moveNumber);
    }
    const list = occurrences.get(key) ?? [];
    list.push(state.moveNumber);
    occurrences.set(key, list);

    const engine = mode === "v3a-p0" && state.currentPlayer === "P0" ? "puct-v3a" : "puct-v2";
    let move: PlayerMove | null = null;
    let decision: PuctV3ADecision | null = null;
    if (engine === "puct-v3a") {
      if (!v3a) throw new Error("Missing V3A session");
      decision = v3a.chooseMove(state, {
        simulations,
        puctExploration: 1.5,
        policyTemperature: 0.6,
      });
      move = decision.move;
    } else {
      move = chooseFrozenPuctV2(state, {
        simulations,
        puctExploration: 1.5,
        policyTemperature: 0.6,
      }).move;
    }

    plies.push({
      moveNumber: state.moveNumber,
      currentPlayer: state.currentPlayer,
      stateKey: key,
      previousOccurrence: previous,
      repeatPeriod: previous === null ? null : state.moveNumber - previous,
      engine,
      chosenMove: move ? moveKey(move) : null,
      v3aDiagnostics: decision ? {
        simulations: decision.diagnostics.simulations,
        cycleCutoffs: decision.diagnostics.cycleCutoffs,
        reusedRoot: decision.diagnostics.reusedRoot,
        reusedRootVisits: decision.diagnostics.reusedRootVisits,
        solvedRoot: decision.diagnostics.solvedRoot,
        retainedNodes: decision.diagnostics.retainedNodes,
      } : null,
      rootStats: decision ? topRootRows(decision, 6) : [],
    });

    if (!move) break;
    const applied = applyMove(state, move);
    if (!applied.ok) throw new Error(`Illegal ${engine} move ${moveKey(move)}: ${applied.error}`);
    state = applied.state;
    if (repeatObservations >= stopAfterRepeatOccurrences) break;
  }

  const repeatedStates = [...occurrences.entries()]
    .filter(([, moves]) => moves.length > 1)
    .map(([key, moves]) => ({ key, moveNumbers: moves, periods: moves.slice(1).map((move, index) => move - (moves[index] ?? move)) }))
    .sort((a, b) => b.moveNumbers.length - a.moveNumbers.length || a.moveNumbers[0]! - b.moveNumbers[0]!);

  return {
    position: position.id,
    mode,
    startMoveNumber: startMove,
    finalMoveNumber: state.moveNumber,
    continuationMoves: state.moveNumber - startMove,
    status: state.status,
    winner: state.winner,
    repeatObservations,
    distinctRepeatedStates: repeatedStates.length,
    firstRepeat,
    repeatedStates: repeatedStates.slice(0, 12),
    plies,
  };
}

function topRootRows(decision: PuctV3ADecision, limit: number): RootRow[] {
  return decision.rootStats.slice(0, limit).map((row) => ({
    move: moveKey(row.move),
    visits: row.visits,
    meanValue: row.meanValue,
    prior: row.prior,
    solvedOutcome: row.solvedOutcome,
  }));
}

function strategicStateKey(state: GameState): string {
  const pits = state.pits.map((pit) => `${pit.id}:${pit.stones}:${pit.quanStones}`).join(",");
  return [
    state.ruleset.canonicalRulesetId,
    state.currentPlayer,
    state.scores.P0,
    state.scores.P1,
    state.status,
    state.winner ?? "-",
    state.moveNumber === 0 ? 1 : 0,
    pits,
  ].join("|");
}
function moveKey(move: Pick<PlayerMove, "pit" | "dir">): string { return `${move.pit}:${move.dir}`; }
function stringArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}
function intArg(name: string, fallback: number): number {
  const raw = stringArg(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}
