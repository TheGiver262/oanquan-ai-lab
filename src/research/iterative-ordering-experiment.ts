import { PRODUCTION_TOP_PROFILES, type ProductionProfile } from "../reference/production-ai.js";
import type { GameState, PlayerId } from "../types.js";
import {
  chooseBangNhanExperimentMove,
  type BangNhanExperimentDecision,
  type BangNhanExperimentOptions,
} from "./bang-nhan-ordering-experiment.js";

export type IterativeOrderingDifficulty = "tham-hoa" | "bang-nhan";

/**
 * Reuses the parity-checked Bảng Nhãn experiment implementation with another
 * iterative Alpha-Beta production profile. The canonical reference profiles are
 * restored synchronously after every call.
 *
 * This is research-only code in oanquan-ai-lab. It does not modify O_an_quan.
 */
export function chooseIterativeOrderingExperimentMove(
  state: GameState,
  difficulty: IterativeOrderingDifficulty,
  aiPlayer: PlayerId = state.currentPlayer,
  options: BangNhanExperimentOptions = {},
): BangNhanExperimentDecision {
  if (difficulty === "bang-nhan") {
    return chooseBangNhanExperimentMove(state, aiPlayer, options);
  }

  const experimentSlot = PRODUCTION_TOP_PROFILES["bang-nhan"];
  const originalExperimentSlot = cloneProfile(experimentSlot);
  const targetProfile = cloneProfile(PRODUCTION_TOP_PROFILES[difficulty]);

  // The production opening book intentionally skips the P0 move-0 book entry
  // for Thám Hoa. The original Bảng Nhãn experiment predates that profile
  // parameter, so mirror the production behavior for this one state.
  if (difficulty === "tham-hoa" && state.moveNumber === 0 && aiPlayer === "P0") {
    targetProfile.useOpeningBook = false;
  }

  Object.assign(experimentSlot, targetProfile);
  try {
    return chooseBangNhanExperimentMove(state, aiPlayer, options);
  } finally {
    Object.assign(experimentSlot, originalExperimentSlot);
  }
}

function cloneProfile(profile: ProductionProfile): ProductionProfile {
  return {
    ...profile,
    weights: { ...profile.weights },
    bossBuff: profile.bossBuff ? { ...profile.bossBuff } : null,
  };
}
