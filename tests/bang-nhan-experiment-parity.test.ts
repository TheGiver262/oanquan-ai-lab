import { describe, expect, it } from "vitest";
import { applyMove, createInitialState, getLegalMoves } from "../src/engine.js";
import { PRODUCTION_TOP_PROFILES } from "../src/reference/production-ai.js";
import { chooseServerProductionMoveWithDiagnostics } from "../src/reference/server-production-ai.js";
import { chooseBangNhanExperimentMove } from "../src/research/bang-nhan-ordering-experiment.js";
import type { GameState } from "../src/types.js";

describe("Bảng Nhãn ordering experiment parity", () => {
  it("matches server production decisions before enabling the ordering fix", () => {
    const profile = PRODUCTION_TOP_PROFILES["bang-nhan"];
    const originalBudget = profile.nodeBudget;
    const originalCache = profile.maxCacheEntries;
    profile.nodeBudget = 5_000;
    profile.maxCacheEntries = 2_000;

    try {
      for (const [index, state] of corpus().entries()) {
        const server = chooseServerProductionMoveWithDiagnostics(state, "bang-nhan", state.currentPlayer, {
          mode: "production-max",
          now: () => 0,
          random: mulberry32(1000 + index),
          timeBudgetMs: 60_000,
        });
        const experiment = chooseBangNhanExperimentMove(state, state.currentPlayer, {
          orderingMode: "production-ordering",
          now: () => 0,
          random: mulberry32(1000 + index),
          timeBudgetMs: 60_000,
        });

        expect(experiment.move, `state ${index}`).toEqual(server.move);
        expect(experiment.completedDepth, `depth ${index}`).toBe(server.completedDepth);
        expect(experiment.nodeCount, `nodes ${index}`).toBe(server.nodeCount);
      }
    } finally {
      profile.nodeBudget = originalBudget;
      profile.maxCacheEntries = originalCache;
    }
  });
});

function corpus(): GameState[] {
  const states: GameState[] = [];
  let state = createInitialState();
  states.push(state);

  for (let ply = 0; ply < 18 && state.status === "playing"; ply += 1) {
    const moves = getLegalMoves(state);
    const move = moves[(ply * 3 + 1) % moves.length];
    if (!move) break;
    const result = applyMove(state, move);
    if (!result.ok) break;
    state = result.state;
    if (ply % 2 === 0 || state.moveNumber >= 12) states.push(state);
  }
  return states.slice(0, 10);
}

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
