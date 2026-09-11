import { describe, expect, it } from "vitest";
import { getLegalMoves } from "../src/engine.js";
import {
  BALANCED_MIDGAME_POSITIONS,
  replayBalancedPosition,
} from "../src/research/v3-balanced-midgame-corpus.js";

describe("balanced V3 midgame corpus", () => {
  it("contains diverse legal non-terminal positions", () => {
    expect(BALANCED_MIDGAME_POSITIONS.length).toBeGreaterThanOrEqual(9);
    expect(new Set(BALANCED_MIDGAME_POSITIONS.map((position) => position.source)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(BALANCED_MIDGAME_POSITIONS.map((position) => position.id)).size).toBe(
      BALANCED_MIDGAME_POSITIONS.length,
    );

    for (const position of BALANCED_MIDGAME_POSITIONS) {
      const state = replayBalancedPosition(position);
      expect(state.status).toBe("playing");
      expect(position.moves).toHaveLength(position.depth);
      expect(getLegalMoves(state).length).toBeGreaterThanOrEqual(2);
      expect(position.scoreDiff).toBeLessThanOrEqual(15);
      expect(Number.isFinite(position.balancePenalty)).toBe(true);
      expect(position.quanAlive).toBeGreaterThanOrEqual(0);
      expect(position.quanAlive).toBeLessThanOrEqual(2);
      const p0NonEmpty = state.pits.filter((pit) => pit.owner === "P0" && pit.kind === "dan" && pit.stones > 0).length;
      const p1NonEmpty = state.pits.filter((pit) => pit.owner === "P1" && pit.kind === "dan" && pit.stones > 0).length;
      expect(p0NonEmpty).toBeGreaterThanOrEqual(1);
      expect(p1NonEmpty).toBeGreaterThanOrEqual(1);
    }
  });

  it("covers both sides to move", () => {
    const movers = new Set(
      BALANCED_MIDGAME_POSITIONS.map((position) => replayBalancedPosition(position).currentPlayer),
    );
    expect(movers).toEqual(new Set(["P0", "P1"]));
  });
});
