import { describe, expect, test } from "vitest";
import {
  applyMove,
  createInitialState,
  createStateHash,
  getLegalMoves,
  hasRepeatedMovePair,
} from "../src/engine.js";
import { perft } from "../src/analysis.js";
import type { MoveSignature } from "../src/types.js";

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

  test("detects exactly the same move-pair repeated three times", () => {
    const a: MoveSignature = { player: "P0", pit: "B3", dir: "CW" };
    const b: MoveSignature = { player: "P1", pit: "T3", dir: "CCW" };
    expect(hasRepeatedMovePair([a, b, a, b, a, b])).toBe(true);
    expect(hasRepeatedMovePair([a, b, a, b, a])).toBe(false);
    expect(hasRepeatedMovePair([
      a,
      b,
      a,
      b,
      a,
      { player: "P1", pit: "T2", dir: "CCW" },
    ])).toBe(false);
  });

  test("repeated_moves collects only dan pits and preserves Quan pieces", () => {
    const state = createInitialState();
    state.currentPlayer = "P1";
    state.moveNumber = 5;
    state.recentMoves = [
      { player: "P0", pit: "B3", dir: "CW" },
      { player: "P1", pit: "T3", dir: "CW" },
      { player: "P0", pit: "B3", dir: "CW" },
      { player: "P1", pit: "T3", dir: "CW" },
      { player: "P0", pit: "B3", dir: "CW" },
    ];

    const result = applyMove(state, { player: "P1", pit: "T3", dir: "CW" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.status).toBe("finished");
    expect(result.state.recentMoves).toHaveLength(6);
    expect(result.events.some((event) => event.type === "turn_changed")).toBe(false);
    expect(result.events).toContainEqual(expect.objectContaining({
      type: "match_finished",
      reason: "repeated_moves",
    }));
    expect(result.state.pits.filter((pit) => pit.kind === "dan").every((pit) => pit.stones === 0)).toBe(true);
    const quan = result.state.pits.filter((pit) => pit.kind === "quan");
    expect(quan).toHaveLength(2);
    expect(quan.every((pit) => pit.quanStones === 1)).toBe(true);
  });
});
