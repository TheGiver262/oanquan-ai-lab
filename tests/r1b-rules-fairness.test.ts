import { describe, expect, it } from "vitest";
import {
  applyMove,
  createInitialState,
  NO_FIRST_QUAN_RULESET,
} from "../src/engine.js";
import {
  DEFAULT_R1B_SEARCH_CONFIG,
  enumerateR1bOpenings,
  gameValueInterval,
  moverAfterR1bOpeningDecision,
  playR1bGame,
  responderOptimalPieInterval,
  r1bSeatMapping,
  summarizeR1bOpening,
  type R1bGameResult,
} from "../src/research/r1b-rules-fairness.js";

describe("R1b rules fairness harness", () => {
  it("locks Cấm Quan and Pie ownership semantics", () => {
    expect(r1bSeatMapping("cam-quan", "none")).toEqual({ P0: "A", P1: "B" });
    expect(() => r1bSeatMapping("cam-quan", "keep")).toThrow("cam-quan has no Pie branch");

    expect(r1bSeatMapping("standard-pie", "keep")).toEqual({ P0: "A", P1: "B" });
    expect(r1bSeatMapping("standard-pie", "swap")).toEqual({ P0: "B", P1: "A" });
    expect(() => r1bSeatMapping("standard-pie", "none")).toThrow(
      "standard-pie requires keep or swap",
    );

    expect(moverAfterR1bOpeningDecision("standard-pie", "keep")).toBe("B");
    expect(moverAfterR1bOpeningDecision("standard-pie", "swap")).toBe("A");
  });

  it("enumerates Cấm Quan openings from the Cấm Quan engine ruleset", () => {
    const openings = enumerateR1bOpenings("cam-quan");
    expect(openings.length).toBeGreaterThan(0);

    const initial = createInitialState(NO_FIRST_QUAN_RULESET);
    for (const opening of openings) {
      expect(opening.player).toBe("P0");
      const applied = applyMove(initial, opening);
      expect(applied.ok).toBe(true);
      if (applied.ok) {
        expect(applied.state.ruleset.canonicalRulesetId).toBe(
          "oaq:classic_2p:no_first_quan:v1",
        );
      }
    }
  });

  it("keeps unresolved games as conservative value intervals", () => {
    expect(gameValueInterval(fakeGame({ openerValue: 1, unresolved: false }))).toEqual({
      lower: 1,
      upper: 1,
      resolvedValue: 1,
    });
    expect(gameValueInterval(fakeGame({ openerValue: null, unresolved: true }))).toEqual({
      lower: -1,
      upper: 1,
      resolvedValue: null,
    });
  });

  it("takes the responder-optimal Pie branch without hiding branch uncertainty", () => {
    expect(
      responderOptimalPieInterval(
        { lower: 1, upper: 1, resolvedValue: 1 },
        { lower: -1, upper: -1, resolvedValue: -1 },
      ),
    ).toEqual({ lower: -1, upper: -1, resolvedValue: -1 });

    expect(
      responderOptimalPieInterval(
        { lower: 0, upper: 0, resolvedValue: 0 },
        { lower: -1, upper: 1, resolvedValue: null },
      ),
    ).toEqual({ lower: -1, upper: 0, resolvedValue: null });
  });

  it("requires both KEEP and SWAP before summarizing a Pie engine assignment", () => {
    const opening = enumerateR1bOpenings("standard-pie")[0];
    if (!opening) throw new Error("Expected at least one Standard opening");

    const keepOnly = fakeGame({
      ruleCase: "standard-pie",
      branch: "keep",
      opening: `${opening.pit}:${opening.dir}`,
      openerValue: 1,
      unresolved: false,
    });

    expect(() => summarizeR1bOpening("standard-pie", opening, [keepOnly])).toThrow(
      "Pie assignment requires both KEEP and SWAP games",
    );
  });

  it("runs a tiny fixed-resource smoke without heuristic adjudication", () => {
    const camQuanKeys = new Set(
      enumerateR1bOpenings("cam-quan").map((move) => `${move.pit}:${move.dir}`),
    );
    const opening = enumerateR1bOpenings("standard-pie").find((move) =>
      camQuanKeys.has(`${move.pit}:${move.dir}`),
    );
    if (!opening) throw new Error("Expected a common legal opening for smoke test");

    const result = playR1bGame({
      ruleCase: "standard-pie",
      branch: "swap",
      opening,
      assignment: "xy",
      engineByAgent: { A: "uct", B: "uct-pb" },
      seed: 20260914,
      config: {
        ...DEFAULT_R1B_SEARCH_CONFIG,
        simulations: 8,
        rolloutDepth: 4,
        maxMoves: 2,
      },
    });

    expect(result.seatToAgent).toEqual({ P0: "B", P1: "A" });
    expect(result.moverAfterOpeningDecision).toBe("A");
    expect(result.moves).toBe(2);
    expect(result.unresolved).toBe(true);
    expect(result.openerValue).toBeNull();
  });
});

function fakeGame(overrides: Partial<R1bGameResult>): R1bGameResult {
  return {
    ruleCase: "cam-quan",
    branch: "none",
    opening: "B3:CW",
    assignment: "xy",
    engineByAgent: { A: "uct", B: "uct-pb" },
    seatToAgent: { P0: "A", P1: "B" },
    moverAfterOpeningDecision: "B",
    winnerSeat: null,
    winnerAgent: null,
    openerValue: 0,
    unresolved: false,
    moves: 40,
    seed: 1,
    productionSourceCommit: "test",
    ...overrides,
  };
}
