import type { BalanceState } from "./balance-modes.js";
import {
  ModeAwarePuctV3A,
  type ModeAwarePuctV3ADecision,
  type ModeAwarePuctV3AOptions,
} from "./mode-aware-puct-v3a.js";
import { V3A1_LEAF_SCORE_MATERIAL_MAX } from "./puct-v3a1.js";

export type ModeAwarePuctV3B1GlobalOptions = Omit<
  ModeAwarePuctV3AOptions,
  "leafScoreMaterialMax" | "leafScoreHighMaterialGate" | "proofNumberBiasCoefficient"
>;

/**
 * V3B.1-G global-safe model.
 *
 * Uses V3A.2 value semantics in every ruleset.
 * Enables the proven V3B.1 PNSum Cpn=2.0 only in Quan Gia + Threefold.
 * Pie + Threefold and Standard retain Cpn=0, making them equivalent to V3A.2.
 */
export class ModeAwarePuctV3B1Global extends ModeAwarePuctV3A {
  override chooseAction(
    state: BalanceState,
    options: ModeAwarePuctV3B1GlobalOptions = {},
  ): ModeAwarePuctV3ADecision {
    const proofNumberBiasCoefficient =
      state.mode === "quan-gia-threefold" ? 2.0 : 0;

    return super.chooseAction(state, {
      ...options,
      leafScoreMaterialMax: V3A1_LEAF_SCORE_MATERIAL_MAX,
      leafScoreHighMaterialGate: "positive_only",
      proofNumberBiasCoefficient,
    });
  }
}
