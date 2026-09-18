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
import { ModeAwarePuctV3A } from "../research/mode-aware-puct-v3a.js";

const mode = readMode("--mode");
const opening = stringArg("--opening") ?? "B3:CW";
const firstMove = intArg("--first-force-move", 2);
const firstActionKey = stringArg("--first-force-action") ?? "B1:CW";
const secondMove = intArg("--second-force-move", 6);
const secondActionKey = stringArg("--second-force-action") ?? "B3:CW";
const openerAgent = readAgent("--opener-agent", "A");
const simulations = intArg("--fixed-simulations", 100_000);
const maxBoardMoves = intArg("--max-board-moves", 240);
const outPath = stringArg("--out");

let state = createBalanceInitialState(mode, openerAgent);
const openingAction = findMove(state, opening);
if (!openingAction) throw new Error(`Illegal opening ${opening}`);
const opened = applyBalanceAction(state, openingAction);
if (!opened.ok) throw new Error(opened.error);
state = opened.state;

const engines = { A: new ModeAwarePuctV3A(), B: new ModeAwarePuctV3A() };
const trace = [balanceActionKey(openingAction)];
const diagnostics: Array<{
  boardMove: number;
  requestedAction: string;
  reached: boolean;
  legal: boolean;
  recommendedAction: string | null;
  forcedRank: number | null;
  rootTop: Array<{ action: string; visits: number; meanValue: number; prior: number; solvedOutcome: -1 | 0 | 1 | null }>;
}> = [
  { boardMove: firstMove, requestedAction: firstActionKey, reached: false, legal: false, recommendedAction: null, forcedRank: null, rootTop: [] },
  { boardMove: secondMove, requestedAction: secondActionKey, reached: false, legal: false, recommendedAction: null, forcedRank: null, rootTop: [] },
];

while (state.game.status === "playing" && state.game.moveNumber < maxBoardMoves) {
  const agent = currentAgent(state);
  const decision = engines[agent].chooseAction(state, {
    simulations,
    puctExploration: 1.5,
    policyTemperature: 0.6,
  });
  if (!decision.action) break;

  let action: BalanceAction = decision.action;
  const forcedSpec = agent === openerAgent
    ? diagnostics.find((entry) => !entry.reached && entry.boardMove === state.game.moveNumber)
    : undefined;
  if (forcedSpec) {
    forcedSpec.reached = true;
    forcedSpec.recommendedAction = balanceActionKey(decision.action);
    forcedSpec.rootTop = decision.rootStats.slice(0, 10).map((entry) => ({
      action: balanceActionKey(entry.action),
      visits: entry.visits,
      meanValue: entry.meanValue,
      prior: entry.prior,
      solvedOutcome: entry.solvedOutcome,
    }));
    const forced = findMove(state, forcedSpec.requestedAction);
    forcedSpec.legal = Boolean(forced);
    const rank = decision.rootStats.findIndex(
      (entry) => balanceActionKey(entry.action).toUpperCase() === forcedSpec.requestedAction.toUpperCase(),
    );
    forcedSpec.forcedRank = rank >= 0 ? rank + 1 : null;
    if (!forced) throw new Error(`Forced action ${forcedSpec.requestedAction} unavailable at move ${forcedSpec.boardMove}`);
    action = forced;
  }

  if (trace.length < 48) trace.push(balanceActionKey(action));
  const applied = applyBalanceAction(state, action);
  if (!applied.ok) throw new Error(`Illegal action ${balanceActionKey(action)}: ${applied.error}`);
  state = applied.state;
}

const unresolved = state.game.status !== "finished";
const winner = unresolved ? null : winnerAgent(state);
const openerValue = unresolved ? null : winner === null ? 0 : winner === openerAgent ? 1 : -1;
const openerSeat = seatForAgent(state, openerAgent);
const responderSeat = openerSeat === "P0" ? "P1" : "P0";

const result = {
  experiment: "double-forced-deviation-selfplay-v1",
  mode,
  opening,
  openerAgent,
  config: {
    fixedSimulations: simulations,
    maxBoardMoves,
    reflectionCanonicalization: true,
    persistentAgentTrees: true,
  },
  forces: diagnostics,
  outcome: {
    unresolved,
    winnerAgent: winner,
    openerValue,
    openerMargin: unresolved ? null : state.game.scores[openerSeat] - state.game.scores[responderSeat],
    boardMoves: state.game.moveNumber,
    finalScores: state.game.scores,
  },
  trace,
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function findMove(state: BalanceState, key: string): BalanceAction | undefined {
  return getBalanceActions(state).find(
    (action) => action.kind === "move" && balanceActionKey(action).toUpperCase() === key.toUpperCase(),
  );
}

function readMode(name: string): BalanceModeId {
  const value = stringArg(name) ?? "quan-gia-threefold";
  if (value === "quan-gia-threefold") return value;
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
