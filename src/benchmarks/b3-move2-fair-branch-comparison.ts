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
const targetBoardMove = intArg("--target-board-move", 2);
const actionAKey = stringArg("--action-a") ?? "B4:CW";
const actionBKey = stringArg("--action-b") ?? "B5:CCW";
const fixedSimulations = intArg("--fixed-simulations", 68_000);
const maxBoardMoves = intArg("--max-board-moves", 240);
const outPath = stringArg("--out");

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

if (state.game.status !== "playing" || state.game.moveNumber !== targetBoardMove) {
  throw new Error(`Target move ${targetBoardMove} not reached`);
}
if (currentAgent(state) !== openerAgent) {
  throw new Error("Target state is not opener to move");
}

const rootDecision = new ModeAwarePuctV3A().chooseAction(state, {
  simulations: fixedSimulations,
  puctExploration: 1.5,
  policyTemperature: 0.6,
});
if (!rootDecision.action) throw new Error("No root action");

const actionA = findMove(state, actionAKey);
const actionB = findMove(state, actionBKey);
if (!actionA) throw new Error(`Action A unavailable: ${actionAKey}`);
if (!actionB) throw new Error(`Action B unavailable: ${actionBKey}`);

const stats = new Map(rootDecision.rootStats.map((entry, index) => [
  balanceActionKey(entry.action),
  {
    rank: index + 1,
    visits: entry.visits,
    meanValue: entry.meanValue,
    prior: entry.prior,
    solvedOutcome: entry.solvedOutcome,
  },
]));

const branchA = evaluateBranch(state, actionA);
const branchB = evaluateBranch(state, actionB);

const result = {
  experiment: "b3-move2-fair-branch-comparison-v1",
  methodology: {
    mode: "quan-gia-threefold",
    opening,
    openerAgent,
    targetBoardMove,
    fixedSimulations,
    continuationEngine: "fresh ModeAwarePuctV3A for both agents in both branches",
    puctExploration: 1.5,
    policyTemperature: 0.6,
    reflectionCanonicalization: true,
    noWallClockCutoff: true,
    sameBudgetForPrefixRootAndContinuation: true,
  },
  prefixTrace,
  root: {
    selectedAction: balanceActionKey(rootDecision.action),
    actionA: { action: actionAKey, ...(stats.get(actionAKey) ?? null) },
    actionB: { action: actionBKey, ...(stats.get(actionBKey) ?? null) },
  },
  branches: {
    actionA: branchA,
    actionB: branchB,
  },
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function evaluateBranch(root: BalanceState, firstAction: BalanceAction): BranchOutcome {
  const first = applyBalanceAction(root, firstAction);
  if (!first.ok) throw new Error(first.error);
  let cursor = first.state;
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
