import { createInitialState, getLegalMoves } from "../engine.js";
import { searchNegamaxPvsV3, type V3EvaluationFamily } from "../research/negamax-pvs-v3.js";
import { searchPolicyAwarePvsV5 } from "../research/policy-aware-pvs-v5.js";
import { parseClassicOpening } from "../research/opening-pie-analysis.js";
import {
  applyPolicyMove,
  createPolicyState,
  type PolicyState,
  type RepetitionPolicy,
} from "../research/repetition-policy-v5.js";
import {
  PRODUCTION_SOURCE_COMMIT,
  chooseServerProductionMove,
} from "../reference/server-production-ai.js";
import type { GameState, PlayerId, PlayerMove } from "../types.js";

type EngineId = "aware-material" | "aware-strategic" | "blind-strategic" | "trang-nguyen";

type FinishKind = "natural" | "repetition-draw" | "max-ply-draw" | "unresolved";

type GameDetail = {
  game: number;
  p0Engine: EngineId;
  p1Engine: EngineId;
  finishKind: FinishKind;
  winnerSeat: PlayerId | null;
  winnerEngine: EngineId | null;
  moves: number;
  policyPlies: number;
  finalScores: { P0: number; P1: number };
  drawScoreMarginP0: number | null;
  drawLeader: PlayerId | null;
};

const opening = parseClassicOpening(requiredStringArg("--opening"));
if (opening.pit !== "B3") throw new Error("V5 policy-aware self-play is restricted to B3 finalist openings");
const policy = readPolicy(requiredStringArg("--policy"));
const engineA = readEngine("--a");
const engineB = readEngine("--b");
if (engineA === engineB) throw new Error("--a and --b must be different engines");

const games = evenIntArg("--games", 4);
const pvsNodes = intArg("--pvs-nodes", 30_000);
const pvsDepth = intArg("--pvs-depth", 12);
const pvsMs = intArg("--pvs-ms", 300);
const productionNodes = intArg("--production-nodes", 30_000);
const productionMs = intArg("--production-ms", 300);
const maxMoves = intArg("--max-moves", 240);
const seedBase = intArg("--seed", 20260908);

const details: GameDetail[] = [];
const aggregate = {
  engineAWins: 0,
  engineBWins: 0,
  p0Wins: 0,
  p1Wins: 0,
  naturalDraws: 0,
  repetitionDraws: 0,
  maxPlyDraws: 0,
  unresolved: 0,
  repetitionDrawsWithNonzeroScoreMargin: 0,
  repetitionDrawAbsScoreMarginTotal: 0,
  totalMoves: 0,
};

for (let index = 0; index < games; index += 1) {
  const p0Engine = index % 2 === 0 ? engineA : engineB;
  const p1Engine = index % 2 === 0 ? engineB : engineA;
  const detail = playGame(index + 1, p0Engine, p1Engine, seedBase + index * 7_919);
  details.push(detail);
  aggregate.totalMoves += detail.moves;

  if (detail.finishKind === "unresolved") aggregate.unresolved += 1;
  else if (detail.finishKind === "repetition-draw") {
    aggregate.repetitionDraws += 1;
    const margin = Math.abs(detail.drawScoreMarginP0 ?? 0);
    aggregate.repetitionDrawAbsScoreMarginTotal += margin;
    if (margin > 0) aggregate.repetitionDrawsWithNonzeroScoreMargin += 1;
  } else if (detail.finishKind === "max-ply-draw") aggregate.maxPlyDraws += 1;
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
    phase: "Opening Balance V5 policy-aware self-play",
    forcedOpening: "The selected P0 B3 opening is applied from the true initial state under the tested research policy.",
    policySemantics: "the actual match ends when the research policy adjudicates; aware-* engines receive the full accumulated PolicyState during search",
    awareSearch: "PVS without an unsafe board-only transposition table; repetition draw leaves have exact utility 0",
    blindControls: "blind-strategic and Trang Nguyen choose from canonical GameState and do not reason about repetition, but their actual moves are still adjudicated by the match policy",
    seatSwap: "Engine A and Engine B alternate P0/P1 ownership every game.",
    purpose: "detect whether explicit repetition knowledge changes outcomes or creates deliberate draw escape behavior",
    claimLimit: "bounded search stress test; a score lead at a repetition draw is an exploitability signal, not proof the trailing player was game-theoretically lost",
    productionSourceCommit: PRODUCTION_SOURCE_COMMIT,
  },
  opening: `${opening.pit}:${opening.dir}`,
  policy,
  engines: { engineA, engineB },
  config: {
    games,
    pvsNodes,
    pvsDepth,
    pvsMs,
    productionNodes,
    productionMs,
    maxMoves,
    seedBase,
  },
  aggregate: {
    ...aggregate,
    averageMoves: aggregate.totalMoves / games,
    repetitionDrawRate: aggregate.repetitionDraws / games,
    averageAbsScoreMarginAtRepetitionDraw: aggregate.repetitionDraws === 0
      ? 0
      : aggregate.repetitionDrawAbsScoreMarginTotal / aggregate.repetitionDraws,
  },
  details,
}, null, 2));

function playGame(game: number, p0Engine: EngineId, p1Engine: EngineId, seed: number): GameDetail {
  let state = createPolicyState(createInitialState());
  const legalOpening = getLegalMoves(state.game).find(
    (move) => move.player === "P0" && move.pit === opening.pit && move.dir === opening.dir,
  );
  if (!legalOpening) throw new Error(`Illegal forced opening ${opening.pit}:${opening.dir}`);
  const opened = applyPolicyMove(state, legalOpening, policy);
  if (!opened.ok) throw new Error(`Failed forced opening ${opening.pit}:${opening.dir}: ${opened.error}`);
  state = opened.state;

  const randomP0 = mulberry32(seed ^ 0x9e3779b9);
  const randomP1 = mulberry32(seed ^ 0x85ebca6b);

  while (state.game.status === "playing" && state.adjudication === null && state.game.moveNumber < maxMoves) {
    const player = state.game.currentPlayer;
    const engine = player === "P0" ? p0Engine : p1Engine;
    const random = player === "P0" ? randomP0 : randomP1;
    const move = chooseEngineMove(state, engine, player, random);
    if (!move) return finalize(game, p0Engine, p1Engine, state, "unresolved");

    const applied = applyPolicyMove(state, move, policy);
    if (!applied.ok) throw new Error(`Illegal ${engine} move ${move.pit}:${move.dir}: ${applied.error}`);
    state = applied.state;
  }

  if (state.adjudication?.kind === "repetition-draw") {
    return finalize(game, p0Engine, p1Engine, state, "repetition-draw");
  }
  if (state.adjudication?.kind === "max-ply-draw") {
    return finalize(game, p0Engine, p1Engine, state, "max-ply-draw");
  }
  if (state.game.status === "finished") {
    return finalize(game, p0Engine, p1Engine, state, "natural");
  }
  return finalize(game, p0Engine, p1Engine, state, "unresolved");
}

function finalize(
  game: number,
  p0Engine: EngineId,
  p1Engine: EngineId,
  state: PolicyState,
  finishKind: FinishKind,
): GameDetail {
  const winnerSeat = finishKind === "natural" ? state.game.winner : null;
  const winnerEngine = winnerSeat === null ? null : winnerSeat === "P0" ? p0Engine : p1Engine;
  const drawScoreMarginP0 = finishKind === "repetition-draw"
    ? state.game.scores.P0 - state.game.scores.P1
    : null;
  const drawLeader = drawScoreMarginP0 === null || drawScoreMarginP0 === 0
    ? null
    : drawScoreMarginP0 > 0 ? "P0" : "P1";
  return {
    game,
    p0Engine,
    p1Engine,
    finishKind,
    winnerSeat,
    winnerEngine,
    moves: state.game.moveNumber,
    policyPlies: state.plies,
    finalScores: { ...state.game.scores },
    drawScoreMarginP0,
    drawLeader,
  };
}

function chooseEngineMove(
  state: PolicyState,
  engine: EngineId,
  player: PlayerId,
  random: () => number,
): PlayerMove | null {
  if (engine === "aware-material" || engine === "aware-strategic") {
    const evaluationFamily: V3EvaluationFamily = engine === "aware-material" ? "material" : "strategic";
    return searchPolicyAwarePvsV5(state, policy, {
      evaluationFamily,
      maxDepth: pvsDepth,
      nodeBudget: pvsNodes,
      timeBudgetMs: pvsMs,
    }).move;
  }

  if (engine === "blind-strategic") {
    return searchNegamaxPvsV3(state.game, {
      evaluationFamily: "strategic",
      maxDepth: pvsDepth,
      nodeBudget: pvsNodes,
      timeBudgetMs: pvsMs,
    }).move;
  }

  const production = chooseServerProductionMove(state.game, "trang-nguyen", player, {
    mode: "production-max",
    timeBudgetMs: productionMs,
    nodeBudget: productionNodes,
    random,
  });
  return production ? { player, ...production } : null;
}

function readPolicy(raw: string): RepetitionPolicy {
  if (raw === "repeat2") return { kind: "repeat-draw", occurrences: 2 };
  if (raw === "repeat3") return { kind: "repeat-draw", occurrences: 3 };
  const match = /^max(\d+)$/.exec(raw);
  if (match?.[1]) return { kind: "max-ply", maxPlies: Number.parseInt(match[1], 10) };
  throw new Error(`Unknown policy ${raw}`);
}

function readEngine(name: string): EngineId {
  const value = requiredStringArg(name);
  if (value === "aware-material" || value === "aware-strategic" || value === "blind-strategic" || value === "trang-nguyen") return value;
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
