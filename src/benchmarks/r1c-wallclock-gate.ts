import { writeFileSync } from "node:fs";
import { applyMove, createInitialState, getLegalMoves } from "../engine.js";
import { chooseFrozenPuctV2, type PuctV2Decision } from "../research/puct-v2.js";
import { ReusableScoreBoundedPuct, type PuctV3ADecision } from "../research/puct-v3a.js";
import { parseClassicOpening } from "../research/opening-pie-analysis.js";
import {
  LIVE_QUAN_BALANCED_POSITIONS,
  replayLiveQuanPosition,
  type LiveQuanPosition,
} from "../research/v3-live-quan-corpus.js";
import {
  BALANCED_MIDGAME_POSITIONS,
  replayBalancedPosition,
  type BalancedMidgamePosition,
} from "../research/v3-balanced-midgame-corpus.js";
import type { GameState, PlayerId, PlayerMove } from "../types.js";

type EngineId = "puct-v2" | "puct-v3a";
type StageId = "stage1" | "stage2" | "stage3";
type Score = 0 | 0.5 | 1;

type Position = {
  id: string;
  stage: StageId;
  start: () => GameState;
  moveLimit: (state: GameState) => number;
};

type SearchSummary = {
  decisions: number;
  simulations: number;
  expandedNodes: number;
  maxTreeDepth: number;
  elapsedMs: number;
  decisionLatenciesMs: number[];
  decisionSimulations: number[];
  reusedDecisions: number;
  reusedRootVisits: number;
  cycleCutoffs: number;
  solvedRoots: number;
};

type GameResult = {
  position: string;
  candidateSeat: PlayerId;
  winner: PlayerId | null;
  unresolved: boolean;
  continuationMoves: number;
  candidateScore: Score | null;
};

const STAGE3_IDS = new Set([
  "B3:CW:material@12",
  "B3:CW:material@14",
  "B3:CW:material@19",
  "B3:CCW:strategic@16",
  "B3:CCW:strategic@19",
]);

const stage = readStage("--stage");
const candidate = readEngine("--candidate", "puct-v3a");
const baseline = readEngine("--baseline", "puct-v2");
const timeBudgetMs = intArg("--time-budget-ms", 600);
const simulationCap = intArg("--simulation-cap", 5_000_000);
const replicate = intArg("--replicate", 1);
const outPath = stringArg("--out");

const positions = buildPositions(stage);
const candidateSearch = emptySearchSummary();
const baselineSearch = emptySearchSummary();
const details: GameResult[] = [];
const perPosition = new Map<string, { games: number; unresolved: number; candidatePoints: number; pairDiff: number | null }>();

for (const position of positions) {
  const pair = (["P0", "P1"] as const).map((candidateSeat) => play(position, candidateSeat));
  details.push(...pair);
  const unresolved = pair.filter((game) => game.unresolved).length;
  const candidatePoints = pair.reduce((sum, game) => sum + (game.candidateScore ?? 0), 0);
  perPosition.set(position.id, {
    games: pair.length,
    unresolved,
    candidatePoints,
    pairDiff: unresolved === 0 ? candidatePoints - (2 - candidatePoints) : null,
  });
}

const pairDiffs = [...perPosition.values()].flatMap((entry) => entry.pairDiff === null ? [] : [entry.pairDiff]);
const resolved = details.filter((game) => !game.unresolved && game.candidateScore !== null);
const candidatePoints = resolved.reduce((sum, game) => sum + (game.candidateScore ?? 0), 0);
const result = {
  experiment: "R1c-600ms-wallclock-gate",
  evidenceClass: candidate === baseline ? "wallclock-null-control" : "same-family-wallclock-runtime-replicate",
  ruleset: "oaq:classic_2p:standard:v1",
  methodology: {
    stage,
    candidate,
    baseline,
    deterministicSearchLogic: true,
    randomSeeds: "none; V2 and V3A do not consume RNG",
    replicateMeaning: "runtime replicate only; not an independent stochastic seed",
    pairing: "Each exact position is played twice with candidate ownership swapped P0/P1.",
    resourceMode: "per-decision wall-clock deadline with a deliberately high simulation ceiling",
    nullControlPurpose: candidate === baseline
      ? "Quantify runner/JIT/scheduling noise under the same wall-clock budget."
      : "N/A",
    unresolved: "censored at the stage move cap; never heuristic-adjudicated",
    repetition: "documented repeated_moves rule enabled; last-six move history is rule-relevant state",
  },
  config: {
    timeBudgetMs,
    simulationCap,
    replicate,
    puctExploration: 1.5,
    policyTemperature: 0.6,
  },
  positions: positions.map((position) => position.id),
  games: details.length,
  unresolved: details.filter((game) => game.unresolved).length,
  unresolvedRate: details.length > 0 ? details.filter((game) => game.unresolved).length / details.length : 0,
  resolvedScoreRate: resolved.length > 0 ? candidatePoints / resolved.length : null,
  completedPairs: pairDiffs.length,
  meanPairDiff: mean(pairDiffs),
  medianPairDiff: median(pairDiffs),
  favorablePairs: pairDiffs.filter((value) => value > 0).length,
  neutralPairs: pairDiffs.filter((value) => value === 0).length,
  unfavorablePairs: pairDiffs.filter((value) => value < 0).length,
  pairDiffs,
  perPosition: Object.fromEntries(perPosition),
  searchDiagnostics: {
    candidate: summarizeSearch(candidateSearch),
    baseline: summarizeSearch(baselineSearch),
  },
  details,
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function play(position: Position, candidateSeat: PlayerId): GameResult {
  let state = position.start();
  const startMove = state.moveNumber;
  const limit = position.moveLimit(state);
  const candidateV3 = candidate === "puct-v3a" ? new ReusableScoreBoundedPuct() : null;
  const baselineV3 = baseline === "puct-v3a" ? new ReusableScoreBoundedPuct() : null;

  while (state.status === "playing" && state.moveNumber < limit) {
    const isCandidate = state.currentPlayer === candidateSeat;
    const engine = isCandidate ? candidate : baseline;
    const search = isCandidate ? candidateSearch : baselineSearch;
    let move: PlayerMove | null;

    if (engine === "puct-v3a") {
      const session = isCandidate ? candidateV3 : baselineV3;
      if (!session) throw new Error("Missing V3A session");
      const decision = session.chooseMove(state, {
        simulations: simulationCap,
        timeBudgetMs,
        puctExploration: 1.5,
        policyTemperature: 0.6,
      });
      recordV3(search, decision);
      move = decision.move;
    } else {
      const decision = chooseFrozenPuctV2(state, {
        simulations: simulationCap,
        timeBudgetMs,
        puctExploration: 1.5,
        policyTemperature: 0.6,
      });
      recordV2(search, decision);
      move = decision.move;
    }

    if (!move) return unresolved(position, candidateSeat, state.moveNumber - startMove);
    const applied = applyMove(state, move);
    if (!applied.ok) throw new Error(`Illegal ${engine} move ${move.pit}:${move.dir}: ${applied.error}`);
    state = applied.state;
  }

  if (state.status !== "finished") return unresolved(position, candidateSeat, state.moveNumber - startMove);
  return {
    position: position.id,
    candidateSeat,
    winner: state.winner,
    unresolved: false,
    continuationMoves: state.moveNumber - startMove,
    candidateScore: state.winner === null ? 0.5 : state.winner === candidateSeat ? 1 : 0,
  };
}

function buildPositions(target: StageId): Position[] {
  if (target === "stage1") return buildStage1Positions();
  if (target === "stage2") {
    return LIVE_QUAN_BALANCED_POSITIONS.map((position) => ({
      id: position.id,
      stage: target,
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
        stage: "stage1",
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
    stage: "stage3",
    start: () => replayBalancedPosition(position),
    moveLimit: (state) => state.moveNumber + 512,
  };
}

function unresolved(position: Position, candidateSeat: PlayerId, continuationMoves: number): GameResult {
  return {
    position: position.id,
    candidateSeat,
    winner: null,
    unresolved: true,
    continuationMoves,
    candidateScore: null,
  };
}

function recordV2(summary: SearchSummary, decision: PuctV2Decision): void {
  summary.decisions += 1;
  summary.simulations += decision.diagnostics.simulations;
  summary.expandedNodes += decision.diagnostics.expandedNodes;
  summary.maxTreeDepth = Math.max(summary.maxTreeDepth, decision.diagnostics.maxTreeDepth);
  summary.elapsedMs += decision.diagnostics.elapsedMs;
  summary.decisionLatenciesMs.push(decision.diagnostics.elapsedMs);
  summary.decisionSimulations.push(decision.diagnostics.simulations);
}

function recordV3(summary: SearchSummary, decision: PuctV3ADecision): void {
  summary.decisions += 1;
  summary.simulations += decision.diagnostics.simulations;
  summary.expandedNodes += decision.diagnostics.expandedNodes;
  summary.maxTreeDepth = Math.max(summary.maxTreeDepth, decision.diagnostics.maxTreeDepth);
  summary.elapsedMs += decision.diagnostics.elapsedMs;
  summary.decisionLatenciesMs.push(decision.diagnostics.elapsedMs);
  summary.decisionSimulations.push(decision.diagnostics.simulations);
  if (decision.diagnostics.reusedRoot) summary.reusedDecisions += 1;
  summary.reusedRootVisits += decision.diagnostics.reusedRootVisits;
  summary.cycleCutoffs += decision.diagnostics.cycleCutoffs;
  if (decision.diagnostics.solvedRoot !== null) summary.solvedRoots += 1;
}

function summarizeSearch(summary: SearchSummary) {
  return {
    decisions: summary.decisions,
    simulations: summary.simulations,
    expandedNodes: summary.expandedNodes,
    maxTreeDepth: summary.maxTreeDepth,
    elapsedMs: summary.elapsedMs,
    reusedDecisions: summary.reusedDecisions,
    reusedRootVisits: summary.reusedRootVisits,
    cycleCutoffs: summary.cycleCutoffs,
    solvedRoots: summary.solvedRoots,
    averageSimulationsPerDecision: summary.decisions > 0 ? summary.simulations / summary.decisions : 0,
    medianSimulationsPerDecision: percentile(summary.decisionSimulations, 0.5),
    p95SimulationsPerDecision: percentile(summary.decisionSimulations, 0.95),
    averageMsPerDecision: summary.decisions > 0 ? summary.elapsedMs / summary.decisions : 0,
    p50LatencyMs: percentile(summary.decisionLatenciesMs, 0.5),
    p95LatencyMs: percentile(summary.decisionLatenciesMs, 0.95),
    p99LatencyMs: percentile(summary.decisionLatenciesMs, 0.99),
    maxLatencyMs: summary.decisionLatenciesMs.length > 0 ? Math.max(...summary.decisionLatenciesMs) : 0,
    reuseRate: summary.decisions > 0 ? summary.reusedDecisions / summary.decisions : 0,
  };
}

function emptySearchSummary(): SearchSummary {
  return {
    decisions: 0,
    simulations: 0,
    expandedNodes: 0,
    maxTreeDepth: 0,
    elapsedMs: 0,
    decisionLatenciesMs: [],
    decisionSimulations: [],
    reusedDecisions: 0,
    reusedRootVisits: 0,
    cycleCutoffs: 0,
    solvedRoots: 0,
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

function readStage(name: string): StageId {
  const value = stringArg(name) ?? "stage2";
  if (value === "stage1" || value === "stage2" || value === "stage3") return value;
  throw new Error(`${name} must be stage1|stage2|stage3`);
}

function readEngine(name: string, fallback: EngineId): EngineId {
  const value = stringArg(name) ?? fallback;
  if (value === "puct-v2" || value === "puct-v3a") return value;
  throw new Error(`${name} must be puct-v2|puct-v3a`);
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
