import { writeFileSync } from "node:fs";
import { applyMove } from "../engine.js";
import { MaterialGatedReusableScoreBoundedPuct } from "../research/puct-v3a1.js";
import { SelectiveQuiescencePuctV4 } from "../research/puct-v4.js";
import {
  LIVE_QUAN_BALANCED_POSITIONS,
  replayLiveQuanPosition,
} from "../research/v3-live-quan-corpus.js";

const TARGET_IDS = new Set([
  "LQ@6:B3:CCW:B3:CCW>T2:CW>B4:CCW>T4:CW>B3:CW>T4:CW",
  "LQ@6:B3:CW:B3:CW>T4:CCW>B2:CW>T2:CCW>B3:CCW>T2:CCW",
]);

const simulations = intArg("--fixed-simulations", 10_000);
const outPath = stringArg("--out");
const positions = LIVE_QUAN_BALANCED_POSITIONS.filter((position) => TARGET_IDS.has(position.id));
if (positions.length !== TARGET_IDS.size) {
  throw new Error(`Expected ${TARGET_IDS.size} failure positions, got ${positions.length}`);
}

const results = positions.map((position) => {
  let state = replayLiveQuanPosition(position);
  const startMove = state.moveNumber;
  const incumbentP0 = new MaterialGatedReusableScoreBoundedPuct();
  const v4P1 = new SelectiveQuiescencePuctV4();
  const shadowV3A1P1 = new MaterialGatedReusableScoreBoundedPuct();
  const trace: unknown[] = [];

  while (state.status === "playing" && state.moveNumber < startMove + 160) {
    if (state.currentPlayer === "P1") {
      const shadow = shadowV3A1P1.chooseMove(state, {
        simulations,
        puctExploration: 1.5,
        policyTemperature: 0.6,
        leafScoreWeight: 1.8,
      });
      const actual = v4P1.chooseMove(state, {
        simulations,
        puctExploration: 1.5,
        policyTemperature: 0.6,
        leafScoreWeight: 1.8,
      });
      const actualKey = actual.move ? `${actual.move.pit}:${actual.move.dir}` : null;
      const shadowKey = shadow.move ? `${shadow.move.pit}:${shadow.move.dir}` : null;
      trace.push({
        moveNumber: state.moveNumber,
        player: "P1",
        scoreBefore: { ...state.scores },
        actualEngine: "V4",
        actualMove: actualKey,
        shadowV3A1Move: shadowKey,
        disagrees: actualKey !== shadowKey,
        v4Top: top(actual),
        v3a1Top: top(shadow),
      });
      if (!actual.move) break;
      const applied = applyMove(state, actual.move);
      if (!applied.ok) throw new Error(applied.error);
      state = applied.state;
      continue;
    }

    const decision = incumbentP0.chooseMove(state, {
      simulations,
      puctExploration: 1.5,
      policyTemperature: 0.6,
      leafScoreWeight: 1.8,
    });
    trace.push({
      moveNumber: state.moveNumber,
      player: "P0",
      scoreBefore: { ...state.scores },
      actualEngine: "V3A1",
      actualMove: decision.move ? `${decision.move.pit}:${decision.move.dir}` : null,
      v3a1Top: top(decision),
    });
    if (!decision.move) break;
    const applied = applyMove(state, decision.move);
    if (!applied.ok) throw new Error(applied.error);
    state = applied.state;
  }

  const p1Entries = trace.filter((entry) => (entry as { player?: string }).player === "P1") as Array<{
    moveNumber: number;
    disagrees: boolean;
    actualMove: string | null;
    shadowV3A1Move: string | null;
  }>;
  return {
    position: position.id,
    startMove,
    endMove: state.moveNumber,
    status: state.status,
    winner: state.winner,
    finalScores: { ...state.scores },
    firstP1Disagreement: p1Entries.find((entry) => entry.disagrees) ?? null,
    p1DisagreementCount: p1Entries.filter((entry) => entry.disagrees).length,
    trace,
  };
});

const output = {
  experiment: "v4-stage2-reflection-failure-trace-v1",
  methodology: {
    fixedSimulationsPerDecision: simulations,
    actualMatch: "V3A.1=P0 vs V4=P1",
    shadow: "V3A.1 session evaluated on every V4 P1 turn from the same actual state",
    purpose: "diagnose rejected V4; not promotion evidence",
  },
  results,
};

const json = `${JSON.stringify(output, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function top(decision: { rootStats: Array<{ move: { pit: string; dir: string }; visits: number; meanValue: number; prior: number }> }) {
  return decision.rootStats.slice(0, 4).map((entry) => ({
    move: `${entry.move.pit}:${entry.move.dir}`,
    visits: entry.visits,
    meanValue: entry.meanValue,
    prior: entry.prior,
  }));
}
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
