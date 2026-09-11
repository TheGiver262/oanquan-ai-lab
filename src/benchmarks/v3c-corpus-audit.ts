import { writeFileSync } from "node:fs";
import {
  BALANCED_MIDGAME_POSITIONS,
  replayBalancedPosition,
} from "../research/v3-balanced-midgame-corpus.js";

const outPath = stringArg("--out");
const rows = BALANCED_MIDGAME_POSITIONS.map((position) => {
  const state = replayBalancedPosition(position);
  return {
    id: position.id,
    source: position.source,
    depth: position.depth,
    currentPlayer: state.currentPlayer,
    scores: state.scores,
    scoreDiff: position.scoreDiff,
    danMaterialDiff: position.danMaterialDiff,
    nonEmptyPitDiff: position.nonEmptyPitDiff,
    legalMoves: position.legalMoves,
    balancePenalty: position.balancePenalty,
    prefix: position.moves.map((move) => `${move.pit}:${move.dir}`),
  };
});

const result = {
  purpose: "State-balanced Standard-rule midgame corpus derived from frozen 50M-node V3 principal variations.",
  count: rows.length,
  sourceCounts: Object.fromEntries(
    [...new Set(rows.map((row) => row.source))].map((source) => [
      source,
      rows.filter((row) => row.source === source).length,
    ]),
  ),
  moverCounts: {
    P0: rows.filter((row) => row.currentPlayer === "P0").length,
    P1: rows.filter((row) => row.currentPlayer === "P1").length,
  },
  depthRange: rows.length > 0 ? [Math.min(...rows.map((row) => row.depth)), Math.max(...rows.map((row) => row.depth))] : null,
  averageScoreDiff: mean(rows.map((row) => row.scoreDiff)),
  averageDanMaterialDiff: mean(rows.map((row) => row.danMaterialDiff)),
  rows,
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function stringArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
