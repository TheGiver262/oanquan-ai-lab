import { describe, expect, it } from "vitest";
import { getLegalMoves } from "../src/engine.js";
import {
  LIVE_QUAN_BALANCED_POSITIONS,
  replayLiveQuanPosition,
} from "../src/research/v3-live-quan-corpus.js";

describe("live-Quan balanced corpus", () => {
  it("builds two balanced diverse positions at every target depth", () => {
    expect(LIVE_QUAN_BALANCED_POSITIONS).toHaveLength(16);
    const depthCounts = new Map<number, number>();
    for (const position of LIVE_QUAN_BALANCED_POSITIONS) {
      depthCounts.set(position.depth, (depthCounts.get(position.depth) ?? 0) + 1);
      const state = replayLiveQuanPosition(position);
      expect(state.status).toBe("playing");
      expect(position.moves).toHaveLength(position.depth);
      expect(position.scoreDiff).toBeLessThanOrEqual(8);
      expect(position.danMaterialDiff).toBeLessThanOrEqual(10);
      expect(getLegalMoves(state).length).toBeGreaterThanOrEqual(3);
      const quan = state.pits.filter((pit) => pit.kind === "quan");
      expect(quan).toHaveLength(2);
      expect(quan.every((pit) => pit.quanStones > 0)).toBe(true);
    }
    for (let depth = 4; depth <= 11; depth += 1) expect(depthCounts.get(depth)).toBe(2);
  });

  it("covers multiple openings and both players to move", () => {
    expect(new Set(LIVE_QUAN_BALANCED_POSITIONS.map((position) => position.opening)).size).toBeGreaterThanOrEqual(4);
    const movers = new Set(
      LIVE_QUAN_BALANCED_POSITIONS.map((position) => replayLiveQuanPosition(position).currentPlayer),
    );
    expect(movers).toEqual(new Set(["P0", "P1"]));
  });
});
