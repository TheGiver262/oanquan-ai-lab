import { describe, expect, it } from "vitest";
import {
  applyMove,
  CLASSIC_STANDARD_THREEFOLD_RULESET,
  createInitialState,
  getLegalMoves,
  MATURE_QUAN_RULESET,
} from "../src/engine.js";
import {
  applyBalanceAction,
  createBalanceInitialState,
  currentAgent,
  getBalanceActions,
  isSwapEligible,
  positionalRepetitionKey,
  seatForAgent,
  type BalanceState,
} from "../src/research/balance-modes.js";

describe("balance mode semantics", () => {
  it("keeps Standard, Pie-family Threefold, and Quan Gia rulesets distinct", () => {
    const standard = createBalanceInitialState("standard");
    const pie = createBalanceInitialState("pie-threefold");
    const delayed = createBalanceInitialState("delayed-pie-4-threefold");
    const open = createBalanceInitialState("open-pie-threefold");
    const quanGia = createBalanceInitialState("quan-gia");
    const positional = createBalanceInitialState("quan-gia-positional-threefold");

    expect(standard.game.ruleset.repetitionPolicy ?? "none").toBe("none");
    expect(pie.game.ruleset.repetitionPolicy).toBe("threefold");
    expect(delayed.game.ruleset.repetitionPolicy).toBe("threefold");
    expect(open.game.ruleset.repetitionPolicy).toBe("threefold");
    expect(quanGia.game.ruleset.ruleProfileId).toBe("mature_quan_v1");
    expect(quanGia.game.ruleset.repetitionPolicy ?? "none").toBe("none");
    expect(positional.game.ruleset.ruleProfileId).toBe("mature_quan_v1");
    expect(positional.game.ruleset.repetitionPolicy ?? "none").toBe("none");
    expect(positional.positionalHistory).toHaveLength(1);
  });

  it("offers classic Pie only to original responder B at the first response", () => {
    let state = createBalanceInitialState("pie-threefold");
    expect(isSwapEligible(state)).toBe(false);

    state = playFirstBoardMove(state);
    expect(currentAgent(state)).toBe("B");
    expect(isSwapEligible(state)).toBe(true);
    expect(getBalanceActions(state).some((action) => action.kind === "swap")).toBe(true);

    state = playFirstBoardMove(state); // B declines SWAP and plays normally.
    state = playFirstBoardMove(state); // A moves.
    expect(currentAgent(state)).toBe("B");
    expect(isSwapEligible(state)).toBe(false);
  });

  it("gives Pie to A when B is the original opener in paired-seat tests", () => {
    let state = createBalanceInitialState("quan-gia-pie-threefold", "B");
    expect(state.seatToAgent).toEqual({ P0: "B", P1: "A" });
    expect(state.swap.responderAgent).toBe("A");
    expect(isSwapEligible(state)).toBe(false);

    state = playFirstBoardMove(state); // B opens, A responds.
    expect(currentAgent(state)).toBe("A");
    expect(isSwapEligible(state)).toBe(true);
    const swap = getBalanceActions(state).find((action) => action.kind === "swap");
    expect(swap).toEqual({ kind: "swap", agent: "A" });
    if (!swap || swap.kind !== "swap") return;

    const applied = applyBalanceAction(state, swap);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.state.seatToAgent).toEqual({ P0: "A", P1: "B" });
    expect(currentAgent(applied.state)).toBe("B");
    expect(isSwapEligible(applied.state)).toBe(false);
  });

  it("keeps Delayed Pie-4 available through B's second decision, then expires", () => {
    let state = createBalanceInitialState("delayed-pie-4-threefold");
    state = playFirstBoardMove(state); // A opening -> B decision 1.
    expect(isSwapEligible(state)).toBe(true);

    state = playFirstBoardMove(state); // B normal move 1.
    state = playFirstBoardMove(state); // A move.
    expect(currentAgent(state)).toBe("B");
    expect(isSwapEligible(state)).toBe(true);

    state = playFirstBoardMove(state); // B normal move 2.
    state = playFirstBoardMove(state); // A move.
    expect(currentAgent(state)).toBe("B");
    expect(isSwapEligible(state)).toBe(false);
  });

  it("keeps Open Pie available after multiple declined opportunities", () => {
    let state = createBalanceInitialState("open-pie-threefold");
    state = playFirstBoardMove(state); // A opening.
    for (let cycle = 0; cycle < 3; cycle += 1) {
      expect(currentAgent(state)).toBe("B");
      expect(isSwapEligible(state)).toBe(true);
      state = playFirstBoardMove(state); // B declines.
      if (state.game.status !== "playing") break;
      state = playFirstBoardMove(state); // A move.
      if (state.game.status !== "playing") break;
    }
    if (state.game.status === "playing") expect(isSwapEligible(state)).toBe(true);
  });

  it("SWAP flips ownership without changing board, score, move number, or logical side to move", () => {
    let state = createBalanceInitialState("delayed-pie-6-threefold");
    state = playFirstBoardMove(state);
    const before = JSON.stringify(state.game);
    const logicalSeat = state.game.currentPlayer;
    expect(currentAgent(state)).toBe("B");

    const swapped = applyBalanceAction(state, { kind: "swap", agent: "B" });
    expect(swapped.ok).toBe(true);
    if (!swapped.ok) return;

    expect(JSON.stringify(swapped.state.game)).toBe(before);
    expect(swapped.state.game.currentPlayer).toBe(logicalSeat);
    expect(swapped.state.seatToAgent.P0).toBe("B");
    expect(swapped.state.seatToAgent.P1).toBe("A");
    expect(currentAgent(swapped.state)).toBe("A");
    expect(seatForAgent(swapped.state, "B")).toBe("P0");
    expect(isSwapEligible(swapped.state)).toBe(false);
  });

  it("Threefold ABABAB terminates only when the mode opts into repetition", () => {
    const repeatedPrefix = [
      { player: "P1" as const, pit: "T3" as const, dir: "CW" as const },
      { player: "P0" as const, pit: "B3" as const, dir: "CW" as const },
      { player: "P1" as const, pit: "T3" as const, dir: "CW" as const },
      { player: "P0" as const, pit: "B3" as const, dir: "CW" as const },
      { player: "P1" as const, pit: "T3" as const, dir: "CW" as const },
    ];

    const withThreefold = createInitialState(CLASSIC_STANDARD_THREEFOLD_RULESET);
    withThreefold.recentMoves = repeatedPrefix.map((move) => ({ ...move }));
    const repeated = applyMove(withThreefold, { player: "P0", pit: "B3", dir: "CW" });
    expect(repeated.ok).toBe(true);
    if (!repeated.ok) return;
    expect(repeated.state.status).toBe("finished");
    expect(repeated.events.some((event) => event.type === "match_finished" && event.reason === "repeated_moves")).toBe(true);
    expect(repeated.state.pits.filter((pit) => pit.kind === "quan").every((pit) => pit.quanStones === 1)).toBe(true);

    const withoutThreefold = createInitialState();
    withoutThreefold.recentMoves = repeatedPrefix.map((move) => ({ ...move }));
    const standard = applyMove(withoutThreefold, { player: "P0", pit: "B3", dir: "CW" });
    expect(standard.ok).toBe(true);
    if (!standard.ok) return;
    expect(standard.events.some((event) => event.type === "match_finished" && event.reason === "repeated_moves")).toBe(false);
  });

  it("Positional Threefold finishes on the third exact start-of-turn strategic position", () => {
    const initial = createBalanceInitialState("quan-gia-positional-threefold");
    const move = getBalanceActions(initial).find(
      (action) => action.kind === "move" && action.move.pit === "B1" && action.move.dir === "CW",
    );
    expect(move).toBeDefined();
    if (!move) return;

    const first = applyBalanceAction(initial, move);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const repeatedKey = positionalRepetitionKey(first.state.game);

    const primed = {
      ...initial,
      positionalHistory: [repeatedKey, repeatedKey],
    };
    const third = applyBalanceAction(primed, move);
    expect(third.ok).toBe(true);
    if (!third.ok) return;

    expect(third.state.game.status).toBe("finished");
    expect(third.events.some(
      (event) => event.type === "match_finished" && event.reason === "repeated_position",
    )).toBe(true);
    expect(third.state.game.pits.filter((pit) => pit.kind === "quan").every((pit) => pit.quanStones === 1)).toBe(true);
  });

  it("Quan Gia blocks a live Quan capture below 5 dan and allows it at 5 dan", () => {
    const below = createInitialState(MATURE_QUAN_RULESET);
    const t5Below = below.pits.find((pit) => pit.id === "T5");
    const rBelow = below.pits.find((pit) => pit.id === "R");
    expect(t5Below && rBelow).toBeTruthy();
    if (!t5Below || !rBelow) return;
    t5Below.stones = 0;
    rBelow.stones = 4;

    const blocked = applyMove(below, { player: "P0", pit: "B1", dir: "CW" });
    expect(blocked.ok).toBe(true);
    if (!blocked.ok) return;
    const blockedR = blocked.state.pits.find((pit) => pit.id === "R");
    expect(blockedR?.quanStones).toBe(1);
    expect(blockedR?.stones).toBe(4);

    const enough = createInitialState(MATURE_QUAN_RULESET);
    const t5Enough = enough.pits.find((pit) => pit.id === "T5");
    const rEnough = enough.pits.find((pit) => pit.id === "R");
    expect(t5Enough && rEnough).toBeTruthy();
    if (!t5Enough || !rEnough) return;
    t5Enough.stones = 0;
    rEnough.stones = 5;

    const captured = applyMove(enough, { player: "P0", pit: "B1", dir: "CW" });
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    const capturedR = captured.state.pits.find((pit) => pit.id === "R");
    expect(capturedR?.quanStones).toBe(0);
    expect(capturedR?.stones).toBe(0);
    expect(captured.events.some((event) => event.type === "capture_resolved" && event.pit === "R")).toBe(true);
  });
});

function playFirstBoardMove(state: BalanceState): BalanceState {
  const move = getBalanceActions(state).find((action) => action.kind === "move");
  expect(move).toBeDefined();
  if (!move) return state;
  const applied = applyBalanceAction(state, move);
  expect(applied.ok).toBe(true);
  return applied.ok ? applied.state : state;
}
