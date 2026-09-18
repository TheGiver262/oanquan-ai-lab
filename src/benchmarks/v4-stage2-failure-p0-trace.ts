import { writeFileSync } from "node:fs";
import { applyMove } from "../engine.js";
import { MaterialGatedReusableScoreBoundedPuct } from "../research/puct-v3a1.js";
import { SelectiveQuiescencePuctV4 } from "../research/puct-v4.js";
import { LIVE_QUAN_BALANCED_POSITIONS, replayLiveQuanPosition } from "../research/v3-live-quan-corpus.js";

const TARGET_IDS = new Set([
  "LQ@6:B3:CCW:B3:CCW>T2:CW>B4:CCW>T4:CW>B3:CW>T4:CW",
  "LQ@6:B3:CW:B3:CW>T4:CCW>B2:CW>T2:CCW>B3:CCW>T2:CCW",
]);
const simulations = 10_000;
const outPath = stringArg("--out");
const positions = LIVE_QUAN_BALANCED_POSITIONS.filter((p) => TARGET_IDS.has(p.id));
if (positions.length !== TARGET_IDS.size) throw new Error("Missing reflected failure positions");

const results = positions.map((position) => {
  let state = replayLiveQuanPosition(position);
  const startMove = state.moveNumber;
  const v4P0 = new SelectiveQuiescencePuctV4();
  const shadowV3A1P0 = new MaterialGatedReusableScoreBoundedPuct();
  const incumbentP1 = new MaterialGatedReusableScoreBoundedPuct();
  const trace: Array<Record<string, unknown>> = [];

  while (state.status === "playing" && state.moveNumber < startMove + 160) {
    if (state.currentPlayer === "P0") {
      const shadow = shadowV3A1P0.chooseMove(state, {
        simulations, puctExploration: 1.5, policyTemperature: 0.6, leafScoreWeight: 1.8,
      });
      const actual = v4P0.chooseMove(state, {
        simulations, puctExploration: 1.5, policyTemperature: 0.6, leafScoreWeight: 1.8,
      });
      const actualKey = key(actual.move);
      const shadowKey = key(shadow.move);
      trace.push({
        moveNumber: state.moveNumber, player: "P0", scoreBefore: { ...state.scores },
        actualMove: actualKey, shadowV3A1Move: shadowKey, disagrees: actualKey !== shadowKey,
        v4Top: top(actual), v3a1Top: top(shadow),
      });
      if (!actual.move) break;
      const applied = applyMove(state, actual.move);
      if (!applied.ok) throw new Error(applied.error);
      state = applied.state;
    } else {
      const decision = incumbentP1.chooseMove(state, {
        simulations, puctExploration: 1.5, policyTemperature: 0.6, leafScoreWeight: 1.8,
      });
      trace.push({
        moveNumber: state.moveNumber, player: "P1", scoreBefore: { ...state.scores },
        actualMove: key(decision.move), v3a1Top: top(decision),
      });
      if (!decision.move) break;
      const applied = applyMove(state, decision.move);
      if (!applied.ok) throw new Error(applied.error);
      state = applied.state;
    }
  }

  const candidateTurns = trace.filter((entry) => entry.player === "P0");
  return {
    position: position.id,
    endMove: state.moveNumber,
    winner: state.winner,
    finalScores: { ...state.scores },
    firstP0Disagreement: candidateTurns.find((entry) => entry.disagrees === true) ?? null,
    p0DisagreementCount: candidateTurns.filter((entry) => entry.disagrees === true).length,
    trace,
  };
});

const output = {
  experiment: "v4-stage2-reflection-failure-p0-trace-v1",
  methodology: {
    fixedSimulationsPerDecision: simulations,
    actualMatch: "V4=P0 vs V3A.1=P1",
    shadow: "V3A.1 session evaluated on every V4 P0 turn from the same actual state",
    purpose: "locate candidate-side divergence that turns the P0 baseline outcome into a draw",
  },
  results,
};
const json = `${JSON.stringify(output, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function key(move: { pit: string; dir: string } | null): string | null {
  return move ? `${move.pit}:${move.dir}` : null;
}
function top(decision: { rootStats: Array<{ move: { pit: string; dir: string }; visits: number; meanValue: number; prior: number }> }) {
  return decision.rootStats.slice(0, 4).map((entry) => ({
    move: key(entry.move), visits: entry.visits, meanValue: entry.meanValue, prior: entry.prior,
  }));
}
function stringArg(name: string): string | null {
  const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] ?? null : null;
}
