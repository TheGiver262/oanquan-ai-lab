import { writeFileSync } from "node:fs";
import { applyMove } from "../engine.js";
import { chooseFrozenPuctV2, type PuctV2Decision } from "../research/puct-v2.js";
import { ReusableScoreBoundedPuct, type PuctV3ADecision } from "../research/puct-v3a.js";
import {
  LIVE_QUAN_BALANCED_POSITIONS,
  replayLiveQuanPosition,
  type LiveQuanPosition,
} from "../research/v3-live-quan-corpus.js";
import type { PlayerId, PlayerMove } from "../types.js";

type EngineId = "puct-v2" | "puct-v3a";
type Score = 0 | 0.5 | 1;

type GameResult = {
  position: string;
  opening: string;
  prefixDepth: number;
  candidateSeat: PlayerId;
  winner: PlayerId | null;
  unresolved: boolean;
  continuationMoves: number;
  candidateScore: Score | null;
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

const candidate = readEngine("--candidate", "puct-v3a");
const baseline = readEngine("--baseline", "puct-v2");
const simulations = intArg("--simulations", 4_000);
const additionalMaxMoves = intArg("--additional-max-moves", 160);
const outPath = stringArg("--out");

const details: GameResult[] = [];
const candidateSearch = emptySearch();
const baselineSearch = emptySearch();
const perPosition: Record<string, {
  games: number;
  candidatePoints: number;
  unresolved: number;
  pairDiff: number | null;
}> = {};

for (const position of LIVE_QUAN_BALANCED_POSITIONS) {
  const games = (["P0", "P1"] as const).map((candidateSeat) =>
    play(position, candidateSeat)
  );
  details.push(...games);
  const unresolved = games.filter((game) => game.unresolved).length;
  const points = games.reduce((sum, game) => sum + (game.candidateScore ?? 0), 0);
  perPosition[position.id] = {
    games: 2,
    candidatePoints: points,
    unresolved,
    pairDiff: unresolved === 0 ? points - (2 - points) : null,
  };
}

const pairDiffs = Object.values(perPosition)
  .flatMap((entry) => entry.pairDiff === null ? [] : [entry.pairDiff]);
const resolvedGames = details.filter((game) => !game.unresolved && game.candidateScore !== null);
const resolvedPoints = resolvedGames.reduce((sum, game) => sum + (game.candidateScore ?? 0), 0);

const result = {
  experiment: "R1c-stage2-live-quan-ablation",
  evidenceClass: candidate === baseline ? "null-control" : "same-family-fixed-simulation",
  ruleset: "oaq:classic_2p:standard:v1",
  methodology: {
    candidate,
    baseline,
    corpus: "audited deterministic 16-state balanced live-Quan corpus",
    deterministic: true,
    randomSeeds: "none",
    pairing: "Each exact state is played twice with candidate ownership swapped P0/P1.",
    resourceMode: "fixed simulations; no wall-clock search cap",
    moveCap: `${additionalMaxMoves} additional plies after the forced prefix`,
    unresolved: "censored; never heuristic-adjudicated",
    pieRule: "disabled",
    threefoldDraw: "disabled",
  },
  config: {
    simulations,
    additionalMaxMoves,
    puctExploration: 1.5,
    policyTemperature: 0.6,
  },
  positionCount: LIVE_QUAN_BALANCED_POSITIONS.length,
  positions: LIVE_QUAN_BALANCED_POSITIONS.map((position) => ({
    id: position.id,
    depth: position.depth,
    opening: position.opening,
    scoreDiff: position.scoreDiff,
    danMaterialDiff: position.danMaterialDiff,
    nonEmptyPitDiff: position.nonEmptyPitDiff,
    legalMoves: position.legalMoves,
  })),
  games: details.length,
  unresolved: details.filter((game) => game.unresolved).length,
  unresolvedRate: details.length > 0
    ? details.filter((game) => game.unresolved).length / details.length
    : 0,
  resolvedScoreRate: resolvedGames.length > 0 ? resolvedPoints / resolvedGames.length : null,
  completedPairs: pairDiffs.length,
  meanPairDiff: mean(pairDiffs),
  medianPairDiff: median(pairDiffs),
  favorablePairs: pairDiffs.filter((value) => value > 0).length,
  neutralPairs: pairDiffs.filter((value) => value === 0).length,
  unfavorablePairs: pairDiffs.filter((value) => value < 0).length,
  pairDiffs,
  perPosition,
  searchDiagnostics: {
    candidate: summarize(candidateSearch),
    baseline: summarize(baselineSearch),
  },
  details,
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function play(position: LiveQuanPosition, candidateSeat: PlayerId): GameResult {
  let state = replayLiveQuanPosition(position);
  const startMove = state.moveNumber;
  const limit = startMove + additionalMaxMoves;
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
        simulations,
        puctExploration: 1.5,
        policyTemperature: 0.6,
      });
      recordV3(search, decision);
      move = decision.move;
    } else {
      const decision = chooseFrozenPuctV2(state, {
        simulations,
        puctExploration: 1.5,
        policyTemperature: 0.6,
      });
      recordV2(search, decision);
      move = decision.move;
    }

    if (!move) return unresolved(position, candidateSeat, state.moveNumber - startMove);
    const applied = applyMove(state, move);
    if (!applied.ok) throw new Error(`Illegal ${engine} move: ${applied.error}`);
    state = applied.state;
  }

  if (state.status !== "finished") {
    return unresolved(position, candidateSeat, state.moveNumber - startMove);
  }

  return {
    position: position.id,
    opening: position.opening,
    prefixDepth: position.depth,
    candidateSeat,
    winner: state.winner,
    unresolved: false,
    continuationMoves: state.moveNumber - startMove,
    candidateScore: state.winner === null
      ? 0.5
      : state.winner === candidateSeat
        ? 1
        : 0,
  };
}

function unresolved(
  position: LiveQuanPosition,
  candidateSeat: PlayerId,
  continuationMoves: number,
): GameResult {
  return {
    position: position.id,
    opening: position.opening,
    prefixDepth: position.depth,
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

function emptySearch(): SearchSummary {
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

function summarize(summary: SearchSummary) {
  return {
    ...summary,
    averageSimulationsPerDecision:
      summary.decisions > 0 ? summary.simulations / summary.decisions : 0,
    averageExpandedNodesPerDecision:
      summary.decisions > 0 ? summary.expandedNodes / summary.decisions : 0,
    averageMsPerDecision:
      summary.decisions > 0 ? summary.elapsedMs / summary.decisions : 0,
    reuseRate:
      summary.decisions > 0 ? summary.reusedDecisions / summary.decisions : 0,
  };
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
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
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
