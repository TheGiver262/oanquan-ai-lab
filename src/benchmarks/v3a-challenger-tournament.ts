import { writeFileSync } from "node:fs";
import { applyMove, createInitialState, getLegalMoves } from "../engine.js";
import { analyzePosition, type SearchResult } from "../search.js";
import { chooseMctsMove, type MctsDecision } from "../research/mcts.js";
import { ReusableScoreBoundedPuct, type PuctV3ADecision } from "../research/puct-v3a.js";
import { parseClassicOpening } from "../research/opening-pie-analysis.js";
import {
  LIVE_QUAN_BALANCED_POSITIONS,
  replayLiveQuanPosition,
} from "../research/v3-live-quan-corpus.js";
import {
  BALANCED_MIDGAME_POSITIONS,
  replayBalancedPosition,
  type BalancedMidgamePosition,
} from "../research/v3-balanced-midgame-corpus.js";
import type { GameState, PlayerId, PlayerMove } from "../types.js";

type ChallengerId = "uct" | "uct-pb" | "lab-minimax" | "lab-alpha-beta" | "v3a-null";
type StageId = "stage1" | "stage2" | "stage3";
type Score = 0 | 0.5 | 1;

type Position = {
  id: string;
  start: () => GameState;
  moveLimit: (state: GameState) => number;
};

type SearchSummary = {
  decisions: number;
  elapsedMs: number;
  decisionLatenciesMs: number[];
  simulations: number;
  decisionSimulations: number[];
  nodes: number;
  decisionNodes: number[];
  expandedNodes: number;
  maxTreeDepth: number;
  completedDepthTotal: number;
  completedDepthMax: number;
  cutoffs: number;
  reusedDecisions: number;
  reusedRootVisits: number;
  cycleCutoffs: number;
  solvedRoots: number;
  timeBudgetExhaustions: number;
  nodeBudgetExhaustions: number;
};

type GameResult = {
  position: string;
  challengerSeat: PlayerId;
  winner: PlayerId | null;
  unresolved: boolean;
  continuationMoves: number;
  challengerScore: Score | null;
  gameSeed: number;
};

const STAGE3_IDS = new Set([
  "B3:CW:material@12",
  "B3:CW:material@14",
  "B3:CW:material@19",
  "B3:CCW:strategic@16",
  "B3:CCW:strategic@19",
]);

const stage = readStage("--stage");
const challenger = readChallenger("--challenger");
const timeBudgetMs = intArg("--time-budget-ms", 600);
const simulationCap = intArg("--simulation-cap", 5_000_000);
const searchNodeCap = intArg("--search-node-cap", 5_000_000);
const rolloutDepth = intArg("--rollout-depth", 20);
const seed = intArg("--seed", 20_260_917);
const replicate = intArg("--replicate", 1);
const outPath = stringArg("--out");

const positions = buildPositions(stage);
const challengerSearch = emptySearchSummary();
const incumbentSearch = emptySearchSummary();
const details: GameResult[] = [];
const perPosition = new Map<string, { games: number; unresolved: number; challengerPoints: number; pairDiff: number | null }>();

for (const position of positions) {
  const pair = (["P0", "P1"] as const).map((challengerSeat) => play(position, challengerSeat));
  details.push(...pair);
  const unresolved = pair.filter((game) => game.unresolved).length;
  const challengerPoints = pair.reduce((sum, game) => sum + (game.challengerScore ?? 0), 0);
  perPosition.set(position.id, {
    games: pair.length,
    unresolved,
    challengerPoints,
    pairDiff: unresolved === 0 ? challengerPoints - (2 - challengerPoints) : null,
  });
}

const pairDiffs = [...perPosition.values()].flatMap((entry) => entry.pairDiff === null ? [] : [entry.pairDiff]);
const resolved = details.filter((game) => !game.unresolved && game.challengerScore !== null);
const challengerPoints = resolved.reduce((sum, game) => sum + (game.challengerScore ?? 0), 0);
const challengerWins = resolved.filter((game) => game.winner === game.challengerSeat).length;
const incumbentWins = resolved.filter((game) => game.winner !== null && game.winner !== game.challengerSeat).length;
const draws = resolved.filter((game) => game.winner === null).length;

const result = {
  experiment: "v3a-challenger-screen-legacy-no-repeat",
  evidenceClass: challenger === "v3a-null"
    ? "wallclock-v3a-null-control"
    : isStochastic(challenger)
      ? "cross-family-wallclock-seeded-screen"
      : "cross-family-wallclock-runtime-screen",
  ruleset: "oaq:classic_2p:standard:v1",
  methodology: {
    stage,
    challenger,
    incumbent: "puct-v3a",
    pairing: "Each exact position is played twice with challenger ownership swapped P0/P1.",
    primaryMetric: "pairDiff from challenger perspective; positive favors challenger, negative favors V3A",
    resourceMode: "equal wall clock per decision; node/simulation ceilings are runaway guards and not equivalent work units",
    unresolved: "censored at the stage move cap; never heuristic-adjudicated",
    repetition: "audited production legacy semantics: repeated_moves termination disabled",
    repeatMeaning: isStochastic(challenger)
      ? "seed drives real UCT-family expansion/rollout randomness"
      : "replicate is runtime/jitter metadata only; deterministic repeats are not independent samples",
    pvsStatus: "PVS/NegaScout intentionally excluded from active challenger evaluation by prior project decision",
  },
  config: {
    timeBudgetMs,
    simulationCap,
    searchNodeCap,
    rolloutDepth,
    seed,
    replicate,
    puctExploration: 1.5,
    policyTemperature: 0.6,
    labSearchProfile: "trang-nguyen (zero mistake rate; heuristic/resource profile only, not production TN best-first)",
  },
  positions: positions.map((position) => position.id),
  games: details.length,
  challengerWins,
  incumbentWins,
  draws,
  unresolved: details.filter((game) => game.unresolved).length,
  unresolvedRate: details.length > 0 ? details.filter((game) => game.unresolved).length / details.length : 0,
  resolvedScoreRate: resolved.length > 0 ? challengerPoints / resolved.length : null,
  completedPairs: pairDiffs.length,
  meanPairDiff: mean(pairDiffs),
  medianPairDiff: median(pairDiffs),
  favorablePairs: pairDiffs.filter((value) => value > 0).length,
  neutralPairs: pairDiffs.filter((value) => value === 0).length,
  unfavorablePairs: pairDiffs.filter((value) => value < 0).length,
  pairDiffs,
  perPosition: Object.fromEntries(perPosition),
  searchDiagnostics: {
    challenger: summarizeSearch(challengerSearch),
    incumbent: summarizeSearch(incumbentSearch),
  },
  details,
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function play(position: Position, challengerSeat: PlayerId): GameResult {
  let state = position.start();
  const startMove = state.moveNumber;
  const limit = position.moveLimit(state);
  const incumbentV3 = new ReusableScoreBoundedPuct();
  const challengerV3 = challenger === "v3a-null" ? new ReusableScoreBoundedPuct() : null;
  const gameSeed = deriveSeed(seed, stage, challenger, position.id, challengerSeat, replicate);
  const random = mulberry32(gameSeed);

  while (state.status === "playing" && state.moveNumber < limit) {
    const isChallenger = state.currentPlayer === challengerSeat;
    let move: PlayerMove | null;

    if (!isChallenger) {
      const decision = incumbentV3.chooseMove(state, {
        simulations: simulationCap,
        timeBudgetMs,
        puctExploration: 1.5,
        policyTemperature: 0.6,
      });
      recordV3(incumbentSearch, decision);
      move = decision.move;
    } else if (challenger === "v3a-null") {
      if (!challengerV3) throw new Error("Missing challenger V3A null-control session");
      const decision = challengerV3.chooseMove(state, {
        simulations: simulationCap,
        timeBudgetMs,
        puctExploration: 1.5,
        policyTemperature: 0.6,
      });
      recordV3(challengerSearch, decision);
      move = decision.move;
    } else if (challenger === "uct" || challenger === "uct-pb") {
      const decision = chooseMctsMove(state, {
        variant: challenger,
        simulations: simulationCap,
        timeBudgetMs,
        rolloutDepth,
        random,
      });
      recordMcts(challengerSearch, decision);
      move = decision.move;
    } else {
      const decision = analyzePosition(state, "trang-nguyen", {
        algorithm: challenger === "lab-minimax" ? "minimax" : "alpha-beta",
        nodeBudget: searchNodeCap,
        timeBudgetMs,
        random: () => 0.5,
      });
      recordLabSearch(challengerSearch, decision);
      move = decision.bestMove;
    }

    if (!move) return unresolved(position, challengerSeat, state.moveNumber - startMove, gameSeed);
    const applied = applyMove(state, move);
    if (!applied.ok) {
      throw new Error(`Illegal ${isChallenger ? challenger : "puct-v3a"} move ${move.pit}:${move.dir}: ${applied.error}`);
    }
    state = applied.state;
  }

  if (state.status !== "finished") return unresolved(position, challengerSeat, state.moveNumber - startMove, gameSeed);
  return {
    position: position.id,
    challengerSeat,
    winner: state.winner,
    unresolved: false,
    continuationMoves: state.moveNumber - startMove,
    challengerScore: state.winner === null ? 0.5 : state.winner === challengerSeat ? 1 : 0,
    gameSeed,
  };
}

function buildPositions(target: StageId): Position[] {
  if (target === "stage1") return buildStage1Positions();
  if (target === "stage2") {
    return LIVE_QUAN_BALANCED_POSITIONS.map((position) => ({
      id: position.id,
      start: () => replayLiveQuanPosition(position),
      moveLimit: (state) => state.moveNumber + 160,
    }));
  }
  const selected = BALANCED_MIDGAME_POSITIONS.filter((position) => STAGE3_IDS.has(position.id));
  if (selected.length !== STAGE3_IDS.size) {
    throw new Error(`Expected ${STAGE3_IDS.size} Stage 3 positions, got ${selected.length}`);
  }
  return selected.map((position) => stage3Position(position));
}

function buildStage1Positions(): Position[] {
  const openings = [parseClassicOpening("B3:CW"), parseClassicOpening("B3:CCW")];
  const positions: Position[] = [];
  for (const opening of openings) {
    const opened = applyMove(createInitialState(), opening);
    if (!opened.ok) throw new Error(`Failed Stage 1 opening ${opening.pit}:${opening.dir}`);
    for (const reply of getLegalMoves(opened.state)) {
      const id = `${opening.pit}:${opening.dir}>${reply.pit}:${reply.dir}`;
      positions.push({
        id,
        start: () => {
          const first = applyMove(createInitialState(), opening);
          if (!first.ok) throw new Error(`Failed Stage 1 opening ${id}`);
          const second = applyMove(first.state, reply);
          if (!second.ok) throw new Error(`Failed Stage 1 reply ${id}`);
          return second.state;
        },
        moveLimit: () => 160,
      });
    }
  }
  if (positions.length !== 16) throw new Error(`Expected 16 Stage 1 positions, got ${positions.length}`);
  return positions;
}

function stage3Position(position: BalancedMidgamePosition): Position {
  return {
    id: position.id,
    start: () => replayBalancedPosition(position),
    moveLimit: (state) => state.moveNumber + 512,
  };
}

function unresolved(position: Position, challengerSeat: PlayerId, continuationMoves: number, gameSeed: number): GameResult {
  return {
    position: position.id,
    challengerSeat,
    winner: null,
    unresolved: true,
    continuationMoves,
    challengerScore: null,
    gameSeed,
  };
}

function recordV3(summary: SearchSummary, decision: PuctV3ADecision): void {
  summary.decisions += 1;
  summary.elapsedMs += decision.diagnostics.elapsedMs;
  summary.decisionLatenciesMs.push(decision.diagnostics.elapsedMs);
  summary.simulations += decision.diagnostics.simulations;
  summary.decisionSimulations.push(decision.diagnostics.simulations);
  summary.expandedNodes += decision.diagnostics.expandedNodes;
  summary.maxTreeDepth = Math.max(summary.maxTreeDepth, decision.diagnostics.maxTreeDepth);
  if (decision.diagnostics.reusedRoot) summary.reusedDecisions += 1;
  summary.reusedRootVisits += decision.diagnostics.reusedRootVisits;
  summary.cycleCutoffs += decision.diagnostics.cycleCutoffs;
  if (decision.diagnostics.solvedRoot !== null) summary.solvedRoots += 1;
}

function recordMcts(summary: SearchSummary, decision: MctsDecision): void {
  summary.decisions += 1;
  summary.elapsedMs += decision.diagnostics.elapsedMs;
  summary.decisionLatenciesMs.push(decision.diagnostics.elapsedMs);
  summary.simulations += decision.diagnostics.simulations;
  summary.decisionSimulations.push(decision.diagnostics.simulations);
  summary.expandedNodes += decision.diagnostics.expandedNodes;
  summary.maxTreeDepth = Math.max(summary.maxTreeDepth, decision.diagnostics.maxTreeDepth);
}

function recordLabSearch(summary: SearchSummary, decision: SearchResult): void {
  summary.decisions += 1;
  summary.elapsedMs += decision.diagnostics.elapsedMs;
  summary.decisionLatenciesMs.push(decision.diagnostics.elapsedMs);
  summary.nodes += decision.diagnostics.nodeCount;
  summary.decisionNodes.push(decision.diagnostics.nodeCount);
  summary.completedDepthTotal += decision.diagnostics.completedDepth;
  summary.completedDepthMax = Math.max(summary.completedDepthMax, decision.diagnostics.completedDepth);
  summary.cutoffs += decision.diagnostics.cutoffs;
  if (decision.diagnostics.budgetReason === "time") summary.timeBudgetExhaustions += 1;
  if (decision.diagnostics.budgetReason === "node") summary.nodeBudgetExhaustions += 1;
}

function summarizeSearch(summary: SearchSummary) {
  return {
    decisions: summary.decisions,
    elapsedMs: summary.elapsedMs,
    averageMsPerDecision: summary.decisions > 0 ? summary.elapsedMs / summary.decisions : 0,
    p50LatencyMs: percentile(summary.decisionLatenciesMs, 0.5),
    p95LatencyMs: percentile(summary.decisionLatenciesMs, 0.95),
    p99LatencyMs: percentile(summary.decisionLatenciesMs, 0.99),
    maxLatencyMs: summary.decisionLatenciesMs.length > 0 ? Math.max(...summary.decisionLatenciesMs) : 0,
    simulations: summary.simulations,
    averageSimulationsPerDecision: summary.decisions > 0 ? summary.simulations / summary.decisions : 0,
    p50SimulationsPerDecision: percentile(summary.decisionSimulations, 0.5),
    p95SimulationsPerDecision: percentile(summary.decisionSimulations, 0.95),
    nodes: summary.nodes,
    averageNodesPerDecision: summary.decisions > 0 ? summary.nodes / summary.decisions : 0,
    p50NodesPerDecision: percentile(summary.decisionNodes, 0.5),
    p95NodesPerDecision: percentile(summary.decisionNodes, 0.95),
    expandedNodes: summary.expandedNodes,
    maxTreeDepth: summary.maxTreeDepth,
    averageCompletedDepth: summary.decisions > 0 ? summary.completedDepthTotal / summary.decisions : 0,
    maxCompletedDepth: summary.completedDepthMax,
    cutoffs: summary.cutoffs,
    reusedDecisions: summary.reusedDecisions,
    reusedRootVisits: summary.reusedRootVisits,
    reuseRate: summary.decisions > 0 ? summary.reusedDecisions / summary.decisions : 0,
    cycleCutoffs: summary.cycleCutoffs,
    solvedRoots: summary.solvedRoots,
    timeBudgetExhaustions: summary.timeBudgetExhaustions,
    nodeBudgetExhaustions: summary.nodeBudgetExhaustions,
  };
}

function emptySearchSummary(): SearchSummary {
  return {
    decisions: 0,
    elapsedMs: 0,
    decisionLatenciesMs: [],
    simulations: 0,
    decisionSimulations: [],
    nodes: 0,
    decisionNodes: [],
    expandedNodes: 0,
    maxTreeDepth: 0,
    completedDepthTotal: 0,
    completedDepthMax: 0,
    cutoffs: 0,
    reusedDecisions: 0,
    reusedRootVisits: 0,
    cycleCutoffs: 0,
    solvedRoots: 0,
    timeBudgetExhaustions: 0,
    nodeBudgetExhaustions: 0,
  };
}

function percentile(values: readonly number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(quantile * sorted.length) - 1));
  return sorted[index] ?? null;
}

function mean(values: readonly number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle] ?? null
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function isStochastic(value: ChallengerId): boolean {
  return value === "uct" || value === "uct-pb";
}

function readStage(name: string): StageId {
  const value = stringArg(name) ?? "stage2";
  if (value === "stage1" || value === "stage2" || value === "stage3") return value;
  throw new Error(`${name} must be stage1|stage2|stage3`);
}

function readChallenger(name: string): ChallengerId {
  const value = stringArg(name) ?? "uct-pb";
  if (
    value === "uct"
    || value === "uct-pb"
    || value === "lab-minimax"
    || value === "lab-alpha-beta"
    || value === "v3a-null"
  ) return value;
  throw new Error(`${name} must be uct|uct-pb|lab-minimax|lab-alpha-beta|v3a-null`);
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

function deriveSeed(...parts: Array<string | number>): number {
  let hash = 2_166_136_261;
  for (const part of parts) {
    const text = String(part);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16_777_619);
    }
  }
  return hash >>> 0;
}

function mulberry32(seedValue: number): () => number {
  let value = seedValue >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
