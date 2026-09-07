import { describe, expect, it } from "vitest";
import { applyMove, createInitialState } from "../src/engine.js";
import {
  PRODUCTION_TOP_PROFILES,
  enumerateProductionMoves,
  evaluateProductionState,
} from "../src/reference/production-ai.js";
import type { GameState, PlayerId, PlayerMove } from "../src/types.js";

type PathState = { state: GameState; path: PlayerMove[] };

function otherPlayer(player: PlayerId): PlayerId {
  return player === "P0" ? "P1" : "P0";
}

function productionOrderingScore(
  candidate: ReturnType<typeof enumerateProductionMoves>[number],
  aiPlayer: PlayerId,
): number {
  const profile = PRODUCTION_TOP_PROFILES["bang-nhan"];
  const requestedThreatPlayer = otherPlayer(aiPlayer);
  // Mirrors bestImmediateGain(): it returns zero unless that player is the side to move.
  const opponentThreat = candidate.state.currentPlayer === requestedThreatPlayer
    ? Math.max(0, ...enumerateProductionMoves(candidate.state, requestedThreatPlayer).map((c) => c.immediateGain))
    : 0;
  return candidate.immediateGain * profile.weights.immediateCapture
    - opponentThreat * profile.weights.opponentThreat
    + evaluateProductionState(candidate.state, aiPlayer, profile) * 0.05;
}

function findCounterexample(): {
  state: GameState;
  path: PlayerMove[];
  aiPlayer: PlayerId;
  cap: number;
  kept: Array<{ move: string; gain: number; score: number }>;
  pruned: Array<{ move: string; gain: number; score: number }>;
} | null {
  const profile = PRODUCTION_TOP_PROFILES["bang-nhan"];
  let frontier: PathState[] = [{ state: createInitialState(), path: [] }];

  for (let ply = 0; ply <= 5; ply += 1) {
    const next: PathState[] = [];
    for (const item of frontier) {
      if (item.state.status !== "playing") continue;
      const aiPlayer = otherPlayer(item.state.currentPlayer);
      const candidates = enumerateProductionMoves(item.state, item.state.currentPlayer);
      const cap = profile.maxBranchingMoves +
        (aiPlayer === "P1" ? (profile.secondPlayerBranchingBonus ?? 0) : 0);

      if (candidates.length > cap) {
        const scored = candidates.map((candidate) => ({
          candidate,
          score: productionOrderingScore(candidate, aiPlayer),
        })).sort((a, b) => a.score - b.score); // opponent/min node ordering in production
        const keptRaw = scored.slice(0, cap);
        const prunedRaw = scored.slice(cap);
        const maxGain = Math.max(...candidates.map((c) => c.immediateGain));
        const dangerousPruned = prunedRaw.some(({ candidate }) => candidate.immediateGain === maxGain && maxGain > 0);
        const keptMaxGain = Math.max(...keptRaw.map(({ candidate }) => candidate.immediateGain));
        if (dangerousPruned && maxGain > keptMaxGain) {
          const map = ({ candidate, score }: (typeof scored)[number]) => ({
            move: `${candidate.move.pit}:${candidate.move.dir}`,
            gain: candidate.immediateGain,
            score,
          });
          return {
            state: item.state,
            path: item.path,
            aiPlayer,
            cap,
            kept: keptRaw.map(map),
            pruned: prunedRaw.map(map),
          };
        }
      }

      if (ply < 5) {
        for (const move of item.state.status === "playing" ? item.state.currentPlayer === "P0" || item.state.currentPlayer === "P1" ? enumerateProductionMoves(item.state).slice(0, 10) : [] : []) {
          next.push({
            state: move.state,
            path: [...item.path, { player: item.state.currentPlayer, ...move.move }],
          });
        }
      }
    }
    frontier = next.slice(0, 20_000);
  }
  return null;
}

describe("Bảng Nhãn opponent move ordering", () => {
  it("can prune the opponent's highest immediate-gain reply because the sign is reversed", () => {
    const example = findCounterexample();
    expect(example).not.toBeNull();
    console.log("BANG_NHAN_ORDERING_COUNTEREXAMPLE", JSON.stringify(example, null, 2));
    if (!example) return;
    const maxKeptGain = Math.max(...example.kept.map((x) => x.gain));
    const maxPrunedGain = Math.max(...example.pruned.map((x) => x.gain));
    expect(maxPrunedGain).toBeGreaterThan(maxKeptGain);
  });
});
