import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { applyMove, createInitialState } from "../engine.js";
import { chooseMctsMove, type MctsVariant } from "../research/mcts.js";
import {
  PRODUCTION_SOURCE_COMMIT,
  chooseServerProductionMove,
  type ProductionStrengthMode,
} from "../reference/server-production-ai.js";
import { PRODUCTION_TOP_PROFILES, type ProductionTopDifficulty } from "../reference/production-ai.js";
import {
  createTrangNguyenLearningReader,
  type TrangNguyenLearningSnapshotV1,
} from "../reference/trang-nguyen-learning.js";
import type { GameState, PlayerId, PlayerMove } from "../types.js";

type SeatResult = { games: number; wins: number; losses: number; draws: number; unresolved: number };
type GameResult = { winner: PlayerId | null; unresolved: boolean; moves: number };

type Result = {
  research: MctsVariant;
  opponent: ProductionTopDifficulty;
  productionMode: ProductionStrengthMode;
  productionSourceCommit: string;
  baselineIntegrity: "full-code-parity" | "code-parity-no-live-learning-snapshot";
  learningSnapshotLoaded: boolean;
  games: number;
  researchWins: number;
  productionWins: number;
  draws: number;
  unresolved: number;
  researchWinRate: number;
  scoreRate: number;
  researchAsP0: SeatResult;
  researchAsP1: SeatResult;
  averageMoves: number;
  elapsedMs: number;
  config: {
    simulations: number;
    rolloutDepth: number;
    mctsTimeBudgetMs: number;
    productionTimeBudgetMs: number;
    productionNodeBudget: number;
    puctExploration: number;
    policyTemperature: number;
    maxMoves: number;
    seed: number;
  };
};

const opponent = readOpponent();
const variant = readVariant();
const productionMode = readMode();
const games = evenIntArg("--games", 6);
const simulations = intArg("--simulations", 100_000);
const rolloutDepth = intArg("--rollout-depth", 20);
const maxMoves = intArg("--max-moves", 160);
const baseSeed = intArg("--seed", 20260908);
const productionProfile = PRODUCTION_TOP_PROFILES[opponent];
const mctsTimeBudgetMs = intArg("--mcts-ms", productionProfile.timeBudgetMs);
const productionTimeBudgetMs = intArg("--production-ms", productionProfile.timeBudgetMs);
const productionNodeBudget = intArg("--production-nodes", productionProfile.nodeBudget);
const puctExploration = numberArg("--cpuct", 1.5);
const policyTemperature = numberArg("--policy-temperature", 0.35);
const learningPath = stringArg("--learning-file");
const outPath = stringArg("--out");
const learning = loadLearning(learningPath);
const learningSnapshotLoaded = learning !== null;
const baselineIntegrity =
  opponent === "trang-nguyen" && !learningSnapshotLoaded
    ? "code-parity-no-live-learning-snapshot"
    : "full-code-parity";

const started = performance.now();
const aggregate = emptyAggregate();
let moveTotal = 0;

for (let index = 0; index < games; index += 1) {
  const researchSeat: PlayerId = index % 2 === 0 ? "P0" : "P1";
  const seed = baseSeed + index * 7919 + hashString(`${variant}:${opponent}:${productionMode}`);
  const result = playGame(researchSeat, seed);
  moveTotal += result.moves;
  recordResult(aggregate, researchSeat, result);
}

const completed = games - aggregate.unresolved;
const result: Result = {
  research: variant,
  opponent,
  productionMode,
  productionSourceCommit: PRODUCTION_SOURCE_COMMIT,
  baselineIntegrity,
  learningSnapshotLoaded,
  games,
  researchWins: aggregate.researchWins,
  productionWins: aggregate.productionWins,
  draws: aggregate.draws,
  unresolved: aggregate.unresolved,
  researchWinRate: completed > 0 ? aggregate.researchWins / completed : 0,
  scoreRate: completed > 0 ? (aggregate.researchWins + aggregate.draws * 0.5) / completed : 0,
  researchAsP0: aggregate.researchAsP0,
  researchAsP1: aggregate.researchAsP1,
  averageMoves: moveTotal / games,
  elapsedMs: performance.now() - started,
  config: {
    simulations,
    rolloutDepth,
    mctsTimeBudgetMs,
    productionTimeBudgetMs,
    productionNodeBudget,
    puctExploration,
    policyTemperature,
    maxMoves,
    seed: baseSeed,
  },
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function playGame(researchSeat: PlayerId, seed: number): GameResult {
  let state = createInitialState();
  const researchRandom = mulberry32(seed ^ 0x9e3779b9);
  const productionRandom = mulberry32(seed ^ 0x85ebca6b);

  while (state.status === "playing" && state.moveNumber < maxMoves) {
    const player = state.currentPlayer;
    let move: PlayerMove | null = null;

    if (player === researchSeat) {
      const decision = chooseMctsMove(state, {
        variant,
        simulations,
        timeBudgetMs: mctsTimeBudgetMs,
        rolloutDepth,
        puctExploration,
        policyTemperature,
        random: researchRandom,
      });
      move = decision.move;
    } else {
      const productionMove = chooseServerProductionMove(state, opponent, player, {
        mode: productionMode,
        ...(learning ? { learning } : {}),
        timeBudgetMs: productionTimeBudgetMs,
        nodeBudget: productionNodeBudget,
        random: productionRandom,
      });
      move = productionMove ? { player, ...productionMove } : null;
    }

    if (!move) return { winner: null, unresolved: true, moves: state.moveNumber };
    const applied = applyMove(state, move);
    if (!applied.ok) {
      throw new Error(`Illegal ${player} move ${move.pit}:${move.dir}: ${applied.error}`);
    }
    state = applied.state;
  }

  return {
    winner: state.status === "finished" ? state.winner : null,
    unresolved: state.status !== "finished",
    moves: state.moveNumber,
  };
}

function loadLearning(path: string | null) {
  if (!path) return null;
  if (!existsSync(path)) throw new Error(`Learning snapshot does not exist: ${path}`);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as TrangNguyenLearningSnapshotV1;
  return createTrangNguyenLearningReader(parsed);
}

function emptyAggregate() {
  return {
    researchWins: 0,
    productionWins: 0,
    draws: 0,
    unresolved: 0,
    researchAsP0: emptySeatResult(),
    researchAsP1: emptySeatResult(),
  };
}

function emptySeatResult(): SeatResult {
  return { games: 0, wins: 0, losses: 0, draws: 0, unresolved: 0 };
}

function recordResult(aggregate: ReturnType<typeof emptyAggregate>, seat: PlayerId, game: GameResult): void {
  const seatResult = seat === "P0" ? aggregate.researchAsP0 : aggregate.researchAsP1;
  seatResult.games += 1;
  if (game.unresolved) {
    aggregate.unresolved += 1;
    seatResult.unresolved += 1;
    return;
  }
  if (game.winner === null) {
    aggregate.draws += 1;
    seatResult.draws += 1;
  } else if (game.winner === seat) {
    aggregate.researchWins += 1;
    seatResult.wins += 1;
  } else {
    aggregate.productionWins += 1;
    seatResult.losses += 1;
  }
}

function readOpponent(): ProductionTopDifficulty {
  const value = stringArg("--opponent") ?? "tham-hoa";
  if (value === "tham-hoa" || value === "bang-nhan" || value === "trang-nguyen") return value;
  throw new Error(`Unknown opponent: ${value}`);
}

function readVariant(): MctsVariant {
  const value = stringArg("--variant") ?? "uct-pb";
  if (value === "uct" || value === "uct-pb" || value === "puct-hv") return value;
  throw new Error(`Unknown MCTS variant: ${value}`);
}

function readMode(): ProductionStrengthMode {
  const value = stringArg("--production-mode") ?? "production-live";
  if (value === "production-live" || value === "production-max") return value;
  throw new Error(`Unknown production mode: ${value}`);
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

function evenIntArg(name: string, fallback: number): number {
  const value = intArg(name, fallback);
  if (value % 2 !== 0) throw new Error(`${name} must be even for seat balance`);
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
