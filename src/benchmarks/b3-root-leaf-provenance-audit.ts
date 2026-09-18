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
import {
  ModeAwarePuctV3A,
  type ModeAwarePuctV3ARootLeafAudit,
} from "../research/mode-aware-puct-v3a.js";

const opening = stringArg("--opening") ?? "B3:CW";
const openerAgent = readAgent("--opener-agent", "A");
const targetBoardMove = intArg("--target-board-move", 2);
const fixedSimulations = intArg("--fixed-simulations", 68_000);
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
const prefix: Array<{ boardMove: number; agent: ResearchAgentId; action: string }> = [
  { boardMove: 0, agent: openerAgent, action: balanceActionKey(forcedOpening) },
];

while (state.game.status === "playing" && state.game.moveNumber < targetBoardMove) {
  const agent = currentAgent(state);
  const decision = engines[agent].chooseAction(state, {
    simulations: fixedSimulations,
    puctExploration: 1.5,
    policyTemperature: 0.6,
  });
  if (!decision.action) throw new Error(`No prefix action at move ${state.game.moveNumber}`);
  prefix.push({
    boardMove: state.game.moveNumber,
    agent,
    action: balanceActionKey(decision.action),
  });
  const next = applyBalanceAction(state, decision.action);
  if (!next.ok) throw new Error(next.error);
  state = next.state;
}

if (state.game.status !== "playing" || state.game.moveNumber !== targetBoardMove) {
  throw new Error(`Target move ${targetBoardMove} not reached`);
}

const decision = new ModeAwarePuctV3A().chooseAction(state, {
  simulations: fixedSimulations,
  puctExploration: 1.5,
  policyTemperature: 0.6,
  auditRootLeaves: true,
});
if (!decision.action || !decision.rootLeafAudit) throw new Error("Audit decision incomplete");

const auditByAction = new Map(
  decision.rootLeafAudit.map((entry) => [balanceActionKey(entry.action), entry] as const),
);
const statsByAction = new Map(
  decision.rootStats.map((entry, index) => [
    balanceActionKey(entry.action),
    {
      rank: index + 1,
      visits: entry.visits,
      meanValue: entry.meanValue,
      prior: entry.prior,
      solvedOutcome: entry.solvedOutcome,
    },
  ] as const),
);

const actions = decision.rootStats.map((entry) => balanceActionKey(entry.action));
const rows = actions.map((action) => {
  const stats = statsByAction.get(action);
  const audit = auditByAction.get(action);
  if (!stats || !audit) throw new Error(`Missing audit for ${action}`);
  return summarize(action, stats, audit);
});

const result = {
  experiment: "b3-root-leaf-provenance-audit-v1",
  methodology: {
    mode: "quan-gia-threefold",
    opening,
    openerAgent,
    targetBoardMove,
    fixedSimulations,
    puctExploration: 1.5,
    policyTemperature: 0.6,
    reflectionCanonicalization: true,
    sameBudgetForPrefixAndTargetRoot: true,
    auditIsObservationOnly: true,
  },
  prefix,
  selectedAction: balanceActionKey(decision.action),
  diagnostics: decision.diagnostics,
  rows,
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function summarize(
  action: string,
  stats: {
    rank: number;
    visits: number;
    meanValue: number;
    prior: number;
    solvedOutcome: -1 | 0 | 1 | null;
  },
  audit: ModeAwarePuctV3ARootLeafAudit,
) {
  const total = Math.max(1, audit.total.count);
  const rewardContribution = (sum: number) => sum / total;
  return {
    action,
    ...stats,
    auditCount: audit.total.count,
    auditMeanReward: audit.total.meanReward,
    replies: audit.replies,
    heuristicComponents: audit.heuristicComponents,
    total: audit.total,
    cycle: {
      ...audit.cycle,
      fraction: audit.cycle.count / total,
      contributionToOverallMean: rewardContribution(audit.cycle.rewardSum),
    },
    terminal: {
      ...audit.terminal,
      fraction: audit.terminal.count / total,
      contributionToOverallMean: rewardContribution(audit.terminal.rewardSum),
      wins: audit.terminalWins,
      draws: audit.terminalDraws,
      losses: audit.terminalLosses,
    },
    solvedNonterminal: {
      ...audit.solvedNonterminal,
      fraction: audit.solvedNonterminal.count / total,
      contributionToOverallMean: rewardContribution(audit.solvedNonterminal.rewardSum),
    },
    heuristic: {
      ...audit.heuristic,
      fraction: audit.heuristic.count / total,
      contributionToOverallMean: rewardContribution(audit.heuristic.rewardSum),
    },
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
