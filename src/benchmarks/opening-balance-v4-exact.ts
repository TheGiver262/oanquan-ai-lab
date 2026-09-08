import { applyMove, createInitialState, getLegalMoves } from "../engine.js";
import {
  boardValue,
  exactStrategicStateKey,
  solveExactEndgame,
} from "../research/exact-endgame-v4.js";
import type { Direction, GameState, PlayerMove } from "../types.js";

const V3_50M_PV: Record<string, string[]> = {
  "B3:CW:material": [
    "T1:CW", "B3:CCW", "T2:CW", "B4:CCW", "T3:CW", "B1:CCW", "T3:CW", "B3:CW",
    "T1:CCW", "B5:CCW", "T3:CW", "B2:CW", "T5:CCW", "B3:CCW", "T5:CW", "B1:CW",
    "T3:CW", "B2:CCW", "T1:CCW",
  ],
  "B3:CW:strategic": [
    "T1:CW", "B1:CCW", "T3:CW", "B2:CW", "T5:CCW", "B5:CCW", "T3:CCW", "B5:CW",
    "T4:CW", "B5:CCW", "T1:CCW", "B2:CW", "T3:CW", "B3:CCW", "T4:CW", "B1:CW",
  ],
  "B3:CCW:material": [
    "T1:CW", "B5:CW", "T2:CW", "B1:CCW", "T4:CW", "B4:CW", "T3:CW", "B2:CCW",
    "T1:CCW", "B5:CW", "T3:CW", "B3:CCW", "T4:CCW", "B4:CCW", "T1:CW", "B5:CW",
    "T3:CCW", "B4:CCW", "T1:CCW",
  ],
  "B3:CCW:strategic": [
    "T4:CCW", "B1:CW", "T3:CCW", "B5:CW", "T1:CW", "B2:CCW", "T3:CCW", "B4:CW",
    "T1:CW", "B1:CCW", "T2:CW", "B3:CW", "T4:CW", "B4:CCW", "T3:CW", "B3:CW",
    "T4:CW", "B4:CCW", "T5:CCW", "B2:CW",
  ],
};

const opening = requiredStringArg("--opening");
const family = requiredStringArg("--family");
const maxRootBoardValue = intArg("--max-board-value", 30);
const nodeBudget = intArg("--nodes", 2_000_000);
const timeBudgetMs = intArg("--time", 60_000);
const maxProbes = intArg("--max-probes", 3);

if (opening !== "B3:CW" && opening !== "B3:CCW") {
  throw new Error("--opening must be B3:CW or B3:CCW");
}
if (family !== "material" && family !== "strategic") {
  throw new Error("--family must be material or strategic");
}

const recordedPv = V3_50M_PV[`${opening}:${family}`];
if (!recordedPv) throw new Error(`No recorded V3 50M PV for ${opening}/${family}`);

const snapshots = replayRecordedPv(opening, recordedPv);
const eligible = snapshots
  .filter((snapshot) => snapshot.state.status === "finished" || snapshot.boardValue <= maxRootBoardValue)
  .sort((a, b) => b.ply - a.ply)
  .slice(0, maxProbes);

const probes = eligible.map((snapshot) => {
  const result = solveExactEndgame(snapshot.state, {
    maxRootBoardValue,
    nodeBudget,
    timeBudgetMs,
  });
  return {
    ply: snapshot.ply,
    moveApplied: snapshot.moveApplied,
    currentPlayer: snapshot.state.currentPlayer,
    boardValue: snapshot.boardValue,
    scores: snapshot.state.scores,
    stateKey: exactStrategicStateKey(snapshot.state),
    result: {
      status: result.status,
      solved: result.solved,
      value: result.value,
      outcome: result.outcome,
      bestMove: result.bestMove ? moveKey(result.bestMove) : null,
      principalVariation: result.principalVariation.map(moveKey),
      diagnostics: result.diagnostics,
    },
  };
});

console.log(JSON.stringify({
  methodology: {
    phase: "Opening Balance V4",
    purpose: "seed conservative exact solving from recorded V3 50M principal variations",
    exactness: "no heuristic leaf values; cycles are unresolved because current rules do not define repetition as draw",
    sourceEvidence: "V3 50M PV recorded in docs/opening-balance-v3.md and workflow run 34185314775",
  },
  opening,
  family,
  config: { maxRootBoardValue, nodeBudget, timeBudgetMs, maxProbes },
  replay: snapshots.map((snapshot) => ({
    ply: snapshot.ply,
    moveApplied: snapshot.moveApplied,
    boardValue: snapshot.boardValue,
    scores: snapshot.state.scores,
    status: snapshot.state.status,
  })),
  probes,
}, null, 2));

type Snapshot = {
  ply: number;
  moveApplied: string;
  boardValue: number;
  state: GameState;
};

function replayRecordedPv(openingKey: string, pv: string[]): Snapshot[] {
  let state = createInitialState();
  const openingMove = findMove(state, openingKey);
  const opened = applyMove(state, openingMove);
  if (!opened.ok) throw new Error(`Failed opening ${openingKey}: ${opened.error}`);
  state = opened.state;

  const snapshots: Snapshot[] = [{
    ply: 1,
    moveApplied: openingKey,
    boardValue: boardValue(state),
    state: structuredClone(state),
  }];

  for (let index = 0; index < pv.length; index += 1) {
    if (state.status === "finished") break;
    const key = pv[index]!;
    const move = findMove(state, key);
    const applied = applyMove(state, move);
    if (!applied.ok) {
      throw new Error(`Recorded PV became illegal at ply ${index + 2}, move ${key}: ${applied.error}`);
    }
    state = applied.state;
    snapshots.push({
      ply: index + 2,
      moveApplied: key,
      boardValue: boardValue(state),
      state: structuredClone(state),
    });
  }

  return snapshots;
}

function findMove(state: GameState, key: string): PlayerMove {
  const [pit, dir] = key.split(":") as [PlayerMove["pit"], Direction];
  const move = getLegalMoves(state).find((candidate) => candidate.pit === pit && candidate.dir === dir);
  if (!move) throw new Error(`Illegal recorded move ${key} for ${state.currentPlayer} at move ${state.moveNumber}`);
  return move;
}

function moveKey(move: PlayerMove): string {
  return `${move.pit}:${move.dir}`;
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
