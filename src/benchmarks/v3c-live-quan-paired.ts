import { writeFileSync } from "node:fs";
import { applyMove } from "../engine.js";
import { ReusableScoreBoundedPuct, type PuctV3ADecision } from "../research/puct-v3a.js";
import { PnSumPuctV3C, type PuctV3CDecision } from "../research/puct-v3c.js";
import {
  LIVE_QUAN_BALANCED_POSITIONS,
  replayLiveQuanPosition,
  type LiveQuanPosition,
} from "../research/v3-live-quan-corpus.js";
import type { PlayerId, PlayerMove } from "../types.js";

type Score = 0 | 0.5 | 1;
type ResearchVariant = "v3c" | "v3a";

type GameResult = {
  position: string;
  source: string;
  prefixDepth: number;
  pair: number;
  researchSeat: PlayerId;
  winner: PlayerId | null;
  unresolved: boolean;
  finalMoveNumber: number;
  continuationMoves: number;
  researchScore: Score | null;
};

type Aggregate = {
  games: number;
  researchWins: number;
  opponentWins: number;
  draws: number;
  unresolved: number;
  p0Wins: number;
  p1Wins: number;
  researchPoints: number;
  resolvedGames: number;
  pairDiffs: number[];
};

type SearchSummary = {
  decisions: number;
  simulations: number;
  expandedNodes: number;
  maxTreeDepth: number;
  elapsedMs: number;
  reusedDecisions: number;
  reusedRootVisits: number;
  cycleCutoffs: number;
  solvedRoots: number;
  proofBiasSelections: number;
};

const researchVariant = variantArg("--research", "v3c");
const pairsPerPosition = intArg("--pairs", 1);
const simulations = intArg("--simulations", 4_000);
const additionalMaxMoves = intArg("--additional-max-moves", 160);
const puctExploration = positiveNumberArg("--cpuct", 1.5);
const policyTemperature = positiveNumberArg("--policy-temperature", 0.6);
const proofBias = nonNegativeNumberArg("--cpn", 0.05);
const researchTimeBudgetMs = optionalPositiveIntArg("--research-ms");
const opponentTimeBudgetMs = optionalPositiveIntArg("--opponent-ms") ?? researchTimeBudgetMs;
const outPath = stringArg("--out");

const aggregate = emptyAggregate();
const perPosition: Record<string, Aggregate> = {};
const details: GameResult[] = [];
const researchSearch = emptySearchSummary();
const opponentSearch = emptySearchSummary();
const started = performance.now();

for (const position of LIVE_QUAN_BALANCED_POSITIONS) {
  const positionAggregate = emptyAggregate();
  perPosition[position.id] = positionAggregate;

  for (let pair = 0; pair < pairsPerPosition; pair += 1) {
    const pairResults: GameResult[] = [];
    for (const researchSeat of ["P0", "P1"] as const) {
      const result = playGame(position, pair + 1, researchSeat);
      details.push(result);
      pairResults.push(result);
      recordGame(aggregate, result);
      recordGame(positionAggregate, result);
    }

    if (pairResults.every((game) => !game.unresolved && game.researchScore !== null)) {
      const researchPoints = pairResults.reduce((sum, game) => sum + (game.researchScore ?? 0), 0);
      const pairDiff = researchPoints - (2 - researchPoints);
      aggregate.pairDiffs.push(pairDiff);
      positionAggregate.pairDiffs.push(pairDiff);
    }
  }
}

const result = {
  matchup: researchVariant === "v3c" ? "puct-v3c-vs-puct-v3a" : "puct-v3a-vs-puct-v3a",
  methodology: {
    ruleset: "classic_v1 / standard_v1",
    corpus: "deterministic balanced early/midgame states with both Quan alive, depths 4-11",
    pairedPositions: "Each exact live-Quan state is played twice with research/opponent engine ownership swapped between P0 and P1.",
    moveCap: `${additionalMaxMoves} additional plies after each forced live-Quan prefix`,
    unresolvedPolicy: "censored; never heuristic-adjudicated",
    primaryMetric: "swapped-pair point differential",
    timingMode: researchTimeBudgetMs == null ? "fixed-simulations" : "wall-clock",
    puctRootNoise: "disabled",
    pieRule: "disabled",
    threefoldDraw: "disabled",
    pvs: "excluded",
    excludedProfiles: ["tham-hoa", "bang-nhan"],
  },
  research: researchVariant === "v3c" ? "puct-v3c-pnsum" : "puct-v3a-null-control",
  opponent: "puct-v3a",
  positionCount: LIVE_QUAN_BALANCED_POSITIONS.length,
  positions: LIVE_QUAN_BALANCED_POSITIONS.map((position) => ({
    id: position.id,
    opening: position.opening,
    depth: position.depth,
    scoreDiff: position.scoreDiff,
    danMaterialDiff: position.danMaterialDiff,
    nonEmptyPitDiff: position.nonEmptyPitDiff,
    legalMoves: position.legalMoves,
  })),
  pairsPerPosition,
  games: aggregate.games,
  researchWins: aggregate.researchWins,
  opponentWins: aggregate.opponentWins,
  draws: aggregate.draws,
  unresolved: aggregate.unresolved,
  p0Wins: aggregate.p0Wins,
  p1Wins: aggregate.p1Wins,
  resolvedScoreRate: aggregate.resolvedGames > 0 ? aggregate.researchPoints / aggregate.resolvedGames : 0,
  completedPairs: aggregate.pairDiffs.length,
  meanPairPointDifferential: mean(aggregate.pairDiffs),
  favorablePairs: aggregate.pairDiffs.filter((value) => value > 0).length,
  neutralPairs: aggregate.pairDiffs.filter((value) => value === 0).length,
  unfavorablePairs: aggregate.pairDiffs.filter((value) => value < 0).length,
  pairDiffs: aggregate.pairDiffs,
  perPosition: Object.fromEntries(
    Object.entries(perPosition).map(([key, value]) => [key, summarizeAggregate(value)]),
  ),
  searchDiagnostics: {
    research: summarizeSearch(researchSearch),
    opponent: summarizeSearch(opponentSearch),
  },
  elapsedMs: performance.now() - started,
  config: {
    simulations,
    puctExploration,
    policyTemperature,
    proofBias: researchVariant === "v3c" ? proofBias : null,
    researchTimeBudgetMs: researchTimeBudgetMs ?? null,
    opponentTimeBudgetMs: opponentTimeBudgetMs ?? null,
    additionalMaxMoves,
  },
  details,
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function playGame(
  position: LiveQuanPosition,
  pair: number,
  researchSeat: PlayerId,
): GameResult {
  let state = replayLiveQuanPosition(position);
  const startMoveNumber = state.moveNumber;
  const moveLimit = startMoveNumber + additionalMaxMoves;
  const researchV3C = researchVariant === "v3c" ? new PnSumPuctV3C() : null;
  const researchV3A = researchVariant === "v3a" ? new ReusableScoreBoundedPuct() : null;
  const opponentEngine = new ReusableScoreBoundedPuct();

  while (state.status === "playing" && state.moveNumber < moveLimit) {
    const player = state.currentPlayer;
    let move: PlayerMove | null;

    if (player === researchSeat) {
      if (researchV3C) {
        const decision = researchV3C.chooseMove(state, {
          simulations,
          ...(researchTimeBudgetMs == null ? {} : { timeBudgetMs: researchTimeBudgetMs }),
          puctExploration,
          policyTemperature,
          proofBias,
        });
        recordV3CDecision(researchSearch, decision);
        move = decision.move;
      } else if (researchV3A) {
        const decision = researchV3A.chooseMove(state, {
          simulations,
          ...(researchTimeBudgetMs == null ? {} : { timeBudgetMs: researchTimeBudgetMs }),
          puctExploration,
          policyTemperature,
        });
        recordV3ADecision(researchSearch, decision);
        move = decision.move;
      } else {
        throw new Error("Missing research engine");
      }
    } else {
      const decision = opponentEngine.chooseMove(state, {
        simulations,
        ...(opponentTimeBudgetMs == null ? {} : { timeBudgetMs: opponentTimeBudgetMs }),
        puctExploration,
        policyTemperature,
      });
      recordV3ADecision(opponentSearch, decision);
      move = decision.move;
    }

    if (!move) return unresolvedResult(position, pair, researchSeat, state.moveNumber, startMoveNumber);
    const applied = applyMove(state, move);
    if (!applied.ok) throw new Error(`Illegal ${player} move ${move.pit}:${move.dir}: ${applied.error}`);
    state = applied.state;
  }

  if (state.status !== "finished") {
    return unresolvedResult(position, pair, researchSeat, state.moveNumber, startMoveNumber);
  }

  const researchScore: Score = state.winner === null ? 0.5 : state.winner === researchSeat ? 1 : 0;
  return {
    position: position.id,
    source: position.opening,
    prefixDepth: position.depth,
    pair,
    researchSeat,
    winner: state.winner,
    unresolved: false,
    finalMoveNumber: state.moveNumber,
    continuationMoves: state.moveNumber - startMoveNumber,
    researchScore,
  };
}

function recordV3CDecision(summary: SearchSummary, decision: PuctV3CDecision): void {
  recordSearch(
    summary,
    decision.diagnostics.simulations,
    decision.diagnostics.expandedNodes,
    decision.diagnostics.maxTreeDepth,
    decision.diagnostics.elapsedMs,
    decision.diagnostics.reusedRoot,
    decision.diagnostics.reusedRootVisits,
    decision.diagnostics.cycleCutoffs,
    decision.diagnostics.solvedRoot !== null,
  );
  summary.proofBiasSelections += decision.diagnostics.proofBiasSelections;
}

function recordV3ADecision(summary: SearchSummary, decision: PuctV3ADecision): void {
  recordSearch(
    summary,
    decision.diagnostics.simulations,
    decision.diagnostics.expandedNodes,
    decision.diagnostics.maxTreeDepth,
    decision.diagnostics.elapsedMs,
    decision.diagnostics.reusedRoot,
    decision.diagnostics.reusedRootVisits,
    decision.diagnostics.cycleCutoffs,
    decision.diagnostics.solvedRoot !== null,
  );
}

function recordSearch(
  summary: SearchSummary,
  simulationCount: number,
  expandedNodes: number,
  maxTreeDepth: number,
  elapsedMs: number,
  reusedRoot: boolean,
  reusedRootVisits: number,
  cycleCutoffs: number,
  solvedRoot: boolean,
): void {
  summary.decisions += 1;
  summary.simulations += simulationCount;
  summary.expandedNodes += expandedNodes;
  summary.maxTreeDepth = Math.max(summary.maxTreeDepth, maxTreeDepth);
  summary.elapsedMs += elapsedMs;
  if (reusedRoot) summary.reusedDecisions += 1;
  summary.reusedRootVisits += reusedRootVisits;
  summary.cycleCutoffs += cycleCutoffs;
  if (solvedRoot) summary.solvedRoots += 1;
}

function recordGame(target: Aggregate, game: GameResult): void {
  target.games += 1;
  if (game.unresolved || game.researchScore === null) {
    target.unresolved += 1;
    return;
  }
  target.resolvedGames += 1;
  target.researchPoints += game.researchScore;
  if (game.winner === null) {
    target.draws += 1;
    return;
  }
  if (game.winner === "P0") target.p0Wins += 1;
  else target.p1Wins += 1;
  if (game.winner === game.researchSeat) target.researchWins += 1;
  else target.opponentWins += 1;
}

function unresolvedResult(
  position: LiveQuanPosition,
  pair: number,
  researchSeat: PlayerId,
  finalMoveNumber: number,
  startMoveNumber: number,
): GameResult {
  return {
    position: position.id,
    source: position.opening,
    prefixDepth: position.depth,
    pair,
    researchSeat,
    winner: null,
    unresolved: true,
    finalMoveNumber,
    continuationMoves: finalMoveNumber - startMoveNumber,
    researchScore: null,
  };
}

function summarizeAggregate(value: Aggregate) {
  return {
    games: value.games,
    researchWins: value.researchWins,
    opponentWins: value.opponentWins,
    draws: value.draws,
    unresolved: value.unresolved,
    p0Wins: value.p0Wins,
    p1Wins: value.p1Wins,
    resolvedScoreRate: value.resolvedGames > 0 ? value.researchPoints / value.resolvedGames : 0,
    completedPairs: value.pairDiffs.length,
    meanPairPointDifferential: mean(value.pairDiffs),
    favorablePairs: value.pairDiffs.filter((entry) => entry > 0).length,
    neutralPairs: value.pairDiffs.filter((entry) => entry === 0).length,
    unfavorablePairs: value.pairDiffs.filter((entry) => entry < 0).length,
    pairDiffs: value.pairDiffs,
  };
}

function summarizeSearch(value: SearchSummary) {
  return {
    ...value,
    averageSimulationsPerDecision: value.decisions > 0 ? value.simulations / value.decisions : 0,
    averageExpandedNodesPerDecision: value.decisions > 0 ? value.expandedNodes / value.decisions : 0,
    millisecondsPerSimulation: value.simulations > 0 ? value.elapsedMs / value.simulations : 0,
    reuseRate: value.decisions > 0 ? value.reusedDecisions / value.decisions : 0,
  };
}

function emptyAggregate(): Aggregate {
  return {
    games: 0,
    researchWins: 0,
    opponentWins: 0,
    draws: 0,
    unresolved: 0,
    p0Wins: 0,
    p1Wins: 0,
    researchPoints: 0,
    resolvedGames: 0,
    pairDiffs: [],
  };
}

function emptySearchSummary(): SearchSummary {
  return {
    decisions: 0,
    simulations: 0,
    expandedNodes: 0,
    maxTreeDepth: 0,
    elapsedMs: 0,
    reusedDecisions: 0,
    reusedRootVisits: 0,
    cycleCutoffs: 0,
    solvedRoots: 0,
    proofBiasSelections: 0,
  };
}

function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function stringArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function intArg(name: string, fallback: number): number {
  const raw = stringArg(name);
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function optionalPositiveIntArg(name: string): number | undefined {
  const raw = stringArg(name);
  if (raw === undefined) return undefined;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function positiveNumberArg(name: string, fallback: number): number {
  const raw = stringArg(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be > 0`);
  return value;
}

function nonNegativeNumberArg(name: string, fallback: number): number {
  const raw = stringArg(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and >= 0`);
  return value;
}

function variantArg(name: string, fallback: ResearchVariant): ResearchVariant {
  const raw = stringArg(name);
  if (raw === undefined) return fallback;
  if (raw !== "v3c" && raw !== "v3a") throw new Error(`${name} must be v3c or v3a`);
  return raw;
}
