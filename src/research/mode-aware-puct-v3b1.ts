import type { BalanceState } from "./balance-modes.js";
import {
  ModeAwarePuctV3A,
  type ModeAwarePuctV3ADecision,
  type ModeAwarePuctV3AOptions,
} from "./mode-aware-puct-v3a.js";
import { V3A1_LEAF_SCORE_MATERIAL_MAX } from "./puct-v3a1.js";

export type ModeAwarePuctV3B1Options = Omit<
  ModeAwarePuctV3AOptions,
  "leafScoreMaterialMax" | "leafScoreHighMaterialGate" | "proofNumberBiasCoefficient"
>;

/**
 * V3B.1 research challenger.
 *
 * Keeps V3A.2 value semantics and adds per-agent PNSum proof-number guidance
 * only to PUCT selection.
 */
export class ModeAwarePuctV3B1 extends ModeAwarePuctV3A {
  constructor(private readonly proofNumberBiasCoefficient: number) {
    super();
    if (
      !Number.isFinite(proofNumberBiasCoefficient)
      || proofNumberBiasCoefficient < 0
    ) {
      throw new Error("proofNumberBiasCoefficient must be a finite non-negative number");
    }
  }

  override chooseAction(
    state: BalanceState,
    options: ModeAwarePuctV3B1Options = {},
  ): ModeAwarePuctV3ADecision {
    return super.chooseAction(state, {
      ...options,
      leafScoreMaterialMax: V3A1_LEAF_SCORE_MATERIAL_MAX,
      leafScoreHighMaterialGate: "positive_only",
      proofNumberBiasCoefficient: this.proofNumberBiasCoefficient,
    });
  }
}
