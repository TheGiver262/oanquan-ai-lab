import { describe, expect, test } from "vitest";
import { createInitialState, getLegalMoves } from "../src/engine.js";
import { AI_DIFFICULTIES, AI_DIFFICULTY_PROFILES } from "../src/profiles.js";
import { analyzePosition } from "../src/search.js";
import { analyzePieRule } from "../src/analysis.js";

describe("AI lab", () => {
  test("keeps all seven production difficulty names", () => {
    expect(AI_DIFFICULTIES).toEqual(["thu-sinh", "tu-tai", "cu-nhan", "tien-si", "tham-hoa", "bang-nhan", "trang-nguyen"]);
    expect(AI_DIFFICULTY_PROFILES["trang-nguyen"].searchDepth).toBe(11);
    expect(AI_DIFFICULTY_PROFILES["trang-nguyen"].secondPlayerDepthBonus).toBe(5);
  });
  test("suggestion is always legal", () => {
    const state = createInitialState();
    const result = analyzePosition(state, "tien-si", { depth: 2, nodeBudget: 5000, timeBudgetMs: 1000, random: () => 0.99 });
    expect(result.bestMove).not.toBeNull();
    expect(getLegalMoves(state)).toContainEqual(result.bestMove);
  });
  test("pie analysis covers all legal openings", () => {
    const rows = analyzePieRule("tien-si", { depth: 1, nodeBudget: 5000, timeBudgetMs: 1000 });
    expect(rows).toHaveLength(10);
    expect(rows.every((row) => row.guaranteed === Math.min(row.keep, row.swap))).toBe(true);
  });
});
