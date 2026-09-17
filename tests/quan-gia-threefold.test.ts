import { describe, expect, it } from "vitest";
import { createBalanceInitialState, modeHasSwap, modeUsesThreefold } from "../src/research/balance-modes.js";

describe("Quan Gia + Threefold candidate", () => {
  it("combines mature Quan capture with Threefold and no SWAP", () => {
    const state = createBalanceInitialState("quan-gia-threefold");
    expect(state.game.ruleset.ruleProfileId).toBe("mature_quan_v1");
    expect(state.game.ruleset.repetitionPolicy).toBe("threefold");
    expect(state.game.ruleset.canonicalRulesetId).toBe("oaq:classic_2p:mature_quan_threefold:v1");
    expect(modeUsesThreefold("quan-gia-threefold")).toBe(true);
    expect(modeHasSwap("quan-gia-threefold")).toBe(false);
    expect(state.swap.enabled).toBe(false);
  });
});
