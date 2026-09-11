import { describe, expect, it } from "vitest";
import { createInitialState, getLegalMoves } from "../src/engine.js";
import { ReusableScoreBoundedPuct } from "../src/research/puct-v3a.js";

describe("PUCT V3A", () => {
  it("returns a legal move and normalized root priors", () => {
    const state = createInitialState();
    const legal = new Set(getLegalMoves(state).map((move) => `${move.pit}:${move.dir}`));
    const engine = new ReusableScoreBoundedPuct();
    const decision = engine.chooseMove(state, {
      simulations: 64,
      puctExploration: 1.5,
      policyTemperature: 0.6,
    });

    expect(decision.move).not.toBeNull();
    expect(legal.has(`${decision.move?.pit}:${decision.move?.dir}`)).toBe(true);
    expect(decision.rootStats).toHaveLength(10);
    expect(decision.rootStats.reduce((sum, entry) => sum + entry.prior, 0)).toBeCloseTo(1, 10);
  });

  it("reuses the existing root instead of rebuilding the tree", () => {
    const state = createInitialState();
    const engine = new ReusableScoreBoundedPuct();
    const first = engine.chooseMove(state, { simulations: 48 });
    const second = engine.chooseMove(state, { simulations: 16 });

    expect(first.diagnostics.reusedRoot).toBe(false);
    expect(second.diagnostics.reusedRoot).toBe(true);
    expect(second.diagnostics.reusedRootVisits).toBeGreaterThan(0);
  });

  it("preserves exact terminal W/D/L without inventing repetition outcomes", () => {
    const terminal = createInitialState();
    terminal.status = "finished";
    terminal.winner = "P0";
    terminal.scores.P0 = 60;
    terminal.scores.P1 = 10;

    const engine = new ReusableScoreBoundedPuct();
    const decision = engine.chooseMove(terminal, { simulations: 32 });
    expect(decision.move).toBeNull();
    expect(decision.diagnostics.solvedRoot).toBe(1);
  });

  it("rejects invalid exploration settings", () => {
    const state = createInitialState();
    expect(() => new ReusableScoreBoundedPuct().chooseMove(state, { puctExploration: 0 })).toThrow(
      "puctExploration must be > 0",
    );
    expect(() => new ReusableScoreBoundedPuct().chooseMove(state, { policyTemperature: 0 })).toThrow(
      "policyTemperature must be > 0",
    );
  });
});
