import { describe, expect, it } from "vitest";
import {
  applyBalanceAction,
  balanceActionKey,
  createBalanceInitialState,
  getBalanceActions,
} from "../src/research/balance-modes.js";
import {
  ModeAwarePuctV3A,
  canonicalizeBalanceStateForSearch,
  reflectBalanceAction,
  reflectBalanceStateForSearch,
} from "../src/research/mode-aware-puct-v3a.js";
import { ModeAwarePuctV3A1 } from "../src/research/mode-aware-puct-v3a1.js";
import { ModeAwarePuctV3A2 } from "../src/research/mode-aware-puct-v3a2.js";

describe("mode-aware PUCT target-mode guards", () => {
  it("returns legal fixed-simulation actions on both target modes", () => {
    for (const mode of ["pie-threefold", "quan-gia-threefold"] as const) {
      const state = createBalanceInitialState(mode);
      const decision = new ModeAwarePuctV3A2().chooseAction(state, { simulations: 200 });
      expect(decision.action).not.toBeNull();
      const legal = new Set(getBalanceActions(state).map(balanceActionKey));
      expect(decision.action && legal.has(balanceActionKey(decision.action))).toBe(true);
    }
  });

  it("treats SWAP as a legal first-class Pie action after the opening", () => {
    let state = createBalanceInitialState("pie-threefold");
    const opening = getBalanceActions(state).find(
      (a) => a.kind === "move" && a.move.pit === "B3" && a.move.dir === "CW",
    );
    expect(opening).toBeDefined();
    if (!opening) return;
    const applied = applyBalanceAction(state, opening);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    state = applied.state;

    expect(getBalanceActions(state).some((a) => a.kind === "swap")).toBe(true);
    const decision = new ModeAwarePuctV3A2().chooseAction(state, { simulations: 200 });
    expect(decision.action).not.toBeNull();
    expect(getBalanceActions(state).map(balanceActionKey)).toContain(
      decision.action ? balanceActionKey(decision.action) : "",
    );
  });

  it("canonicalizes left/right reflection without changing the target mode", () => {
    const state = createBalanceInitialState("quan-gia-threefold");
    const reflected = reflectBalanceStateForSearch(state);
    expect(reflected.mode).toBe("quan-gia-threefold");
    expect(reflected.game.ruleset.canonicalRulesetId).toBe(state.game.ruleset.canonicalRulesetId);

    const canonical = canonicalizeBalanceStateForSearch(state);
    expect(canonical.state.mode).toBe(state.mode);

    const action = getBalanceActions(state).find((a) => a.kind === "move");
    expect(action).toBeDefined();
    if (!action) return;
    expect(reflectBalanceAction(reflectBalanceAction(action))).toEqual(action);
  });

  it("keeps V3A, V3A.1 and V3A.2 adapters independently constructible", () => {
    expect(new ModeAwarePuctV3A()).toBeInstanceOf(ModeAwarePuctV3A);
    expect(new ModeAwarePuctV3A1()).toBeInstanceOf(ModeAwarePuctV3A1);
    expect(new ModeAwarePuctV3A2()).toBeInstanceOf(ModeAwarePuctV3A2);
  });
});
