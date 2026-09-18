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

const fixedSimulations = intArg("--fixed-simulations", 80_000);
const maxBoardMoves = intArg("--max-board-moves", 240);
const outPath = stringArg("--out");
const openerAgent: ResearchAgentId = "A";

const TRACE_TO_MOVE_34 = [
  "B3:CW",   // 0
  "T2:CW",   // 1
  "B5:CCW",  // 2
  "T3:CW",   // 3
  "B1:CW",   // 4
  "T2:CCW",  // 5
  "B5:CW",   // 6
  "T1:CCW",  // 7
  "B1:CW",   // 8
  "T2:CCW",  // 9
  "B5:CCW",  // 10
  "T5:CW",   // 11
  "B3:CCW",  // 12
  "T5:CW",   // 13
  "B4:CCW",  // 14
  "T2:CCW",  // 15
  "B1:CW",   // 16
  "T2:CCW",  // 17
  "B5:CCW",  // 18
  "T3:CW",   // 19
  "B5:CCW",  // 20
  "T4:CW",   // 21
  "B2:CW",   // 22
  "T1:CCW",  // 23
  "B2:CW",   // 24
  "T5:CW",   // 25
  "B3:CCW",  // 26
  "T5:CW",   // 27
  "B4:CCW",  // 28
  "T2:CCW",  // 29
  "B1:CW",   // 30
  "T2:CCW",  // 31
  "B5:CCW",  // 32
  "T3:CW",   // 33
] as const;

let state = createBalanceInitialState("quan-gia-threefold", openerAgent);
for (const key of TRACE_TO_MOVE_34) {
  if (state.game.status !== "playing") throw new Error(`Unexpected finish before ${key}`);
  const action = findMove(state, key);
  if (!action) throw new Error(`Missing legal replay action ${key} at move ${state.game.moveNumber}`);
  const applied = applyBalanceAction(state, action);
  if (!applied.ok) throw new Error(applied.error);
  state = applied.state;
}

if (state.game.moveNumber !== 34 || currentAgent(state) !== openerAgent) {
  throw new Error(`Expected opener at move 34, got move=${state.game.moveNumber}, agent=${currentAgent(state)}`);
}

const root = new ModeAwarePuctV3A().chooseAction(state, {
  simulations: fixedSimulations,
  puctExploration: 1.5,
  policyTemperature: 0.6,
  auditRootLeaves: true,
});
if (!root.action || !root.rootLeafAudit) throw new Error("Root audit incomplete");

const actionAKey = "B2:CW";
const actionBKey = "B5:CCW";
const actionA = findMove(state, actionAKey);
const actionB = findMove(state, actionBKey);
if (!actionA || !actionB) throw new Error("Expected branch moves unavailable");

const stats = new Map(root.rootStats.map((entry, index) => [
  balanceActionKey(entry.action),
  {
    rank: index + 1,
    visits: entry.visits,
    meanValue: entry.meanValue,
    prior: entry.prior,
    solvedOutcome: entry.solvedOutcome,
  },
] as const));
const audit = new Map(root.rootLeafAudit.map((entry) => [balanceActionKey(entry.action), entry] as const));

const result = {
  experiment: "b3-deep-move34-causal-audit-v1",
  methodology: {
    mode: "quan-gia-threefold",
    fixedSimulations,
    targetBoardMove: 34,
    replayPrefixIsDeterministic: true,
    continuationEngine: "fresh ModeAwarePuctV3A for both branches and both agents",
    puctExploration: 1.5,
    policyTemperature: 0.6,
  },
  root: {
    selectedAction: balanceActionKey(root.action),
    diagnostics: root.diagnostics,
    actionA: {
      action: actionAKey,
      stats: stats.get(actionAKey),
      audit: audit.get(actionAKey),
    },
    actionB: {
      action: actionBKey,
      stats: stats.get(actionBKey),
      audit: audit.get(actionBKey),
    },
  },
  branches: {
    actionA: evaluateBranch(state, actionA),
    actionB: evaluateBranch(state, actionB),
  },
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function evaluateBranch(rootState: BalanceState, firstAction: BalanceAction) {
  const first = applyBalanceAction(rootState, firstAction);
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
    (action) => action.kind === "move" && balanceActionKey(action) === key,
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
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be positive integer`);
  return value;
}
