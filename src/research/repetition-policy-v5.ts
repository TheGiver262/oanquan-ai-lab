import { applyMove } from "../engine.js";
import type { GameState, PlayerMove } from "../types.js";
import { exactStrategicStateKey } from "./exact-endgame-v4.js";

export type RepetitionPolicy =
  | { kind: "none" }
  | { kind: "repeat-draw"; occurrences: 2 | 3 }
  | { kind: "max-ply"; maxPlies: number };

export type PolicyAdjudication =
  | {
      kind: "repetition-draw";
      strategicStateKey: string;
      occurrences: number;
      threshold: 2 | 3;
    }
  | {
      kind: "max-ply-draw";
      plies: number;
      maxPlies: number;
    };

export type PolicyState = {
  game: GameState;
  /** Number of times each full strategic position has occurred on this path. */
  repetitionCounts: ReadonlyMap<string, number>;
  /** Number of moves applied since this research wrapper was initialized. */
  plies: number;
  adjudication: PolicyAdjudication | null;
};

export type PolicyMoveResult =
  | { ok: true; state: PolicyState }
  | { ok: false; error: string };

/**
 * Creates research-only policy state without changing the canonical game engine.
 * The starting strategic position counts as occurrence #1.
 */
export function createPolicyState(game: GameState): PolicyState {
  const key = exactStrategicStateKey(game);
  return {
    game: structuredClone(game),
    repetitionCounts: new Map([[key, 1]]),
    plies: 0,
    adjudication: null,
  };
}

/**
 * Applies one canonical engine move, then applies the selected research policy.
 * Natural game termination always takes precedence over research adjudication.
 */
export function applyPolicyMove(
  state: PolicyState,
  move: PlayerMove,
  policy: RepetitionPolicy,
): PolicyMoveResult {
  if (state.adjudication !== null) {
    return { ok: false, error: "research policy state is already adjudicated" };
  }
  if (state.game.status === "finished") {
    return { ok: false, error: "canonical game is already finished" };
  }

  validatePolicy(policy);
  const applied = applyMove(state.game, move);
  if (!applied.ok) return applied;

  const plies = state.plies + 1;
  const counts = new Map(state.repetitionCounts);
  const strategicStateKey = exactStrategicStateKey(applied.state);
  const occurrences = (counts.get(strategicStateKey) ?? 0) + 1;
  counts.set(strategicStateKey, occurrences);

  if (applied.state.status === "finished") {
    return {
      ok: true,
      state: {
        game: applied.state,
        repetitionCounts: counts,
        plies,
        adjudication: null,
      },
    };
  }

  let adjudication: PolicyAdjudication | null = null;
  if (policy.kind === "repeat-draw" && occurrences >= policy.occurrences) {
    adjudication = {
      kind: "repetition-draw",
      strategicStateKey,
      occurrences,
      threshold: policy.occurrences,
    };
  } else if (policy.kind === "max-ply" && plies >= policy.maxPlies) {
    adjudication = {
      kind: "max-ply-draw",
      plies,
      maxPlies: policy.maxPlies,
    };
  }

  return {
    ok: true,
    state: {
      game: applied.state,
      repetitionCounts: counts,
      plies,
      adjudication,
    },
  };
}

export function isPolicyTerminal(state: PolicyState): boolean {
  return state.game.status === "finished" || state.adjudication !== null;
}

/**
 * Exact memo key for a research-policy node.
 *
 * Repetition history is part of the game state under repeat-draw policies:
 * two identical boards with different prior occurrence counts can have
 * different legal futures. Counts are capped below the threshold because a
 * node at the threshold is already terminal by policy.
 */
export function policyStateKey(state: PolicyState, policy: RepetitionPolicy): string {
  const base = exactStrategicStateKey(state.game);
  if (policy.kind === "none") return `none|${base}`;
  if (policy.kind === "max-ply") return `max:${policy.maxPlies}:${state.plies}|${base}`;

  const relevantCounts = [...state.repetitionCounts.entries()]
    .filter(([, count]) => count > 0)
    .map(([key, count]) => [key, Math.min(count, policy.occurrences)] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return `repeat:${policy.occurrences}|${base}|${JSON.stringify(relevantCounts)}`;
}

export function describeRepetitionPolicy(policy: RepetitionPolicy): string {
  switch (policy.kind) {
    case "none":
      return "no repetition adjudication";
    case "repeat-draw":
      return `${policy.occurrences}-occurrence repeated-position draw`;
    case "max-ply":
      return `maximum ${policy.maxPlies} plies draw safeguard`;
  }
}

export function validatePolicy(policy: RepetitionPolicy): void {
  if (policy.kind === "repeat-draw" && policy.occurrences !== 2 && policy.occurrences !== 3) {
    throw new Error("repeat-draw occurrences must be 2 or 3");
  }
  if (policy.kind === "max-ply" && (!Number.isInteger(policy.maxPlies) || policy.maxPlies <= 0)) {
    throw new Error("max-ply maxPlies must be a positive integer");
  }
}
