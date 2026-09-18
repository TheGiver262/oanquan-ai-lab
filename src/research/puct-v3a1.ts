import type { GameState } from "../types.js";
import {
  ReusableScoreBoundedPuct,
  type PuctV3ADecision,
  type PuctV3AOptions,
} from "./puct-v3a.js";

export const V3A1_LEAF_SCORE_MATERIAL_MAX = 36 as const;

export type PuctV3A1Options = Omit<
  PuctV3AOptions,
  "leafScoreMaterialMax" | "leafBootstrap" | "leafQuiescenceScoreSwing"
>;

/**
 * Canonical PUCT V3A.1 research incumbent.
 *
 * V3A.1 preserves V3A search, priors, subtree reuse and solved propagation.
 * Its single algorithmic change is to suppress scoreDelta in heuristic leaves
 * while raw board material is above 36 stones, reducing the validated
 * early/midgame horizon bias. The original V3A class remains unchanged and is
 * retained as the historical baseline.
 */
export class MaterialGatedReusableScoreBoundedPuct extends ReusableScoreBoundedPuct {
  override chooseMove(state: GameState, options: PuctV3A1Options = {}): PuctV3ADecision {
    return super.chooseMove(state, {
      ...options,
      leafScoreMaterialMax: V3A1_LEAF_SCORE_MATERIAL_MAX,
    });
  }
}
