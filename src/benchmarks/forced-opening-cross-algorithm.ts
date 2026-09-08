import { applyMove, createInitialState, getLegalMoves } from "../engine.js";
import { chooseMctsMove, type MctsVariant } from "../research/mcts.js";
import { parseClassicOpening } from "../research/opening-pie-analysis.js";
import {
  PRODUCTION_SOURCE_COMMIT,
  chooseServerProductionMove,
} from "../reference/server-production-ai.js";
import type { PlayerId, PlayerMove } from "../types.js";

type SeatResult = {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  unresolved: number;
};

type GameDetail = {
  game: number;
  researchSeat: PlayerId;
  winnerSeat: PlayerId | null;
  winnerEngine: "mcts" | "trang-nguyen" | null;
  unresolved: boolean;
  moves: number;
};

const opening = parseClassicOpening(requiredStringArg("--opening"));
const games = evenIntArg("--games", 6);
const variant = readVariant();
const simulations = intArg("--simulations", 100_000);
const rolloutDepth = intArg("--rollout-depth", 20);
const mctsTimeBudgetMs = intArg("--mcts-ms", 1_200);
const productionTimeBudgetMs = intArg("--production-ms", 1_200);
const productionNodeBudget = intArg("--production-nodes", 100_000);
const maxMoves = intArg("--max-moves", 160);
const seedBase = intArg("--seed", 20260908);

const aggregate = {
  mctsWins: 0,
  trangNguyenWins: 0,
  p0Wins: 0,
  p1Wins: 0,
  draws: 0,
  unresolved: 0,
  mctsAsP0: emptySeat(),
  mctsAsP1: emptySeat(),
  details: [] as GameDetail[],
};

for (let index = 0; index < games; index += 1) {
  const researchSeat: PlayerId = index % 2 === 0 ? "P0" : "P1";
  const seed = seedBase + index * 7_919 + hashString(`${opening.pit}:${opening.dir}:${variant}`);
  const detail = playGame(index + 1, researchSeat, seed);
  aggregate.details.push(detail);

  const seat = researchSeat === "P0" ? aggregate.mctsAsP0 : aggregate.mctsAsP1;
  seat.games += 1;
  if (detail.unresolved) {
    aggregate.unresolved += 1;
    seat.unresolved += 1;
  } else if (detail.winnerSeat === null) {
    aggregate.draws += 1;
    seat.draws += 1;
  } else {
    if (detail.winnerSeat === "P0") aggregate.p0Wins += 1;
    else aggregate.p1Wins += 1;

    if (detail.winnerEngine === "mcts") {
      aggregate.mctsWins += 1;
      seat.wins += 1;
    } else {
      aggregate.trangNguyenWins += 1;
      seat.losses += 1;
    }
  }
}

console.log(JSON.stringify({
  opening: `${opening.pit}:${opening.dir}`,
  methodology: {
    forcedOpening: "The same legal P0 opening is applied before engine control begins.",
    seatSwap: "MCTS owns P0 in half the games and P1 in half; Trạng Nguyên owns the other seat.",
    purpose: "Separate logical-seat advantage from engine-strength advantage after the same opening.",
    trangNguyen: "server production-reference, production-max, no live learning snapshot",
    productionSourceCommit: PRODUCTION_SOURCE_COMMIT,
  },
  config: {
    games,
    variant,
    simulations,
    rolloutDepth,
    mctsTimeBudgetMs,
    productionTimeBudgetMs,
    productionNodeBudget,
    maxMoves,
    seedBase,
  },
  ...aggregate,
}, null, 2));

function playGame(game: number, researchSeat: PlayerId, seed: number): GameDetail {
  const initial = createInitialState();
  const legalOpening = getLegalMoves(initial).find(
    (move) => move.player === "P0" && move.pit === opening.pit && move.dir === opening.dir,
  );
  if (!legalOpening) throw new Error(`Illegal forced opening ${opening.pit}:${opening.dir}`);
  const opened = applyMove(initial, legalOpening);
  if (!opened.ok) throw new Error(`Failed forced opening ${opening.pit}:${opening.dir}: ${opened.error}`);
  let state = opened.state;

  const researchRandom = mulberry32(seed ^ 0x9e3779b9);
  const productionRandom = mulberry32(seed ^ 0x85ebca6b);

  while (state.status === "playing" && state.moveNumber < maxMoves) {
    const player = state.currentPlayer;
    let move: PlayerMove | null = null;

    if (player === researchSeat) {
      move = chooseMctsMove(state, {
        variant,
        simulations,
        rolloutDepth,
        timeBudgetMs: mctsTimeBudgetMs,
        random: researchRandom,
      }).move;
    } else {
      const production = chooseServerProductionMove(state, "trang-nguyen", player, {
        mode: "production-max",
        timeBudgetMs: productionTimeBudgetMs,
        nodeBudget: productionNodeBudget,
        random: productionRandom,
      });
      move = production ? { player, ...production } : null;
    }

    if (!move) {
      return { game, researchSeat, winnerSeat: null, winnerEngine: null, unresolved: true, moves: state.moveNumber };
    }
    const applied = applyMove(state, move);
    if (!applied.ok) throw new Error(`Illegal ${player} move ${move.pit}:${move.dir}: ${applied.error}`);
    state = applied.state;
  }

  if (state.status !== "finished") {
    return { game, researchSeat, winnerSeat: null, winnerEngine: null, unresolved: true, moves: state.moveNumber };
  }
  const winnerEngine = state.winner === null
    ? null
    : state.winner === researchSeat ? "mcts" as const : "trang-nguyen" as const;
  return {
    game,
    researchSeat,
    winnerSeat: state.winner,
    winnerEngine,
    unresolved: false,
    moves: state.moveNumber,
  };
}

function emptySeat(): SeatResult {
  return { games: 0, wins: 0, losses: 0, draws: 0, unresolved: 0 };
}

function readVariant(): MctsVariant {
  const value = stringArg("--variant") ?? "uct-pb";
  if (value === "uct" || value === "uct-pb") return value;
  throw new Error(`Unknown MCTS variant ${value}`);
}

function requiredStringArg(name: string): string {
  const value = stringArg(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
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

function evenIntArg(name: string, fallback: number): number {
  const value = intArg(name, fallback);
  if (value % 2 !== 0) throw new Error(`${name} must be even`);
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
