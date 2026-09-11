import { writeFileSync } from "node:fs";
import { applyMove, createInitialState, getLegalMoves } from "../engine.js";
import { chooseMctsMove, type MctsDecision } from "../research/mcts.js";
import { ReusableScoreBoundedPuct, type PuctV3ADecision } from "../research/puct-v3a.js";
import { parseClassicOpening } from "../research/opening-pie-analysis.js";
import { PRODUCTION_SOURCE_COMMIT, chooseServerProductionMove } from "../reference/server-production-ai.js";
import { PRODUCTION_TOP_PROFILES } from "../reference/production-ai.js";
import type { PlayerId, PlayerMove } from "../types.js";

type ResearchId = "puct-v2" | "puct-v3a";
type OpponentId = "puct-v2" | "uct-pb" | "trang-nguyen";
type Score = 0 | 0.5 | 1;

type ForcedPosition = {
  label: string;
  openingKey: string;
  moves: PlayerMove[];
};

type SearchSummary = {
  decisions: number;
  simulations: number;
  expandedNodes: number;
  maxTreeDepth: number;
  elapsedMs: number;
  rootEntropyTotal: number;
  effectiveRootBranchingTotal: number;
  rootEdges: number;
  reusedDecisions: number;
  reusedRootVisits: number;
  cycleCutoffs: number;
  solvedRoots: number;
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

const research = readResearch();
const opponent = readOpponent();
const openings = readOpenings();
const replyCorpus = hasFlag("--reply-corpus");
const positions = buildPositions(openings, replyCorpus);
const pairsPerPosition = intArg("--pairs", 1);
const simulations = intArg("--simulations", 100_000);
const rolloutDepth = intArg("--rollout-depth", 20);
const maxMoves = intArg("--max-moves", 160);
const puctExploration = numberArg("--cpuct", 1.5);
const policyTemperature = numberArg("--policy-temperature", 0.6);
const seedBase = intArg("--seed", 20260911);
const outPath = stringArg("--out");
const productionProfile = opponent === "trang-nguyen" ? PRODUCTION_TOP_PROFILES["trang-nguyen"] : null;
const researchTimeBudgetMs = intArg("--research-ms", productionProfile?.timeBudgetMs ?? 600);
const opponentTimeBudgetMs = intArg("--opponent-ms", productionProfile?.timeBudgetMs ?? researchTimeBudgetMs);
const opponentNodeBudget = intArg("--opponent-nodes", productionProfile?.nodeBudget ?? 100_000);

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
      const seed = seedBase + hashString(position.label) + pair * 104_729 + (researchSeat === "P0" ? 0 : 7_919);
      const result = playGame(position, pair + 1, researchSeat, seed);
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
  matchup: `${research}-vs-${opponent}`,
  methodology: {
    pairedPositions: "Each forced prefix is played twice with research/opponent ownership swapped between P0 and P1.",
    positionMode: replyCorpus ? "opening-plus-all-legal-replies" : "opening",
    purpose: research === "puct-v2" && opponent === "puct-v2"
      ? "PUCT mirror null-control: quantify residual seat/corpus bias when both engines are identical."
      : opponent === "puct-v2"
        ? "Direct ablation against the frozen PUCT V2 baseline; isolates V3A tree reuse + score-bounded terminal propagation."
        : "Diversified external strength check after the direct PUCT ablation.",
    puctRootNoise: "disabled",
    pvs: "excluded from active evaluation",
    excludedProfiles: ["tham-hoa", "bang-nhan"],
    cyclePolicy: "Repeated strategic states are never adjudicated as draw/win/loss by V3A.",
    productionSourceCommit: opponent === "trang-nguyen" ? PRODUCTION_SOURCE_COMMIT : null,
    baselineIntegrity: opponent === "trang-nguyen" ? "code-parity-no-live-learning-snapshot" : "research-baseline",
  },
  research,
  opponent,
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

function playGame(position: ForcedPosition, pair: number, researchSeat: PlayerId, seed: number): GameResult {
  let state = createInitialState();
  for (const forcedMove of position.moves) {
    const forced = applyMove(state, forcedMove);
    if (!forced.ok) throw new Error(`Failed forced prefix ${position.label}: ${forced.error}`);
    state = forced.state;
  }

  const researchV3 = research === "puct-v3a" ? new ReusableScoreBoundedPuct() : null;
  const opponentV3 = null;
  void opponentV3;
  const researchRandom = mulberry32(seed ^ 0x9e3779b9);
  const opponentRandom = mulberry32(seed ^ 0x85ebca6b);

  while (state.status === "playing" && state.moveNumber < maxMoves) {
    const player = state.currentPlayer;
    let move: PlayerMove | null = null;

    if (player === researchSeat) {
      if (researchV3) {
        const decision = researchV3.chooseMove(state, {
          simulations,
          timeBudgetMs: researchTimeBudgetMs,
          puctExploration,
          policyTemperature,
        });
        recordV3Decision(researchSearch, decision);
        move = decision.move;
      } else {
        const decision = choosePuctV2(state, researchTimeBudgetMs, researchRandom);
        recordV2Decision(researchSearch, decision);
        move = decision.move;
      }
    } else if (opponent === "puct-v2") {
      const decision = choosePuctV2(state, opponentTimeBudgetMs, opponentRandom);
      recordV2Decision(opponentSearch, decision);
      move = decision.move;
    } else if (opponent === "uct-pb") {
      const decision = chooseMctsMove(state, {
        variant: "uct-pb",
        simulations,
        timeBudgetMs: opponentTimeBudgetMs,
        rolloutDepth,
        random: opponentRandom,
      });
      recordV2Decision(opponentSearch, decision);
      move = decision.move;
    } else {
      const productionMove = chooseServerProductionMove(state, "trang-nguyen", player, {
        mode: "production-max",
        timeBudgetMs: opponentTimeBudgetMs,
        nodeBudget: opponentNodeBudget,
        random: opponentRandom,
      });
      move = productionMove ? { player, ...productionMove } : null;
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

function choosePuctV2(state: ReturnType<typeof createInitialState>, timeBudgetMs: number, random: () => number): MctsDecision {
  return chooseMctsMove(state, {
    variant: "puct-hv",
    simulations,
    timeBudgetMs,
    rolloutDepth,
    puctExploration,
    policyTemperature,
    random,
  });
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

function recordV2Decision(summary: SearchSummary, decision: MctsDecision): void {
  recordSearch(summary, decision.diagnostics.simulations, decision.diagnostics.expandedNodes, decision.diagnostics.maxTreeDepth, decision.diagnostics.elapsedMs, decision.rootStats);
}

function recordV3Decision(summary: SearchSummary, decision: PuctV3ADecision): void {
  recordSearch(summary, decision.diagnostics.simulations, decision.diagnostics.expandedNodes, decision.diagnostics.maxTreeDepth, decision.diagnostics.elapsedMs, decision.rootStats);
  if (decision.diagnostics.reusedRoot) summary.reusedDecisions += 1;
  summary.reusedRootVisits += decision.diagnostics.reusedRootVisits;
  summary.cycleCutoffs += decision.diagnostics.cycleCutoffs;
  if (decision.diagnostics.solvedRoot !== null) summary.solvedRoots += 1;
}

function recordSearch(
  summary: SearchSummary,
  simulationCount: number,
  expandedNodes: number,
  maxTreeDepth: number,
  elapsedMs: number,
  rootStats: Array<{ visits: number }>,
): void {
  summary.decisions += 1;
  summary.simulations += simulationCount;
  summary.expandedNodes += expandedNodes;
  summary.maxTreeDepth = Math.max(summary.maxTreeDepth, maxTreeDepth);
  summary.elapsedMs += elapsedMs;
  summary.rootEdges += rootStats.length;
  const totalVisits = rootStats.reduce((sum, stat) => sum + stat.visits, 0);
  let entropy = 0;
  if (totalVisits > 0) {
    for (const stat of rootStats) {
      if (stat.visits <= 0) continue;
      const probability = stat.visits / totalVisits;
      entropy -= probability * Math.log(probability);
    }
  }
  summary.rootEntropyTotal += entropy;
  summary.effectiveRootBranchingTotal += Math.exp(entropy);
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
    pairDiffs: value.pairDiffs,
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
    reusedDecisions: value.reusedDecisions,
    reuseRate: value.decisions > 0 ? value.reusedDecisions / value.decisions : 0,
    reusedRootVisits: value.reusedRootVisits,
    cycleCutoffs: value.cycleCutoffs,
    solvedRoots: value.solvedRoots,
  };
}

function emptyAggregate(): Aggregate {
  return { games: 0, researchWins: 0, opponentWins: 0, draws: 0, unresolved: 0, p0Wins: 0, p1Wins: 0, researchPoints: 0, resolvedGames: 0, pairDiffs: [] };
}

function emptySearchSummary(): SearchSummary {
  return { decisions: 0, simulations: 0, expandedNodes: 0, maxTreeDepth: 0, elapsedMs: 0, rootEntropyTotal: 0, effectiveRootBranchingTotal: 0, rootEdges: 0, reusedDecisions: 0, reusedRootVisits: 0, cycleCutoffs: 0, solvedRoots: 0 };
}

function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function readResearch(): ResearchId {
  const value = stringArg("--research") ?? "puct-v3a";
  if (value === "puct-v2" || value === "puct-v3a") return value;
  throw new Error(`Unknown research engine: ${value}`);
}

function readOpponent(): OpponentId {
  const value = stringArg("--opponent") ?? "puct-v2";
  if (value === "puct-v2" || value === "uct-pb" || value === "trang-nguyen") return value;
  throw new Error(`Unknown opponent: ${value}. Tham Hoa and Bang Nhan are intentionally excluded.`);
}

function readOpenings(): PlayerMove[] {
  const raw = stringArg("--openings") ?? "B3:CW,B3:CCW";
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length === 0) throw new Error("--openings must include at least one opening");
  return values.map((value) => parseClassicOpening(value));
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

function numberArg(name: string, fallback: number): number {
  const raw = stringArg(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be > 0`);
  return value;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
