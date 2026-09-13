import { writeFileSync } from "node:fs";
import { applyMove } from "../engine.js";
import { chooseFrozenPuctV2 } from "../research/puct-v2.js";
import { ReusableScoreBoundedPuct } from "../research/puct-v3a.js";
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
  candidateSeat: PlayerId;
  winner: PlayerId | null;
  unresolved: boolean;
  continuationMoves: number;
  candidateScore: Score | null;
};

const TARGET_IDS = new Set([
  "LQ@5:B2:CW:B2:CW>T5:CCW>B5:CW>T3:CCW>B1:CW",
  "LQ@9:B2:CCW:B2:CCW>T1:CW>B4:CCW>T3:CW>B5:CW>T4:CCW>B4:CCW>T5:CCW>B5:CW",
]);

const candidate = readEngine("--candidate", "puct-v3a");
const baseline = readEngine("--baseline", "puct-v2");
const simulations = intArg("--simulations", 4_000);
const additionalMaxMoves = intArg("--additional-max-moves", 512);
const outPath = stringArg("--out");
const positions = LIVE_QUAN_BALANCED_POSITIONS.filter((position) => TARGET_IDS.has(position.id));
if (positions.length !== TARGET_IDS.size) throw new Error(`Expected ${TARGET_IDS.size} replay positions, got ${positions.length}`);

const details: GameResult[] = [];
const perPosition: Record<string, { games: number; unresolved: number; candidatePoints: number; pairDiff: number | null }> = {};

for (const position of positions) {
  const games = (["P0", "P1"] as const).map((candidateSeat) => play(position, candidateSeat));
  details.push(...games);
  const unresolved = games.filter((game) => game.unresolved).length;
  const candidatePoints = games.reduce((sum, game) => sum + (game.candidateScore ?? 0), 0);
  perPosition[position.id] = {
    games: games.length,
    unresolved,
    candidatePoints,
    pairDiff: unresolved === 0 ? candidatePoints - (2 - candidatePoints) : null,
  };
}

const pairDiffs = Object.values(perPosition).flatMap((entry) => entry.pairDiff === null ? [] : [entry.pairDiff]);
const resolved = details.filter((game) => !game.unresolved && game.candidateScore !== null);
const resolvedPoints = resolved.reduce((sum, game) => sum + (game.candidateScore ?? 0), 0);
const result = {
  experiment: "R1c-stage2-live-quan-targeted-replay",
  evidenceClass: candidate === baseline ? "null-control" : "same-family-fixed-simulation",
  ruleset: "oaq:classic_2p:standard:v1",
  methodology: {
    candidate,
    baseline,
    reason: "Replay only Stage 2 positions censored at +160; no outcome-based addition of new positions.",
    deterministic: true,
    randomSeeds: "none",
    pairing: "Each exact state is replayed twice with candidate ownership swapped P0/P1.",
    resourceMode: "fixed simulations; no wall-clock search cap",
    unresolved: "censored; never heuristic-adjudicated",
  },
  config: { simulations, additionalMaxMoves, puctExploration: 1.5, policyTemperature: 0.6 },
  positions: positions.map((position) => ({ id: position.id, depth: position.depth, opening: position.opening })),
  games: details.length,
  unresolved: details.filter((game) => game.unresolved).length,
  resolvedScoreRate: resolved.length > 0 ? resolvedPoints / resolved.length : null,
  completedPairs: pairDiffs.length,
  meanPairDiff: mean(pairDiffs),
  favorablePairs: pairDiffs.filter((value) => value > 0).length,
  neutralPairs: pairDiffs.filter((value) => value === 0).length,
  unfavorablePairs: pairDiffs.filter((value) => value < 0).length,
  pairDiffs,
  perPosition,
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
    let move: PlayerMove | null;
    if (engine === "puct-v3a") {
      const session = isCandidate ? candidateV3 : baselineV3;
      if (!session) throw new Error("Missing V3A session");
      move = session.chooseMove(state, {
        simulations,
        puctExploration: 1.5,
        policyTemperature: 0.6,
      }).move;
    } else {
      move = chooseFrozenPuctV2(state, {
        simulations,
        puctExploration: 1.5,
        policyTemperature: 0.6,
      }).move;
    }
    if (!move) return unresolved(position, candidateSeat, state.moveNumber - startMove);
    const applied = applyMove(state, move);
    if (!applied.ok) throw new Error(`Illegal ${engine} move: ${applied.error}`);
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

function unresolved(position: LiveQuanPosition, candidateSeat: PlayerId, continuationMoves: number): GameResult {
  return { position: position.id, candidateSeat, winner: null, unresolved: true, continuationMoves, candidateScore: null };
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
function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
