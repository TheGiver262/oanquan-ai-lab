import { describe, expect, it } from "vitest";
import { getLegalMoves } from "../src/engine.js";
import {
  BALANCED_MIDGAME_POSITIONS,
  replayBalancedPosition,
} from "../src/research/v3-balanced-midgame-corpus.js";

describe("balanced V3 midgame corpus", () => {
  it("contains diverse legal non-terminal positions", () => {
    expect(BALANCED_MIDGAME_POSITIONS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(BALANCED_MIDGAME_POSITIONS.map((position) => position.source)).size).toBe(4);
    expect(new Set(BALANCED_MIDGAME_POSITIONS.map((position) => position.id)).size).toBe(
      BALANCED_MIDGAME_POSITIONS.length,
    );

    for (const position of BALANCED_MIDGAME_POSITIONS) {
      const state = replayBalancedPosition(position);
      expect(state.status).toBe("playing");
      expect(position.moves).toHaveLength(position.depth);
      expect(getLegalMoves(state).length).toBeGreaterThanOrEqual(2);
      expect(position.scoreDiff).toBeLessThanOrEqual(14);
      expect(position.danMaterialDiff).toBeLessThanOrEqual(14);
      const quan = state.pits.filter((pit) => pit.kind === "quan");
      expect(quan).toHaveLength(2);
      expect(quan.every((pit) => pit.quanStones > 0)).toBe(true);
    }
  });

  it("covers both sides to move", () => {
    const movers = new Set(
      BALANCED_MIDGAME_POSITIONS.map((position) => replayBalancedPosition(position).currentPlayer),
    );
    expect(movers).toEqual(new Set(["P0", "P1"]));
  });
});
