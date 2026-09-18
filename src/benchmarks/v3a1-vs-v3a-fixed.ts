import { writeFileSync } from "node:fs";
import { applyMove, createInitialState, getLegalMoves } from "../engine.js";
import { ReusableScoreBoundedPuct } from "../research/puct-v3a.js";
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

type StageId = "stage1" | "stage2" | "stage3";
type Score = 0 | 0.5 | 1;

type Position = {
  id: string;
  start: () => GameState;
  moveLimit: (state: GameState) => number;
};

type GameResult = {
  position: string;
  candidateSeat: PlayerId;
  winner: PlayerId | null;
  unresolved: boolean;
  continuationMoves: number;
  candidateScore: Score | null;
  finalScores: { P0: number; P1: number };
};

const STAGE3_IDS = new Set([
  "B3:CW:material@12",
  "B3:CW:material@14",
  "B3:CW:material@19",
  "B3:CCW:strategic@16",
  "B3:CCW:strategic@19",
]);

const stage = readStage("--stage");
const fixedSimulations = intArg("--fixed-simulations", 10_000);
const candidateLeafScoreWeight = numberArg("--candidate-leaf-score-weight", 0);
const outPath = stringArg("--out");
const positions = buildPositions(stage);

const details: GameResult[] = [];
const perPosition = new Map<
  string,
  { games: number; unresolved: number; candidatePoints: number; pairDiff: number | null }
>();

for (const position of positions) {
  const pair = (["P0", "P1"] as const).map((candidateSeat) =>
    play(position, candidateSeat),
  );
  details.push(...pair);
  const unresolved = pair.filter((game) => game.unresolved).length;
  const candidatePoints = pair.reduce(
    (sum, game) => sum + (game.candidateScore ?? 0),
    0,
  );
  perPosition.set(position.id, {
    games: 2,
    unresolved,
    candidatePoints,
    pairDiff: unresolved === 0 ? candidatePoints - (2 - candidatePoints) : null,
  });
}

const resolved = details.filter(
  (game) => !game.unresolved && game.candidateScore !== null,
);
const candidatePoints = resolved.reduce(
  (sum, game) => sum + (game.candidateScore ?? 0),
  0,
);
const pairDiffs = [...perPosition.values()].flatMap((entry) =>
  entry.pairDiff === null ? [] : [entry.pairDiff],
);

const result = {
  experiment: "v3a1-leaf0-vs-v3a-fixed-sim-v1",
  methodology: {
    stage,
    incumbent: "ReusableScoreBoundedPuct leafScoreWeight=1.8",
    candidate: `ReusableScoreBoundedPuct leafScoreWeight=${candidateLeafScoreWeight}`,
    fixedSimulationsPerDecision: fixedSimulations,
    puctExploration: 1.5,
    policyTemperature: 0.6,
    policyPriorsFrozenToIncumbent: true,
    pairing: "Each exact position is played twice with candidate ownership swapped P0/P1.",
    primaryMetric: "pairDiff from candidate perspective",
    unresolved: "censored at stage move cap; never heuristic-adjudicated",
    pvsStatus: "PVS/NegaScout excluded from active evaluation",
  },
  positions: positions.map((position) => position.id),
  games: details.length,
  candidateWins: resolved.filter((game) => game.winner === game.candidateSeat).length,
  incumbentWins: resolved.filter(
    (game) => game.winner !== null && game.winner !== game.candidateSeat,
  ).length,
  draws: resolved.filter((game) => game.winner === null).length,
  unresolved: details.filter((game) => game.unresolved).length,
  resolvedScoreRate:
    resolved.length > 0 ? candidatePoints / resolved.length : null,
  completedPairs: pairDiffs.length,
  meanPairDiff: mean(pairDiffs),
  favorablePairs: pairDiffs.filter((value) => value > 0).length,
  neutralPairs: pairDiffs.filter((value) => value === 0).length,
  unfavorablePairs: pairDiffs.filter((value) => value < 0).length,
  pairDiffs,
  perPosition: Object.fromEntries(perPosition),
  details,
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function play(position: Position, candidateSeat: PlayerId): GameResult {
  let state = position.start();
  const startMove = state.moveNumber;
  const limit = position.moveLimit(state);
  const incumbent = new ReusableScoreBoundedPuct();
  const candidate = new ReusableScoreBoundedPuct();

  while (state.status === "playing" && state.moveNumber < limit) {
    const isCandidate = state.currentPlayer === candidateSeat;
    const engine = isCandidate ? candidate : incumbent;
    const decision = engine.chooseMove(state, {
      simulations: fixedSimulations,
      puctExploration: 1.5,
      policyTemperature: 0.6,
      leafScoreWeight: isCandidate ? candidateLeafScoreWeight : 1.8,
    });
    const move = decision.move;
    if (!move) return unresolvedResult(position, candidateSeat, state, startMove);
    const applied = applyMove(state, move);
    if (!applied.ok) {
      throw new Error(
        `Illegal ${isCandidate ? "candidate" : "incumbent"} move ${move.pit}:${move.dir}: ${applied.error}`,
      );
    }
    state = applied.state;
  }

  if (state.status !== "finished") {
    return unresolvedResult(position, candidateSeat, state, startMove);
  }
  return {
    position: position.id,
    candidateSeat,
    winner: state.winner,
    unresolved: false,
    continuationMoves: state.moveNumber - startMove,
    candidateScore:
      state.winner === null ? 0.5 : state.winner === candidateSeat ? 1 : 0,
    finalScores: { ...state.scores },
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
  const selected = BALANCED_MIDGAME_POSITIONS.filter((position) =>
    STAGE3_IDS.has(position.id),
  );
  if (selected.length !== STAGE3_IDS.size) {
    throw new Error(`Expected ${STAGE3_IDS.size} Stage 3 positions, got ${selected.length}`);
  }
  return selected.map(stage3Position);
}

function buildStage1Positions(): Position[] {
  const openings = [
    parseClassicOpening("B3:CW"),
    parseClassicOpening("B3:CCW"),
  ];
  const positions: Position[] = [];
  for (const opening of openings) {
    const opened = applyMove(createInitialState(), opening);
    if (!opened.ok) {
      throw new Error(`Failed Stage 1 opening ${opening.pit}:${opening.dir}`);
    }
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
  if (positions.length !== 16) {
    throw new Error(`Expected 16 Stage 1 positions, got ${positions.length}`);
  }
  return positions;
}

function stage3Position(position: BalancedMidgamePosition): Position {
  return {
    id: position.id,
    start: () => replayBalancedPosition(position),
    moveLimit: (state) => state.moveNumber + 512,
  };
}

function unresolvedResult(
  position: Position,
  candidateSeat: PlayerId,
  state: GameState,
  startMove: number,
): GameResult {
  return {
    position: position.id,
    candidateSeat,
    winner: null,
    unresolved: true,
    continuationMoves: state.moveNumber - startMove,
    candidateScore: null,
    finalScores: { ...state.scores },
  };
}

function mean(values: readonly number[]): number | null {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
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

function numberArg(name: string, fallback: number): number {
  const raw = stringArg(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative number`);
  }
  return value;
}

function readStage(name: string): StageId {
  const value = stringArg(name) ?? "stage2";
  if (value === "stage1" || value === "stage2" || value === "stage3") {
    return value;
  }
  throw new Error(`${name} must be stage1|stage2|stage3`);
}
