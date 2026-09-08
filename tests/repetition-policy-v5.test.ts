import { describe, expect, it } from "vitest";
import { getLegalMoves } from "../src/engine.js";
import { exactStrategicStateKey } from "../src/research/exact-endgame-v4.js";
import { solveExactWithPolicy } from "../src/research/exact-policy-solver-v5.js";
import {
  applyPolicyMove,
  createPolicyState,
  policyStateKey,
  type PolicyState,
} from "../src/research/repetition-policy-v5.js";
import { createInitialState } from "../src/engine.js";
import type { GameState, PlayerMove } from "../src/types.js";

function exactCycleFixture(): GameState {
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

describe("Opening Balance V5 repetition policy", () => {
  it("reproduces a real two-ply strategic-state cycle from V4 evidence", () => {
    const initial = exactCycleFixture();
    const startKey = exactStrategicStateKey(initial);
    let state = createPolicyState(initial);

    state = play(state, "B2:CCW", { kind: "none" });
    state = play(state, "T2:CW", { kind: "none" });

    expect(exactStrategicStateKey(state.game)).toBe(startKey);
    expect(state.game.scores).toEqual(initial.scores);
    expect(state.game.currentPlayer).toBe(initial.currentPlayer);
    expect(state.adjudication).toBeNull();
  });

  it("second-occurrence policy draws on the first complete return", () => {
    let state = createPolicyState(exactCycleFixture());
    state = play(state, "B2:CCW", { kind: "repeat-draw", occurrences: 2 });
    expect(state.adjudication).toBeNull();

    state = play(state, "T2:CW", { kind: "repeat-draw", occurrences: 2 });
    expect(state.adjudication?.kind).toBe("repetition-draw");
    if (state.adjudication?.kind === "repetition-draw") {
      expect(state.adjudication.occurrences).toBe(2);
      expect(state.adjudication.threshold).toBe(2);
    }
  });

  it("threefold policy permits one full return and draws on the second return", () => {
    const policy = { kind: "repeat-draw", occurrences: 3 } as const;
    let state = createPolicyState(exactCycleFixture());

    state = play(state, "B2:CCW", policy);
    state = play(state, "T2:CW", policy);
    expect(state.adjudication).toBeNull();

    state = play(state, "B2:CCW", policy);
    state = play(state, "T2:CW", policy);
    expect(state.adjudication?.kind).toBe("repetition-draw");
    if (state.adjudication?.kind === "repetition-draw") {
      expect(state.adjudication.occurrences).toBe(3);
      expect(state.plies).toBe(4);
    }
  });

  it("max-ply policy is an independent operational safeguard", () => {
    const policy = { kind: "max-ply", maxPlies: 2 } as const;
    let state = createPolicyState(exactCycleFixture());
    state = play(state, "B2:CCW", policy);
    expect(state.adjudication).toBeNull();
    state = play(state, "T2:CW", policy);
    expect(state.adjudication).toEqual({ kind: "max-ply-draw", plies: 2, maxPlies: 2 });
  });

  it("memo keys distinguish repetition context that changes future adjudication", () => {
    const policy = { kind: "repeat-draw", occurrences: 3 } as const;
    const start = createPolicyState(exactCycleFixture());
    let onceReturned = play(start, "B2:CCW", policy);
    onceReturned = play(onceReturned, "T2:CW", policy);

    expect(exactStrategicStateKey(start.game)).toBe(exactStrategicStateKey(onceReturned.game));
    expect(policyStateKey(start, policy)).not.toBe(policyStateKey(onceReturned, policy));
  });

  it("policy-aware exact solver becomes finite under a one-ply safeguard", () => {
    const result = solveExactWithPolicy(
      exactCycleFixture(),
      { kind: "max-ply", maxPlies: 1 },
      { maxRootBoardValue: 20, nodeBudget: 10_000, timeBudgetMs: 5_000 },
    );

    expect(result.solved).toBe(true);
    expect(result.status).toBe("solved");
    expect(result.diagnostics.policyDrawLeaves + result.diagnostics.naturalTerminalLeaves).toBeGreaterThan(0);
  });
});
