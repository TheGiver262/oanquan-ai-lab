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
  const ruleset = mode === "quan-gia"
    ? MATURE_QUAN_RULESET
    : mode === "quan-gia-threefold" || mode === "quan-gia-pie-threefold"
      ? MATURE_QUAN_THREEFOLD_RULESET
      : modeUsesThreefold(mode)
        ? CLASSIC_STANDARD_THREEFOLD_RULESET
        : CLASSIC_STANDARD_RULESET;
  const responderAgent = otherResearchAgent(openerAgent);
  const seatToAgent: SeatToAgent = Object.freeze({ P0: openerAgent, P1: responderAgent });

  return {
    mode,
    game: createInitialState(ruleset),
    seatToAgent,
    swap: initialSwapState(mode, responderAgent),
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

  return {
    ok: true,
    state: {
      ...state,
      game: applied.state,
      swap: actor === state.swap.responderAgent && state.swap.enabled && !state.swap.used
        ? {
            ...state.swap,
            responderNormalMovesTaken: state.swap.responderNormalMovesTaken + 1,
          }
        : state.swap,
    },
    events: applied.events,
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
