import type { PlayerId } from "../types.js";

export type CompetitiveAgentId = "A" | "B";
export type SeatMappingV8 = Readonly<Record<PlayerId, CompetitiveAgentId>>;
export type ImmediateSeatChoiceV8 = "P0" | "P1";

export const KEEP_MAPPING_V8: SeatMappingV8 = { P0: "A", P1: "B" };
export const SWAP_MAPPING_V8: SeatMappingV8 = { P0: "B", P1: "A" };

/**
 * After an odd number of authored setup plies the canonical mover is P1.
 * p1Value is the zero-sum continuation value of owning seat P1.
 * The responder B rationally takes whichever seat has the larger value.
 */
export function rationalResponderSeatFromP1Value(p1Value: number): ImmediateSeatChoiceV8 {
  return p1Value >= 0 ? "P1" : "P0";
}

export function mappingForResponderSeat(seat: ImmediateSeatChoiceV8): SeatMappingV8 {
  return seat === "P1" ? KEEP_MAPPING_V8 : SWAP_MAPPING_V8;
}

export function valueForAgentFromSeatValue(
  p1Value: number,
  mapping: SeatMappingV8,
  agent: CompetitiveAgentId,
): number {
  const p1Agent = mapping.P1;
  return p1Agent === agent ? p1Value : -p1Value;
}

export function winnerAgentFromSeat(
  winnerSeat: PlayerId | null,
  mapping: SeatMappingV8,
): CompetitiveAgentId | null {
  return winnerSeat === null ? null : mapping[winnerSeat];
}

/**
 * Sequential Swap2 adaptation for Ô Ăn Quan research:
 *
 * 1. Tentative opener A authors a legal 3-ply setup P0/P1/P0.
 * 2. Responder B may immediately choose P0 or P1.
 * 3. A Swap2-like defer branch would let B author plies 4-5 (P1/P0),
 *    then A choose a seat before normal play resumes with P1 to move.
 *
 * In an exact zero-sum value model, if the 5-ply state's P1 value is v,
 * A can choose the seat that gives B min(v, -v) = -|v|. Therefore B's
 * defer-branch guarantee is never positive, while immediately choosing the
 * better seat after ply 3 guarantees |v3| >= 0. The defer branch is thus
 * weakly dominated for an omniscient zero-sum evaluator. It is useful in
 * Gomoku because humans have bounded/unequal opening knowledge; that epistemic
 * benefit is outside this strong-AI fairness benchmark.
 */
export function swap2DeferredResponderGuarantee(p1ValueAfterFivePlies: number): number {
  return -Math.abs(p1ValueAfterFivePlies);
}

export function swap2ImmediateResponderGuarantee(p1ValueAfterThreePlies: number): number {
  return Math.abs(p1ValueAfterThreePlies);
}

export function isSwap2DeferredBranchDominated(
  p1ValueAfterThreePlies: number,
  bestDeferredP1ValueAfterFivePlies: number,
): boolean {
  return swap2DeferredResponderGuarantee(bestDeferredP1ValueAfterFivePlies)
    <= swap2ImmediateResponderGuarantee(p1ValueAfterThreePlies);
}
