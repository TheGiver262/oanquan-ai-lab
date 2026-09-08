import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/engine.js";
import {
  exactMarginToSearchScore,
  searchHybridExactOracleV6,
} from "../src/research/hybrid-exact-oracle-v6.js";
import { searchPolicyAwarePvsV5 } from "../src/research/policy-aware-pvs-v5.js";
import { createPolicyState } from "../src/research/repetition-policy-v5.js";

describe("V6 hybrid exact oracle", () => {
  it("maps exact margins onto terminal-scale search values", () => {
    expect(exactMarginToSearchScore(12)).toBe(10_000_012);
    expect(exactMarginToSearchScore(-12)).toBe(-10_000_012);
    expect(exactMarginToSearchScore(0)).toBe(0);
  });

  it("matches V5 PVS when the oracle is disabled", () => {
    const root = createPolicyState(createInitialState());
    const policy = { kind: "repeat-draw", occurrences: 3 } as const;
    const shared = {
      maxDepth: 3,
      nodeBudget: 20_000,
      timeBudgetMs: 5_000,
      aspirationWindow: 250,
      usePvs: true,
      evaluationFamily: "strategic" as const,
    };

    const v5 = searchPolicyAwarePvsV5(root, policy, shared);
    const v6 = searchHybridExactOracleV6(root, policy, {
      ...shared,
      oracleMaxProbes: 0,
    });

    expect(v6.move).toEqual(v5.move);
    expect(v6.score).toBe(v5.score);
    expect(v6.principalVariation).toEqual(v5.principalVariation);
    expect(v6.scoreSource).toBe("hybrid-search");
    expect(v6.diagnostics.oracleProbes).toBe(0);
  });

  it("can prove a root exactly when a finite policy makes every child terminal", () => {
    const root = createPolicyState(createInitialState());
    const result = searchHybridExactOracleV6(
      root,
      { kind: "max-ply", maxPlies: 1 },
      {
        maxDepth: 4,
        nodeBudget: 20_000,
        timeBudgetMs: 5_000,
        oracleMaxBoardValue: 100,
        oracleMaxProbes: 1,
        oracleNodeBudgetPerProbe: 20_000,
        oracleTimeBudgetMsPerProbe: 2_000,
      },
    );

    expect(result.scoreSource).toBe("exact-oracle");
    expect(result.exactMargin).toBe(0);
    expect(result.score).toBe(0);
    expect(result.move).not.toBeNull();
    expect(result.diagnostics.oracleProbes).toBe(1);
    expect(result.diagnostics.oracleSolvedProbes).toBe(1);
    expect(result.diagnostics.oracleUnresolvedProbes).toBe(0);
    expect(result.diagnostics.oraclePolicyDrawLeaves).toBeGreaterThan(0);
  });

  it("does not relabel an unresolved exact probe as an exact root result", () => {
    const root = createPolicyState(createInitialState());
    const result = searchHybridExactOracleV6(
      root,
      { kind: "repeat-draw", occurrences: 3 },
      {
        maxDepth: 2,
        nodeBudget: 20_000,
        timeBudgetMs: 5_000,
        oracleMaxBoardValue: 100,
        oracleMaxProbes: 1,
        oracleNodeBudgetPerProbe: 1,
        oracleTimeBudgetMsPerProbe: 500,
      },
    );

    expect(result.scoreSource).toBe("hybrid-search");
    expect(result.exactMargin).toBeNull();
    expect(result.diagnostics.oracleProbes).toBe(1);
    expect(result.diagnostics.oracleSolvedProbes).toBe(0);
    expect(result.diagnostics.oracleUnresolvedProbes).toBe(1);
  });
});
