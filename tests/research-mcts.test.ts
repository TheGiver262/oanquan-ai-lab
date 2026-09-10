import { describe, expect, it } from "vitest";
import { applyMove, createInitialState, getLegalMoves } from "../src/engine.js";
import { chooseMctsMove } from "../src/research/mcts.js";
import { chooseProductionMove, PRODUCTION_TOP_PROFILES } from "../src/reference/production-ai.js";

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

describe("research MCTS", () => {
  it("returns a legal move for UCT, UCT-PB and PUCT-HV", () => {
    const state = createInitialState();
    const legal = new Set(getLegalMoves(state).map((move) => `${move.pit}:${move.dir}`));
    for (const variant of ["uct", "uct-pb", "puct-hv"] as const) {
      const decision = chooseMctsMove(state, {
        variant,
        simulations: 64,
        rolloutDepth: 8,
        random: seededRandom(42),
      });
      expect(decision.move).not.toBeNull();
      expect(legal.has(`${decision.move?.pit}:${decision.move?.dir}`)).toBe(true);
      expect(decision.diagnostics.simulations).toBe(64);
    }
  });

  it("normalizes PUCT-HV heuristic policy priors at the root", () => {
    const decision = chooseMctsMove(createInitialState(), {
      variant: "puct-hv",
      simulations: 32,
      puctExploration: 1.5,
      policyTemperature: 0.35,
    });

    expect(decision.rootStats).toHaveLength(10);
    expect(decision.rootStats.every((entry) => entry.prior > 0 && entry.prior <= 1)).toBe(true);
    const priorTotal = decision.rootStats.reduce((sum, entry) => sum + entry.prior, 0);
    expect(priorTotal).toBeCloseTo(1, 10);
  });

  it("rejects invalid PUCT-HV exploration settings", () => {
    expect(() => chooseMctsMove(createInitialState(), { variant: "puct-hv", puctExploration: 0 })).toThrow(
      "puctExploration must be > 0",
    );
    expect(() => chooseMctsMove(createInitialState(), { variant: "puct-hv", policyTemperature: 0 })).toThrow(
      "policyTemperature must be > 0",
    );
  });
});

describe("production reference", () => {
  it("mirrors the current top-three budgets", () => {
    expect(PRODUCTION_TOP_PROFILES["tham-hoa"]).toMatchObject({ searchDepth: 6, secondPlayerDepthBonus: 3, nodeBudget: 36_000, timeBudgetMs: 600 });
    expect(PRODUCTION_TOP_PROFILES["bang-nhan"]).toMatchObject({ searchDepth: 8, secondPlayerDepthBonus: 3, nodeBudget: 55_000, timeBudgetMs: 900 });
    expect(PRODUCTION_TOP_PROFILES["trang-nguyen"]).toMatchObject({ searchDepth: 11, secondPlayerDepthBonus: 5, nodeBudget: 100_000, timeBudgetMs: 1_200 });
  });

  it("uses the current opening book for Bảng Nhãn and Trạng Nguyên as P0", () => {
    const state = createInitialState();
    for (const level of ["bang-nhan", "trang-nguyen"] as const) {
      const move = chooseProductionMove(state, level, "P0", { random: seededRandom(1) });
      expect(move).toEqual({ pit: "B3", dir: "CW" });
      if (move) {
        const result = applyMove(state, { player: "P0", ...move });
        expect(result.ok).toBe(true);
      }
    }
  });
});
