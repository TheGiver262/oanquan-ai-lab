import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/engine.js";
import { solveExactPolicyState } from "../src/research/exact-policy-solver-v5.js";
import { createPolicyState, type PolicyState } from "../src/research/repetition-policy-v5.js";

describe("V5 exact max-ply history offset", () => {
  it("counts plies that occurred before the selected root snapshot", () => {
    const base = createPolicyState(createInitialState());
    const deepRoot: PolicyState = { ...base, plies: 10 };

    const result = solveExactPolicyState(
      deepRoot,
      { kind: "max-ply", maxPlies: 11 },
      { maxRootBoardValue: 100, nodeBudget: 10_000, timeBudgetMs: 5_000 },
    );

    expect(result.solved).toBe(true);
    expect(result.status).toBe("solved");
    expect(result.value).toBe(0);
    expect(result.diagnostics.rootHistoryPlies).toBe(10);
    expect(result.diagnostics.maxDepth).toBe(1);
    expect(result.diagnostics.policyDrawLeaves).toBeGreaterThan(0);
  });
});
