import { describe, expect, it } from "vitest";
import { createInitialState, getLegalMoves } from "../src/engine.js";
import { choosePolicyMctsMoveV7 } from "../src/research/policy-mcts-v7.js";
import { createPolicyState, type PolicyState } from "../src/research/repetition-policy-v5.js";

const THREEFOLD = { kind: "repeat-draw", occurrences: 3 } as const;

describe("V7 policy-aware MCTS", () => {
  it("returns a legal move under threefold with seeded search", () => {
    const root = createPolicyState(createInitialState());
    const result = choosePolicyMctsMoveV7(root, THREEFOLD, {
      variant: "uct-pb",
      simulations: 64,
      timeBudgetMs: 10_000,
      rolloutDepth: 8,
      random: mulberry32(12345),
    });

    expect(result.move).not.toBeNull();
    expect(getLegalMoves(root.game)).toContainEqual(result.move);
    expect(result.diagnostics.simulations).toBe(64);
    expect(result.diagnostics.rootVisits).toBe(64);
    expect(result.diagnostics.expandedNodes).toBeGreaterThan(1);
  });

  it("treats an adjudicated policy state as terminal", () => {
    const base = createPolicyState(createInitialState());
    const adjudicated: PolicyState = {
      ...base,
      adjudication: {
        kind: "repetition-draw",
        strategicStateKey: "test",
        occurrences: 3,
        threshold: 3,
      },
    };

    const result = choosePolicyMctsMoveV7(adjudicated, THREEFOLD, {
      simulations: 100,
      random: mulberry32(1),
    });

    expect(result.move).toBeNull();
    expect(result.diagnostics.simulations).toBe(0);
  });
});

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
