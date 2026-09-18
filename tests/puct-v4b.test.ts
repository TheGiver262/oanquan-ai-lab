import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/engine.js";
import { ReusableScoreBoundedPuct } from "../src/research/puct-v3a.js";
import {
  RefutationOnlyPuctV4B,
  V4B_REFUTATION_SCORE_SWING,
} from "../src/research/puct-v4b.js";

describe("PUCT V4B refutation-only wrapper", () => {
  it("matches explicit material36 + unstable_refutation_only q10", () => {
    const state = createInitialState();
    const explicit = new ReusableScoreBoundedPuct().chooseMove(state, {
      simulations: 512,
      puctExploration: 1.5,
      policyTemperature: 0.6,
      leafScoreWeight: 1.8,
      leafScoreMaterialMax: 36,
      leafBootstrap: "unstable_refutation_only",
      leafQuiescenceScoreSwing: 10,
    });
    const canonical = new RefutationOnlyPuctV4B().chooseMove(state, {
      simulations: 512,
      puctExploration: 1.5,
      policyTemperature: 0.6,
      leafScoreWeight: 1.8,
    });

    expect(V4B_REFUTATION_SCORE_SWING).toBe(10);
    expect(canonical.move).toEqual(explicit.move);
    expect(canonical.rootStats).toEqual(explicit.rootStats);
    const { elapsedMs: canonicalElapsed, ...canonicalDiagnostics } = canonical.diagnostics;
    const { elapsedMs: explicitElapsed, ...explicitDiagnostics } = explicit.diagnostics;
    expect(canonicalElapsed).toBeGreaterThanOrEqual(0);
    expect(explicitElapsed).toBeGreaterThanOrEqual(0);
    expect(canonicalDiagnostics).toEqual(explicitDiagnostics);
  });
});
