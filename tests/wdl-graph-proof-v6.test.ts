import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/engine.js";
import {
  isGraphWdlHistorySafe,
  proveWdlByGraphV6,
} from "../src/research/wdl-graph-proof-v6.js";
import { createPolicyState, type PolicyState } from "../src/research/repetition-policy-v5.js";

describe("V6 graph WDL proof", () => {
  it("accepts fresh threefold history but rejects second-occurrence history", () => {
    const policy = { kind: "repeat-draw", occurrences: 3 } as const;
    const fresh = createPolicyState(createInitialState());
    expect(isGraphWdlHistorySafe(fresh, policy)).toBe(true);

    const key = [...fresh.repetitionCounts.keys()][0]!;
    const repeated: PolicyState = {
      ...fresh,
      repetitionCounts: new Map([[key, 2]]),
    };
    expect(isGraphWdlHistorySafe(repeated, policy)).toBe(false);
  });

  it("does not reuse the board-only graph proof for repeat-2 or max-ply", () => {
    const state = createPolicyState(createInitialState());
    expect(isGraphWdlHistorySafe(state, { kind: "repeat-draw", occurrences: 2 })).toBe(false);
    expect(isGraphWdlHistorySafe(state, { kind: "max-ply", maxPlies: 200 })).toBe(false);
    expect(isGraphWdlHistorySafe(state, { kind: "none" })).toBe(true);
  });

  it("returns exact terminal WDL without graph expansion", () => {
    const game = createInitialState();
    game.status = "finished";
    game.winner = "P0";
    game.currentPlayer = "P0";
    game.scores = { P0: 40, P1: 30 };
    const root = createPolicyState(game);

    const result = proveWdlByGraphV6(root, { kind: "repeat-draw", occurrences: 3 });
    expect(result.solved).toBe(true);
    expect(result.outcome).toBe("win");
    expect(result.diagnostics.graphNodes).toBe(1);
    expect(result.diagnostics.terminalNodes).toBe(1);
  });

  it("reports terminal loss from the final mover perspective", () => {
    const game = createInitialState();
    game.status = "finished";
    game.winner = "P1";
    game.currentPlayer = "P0";
    game.scores = { P0: 20, P1: 50 };
    const root = createPolicyState(game);

    const result = proveWdlByGraphV6(root, { kind: "repeat-draw", occurrences: 3 });
    expect(result.solved).toBe(true);
    expect(result.outcome).toBe("loss");
  });
});
