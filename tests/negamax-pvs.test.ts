import { describe, expect, it } from "vitest";
import { applyMove, createInitialState, getLegalMoves } from "../src/engine.js";
import { searchNegamaxPvs } from "../src/research/negamax-pvs.js";

function moveKey(move: { pit: string; dir: string } | null): string | null {
  return move ? `${move.pit}:${move.dir}` : null;
}

describe("independent negamax PVS solver", () => {
  it("returns a legal deterministic opening move", () => {
    const state = createInitialState();
    const result = searchNegamaxPvs(state, {
      maxDepth: 3,
      nodeBudget: 100_000,
      timeBudgetMs: 30_000,
    });
    const legal = new Set(getLegalMoves(state).map(moveKey));

    expect(result.move).not.toBeNull();
    expect(legal.has(moveKey(result.move))).toBe(true);
    expect(result.diagnostics.completedDepth).toBe(3);
  });

  it("PVS agrees with full-window alpha-beta at the same fixed depth", () => {
    const initial = createInitialState();
    const opening = getLegalMoves(initial).find((move) => move.pit === "B3" && move.dir === "CW");
    expect(opening).toBeDefined();
    const applied = applyMove(initial, opening!);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const common = {
      maxDepth: 4,
      nodeBudget: 500_000,
      timeBudgetMs: 30_000,
      useTranspositionTable: false,
    } as const;
    const pvs = searchNegamaxPvs(applied.state, { ...common, usePvs: true });
    const full = searchNegamaxPvs(applied.state, { ...common, usePvs: false });

    expect(pvs.diagnostics.completedDepth).toBe(4);
    expect(full.diagnostics.completedDepth).toBe(4);
    expect(moveKey(pvs.move)).toBe(moveKey(full.move));
    expect(pvs.score).toBe(full.score);
  });

  it("is node-budget deterministic when time is non-binding", () => {
    const state = createInitialState();
    const options = {
      maxDepth: 6,
      nodeBudget: 10_000,
      timeBudgetMs: 30_000,
    } as const;
    const first = searchNegamaxPvs(state, options);
    const second = searchNegamaxPvs(state, options);

    expect(moveKey(first.move)).toBe(moveKey(second.move));
    expect(first.score).toBe(second.score);
    expect(first.diagnostics.completedDepth).toBe(second.diagnostics.completedDepth);
    expect(first.diagnostics.nodeCount).toBe(second.diagnostics.nodeCount);
  });
});
