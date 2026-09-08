import { describe, expect, it } from "vitest";
import { createInitialState, getLegalMoves } from "../src/engine.js";
import { searchHybridWdlOracleV6, wdlToSearchScore } from "../src/research/hybrid-wdl-oracle-v6.js";
import { searchPolicyAwarePvsV5 } from "../src/research/policy-aware-pvs-v5.js";
import {
  applyPolicyMove,
  createPolicyState,
  type PolicyState,
} from "../src/research/repetition-policy-v5.js";
import { V3_50M_PV } from "../src/research/v3-pv-corpus.js";
import type { PlayerMove } from "../src/types.js";

describe("V6 hybrid WDL oracle", () => {
  it("is decision/value compatible with V5 PVS when WDL probing is disabled", () => {
    const root = createPolicyState(createInitialState());
    const policy = { kind: "none" } as const;
    const common = {
      maxDepth: 3,
      nodeBudget: 100_000,
      timeBudgetMs: 5_000,
      usePvs: false,
      evaluationFamily: "material" as const,
    };

    const baseline = searchPolicyAwarePvsV5(root, policy, common);
    const hybrid = searchHybridWdlOracleV6(root, policy, {
      ...common,
      wdlMaxProbes: 0,
    });

    expect(hybrid.move).toEqual(baseline.move);
    expect(hybrid.score).toBe(baseline.score);
    expect(hybrid.diagnostics.completedDepth).toBe(baseline.diagnostics.completedDepth);
    expect(hybrid.diagnostics.wdlProbes).toBe(0);
  });

  it("maps exact WDL proof classes onto terminal search scale", () => {
    expect(wdlToSearchScore("win")).toBe(10_000_000);
    expect(wdlToSearchScore("draw")).toBe(0);
    expect(wdlToSearchScore("loss")).toBe(-10_000_000);
  });

  it("proves the known B3:CCW material ply-20 root with a 5k graph budget", () => {
    const policy = { kind: "repeat-draw", occurrences: 3 } as const;
    const root = replayB3CcwMaterialToEnd(policy);

    const result = searchHybridWdlOracleV6(root, policy, {
      maxDepth: 3,
      nodeBudget: 100_000,
      timeBudgetMs: 5_000,
      usePvs: false,
      evaluationFamily: "material",
      wdlMaxBoardValue: 8,
      wdlMaxProbes: 1,
      wdlGraphNodeBudgetPerProbe: 5_000,
      wdlTimeBudgetMsPerProbe: 2_000,
      wdlPlacement: "leaf",
    });

    expect(result.scoreSource).toBe("wdl-oracle");
    expect(result.exactWdl).toBe("win");
    expect(result.move && `${result.move.pit}:${result.move.dir}`).toBe("B5:CW");
    expect(result.diagnostics.wdlProbes).toBe(1);
    expect(result.diagnostics.wdlSolvedProbes).toBe(1);
    expect(result.diagnostics.wdlGraphNodes).toBeLessThanOrEqual(5_000);
  });
});

function replayB3CcwMaterialToEnd(
  policy: { kind: "repeat-draw"; occurrences: 3 },
): PolicyState {
  let state = createPolicyState(createInitialState());
  state = play(state, "B3:CCW", policy);
  for (const key of V3_50M_PV["B3:CCW:material"]) {
    state = play(state, key, policy);
  }
  return state;
}

function play(
  state: PolicyState,
  key: string,
  policy: Parameters<typeof applyPolicyMove>[2],
): PolicyState {
  const [pit, dir] = key.split(":");
  const move = getLegalMoves(state.game).find(
    (candidate) => candidate.pit === pit && candidate.dir === dir,
  ) as PlayerMove | undefined;
  if (!move) throw new Error(`Expected legal move ${key}`);
  const applied = applyPolicyMove(state, move, policy);
  if (!applied.ok) throw new Error(applied.error);
  return applied.state;
}
