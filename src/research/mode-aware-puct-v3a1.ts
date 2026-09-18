import type { BalanceState } from "./balance-modes.js";
import {
  ModeAwarePuctV3A,
  type ModeAwarePuctV3ADecision,
  type ModeAwarePuctV3AOptions,
} from "./mode-aware-puct-v3a.js";
import { V3A1_LEAF_SCORE_MATERIAL_MAX } from "./puct-v3a1.js";

export type ModeAwarePuctV3A1Options = Omit<ModeAwarePuctV3AOptions, "leafScoreMaterialMax">;

/**
 * Mode-aware adapter for the canonical PUCT V3A.1 material gate.
 * Reflection/canonicalization behavior remains inherited from V3A.
 */
export class ModeAwarePuctV3A1 extends ModeAwarePuctV3A {
  override chooseAction(
    state: BalanceState,
    options: ModeAwarePuctV3A1Options = {},
  ): ModeAwarePuctV3ADecision {
    return super.chooseAction(state, {
      ...options,
      leafScoreMaterialMax: V3A1_LEAF_SCORE_MATERIAL_MAX,
    });
  }
}
