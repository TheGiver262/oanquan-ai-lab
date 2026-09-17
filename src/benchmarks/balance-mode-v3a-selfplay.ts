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
import {
  ModeAwarePuctV3A,
  type ModeAwarePuctV3ADecision,
} from "../research/mode-aware-puct-v3a.js";

const mode = readMode("--mode");
const openingRequest = stringArg("--opening") ?? "auto";
const timeBudgetMs = intArg("--time-budget-ms", 1_200);
const simulationCap = intArg("--simulation-cap", 5_000_000);
const maxBoardMoves = intArg("--max-board-moves", 160);
const outPath = stringArg("--out");

let state = createBalanceInitialState(mode);
const engines: Record<ResearchAgentId, ModeAwarePuctV3A> = {
  A: new ModeAwarePuctV3A(),
  B: new ModeAwarePuctV3A(),
};
const search = { A: emptySearchSummary(), B: emptySearchSummary() };
let protocolDecisions = 0;
let swapUsed = false;
let swapAtBoardMove: number | null = null;
let swapAtResponderNormalMoves: number | null = null;
let finishReason: MatchFinishReason | null = null;
let openingPlayed = "";
let autoRootStats: Array<{ action: string; visits: number; meanValue: number; prior: number; solvedOutcome: -1 | 0 | 1 | null }> | null = null;

if (openingRequest === "auto") {
  const decision = chooseForCurrent(state);
  if (!decision.action || decision.action.kind !== "move") {
    throw new Error("Initial V3A decision must be an ordinary board move");
  }
  autoRootStats = decision.rootStats.map((entry) => ({
    action: balanceActionKey(entry.action),
    visits: entry.visits,
    meanValue: entry.meanValue,
    prior: entry.prior,
    solvedOutcome: entry.solvedOutcome,
  }));
  openingPlayed = balanceActionKey(decision.action);
  state = applyChecked(state, decision.action);
} else {
  const forced = getBalanceActions(state).find(
    (action) => action.kind === "move" && balanceActionKey(action).toUpperCase() === openingRequest.toUpperCase(),
  );
  if (!forced || forced.kind !== "move") {
    throw new Error(`Unknown/illegal opening ${openingRequest}; expected B1..B5:CW|CCW or auto`);
  }
  openingPlayed = balanceActionKey(forced);
  state = applyChecked(state, forced);
}

while (state.game.status === "playing" && state.game.moveNumber < maxBoardMoves) {
  const decision = chooseForCurrent(state);
  if (!decision.action) break;
  const action = decision.action;
  if (action.kind === "swap") {
    if (swapUsed) throw new Error("Second SWAP reached benchmark harness");
    swapUsed = true;
    swapAtBoardMove = state.game.moveNumber;
    swapAtResponderNormalMoves = state.swap.responderNormalMovesTaken;
  }
  state = applyChecked(state, action);
}

const unresolved = state.game.status !== "finished";
const winningAgent = unresolved ? null : winnerAgent(state);
const openerAgentValue = unresolved ? null : winningAgent === null ? 0 : winningAgent === "A" ? 1 : -1;
const openerScore = openerAgentValue === null ? null : (openerAgentValue + 1) / 2;
const seatA = seatForAgent(state, "A");
const seatB = seatForAgent(state, "B");
const finalScoreA = state.game.scores[seatA];
const finalScoreB = state.game.scores[seatB];

const result = {
  experiment: "balance-mode-v3a-selfplay-v1",
  evidenceClass: openingRequest === "auto" ? "v3a-root-selected-selfplay" : "v3a-forced-opening-landscape",
  mode,
  ruleset: state.game.ruleset.canonicalRulesetId,
  methodology: {
    openingRequest,
    openingPlayed,
    originalOpenerAgent: "A",
    originalResponderAgent: "B",
    perspective: "agent identity follows seat ownership through SWAP",
    unresolved: "censored at maxBoardMoves; never heuristic-adjudicated",
    search: "same frozen mode-aware PUCT V3A implementation for both agents",
  },
  config: {
    timeBudgetMs,
    simulationCap,
    maxBoardMoves,
    puctExploration: 1.5,
    policyTemperature: 0.6,
    rootNoise: false,
  },
  outcome: {
    unresolved,
    finishReason,
    winnerSeat: unresolved ? null : state.game.winner,
    winnerAgent: winningAgent,
    openerAgentValue,
    openerScore,
    finalScoreA,
    finalScoreB,
    finalScoreMarginA: finalScoreA - finalScoreB,
    boardMoves: state.game.moveNumber,
    protocolDecisions,
    finalSeatMapping: state.seatToAgent,
  },
  swap: {
    enabled: state.swap.enabled,
    used: swapUsed,
    atBoardMove: swapAtBoardMove,
    afterResponderNormalMoves: swapAtResponderNormalMoves,
    finalResponderNormalMovesTaken: state.swap.responderNormalMovesTaken,
    maxResponderNormalMovesBeforeExpiry: state.swap.maxResponderNormalMovesBeforeExpiry,
  },
  searchDiagnostics: {
    A: summarizeSearch(search.A),
    B: summarizeSearch(search.B),
  },
  autoRootStats,
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function chooseForCurrent(target: BalanceState): ModeAwarePuctV3ADecision {
  const agent = currentAgent(target);
  const decision = engines[agent].chooseAction(target, {
    simulations: simulationCap,
    timeBudgetMs,
    puctExploration: 1.5,
    policyTemperature: 0.6,
  });
  recordSearch(search[agent], decision);
  protocolDecisions += 1;
  return decision;
}

function applyChecked(target: BalanceState, action: BalanceAction): BalanceState {
  const applied = applyBalanceAction(target, action);
  if (!applied.ok) throw new Error(`Illegal balance action ${balanceActionKey(action)}: ${applied.error}`);
  for (const event of applied.events) {
    if (event.type === "match_finished") finishReason = event.reason;
  }
  return applied.state;
}

type SearchSummary = {
  decisions: number;
  elapsedMs: number;
  decisionLatenciesMs: number[];
  simulations: number;
  decisionSimulations: number[];
  reusedDecisions: number;
  reusedRootVisits: number;
  cycleCutoffs: number;
  solvedRoots: number;
};

function emptySearchSummary(): SearchSummary {
  return {
    decisions: 0,
    elapsedMs: 0,
    decisionLatenciesMs: [],
    simulations: 0,
    decisionSimulations: [],
    reusedDecisions: 0,
    reusedRootVisits: 0,
    cycleCutoffs: 0,
    solvedRoots: 0,
  };
}

function recordSearch(summary: SearchSummary, decision: ModeAwarePuctV3ADecision): void {
  summary.decisions += 1;
  summary.elapsedMs += decision.diagnostics.elapsedMs;
  summary.decisionLatenciesMs.push(decision.diagnostics.elapsedMs);
  summary.simulations += decision.diagnostics.simulations;
  summary.decisionSimulations.push(decision.diagnostics.simulations);
  if (decision.diagnostics.reusedRoot) summary.reusedDecisions += 1;
  summary.reusedRootVisits += decision.diagnostics.reusedRootVisits;
  summary.cycleCutoffs += decision.diagnostics.cycleCutoffs;
  if (decision.diagnostics.solvedRoot !== null) summary.solvedRoots += 1;
}

function summarizeSearch(summary: SearchSummary) {
  return {
    decisions: summary.decisions,
    elapsedMs: summary.elapsedMs,
    averageMsPerDecision: summary.decisions > 0 ? summary.elapsedMs / summary.decisions : 0,
    p50LatencyMs: percentile(summary.decisionLatenciesMs, 0.5),
    p95LatencyMs: percentile(summary.decisionLatenciesMs, 0.95),
    maxLatencyMs: summary.decisionLatenciesMs.length > 0 ? Math.max(...summary.decisionLatenciesMs) : 0,
    simulations: summary.simulations,
    averageSimulationsPerDecision: summary.decisions > 0 ? summary.simulations / summary.decisions : 0,
    p50SimulationsPerDecision: percentile(summary.decisionSimulations, 0.5),
    p95SimulationsPerDecision: percentile(summary.decisionSimulations, 0.95),
    reusedDecisions: summary.reusedDecisions,
    reuseRate: summary.decisions > 0 ? summary.reusedDecisions / summary.decisions : 0,
    reusedRootVisits: summary.reusedRootVisits,
    cycleCutoffs: summary.cycleCutoffs,
    solvedRoots: summary.solvedRoots,
  };
}

function percentile(values: readonly number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(quantile * sorted.length) - 1));
  return sorted[index] ?? null;
}

function readMode(name: string): BalanceModeId {
  const value = stringArg(name) ?? "standard";
  const allowed: BalanceModeId[] = [
    "standard",
    "pie-threefold",
    "delayed-pie-4-threefold",
    "delayed-pie-6-threefold",
    "open-pie-threefold",
    "quan-gia",
  ];
  if (allowed.includes(value as BalanceModeId)) return value as BalanceModeId;
  throw new Error(`${name} must be one of ${allowed.join("|")}`);
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
