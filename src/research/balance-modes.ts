import {
  applyMove,
  CLASSIC_STANDARD_RULESET,
  CLASSIC_STANDARD_THREEFOLD_RULESET,
  createInitialState,
  getLegalMoves,
  MATURE_QUAN_RULESET,
} from "../engine.js";
import type { GameState, MoveEvent, PlayerId, PlayerMove, ResolvedRuleset } from "../types.js";

export type ResearchAgentId = "A" | "B";

export type BalanceModeId =
  | "standard"
  | "pie-threefold"
  | "delayed-pie-4-threefold"
  | "delayed-pie-6-threefold"
  | "open-pie-threefold"
  | "quan-gia"
  | "quan-gia-threefold"
  | "quan-gia-positional-threefold"
  | "quan-gia-pie-threefold";

export type SeatToAgent = Readonly<Record<PlayerId, ResearchAgentId>>;

export type SwapState = Readonly<{
  enabled: boolean;
  used: boolean;
  /** Research-agent identity that started the game as the responder (logical P1). */
  responderAgent: ResearchAgentId;
  /** Number of ordinary board moves already taken by the original responder. */
  responderNormalMovesTaken: number;
  /** null means no expiry; 0 means swap disabled. */
  maxResponderNormalMovesBeforeExpiry: number | null;
}>;

export type BalanceState = Readonly<{
  mode: BalanceModeId;
  game: GameState;
  seatToAgent: SeatToAgent;
  swap: SwapState;
  /**
   * Exact start-of-turn strategic positions seen so far. Populated only by
   * positional-repetition research modes; omitted/empty elsewhere.
   */
  positionalHistory?: readonly string[];
}>;

export type BalanceAction =
  | Readonly<{ kind: "move"; move: PlayerMove }>
  | Readonly<{ kind: "swap"; agent: ResearchAgentId }>;

export type BalanceApplyResult =
  | Readonly<{ ok: true; state: BalanceState; events: readonly MoveEvent[] }>
  | Readonly<{ ok: false; error: string }>;

const MATURE_QUAN_THREEFOLD_RULESET: ResolvedRuleset = Object.freeze({
  ...MATURE_QUAN_RULESET,
  canonicalRulesetId: "oaq:classic_2p:mature_quan_threefold:v1",
  repetitionPolicy: "threefold",
});

export function createBalanceInitialState(
  mode: BalanceModeId,
  openerAgent: ResearchAgentId = "A",
): BalanceState {
  const ruleset = mode === "quan-gia" || mode === "quan-gia-positional-threefold"
    ? MATURE_QUAN_RULESET
    : mode === "quan-gia-threefold" || mode === "quan-gia-pie-threefold"
      ? MATURE_QUAN_THREEFOLD_RULESET
      : modeUsesThreefold(mode)
        ? CLASSIC_STANDARD_THREEFOLD_RULESET
        : CLASSIC_STANDARD_RULESET;
  const responderAgent = otherResearchAgent(openerAgent);
  const seatToAgent: SeatToAgent = Object.freeze({ P0: openerAgent, P1: responderAgent });
  const game = createInitialState(ruleset);

  return {
    mode,
    game,
    seatToAgent,
    swap: initialSwapState(mode, responderAgent),
    positionalHistory: modeUsesPositionalThreefold(mode) ? [positionalRepetitionKey(game)] : [],
  };
}

export function modeUsesThreefold(mode: BalanceModeId): boolean {
  return mode === "pie-threefold"
    || mode === "delayed-pie-4-threefold"
    || mode === "delayed-pie-6-threefold"
    || mode === "open-pie-threefold"
    || mode === "quan-gia-threefold"
    || mode === "quan-gia-pie-threefold";
}

export function modeUsesPositionalThreefold(mode: BalanceModeId): boolean {
  return mode === "quan-gia-positional-threefold";
}

export function modeHasSwap(mode: BalanceModeId): boolean {
  return mode === "pie-threefold"
    || mode === "delayed-pie-4-threefold"
    || mode === "delayed-pie-6-threefold"
    || mode === "open-pie-threefold"
    || mode === "quan-gia-pie-threefold";
}

export function currentAgent(state: BalanceState): ResearchAgentId {
  return state.seatToAgent[state.game.currentPlayer];
}

export function seatForAgent(state: BalanceState, agent: ResearchAgentId): PlayerId {
  return state.seatToAgent.P0 === agent ? "P0" : "P1";
}

export function winnerAgent(state: BalanceState): ResearchAgentId | null {
  if (state.game.winner === null) return null;
  return state.seatToAgent[state.game.winner];
}

export function isSwapEligible(state: BalanceState): boolean {
  if (state.game.status !== "playing") return false;
  if (!state.swap.enabled || state.swap.used) return false;
  if (state.game.moveNumber < 1) return false;
  if (currentAgent(state) !== state.swap.responderAgent) return false;
  const limit = state.swap.maxResponderNormalMovesBeforeExpiry;
  return limit === null || state.swap.responderNormalMovesTaken < limit;
}

export function getBalanceActions(state: BalanceState): BalanceAction[] {
  if (state.game.status !== "playing") return [];
  const actions: BalanceAction[] = getLegalMoves(state.game).map((move) => ({ kind: "move", move }));
  if (isSwapEligible(state)) actions.push({ kind: "swap", agent: state.swap.responderAgent });
  return actions;
}

/**
 * SWAP is a protocol action, not a board move:
 * - only the original responder owns the one-shot right;
 * - the board, history, scores and logical currentPlayer remain unchanged;
 * - seat ownership flips P0<->P1;
 * - because logical currentPlayer does not change, the newly owning agent acts next.
 *
 * This matches classic Pie after move 1 and generalizes cleanly to delayed/open Pie.
 */
export function applyBalanceAction(state: BalanceState, action: BalanceAction): BalanceApplyResult {
  if (state.game.status !== "playing") return { ok: false, error: "match_finished" };

  if (action.kind === "swap") {
    if (action.agent !== state.swap.responderAgent || !isSwapEligible(state)) {
      return { ok: false, error: "swap_not_available" };
    }
    return {
      ok: true,
      state: {
        ...state,
        seatToAgent: { P0: state.seatToAgent.P1, P1: state.seatToAgent.P0 },
        swap: { ...state.swap, used: true },
      },
      events: [],
    };
  }

  if (action.move.player !== state.game.currentPlayer) return { ok: false, error: "wrong_logical_seat" };
  const actor = currentAgent(state);
  const applied = applyMove(state.game, action.move);
  if (!applied.ok) return { ok: false, error: applied.error };

  const nextGame = applied.state;
  const nextEvents = [...applied.events];
  let positionalHistory = state.positionalHistory ?? [];

  if (modeUsesPositionalThreefold(state.mode) && nextGame.status === "playing") {
    const positionKey = positionalRepetitionKey(nextGame);
    const priorOccurrences = positionalHistory.reduce(
      (count, key) => count + (key === positionKey ? 1 : 0),
      0,
    );
    positionalHistory = [...positionalHistory, positionKey];
    if (priorOccurrences + 1 >= 3) {
      finishByPositionalRepetition(nextGame, nextEvents);
    }
  }

  return {
    ok: true,
    state: {
      ...state,
      game: nextGame,
      swap: actor === state.swap.responderAgent && state.swap.enabled && !state.swap.used
        ? {
            ...state.swap,
            responderNormalMovesTaken: state.swap.responderNormalMovesTaken + 1,
          }
        : state.swap,
      positionalHistory,
    },
    events: nextEvents,
  };
}

export function balanceActionKey(action: BalanceAction): string {
  return action.kind === "swap" ? "SWAP" : `${action.move.pit}:${action.move.dir}`;
}

export function cloneBalanceState(state: BalanceState): BalanceState {
  return {
    ...state,
    game: {
      ...state.game,
      pits: state.game.pits.map((pit) => ({ ...pit })),
      scores: { ...state.game.scores },
      skipCounts: {
        P0: { ...state.game.skipCounts.P0 },
        P1: { ...state.game.skipCounts.P1 },
      },
      recentMoves: state.game.recentMoves.map((move) => ({ ...move })),
    },
    seatToAgent: { ...state.seatToAgent },
    swap: { ...state.swap },
    positionalHistory: state.positionalHistory ? [...state.positionalHistory] : [],
  };
}

function initialSwapState(mode: BalanceModeId, responderAgent: ResearchAgentId): SwapState {
  if (mode === "pie-threefold" || mode === "quan-gia-pie-threefold") {
    return {
      enabled: true,
      used: false,
      responderAgent,
      responderNormalMovesTaken: 0,
      maxResponderNormalMovesBeforeExpiry: 1,
    };
  }
  if (mode === "delayed-pie-4-threefold") {
    return {
      enabled: true,
      used: false,
      responderAgent,
      responderNormalMovesTaken: 0,
      maxResponderNormalMovesBeforeExpiry: 2,
    };
  }
  if (mode === "delayed-pie-6-threefold") {
    return {
      enabled: true,
      used: false,
      responderAgent,
      responderNormalMovesTaken: 0,
      maxResponderNormalMovesBeforeExpiry: 3,
    };
  }
  if (mode === "open-pie-threefold") {
    return {
      enabled: true,
      used: false,
      responderAgent,
      responderNormalMovesTaken: 0,
      maxResponderNormalMovesBeforeExpiry: null,
    };
  }
  return {
    enabled: false,
    used: false,
    responderAgent,
    responderNormalMovesTaken: 0,
    maxResponderNormalMovesBeforeExpiry: 0,
  };
}

function otherResearchAgent(agent: ResearchAgentId): ResearchAgentId {
  return agent === "A" ? "B" : "A";
}


const POSITION_REFLECT_PIT: Readonly<Record<string, string>> = Object.freeze({
  L: "R",
  R: "L",
  T1: "T5",
  T2: "T4",
  T3: "T3",
  T4: "T2",
  T5: "T1",
  B1: "B5",
  B2: "B4",
  B3: "B3",
  B4: "B2",
  B5: "B1",
});

export function positionalRepetitionKey(game: GameState): string {
  return JSON.stringify([
    game.currentPlayer,
    game.scores.P0,
    game.scores.P1,
    game.pits.map((pit) => [pit.id, pit.stones, pit.quanStones]),
  ]);
}

export function reflectPositionalRepetitionKey(key: string): string {
  const parsed = JSON.parse(key) as [
    PlayerId,
    number,
    number,
    Array<[string, number, number]>,
  ];
  const [currentPlayer, p0Score, p1Score, pits] = parsed;
  const byId = new Map(pits.map((entry) => [entry[0], entry] as const));
  const reflectedPits = pits.map(([targetId]) => {
    const sourceId = POSITION_REFLECT_PIT[targetId];
    const source = sourceId ? byId.get(sourceId) : undefined;
    if (!source) throw new Error(`Cannot reflect positional repetition pit ${targetId}`);
    return [targetId, source[1], source[2]] as [string, number, number];
  });
  return JSON.stringify([currentPlayer, p0Score, p1Score, reflectedPits]);
}

function finishByPositionalRepetition(game: GameState, events: MoveEvent[]): void {
  for (const pit of game.pits) {
    if (pit.kind !== "dan" || pit.owner === null) continue;
    game.scores[pit.owner] += pit.stones;
    pit.stones = 0;
  }
  game.status = "finished";
  game.winner = game.scores.P0 === game.scores.P1
    ? null
    : game.scores.P0 > game.scores.P1
      ? "P0"
      : "P1";
  events.push({ type: "match_finished", winner: game.winner, reason: "repeated_position" });
}
