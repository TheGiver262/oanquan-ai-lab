import { describe, expect, it } from "vitest";
import { applyMove, createInitialState } from "../src/engine.js";
import {
  applyBalanceAction,
  balanceActionKey,
  createBalanceInitialState,
  getBalanceActions,
} from "../src/research/balance-modes.js";
import {
  canonicalizeBalanceStateForSearch,
  ModeAwarePuctV3A,
  reflectBalanceAction,
} from "../src/research/mode-aware-puct-v3a.js";
import { ReusableScoreBoundedPuct } from "../src/research/puct-v3a.js";

describe("mode-aware PUCT V3A", () => {
  it("matches classic V3A's initial Standard choice at fixed simulations", () => {
    const classicState = createInitialState();
    const classic = new ReusableScoreBoundedPuct().chooseMove(classicState, {
      simulations: 128,
      puctExploration: 1.5,
      policyTemperature: 0.6,
    });

    const modeState = createBalanceInitialState("standard");
    const modeAware = new ModeAwarePuctV3A().chooseAction(modeState, {
      simulations: 128,
      puctExploration: 1.5,
      policyTemperature: 0.6,
    });

    expect(classic.move).not.toBeNull();
    expect(modeAware.action?.kind).toBe("move");
    if (modeAware.action?.kind !== "move" || !classic.move) return;
    expect(`${modeAware.action.move.pit}:${modeAware.action.move.dir}`).toBe(`${classic.move.pit}:${classic.move.dir}`);
  });

  it("canonicalizes mirrored B3 roots and returns mirrored fixed-simulation decisions", () => {
    const initialCw = createBalanceInitialState("quan-gia-threefold");
    const cwOpening = getBalanceActions(initialCw).find((action) => balanceActionKey(action) === "B3:CW");
    const ccwOpening = getBalanceActions(initialCw).find((action) => balanceActionKey(action) === "B3:CCW");
    expect(cwOpening).toBeDefined();
    expect(ccwOpening).toBeDefined();
    if (!cwOpening || !ccwOpening) return;

    const afterCw = applyBalanceAction(initialCw, cwOpening);
    const initialCcw = createBalanceInitialState("quan-gia-threefold");
    const afterCcw = applyBalanceAction(initialCcw, ccwOpening);
    expect(afterCw.ok).toBe(true);
    expect(afterCcw.ok).toBe(true);
    if (!afterCw.ok || !afterCcw.ok) return;

    const canonicalCw = canonicalizeBalanceStateForSearch(afterCw.state);
    const canonicalCcw = canonicalizeBalanceStateForSearch(afterCcw.state);
    expect(canonicalCw.state).toEqual(canonicalCcw.state);

    const cwDecision = new ModeAwarePuctV3A().chooseAction(afterCw.state, {
      simulations: 2_048,
      puctExploration: 1.5,
      policyTemperature: 0.6,
    });
    const ccwDecision = new ModeAwarePuctV3A().chooseAction(afterCcw.state, {
      simulations: 2_048,
      puctExploration: 1.5,
      policyTemperature: 0.6,
    });

    expect(cwDecision.diagnostics.simulations).toBe(ccwDecision.diagnostics.simulations);
    expect(cwDecision.action).not.toBeNull();
    expect(ccwDecision.action).not.toBeNull();
    if (!cwDecision.action || !ccwDecision.action) return;
    expect(balanceActionKey(cwDecision.action)).toBe(balanceActionKey(reflectBalanceAction(ccwDecision.action)));

    const cwStats = cwDecision.rootStats.map((entry) => ({
      action: balanceActionKey(entry.action),
      visits: entry.visits,
      meanValue: entry.meanValue,
      prior: entry.prior,
      solvedOutcome: entry.solvedOutcome,
    }));
    const ccwStatsMirrored = ccwDecision.rootStats.map((entry) => ({
      action: balanceActionKey(reflectBalanceAction(entry.action)),
      visits: entry.visits,
      meanValue: entry.meanValue,
      prior: entry.prior,
      solvedOutcome: entry.solvedOutcome,
    }));
    expect(cwStats).toEqual(ccwStatsMirrored);
  });

  it("root leaf auditing is observation-only and does not alter search output", () => {
    const state = createBalanceInitialState("quan-gia-threefold");
    const opening = getBalanceActions(state).find(
      (action) => balanceActionKey(action) === "B3:CW",
    );
    expect(opening).toBeDefined();
    if (!opening) return;
    const afterOpening = applyBalanceAction(state, opening);
    expect(afterOpening.ok).toBe(true);
    if (!afterOpening.ok) return;

    const plain = new ModeAwarePuctV3A().chooseAction(afterOpening.state, {
      simulations: 2_048,
      puctExploration: 1.5,
      policyTemperature: 0.6,
    });
    const audited = new ModeAwarePuctV3A().chooseAction(afterOpening.state, {
      simulations: 2_048,
      puctExploration: 1.5,
      policyTemperature: 0.6,
      auditRootLeaves: true,
    });

    expect(audited.action).toEqual(plain.action);
    expect(audited.rootStats).toEqual(plain.rootStats);
    expect(audited.diagnostics).toEqual(plain.diagnostics);
    expect(audited.rootLeafAudit).toBeDefined();
    expect(audited.rootLeafAudit?.reduce((sum, entry) => sum + entry.total.count, 0)).toBeGreaterThan(0);
  });

  it("canonicalizes mirrored positional-repetition history together with the board", () => {
    const cw = createBalanceInitialState("quan-gia-positional-threefold");
    const ccw = createBalanceInitialState("quan-gia-positional-threefold");
    const cwOpening = getBalanceActions(cw).find((action) => balanceActionKey(action) === "B3:CW");
    const ccwOpening = getBalanceActions(ccw).find((action) => balanceActionKey(action) === "B3:CCW");
    expect(cwOpening).toBeDefined();
    expect(ccwOpening).toBeDefined();
    if (!cwOpening || !ccwOpening) return;

    const afterCw = applyBalanceAction(cw, cwOpening);
    const afterCcw = applyBalanceAction(ccw, ccwOpening);
    expect(afterCw.ok).toBe(true);
    expect(afterCcw.ok).toBe(true);
    if (!afterCw.ok || !afterCcw.ok) return;

    const canonicalCw = canonicalizeBalanceStateForSearch(afterCw.state);
    const canonicalCcw = canonicalizeBalanceStateForSearch(afterCcw.state);
    expect(canonicalCw.state).toEqual(canonicalCcw.state);

    const cwDecision = new ModeAwarePuctV3A().chooseAction(afterCw.state, { simulations: 512 });
    const ccwDecision = new ModeAwarePuctV3A().chooseAction(afterCcw.state, { simulations: 512 });
    expect(cwDecision.action).not.toBeNull();
    expect(ccwDecision.action).not.toBeNull();
    if (!cwDecision.action || !ccwDecision.action) return;
    expect(balanceActionKey(cwDecision.action)).toBe(balanceActionKey(reflectBalanceAction(ccwDecision.action)));
  });

  it("sees SWAP as a first-class action in Pie search", () => {
    let state = createBalanceInitialState("pie-threefold");
    const opening = getBalanceActions(state).find((action) => action.kind === "move");
    expect(opening?.kind).toBe("move");
    if (!opening || opening.kind !== "move") return;
    const afterOpening = applyBalanceAction(state, opening);
    expect(afterOpening.ok).toBe(true);
    if (!afterOpening.ok) return;
    state = afterOpening.state;

    const legal = new Set(getBalanceActions(state).map(balanceActionKey));
    expect(legal.has("SWAP")).toBe(true);

    const decision = new ModeAwarePuctV3A().chooseAction(state, { simulations: 96 });
    expect(decision.rootStats.some((entry) => entry.action.kind === "swap")).toBe(true);
    expect(decision.rootStats.reduce((sum, entry) => sum + entry.prior, 0)).toBeCloseTo(1, 10);
    expect(decision.action).not.toBeNull();
    if (decision.action) expect(legal.has(balanceActionKey(decision.action))).toBe(true);
  });

  it("tracks agent perspective correctly through a real SWAP", () => {
    let state = createBalanceInitialState("open-pie-threefold");
    const opening = getBalanceActions(state).find((action) => action.kind === "move");
    expect(opening?.kind).toBe("move");
    if (!opening || opening.kind !== "move") return;
    const afterOpening = applyBalanceAction(state, opening);
    expect(afterOpening.ok).toBe(true);
    if (!afterOpening.ok) return;
    state = afterOpening.state;

    const bEngine = new ModeAwarePuctV3A();
    const beforeSwap = bEngine.chooseAction(state, { simulations: 32 });
    expect(beforeSwap.action).not.toBeNull();

    const swapped = applyBalanceAction(state, { kind: "swap", agent: "B" });
    expect(swapped.ok).toBe(true);
    if (!swapped.ok) return;

    // After B swaps, logical P1 remains to move but is now owned by A.
    const aEngine = new ModeAwarePuctV3A();
    const aDecision = aEngine.chooseAction(swapped.state, { simulations: 32 });
    expect(aDecision.action?.kind).toBe("move");
    if (aDecision.action?.kind !== "move") return;

    const afterA = applyBalanceAction(swapped.state, aDecision.action);
    expect(afterA.ok).toBe(true);
    if (!afterA.ok) return;

    // Logical P0 now belongs to B, so B's existing session can reroot from its
    // earlier search tree through SWAP -> A move when the canonical orientation
    // remains within the retained two-ply lookup window.
    const bNext = bEngine.chooseAction(afterA.state, { simulations: 16 });
    expect(bNext.action).not.toBeNull();
  });

  it("searches every approved primary/fallback Pie window without illegal actions", () => {
    const modes = [
      "standard",
      "pie-threefold",
      "delayed-pie-4-threefold",
      "delayed-pie-6-threefold",
      "open-pie-threefold",
      "quan-gia",
      "quan-gia-positional-threefold",
    ] as const;

    for (const mode of modes) {
      const state = createBalanceInitialState(mode);
      const legal = new Set(getBalanceActions(state).map(balanceActionKey));
      const decision = new ModeAwarePuctV3A().chooseAction(state, { simulations: 48 });
      expect(decision.action, mode).not.toBeNull();
      if (decision.action) expect(legal.has(balanceActionKey(decision.action)), mode).toBe(true);
    }
  });

  it("preserves terminal W/D/L in agent rather than fixed-seat perspective", () => {
    const state = createBalanceInitialState("open-pie-threefold");
    const game = { ...state.game, status: "finished" as const, winner: "P0" as const };
    const swappedTerminal = {
      ...state,
      game,
      seatToAgent: { P0: "B" as const, P1: "A" as const },
      swap: { ...state.swap, used: true },
    };

    // The current logical seat is P0 and therefore current agent is B.
    const decision = new ModeAwarePuctV3A().chooseAction(swappedTerminal, { simulations: 8 });
    expect(decision.action).toBeNull();
    expect(decision.diagnostics.solvedRoot).toBe(1);
  });
});
