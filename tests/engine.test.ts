import { describe, expect, test } from "vitest";
import { applyMove, createInitialState, createStateHash, getLegalMoves } from "../src/engine.js";
import { perft } from "../src/analysis.js";

describe("classic engine", () => {
  test("initial position matches production classic board", () => {
    const state = createInitialState();
    expect(state.pits.filter((p) => p.kind === "dan").every((p) => p.stones === 5)).toBe(true);
    expect(state.pits.filter((p) => p.kind === "quan").every((p) => p.quanStones === 1)).toBe(true);
    expect(state.currentPlayer).toBe("P0");
  });
  test("initial position has 10 legal moves", () => {
    expect(getLegalMoves(createInitialState())).toHaveLength(10);
    expect(perft(createInitialState(), 1)).toBe(10);
  });
  test("state hash is deterministic", () => {
    expect(createStateHash(createInitialState())).toBe(createStateHash(createInitialState()));
  });
  test("legal move changes player", () => {
    const result = applyMove(createInitialState(), { player: "P0", pit: "B3", dir: "CW" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.currentPlayer).toBe("P1");
  });
});
