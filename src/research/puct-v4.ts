import type { GameState } from "../types.js";
import {
  ReusableScoreBoundedPuct,
  type PuctV3ADecision,
  type PuctV3AOptions,
} from "./puct-v3a.js";
import { V3A1_LEAF_SCORE_MATERIAL_MAX } from "./puct-v3a1.js";

export const V4_QUIESCENCE_SCORE_SWING = 10 as const;

export type PuctV4Options = Omit<
  PuctV3AOptions,
  "leafScoreMaterialMax" | "leafBootstrap" | "leafQuiescenceScoreSwing"
>;

/**
 * V4 selective-quiescence research challenger.
 *
 * Baseline is V3A.1 material36. The only additional change is a one-ply
 * max/min bootstrap at tactically unstable heuristic leaves where an already
 * expanded child changes score delta by at least one quan value (10), or an
 * exact solved/terminal child is immediately visible.
 */
export class SelectiveQuiescencePuctV4 extends ReusableScoreBoundedPuct {
  override chooseMove(state: GameState, options: PuctV4Options = {}): PuctV3ADecision {
    return super.chooseMove(state, {
      ...options,
      leafScoreMaterialMax: V3A1_LEAF_SCORE_MATERIAL_MAX,
      leafBootstrap: "unstable_one_ply",
      leafQuiescenceScoreSwing: V4_QUIESCENCE_SCORE_SWING,
    });
  }
}
