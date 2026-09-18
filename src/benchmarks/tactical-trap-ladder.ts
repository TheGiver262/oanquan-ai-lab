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

type CounterResult = {
  action: string | null;
  outcome: Outcome;
};

type ResponseBranch = {
  responderRank: number;
  responderAction: string;
  responderVisits: number;
  responderMean: number;
  bestCounter: CounterResult;
};

type FirstMoveCandidate = {
  firstAction: string;
  firstRank: number;
  firstVisits: number;
  firstMean: number;
  probeResponses: ResponseBranch[];
  top1Outcome: Outcome;
  robustTopKOutcome: Outcome;
};

const mode = readMode("--mode");
const opening = stringArg("--opening") ?? "B1:CW";
const targetBoardMove = intArg("--target-board-move", 6);
const openerAgent = readAgent("--opener-agent", "A");
const baselineSimulations = intArg("--baseline-simulations", 20_000);
const probeSimulations = intArg("--probe-simulations", 2_000);
const validationSimulations = intArg("--validation-simulations", 20_000);
const responderTopK = intArg("--responder-top-k", 3);
const validateTop = intArg("--validate-top", 3);
const maxBoardMoves = intArg("--max-board-moves", 240);
const outPath = stringArg("--out");

const baseline = buildBaseline();
if (baseline.outcome.unresolved) throw new Error("Baseline must resolve");

const target = baseline.steps.find(
  (step) => step.state.game.moveNumber === targetBoardMove && step.agent === openerAgent && step.chosen.kind === "move",
);
if (!target) throw new Error(`No opener decision at target board move ${targetBoardMove}`);

const earlierOpenerSteps = baseline.steps.filter(
  (step) => step.index < target.index && step.agent === openerAgent && step.chosen.kind === "move",
);
const anchor = earlierOpenerSteps.at(-1);
if (!anchor) throw new Error("No previous opener decision exists before target");

const candidates: FirstMoveCandidate[] = [];
const anchorStats = anchor.decision.rootStats.filter((entry) => entry.action.kind === "move");

for (let firstIndex = 0; firstIndex < anchorStats.length; firstIndex += 1) {
  const firstStat = anchorStats[firstIndex];
  if (!firstStat || firstStat.action.kind !== "move") continue;
  const afterFirst = applyBalanceAction(anchor.state, firstStat.action);
  if (!afterFirst.ok || afterFirst.state.game.status !== "playing") continue;

  const responderEngine = new ModeAwarePuctV3A();
  const responderDecision = choose(responderEngine, afterFirst.state, probeSimulations);
  const responderStats = responderDecision.rootStats.slice(0, responderTopK);
  const branches: ResponseBranch[] = [];

  for (let responseIndex = 0; responseIndex < responderStats.length; responseIndex += 1) {
    const responseStat = responderStats[responseIndex];
    if (!responseStat) continue;
    const afterResponse = applyBalanceAction(afterFirst.state, responseStat.action);
    if (!afterResponse.ok) continue;

    const bestCounter = bestCounterFrom(afterResponse.state, probeSimulations);
    branches.push({
      responderRank: responseIndex + 1,
      responderAction: balanceActionKey(responseStat.action),
      responderVisits: responseStat.visits,
      responderMean: responseStat.meanValue,
      bestCounter,
    });
  }

  if (branches.length === 0) continue;
  const top1Outcome = branches[0]?.bestCounter.outcome ?? unresolvedOutcome(afterFirst.state.game.moveNumber);
  const robustTopKOutcome = branches
    .map((branch) => branch.bestCounter.outcome)
    .reduce((worst, current) => worseForOpener(worst, current));

  candidates.push({
    firstAction: balanceActionKey(firstStat.action),
    firstRank: firstIndex + 1,
    firstVisits: firstStat.visits,
    firstMean: firstStat.meanValue,
    probeResponses: branches,
    top1Outcome,
    robustTopKOutcome,
  });
}

const ranked = [...candidates].sort(compareFirstCandidates);
const validationSeeds = ranked.slice(0, validateTop);
const validations = validationSeeds.map(validateCandidate);

const result = {
  experiment: "tactical-trap-ladder-v1",
  mode,
  opening,
  openerAgent,
  target: {
    boardMove: target.state.game.moveNumber,
    baselineChosenAction: balanceActionKey(target.chosen),
    baselineRootTop: target.decision.rootStats.slice(0, 5).map(statView),
  },
  anchor: {
    boardMove: anchor.state.game.moveNumber,
    baselineChosenAction: balanceActionKey(anchor.chosen),
    distanceToTargetDecisions: target.index - anchor.index,
    rootTop: anchor.decision.rootStats.slice(0, 10).map(statView),
  },
  config: {
    baselineSimulations,
    probeSimulations,
    validationSimulations,
    responderTopK,
    validateTop,
    maxBoardMoves,
  },
  baseline: baseline.outcome,
  candidates: ranked,
  baitTrapCandidates: ranked.filter((entry) => (entry.top1Outcome.openerValue ?? -1) >= 0),
  robustCandidates: ranked.filter((entry) => (entry.robustTopKOutcome.openerValue ?? -1) >= 0),
  validations,
  validatedBaitTraps: validations.filter((entry) => (entry.validation.bestCounter.outcome.openerValue ?? -1) >= 0),
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function buildBaseline(): { outcome: Outcome; steps: Step[] } {
  let state = createBalanceInitialState(mode, openerAgent);
  const forced = getBalanceActions(state).find(
    (action) => action.kind === "move" && balanceActionKey(action).toUpperCase() === opening.toUpperCase(),
  );
  if (!forced) throw new Error(`Illegal opening ${opening}`);
  const opened = applyBalanceAction(state, forced);
  if (!opened.ok) throw new Error(opened.error);
  state = opened.state;

  const engines = { A: new ModeAwarePuctV3A(), B: new ModeAwarePuctV3A() };
  const steps: Step[] = [];
  const trace = [balanceActionKey(forced)];

  while (state.game.status === "playing" && state.game.moveNumber < maxBoardMoves) {
    const agent = currentAgent(state);
    const decision = choose(engines[agent], state, baselineSimulations);
    if (!decision.action) break;
    steps.push({ index: steps.length, state, agent, decision, chosen: decision.action });
    if (trace.length < 16) trace.push(balanceActionKey(decision.action));
    const applied = applyBalanceAction(state, decision.action);
    if (!applied.ok) throw new Error(applied.error);
    state = applied.state;
  }
  return { outcome: outcomeOf(state, trace), steps };
}

function bestCounterFrom(state: BalanceState, simulations: number): CounterResult {
  if (state.game.status !== "playing") return { action: null, outcome: outcomeOf(state, []) };
  if (currentAgent(state) !== openerAgent) {
    return { action: null, outcome: rollout(state, simulations) };
  }

  const actions = getBalanceActions(state).filter((action) => action.kind === "move");
  if (actions.length === 0) return { action: null, outcome: rollout(state, simulations) };

  let best: CounterResult | null = null;
  for (const action of actions) {
    const applied = applyBalanceAction(state, action);
    if (!applied.ok) continue;
    const outcome = rollout(applied.state, simulations, [balanceActionKey(action)]);
    const candidate = { action: balanceActionKey(action), outcome };
    if (!best || betterForOpener(candidate.outcome, best.outcome)) best = candidate;
  }
  return best ?? { action: null, outcome: rollout(state, simulations) };
}

function validateCandidate(candidate: FirstMoveCandidate) {
  const firstAction = getBalanceActions(anchor.state).find(
    (action) => action.kind === "move" && balanceActionKey(action) === candidate.firstAction,
  );
  if (!firstAction) throw new Error(`Missing validation first action ${candidate.firstAction}`);
  const afterFirst = applyBalanceAction(anchor.state, firstAction);
  if (!afterFirst.ok) throw new Error(afterFirst.error);

  if (afterFirst.state.game.status !== "playing") {
    return {
      firstAction: candidate.firstAction,
      firstRank: candidate.firstRank,
      probeTop1: candidate.probeResponses[0] ?? null,
      validation: {
        responderAction: null,
        responderRootTop: [],
        bestCounter: { action: null, outcome: outcomeOf(afterFirst.state, []) },
      },
    };
  }

  const responderDecision = choose(new ModeAwarePuctV3A(), afterFirst.state, validationSimulations);
  if (!responderDecision.action) throw new Error("Validation responder has no action");
  const afterResponse = applyBalanceAction(afterFirst.state, responderDecision.action);
  if (!afterResponse.ok) throw new Error(afterResponse.error);

  return {
    firstAction: candidate.firstAction,
    firstRank: candidate.firstRank,
    probeTop1: candidate.probeResponses[0] ?? null,
    validation: {
      responderAction: balanceActionKey(responderDecision.action),
      responderRootTop: responderDecision.rootStats.slice(0, 5).map(statView),
      bestCounter: bestCounterFrom(afterResponse.state, validationSimulations),
    },
  };
}

function rollout(start: BalanceState, simulations: number, initialTrace: string[] = []): Outcome {
  let state = start;
  const engines = { A: new ModeAwarePuctV3A(), B: new ModeAwarePuctV3A() };
  const trace = [...initialTrace];

  while (state.game.status === "playing" && state.game.moveNumber < maxBoardMoves) {
    const agent = currentAgent(state);
    const decision = choose(engines[agent], state, simulations);
    if (!decision.action) break;
    if (trace.length < 8) trace.push(balanceActionKey(decision.action));
    const applied = applyBalanceAction(state, decision.action);
    if (!applied.ok) throw new Error(applied.error);
    state = applied.state;
  }
  return outcomeOf(state, trace);
}

function outcomeOf(state: BalanceState, trace: string[]): Outcome {
  if (state.game.status !== "finished") return unresolvedOutcome(state.game.moveNumber, trace);
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

function unresolvedOutcome(boardMoves: number, trace: string[] = []): Outcome {
  return { unresolved: true, openerValue: null, openerMargin: null, boardMoves, trace };
}

function choose(engine: ModeAwarePuctV3A, state: BalanceState, simulations: number) {
  return engine.chooseAction(state, {
    simulations,
    puctExploration: 1.5,
    policyTemperature: 0.6,
  });
}

function statView(entry: ModeAwarePuctV3ADecision["rootStats"][number]) {
  return {
    action: balanceActionKey(entry.action),
    visits: entry.visits,
    meanValue: entry.meanValue,
    prior: entry.prior,
    solvedOutcome: entry.solvedOutcome,
  };
}

function betterForOpener(left: Outcome, right: Outcome): boolean {
  const lv = left.openerValue ?? -2;
  const rv = right.openerValue ?? -2;
  if (lv !== rv) return lv > rv;
  return (left.openerMargin ?? Number.NEGATIVE_INFINITY) > (right.openerMargin ?? Number.NEGATIVE_INFINITY);
}

function worseForOpener(left: Outcome, right: Outcome): Outcome {
  return betterForOpener(left, right) ? right : left;
}

function compareFirstCandidates(left: FirstMoveCandidate, right: FirstMoveCandidate): number {
  const robustL = left.robustTopKOutcome.openerValue ?? -2;
  const robustR = right.robustTopKOutcome.openerValue ?? -2;
  if (robustR !== robustL) return robustR - robustL;
  const topL = left.top1Outcome.openerValue ?? -2;
  const topR = right.top1Outcome.openerValue ?? -2;
  if (topR !== topL) return topR - topL;
  const marginR = right.top1Outcome.openerMargin ?? Number.NEGATIVE_INFINITY;
  const marginL = left.top1Outcome.openerMargin ?? Number.NEGATIVE_INFINITY;
  if (marginR !== marginL) return marginR - marginL;
  return right.firstRank - left.firstRank;
}

function readMode(name: string): BalanceModeId {
  const value = stringArg(name) ?? "pie-threefold";
  const allowed: BalanceModeId[] = ["quan-gia-threefold", "quan-gia-pie-threefold", "pie-threefold"];
  if (allowed.includes(value as BalanceModeId)) return value as BalanceModeId;
  throw new Error(`${name} must be one of ${allowed.join("|")}`);
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
