import { writeFileSync } from "node:fs";
import type { MatchFinishReason } from "../types.js";
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
import { ModeAwarePuctV3A1 } from "../research/mode-aware-puct-v3a1.js";

type TargetMode = Extract<BalanceModeId, "pie-threefold" | "quan-gia-threefold">;

const mode = readMode();
const openingRequest = stringArg("--opening") ?? "auto";
const openerAgent = readAgent("--opener-agent", "A");
const fixedSimulations = intArg("--fixed-simulations", 10_000);
const maxBoardMoves = intArg("--max-board-moves", 200);
const puctExploration = floatArg("--puct-exploration", 1.5);
const policyTemperature = floatArg("--policy-temperature", 0.6);
const outPath = stringArg("--out");

let state = createBalanceInitialState(mode, openerAgent);
const engines: Record<ResearchAgentId, ModeAwarePuctV3A1> = {
  A: new ModeAwarePuctV3A1(),
  B: new ModeAwarePuctV3A1(),
};
let finishReason: MatchFinishReason | null = null;
let protocolDecisions = 0;
let openingPlayed = "";

if (openingRequest === "auto") {
  const decision = choose();
  if (!decision) throw new Error("No legal opening");
  openingPlayed = balanceActionKey(decision);
  state = applyChecked(state, decision);
} else {
  const forced = getBalanceActions(state).find(
    (action) =>
      action.kind === "move"
      && balanceActionKey(action).toUpperCase() === openingRequest.toUpperCase(),
  );
  if (!forced) throw new Error(`Illegal opening ${openingRequest}`);
  openingPlayed = balanceActionKey(forced);
  state = applyChecked(state, forced);
}

while (state.game.status === "playing" && state.game.moveNumber < maxBoardMoves) {
  const action = choose();
  if (!action) break;
  state = applyChecked(state, action);
}

const unresolved = state.game.status !== "finished";
const winner = unresolved ? null : winnerAgent(state);
const responderAgent: ResearchAgentId = openerAgent === "A" ? "B" : "A";
const openerSeat = seatForAgent(state, openerAgent);
const responderSeat = seatForAgent(state, responderAgent);

const result = {
  experiment: "target-mode-v3a1-selfplay-v1",
  mode,
  ruleset: state.game.ruleset.canonicalRulesetId,
  config: {
    fixedSimulationsPerDecision: fixedSimulations,
    puctExploration,
    policyTemperature,
    maxBoardMoves,
    openingRequest,
    openingPlayed,
    openerAgent,
  },
  outcome: {
    unresolved,
    finishReason,
    winnerAgent: winner,
    openerValue: unresolved ? null : winner === null ? 0 : winner === openerAgent ? 1 : -1,
    boardMoves: state.game.moveNumber,
    protocolDecisions,
    finalOpenerScore: state.game.scores[openerSeat],
    finalResponderScore: state.game.scores[responderSeat],
    finalSeatMapping: state.seatToAgent,
    swapUsed: state.swap.used,
  },
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function choose(): BalanceAction | null {
  const agent = currentAgent(state);
  const decision = engines[agent].chooseAction(state, {
    simulations: fixedSimulations,
    puctExploration,
    policyTemperature,
  });
  protocolDecisions += 1;
  return decision.action;
}

function applyChecked(target: BalanceState, action: BalanceAction): BalanceState {
  const applied = applyBalanceAction(target, action);
  if (!applied.ok) throw new Error(`Illegal action ${balanceActionKey(action)}: ${applied.error}`);
  for (const event of applied.events) {
    if (event.type === "match_finished") finishReason = event.reason;
  }
  return applied.state;
}

function readMode(): TargetMode {
  const value = stringArg("--mode") ?? "pie-threefold";
  if (value === "pie-threefold" || value === "quan-gia-threefold") return value;
  throw new Error("--mode must be pie-threefold|quan-gia-threefold");
}

function readAgent(name: string, fallback: ResearchAgentId): ResearchAgentId {
  const value = stringArg(name) ?? fallback;
  if (value === "A" || value === "B") return value;
  throw new Error(`${name} must be A|B`);
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

function floatArg(name: string, fallback: number): number {
  const raw = stringArg(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}
