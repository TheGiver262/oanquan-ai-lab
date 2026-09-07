import type { ApplyMoveResult, DanPitId, Direction, GameState, MoveEvent, Pit, PitId, PlayerId, PlayerMove, ResolvedRuleset } from "./types.js";

export const CLASSIC_STANDARD_RULESET: ResolvedRuleset = Object.freeze({
  canonicalRulesetId: "oaq:classic_2p:standard:v1",
  ruleProfileId: "standard_v1",
});
export const NO_FIRST_QUAN_RULESET: ResolvedRuleset = Object.freeze({
  canonicalRulesetId: "oaq:classic_2p:no_first_quan:v1",
  ruleProfileId: "no_first_quan_v1",
});
export const MATURE_QUAN_RULESET: ResolvedRuleset = Object.freeze({
  canonicalRulesetId: "oaq:classic_2p:mature_quan:v1",
  ruleProfileId: "mature_quan_v1",
});

const QUAN_VALUE = 10;
const REFILL_COST = 5;
const PLAYER_PITS: Record<PlayerId, DanPitId[]> = {
  P0: ["B1", "B2", "B3", "B4", "B5"],
  P1: ["T1", "T2", "T3", "T4", "T5"],
};
const DIRECTIONS: Direction[] = ["CW", "CCW"];

export function createInitialState(ruleset: ResolvedRuleset = CLASSIC_STANDARD_RULESET): GameState {
  const pits: Pit[] = [
    { id: "L", owner: null, kind: "quan", stones: 0, quanStones: 1 },
    { id: "T1", owner: "P1", kind: "dan", stones: 5, quanStones: 0 },
    { id: "T2", owner: "P1", kind: "dan", stones: 5, quanStones: 0 },
    { id: "T3", owner: "P1", kind: "dan", stones: 5, quanStones: 0 },
    { id: "T4", owner: "P1", kind: "dan", stones: 5, quanStones: 0 },
    { id: "T5", owner: "P1", kind: "dan", stones: 5, quanStones: 0 },
    { id: "R", owner: null, kind: "quan", stones: 0, quanStones: 1 },
    { id: "B5", owner: "P0", kind: "dan", stones: 5, quanStones: 0 },
    { id: "B4", owner: "P0", kind: "dan", stones: 5, quanStones: 0 },
    { id: "B3", owner: "P0", kind: "dan", stones: 5, quanStones: 0 },
    { id: "B2", owner: "P0", kind: "dan", stones: 5, quanStones: 0 },
    { id: "B1", owner: "P0", kind: "dan", stones: 5, quanStones: 0 },
  ];
  return {
    rulesetId: "classic_v1",
    ruleset,
    pits,
    currentPlayer: "P0",
    scores: { P0: 0, P1: 0 },
    skipCounts: { P0: { consecutive: 0, total: 0 }, P1: { consecutive: 0, total: 0 } },
    status: "playing",
    winner: null,
    moveNumber: 0,
    recentMoves: [],
  };
}

export function getLegalMoves(state: GameState, player: PlayerId = state.currentPlayer): PlayerMove[] {
  if (state.status === "finished" || player !== state.currentPlayer) return [];
  const playable = PLAYER_PITS[player].filter((id) => (state.pits.find((p) => p.id === id)?.stones ?? 0) > 0);
  const pits = playable.length === 0 && state.scores[player] >= REFILL_COST ? PLAYER_PITS[player] : playable;
  return pits.flatMap((pit) => DIRECTIONS.flatMap((dir) => {
    const move: PlayerMove = { player, pit, dir };
    return applyMove(state, move).ok ? [move] : [];
  }));
}

export function applyMove(state: GameState, move: PlayerMove): ApplyMoveResult {
  if (state.status === "finished") return { ok: false, error: "match_finished" };
  if (state.currentPlayer !== move.player) return { ok: false, error: "not_players_turn" };
  const nextState = cloneState(state);
  const events: MoveEvent[] = [];
  maybeRefillSide(nextState, move.player, events);
  if (nextState.status === "finished") return { ok: true, state: nextState, events };

  const startIndex = pitIndex(nextState, move.pit);
  const startPit = nextState.pits[startIndex];
  if (!startPit || startPit.owner !== move.player) return { ok: false, error: "pit_not_owned" };
  if (startPit.kind !== "dan" || startPit.stones <= 0) return { ok: false, error: "empty_pit" };

  let hand = startPit.stones;
  startPit.stones = 0;
  let cursor = startIndex;
  const step = move.dir === "CW" ? 1 : -1;
  events.push({ type: "stones_picked", player: move.player, pit: move.pit, count: hand });

  for (;;) {
    while (hand > 0) {
      cursor = wrap(cursor + step);
      const sowPit = nextState.pits[cursor];
      if (!sowPit) throw new Error("Invalid pit cursor");
      sowPit.stones += 1;
      hand -= 1;
      events.push({ type: "stone_sown", pit: sowPit.id, stones: sowPit.stones });
    }
    const nextIndex = wrap(cursor + step);
    const nextPit = nextState.pits[nextIndex];
    if (!nextPit) throw new Error("Invalid next pit");
    if (pieceCount(nextPit) === 0) {
      const error = resolveCaptureChain(nextState, move.player, nextIndex, step, events);
      if (error) return { ok: false, error };
      break;
    }
    if (nextPit.kind === "quan") break;
    hand = nextPit.stones;
    nextPit.stones = 0;
    cursor = nextIndex;
    events.push({ type: "stones_picked", player: move.player, pit: nextPit.id as DanPitId, count: hand });
  }

  maybeEndByQuan(nextState, events);
  if (!isFinished(nextState)) {
    nextState.currentPlayer = otherPlayer(move.player);
    recordRecentMove(nextState, move);
    events.push({ type: "turn_changed", currentPlayer: nextState.currentPlayer });
    maybeRefillSide(nextState, nextState.currentPlayer, events);
  } else {
    recordRecentMove(nextState, move);
  }
  nextState.moveNumber += 1;
  nextState.skipCounts[move.player] = { ...nextState.skipCounts[move.player], consecutive: 0 };
  events.unshift({ type: "move_accepted", player: move.player, pit: move.pit, dir: move.dir });
  return { ok: true, state: nextState, events };
}

function getQuanCaptureDecision(state: GameState, pit: Pit): "capture" | "stop" | "forbidden" {
  if (pit.quanStones === 0) return "capture";
  if (state.ruleset.ruleProfileId === "no_first_quan_v1" && state.moveNumber === 0) return "forbidden";
  if (state.ruleset.ruleProfileId === "mature_quan_v1" && pit.stones < 5) return "stop";
  return "capture";
}

function resolveCaptureChain(state: GameState, player: PlayerId, emptyIndex: number, step: number, events: MoveEvent[]): "first_turn_quan_forbidden" | null {
  let captureCursor = emptyIndex;
  for (;;) {
    const captureIndex = wrap(captureCursor + step);
    const capturePit = state.pits[captureIndex];
    if (!capturePit || pieceCount(capturePit) <= 0) return null;
    if (capturePit.kind === "quan") {
      const decision = getQuanCaptureDecision(state, capturePit);
      if (decision === "forbidden" && player === "P0") return "first_turn_quan_forbidden";
      if (decision === "stop") return null;
    }
    const value = pitValue(capturePit);
    state.scores[player] += value;
    capturePit.stones = 0;
    capturePit.quanStones = 0;
    const emptyPit = state.pits[captureCursor];
    events.push({ type: "capture_resolved", player, ...(emptyPit ? { emptyPit: emptyPit.id } : {}), pit: capturePit.id, value });
    const nextEmptyIndex = wrap(captureIndex + step);
    const nextEmptyPit = state.pits[nextEmptyIndex];
    if (!nextEmptyPit || pieceCount(nextEmptyPit) !== 0) return null;
    captureCursor = nextEmptyIndex;
  }
}

function maybeRefillSide(state: GameState, player: PlayerId, events: MoveEvent[]): void {
  const side = PLAYER_PITS[player].map((id) => state.pits[pitIndex(state, id)]).filter((p): p is Pit => Boolean(p));
  if (side.reduce((sum, pit) => sum + pit.stones, 0) > 0) return;
  if (state.scores[player] >= REFILL_COST) {
    state.scores[player] -= REFILL_COST;
    for (const pit of side) pit.stones += 1;
    events.push({ type: "side_refilled", player });
    return;
  }
  collectRemaining(state);
  finishMatch(state, events, "no_refill", otherPlayer(player));
}

function maybeEndByQuan(state: GameState, events: MoveEvent[]): void {
  if (state.pits.filter((p) => p.kind === "quan").every((p) => pieceCount(p) === 0)) {
    collectRemaining(state);
    finishMatch(state, events, "both_quan_empty");
  }
}

function collectRemaining(state: GameState): void {
  for (const player of ["P0", "P1"] as const) {
    for (const pitId of PLAYER_PITS[player]) {
      const pit = state.pits[pitIndex(state, pitId)];
      if (!pit) continue;
      state.scores[player] += pitValue(pit);
      pit.stones = 0;
      pit.quanStones = 0;
    }
  }
}

function finishMatch(state: GameState, events: MoveEvent[], reason: "both_quan_empty" | "no_refill", forcedWinner?: PlayerId): void {
  state.status = "finished";
  state.winner = forcedWinner ?? (state.scores.P0 === state.scores.P1 ? null : state.scores.P0 > state.scores.P1 ? "P0" : "P1");
  events.push({ type: "match_finished", winner: state.winner, reason });
}

function isFinished(state: GameState): boolean { return state.status === "finished"; }
function cloneState(state: GameState): GameState {
  return { ...state, pits: state.pits.map((p) => ({ ...p })), scores: { ...state.scores }, skipCounts: { P0: { ...state.skipCounts.P0 }, P1: { ...state.skipCounts.P1 } }, recentMoves: state.recentMoves.map((m) => ({ ...m })) };
}
function recordRecentMove(state: GameState, move: PlayerMove): void { state.recentMoves = [...state.recentMoves, { ...move }].slice(-6); }
function pitIndex(state: GameState, id: PitId): number { return state.pits.findIndex((p) => p.id === id); }
function pieceCount(pit: Pit): number { return pit.stones + pit.quanStones; }
function pitValue(pit: Pit): number { return pit.stones + pit.quanStones * QUAN_VALUE; }
function wrap(index: number): number { return (index + 12) % 12; }
export function otherPlayer(player: PlayerId): PlayerId { return player === "P0" ? "P1" : "P0"; }

export function createStateHash(state: GameState): string {
  const stable = {
    rulesetId: state.rulesetId,
    rulesetCanonicalId: state.ruleset.canonicalRulesetId,
    pits: state.pits.map((pit) => [pit.id, pit.kind, pit.owner, pit.stones, pit.quanStones]),
    currentPlayer: state.currentPlayer,
    scores: { P0: state.scores.P0, P1: state.scores.P1 },
    skipCounts: { P0: state.skipCounts.P0, P1: state.skipCounts.P1 },
    status: state.status,
    winner: state.winner,
    moveNumber: state.moveNumber,
    recentMoves: state.recentMoves,
  };
  let hash = 0x811c9dc5;
  const value = JSON.stringify(stable);
  for (let i = 0; i < value.length; i += 1) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
