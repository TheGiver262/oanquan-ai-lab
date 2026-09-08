import { describe, expect, it } from "vitest";
import {
  KEEP_MAPPING_V8,
  SWAP_MAPPING_V8,
  isSwap2DeferredBranchDominated,
  mappingForResponderSeat,
  rationalResponderSeatFromP1Value,
  swap2DeferredResponderGuarantee,
  swap2ImmediateResponderGuarantee,
  valueForAgentFromSeatValue,
  winnerAgentFromSeat,
} from "../src/research/competitive-protocol-v8.js";

describe("V8 competitive protocol semantics", () => {
  it("lets the responder take the stronger seat after an odd-ply setup", () => {
    expect(rationalResponderSeatFromP1Value(0.4)).toBe("P1");
    expect(rationalResponderSeatFromP1Value(-0.4)).toBe("P0");
    expect(mappingForResponderSeat("P1")).toEqual(KEEP_MAPPING_V8);
    expect(mappingForResponderSeat("P0")).toEqual(SWAP_MAPPING_V8);
  });

  it("maps zero-sum seat value back to agent value", () => {
    expect(valueForAgentFromSeatValue(0.25, KEEP_MAPPING_V8, "A")).toBe(-0.25);
    expect(valueForAgentFromSeatValue(0.25, KEEP_MAPPING_V8, "B")).toBe(0.25);
    expect(valueForAgentFromSeatValue(-0.25, SWAP_MAPPING_V8, "B")).toBe(0.25);
  });

  it("maps terminal seat winner through the protocol ownership", () => {
    expect(winnerAgentFromSeat("P0", KEEP_MAPPING_V8)).toBe("A");
    expect(winnerAgentFromSeat("P0", SWAP_MAPPING_V8)).toBe("B");
    expect(winnerAgentFromSeat(null, SWAP_MAPPING_V8)).toBeNull();
  });

  it("shows the Swap2 defer branch is weakly dominated under exact zero-sum values", () => {
    expect(swap2ImmediateResponderGuarantee(0.3)).toBe(0.3);
    expect(swap2DeferredResponderGuarantee(0.1)).toBe(-0.1);
    expect(isSwap2DeferredBranchDominated(0.3, 0.1)).toBe(true);
    expect(isSwap2DeferredBranchDominated(0, 0)).toBe(true);
  });
});
