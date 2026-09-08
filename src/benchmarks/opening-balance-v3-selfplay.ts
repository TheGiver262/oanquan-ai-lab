import { applyMove, createInitialState, getLegalMoves } from "../engine.js";
import { chooseMctsMove } from "../research/mcts.js";
import { searchNegamaxPvsV3, type V3EvaluationFamily } from "../research/negamax-pvs-v3.js";
import { parseClassicOpening } from "../research/opening-pie-analysis.js";
import {
  PRODUCTION_SOURCE_COMMIT,
  chooseServerProductionMove,
} from "../reference/server-production-ai.js";
import type { GameState, PlayerId, PlayerMove } from "../types.js";

type EngineId = "pvs-material" | "pvs-strategic" | "uct-pb" | "trang-nguyen";

type GameDetail = {
  game: number;
  p0Engine: EngineId;
  p1Engine: EngineId;
  winnerSeat: PlayerId | null;
  winnerEngine: EngineId | null;
  unresolved: boolean;
  moves: number;
};

const opening = parseClassicOpening(requiredStringArg("--opening"));
const engineA = readEngine("--a");
const engineB = readEngine("--b");
if (engineA === engineB) throw new Error("--a and --b must be different engines");
if (opening.pit !== "B3") throw new Error("Opening Balance V3 self-play is restricted to B3 openings");

const games = evenIntArg("--games", 4);
const pvsNodes = intArg("--pvs-nodes", 80_000);
const pvsDepth = intArg("--pvs-depth", 12);
const pvsMs = intArg("--pvs-ms", 800);
const simulations = intArg("--simulations", 10_000);
const mctsMs = intArg("--mcts-ms", 800);
const productionNodes = intArg("--production-nodes", 80_000);
const productionMs = intArg("--production-ms", 800);
const maxMoves = intArg("--max-moves", 160);
const seedBase = intArg("--seed", 20260908);

const details: GameDetail[] = [];
const aggregate = {
  engineAWins: 0,
  engineBWins: 0,
  p0Wins: 0,
  p1Wins: 0,
  draws: 0,
  unresolved: 0,
};

for (let index = 0; index < games; index += 1) {
  const p0Engine = index % 2 === 0 ? engineA : engineB;
  const p1Engine = index % 2 === 0 ? engineB : engineA;
  const detail = playGame(index + 1, p0Engine, p1Engine, seedBase + index * 7_919);
  details.push(detail);

  if (detail.unresolved) aggregate.unresolved += 1;
  else if (detail.winnerSeat === null) aggregate.draws += 1;
  else {
    if (detail.winnerSeat === "P0") aggregate.p0Wins += 1;
    else aggregate.p1Wins += 1;
    if (detail.winnerEngine === engineA) aggregate.engineAWins += 1;
    else if (detail.winnerEngine === engineB) aggregate.engineBWins += 1;
  }
}

console.log(JSON.stringify({
  methodology: {
    phase: "Opening Balance V3 paired full-game stress test",
    forcedOpening: "The same P0 B3 opening is applied before engine control begins.",
    seatSwap: "Engine A and Engine B alternate P0/P1 ownership every game.",
    purpose: "Check whether candidate-opening behavior survives full games across independent engine families without conflating engine identity with logical seat.",
    claimLimit: "small paired stress test; not a calibrated win-rate estimate and not an exact solve",
    productionSourceCommit: PRODUCTION_SOURCE_COMMIT,
  },
  opening: `${opening.pit}:${opening.dir}`,
  engines: { engineA, engineB },
  config: {
    games,
    pvsNodes,
    pvsDepth,
    pvsMs,
    simulations,
    mctsMs,
    productionNodes,
    productionMs,
    maxMoves,
    seedBase,
  },
  aggregate,
  details,
}, null, 2));

function playGame(game: number, p0Engine: EngineId, p1Engine: EngineId, seed: number): GameDetail {
  const initial = createInitialState();
  const legalOpening = getLegalMoves(initial).find(
    (move) => move.player === "P0" && move.pit === opening.pit && move.dir === opening.dir,
  );
  if (!legalOpening) throw new Error(`Illegal forced opening ${opening.pit}:${opening.dir}`);
  const opened = applyMove(initial, legalOpening);
  if (!opened.ok) throw new Error(`Failed forced opening ${opening.pit}:${opening.dir}: ${opened.error}`);
  let state = opened.state;

  const randomP0 = mulberry32(seed ^ 0x9e3779b9);
  const randomP1 = mulberry32(seed ^ 0x85ebca6b);

  while (state.status === "playing" && state.moveNumber < maxMoves) {
    const player = state.currentPlayer;
    const engine = player === "P0" ? p0Engine : p1Engine;
    const random = player === "P0" ? randomP0 : randomP1;
    const move = chooseEngineMove(state, engine, player, random);
    if (!move) {
      return { game, p0Engine, p1Engine, winnerSeat: null, winnerEngine: null, unresolved: true, moves: state.moveNumber };
    }
    const applied = applyMove(state, move);
    if (!applied.ok) throw new Error(`Illegal ${engine} move ${move.pit}:${move.dir}: ${applied.error}`);
    state = applied.state;
  }

  if (state.status !== "finished") {
    return { game, p0Engine, p1Engine, winnerSeat: null, winnerEngine: null, unresolved: true, moves: state.moveNumber };
  }

  const winnerEngine = state.winner === null ? null : state.winner === "P0" ? p0Engine : p1Engine;
  return {
    game,
    p0Engine,
    p1Engine,
    winnerSeat: state.winner,
    winnerEngine,
    unresolved: false,
    moves: state.moveNumber,
  };
}

function chooseEngineMove(
  state: GameState,
  engine: EngineId,
  player: PlayerId,
  random: () => number,
): PlayerMove | null {
  if (engine === "pvs-material" || engine === "pvs-strategic") {
    const evaluationFamily: V3EvaluationFamily = engine === "pvs-material" ? "material" : "strategic";
    return searchNegamaxPvsV3(state, {
      evaluationFamily,
      maxDepth: pvsDepth,
      nodeBudget: pvsNodes,
      timeBudgetMs: pvsMs,
    }).move;
  }

  if (engine === "uct-pb") {
    return chooseMctsMove(state, {
      variant: "uct-pb",
      simulations,
      rolloutDepth: 20,
      timeBudgetMs: mctsMs,
      random,
    }).move;
  }

  const production = chooseServerProductionMove(state, "trang-nguyen", player, {
    mode: "production-max",
    timeBudgetMs: productionMs,
    nodeBudget: productionNodes,
    random,
  });
  return production ? { player, ...production } : null;
}

function readEngine(name: string): EngineId {
  const value = requiredStringArg(name);
  if (value === "pvs-material" || value === "pvs-strategic" || value === "uct-pb" || value === "trang-nguyen") return value;
  throw new Error(`Unknown engine ${value}`);
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
