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
  type BalanceState,
  type ResearchAgentId,
} from "../research/balance-modes.js";
import { ModeAwarePuctV3A } from "../research/mode-aware-puct-v3a.js";
import { ResourceAwarePuctV3A } from "../research/resource-aware-puct-v3a.js";

type BranchOutcome = {
  unresolved: boolean;
  winnerAgent: ResearchAgentId | null;
  openerValue: -1 | 0 | 1 | null;
  openerMargin: number | null;
  boardMoves: number;
  finalScores: { P0: number; P1: number };
  trace: string[];
};

const opening = stringArg("--opening") ?? "B3:CW";
const openerAgent = readAgent("--opener-agent", "A");
const targetBoardMove = intArg("--target-board-move", 4);
const fixedSimulations = intArg("--fixed-simulations", 20_000);
const maxBoardMoves = intArg("--max-board-moves", 240);
const outPath = stringArg("--out");

const discovery = {
  primarySimulations: intArg("--discovery-primary", 5_000),
  forecastSimulations: intArg("--discovery-forecast", 5_000),
  probeSimulations: intArg("--discovery-probe", 1_000),
  validationSimulations: intArg("--discovery-validation", 5_000),
  candidateLimit: intArg("--discovery-candidate-limit", 3),
  validateTop: intArg("--discovery-validate-top", 2),
  rescueDepth: 2,
  rescueUntilBoardMove: 12,
  maxBoardMoves,
  puctExploration: 1.5,
  policyTemperature: 0.6,
} as const;

let state = createBalanceInitialState("quan-gia-threefold", openerAgent);
const forcedOpening = findMove(state, opening);
if (!forcedOpening) throw new Error(`Illegal opening ${opening}`);
const opened = applyBalanceAction(state, forcedOpening);
if (!opened.ok) throw new Error(opened.error);
state = opened.state;

const prefixEngines: Record<ResearchAgentId, ModeAwarePuctV3A> = {
  A: new ModeAwarePuctV3A(),
  B: new ModeAwarePuctV3A(),
};
const prefixTrace = [balanceActionKey(forcedOpening)];

while (state.game.status === "playing" && state.game.moveNumber < targetBoardMove) {
  const agent = currentAgent(state);
  const decision = prefixEngines[agent].chooseAction(state, {
    simulations: fixedSimulations,
    puctExploration: 1.5,
    policyTemperature: 0.6,
  });
  if (!decision.action) throw new Error(`No prefix action at move ${state.game.moveNumber}`);
  prefixTrace.push(balanceActionKey(decision.action));
  const next = applyBalanceAction(state, decision.action);
  if (!next.ok) throw new Error(next.error);
  state = next.state;
}

if (state.game.status !== "playing") {
  throw new Error(`Target state not reached; game finished at move ${state.game.moveNumber}`);
}
if (state.game.moveNumber !== targetBoardMove) {
  throw new Error(`Expected target move ${targetBoardMove}, got ${state.game.moveNumber}`);
}
if (currentAgent(state) !== openerAgent) {
  throw new Error(`Target move ${targetBoardMove} is not owned by opener agent`);
}

// Baseline proposal: fresh vanilla V3A at the exact target state.
const baselineDecision = new ModeAwarePuctV3A().chooseAction(state, {
  simulations: fixedSimulations,
  puctExploration: 1.5,
  policyTemperature: 0.6,
});
if (!baselineDecision.action) throw new Error("Baseline produced no action");

// Candidate proposal: research discovery only. This extra compute is NOT counted
// as continuation strength and is therefore not used to claim search superiority.
const candidateDecision = new ResourceAwarePuctV3A().chooseAction(state, discovery);
if (!candidateDecision.action) throw new Error("ResourceAware produced no action");

const baselineAction = baselineDecision.action;
const candidateAction = candidateDecision.action;
const baselineKey = balanceActionKey(baselineAction);
const candidateKey = balanceActionKey(candidateAction);

const baselineOutcome = evaluateBranch(state, baselineAction);
const candidateOutcome = evaluateBranch(state, candidateAction);

const result = {
  experiment: "b3-fair-move-quality-validation-v1",
  methodology: {
    mode: "quan-gia-threefold",
    opening,
    openerAgent,
    targetBoardMove,
    fixedSimulationsPerContinuationDecision: fixedSimulations,
    continuationEngine: "fresh ModeAwarePuctV3A for both agents and both branches",
    continuationPuctExploration: 1.5,
    continuationPolicyTemperature: 0.6,
    reflectionCanonicalization: true,
    noWallClockCutoff: true,
    candidateDiscoveryIsNotCountedAsStrengthComparison: true,
    discovery,
    prefixAlsoUsesSameFixedVanillaBudget: true,
  },
  prefixTrace,
  target: {
    baselineAction: baselineKey,
    candidateAction: candidateKey,
    candidateChangedAction: candidateKey !== baselineKey,
    baselineRootRankOfCandidate: baselineDecision.rootStats.findIndex(
      (entry) => balanceActionKey(entry.action) === candidateKey,
    ) + 1,
    baselineRootTop: baselineDecision.rootStats.slice(0, 6).map((entry) => ({
      action: balanceActionKey(entry.action),
      visits: entry.visits,
      meanValue: entry.meanValue,
      prior: entry.prior,
      solvedOutcome: entry.solvedOutcome,
    })),
    candidateRescueDiagnostics: candidateDecision.rescueDiagnostics,
  },
  branches: {
    baseline: baselineOutcome,
    candidate: candidateOutcome,
  },
  delta: {
    openerValue: valueNumber(candidateOutcome.openerValue) - valueNumber(baselineOutcome.openerValue),
    openerMargin:
      candidateOutcome.openerMargin === null || baselineOutcome.openerMargin === null
        ? null
        : candidateOutcome.openerMargin - baselineOutcome.openerMargin,
  },
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function evaluateBranch(root: BalanceState, firstAction: BalanceAction): BranchOutcome {
  const first = applyBalanceAction(root, firstAction);
  if (!first.ok) throw new Error(`Illegal branch action ${balanceActionKey(firstAction)}: ${first.error}`);
  let cursor = first.state;

  // Critical fairness rule: fresh engines. Neither branch inherits the search
  // tree used to propose its first move.
  const engines: Record<ResearchAgentId, ModeAwarePuctV3A> = {
    A: new ModeAwarePuctV3A(),
    B: new ModeAwarePuctV3A(),
  };
  const trace = [balanceActionKey(firstAction)];

  while (cursor.game.status === "playing" && cursor.game.moveNumber < maxBoardMoves) {
    const agent = currentAgent(cursor);
    const decision = engines[agent].chooseAction(cursor, {
      simulations: fixedSimulations,
      puctExploration: 1.5,
      policyTemperature: 0.6,
    });
    if (!decision.action) break;
    if (trace.length < 48) trace.push(balanceActionKey(decision.action));
    const next = applyBalanceAction(cursor, decision.action);
    if (!next.ok) throw new Error(next.error);
    cursor = next.state;
  }

  const unresolved = cursor.game.status !== "finished";
  const winner = unresolved ? null : winnerAgent(cursor);
  const openerValue: -1 | 0 | 1 | null = unresolved
    ? null
    : winner === null
      ? 0
      : winner === openerAgent
        ? 1
        : -1;
  const openerSeat = seatForAgent(cursor, openerAgent);
  const responderSeat = openerSeat === "P0" ? "P1" : "P0";

  return {
    unresolved,
    winnerAgent: winner,
    openerValue,
    openerMargin: unresolved ? null : cursor.game.scores[openerSeat] - cursor.game.scores[responderSeat],
    boardMoves: cursor.game.moveNumber,
    finalScores: { ...cursor.game.scores },
    trace,
  };
}

function findMove(target: BalanceState, key: string): BalanceAction | undefined {
  return getBalanceActions(target).find(
    (action) => action.kind === "move" && balanceActionKey(action).toUpperCase() === key.toUpperCase(),
  );
}
function valueNumber(value: -1 | 0 | 1 | null): number {
  return value ?? -2;
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
function readAgent(name: string, fallback: ResearchAgentId): ResearchAgentId {
  const value = stringArg(name) ?? fallback;
  if (value === "A" || value === "B") return value;
  throw new Error(`${name} must be A or B`);
}
