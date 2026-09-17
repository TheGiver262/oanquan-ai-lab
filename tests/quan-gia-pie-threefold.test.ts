import { describe, expect, it } from "vitest";
import { createBalanceInitialState, getBalanceActions, modeHasSwap, modeUsesThreefold } from "../src/research/balance-modes.js";
import { applyBalanceAction } from "../src/research/balance-modes.js";

describe("Quan Gia + Pie + Threefold candidate", () => {
  it("combines mature Quan, Threefold and one-shot Pie", () => {
    let state = createBalanceInitialState("quan-gia-pie-threefold");
    expect(state.game.ruleset.ruleProfileId).toBe("mature_quan_v1");
    expect(state.game.ruleset.repetitionPolicy).toBe("threefold");
    expect(modeUsesThreefold(state.mode)).toBe(true);
    expect(modeHasSwap(state.mode)).toBe(true);
    expect(state.swap.enabled).toBe(true);

    const opener = getBalanceActions(state).find((a) => a.kind === "move" && a.move.pit === "B3" && a.move.dir === "CW");
    expect(opener).toBeDefined();
    if (!opener) return;
    const first = applyBalanceAction(state, opener);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    state = first.state;
    expect(getBalanceActions(state).some((a) => a.kind === "swap")).toBe(true);
  });
});
