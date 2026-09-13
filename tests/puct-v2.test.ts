import { describe, expect, it } from "vitest";
import { applyMove, createInitialState, getLegalMoves } from "../src/engine.js";
import {
  chooseFrozenPuctV2,
  FROZEN_PUCT_V2_EXPLORATION,
  FROZEN_PUCT_V2_POLICY_TEMPERATURE,
} from "../src/research/puct-v2.js";

describe("frozen PUCT V2 baseline", () => {
  it("locks the promoted comparison parameters", () => {
    expect(FROZEN_PUCT_V2_EXPLORATION).toBe(1.5);
    expect(FROZEN_PUCT_V2_POLICY_TEMPERATURE).toBe(0.6);
  });

  it("returns a legal move with normalized one-ply priors", () => {
    const state = createInitialState();
    const legal = new Set(getLegalMoves(state).map((move) => `${move.pit}:${move.dir}`));
    const decision = chooseFrozenPuctV2(state, { simulations: 64 });

    expect(decision.move).not.toBeNull();
    expect(legal.has(`${decision.move?.pit}:${decision.move?.dir}`)).toBe(true);
    expect(decision.diagnostics.simulations).toBe(64);
    expect(decision.rootStats).toHaveLength(10);
    expect(decision.rootStats.reduce((sum, entry) => sum + entry.prior, 0)).toBeCloseTo(1, 10);
  });

  it("is exactly deterministic at fixed simulations", () => {
    const state = createInitialState();
    const first = chooseFrozenPuctV2(state, { simulations: 192 });
    const second = chooseFrozenPuctV2(state, { simulations: 192 });

    expect(second.move).toEqual(first.move);
    expect(second.diagnostics.simulations).toBe(first.diagnostics.simulations);
    expect(second.diagnostics.expandedNodes).toBe(first.diagnostics.expandedNodes);
    expect(second.diagnostics.maxTreeDepth).toBe(first.diagnostics.maxTreeDepth);
    expect(second.rootStats).toEqual(first.rootStats);
  });

  it("default wrapper parameters equal the explicit frozen parameters", () => {
    const state = createInitialState();
    const implicit = chooseFrozenPuctV2(state, { simulations: 128 });
    const explicit = chooseFrozenPuctV2(state, {
      simulations: 128,
      puctExploration: 1.5,
      policyTemperature: 0.6,
    });

    expect(explicit.move).toEqual(implicit.move);
    expect(explicit.rootStats).toEqual(implicit.rootStats);
  });

  it("stays stateless across actual moves", () => {
    const state = createInitialState();
    const first = chooseFrozenPuctV2(state, { simulations: 96 });
    expect(first.move).not.toBeNull();
    if (!first.move) return;

    const applied = applyMove(state, first.move);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const nextA = chooseFrozenPuctV2(applied.state, { simulations: 96 });
    const nextB = chooseFrozenPuctV2(applied.state, { simulations: 96 });
    expect(nextB.move).toEqual(nextA.move);
    expect(nextB.rootStats).toEqual(nextA.rootStats);
  });

  it("rejects invalid frozen search settings", () => {
    const state = createInitialState();
    expect(() => chooseFrozenPuctV2(state, { puctExploration: 0 })).toThrow(
      "puctExploration must be > 0",
    );
    expect(() => chooseFrozenPuctV2(state, { policyTemperature: 0 })).toThrow(
      "policyTemperature must be > 0",
    );
    expect(() => chooseFrozenPuctV2(state, { simulations: -1 })).toThrow(
      "simulations must be a non-negative safe integer",
    );
  });
});
