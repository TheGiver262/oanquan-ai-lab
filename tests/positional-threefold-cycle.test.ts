import { describe, expect, it } from "vitest";
import {
  applyBalanceAction,
  balanceActionKey,
  createBalanceInitialState,
  getBalanceActions,
  type BalanceModeId,
  type BalanceState,
} from "../src/research/balance-modes.js";

const PREFIX_CW = [
  "B3:CW",
  "T2:CW","B4:CW","T2:CW","B3:CCW","T1:CW","B4:CCW","T5:CW","B1:CCW","T3:CW",
  "B3:CW","T5:CCW","B2:CCW","T3:CW","B1:CCW","T4:CCW","B2:CCW","T3:CW","B3:CCW","T5:CW",
  "B4:CW","T3:CW","B2:CW","T2:CCW","B1:CW","T3:CCW","B3:CCW","T5:CCW","B4:CW","T4:CCW",
  "B3:CCW","T3:CW","B4:CW","T4:CW",
] as const;

const CYCLE_CW = [
  "B3:CW","T5:CCW","B2:CCW","T4:CW","B3:CW","T5:CCW","B2:CCW","T4:CCW","B3:CCW","T3:CCW",
  "B4:CCW","T2:CW","B5:CW","T3:CW","B4:CW","T4:CCW","B3:CCW","T3:CW","B4:CW","T4:CW",
] as const;

const REFLECT_PIT: Record<string,string> = {
  B1:"B5",B2:"B4",B3:"B3",B4:"B2",B5:"B1",
  T1:"T5",T2:"T4",T3:"T3",T4:"T2",T5:"T1",
};

describe("Quan Gia positional threefold exact-cycle regression", () => {
  it("terminates the known 20-ply B3 cycle on the third exact position", () => {
    const trace = [...PREFIX_CW, ...CYCLE_CW, ...CYCLE_CW];
    expect(trace).toHaveLength(74);

    const oldMode = replay("quan-gia-threefold", trace);
    expect(oldMode.state.game.moveNumber).toBe(74);
    expect(oldMode.state.game.status).toBe("playing");
    expect(oldMode.finishReason).toBeNull();
    expect(oldMode.state.game.scores).toEqual({ P0: 27, P1: 28 });

    const positional = replay("quan-gia-positional-threefold", trace);
    expect(positional.state.game.moveNumber).toBe(74);
    expect(positional.state.game.status).toBe("finished");
    expect(positional.finishReason).toBe("repeated_position");
    expect(positional.state.game.winner).toBeNull();
    expect(positional.state.game.scores).toEqual({ P0: 35, P1: 35 });
  });

  it("does the same for the exact left-right reflection", () => {
    const trace = [...PREFIX_CW, ...CYCLE_CW, ...CYCLE_CW].map(reflectKey);
    expect(trace[0]).toBe("B3:CCW");

    const oldMode = replay("quan-gia-threefold", trace);
    expect(oldMode.state.game.moveNumber).toBe(74);
    expect(oldMode.state.game.status).toBe("playing");
    expect(oldMode.state.game.scores).toEqual({ P0: 27, P1: 28 });

    const positional = replay("quan-gia-positional-threefold", trace);
    expect(positional.state.game.moveNumber).toBe(74);
    expect(positional.state.game.status).toBe("finished");
    expect(positional.finishReason).toBe("repeated_position");
    expect(positional.state.game.winner).toBeNull();
    expect(positional.state.game.scores).toEqual({ P0: 35, P1: 35 });
  });
});

function replay(mode: BalanceModeId, trace: readonly string[]): {
  state: BalanceState;
  finishReason: string | null;
} {
  let state = createBalanceInitialState(mode);
  let finishReason: string | null = null;

  for (const key of trace) {
    expect(state.game.status, `unexpected finish before ${key} at move ${state.game.moveNumber}`).toBe("playing");
    const action = getBalanceActions(state).find(
      (candidate) => candidate.kind === "move" && balanceActionKey(candidate) === key,
    );
    expect(action, `missing legal action ${key} at move ${state.game.moveNumber}`).toBeDefined();
    if (!action) break;
    const applied = applyBalanceAction(state, action);
    expect(applied.ok, `failed ${key} at move ${state.game.moveNumber}`).toBe(true);
    if (!applied.ok) break;
    for (const event of applied.events) {
      if (event.type === "match_finished") finishReason = event.reason;
    }
    state = applied.state;
  }
  return { state, finishReason };
}

function reflectKey(key: string): string {
  const [pit, dir] = key.split(":");
  const reflectedPit = pit ? REFLECT_PIT[pit] : undefined;
  if (!reflectedPit || (dir !== "CW" && dir !== "CCW")) throw new Error(`Bad action key ${key}`);
  return `${reflectedPit}:${dir === "CW" ? "CCW" : "CW"}`;
}
