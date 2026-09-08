import { describe, expect, it } from "vitest";
import { createInitialState, getLegalMoves } from "../src/engine.js";
import { searchNegamaxPvsV3 } from "../src/research/negamax-pvs-v3.js";
import { searchPolicyAwarePvsV5 } from "../src/research/policy-aware-pvs-v5.js";
import {
  applyPolicyMove,
  createPolicyState,
  type PolicyState,
} from "../src/research/repetition-policy-v5.js";
import type { GameState, PlayerMove } from "../src/types.js";

function cycleFixture(): GameState {
  const state = createInitialState();
  const stones: Partial<Record<(typeof state.pits)[number]["id"], number>> = {
    L: 6,
    T1: 1,
    T3: 2,
    T5: 2,
    B5: 1,
    B4: 1,
    B3: 1,
    B2: 1,
    B1: 1,
  };
  state.pits = state.pits.map((pit) => ({
    ...pit,
    stones: stones[pit.id] ?? 0,
    quanStones: 0,
  }));
  state.scores = { P0: 46, P1: 8 };
  state.currentPlayer = "P0";
  state.status = "playing";
  state.winner = null;
  state.moveNumber = 20;
  state.recentMoves = [];
  return state;
}

function requiredMove(state: GameState, key: string): PlayerMove {
  const [pit, dir] = key.split(":");
  const move = getLegalMoves(state).find((candidate) => candidate.pit === pit && candidate.dir === dir);
  if (!move) throw new Error(`Expected legal move ${key}`);
  return move;
}

function play(state: PolicyState, key: string, policy: Parameters<typeof applyPolicyMove>[2]): PolicyState {
  const result = applyPolicyMove(state, requiredMove(state.game, key), policy);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

describe("V5 policy-aware PVS", () => {
  it("matches V3 full-window search when repetition adjudication is disabled", () => {
    const game = createInitialState();
    const baseline = searchNegamaxPvsV3(game, {
      maxDepth: 3,
      nodeBudget: 100_000,
      timeBudgetMs: 5_000,
      usePvs: false,
      useTranspositionTable: false,
      evaluationFamily: "material",
    });
    const policyAware = searchPolicyAwarePvsV5(createPolicyState(game), { kind: "none" }, {
      maxDepth: 3,
      nodeBudget: 100_000,
      timeBudgetMs: 5_000,
      usePvs: false,
      evaluationFamily: "material",
    });

    expect(policyAware.move).toEqual(baseline.move);
    expect(policyAware.score).toBe(baseline.score);
    expect(policyAware.diagnostics.completedDepth).toBe(3);
  });

  it("sees a third-occurrence draw inside the search tree using accumulated history", () => {
    const policy = { kind: "repeat-draw", occurrences: 3 } as const;
    let state = createPolicyState(cycleFixture());
    state = play(state, "B2:CCW", policy);
    state = play(state, "T2:CW", policy);
    expect(state.adjudication).toBeNull();

    const result = searchPolicyAwarePvsV5(state, policy, {
      maxDepth: 2,
      nodeBudget: 100_000,
      timeBudgetMs: 5_000,
      usePvs: false,
      evaluationFamily: "material",
    });

    expect(result.diagnostics.completedDepth).toBe(2);
    expect(result.diagnostics.policyDrawLeaves).toBeGreaterThan(0);
  });

  it("returns neutral immediately for an already adjudicated repetition draw", () => {
    const policy = { kind: "repeat-draw", occurrences: 2 } as const;
    let state = createPolicyState(cycleFixture());
    state = play(state, "B2:CCW", policy);
    state = play(state, "T2:CW", policy);
    expect(state.adjudication?.kind).toBe("repetition-draw");

    const result = searchPolicyAwarePvsV5(state, policy, { maxDepth: 4 });
    expect(result.move).toBeNull();
    expect(result.score).toBe(0);
    expect(result.diagnostics.policyDrawLeaves).toBe(1);
  });
});
