import { describe, expect, it } from "vitest";
import { createBalanceInitialState } from "../src/research/balance-modes.js";
import { ModeAwarePuctV3A } from "../src/research/mode-aware-puct-v3a.js";

describe("V4 selective quiescence research option", () => {
  it("keeps default/static behavior unchanged", () => {
    const state = createBalanceInitialState("standard");
    const implicit = new ModeAwarePuctV3A().chooseAction(state, {
      simulations: 512,
      puctExploration: 1.5,
      policyTemperature: 0.6,
      leafScoreMaterialMax: 36,
    });
    const explicit = new ModeAwarePuctV3A().chooseAction(state, {
      simulations: 512,
      puctExploration: 1.5,
      policyTemperature: 0.6,
      leafScoreMaterialMax: 36,
      leafBootstrap: "static",
      leafQuiescenceScoreSwing: 10,
    });

    expect(explicit.action).toEqual(implicit.action);
    expect(explicit.rootStats).toEqual(implicit.rootStats);
    const { elapsedMs: implicitElapsed, ...implicitDiagnostics } = implicit.diagnostics;
    const { elapsedMs: explicitElapsed, ...explicitDiagnostics } = explicit.diagnostics;
    expect(implicitElapsed).toBeGreaterThanOrEqual(0);
    expect(explicitElapsed).toBeGreaterThanOrEqual(0);
    expect(explicitDiagnostics).toEqual(implicitDiagnostics);
  });

  it("does not change policy priors when selective quiescence is enabled", () => {
    const state = createBalanceInitialState("standard");
    const baseline = new ModeAwarePuctV3A().chooseAction(state, {
      simulations: 256,
      leafScoreMaterialMax: 36,
      leafBootstrap: "static",
    });
    const candidate = new ModeAwarePuctV3A().chooseAction(state, {
      simulations: 256,
      leafScoreMaterialMax: 36,
      leafBootstrap: "unstable_one_ply",
      leafQuiescenceScoreSwing: 10,
    });
    const key = (entry: { action: { kind: string; [key: string]: unknown }; prior: number }) =>
      JSON.stringify(entry.action);
    const priors = (decision: typeof baseline) =>
      new Map(decision.rootStats.map((entry) => [key(entry), entry.prior]));

    expect(priors(candidate)).toEqual(priors(baseline));
  });

  it("rejects invalid selective-quiescence thresholds", () => {
    const state = createBalanceInitialState("standard");
    expect(() =>
      new ModeAwarePuctV3A().chooseAction(state, {
        simulations: 8,
        leafBootstrap: "unstable_one_ply",
        leafQuiescenceScoreSwing: -1,
      }),
    ).toThrow("leafQuiescenceScoreSwing must be a finite non-negative number");
  });
});
