import { writeFileSync } from "node:fs";
import { applyMove, getLegalMoves } from "../engine.js";
import { MaterialGatedReusableScoreBoundedPuct } from "../research/puct-v3a1.js";
import {
  LIVE_QUAN_BALANCED_POSITIONS,
  replayLiveQuanPosition,
} from "../research/v3-live-quan-corpus.js";
import type { GameState, PlayerId, PlayerMove } from "../types.js";

type Case = {
  id: string;
  shared: string[];
  baseline: string;
  rejectedV4: string;
};

const CASES: Case[] = [
  {
    id: "LQ@6:B3:CCW:B3:CCW>T2:CW>B4:CCW>T4:CW>B3:CW>T4:CW",
    shared: ["B2:CCW", "T3:CW"],
    baseline: "B4:CCW",
    rejectedV4: "B1:CW",
  },
  {
    id: "LQ@6:B3:CW:B3:CW>T4:CCW>B2:CW>T2:CCW>B3:CCW>T2:CCW",
    shared: ["B4:CW", "T3:CCW"],
    baseline: "B2:CW",
    rejectedV4: "B5:CCW",
  },
];

const simulations = intArg("--fixed-simulations", 20_000);
const outPath = stringArg("--out");
const results = [];

for (const definition of CASES) {
  const position = LIVE_QUAN_BALANCED_POSITIONS.find((entry) => entry.id === definition.id);
  if (!position) throw new Error(`Missing position ${definition.id}`);

  let state = replayLiveQuanPosition(position);
  for (const key of definition.shared) state = applyKey(state, key);
  if (state.moveNumber !== 8) throw new Error(`Expected move 8, got ${state.moveNumber}`);

  for (const branch of ["baseline", "rejectedV4"] as const) {
    const forced = definition[branch];
    const afterForced = applyKey(state, forced);
    const outcome = continueWithV3A1(afterForced);
    results.push({
      position: definition.id,
      branch,
      forcedMove: forced,
      startScores: { ...state.scores },
      ...outcome,
    });
  }
}

const output = {
  experiment: "v4-rejected-branch-quality-v1",
  methodology: {
    fixedSimulationsPerDecision: simulations,
    continuation: "fresh V3A.1 material36 sessions for both players after one forced move at move 8",
    reflectionPairs: true,
    purpose: "validate quality of V3A.1 baseline move vs rejected V4 divergence",
  },
  results,
};
const json = `${JSON.stringify(output, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function continueWithV3A1(start: GameState) {
  let state = start;
  const startMove = state.moveNumber;
  const sessions: Record<PlayerId, MaterialGatedReusableScoreBoundedPuct> = {
    P0: new MaterialGatedReusableScoreBoundedPuct(),
    P1: new MaterialGatedReusableScoreBoundedPuct(),
  };
  while (state.status === "playing" && state.moveNumber < startMove + 160) {
    const decision = sessions[state.currentPlayer].chooseMove(state, {
      simulations,
      puctExploration: 1.5,
      policyTemperature: 0.6,
      leafScoreWeight: 1.8,
    });
    if (!decision.move) break;
    const applied = applyMove(state, decision.move);
    if (!applied.ok) throw new Error(applied.error);
    state = applied.state;
  }
  return {
    status: state.status,
    winner: state.winner,
    continuationMoves: state.moveNumber - startMove,
    finalScores: { ...state.scores },
  };
}

function applyKey(state: GameState, key: string): GameState {
  const [pit, dir] = key.split(":");
  const move = getLegalMoves(state).find((candidate) => candidate.pit === pit && candidate.dir === dir);
  if (!move) throw new Error(`Illegal forced move ${key} at move ${state.moveNumber}`);
  const applied = applyMove(state, move as PlayerMove);
  if (!applied.ok) throw new Error(applied.error);
  return applied.state;
}
function stringArg(name: string): string | null {
  const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] ?? null : null;
}
function intArg(name: string, fallback: number): number {
  const raw = stringArg(name); if (raw === null) return fallback;
  const value = Number(raw); if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}
