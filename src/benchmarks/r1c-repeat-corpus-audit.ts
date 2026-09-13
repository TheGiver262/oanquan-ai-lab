import { writeFileSync } from "node:fs";
import {
  LIVE_QUAN_BALANCED_POSITIONS,
  replayLiveQuanPosition,
} from "../research/v3-live-quan-corpus.js";
import {
  BALANCED_MIDGAME_POSITIONS,
  replayBalancedPosition,
} from "../research/v3-balanced-midgame-corpus.js";

const outPath = stringArg("--out");

const result = {
  experiment: "R1c-repeat-aware-corpus-audit",
  ruleset: "oaq:classic_2p:standard:v1",
  stateEquivalence: "board + scores + side-to-move + terminal phase + last-six move history",
  liveQuan: LIVE_QUAN_BALANCED_POSITIONS.map((position) => {
    const state = replayLiveQuanPosition(position);
    return {
      id: position.id,
      depth: position.depth,
      opening: position.opening,
      currentPlayer: state.currentPlayer,
      recentMoves: state.recentMoves.map((move) => `${move.player}:${move.pit}:${move.dir}`),
    };
  }),
  balancedMidgame: BALANCED_MIDGAME_POSITIONS.map((position) => {
    const state = replayBalancedPosition(position);
    return {
      id: position.id,
      source: position.source,
      depth: position.depth,
      currentPlayer: state.currentPlayer,
      recentMoves: state.recentMoves.map((move) => `${move.player}:${move.pit}:${move.dir}`),
    };
  }),
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function stringArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}
