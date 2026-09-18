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
  type ResearchAgentId,
} from "../research/balance-modes.js";
import { ModeAwarePuctV3A } from "../research/mode-aware-puct-v3a.js";
import { ResourceAwarePuctV3A } from "../research/resource-aware-puct-v3a.js";

const opening = stringArg("--opening") ?? "B3:CW";
const openerAgent = readAgent("--opener-agent", "A");
const baselineSimulations = intArg("--baseline-simulations", 10_000);
const primarySimulations = intArg("--primary-simulations", 10_000);
const forecastSimulations = intArg("--forecast-simulations", 10_000);
const probeSimulations = intArg("--probe-simulations", 1_000);
const validationSimulations = intArg("--validation-simulations", 5_000);
const maxBoardMoves = intArg("--max-board-moves", 160);
const rescueUntilBoardMove = intArg("--rescue-until-board-move", 12);
const rescueDepth = intArg("--rescue-depth", 2);
const candidateLimit = intArg("--candidate-limit", 10);
const validateTop = intArg("--validate-top", 2);
const outPath = stringArg("--out");

const responderAgent: ResearchAgentId = openerAgent === "A" ? "B" : "A";
let state = createBalanceInitialState("quan-gia-threefold", openerAgent);
const forcedOpening = getBalanceActions(state).find(
  (action) => action.kind === "move" && balanceActionKey(action) === opening,
);
if (!forcedOpening) throw new Error(`Illegal opening ${opening}`);
const opened = applyBalanceAction(state, forcedOpening);
if (!opened.ok) throw new Error(opened.error);
state = opened.state;

const resourceEngine = new ResourceAwarePuctV3A();
const responderEngine = new ModeAwarePuctV3A();
const trace = [opening];
const rescueEvents: unknown[] = [];
let finishReason: string | null = null;

while (state.game.status === "playing" && state.game.moveNumber < maxBoardMoves) {
  const agent = currentAgent(state);
  let action: BalanceAction | null = null;

  if (agent === openerAgent) {
    const decision = resourceEngine.chooseAction(state, {
      primarySimulations,
      forecastSimulations,
      probeSimulations,
      validationSimulations,
      candidateLimit,
      validateTop,
      rescueUntilBoardMove,
      rescueDepth,
      maxBoardMoves,
      puctExploration: 1.5,
      policyTemperature: 0.6,
    });
    action = decision.action;
    rescueEvents.push({
      boardMove: state.game.moveNumber,
      primaryAction: decision.rescueDiagnostics.primaryAction,
      selectedAction: decision.rescueDiagnostics.selectedAction,
      triggered: decision.rescueDiagnostics.triggered,
      changedAction: decision.rescueDiagnostics.changedAction,
      primaryForecast: decision.rescueDiagnostics.primaryForecast,
      candidates: decision.rescueDiagnostics.candidates,
    });
  } else {
    const decision = responderEngine.chooseAction(state, {
      simulations: baselineSimulations,
      puctExploration: 1.5,
      policyTemperature: 0.6,
    });
    action = decision.action;
  }

  if (!action) break;
  if (trace.length < 40) trace.push(balanceActionKey(action));
  const applied = applyBalanceAction(state, action);
  if (!applied.ok) throw new Error(`Illegal action ${balanceActionKey(action)}: ${applied.error}`);
  for (const event of applied.events) {
    if (event.type === "match_finished") finishReason = event.reason;
  }
  state = applied.state;
}

const unresolved = state.game.status !== "finished";
const winner = unresolved ? null : winnerAgent(state);
const openerValue = unresolved ? null : winner === null ? 0 : winner === openerAgent ? 1 : -1;
const openerSeat = seatForAgent(state, openerAgent);
const responderSeat = openerSeat === "P0" ? "P1" : "P0";

const result = {
  experiment: "b3-resource-aware-selfplay-v1",
  opening,
  openerAgent,
  responderAgent,
  config: {
    baselineSimulations,
    primarySimulations,
    forecastSimulations,
    probeSimulations,
    validationSimulations,
    rescueUntilBoardMove,
    rescueDepth,
    candidateLimit,
    validateTop,
    maxBoardMoves,
  },
  outcome: {
    unresolved,
    finishReason,
    winnerAgent: winner,
    openerValue,
    openerMargin: unresolved ? null : state.game.scores[openerSeat] - state.game.scores[responderSeat],
    scores: state.game.scores,
    boardMoves: state.game.moveNumber,
  },
  trace,
  rescueEvents,
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

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
