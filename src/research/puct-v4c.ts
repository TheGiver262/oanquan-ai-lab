import type { GameState } from "../types.js";
import {
  ReusableScoreBoundedPuct,
  type PuctV3ADecision,
  type PuctV3AOptions,
} from "./puct-v3a.js";
import { V3A1_LEAF_SCORE_MATERIAL_MAX } from "./puct-v3a1.js";

export const V4C_OPPONENT_REFUTATION_SCORE_SWING = 10 as const;

export type PuctV4COptions = Omit<
  PuctV3AOptions,
  "leafScoreMaterialMax" | "leafBootstrap" | "leafQuiescenceScoreSwing"
>;

/**
 * V4C opponent-turn refutation challenger.
 *
 * Baseline is V3A.1 material36. Tactical one-ply refutation is permitted only
 * when the heuristic leaf is to move for the opponent. The result may only
 * lower the incumbent static value. On engine-to-move leaves, V3A.1 static
 * evaluation is preserved exactly.
 */
export class OpponentRefutationPuctV4C extends ReusableScoreBoundedPuct {
  override chooseMove(state: GameState, options: PuctV4COptions = {}): PuctV3ADecision {
    return super.chooseMove(state, {
      ...options,
      leafScoreMaterialMax: V3A1_LEAF_SCORE_MATERIAL_MAX,
      leafBootstrap: "unstable_opponent_refutation_only",
      leafQuiescenceScoreSwing: V4C_OPPONENT_REFUTATION_SCORE_SWING,
    });
  }
}
