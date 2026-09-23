import type { BalanceState } from "./balance-modes.js";
import {
  ModeAwarePuctV3A,
  type ModeAwarePuctV3ADecision,
  type ModeAwarePuctV3AOptions,
} from "./mode-aware-puct-v3a.js";
import { V3A1_LEAF_SCORE_MATERIAL_MAX } from "./puct-v3a1.js";

export type ModeAwarePuctV3A2Options = Omit<
  ModeAwarePuctV3AOptions,
  "leafScoreMaterialMax" | "leafScoreHighMaterialGate" | "proofNumberBiasCoefficient"
>;

/**
 * V3A.2 research candidate.
 *
 * Above material36, suppress only positive scoreDelta. Negative scoreDelta
 * remains active so early/midgame searches keep a penalty for being behind.
 * At material <=36 this is identical to V3A/V3A.1 score weighting.
 */
export class ModeAwarePuctV3A2 extends ModeAwarePuctV3A {
  override chooseAction(
    state: BalanceState,
    options: ModeAwarePuctV3A2Options = {},
  ): ModeAwarePuctV3ADecision {
    return super.chooseAction(state, {
      ...options,
      leafScoreMaterialMax: V3A1_LEAF_SCORE_MATERIAL_MAX,
      leafScoreHighMaterialGate: "positive_only",
      proofNumberBiasCoefficient: 0,
    });
  }
}
