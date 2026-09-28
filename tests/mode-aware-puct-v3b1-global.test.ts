import { describe, expect, it } from "vitest";
import {
  balanceActionKey,
  createBalanceInitialState,
  getBalanceActions,
  type BalanceModeId,
} from "../src/research/balance-modes.js";
import { ModeAwarePuctV3A2 } from "../src/research/mode-aware-puct-v3a2.js";
import { ModeAwarePuctV3B1 } from "../src/research/mode-aware-puct-v3b1.js";
import { ModeAwarePuctV3B1Global } from "../src/research/mode-aware-puct-v3b1-global.js";

describe("ModeAwarePuctV3B1Global", () => {
  it("matches V3B.1 Cpn=2.0 on Quan Gia", () => {
    const state = createBalanceInitialState("quan-gia-threefold");
    const candidate = new ModeAwarePuctV3B1Global().chooseAction(state, { simulations: 800 });
    const incumbent = new ModeAwarePuctV3B1(2.0).chooseAction(state, { simulations: 800 });
    expect(candidate.action).toEqual(incumbent.action);
    expect(candidate.rootStats).toEqual(incumbent.rootStats);
  });

  for (const mode of ["pie-threefold", "standard"] as const) {
    it(`matches V3A.2 on ${mode}`, () => {
      const state = createBalanceInitialState(mode);
      const candidate = new ModeAwarePuctV3B1Global().chooseAction(state, { simulations: 800 });
      const baseline = new ModeAwarePuctV3A2().chooseAction(state, { simulations: 800 });
      expect(candidate.action).toEqual(baseline.action);
      expect(candidate.rootStats).toEqual(baseline.rootStats);
    });
  }

  it("returns legal actions in all three modes", () => {
    const modes: BalanceModeId[] = ["standard", "pie-threefold", "quan-gia-threefold"];
    for (const mode of modes) {
      const state = createBalanceInitialState(mode);
      const legal = new Set(getBalanceActions(state).map(balanceActionKey));
      const decision = new ModeAwarePuctV3B1Global().chooseAction(state, { simulations: 200 });
      expect(decision.action).not.toBeNull();
      expect(decision.action ? legal.has(balanceActionKey(decision.action)) : false).toBe(true);
    }
  });
});
