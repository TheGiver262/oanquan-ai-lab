import type { GameState } from "../types.js";
import {
  ReusableScoreBoundedPuct,
  type PuctV3ADecision,
  type PuctV3AOptions,
} from "./puct-v3a.js";
import { V3A1_LEAF_SCORE_MATERIAL_MAX } from "./puct-v3a1.js";

export const V4B_REFUTATION_SCORE_SWING = 10 as const;

export type PuctV4BOptions = Omit<
  PuctV3AOptions,
  "leafScoreMaterialMax" | "leafBootstrap" | "leafQuiescenceScoreSwing"
>;

/**
 * V4B refutation-only tactical challenger.
 *
 * Baseline is V3A.1 material36. At tactically unstable heuristic leaves,
 * inspect already-expanded children exactly as V4 q10 did, but clamp the
 * one-ply result so it may only LOWER the incumbent static leaf value.
 * It can refute optimism; it cannot create additional optimism.
 */
export class RefutationOnlyPuctV4B extends ReusableScoreBoundedPuct {
  override chooseMove(state: GameState, options: PuctV4BOptions = {}): PuctV3ADecision {
    return super.chooseMove(state, {
      ...options,
      leafScoreMaterialMax: V3A1_LEAF_SCORE_MATERIAL_MAX,
      leafBootstrap: "unstable_refutation_only",
      leafQuiescenceScoreSwing: V4B_REFUTATION_SCORE_SWING,
    });
  }
}
