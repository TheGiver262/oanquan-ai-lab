import { describe, expect, it } from "vitest";
import { applyMove, createInitialState, getLegalMoves } from "../src/engine.js";
import { ReusableScoreBoundedPuct } from "../src/research/puct-v3a.js";
import { computePnMaxBonuses, GpnPuctV3B } from "../src/research/puct-v3b.js";

describe("PUCT V3B", () => {
  it("implements PNMax normalization including infinite proof numbers", () => {
    expect(computePnMaxBonuses([2, 4, null])).toEqual([1, 1 / 3, 0]);
    expect(computePnMaxBonuses([2, 2])).toEqual([1, 1]);
    expect(computePnMaxBonuses([null, null])).toEqual([0, 0]);
  });

  it("returns a legal move with normalized priors and proof metadata", () => {
    const state = createInitialState();
    const legal = new Set(getLegalMoves(state).map((move) => `${move.pit}:${move.dir}`));
    const engine = new GpnPuctV3B();
    const decision = engine.chooseMove(state, {
      simulations: 96,
      puctExploration: 1.5,
      policyTemperature: 0.6,
      proofBias: 0.1,
    });

    expect(decision.move).not.toBeNull();
    expect(legal.has(`${decision.move?.pit}:${decision.move?.dir}`)).toBe(true);
    expect(decision.rootStats).toHaveLength(10);
    expect(decision.rootStats.reduce((sum, entry) => sum + entry.prior, 0)).toBeCloseTo(1, 10);
    expect(decision.rootStats.every((entry) => entry.pnMaxBonus >= 0 && entry.pnMaxBonus <= 1)).toBe(true);
    expect(decision.diagnostics.rootProofNumbers.P0).not.toBeNull();
    expect(decision.diagnostics.rootProofNumbers.P1).not.toBeNull();
  });

  it("reduces to V3A selection when Cpn is zero under a fixed simulation budget", () => {
    const state = createInitialState();
    const v3a = new ReusableScoreBoundedPuct();
    const v3b = new GpnPuctV3B();
    const baseline = v3a.chooseMove(state, {
      simulations: 192,
      puctExploration: 1.5,
      policyTemperature: 0.6,
    });
    const ablation = v3b.chooseMove(state, {
      simulations: 192,
      puctExploration: 1.5,
      policyTemperature: 0.6,
      proofBias: 0,
    });

    expect(ablation.move).toEqual(baseline.move);
    expect(ablation.rootStats.map((entry) => entry.visits)).toEqual(
      baseline.rootStats.map((entry) => entry.visits),
    );
    expect(ablation.diagnostics.proofBiasSelections).toBe(0);
  });

  it("reuses the actual two-ply subtree like V3A", () => {
    const state = createInitialState();
    const engine = new GpnPuctV3B();
    const first = engine.chooseMove(state, { simulations: 160, proofBias: 0.1 });
    expect(first.move).not.toBeNull();

    const afterResearch = applyMove(state, first.move!);
    expect(afterResearch.ok).toBe(true);
    if (!afterResearch.ok) return;

    const opponentMove = getLegalMoves(afterResearch.state)[0];
    expect(opponentMove).toBeDefined();
    if (!opponentMove) return;

    const afterOpponent = applyMove(afterResearch.state, opponentMove);
    expect(afterOpponent.ok).toBe(true);
    if (!afterOpponent.ok) return;

    const next = engine.chooseMove(afterOpponent.state, { simulations: 24, proofBias: 0.1 });
    expect(next.diagnostics.reusedRoot).toBe(true);
    expect(next.diagnostics.reusedRootVisits).toBeGreaterThan(0);
  });

  it("preserves exact terminal outcomes and terminal proof numbers", () => {
    const terminal = createInitialState();
    terminal.status = "finished";
    terminal.winner = "P0";
    terminal.scores.P0 = 60;
    terminal.scores.P1 = 10;

    const decision = new GpnPuctV3B().chooseMove(terminal, { simulations: 32, proofBias: 0.1 });
    expect(decision.move).toBeNull();
    expect(decision.diagnostics.solvedRoot).toBe(1);
    expect(decision.diagnostics.rootProofNumbers).toEqual({ P0: 0, P1: null });
  });

  it("rejects invalid proof-bias settings", () => {
    const state = createInitialState();
    expect(() => new GpnPuctV3B().chooseMove(state, { proofBias: -0.01 })).toThrow(
      "proofBias must be finite and >= 0",
    );
    expect(() => new GpnPuctV3B().chooseMove(state, { proofBias: Number.POSITIVE_INFINITY })).toThrow(
      "proofBias must be finite and >= 0",
    );
  });
});
