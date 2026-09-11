import { writeFileSync } from "node:fs";
import { applyMove, createInitialState, getLegalMoves } from "../engine.js";
import { ReusableScoreBoundedPuct, type PuctV3ADecision } from "../research/puct-v3a.js";
import { GpnPuctV3B, type PuctV3BDecision } from "../research/puct-v3b.js";
import { parseClassicOpening } from "../research/opening-pie-analysis.js";
import type { PlayerId, PlayerMove } from "../types.js";

type Score = 0 | 0.5 | 1;

type ForcedPosition = {
  label: string;
  openingKey: string;
  moves: PlayerMove[];
};

type GameResult = {
  opening: string;
  position: string;
  pair: number;
  researchSeat: PlayerId;
  winner: PlayerId | null;
  unresolved: boolean;
  moves: number;
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

const openings = readOpenings();
const replyCorpus = hasFlag("--reply-corpus");
const positions = buildPositions(openings, replyCorpus);
const pairsPerPosition = intArg("--pairs", 1);
const simulations = intArg("--simulations", 100_000);
const maxMoves = intArg("--max-moves", 160);
const puctExploration = positiveNumberArg("--cpuct", 1.5);
const policyTemperature = positiveNumberArg("--policy-temperature", 0.6);
const proofBias = nonNegativeNumberArg("--cpn", 0.1);
const researchTimeBudgetMs = intArg("--research-ms", 600);
const opponentTimeBudgetMs = intArg("--opponent-ms", researchTimeBudgetMs);
const seed = intArg("--seed", 20260911);
const outPath = stringArg("--out");

const started = performance.now();
const aggregate = emptyAggregate();
const perOpening: Record<string, Aggregate> = {};
const perPosition: Record<string, Aggregate> = {};
const details: GameResult[] = [];
const researchSearch = emptySearchSummary();
const opponentSearch = emptySearchSummary();

for (const opening of openings) perOpening[`${opening.pit}:${opening.dir}`] = emptyAggregate();

for (const position of positions) {
  const positionAggregate = emptyAggregate();
  perPosition[position.label] = positionAggregate;
  const openingAggregate = perOpening[position.openingKey];
  if (!openingAggregate) throw new Error(`Missing aggregate for ${position.openingKey}`);

  for (let pair = 0; pair < pairsPerPosition; pair += 1) {
    const pairResults: GameResult[] = [];
    for (const researchSeat of ["P0", "P1"] as const) {
      const result = playGame(position, pair + 1, researchSeat);
      details.push(result);
      pairResults.push(result);
      recordGame(aggregate, result);
      recordGame(openingAggregate, result);
      recordGame(positionAggregate, result);
    }

    if (pairResults.every((game) => !game.unresolved && game.researchScore !== null)) {
      const researchPoints = pairResults.reduce((sum, game) => sum + (game.researchScore ?? 0), 0);
      const pairDiff = researchPoints - (2 - researchPoints);
      aggregate.pairDiffs.push(pairDiff);
      openingAggregate.pairDiffs.push(pairDiff);
      positionAggregate.pairDiffs.push(pairDiff);
    }
  }
}

const result = {
  matchup: "puct-v3b-vs-puct-v3a",
  methodology: {
    pairedPositions: "Each forced prefix is played twice with V3B/V3A ownership swapped between P0 and P1.",
    positionMode: replyCorpus ? "opening-plus-all-legal-replies" : "opening",
    purpose: "Direct V3B ablation: isolate PNMax/GPN selection bias on top of frozen V3A.",
    puctRootNoise: "disabled",
    proofNumberPolicy: "per-player generalized proof numbers; cycle-cut simulations never propagate proof evidence",
    pvs: "excluded from active evaluation",
    excludedProfiles: ["tham-hoa", "bang-nhan"],
  },
  research: "puct-v3b",
  opponent: "puct-v3a",
  openings: openings.map((opening) => `${opening.pit}:${opening.dir}`),
  positions: positions.map((position) => position.label),
  positionCount: positions.length,
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
  perOpening: Object.fromEntries(Object.entries(perOpening).map(([key, value]) => [key, summarizeAggregate(value)])),
  perPosition: Object.fromEntries(Object.entries(perPosition).map(([key, value]) => [key, summarizeAggregate(value)])),
  searchDiagnostics: {
    research: summarizeSearch(researchSearch),
    opponent: summarizeSearch(opponentSearch),
  },
  elapsedMs: performance.now() - started,
  config: {
    simulations,
    researchTimeBudgetMs,
    opponentTimeBudgetMs,
    puctExploration,
    policyTemperature,
    proofBias,
    maxMoves,
    seed,
  },
  details,
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function playGame(position: ForcedPosition, pair: number, researchSeat: PlayerId): GameResult {
  let state = createInitialState();
  for (const forcedMove of position.moves) {
    const forced = applyMove(state, forcedMove);
    if (!forced.ok) throw new Error(`Failed forced prefix ${position.label}: ${forced.error}`);
    state = forced.state;
  }

  const researchEngine = new GpnPuctV3B();
  const opponentEngine = new ReusableScoreBoundedPuct();

  while (state.status === "playing" && state.moveNumber < maxMoves) {
    const player = state.currentPlayer;
    let move: PlayerMove | null;

    if (player === researchSeat) {
      const decision = researchEngine.chooseMove(state, {
        simulations,
        timeBudgetMs: researchTimeBudgetMs,
        puctExploration,
        policyTemperature,
        proofBias,
      });
      recordV3BDecision(researchSearch, decision);
      move = decision.move;
    } else {
      const decision = opponentEngine.chooseMove(state, {
        simulations,
        timeBudgetMs: opponentTimeBudgetMs,
        puctExploration,
        policyTemperature,
      });
      recordV3ADecision(opponentSearch, decision);
      move = decision.move;
    }

    if (!move) return unresolvedResult(position, pair, researchSeat, state.moveNumber);
    const applied = applyMove(state, move);
    if (!applied.ok) throw new Error(`Illegal ${player} move ${move.pit}:${move.dir}: ${applied.error}`);
    state = applied.state;
  }

  if (state.status !== "finished") return unresolvedResult(position, pair, researchSeat, state.moveNumber);
  const researchScore: Score = state.winner === null ? 0.5 : state.winner === researchSeat ? 1 : 0;
  return {
    opening: position.openingKey,
    position: position.label,
    pair,
    researchSeat,
    winner: state.winner,
    unresolved: false,
    moves: state.moveNumber,
    researchScore,
  };
}

function buildPositions(selectedOpenings: PlayerMove[], includeReplies: boolean): ForcedPosition[] {
  const built: ForcedPosition[] = [];
  for (const opening of selectedOpenings) {
    const openingKey = `${opening.pit}:${opening.dir}`;
    if (!includeReplies) {
      built.push({ label: openingKey, openingKey, moves: [opening] });
      continue;
    }
    const opened = applyMove(createInitialState(), opening);
    if (!opened.ok) throw new Error(`Failed forced opening ${openingKey}: ${opened.error}`);
    const replies = opened.state.status === "playing" ? getLegalMoves(opened.state) : [];
    if (replies.length === 0) {
      built.push({ label: openingKey, openingKey, moves: [opening] });
      continue;
    }
    for (const reply of replies) {
      built.push({ label: `${openingKey}>${reply.pit}:${reply.dir}`, openingKey, moves: [opening, reply] });
    }
  }
  return built;
}

function recordV3BDecision(summary: SearchSummary, decision: PuctV3BDecision): void {
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
  if (game.winner === null) target.draws += 1;
  else {
    if (game.winner === "P0") target.p0Wins += 1;
    else target.p1Wins += 1;
    if (game.winner === game.researchSeat) target.researchWins += 1;
    else target.opponentWins += 1;
  }
}

function unresolvedResult(position: ForcedPosition, pair: number, researchSeat: PlayerId, moves: number): GameResult {
  return {
    opening: position.openingKey,
    position: position.label,
    pair,
    researchSeat,
    winner: null,
    unresolved: true,
    moves,
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

function readOpenings(): PlayerMove[] {
  const raw = stringArg("--openings") ?? "B3:CW,B3:CCW";
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length === 0) throw new Error("--openings must include at least one opening");
  return values.map((value) => parseClassicOpening(value));
}

function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
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
