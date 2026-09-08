import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/engine.js";
import {
  boardValue,
  exactStrategicStateKey,
  solveExactEndgame,
  totalGameValue,
} from "../src/research/exact-endgame-v4.js";
import type { GameState } from "../src/types.js";

function reducedDrawFixture(): GameState {
  const state = createInitialState();
  state.pits = state.pits.map((pit) => ({
    ...pit,
    stones: pit.id === "B3" || pit.id === "T3" ? 1 : 0,
    quanStones: 0,
  }));
  state.scores = { P0: 34, P1: 34 };
  state.currentPlayer = "P0";
  state.status = "playing";
  state.winner = null;
  state.moveNumber = 20;
  state.recentMoves = [];
  return state;
}

describe("Opening Balance V4 exact endgame solver", () => {
  it("rejects large roots instead of pretending a heuristic result is exact", () => {
    const result = solveExactEndgame(createInitialState(), {
      maxRootBoardValue: 18,
      nodeBudget: 10_000,
      timeBudgetMs: 5_000,
    });

    expect(result.solved).toBe(false);
    expect(result.status).toBe("outside-material-limit");
    expect(result.value).toBeNull();
    expect(result.diagnostics.rootBoardValue).toBe(70);
  });

  it("solves terminal states exactly regardless of the material gate", () => {
    const state = createInitialState();
    state.status = "finished";
    state.winner = "P0";
    state.scores = { P0: 41, P1: 29 };

    const result = solveExactEndgame(state, { maxRootBoardValue: 0 });
    expect(result.status).toBe("solved");
    expect(result.solved).toBe(true);
    expect(result.value).toBe(12);
    expect(result.outcome).toBe("win");
    expect(result.bestMove).toBeNull();
  });

  it("solves a reduced two-move terminal frontier with exact minimax margin", () => {
    const state = reducedDrawFixture();
    const result = solveExactEndgame(state, {
      maxRootBoardValue: 10,
      nodeBudget: 10_000,
      timeBudgetMs: 5_000,
    });

    expect(result.status).toBe("solved");
    expect(result.solved).toBe(true);
    expect(result.value).toBe(0);
    expect(result.outcome).toBe("draw");
    expect(result.bestMove?.pit).toBe("B3");
    expect(result.principalVariation.length).toBeGreaterThan(0);
  });

  it("uses a rule-relevant canonical key rather than history noise", () => {
    const a = reducedDrawFixture();
    const b = structuredClone(a);
    b.moveNumber = 99;
    b.recentMoves = [
      { player: "P0", pit: "B1", dir: "CW" },
      { player: "P1", pit: "T5", dir: "CCW" },
    ];
    b.skipCounts.P0.total = 123;

    expect(exactStrategicStateKey(a)).toBe(exactStrategicStateKey(b));

    const firstMove = structuredClone(a);
    firstMove.moveNumber = 0;
    expect(exactStrategicStateKey(firstMove)).not.toBe(exactStrategicStateKey(a));
  });

  it("tracks weighted board value and conserved total value", () => {
    const initial = createInitialState();
    expect(boardValue(initial)).toBe(70);
    expect(totalGameValue(initial)).toBe(70);

    const reduced = reducedDrawFixture();
    expect(boardValue(reduced)).toBe(2);
    expect(totalGameValue(reduced)).toBe(70);
  });
});
