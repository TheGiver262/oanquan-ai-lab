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
const forceBoardMove = intArg("--force-board-move", 2);
const forceActionKey = stringArg("--force-action") ?? "B1:CW";
const openerAgent = readAgent("--opener-agent", "A");
const simulations = intArg("--fixed-simulations", 20_000);
const maxBoardMoves = intArg("--max-board-moves", 240);
const outPath = stringArg("--out");

let state = createBalanceInitialState(mode, openerAgent);
const openingAction = getBalanceActions(state).find(
  (action) => action.kind === "move" && balanceActionKey(action).toUpperCase() === opening.toUpperCase(),
);
if (!openingAction) throw new Error(`Illegal opening ${opening}`);
const opened = applyBalanceAction(state, openingAction);
if (!opened.ok) throw new Error(opened.error);
state = opened.state;

const engines = { A: new ModeAwarePuctV3A(), B: new ModeAwarePuctV3A() };
const trace: string[] = [balanceActionKey(openingAction)];
let forced = false;
let forceLegal: boolean | null = null;
let forceDiagnostics: null | {
  currentAgent: ResearchAgentId;
  recommendedAction: string | null;
  forcedAction: string;
  forcedRank: number | null;
  rootTop: Array<{ action: string; visits: number; meanValue: number; prior: number; solvedOutcome: -1 | 0 | 1 | null }>;
} = null;

while (state.game.status === "playing" && state.game.moveNumber < maxBoardMoves) {
  const agent = currentAgent(state);
  const decision = engines[agent].chooseAction(state, {
    simulations,
    puctExploration: 1.5,
    policyTemperature: 0.6,
  });
  if (!decision.action) break;

  let action: BalanceAction = decision.action;
  if (!forced && state.game.moveNumber === forceBoardMove && agent === openerAgent) {
    const candidate = getBalanceActions(state).find(
      (entry) => entry.kind === "move" && balanceActionKey(entry).toUpperCase() === forceActionKey.toUpperCase(),
    );
    forceLegal = Boolean(candidate);
    const forcedRank = decision.rootStats.findIndex(
      (entry) => balanceActionKey(entry.action).toUpperCase() === forceActionKey.toUpperCase(),
    );
    forceDiagnostics = {
      currentAgent: agent,
      recommendedAction: decision.action ? balanceActionKey(decision.action) : null,
      forcedAction: forceActionKey,
      forcedRank: forcedRank >= 0 ? forcedRank + 1 : null,
      rootTop: decision.rootStats.slice(0, 10).map((entry) => ({
        action: balanceActionKey(entry.action),
        visits: entry.visits,
        meanValue: entry.meanValue,
        prior: entry.prior,
        solvedOutcome: entry.solvedOutcome,
      })),
    };
    if (candidate) action = candidate;
    forced = true;
  }

  if (trace.length < 32) trace.push(balanceActionKey(action));
  const applied = applyBalanceAction(state, action);
  if (!applied.ok) throw new Error(`Illegal action ${balanceActionKey(action)}: ${applied.error}`);
  state = applied.state;
}

const unresolved = state.game.status !== "finished";
const winner = unresolved ? null : winnerAgent(state);
const openerValue = unresolved ? null : winner === null ? 0 : winner === openerAgent ? 1 : -1;
const openerSeat = seatForAgent(state, openerAgent);
const responderSeat = openerSeat === "P0" ? "P1" : "P0";
const openerMargin = unresolved ? null : state.game.scores[openerSeat] - state.game.scores[responderSeat];

const result = {
  experiment: "forced-deviation-selfplay-v1",
  mode,
  opening,
  openerAgent,
  force: {
    boardMove: forceBoardMove,
    action: forceActionKey,
    reached: forced,
    legal: forceLegal,
    diagnostics: forceDiagnostics,
  },
  config: {
    fixedSimulations: simulations,
    maxBoardMoves,
    reflectionCanonicalization: true,
    persistentAgentTrees: true,
  },
  outcome: {
    unresolved,
    winnerAgent: winner,
    openerValue,
    openerMargin,
    boardMoves: state.game.moveNumber,
    finalScores: state.game.scores,
  },
  trace,
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function readMode(name: string): BalanceModeId {
  const value = stringArg(name) ?? "quan-gia-threefold";
  const allowed: BalanceModeId[] = ["quan-gia-threefold", "quan-gia-positional-threefold", "quan-gia-pie-threefold", "pie-threefold"];
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
