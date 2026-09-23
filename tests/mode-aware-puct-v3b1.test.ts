import { describe, expect, it } from "vitest";
import {
  balanceActionKey,
  createBalanceInitialState,
  getBalanceActions,
} from "../src/research/balance-modes.js";
import {
  ModeAwarePuctV3A,
  proofNumberSumBiases,
} from "../src/research/mode-aware-puct-v3a.js";
import { ModeAwarePuctV3A2 } from "../src/research/mode-aware-puct-v3a2.js";
import { ModeAwarePuctV3B1 } from "../src/research/mode-aware-puct-v3b1.js";
import { V3A1_LEAF_SCORE_MATERIAL_MAX } from "../src/research/puct-v3a1.js";

describe("ModeAwarePuctV3B1", () => {
  it("implements PNSum scaling", () => {
    const equal = proofNumberSumBiases([1, 1, Number.POSITIVE_INFINITY]);
    expect(equal[0]).toBeCloseTo(2 / 3, 12);
    expect(equal[1]).toBeCloseTo(2 / 3, 12);
    expect(equal[2]).toBe(0);
    const scaled = proofNumberSumBiases([1, 3, Number.POSITIVE_INFINITY]);
    expect(scaled[0]).toBeCloseTo(0.8, 12);
    expect(scaled[1]).toBeCloseTo(0.4, 12);
    expect(scaled[2]).toBe(0);
    expect(proofNumberSumBiases([Infinity, Infinity])).toEqual([0, 0]);
  });

  it("is behaviorally identical to V3A.2 when Cpn is zero", () => {
    for (const mode of ["quan-gia-threefold", "pie-threefold", "standard"] as const) {
      const state = createBalanceInitialState(mode);
      const incumbent = new ModeAwarePuctV3A2().chooseAction(state, { simulations: 500 });
      const disabled = new ModeAwarePuctV3A().chooseAction(state, {
        simulations: 500,
        leafScoreMaterialMax: V3A1_LEAF_SCORE_MATERIAL_MAX,
        leafScoreHighMaterialGate: "positive_only",
        proofNumberBiasCoefficient: 0,
      });

      expect(disabled.action).toEqual(incumbent.action);
      expect(
        disabled.rootStats.map((entry) => ({
          action: balanceActionKey(entry.action),
          visits: entry.visits,
          meanValue: entry.meanValue,
          prior: entry.prior,
          solvedOutcome: entry.solvedOutcome,
        })),
      ).toEqual(
        incumbent.rootStats.map((entry) => ({
          action: balanceActionKey(entry.action),
          visits: entry.visits,
          meanValue: entry.meanValue,
          prior: entry.prior,
          solvedOutcome: entry.solvedOutcome,
        })),
      );
    }
  });

  it("returns legal actions for the preregistered Cpn grid", () => {
    const state = createBalanceInitialState("quan-gia-threefold");
    const legal = new Set(getBalanceActions(state).map(balanceActionKey));

    for (const coefficient of [0.5, 1.0, 2.0]) {
      const decision = new ModeAwarePuctV3B1(coefficient).chooseAction(state, { simulations: 200 });
      expect(decision.action).not.toBeNull();
      expect(decision.action ? legal.has(balanceActionKey(decision.action)) : false).toBe(true);
    }
  });

  it("rejects invalid coefficients", () => {
    expect(() => new ModeAwarePuctV3B1(-0.01)).toThrow();
    expect(() => new ModeAwarePuctV3B1(Number.NaN)).toThrow();
  });
});
