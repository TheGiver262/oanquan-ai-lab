import { writeFileSync } from "node:fs";
import {
  applyBalanceAction,
  balanceActionKey,
  createBalanceInitialState,
  currentAgent,
  getBalanceActions,
  seatForAgent,
  winnerAgent,
  type BalanceAction,
  type BalanceModeId,
  type BalanceState,
  type ResearchAgentId,
} from "../research/balance-modes.js";
import { ModeAwarePuctV3A, type ModeAwarePuctV3ADecision } from "../research/mode-aware-puct-v3a.js";

type Step = {
  index: number;
  state: BalanceState;
  agent: ResearchAgentId;
  decision: ModeAwarePuctV3ADecision;
  chosen: BalanceAction;
};

type Outcome = {
  unresolved: boolean;
  openerValue: -1 | 0 | 1 | null;
  openerMargin: number | null;
  boardMoves: number;
  trace: string[];
};

type Candidate = {
  secondBoardMove: number;
  normalAction: string;
  alternateAction: string;
  alternateRank: number;
  normalVisits: number;
  alternateVisits: number;
  normalMean: number;
  alternateMean: number;
  meanGap: number;
  probe: Outcome;
};

const mode = readMode("--mode");
const opening = stringArg("--opening") ?? "B3:CW";
const firstForceMove = intArg("--first-force-move", 2);
const firstForceAction = stringArg("--first-force-action") ?? "B1:CW";
const openerAgent = readAgent("--opener-agent", "A");
const baselineSimulations = intArg("--baseline-simulations", 50_000);
const probeSimulations = intArg("--probe-simulations", 3_000);
const validationSimulations = intArg("--validation-simulations", 50_000);
const maxProbePoints = intArg("--max-probe-points", 12);
const validateTop = intArg("--validate-top", 6);
const maxBoardMoves = intArg("--max-board-moves", 300);
const outPath = stringArg("--out");

const baseline = runPersistent(null, baselineSimulations, true);
if (baseline.outcome.unresolved) throw new Error("Forced-prefix baseline must resolve");

const laterOpenerSteps = baseline.steps.filter(
  (step) =>
    step.agent === openerAgent
    && step.chosen.kind === "move"
    && step.state.game.moveNumber > firstForceMove,
);
const selected = selectProbePoints(laterOpenerSteps, maxProbePoints);

const candidates: Candidate[] = [];
for (const step of selected) {
  const chosenKey = balanceActionKey(step.chosen);
  const chosenStat = step.decision.rootStats.find((entry) => balanceActionKey(entry.action) === chosenKey);
  if (!chosenStat) continue;

  for (let rank = 0; rank < step.decision.rootStats.length; rank += 1) {
    const stat = step.decision.rootStats[rank];
    if (!stat || stat.action.kind !== "move") continue;
    const altKey = balanceActionKey(stat.action);
    if (altKey === chosenKey) continue;
    const applied = applyBalanceAction(step.state, stat.action);
    if (!applied.ok) continue;
    const probe = rolloutFresh(applied.state, probeSimulations, [altKey]);
    candidates.push({
      secondBoardMove: step.state.game.moveNumber,
      normalAction: chosenKey,
      alternateAction: altKey,
      alternateRank: rank + 1,
      normalVisits: chosenStat.visits,
      alternateVisits: stat.visits,
      normalMean: chosenStat.meanValue,
      alternateMean: stat.meanValue,
      meanGap: chosenStat.meanValue - stat.meanValue,
      probe,
    });
  }
}

const ranked = [...candidates].sort(compareCandidates);
const validationSeeds = ranked.slice(0, validateTop);
const validations = validationSeeds.map((candidate) => ({
  candidate,
  validation: runPersistent(
    { boardMove: candidate.secondBoardMove, actionKey: candidate.alternateAction },
    validationSimulations,
    false,
  ).outcome,
}));

const result = {
  experiment: "forced-prefix-counter-refutation-search-v1",
  mode,
  opening,
  openerAgent,
  firstForce: {
    boardMove: firstForceMove,
    action: firstForceAction,
  },
  config: {
    baselineSimulations,
    probeSimulations,
    validationSimulations,
    maxProbePoints,
    validateTop,
    maxBoardMoves,
    reflectionCanonicalization: true,
    validationPersistentTrees: true,
  },
  baseline: {
    ...baseline.outcome,
    openerDecisionPointsAfterForce: laterOpenerSteps.length,
    selectedProbePoints: selected.map((step) => ({
      boardMove: step.state.game.moveNumber,
      normalAction: balanceActionKey(step.chosen),
      rootGap: rootGap(step.decision),
    })),
  },
  scan: {
    candidateCount: candidates.length,
    probeReversals: candidates.filter((c) => (c.probe.openerValue ?? -1) >= 0).length,
    probeWins: candidates.filter((c) => c.probe.openerValue === 1).length,
    probeDraws: candidates.filter((c) => c.probe.openerValue === 0).length,
    topCandidates: ranked.slice(0, 25),
  },
  validations,
  validatedReversals: validations.filter((entry) => (entry.validation.openerValue ?? -1) >= 0),
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function runPersistent(
  secondForce: null | { boardMove: number; actionKey: string },
  simulations: number,
  collectSteps: boolean,
): { outcome: Outcome; steps: Step[] } {
  let state = createBalanceInitialState(mode, openerAgent);
  const openingAction = getBalanceActions(state).find(
    (action) => action.kind === "move" && balanceActionKey(action).toUpperCase() === opening.toUpperCase(),
  );
  if (!openingAction) throw new Error(`Illegal opening ${opening}`);
  const opened = applyBalanceAction(state, openingAction);
  if (!opened.ok) throw new Error(opened.error);
  state = opened.state;

  const engines = { A: new ModeAwarePuctV3A(), B: new ModeAwarePuctV3A() };
  const steps: Step[] = [];
  const trace = [balanceActionKey(openingAction)];
  let firstForced = false;
  let secondForced = secondForce === null;

  while (state.game.status === "playing" && state.game.moveNumber < maxBoardMoves) {
    const agent = currentAgent(state);
    const decision = choose(engines[agent], state, simulations);
    if (!decision.action) break;

    let action: BalanceAction = decision.action;
    if (!firstForced && state.game.moveNumber === firstForceMove && agent === openerAgent) {
      const forced = getBalanceActions(state).find(
        (entry) => entry.kind === "move" && balanceActionKey(entry).toUpperCase() === firstForceAction.toUpperCase(),
      );
      if (!forced) throw new Error(`First forced action ${firstForceAction} unavailable at move ${firstForceMove}`);
      action = forced;
      firstForced = true;
    } else if (
      !secondForced
      && secondForce
      && state.game.moveNumber === secondForce.boardMove
      && agent === openerAgent
    ) {
      const forced = getBalanceActions(state).find(
        (entry) => entry.kind === "move" && balanceActionKey(entry).toUpperCase() === secondForce.actionKey.toUpperCase(),
      );
      if (!forced) {
        return {
          outcome: {
            unresolved: true,
            openerValue: null,
            openerMargin: null,
            boardMoves: state.game.moveNumber,
            trace: [...trace, `ILLEGAL_SECOND_FORCE:${secondForce.actionKey}`],
          },
          steps,
        };
      }
      action = forced;
      secondForced = true;
    }

    if (collectSteps) {
      steps.push({ index: steps.length, state, agent, decision, chosen: action });
    }
    if (trace.length < 40) trace.push(balanceActionKey(action));
    const applied = applyBalanceAction(state, action);
    if (!applied.ok) throw new Error(`Illegal persistent action ${balanceActionKey(action)}: ${applied.error}`);
    state = applied.state;
  }

  return { outcome: outcomeOf(state, trace), steps };
}

function rolloutFresh(start: BalanceState, simulations: number, traceSeed: string[]): Outcome {
  let state = start;
  const engines = { A: new ModeAwarePuctV3A(), B: new ModeAwarePuctV3A() };
  const trace = [...traceSeed];

  while (state.game.status === "playing" && state.game.moveNumber < maxBoardMoves) {
    const agent = currentAgent(state);
    const decision = choose(engines[agent], state, simulations);
    if (!decision.action) break;
    if (trace.length < 12) trace.push(balanceActionKey(decision.action));
    const applied = applyBalanceAction(state, decision.action);
    if (!applied.ok) throw new Error(applied.error);
    state = applied.state;
  }
  return outcomeOf(state, trace);
}

function choose(engine: ModeAwarePuctV3A, state: BalanceState, simulations: number) {
  return engine.chooseAction(state, {
    simulations,
    puctExploration: 1.5,
    policyTemperature: 0.6,
  });
}

function outcomeOf(state: BalanceState, trace: string[]): Outcome {
  if (state.game.status !== "finished") {
    return { unresolved: true, openerValue: null, openerMargin: null, boardMoves: state.game.moveNumber, trace };
  }
  const winner = winnerAgent(state);
  const openerValue: -1 | 0 | 1 = winner === null ? 0 : winner === openerAgent ? 1 : -1;
  const openerSeat = seatForAgent(state, openerAgent);
  const responderSeat = openerSeat === "P0" ? "P1" : "P0";
  return {
    unresolved: false,
    openerValue,
    openerMargin: state.game.scores[openerSeat] - state.game.scores[responderSeat],
    boardMoves: state.game.moveNumber,
    trace,
  };
}

function selectProbePoints(steps: Step[], limit: number): Step[] {
  if (steps.length <= limit) return steps;
  const picked = new Map<number, Step>();
  for (const step of steps.slice(0, Math.min(5, steps.length))) picked.set(step.index, step);
  for (const step of steps.slice(-Math.min(4, steps.length))) picked.set(step.index, step);
  const ambiguous = [...steps].sort((a, b) => rootGap(a.decision) - rootGap(b.decision));
  for (const step of ambiguous) {
    if (picked.size >= limit) break;
    picked.set(step.index, step);
  }
  if (picked.size < limit) {
    const stride = (steps.length - 1) / Math.max(1, limit - 1);
    for (let i = 0; i < limit && picked.size < limit; i += 1) {
      const step = steps[Math.round(i * stride)];
      if (step) picked.set(step.index, step);
    }
  }
  return [...picked.values()].sort((a, b) => a.index - b.index).slice(0, limit);
}

function rootGap(decision: ModeAwarePuctV3ADecision): number {
  const moves = decision.rootStats.filter((entry) => entry.action.kind === "move");
  if (moves.length < 2) return Number.POSITIVE_INFINITY;
  return Math.abs((moves[0]?.meanValue ?? 0) - (moves[1]?.meanValue ?? 0));
}

function compareCandidates(a: Candidate, b: Candidate): number {
  const av = a.probe.openerValue ?? -2;
  const bv = b.probe.openerValue ?? -2;
  if (bv !== av) return bv - av;
  const am = a.probe.openerMargin ?? Number.NEGATIVE_INFINITY;
  const bm = b.probe.openerMargin ?? Number.NEGATIVE_INFINITY;
  if (bm !== am) return bm - am;
  if (b.alternateRank !== a.alternateRank) return b.alternateRank - a.alternateRank;
  return b.meanGap - a.meanGap;
}

function readMode(name: string): BalanceModeId {
  const value = stringArg(name) ?? "quan-gia-threefold";
  const allowed: BalanceModeId[] = ["quan-gia-threefold"];
  if (allowed.includes(value as BalanceModeId)) return value as BalanceModeId;
  throw new Error(`${name} must be quan-gia-threefold`);
}
function readAgent(name: string, fallback: ResearchAgentId): ResearchAgentId {
  const value = stringArg(name) ?? fallback;
  if (value === "A" || value === "B") return value;
  throw new Error(`${name} must be A or B`);
}
function stringArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}
function intArg(name: string, fallback: number): number {
  const raw = stringArg(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}
