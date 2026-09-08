import { createInitialState, getLegalMoves } from "../engine.js";
import type { GameState, PlayerMove } from "../types.js";
import { boardValue } from "./exact-endgame-v4.js";
import {
  applyPolicyMove,
  createPolicyState,
  type PolicyState,
  type RepetitionPolicy,
} from "./repetition-policy-v5.js";
import {
  V3_50M_PV,
  type V3EvaluationFamily,
  type V3FinalistOpening,
} from "./v3-pv-corpus.js";

export type PolicyPvSnapshot = {
  ply: number;
  moveApplied: string | null;
  boardValue: number;
  state: PolicyState;
};

export type PolicyPvReplay = {
  opening: V3FinalistOpening;
  family: V3EvaluationFamily;
  policy: RepetitionPolicy;
  completedRecordedLine: boolean;
  stoppedReason: "recorded-line-end" | "canonical-terminal" | "policy-adjudication";
  snapshots: PolicyPvSnapshot[];
};

/**
 * Replays the V3 50M evidence line from the true initial position so repetition
 * counts at a deep state include the entire preceding path.
 */
export function replayV3PvWithPolicy(
  opening: V3FinalistOpening,
  family: V3EvaluationFamily,
  policy: RepetitionPolicy,
): PolicyPvReplay {
  let state = createPolicyState(createInitialState());
  const snapshots: PolicyPvSnapshot[] = [snapshot(state, 0, null)];

  state = applyRequired(state, opening, policy);
  snapshots.push(snapshot(state, 1, opening));
  if (state.game.status === "finished" || state.adjudication !== null) {
    return finishReplay(opening, family, policy, snapshots, false);
  }

  const pv = V3_50M_PV[`${opening}:${family}`];
  for (let index = 0; index < pv.length; index += 1) {
    const key = pv[index]!;
    state = applyRequired(state, key, policy);
    snapshots.push(snapshot(state, index + 2, key));
    if (state.game.status === "finished" || state.adjudication !== null) {
      return finishReplay(opening, family, policy, snapshots, false);
    }
  }

  return {
    opening,
    family,
    policy,
    completedRecordedLine: true,
    stoppedReason: "recorded-line-end",
    snapshots,
  };
}

function finishReplay(
  opening: V3FinalistOpening,
  family: V3EvaluationFamily,
  policy: RepetitionPolicy,
  snapshots: PolicyPvSnapshot[],
  completedRecordedLine: boolean,
): PolicyPvReplay {
  const last = snapshots[snapshots.length - 1]!;
  return {
    opening,
    family,
    policy,
    completedRecordedLine,
    stoppedReason: last.state.game.status === "finished" ? "canonical-terminal" : "policy-adjudication",
    snapshots,
  };
}

function applyRequired(state: PolicyState, key: string, policy: RepetitionPolicy): PolicyState {
  const move = findMove(state.game, key);
  const applied = applyPolicyMove(state, move, policy);
  if (!applied.ok) throw new Error(`Failed recorded move ${key}: ${applied.error}`);
  return applied.state;
}

function findMove(game: GameState, key: string): PlayerMove {
  const [pit, dir] = key.split(":");
  const move = getLegalMoves(game).find((candidate) => candidate.pit === pit && candidate.dir === dir);
  if (!move) throw new Error(`Illegal recorded move ${key} for ${game.currentPlayer} at move ${game.moveNumber}`);
  return move;
}

function snapshot(state: PolicyState, ply: number, moveApplied: string | null): PolicyPvSnapshot {
  return {
    ply,
    moveApplied,
    boardValue: boardValue(state.game),
    state: {
      game: structuredClone(state.game),
      repetitionCounts: new Map(state.repetitionCounts),
      plies: state.plies,
      adjudication: state.adjudication ? structuredClone(state.adjudication) : null,
    },
  };
}
