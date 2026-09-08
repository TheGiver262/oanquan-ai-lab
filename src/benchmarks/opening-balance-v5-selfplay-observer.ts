import { getLegalMoves } from "../engine.js";
import { chooseMctsMove } from "../research/mcts.js";
import { searchNegamaxPvsV3, type V3EvaluationFamily } from "../research/negamax-pvs-v3.js";
import { parseClassicOpening } from "../research/opening-pie-analysis.js";
import {
  applyPolicyMove,
  createPolicyState,
  type PolicyState,
} from "../research/repetition-policy-v5.js";
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
  naturalFinish: boolean;
  unresolved: boolean;
  moves: number;
  firstRepeat2Ply: number | null;
  firstRepeat3Ply: number | null;
  maxOccurrenceCount: number;
  distinctStrategicStatesSeen: number;
};

const opening = parseClassicOpening(requiredStringArg("--opening"));
const engineA = readEngine("--a");
const engineB = readEngine("--b");
if (engineA === engineB) throw new Error("--a and --b must be different engines");
if (opening.pit !== "B3") throw new Error("V5 repetition observer is restricted to B3 finalist openings");

const games = evenIntArg("--games", 8);
const pvsNodes = intArg("--pvs-nodes", 80_000);
const pvsDepth = intArg("--pvs-depth", 12);
const pvsMs = intArg("--pvs-ms", 800);
const simulations = intArg("--simulations", 10_000);
const mctsMs = intArg("--mcts-ms", 800);
const productionNodes = intArg("--production-nodes", 80_000);
const productionMs = intArg("--production-ms", 800);
const maxMoves = intArg("--max-moves", 240);
const seedBase = intArg("--seed", 20260908);

const details: GameDetail[] = [];
const aggregate = {
  engineAWins: 0,
  engineBWins: 0,
  p0Wins: 0,
  p1Wins: 0,
  naturalDraws: 0,
  unresolved: 0,
  gamesWithRepeat2: 0,
  gamesWithRepeat3: 0,
  repeat2BeforeNaturalFinish: 0,
  repeat3BeforeNaturalFinish: 0,
  totalMoves: 0,
};

for (let index = 0; index < games; index += 1) {
  const p0Engine = index % 2 === 0 ? engineA : engineB;
  const p1Engine = index % 2 === 0 ? engineB : engineA;
  const detail = playGame(index + 1, p0Engine, p1Engine, seedBase + index * 7_919);
  details.push(detail);
  aggregate.totalMoves += detail.moves;

  if (detail.firstRepeat2Ply !== null) aggregate.gamesWithRepeat2 += 1;
  if (detail.firstRepeat3Ply !== null) aggregate.gamesWithRepeat3 += 1;
  if (detail.naturalFinish && detail.firstRepeat2Ply !== null) aggregate.repeat2BeforeNaturalFinish += 1;
  if (detail.naturalFinish && detail.firstRepeat3Ply !== null) aggregate.repeat3BeforeNaturalFinish += 1;

  if (detail.unresolved) aggregate.unresolved += 1;
  else if (detail.winnerSeat === null) aggregate.naturalDraws += 1;
  else {
    if (detail.winnerSeat === "P0") aggregate.p0Wins += 1;
    else aggregate.p1Wins += 1;
    if (detail.winnerEngine === engineA) aggregate.engineAWins += 1;
    else if (detail.winnerEngine === engineB) aggregate.engineBWins += 1;
  }
}

console.log(JSON.stringify({
  methodology: {
    phase: "Opening Balance V5 policy-blind repetition observation",
    forcedOpening: "The selected P0 B3 opening is applied from the true initial position before engine control begins.",
    repetitionSemantics: "none; engines and canonical game are never adjudicated for repetition during this benchmark",
    observation: "full strategic-state occurrence counts are tracked externally; first second/third occurrence plies are reported",
    seatSwap: "Engine A and Engine B alternate P0/P1 ownership every game.",
    purpose: "measure how often current search agents naturally enter repeated positions before testing policy-aware exploitation",
    claimLimit: "behavioral stress test under configured engines/budgets; not a game-theoretic fairness proof",
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
  aggregate: {
    ...aggregate,
    averageMoves: aggregate.totalMoves / games,
    repeat2Rate: aggregate.gamesWithRepeat2 / games,
    repeat3Rate: aggregate.gamesWithRepeat3 / games,
  },
  details,
}, null, 2));

function playGame(game: number, p0Engine: EngineId, p1Engine: EngineId, seed: number): GameDetail {
  const initial = createPolicyState(createInitialStateViaLegalMoves());
  const legalOpening = getLegalMoves(initial.game).find(
    (move) => move.player === "P0" && move.pit === opening.pit && move.dir === opening.dir,
  );
  if (!legalOpening) throw new Error(`Illegal forced opening ${opening.pit}:${opening.dir}`);
  const opened = applyPolicyMove(initial, legalOpening, { kind: "none" });
  if (!opened.ok) throw new Error(`Failed forced opening ${opening.pit}:${opening.dir}: ${opened.error}`);
  let state = opened.state;

  let firstRepeat2Ply = maxOccurrence(state) >= 2 ? state.plies : null;
  let firstRepeat3Ply = maxOccurrence(state) >= 3 ? state.plies : null;
  const randomP0 = mulberry32(seed ^ 0x9e3779b9);
  const randomP1 = mulberry32(seed ^ 0x85ebca6b);

  while (state.game.status === "playing" && state.game.moveNumber < maxMoves) {
    const player = state.game.currentPlayer;
    const engine = player === "P0" ? p0Engine : p1Engine;
    const random = player === "P0" ? randomP0 : randomP1;
    const move = chooseEngineMove(state.game, engine, player, random);
    if (!move) return finalize(game, p0Engine, p1Engine, state, false, true, firstRepeat2Ply, firstRepeat3Ply);

    const applied = applyPolicyMove(state, move, { kind: "none" });
    if (!applied.ok) throw new Error(`Illegal ${engine} move ${move.pit}:${move.dir}: ${applied.error}`);
    state = applied.state;

    const maxCount = maxOccurrence(state);
    if (firstRepeat2Ply === null && maxCount >= 2) firstRepeat2Ply = state.plies;
    if (firstRepeat3Ply === null && maxCount >= 3) firstRepeat3Ply = state.plies;
  }

  const naturalFinish = state.game.status === "finished";
  return finalize(
    game,
    p0Engine,
    p1Engine,
    state,
    naturalFinish,
    !naturalFinish,
    firstRepeat2Ply,
    firstRepeat3Ply,
  );
}

function finalize(
  game: number,
  p0Engine: EngineId,
  p1Engine: EngineId,
  state: PolicyState,
  naturalFinish: boolean,
  unresolved: boolean,
  firstRepeat2Ply: number | null,
  firstRepeat3Ply: number | null,
): GameDetail {
  const winnerSeat = naturalFinish ? state.game.winner : null;
  const winnerEngine = winnerSeat === null ? null : winnerSeat === "P0" ? p0Engine : p1Engine;
  return {
    game,
    p0Engine,
    p1Engine,
    winnerSeat,
    winnerEngine,
    naturalFinish,
    unresolved,
    moves: state.game.moveNumber,
    firstRepeat2Ply,
    firstRepeat3Ply,
    maxOccurrenceCount: maxOccurrence(state),
    distinctStrategicStatesSeen: state.repetitionCounts.size,
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

function createInitialStateViaLegalMoves(): GameState {
  // Local import avoidance keeps this benchmark's state-flow explicit while
  // preserving the canonical engine initializer through a synchronous module-level helper.
  return initialStateFactory();
}

import { createInitialState as initialStateFactory } from "../engine.js";

function maxOccurrence(state: PolicyState): number {
  let max = 0;
  for (const count of state.repetitionCounts.values()) max = Math.max(max, count);
  return max;
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
