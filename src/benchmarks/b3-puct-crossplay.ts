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
  type BalanceState,
  type ResearchAgentId,
} from "../research/balance-modes.js";
import { ModeAwarePuctV3A } from "../research/mode-aware-puct-v3a.js";

type Config = Readonly<{ cPuct: number; temperature: number; label: string }>;

const opening = stringArg("--opening") ?? "B3:CW";
const openerAgent = readAgent("--opener-agent", "A");
const openerConfig: Config = {
  cPuct: floatArg("--opener-c-puct", 2.5),
  temperature: floatArg("--opener-temperature", 0.8),
  label: stringArg("--opener-label") ?? "candidate",
};
const responderConfig: Config = {
  cPuct: floatArg("--responder-c-puct", 1.5),
  temperature: floatArg("--responder-temperature", 0.6),
  label: stringArg("--responder-label") ?? "baseline",
};
const simulations = intArg("--fixed-simulations", 20_000);
const maxBoardMoves = intArg("--max-board-moves", 200);
const outPath = stringArg("--out");

const responderAgent: ResearchAgentId = openerAgent === "A" ? "B" : "A";
let state = createBalanceInitialState("quan-gia-threefold", openerAgent);
const openingAction = getBalanceActions(state).find(
  (action) => action.kind === "move" && balanceActionKey(action).toUpperCase() === opening.toUpperCase(),
);
if (!openingAction) throw new Error(`Illegal opening ${opening}`);
const opened = applyBalanceAction(state, openingAction);
if (!opened.ok) throw new Error(opened.error);
state = opened.state;

const engines: Record<ResearchAgentId, ModeAwarePuctV3A> = {
  A: new ModeAwarePuctV3A(),
  B: new ModeAwarePuctV3A(),
};
const trace: Array<{ boardMove: number; agent: ResearchAgentId; action: string }> = [
  { boardMove: 0, agent: openerAgent, action: balanceActionKey(openingAction) },
];
let finishReason: MatchFinishReason | null = null;

while (state.game.status === "playing" && state.game.moveNumber < maxBoardMoves) {
  const agent = currentAgent(state);
  const roleConfig = agent === openerAgent ? openerConfig : responderConfig;
  const decision = engines[agent].chooseAction(state, {
    simulations,
    puctExploration: roleConfig.cPuct,
    policyTemperature: roleConfig.temperature,
  });
  if (!decision.action) break;
  if (trace.length < 24) {
    trace.push({ boardMove: state.game.moveNumber, agent, action: balanceActionKey(decision.action) });
  }
  state = applyChecked(state, decision.action);
}

const unresolved = state.game.status !== "finished";
const winningAgent = unresolved ? null : winnerAgent(state);
const openerValue = unresolved ? null : winningAgent === null ? 0 : winningAgent === openerAgent ? 1 : -1;
const openerSeat = seatForAgent(state, openerAgent);
const responderSeat = seatForAgent(state, responderAgent);

const result = {
  experiment: "b3-puct-crossplay-v1",
  opening,
  openerAgent,
  responderAgent,
  config: { simulations, maxBoardMoves, opener: openerConfig, responder: responderConfig },
  outcome: {
    unresolved,
    finishReason,
    winnerAgent: winningAgent,
    openerValue,
    openerMargin: unresolved ? null : state.game.scores[openerSeat] - state.game.scores[responderSeat],
    boardMoves: state.game.moveNumber,
    finalScores: state.game.scores,
  },
  trace,
};

const json=`${JSON.stringify(result,null,2)}\n`;
if(outPath) writeFileSync(outPath,json,"utf8");
console.log(json);

function applyChecked(target: BalanceState, action: BalanceAction): BalanceState {
  const applied=applyBalanceAction(target,action);
  if(!applied.ok) throw new Error(applied.error);
  for(const event of applied.events) if(event.type==="match_finished") finishReason=event.reason;
  return applied.state;
}
function readAgent(name:string,fallback:ResearchAgentId):ResearchAgentId{
  const v=stringArg(name)??fallback;
  if(v==="A"||v==="B") return v;
  throw new Error(`${name} must be A or B`);
}
function stringArg(name:string):string|null{
  const i=process.argv.indexOf(name); return i>=0?process.argv[i+1]??null:null;
}
function intArg(name:string,fallback:number):number{
  const r=stringArg(name); if(r===null) return fallback;
  const v=Number(r); if(!Number.isSafeInteger(v)||v<=0) throw new Error(`${name} must be positive integer`); return v;
}
function floatArg(name:string,fallback:number):number{
  const r=stringArg(name); if(r===null) return fallback;
  const v=Number(r); if(!Number.isFinite(v)||v<=0) throw new Error(`${name} must be positive number`); return v;
}
