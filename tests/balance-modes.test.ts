import { describe, expect, it } from "vitest";
import { applyMove } from "../src/engine.js";
import {
  applyBalanceAction,
  createBalanceInitialState,
  currentAgent,
  getBalanceActions,
  isSwapEligible,
  modeHasSwap,
  modeUsesThreefold,
} from "../src/research/balance-modes.js";

describe("canonical balance modes", () => {
  it("keeps Standard as control and enables Threefold on both target modes", () => {
    const standard = createBalanceInitialState("standard");
    const pie = createBalanceInitialState("pie-threefold");
    const quanGia = createBalanceInitialState("quan-gia-threefold");

    expect(standard.game.ruleset.repetitionPolicy ?? "none").toBe("none");
    expect(pie.game.ruleset.repetitionPolicy).toBe("threefold");
    expect(quanGia.game.ruleset.repetitionPolicy).toBe("threefold");
    expect(quanGia.game.ruleset.ruleProfileId).toBe("mature_quan_v1");
    expect(modeUsesThreefold("pie-threefold")).toBe(true);
    expect(modeUsesThreefold("quan-gia-threefold")).toBe(true);
  });

  it("offers one-shot Pie only to the original responder after move 1", () => {
    let state = createBalanceInitialState("pie-threefold");
    expect(modeHasSwap(state.mode)).toBe(true);
    expect(isSwapEligible(state)).toBe(false);

    const opening = getBalanceActions(state).find((a) => a.kind === "move");
    expect(opening).toBeDefined();
    if (!opening) return;
    const first = applyBalanceAction(state, opening);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    state = first.state;

    expect(currentAgent(state)).toBe("B");
    expect(isSwapEligible(state)).toBe(true);
    const swap = getBalanceActions(state).find((a) => a.kind === "swap");
    expect(swap).toEqual({ kind: "swap", agent: "B" });
    if (!swap) return;

    const swapped = applyBalanceAction(state, swap);
    expect(swapped.ok).toBe(true);
    if (!swapped.ok) return;
    expect(swapped.state.seatToAgent).toEqual({ P0: "B", P1: "A" });
    expect(isSwapEligible(swapped.state)).toBe(false);
  });

  it("does not expose SWAP in Quan Gia + Threefold", () => {
    const state = createBalanceInitialState("quan-gia-threefold");
    expect(modeHasSwap(state.mode)).toBe(false);
    expect(getBalanceActions(state).some((a) => a.kind === "swap")).toBe(false);
  });

  it("applies the mature-Quan >=5 capture gate in Quan Gia + Threefold", () => {
    const below = createBalanceInitialState("quan-gia-threefold").game;
    const t5 = below.pits.find((pit) => pit.id === "T5");
    const r = below.pits.find((pit) => pit.id === "R");
    expect(t5 && r).toBeTruthy();
    if (!t5 || !r) return;
    t5.stones = 0;
    r.stones = 4;

    const blocked = applyMove(below, { player: "P0", pit: "B1", dir: "CW" });
    expect(blocked.ok).toBe(true);
    if (!blocked.ok) return;
    expect(blocked.state.pits.find((pit) => pit.id === "R")?.quanStones).toBe(1);
  });
});
