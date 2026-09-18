import { writeFileSync } from "node:fs";
import {
  applyBalanceAction,
  balanceActionKey,
  createBalanceInitialState,
  currentAgent,
  getBalanceActions,
  type BalanceAction,
  type BalanceState,
  type ResearchAgentId,
} from "../research/balance-modes.js";
import { ModeAwarePuctV3A } from "../research/mode-aware-puct-v3a.js";

const opening = stringArg("--opening") ?? "B3:CW";
const openerAgent = readAgent("--opener-agent", "A");
const targetBoardMove = intArg("--target-board-move", 4);
const fixedSimulations = intArg("--fixed-simulations", 60_000);
const outPath = stringArg("--out");

let state = createBalanceInitialState("quan-gia-threefold", openerAgent);
const forcedOpening = findMove(state, opening);
if (!forcedOpening) throw new Error(`Illegal opening ${opening}`);
const opened = applyBalanceAction(state, forcedOpening);
if (!opened.ok) throw new Error(opened.error);
state = opened.state;

const engines: Record<ResearchAgentId, ModeAwarePuctV3A> = {
  A: new ModeAwarePuctV3A(),
  B: new ModeAwarePuctV3A(),
};
const prefix: Array<{
  beforeMove: number;
  agent: ResearchAgentId;
  action: string;
  rootTop: Array<{ action: string; visits: number; meanValue: number; prior: number; solvedOutcome: -1 | 0 | 1 | null }>;
}> = [];

while (state.game.status === "playing" && state.game.moveNumber < targetBoardMove) {
  const agent = currentAgent(state);
  const decision = engines[agent].chooseAction(state, {
    simulations: fixedSimulations,
    puctExploration: 1.5,
    policyTemperature: 0.6,
  });
  if (!decision.action) throw new Error(`No prefix action at move ${state.game.moveNumber}`);
  prefix.push({
    beforeMove: state.game.moveNumber,
    agent,
    action: balanceActionKey(decision.action),
    rootTop: decision.rootStats.slice(0, 6).map((entry) => ({
      action: balanceActionKey(entry.action),
      visits: entry.visits,
      meanValue: entry.meanValue,
      prior: entry.prior,
      solvedOutcome: entry.solvedOutcome,
    })),
  });
  const next = applyBalanceAction(state, decision.action);
  if (!next.ok) throw new Error(next.error);
  state = next.state;
}

if (state.game.status !== "playing") throw new Error(`Game finished before target move ${targetBoardMove}`);
if (state.game.moveNumber !== targetBoardMove) throw new Error(`Expected move ${targetBoardMove}, got ${state.game.moveNumber}`);

const targetState = exactStateSnapshot(state);
const targetAgent = currentAgent(state);
const targetDecision = new ModeAwarePuctV3A().chooseAction(state, {
  simulations: fixedSimulations,
  puctExploration: 1.5,
  policyTemperature: 0.6,
});
if (!targetDecision.action) throw new Error("No action at target root");

const rootStats = targetDecision.rootStats.map((entry, index) => ({
  rank: index + 1,
  action: balanceActionKey(entry.action),
  visits: entry.visits,
  meanValue: entry.meanValue,
  prior: entry.prior,
  solvedOutcome: entry.solvedOutcome,
}));

const result = {
  experiment: "b3-root-transition-audit-v1",
  methodology: {
    mode: "quan-gia-threefold",
    opening,
    openerAgent,
    targetBoardMove,
    fixedSimulations,
    puctExploration: 1.5,
    policyTemperature: 0.6,
    reflectionCanonicalization: true,
    noWallClockCutoff: true,
    sameBudgetForEntirePrefixAndTargetRoot: true,
  },
  prefix,
  target: {
    agent: targetAgent,
    exactState: targetState,
    exactStateFingerprint: fingerprint(targetState),
    selectedAction: balanceActionKey(targetDecision.action),
    diagnostics: targetDecision.diagnostics,
    rootStats,
  },
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function exactStateSnapshot(target: BalanceState) {
  return {
    currentPlayer: target.game.currentPlayer,
    scores: { ...target.game.scores },
    moveNumber: target.game.moveNumber,
    pits: target.game.pits.map((pit) => ({
      id: pit.id,
      stones: pit.stones,
      quanStones: pit.quanStones,
    })),
    recentMoves: target.game.recentMoves.map((move) => ({ ...move })),
    seatToAgent: { ...target.seatToAgent },
  };
}

function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    a ^= code;
    a = Math.imul(a, 0x01000193);
    b ^= code + i;
    b = Math.imul(b, 0x27d4eb2d);
  }
  return `${(a >>> 0).toString(16).padStart(8, "0")}:${(b >>> 0).toString(16).padStart(8, "0")}`;
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
