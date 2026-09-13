import { writeFileSync } from "node:fs";
import { applyMove, createInitialState, getLegalMoves } from "../engine.js";
import {
  chooseFrozenPuctV2,
  type PuctV2Decision,
} from "../research/puct-v2.js";
import {
  ReusableScoreBoundedPuct,
  type PuctV3ADecision,
} from "../research/puct-v3a.js";
import { parseClassicOpening } from "../research/opening-pie-analysis.js";
import type { PlayerId, PlayerMove } from "../types.js";

type EngineId = "puct-v2" | "puct-v3a";
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
  reusedDecisions: number;
  reusedRootVisits: number;
  cycleCutoffs: number;
  solvedRoots: number;
};

type GameResult = {
  position: string;
  opening: string;
  candidateSeat: PlayerId;
  winner: PlayerId | null;
  unresolved: boolean;
  moves: number;
  candidateScore: Score | null;
};

type PositionSummary = {
  games: number;
  candidateWins: number;
  baselineWins: number;
  draws: number;
  unresolved: number;
  candidatePoints: number;
  pairDiff: number | null;
};

const candidate = readEngine("--candidate", "puct-v3a");
const baseline = readEngine("--baseline", "puct-v2");
const simulations = intArg("--simulations", 4_000);
const maxMoves = intArg("--max-moves", 160);
const openings = readOpenings();
const replyCorpus = hasFlag("--reply-corpus");
const outPath = stringArg("--out");

if (simulations <= 0) throw new Error("--simulations must be > 0");
if (maxMoves <= 0) throw new Error("--max-moves must be > 0");

const positions = buildPositions(openings, replyCorpus);
const candidateSearch = emptySearchSummary();
const baselineSearch = emptySearchSummary();
const details: GameResult[] = [];
const perPosition = new Map<string, PositionSummary>();

for (const position of positions) {
  const summary = emptyPositionSummary();
  perPosition.set(position.label, summary);

  for (const candidateSeat of ["P0", "P1"] as const) {
    const game = playGame(position, candidateSeat);
    details.push(game);
    recordGame(summary, game);
  }

  if (summary.unresolved === 0 && summary.games === 2) {
    summary.pairDiff = summary.candidatePoints - (2 - summary.candidatePoints);
  }
}

const completedPairDiffs = [...perPosition.values()]
  .flatMap((entry) => entry.pairDiff === null ? [] : [entry.pairDiff]);
const favorable = completedPairDiffs.filter((value) => value > 0).length;
const neutral = completedPairDiffs.filter((value) => value === 0).length;
const unfavorable = completedPairDiffs.filter((value) => value < 0).length;
const games = details.length;
const unresolved = details.filter((game) => game.unresolved).length;
const resolved = games - unresolved;
const candidatePoints = details.reduce(
  (sum, game) => sum + (game.candidateScore ?? 0),
  0,
);

const result = {
  experiment: "R1c-stage1-direct-puct-ablation",
  evidenceClass: candidate === baseline ? "null-control" : "same-family-fixed-simulation",
  ruleset: "oaq:classic_2p:standard:v1",
  methodology: {
    candidate,
    baseline,
    deterministic: true,
    randomSeeds: "none; neither frozen V2 nor V3A consumes RNG in this harness",
    resourceMode: "fixed simulations; no wall-clock search cap",
    pairing: "Each forced position is played twice with candidate ownership swapped between P0 and P1.",
    unresolved: "Censored at maxMoves; never heuristic-adjudicated.",
    cyclePolicy: "V3A repetition is a heuristic cycle cutoff, never an automatic draw.",
    positionMode: replyCorpus ? "opening-plus-all-legal-replies" : "opening",
  },
  config: {
    simulations,
    maxMoves,
    openings: openings.map(moveKey),
    replyCorpus,
    puctExploration: 1.5,
    policyTemperature: 0.6,
  },
  positionCount: positions.length,
  positions: positions.map((position) => position.label),
  games,
  unresolved,
  unresolvedRate: games > 0 ? unresolved / games : 0,
  resolvedScoreRate: resolved > 0 ? candidatePoints / resolved : null,
  completedPairs: completedPairDiffs.length,
  meanPairDiff: mean(completedPairDiffs),
  medianPairDiff: median(completedPairDiffs),
  favorablePairs: favorable,
  neutralPairs: neutral,
  unfavorablePairs: unfavorable,
  pairDiffs: completedPairDiffs,
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

function playGame(position: ForcedPosition, candidateSeat: PlayerId): GameResult {
  let state = createInitialState();
  for (const forcedMove of position.moves) {
    const applied = applyMove(state, forcedMove);
    if (!applied.ok) {
      throw new Error(`Illegal forced prefix ${position.label}: ${applied.error}`);
    }
    state = applied.state;
  }

  const candidateV3 = candidate === "puct-v3a" ? new ReusableScoreBoundedPuct() : null;
  const baselineV3 = baseline === "puct-v3a" ? new ReusableScoreBoundedPuct() : null;

  while (state.status === "playing" && state.moveNumber < maxMoves) {
    const player = state.currentPlayer;
    const isCandidate = player === candidateSeat;
    const engine = isCandidate ? candidate : baseline;
    const summary = isCandidate ? candidateSearch : baselineSearch;
    let move: PlayerMove | null;

    if (engine === "puct-v3a") {
      const session = isCandidate ? candidateV3 : baselineV3;
      if (!session) throw new Error("Missing V3A session");
      const decision = session.chooseMove(state, {
        simulations,
        puctExploration: 1.5,
        policyTemperature: 0.6,
      });
      recordV3(summary, decision);
      move = decision.move;
    } else {
      const decision = chooseFrozenPuctV2(state, {
        simulations,
        puctExploration: 1.5,
        policyTemperature: 0.6,
      });
      recordV2(summary, decision);
      move = decision.move;
    }

    if (!move) return unresolvedResult(position, candidateSeat, state.moveNumber);
    const applied = applyMove(state, move);
    if (!applied.ok) {
      throw new Error(`Engine ${engine} produced illegal move ${move.pit}:${move.dir}: ${applied.error}`);
    }
    state = applied.state;
  }

  if (state.status !== "finished") {
    return unresolvedResult(position, candidateSeat, state.moveNumber);
  }

  const candidateScore: Score = state.winner === null
    ? 0.5
    : state.winner === candidateSeat
      ? 1
      : 0;

  return {
    position: position.label,
    opening: position.openingKey,
    candidateSeat,
    winner: state.winner,
    unresolved: false,
    moves: state.moveNumber,
    candidateScore,
  };
}

function unresolvedResult(
  position: ForcedPosition,
  candidateSeat: PlayerId,
  moves: number,
): GameResult {
  return {
    position: position.label,
    opening: position.openingKey,
    candidateSeat,
    winner: null,
    unresolved: true,
    moves,
    candidateScore: null,
  };
}

function buildPositions(
  selectedOpenings: PlayerMove[],
  includeReplies: boolean,
): ForcedPosition[] {
  const built: ForcedPosition[] = [];
  for (const opening of selectedOpenings) {
    const openingKey = moveKey(opening);
    if (!includeReplies) {
      built.push({ label: openingKey, openingKey, moves: [opening] });
      continue;
    }

    const opened = applyMove(createInitialState(), opening);
    if (!opened.ok) throw new Error(`Failed opening ${openingKey}: ${opened.error}`);
    const replies = opened.state.status === "playing" ? getLegalMoves(opened.state) : [];
    if (replies.length === 0) {
      built.push({ label: openingKey, openingKey, moves: [opening] });
      continue;
    }

    for (const reply of replies) {
      built.push({
        label: `${openingKey}>${reply.pit}:${reply.dir}`,
        openingKey,
        moves: [opening, reply],
      });
    }
  }
  return built;
}

function recordV2(summary: SearchSummary, decision: PuctV2Decision): void {
  summary.decisions += 1;
  summary.simulations += decision.diagnostics.simulations;
  summary.expandedNodes += decision.diagnostics.expandedNodes;
  summary.maxTreeDepth = Math.max(summary.maxTreeDepth, decision.diagnostics.maxTreeDepth);
  summary.elapsedMs += decision.diagnostics.elapsedMs;
}

function recordV3(summary: SearchSummary, decision: PuctV3ADecision): void {
  summary.decisions += 1;
  summary.simulations += decision.diagnostics.simulations;
  summary.expandedNodes += decision.diagnostics.expandedNodes;
  summary.maxTreeDepth = Math.max(summary.maxTreeDepth, decision.diagnostics.maxTreeDepth);
  summary.elapsedMs += decision.diagnostics.elapsedMs;
  if (decision.diagnostics.reusedRoot) summary.reusedDecisions += 1;
  summary.reusedRootVisits += decision.diagnostics.reusedRootVisits;
  summary.cycleCutoffs += decision.diagnostics.cycleCutoffs;
  if (decision.diagnostics.solvedRoot !== null) summary.solvedRoots += 1;
}

function summarizeSearch(summary: SearchSummary) {
  return {
    ...summary,
    averageSimulationsPerDecision: summary.decisions > 0
      ? summary.simulations / summary.decisions
      : 0,
    averageExpandedNodesPerDecision: summary.decisions > 0
      ? summary.expandedNodes / summary.decisions
      : 0,
    averageMsPerDecision: summary.decisions > 0
      ? summary.elapsedMs / summary.decisions
      : 0,
    reuseRate: summary.decisions > 0
      ? summary.reusedDecisions / summary.decisions
      : 0,
  };
}

function recordGame(summary: PositionSummary, game: GameResult): void {
  summary.games += 1;
  if (game.unresolved || game.candidateScore === null) {
    summary.unresolved += 1;
    return;
  }
  summary.candidatePoints += game.candidateScore;
  if (game.winner === null) summary.draws += 1;
  else if (game.winner === game.candidateSeat) summary.candidateWins += 1;
  else summary.baselineWins += 1;
}

function emptyPositionSummary(): PositionSummary {
  return {
    games: 0,
    candidateWins: 0,
    baselineWins: 0,
    draws: 0,
    unresolved: 0,
    candidatePoints: 0,
    pairDiff: null,
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
  };
}

function readEngine(name: string, fallback: EngineId): EngineId {
  const value = stringArg(name) ?? fallback;
  if (value === "puct-v2" || value === "puct-v3a") return value;
  throw new Error(`${name} must be puct-v2|puct-v3a`);
}

function readOpenings(): PlayerMove[] {
  const raw = stringArg("--openings") ?? "B3:CW,B3:CCW";
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length === 0) throw new Error("--openings cannot be empty");
  return values.map(parseClassicOpening);
}

function moveKey(move: Pick<PlayerMove, "pit" | "dir">): string {
  return `${move.pit}:${move.dir}`;
}

function mean(values: number[]): number | null {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle] ?? null
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function stringArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function intArg(name: string, fallback: number): number {
  const raw = stringArg(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be an integer`);
  return value;
}
