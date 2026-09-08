import { describe, expect, it } from "vitest";
import { applyMove, createInitialState, getLegalMoves } from "../src/engine.js";
import { searchNegamaxPvs } from "../src/research/negamax-pvs.js";
import { evaluateV3, searchNegamaxPvsV3 } from "../src/research/negamax-pvs-v3.js";

function moveKey(move: { pit: string; dir: string } | null): string | null {
  return move ? `${move.pit}:${move.dir}` : null;
}

describe("opening balance V3 PVS solver", () => {
  it("material evaluation preserves V2 leaf formula", () => {
    const initial = createInitialState();
    const opening = getLegalMoves(initial).find((move) => move.pit === "B3" && move.dir === "CW");
    expect(opening).toBeDefined();
    const applied = applyMove(initial, opening!);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const v2 = searchNegamaxPvs(applied.state, {
      maxDepth: 4,
      nodeBudget: 500_000,
      timeBudgetMs: 30_000,
      usePvs: false,
      useTranspositionTable: false,
    });
    const v3 = searchNegamaxPvsV3(applied.state, {
      evaluationFamily: "material",
      maxDepth: 4,
      nodeBudget: 500_000,
      timeBudgetMs: 30_000,
      usePvs: false,
      useTranspositionTable: false,
    });

    expect(v3.diagnostics.completedDepth).toBe(4);
    expect(moveKey(v3.move)).toBe(moveKey(v2.move));
    expect(v3.score).toBe(v2.score);
  });

  it("PVS agrees with full-window alpha-beta for both evaluation families", () => {
    const initial = createInitialState();
    const opening = getLegalMoves(initial).find((move) => move.pit === "B3" && move.dir === "CCW");
    expect(opening).toBeDefined();
    const applied = applyMove(initial, opening!);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    for (const evaluationFamily of ["material", "strategic"] as const) {
      const common = {
        evaluationFamily,
        maxDepth: 4,
        nodeBudget: 700_000,
        timeBudgetMs: 30_000,
        useTranspositionTable: false,
      } as const;
      const pvs = searchNegamaxPvsV3(applied.state, { ...common, usePvs: true });
      const full = searchNegamaxPvsV3(applied.state, { ...common, usePvs: false });
      expect(pvs.diagnostics.completedDepth).toBe(4);
      expect(full.diagnostics.completedDepth).toBe(4);
      expect(moveKey(pvs.move)).toBe(moveKey(full.move));
      expect(pvs.score).toBe(full.score);
    }
  });

  it("strategic family is deterministic and genuinely distinct", () => {
    const state = createInitialState();
    const first = searchNegamaxPvsV3(state, {
      evaluationFamily: "strategic",
      maxDepth: 5,
      nodeBudget: 20_000,
      timeBudgetMs: 30_000,
    });
    const second = searchNegamaxPvsV3(state, {
      evaluationFamily: "strategic",
      maxDepth: 5,
      nodeBudget: 20_000,
      timeBudgetMs: 30_000,
    });

    expect(moveKey(first.move)).toBe(moveKey(second.move));
    expect(first.score).toBe(second.score);
    expect(first.diagnostics.nodeCount).toBe(second.diagnostics.nodeCount);
    expect(evaluateV3(state, "P0", "strategic")).not.toBeNaN();
  });
});
