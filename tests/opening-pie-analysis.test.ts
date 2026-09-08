import { describe, expect, it } from "vitest";
import {
  moverAfterPieDecision,
  parseClassicOpening,
  pieSeatMapping,
  summarizePieOpening,
  valueForOpenerAgent,
  type PieBranchGame,
} from "../src/research/opening-pie-analysis.js";

describe("Pie Rule research semantics", () => {
  it("KEEP leaves B on P1, so B makes the second move", () => {
    expect(pieSeatMapping("keep")).toEqual({ P0: "A", P1: "B" });
    expect(moverAfterPieDecision("keep")).toBe("B");
  });

  it("SWAP exchanges agent ownership without mirroring the board", () => {
    expect(pieSeatMapping("swap")).toEqual({ P0: "B", P1: "A" });
    expect(moverAfterPieDecision("swap")).toBe("A");
  });

  it("values the terminal result from the original opener A's identity", () => {
    expect(valueForOpenerAgent("P0", pieSeatMapping("keep"))).toBe(1);
    expect(valueForOpenerAgent("P1", pieSeatMapping("keep"))).toBe(-1);
    expect(valueForOpenerAgent("P0", pieSeatMapping("swap"))).toBe(-1);
    expect(valueForOpenerAgent("P1", pieSeatMapping("swap"))).toBe(1);
    expect(valueForOpenerAgent(null, pieSeatMapping("swap"))).toBe(0);
  });

  it("uses unresolved games to form conservative EV bounds", () => {
    const opening = parseClassicOpening("B3:CW");
    const base = {
      opening,
      seatToAgent: pieSeatMapping("keep"),
      moverAfterDecision: "B" as const,
      winnerSeat: null,
      winnerAgent: null,
      productionSourceCommit: "test",
      moves: 20,
    };
    const games: PieBranchGame[] = [
      { ...base, branch: "keep", openerAgentValue: 1, unresolved: false },
      { ...base, branch: "keep", openerAgentValue: null, unresolved: true },
      {
        ...base,
        branch: "swap",
        seatToAgent: pieSeatMapping("swap"),
        moverAfterDecision: "A",
        openerAgentValue: -1,
        unresolved: false,
      },
      {
        ...base,
        branch: "swap",
        seatToAgent: pieSeatMapping("swap"),
        moverAfterDecision: "A",
        openerAgentValue: 1,
        unresolved: false,
      },
    ];

    const summary = summarizePieOpening(opening, games);
    expect(summary.keep.lower).toBe(0);
    expect(summary.keep.upper).toBe(1);
    expect(summary.swap.lower).toBe(0);
    expect(summary.swap.upper).toBe(0);
    expect(summary.guaranteedLower).toBe(0);
    expect(summary.guaranteedUpper).toBe(0);
    expect(summary.classification).toBe("responder-can-neutralize");
  });
});
