import { writeFileSync } from "node:fs";
import { applyMove, createInitialState } from "../engine.js";
import { chooseMctsMove, type MctsDecision } from "../research/mcts.js";
import { parseClassicOpening } from "../research/opening-pie-analysis.js";
import {
  PRODUCTION_SOURCE_COMMIT,
  chooseServerProductionMove,
} from "../reference/server-production-ai.js";
import { PRODUCTION_TOP_PROFILES, type ProductionTopDifficulty } from "../reference/production-ai.js";
import type { PlayerId, PlayerMove } from "../types.js";

type OpponentId = "uct-pb" | ProductionTopDifficulty;
type Score = 0 | 0.5 | 1;
type SearchSummary = {
  decisions: number;
  simulations: number;
  expandedNodes: number;
  maxTreeDepth: number;
  elapsedMs: number;
  rootEntropyTotal: number;
  effectiveRootBranchingTotal: number;
  rootEdges: number;
};
type GameResult = {
  opening: string;
  pair: number;
  researchSeat: PlayerId;
  winner: PlayerId | null;
  unresolved: boolean;
  moves: number;
  researchScore: Score | null;
};
type OpeningAggregate = {
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

const opponent = readOpponent();
const openings = readOpenings();
const pairsPerOpening = intArg("--pairs", 1);
const simulations = intArg("--simulations", 100_000);
const rolloutDepth = intArg("--rollout-depth", 20);
const maxMoves = intArg("--max-moves", 160);
const puctExploration = numberArg("--cpuct", 1.5);
const policyTemperature = numberArg("--policy-temperature", 0.35);
const seedBase = intArg("--seed", 20260911);
const outPath = stringArg("--out");
const productionProfile = opponent === "uct-pb" ? null : PRODUCTION_TOP_PROFILES[opponent];
const researchTimeBudgetMs = intArg("--research-ms", productionProfile?.timeBudgetMs ?? 600);
const opponentTimeBudgetMs = intArg("--opponent-ms", productionProfile?.timeBudgetMs ?? researchTimeBudgetMs);
const opponentNodeBudget = intArg("--opponent-nodes", productionProfile?.nodeBudget ?? 100_000);

const started = performance.now();
const aggregate = emptyOpeningAggregate();
const perOpening: Record<string, OpeningAggregate> = {};
const details: GameResult[] = [];
const researchSearch = emptySearchSummary();
const opponentSearch = opponent === "uct-pb" ? emptySearchSummary() : null;

for (const opening of openings) {
  const openingKey = `${opening.pit}:${opening.dir}`;
  const openingAggregate = emptyOpeningAggregate();
  perOpening[openingKey] = openingAggregate;

  for (let pair = 0; pair < pairsPerOpening; pair += 1) {
    const pairResults: GameResult[] = [];
    for (const researchSeat of ["P0", "P1"] as const) {
      const seed = seedBase
        + hashString(openingKey)
        + pair * 104_729
        + (researchSeat === "P0" ? 0 : 7_919);
      const result = playGame(openingKey, pair + 1, researchSeat, seed);
      details.push(result);
      pairResults.push(result);
      recordGame(aggregate, result);
      recordGame(openingAggregate, result);
    }

    const resolved = pairResults.every((game) => !game.unresolved && game.researchScore !== null);
    if (resolved) {
      const researchPoints = pairResults.reduce((sum, game) => sum + (game.researchScore ?? 0), 0);
      const pairDiff = researchPoints - (2 - researchPoints);
      aggregate.pairDiffs.push(pairDiff);
      openingAggregate.pairDiffs.push(pairDiff);
    }
  }
}

const result = {
  matchup: `puct-hv-vs-${opponent}`,
  methodology: {
    pairedOpenings: "Each forced opening is played twice per pair with engine ownership swapped between P0 and P1.",
    purpose: "Control first-player/opening bias before attributing results to engine strength.",
    puctRootNoise: "disabled",
    pvs: "excluded from active evaluation",
    productionSourceCommit: opponent === "uct-pb" ? null : PRODUCTION_SOURCE_COMMIT,
    baselineIntegrity:
      opponent === "trang-nguyen"
        ? "code-parity-no-live-learning-snapshot"
        : opponent === "uct-pb"
          ? "research-baseline"
          : "full-code-parity",
  },
  opponent,
  openings: openings.map((opening) => `${opening.pit}:${opening.dir}`),
  pairsPerOpening,
  games: aggregate.games,
  researchWins: aggregate.researchWins,
  opponentWins: aggregate.opponentWins,
  draws: aggregate.draws,
  unresolved: aggregate.unresolved,
  p0Wins: aggregate.p0Wins,
  p1Wins: aggregate.p1Wins,
  resolvedScoreRate: aggregate.resolvedGames > 0 ? aggregate.researchPoints / aggregate.resolvedGames : 0,
  completedPairs: aggregate.pairDiffs.length,
  meanPairPointDifferential:
    aggregate.pairDiffs.length > 0
      ? aggregate.pairDiffs.reduce((sum, value) => sum + value, 0) / aggregate.pairDiffs.length
      : null,
  perOpening: Object.fromEntries(
    Object.entries(perOpening).map(([key, value]) => [key, summarizeOpening(value)]),
  ),
  searchDiagnostics: {
    puct: summarizeSearch(researchSearch),
    opponent: opponentSearch ? summarizeSearch(opponentSearch) : null,
  },
  elapsedMs: performance.now() - started,
  config: {
    simulations,
    rolloutDepth,
    researchTimeBudgetMs,
    opponentTimeBudgetMs,
    opponentNodeBudget,
    puctExploration,
    policyTemperature,
    maxMoves,
    seed: seedBase,
  },
  details,
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function playGame(openingKey: string, pair: number, researchSeat: PlayerId, seed: number): GameResult {
  const opening = parseClassicOpening(openingKey);
  const initial = createInitialState();
  const forced = applyMove(initial, opening);
  if (!forced.ok) throw new Error(`Failed forced opening ${openingKey}: ${forced.error}`);
  let state = forced.state;

  const researchRandom = mulberry32(seed ^ 0x9e3779b9);
  const opponentRandom = mulberry32(seed ^ 0x85ebca6b);

  while (state.status === "playing" && state.moveNumber < maxMoves) {
    const player = state.currentPlayer;
    let move: PlayerMove | null = null;

    if (player === researchSeat) {
      const decision = chooseMctsMove(state, {
        variant: "puct-hv",
        simulations,
        timeBudgetMs: researchTimeBudgetMs,
        rolloutDepth,
        puctExploration,
        policyTemperature,
        random: researchRandom,
      });
      recordDecision(researchSearch, decision);
      move = decision.move;
    } else if (opponent === "uct-pb") {
      const decision = chooseMctsMove(state, {
        variant: "uct-pb",
        simulations,
        timeBudgetMs: opponentTimeBudgetMs,
        rolloutDepth,
        random: opponentRandom,
      });
      recordDecision(opponentSearch as SearchSummary, decision);
      move = decision.move;
    } else {
      const productionMove = chooseServerProductionMove(state, opponent, player, {
        mode: "production-max",
        timeBudgetMs: opponentTimeBudgetMs,
        nodeBudget: opponentNodeBudget,
        random: opponentRandom,
      });
      move = productionMove ? { player, ...productionMove } : null;
    }

    if (!move) {
      return {
        opening: openingKey,
        pair,
        researchSeat,
        winner: null,
        unresolved: true,
        moves: state.moveNumber,
        researchScore: null,
      };
    }
    const applied = applyMove(state, move);
    if (!applied.ok) throw new Error(`Illegal ${player} move ${move.pit}:${move.dir}: ${applied.error}`);
    state = applied.state;
  }

  if (state.status !== "finished") {
    return {
      opening: openingKey,
      pair,
      researchSeat,
      winner: null,
      unresolved: true,
      moves: state.moveNumber,
      researchScore: null,
    };
  }

  const researchScore: Score = state.winner === null ? 0.5 : state.winner === researchSeat ? 1 : 0;
  return {
    opening: openingKey,
    pair,
    researchSeat,
    winner: state.winner,
    unresolved: false,
    moves: state.moveNumber,
    researchScore,
  };
}

function recordDecision(summary: SearchSummary, decision: MctsDecision): void {
  summary.decisions += 1;
  summary.simulations += decision.diagnostics.simulations;
  summary.expandedNodes += decision.diagnostics.expandedNodes;
  summary.maxTreeDepth = Math.max(summary.maxTreeDepth, decision.diagnostics.maxTreeDepth);
  summary.elapsedMs += decision.diagnostics.elapsedMs;
  summary.rootEdges += decision.rootStats.length;

  const totalVisits = decision.rootStats.reduce((sum, stat) => sum + stat.visits, 0);
  let entropy = 0;
  if (totalVisits > 0) {
    for (const stat of decision.rootStats) {
      if (stat.visits <= 0) continue;
      const probability = stat.visits / totalVisits;
      entropy -= probability * Math.log(probability);
    }
  }
  summary.rootEntropyTotal += entropy;
  summary.effectiveRootBranchingTotal += Math.exp(entropy);
}

function recordGame(target: OpeningAggregate, game: GameResult): void {
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

function summarizeOpening(value: OpeningAggregate) {
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
    meanPairPointDifferential:
      value.pairDiffs.length > 0
        ? value.pairDiffs.reduce((sum, item) => sum + item, 0) / value.pairDiffs.length
        : null,
  };
}

function summarizeSearch(value: SearchSummary) {
  return {
    decisions: value.decisions,
    simulations: value.simulations,
    expandedNodes: value.expandedNodes,
    maxTreeDepth: value.maxTreeDepth,
    elapsedMs: value.elapsedMs,
    averageSimulationsPerDecision: value.decisions > 0 ? value.simulations / value.decisions : 0,
    averageExpandedNodesPerDecision: value.decisions > 0 ? value.expandedNodes / value.decisions : 0,
    averageRootEntropy: value.decisions > 0 ? value.rootEntropyTotal / value.decisions : 0,
    averageEffectiveRootBranching: value.decisions > 0 ? value.effectiveRootBranchingTotal / value.decisions : 0,
    averageRootEdges: value.decisions > 0 ? value.rootEdges / value.decisions : 0,
    millisecondsPerSimulation: value.simulations > 0 ? value.elapsedMs / value.simulations : 0,
  };
}

function emptyOpeningAggregate(): OpeningAggregate {
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
    rootEntropyTotal: 0,
    effectiveRootBranchingTotal: 0,
    rootEdges: 0,
  };
}

function readOpponent(): OpponentId {
  const value = stringArg("--opponent") ?? "uct-pb";
  if (value === "uct-pb" || value === "tham-hoa" || value === "bang-nhan" || value === "trang-nguyen") {
    return value;
  }
  throw new Error(`Unknown opponent: ${value}`);
}

function readOpenings(): PlayerMove[] {
  const raw = stringArg("--openings") ?? "B3:CW,B3:CCW";
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length === 0) throw new Error("--openings must contain at least one opening");
  return values.map(parseClassicOpening);
}

function stringArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function intArg(name: string, fallback: number): number {
  const raw = stringArg(name);
  if (raw === null) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function numberArg(name: string, fallback: number): number {
  const raw = stringArg(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
