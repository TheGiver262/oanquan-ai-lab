import { writeFileSync } from "node:fs";
import { applyMove, createInitialState } from "../engine.js";
import { chooseMctsMove } from "../research/mcts.js";
import type { PlayerId, PlayerMove } from "../types.js";

type SeatResult = { games: number; wins: number; losses: number; draws: number; unresolved: number };
type GameResult = { winner: PlayerId | null; unresolved: boolean; moves: number };

const games = evenIntArg("--games", 6);
const simulations = intArg("--simulations", 100_000);
const timeBudgetMs = intArg("--time-ms", 600);
const rolloutDepth = intArg("--rollout-depth", 20);
const maxMoves = intArg("--max-moves", 160);
const puctExploration = numberArg("--cpuct", 1.5);
const policyTemperature = numberArg("--policy-temperature", 0.35);
const baseSeed = intArg("--seed", 20260911);
const outPath = stringArg("--out");

const started = performance.now();
let puctWins = 0;
let uctPbWins = 0;
let draws = 0;
let unresolved = 0;
let moveTotal = 0;
const puctAsP0 = emptySeatResult();
const puctAsP1 = emptySeatResult();

for (let index = 0; index < games; index += 1) {
  const puctSeat: PlayerId = index % 2 === 0 ? "P0" : "P1";
  const result = playGame(puctSeat, baseSeed + index * 7919);
  moveTotal += result.moves;
  const seat = puctSeat === "P0" ? puctAsP0 : puctAsP1;
  seat.games += 1;

  if (result.unresolved) {
    unresolved += 1;
    seat.unresolved += 1;
  } else if (result.winner === null) {
    draws += 1;
    seat.draws += 1;
  } else if (result.winner === puctSeat) {
    puctWins += 1;
    seat.wins += 1;
  } else {
    uctPbWins += 1;
    seat.losses += 1;
  }
}

const completed = games - unresolved;
const result = {
  matchup: "puct-hv-vs-uct-pb",
  games,
  puctWins,
  uctPbWins,
  draws,
  unresolved,
  puctWinRate: completed > 0 ? puctWins / completed : 0,
  puctScoreRate: completed > 0 ? (puctWins + draws * 0.5) / completed : 0,
  puctAsP0,
  puctAsP1,
  averageMoves: moveTotal / games,
  elapsedMs: performance.now() - started,
  config: {
    simulations,
    timeBudgetMs,
    rolloutDepth,
    puctExploration,
    policyTemperature,
    maxMoves,
    seed: baseSeed,
  },
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function playGame(puctSeat: PlayerId, seed: number): GameResult {
  let state = createInitialState();
  const puctRandom = mulberry32(seed ^ 0x9e3779b9);
  const uctPbRandom = mulberry32(seed ^ 0x85ebca6b);

  while (state.status === "playing" && state.moveNumber < maxMoves) {
    const player = state.currentPlayer;
    const isPuct = player === puctSeat;
    const decision = chooseMctsMove(state, {
      variant: isPuct ? "puct-hv" : "uct-pb",
      simulations,
      timeBudgetMs,
      rolloutDepth,
      puctExploration,
      policyTemperature,
      random: isPuct ? puctRandom : uctPbRandom,
    });
    const move: PlayerMove | null = decision.move;
    if (!move) return { winner: null, unresolved: true, moves: state.moveNumber };
    const applied = applyMove(state, move);
    if (!applied.ok) throw new Error(`Illegal ${player} move ${move.pit}:${move.dir}: ${applied.error}`);
    state = applied.state;
  }

  return {
    winner: state.status === "finished" ? state.winner : null,
    unresolved: state.status !== "finished",
    moves: state.moveNumber,
  };
}

function emptySeatResult(): SeatResult {
  return { games: 0, wins: 0, losses: 0, draws: 0, unresolved: 0 };
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
