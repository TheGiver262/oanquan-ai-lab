import { describe, expect, it } from "vitest";
import { applyMove, createInitialState, getLegalMoves } from "../src/engine.js";
import { ReusableScoreBoundedPuct } from "../src/research/puct-v3a.js";
import { computePnSumBonuses, PnSumPuctV3C } from "../src/research/puct-v3c.js";

describe("PUCT V3C", () => {
  it("implements PNSum normalization including infinite proof numbers", () => {
    const bonuses = computePnSumBonuses([1, 2, null]);
    expect(bonuses[0]).toBeCloseTo(0.75, 12);
    expect(bonuses[1]).toBeCloseTo(0.5, 12);
    expect(bonuses[2]).toBe(0);
    expect(computePnSumBonuses([0, 1])).toEqual([1, 0.5]);
    expect(computePnSumBonuses([null, null])).toEqual([0, 0]);
  });

  it("returns a legal move with normalized priors and PNSum metadata", () => {
    const state = createInitialState();
    const legal = new Set(getLegalMoves(state).map((move) => `${move.pit}:${move.dir}`));
    const engine = new PnSumPuctV3C();
    const decision = engine.chooseMove(state, {
      simulations: 96,
      puctExploration: 1.5,
      policyTemperature: 0.6,
      proofBias: 0.05,
    });

    expect(decision.move).not.toBeNull();
    expect(legal.has(`${decision.move?.pit}:${decision.move?.dir}`)).toBe(true);
    expect(decision.rootStats).toHaveLength(10);
    expect(decision.rootStats.reduce((sum, entry) => sum + entry.prior, 0)).toBeCloseTo(1, 10);
    expect(decision.rootStats.every((entry) => entry.pnSumBonus >= 0 && entry.pnSumBonus <= 1)).toBe(true);
    expect(decision.diagnostics.rootProofNumbers.P0).not.toBeNull();
    expect(decision.diagnostics.rootProofNumbers.P1).not.toBeNull();
  });

  it("reduces exactly to V3A selection when Cpn is zero at fixed simulations", () => {
    const state = createInitialState();
    const v3a = new ReusableScoreBoundedPuct();
    const v3c = new PnSumPuctV3C();
    const baseline = v3a.chooseMove(state, {
      simulations: 192,
      puctExploration: 1.5,
      policyTemperature: 0.6,
    });
    const ablation = v3c.chooseMove(state, {
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

  it("reuses the same root and actual two-ply subtree as V3A", () => {
    const state = createInitialState();
    const engine = new PnSumPuctV3C();
    const first = engine.chooseMove(state, { simulations: 160, proofBias: 0.05 });
    const sameRoot = engine.chooseMove(state, { simulations: 16, proofBias: 0.05 });
    expect(sameRoot.diagnostics.reusedRoot).toBe(true);
    expect(sameRoot.diagnostics.reusedRootVisits).toBeGreaterThan(0);
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

    const next = engine.chooseMove(afterOpponent.state, { simulations: 24, proofBias: 0.05 });
    expect(next.diagnostics.reusedRoot).toBe(true);
    expect(next.diagnostics.reusedRootVisits).toBeGreaterThan(0);
    expect(next.diagnostics.retainedNodes).toBeGreaterThan(0);
  });

  it("preserves exact terminal outcomes and terminal proof numbers", () => {
    const terminal = createInitialState();
    terminal.status = "finished";
    terminal.winner = "P0";
    terminal.scores.P0 = 60;
    terminal.scores.P1 = 10;

    const decision = new PnSumPuctV3C().chooseMove(terminal, { simulations: 32, proofBias: 0.05 });
    expect(decision.move).toBeNull();
    expect(decision.diagnostics.solvedRoot).toBe(1);
    expect(decision.diagnostics.rootProofNumbers).toEqual({ P0: 0, P1: null });
  });

  it("rejects invalid proof-bias settings", () => {
    const state = createInitialState();
    expect(() => new PnSumPuctV3C().chooseMove(state, { proofBias: -0.01 })).toThrow(
      "proofBias must be finite and >= 0",
    );
    expect(() => new PnSumPuctV3C().chooseMove(state, { proofBias: Number.POSITIVE_INFINITY })).toThrow(
      "proofBias must be finite and >= 0",
    );
  });
});
