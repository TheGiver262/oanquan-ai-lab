import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/engine.js";
import { ReusableScoreBoundedPuct } from "../src/research/puct-v3a.js";
import { MaterialGatedReusableScoreBoundedPuct } from "../src/research/puct-v3a1.js";
import {
  SelectiveQuiescencePuctV4,
  V4_QUIESCENCE_SCORE_SWING,
} from "../src/research/puct-v4.js";

describe("PUCT V4 selective quiescence", () => {
  it("matches explicit material36 + unstable one-ply q10 configuration", () => {
    const state = createInitialState();
    const explicit = new ReusableScoreBoundedPuct().chooseMove(state, {
      simulations: 512,
      puctExploration: 1.5,
      policyTemperature: 0.6,
      leafScoreWeight: 1.8,
      leafScoreMaterialMax: 36,
      leafBootstrap: "unstable_one_ply",
      leafQuiescenceScoreSwing: 10,
    });
    const v4 = new SelectiveQuiescencePuctV4().chooseMove(state, {
      simulations: 512,
      puctExploration: 1.5,
      policyTemperature: 0.6,
      leafScoreWeight: 1.8,
    });

    expect(V4_QUIESCENCE_SCORE_SWING).toBe(10);
    expect(v4.move).toEqual(explicit.move);
    expect(v4.rootStats).toEqual(explicit.rootStats);
    const { elapsedMs: v4Elapsed, ...v4Diagnostics } = v4.diagnostics;
    const { elapsedMs: explicitElapsed, ...explicitDiagnostics } = explicit.diagnostics;
    expect(v4Elapsed).toBeGreaterThanOrEqual(0);
    expect(explicitElapsed).toBeGreaterThanOrEqual(0);
    expect(v4Diagnostics).toEqual(explicitDiagnostics);
  });

  it("keeps V3A.1 behavior distinct from V4 research options", () => {
    const state = createInitialState();
    const incumbent = new MaterialGatedReusableScoreBoundedPuct().chooseMove(state, {
      simulations: 256,
    });
    const explicitStatic = new ReusableScoreBoundedPuct().chooseMove(state, {
      simulations: 256,
      leafScoreMaterialMax: 36,
      leafBootstrap: "static",
    });

    expect(incumbent.move).toEqual(explicitStatic.move);
    expect(incumbent.rootStats).toEqual(explicitStatic.rootStats);
  });
});
