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

type BaselineStep = {
  index: number;
  state: BalanceState;
  agent: ResearchAgentId;
  decision: ModeAwarePuctV3ADecision;
  chosen: BalanceAction;
};

type Rollout = {
  unresolved: boolean;
  openerValue: -1 | 0 | 1 | null;
  openerMargin: number | null;
  boardMoves: number;
  trace: string[];
};

type ProbeCandidate = {
  pointIndex: number;
  boardMove: number;
  chosenAction: string;
  alternateAction: string;
  alternateRank: number;
  chosenVisits: number;
  alternateVisits: number;
  chosenMean: number;
  alternateMean: number;
  meanGap: number;
  probe: Rollout;
  marginDeltaVsBaseline: number | null;
};

const mode = readMode("--mode");
const opening = stringArg("--opening") ?? "B1:CW";
const openerAgent = readAgent("--opener-agent", "A");
const baselineSimulations = intArg("--baseline-simulations", 20_000);
const probeSimulations = intArg("--probe-simulations", 2_000);
const validationSimulations = intArg("--validation-simulations", 20_000);
const maxProbePoints = intArg("--max-probe-points", 20);
const validateTop = intArg("--validate-top", 4);
const maxBoardMoves = intArg("--max-board-moves", 240);
const outPath = stringArg("--out");

const baseline = runBaseline();
if (baseline.result.unresolved) {
  throw new Error(`Baseline unresolved for ${mode} ${opening}; trap scan requires a resolved baseline`);
}

const selectedPoints = selectProbePoints(baseline.steps, maxProbePoints);
const candidates: ProbeCandidate[] = [];

for (const step of selectedPoints) {
  if (step.agent !== openerAgent || step.chosen.kind !== "move") continue;
  const chosenKey = balanceActionKey(step.chosen);
  const chosenStat = step.decision.rootStats.find((entry) => balanceActionKey(entry.action) === chosenKey);
  if (!chosenStat) continue;

  step.decision.rootStats.forEach((entry, index) => {
    const alternate = entry.action;
    if (alternate.kind !== "move") return;
    const alternateKey = balanceActionKey(alternate);
    if (alternateKey === chosenKey) return;

    const applied = applyBalanceAction(step.state, alternate);
    if (!applied.ok) return;
    const probe = rollout(applied.state, probeSimulations);
    candidates.push({
      pointIndex: step.index,
      boardMove: step.state.game.moveNumber,
      chosenAction: chosenKey,
      alternateAction: alternateKey,
      alternateRank: index + 1,
      chosenVisits: chosenStat.visits,
      alternateVisits: entry.visits,
      chosenMean: chosenStat.meanValue,
      alternateMean: entry.meanValue,
      meanGap: chosenStat.meanValue - entry.meanValue,
      probe,
      marginDeltaVsBaseline: probe.openerMargin === null || baseline.result.openerMargin === null
        ? null
        : probe.openerMargin - baseline.result.openerMargin,
    });
  });
}

const promising = [...candidates]
  .filter((candidate) => candidate.probe.openerValue !== null)
  .sort(compareCandidates)
  .slice(0, validateTop);

const validations = promising.map((candidate) => {
  const step = baseline.steps[candidate.pointIndex];
  if (!step) throw new Error(`Missing baseline step ${candidate.pointIndex}`);
  const alternate = getBalanceActions(step.state).find(
    (action) => action.kind === "move" && balanceActionKey(action) === candidate.alternateAction,
  );
  if (!alternate) throw new Error(`Cannot replay alternate ${candidate.alternateAction}`);
  const applied = applyBalanceAction(step.state, alternate);
  if (!applied.ok) throw new Error(`Validation alternate became illegal: ${candidate.alternateAction}`);
  return {
    pointIndex: candidate.pointIndex,
    boardMove: candidate.boardMove,
    chosenAction: candidate.chosenAction,
    alternateAction: candidate.alternateAction,
    alternateRank: candidate.alternateRank,
    rootAssessment: {
      chosenMean: candidate.chosenMean,
      alternateMean: candidate.alternateMean,
      meanGap: candidate.meanGap,
      chosenVisits: candidate.chosenVisits,
      alternateVisits: candidate.alternateVisits,
    },
    probe: candidate.probe,
    validation: rollout(applied.state, validationSimulations),
  };
});

const result = {
  experiment: "tactical-trap-search-v1",
  mode,
  opening,
  openerAgent,
  config: {
    baselineSimulations,
    probeSimulations,
    validationSimulations,
    maxProbePoints,
    validateTop,
    maxBoardMoves,
    reflectionCanonicalization: true,
  },
  baseline: {
    ...baseline.result,
    openerDecisionPoints: baseline.steps.filter((step) => step.agent === openerAgent).length,
    selectedProbePoints: selectedPoints.map((step) => ({
      index: step.index,
      boardMove: step.state.game.moveNumber,
      chosenAction: balanceActionKey(step.chosen),
      rootGap: rootGap(step.decision),
    })),
  },
  scan: {
    candidateCount: candidates.length,
    probeReversals: candidates.filter((candidate) => baseline.result.openerValue === -1 && (candidate.probe.openerValue ?? -1) >= 0).length,
    probeWins: candidates.filter((candidate) => candidate.probe.openerValue === 1).length,
    probeDraws: candidates.filter((candidate) => candidate.probe.openerValue === 0).length,
    topCandidates: [...candidates].sort(compareCandidates).slice(0, 20),
  },
  validations,
  validatedReversals: validations.filter(
    (entry) => baseline.result.openerValue === -1 && (entry.validation.openerValue ?? -1) >= 0,
  ),
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function runBaseline(): { result: Rollout; steps: BaselineStep[] } {
  let state = createBalanceInitialState(mode, openerAgent);
  const forced = getBalanceActions(state).find(
    (action) => action.kind === "move" && balanceActionKey(action).toUpperCase() === opening.toUpperCase(),
  );
  if (!forced) throw new Error(`Illegal opening ${opening}`);
  const opened = applyBalanceAction(state, forced);
  if (!opened.ok) throw new Error(`Failed to apply opening ${opening}: ${opened.error}`);
  state = opened.state;

  const engines = { A: new ModeAwarePuctV3A(), B: new ModeAwarePuctV3A() };
  const steps: BaselineStep[] = [];
  const trace = [balanceActionKey(forced)];

  while (state.game.status === "playing" && state.game.moveNumber < maxBoardMoves) {
    const agent = currentAgent(state);
    const decision = choose(engines[agent], state, baselineSimulations);
    if (!decision.action) break;
    steps.push({ index: steps.length, state, agent, decision, chosen: decision.action });
    if (trace.length < 16) trace.push(balanceActionKey(decision.action));
    const applied = applyBalanceAction(state, decision.action);
    if (!applied.ok) throw new Error(`Baseline illegal action ${balanceActionKey(decision.action)}: ${applied.error}`);
    state = applied.state;
  }

  return { result: summarizeRollout(state, trace), steps };
}

function rollout(start: BalanceState, simulations: number): Rollout {
  let state = start;
  const engines = { A: new ModeAwarePuctV3A(), B: new ModeAwarePuctV3A() };
  const trace: string[] = [];

  while (state.game.status === "playing" && state.game.moveNumber < maxBoardMoves) {
    const agent = currentAgent(state);
    const decision = choose(engines[agent], state, simulations);
    if (!decision.action) break;
    if (trace.length < 8) trace.push(balanceActionKey(decision.action));
    const applied = applyBalanceAction(state, decision.action);
    if (!applied.ok) throw new Error(`Rollout illegal action ${balanceActionKey(decision.action)}: ${applied.error}`);
    state = applied.state;
  }

  return summarizeRollout(state, trace);
}

function summarizeRollout(state: BalanceState, trace: string[]): Rollout {
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

function choose(engine: ModeAwarePuctV3A, state: BalanceState, simulations: number): ModeAwarePuctV3ADecision {
  return engine.chooseAction(state, {
    simulations,
    puctExploration: 1.5,
    policyTemperature: 0.6,
  });
}

function selectProbePoints(steps: BaselineStep[], limit: number): BaselineStep[] {
  const openerSteps = steps.filter((step) => step.agent === openerAgent && step.chosen.kind === "move");
  if (openerSteps.length <= limit) return openerSteps;

  const picked = new Map<number, BaselineStep>();
  const firstCount = Math.min(8, openerSteps.length);
  const lastCount = Math.min(6, openerSteps.length);
  for (const step of openerSteps.slice(0, firstCount)) picked.set(step.index, step);
  for (const step of openerSteps.slice(-lastCount)) picked.set(step.index, step);

  const ambiguous = [...openerSteps]
    .sort((left, right) => rootGap(left.decision) - rootGap(right.decision));
  for (const step of ambiguous) {
    if (picked.size >= limit) break;
    picked.set(step.index, step);
  }

  if (picked.size < limit) {
    const stride = (openerSteps.length - 1) / Math.max(1, limit - 1);
    for (let i = 0; i < limit && picked.size < limit; i += 1) {
      const step = openerSteps[Math.round(i * stride)];
      if (step) picked.set(step.index, step);
    }
  }

  return [...picked.values()].sort((a, b) => a.index - b.index).slice(0, limit);
}

function rootGap(decision: ModeAwarePuctV3ADecision): number {
  const stats = decision.rootStats.filter((entry) => entry.action.kind === "move");
  if (stats.length < 2) return Number.POSITIVE_INFINITY;
  return Math.abs((stats[0]?.meanValue ?? 0) - (stats[1]?.meanValue ?? 0));
}

function compareCandidates(left: ProbeCandidate, right: ProbeCandidate): number {
  const leftValue = left.probe.openerValue ?? -2;
  const rightValue = right.probe.openerValue ?? -2;
  if (rightValue !== leftValue) return rightValue - leftValue;
  const leftMargin = left.probe.openerMargin ?? Number.NEGATIVE_INFINITY;
  const rightMargin = right.probe.openerMargin ?? Number.NEGATIVE_INFINITY;
  if (rightMargin !== leftMargin) return rightMargin - leftMargin;
  if (right.alternateRank !== left.alternateRank) return right.alternateRank - left.alternateRank;
  return right.meanGap - left.meanGap;
}

function readMode(name: string): BalanceModeId {
  const value = stringArg(name) ?? "quan-gia-threefold";
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
