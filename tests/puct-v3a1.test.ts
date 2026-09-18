import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/engine.js";
import { createBalanceInitialState } from "../src/research/balance-modes.js";
import { ModeAwarePuctV3A } from "../src/research/mode-aware-puct-v3a.js";
import { ModeAwarePuctV3A1 } from "../src/research/mode-aware-puct-v3a1.js";
import { ReusableScoreBoundedPuct } from "../src/research/puct-v3a.js";
import {
  MaterialGatedReusableScoreBoundedPuct,
  V3A1_LEAF_SCORE_MATERIAL_MAX,
} from "../src/research/puct-v3a1.js";

describe("PUCT V3A.1 material36 wrapper", () => {
  it("matches plain V3A configured explicitly with material max 36", () => {
    const state = createInitialState();
    const explicit = new ReusableScoreBoundedPuct().chooseMove(state, {
      simulations: 512,
      puctExploration: 1.5,
      policyTemperature: 0.6,
      leafScoreMaterialMax: 36,
    });
    const canonical = new MaterialGatedReusableScoreBoundedPuct().chooseMove(state, {
      simulations: 512,
      puctExploration: 1.5,
      policyTemperature: 0.6,
    });

    expect(V3A1_LEAF_SCORE_MATERIAL_MAX).toBe(36);
    expect(canonical.move).toEqual(explicit.move);
    expect(canonical.rootStats).toEqual(explicit.rootStats);
    const { elapsedMs: canonicalElapsed, ...canonicalDiagnostics } = canonical.diagnostics;
    const { elapsedMs: explicitElapsed, ...explicitDiagnostics } = explicit.diagnostics;
    expect(canonicalElapsed).toBeGreaterThanOrEqual(0);
    expect(explicitElapsed).toBeGreaterThanOrEqual(0);
    expect(canonicalDiagnostics).toEqual(explicitDiagnostics);
  });

  it("matches mode-aware V3A configured explicitly with material max 36", () => {
    const state = createBalanceInitialState("standard");
    const explicit = new ModeAwarePuctV3A().chooseAction(state, {
      simulations: 512,
      puctExploration: 1.5,
      policyTemperature: 0.6,
      leafScoreMaterialMax: 36,
    });
    const canonical = new ModeAwarePuctV3A1().chooseAction(state, {
      simulations: 512,
      puctExploration: 1.5,
      policyTemperature: 0.6,
    });

    expect(canonical.action).toEqual(explicit.action);
    expect(canonical.rootStats).toEqual(explicit.rootStats);
    const { elapsedMs: canonicalElapsed, ...canonicalDiagnostics } = canonical.diagnostics;
    const { elapsedMs: explicitElapsed, ...explicitDiagnostics } = explicit.diagnostics;
    expect(canonicalElapsed).toBeGreaterThanOrEqual(0);
    expect(explicitElapsed).toBeGreaterThanOrEqual(0);
    expect(canonicalDiagnostics).toEqual(explicitDiagnostics);
  });
});
