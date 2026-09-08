import { createInitialState, getLegalMoves } from "../engine.js";
import { choosePolicyMctsMoveV7 } from "../research/policy-mcts-v7.js";
import { searchPolicyAwarePvsV5 } from "../research/policy-aware-pvs-v5.js";
import { parseClassicOpening } from "../research/opening-pie-analysis.js";
import {
  applyPolicyMove,
  createPolicyState,
  type PolicyState,
} from "../research/repetition-policy-v5.js";
import type { PlayerId, PlayerMove } from "../types.js";

type EngineId = "policy-pvs" | "policy-uct-pb";
type FinishKind = "natural" | "repetition-draw" | "unresolved";

type SeatResult = {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  unresolved: number;
};

type GameDetail = {
  game: number;
  p0Engine: EngineId;
  p1Engine: EngineId;
  finishKind: FinishKind;
  winnerSeat: PlayerId | null;
  winnerEngine: EngineId | null;
  moves: number;
  finalScores: { P0: number; P1: number };
  repetitionMarginP0: number | null;
};

const THREEFOLD = { kind: "repeat-draw", occurrences: 3 } as const;
const openingRaw = requiredStringArg("--opening");
const opening = openingRaw === "none" ? null : parseClassicOpening(openingRaw);
const games = evenIntArg("--games", 6);
const timeBudgetMs = intArg("--ms", 400);
const pvsNodes = intArg("--pvs-nodes", 50_000);
const pvsDepth = intArg("--pvs-depth", 12);
const mctsSimulations = intArg("--mcts-simulations", 100_000);
const rolloutDepth = intArg("--rollout-depth", 20);
const maxMoves = intArg("--max-moves", 240);
const seedBase = intArg("--seed", 20260908);

const aggregate = {
  pvsWins: 0,
  mctsWins: 0,
  repetitionDraws: 0,
  naturalDraws: 0,
  unresolved: 0,
  p0Wins: 0,
  p1Wins: 0,
  totalMoves: 0,
  pvsAsP0: emptySeat(),
  pvsAsP1: emptySeat(),
  repetitionAbsMarginTotal: 0,
  repetitionDrawsWithLeader: 0,
  runtime: {
    "policy-pvs": { decisions: 0, elapsedMs: 0 },
    "policy-uct-pb": { decisions: 0, elapsedMs: 0 },
  },
  mctsRolloutPolicyDraws: 0,
  details: [] as GameDetail[],
};

for (let index = 0; index < games; index += 1) {
  const p0Engine: EngineId = index % 2 === 0 ? "policy-pvs" : "policy-uct-pb";
  const p1Engine: EngineId = index % 2 === 0 ? "policy-uct-pb" : "policy-pvs";
  const seed = seedBase + index * 7_919 + hashString(openingRaw);
  const detail = playGame(index + 1, p0Engine, p1Engine, seed);
  aggregate.details.push(detail);
  aggregate.totalMoves += detail.moves;

  const pvsSeat = p0Engine === "policy-pvs" ? aggregate.pvsAsP0 : aggregate.pvsAsP1;
  pvsSeat.games += 1;

  if (detail.finishKind === "unresolved") {
    aggregate.unresolved += 1;
    pvsSeat.unresolved += 1;
    continue;
  }
  if (detail.finishKind === "repetition-draw") {
    aggregate.repetitionDraws += 1;
    pvsSeat.draws += 1;
    const margin = Math.abs(detail.repetitionMarginP0 ?? 0);
    aggregate.repetitionAbsMarginTotal += margin;
    if (margin > 0) aggregate.repetitionDrawsWithLeader += 1;
    continue;
  }
  if (detail.winnerSeat === null) {
    aggregate.naturalDraws += 1;
    pvsSeat.draws += 1;
    continue;
  }

  if (detail.winnerSeat === "P0") aggregate.p0Wins += 1;
  else aggregate.p1Wins += 1;
  if (detail.winnerEngine === "policy-pvs") {
    aggregate.pvsWins += 1;
    pvsSeat.wins += 1;
  } else {
    aggregate.mctsWins += 1;
    pvsSeat.losses += 1;
  }
}

const completed = games - aggregate.unresolved;
console.log(JSON.stringify({
  methodology: {
    phase: "V7 candidate-mode cross-engine tournament",
    rules: "canonical classic transitions plus research threefold repetition draw",
    engines: "both engines receive the full PolicyState; neither is blind to repetition",
    opening: opening === null
      ? "unrestricted initial position"
      : `forced ${opening.pit}:${opening.dir} before engine control`,
    seatBalance: "policy-PVS and policy-UCT-PB alternate P0/P1 every game",
    objective: "measure engine consensus, seat bias, repetition draw behavior, and game length under a candidate competitive protocol",
    claimLimit: "bounded cross-engine self-play; balanced-mode label still requires broader protocol/ruleset tournament",
  },
  config: {
    games,
    opening: opening === null ? "none" : `${opening.pit}:${opening.dir}`,
    policy: THREEFOLD,
    timeBudgetMs,
    pvsNodes,
    pvsDepth,
    mctsSimulations,
    rolloutDepth,
    maxMoves,
    seedBase,
  },
  aggregate: {
    pvsWins: aggregate.pvsWins,
    mctsWins: aggregate.mctsWins,
    repetitionDraws: aggregate.repetitionDraws,
    naturalDraws: aggregate.naturalDraws,
    unresolved: aggregate.unresolved,
    p0Wins: aggregate.p0Wins,
    p1Wins: aggregate.p1Wins,
    pvsScoreRate: completed === 0 ? 0 : (aggregate.pvsWins + (aggregate.repetitionDraws + aggregate.naturalDraws) * 0.5) / completed,
    repetitionDrawRate: aggregate.repetitionDraws / games,
    averageAbsScoreMarginAtRepetitionDraw: aggregate.repetitionDraws === 0
      ? 0
      : aggregate.repetitionAbsMarginTotal / aggregate.repetitionDraws,
    repetitionDrawsWithLeader: aggregate.repetitionDrawsWithLeader,
    averageMoves: aggregate.totalMoves / games,
    pvsAsP0: aggregate.pvsAsP0,
    pvsAsP1: aggregate.pvsAsP1,
    runtime: {
      pvsAverageDecisionMs: aggregate.runtime["policy-pvs"].decisions === 0
        ? 0
        : aggregate.runtime["policy-pvs"].elapsedMs / aggregate.runtime["policy-pvs"].decisions,
      mctsAverageDecisionMs: aggregate.runtime["policy-uct-pb"].decisions === 0
        ? 0
        : aggregate.runtime["policy-uct-pb"].elapsedMs / aggregate.runtime["policy-uct-pb"].decisions,
      mctsRolloutPolicyDraws: aggregate.mctsRolloutPolicyDraws,
    },
  },
  details: aggregate.details,
}, null, 2));

function playGame(game: number, p0Engine: EngineId, p1Engine: EngineId, seed: number): GameDetail {
  let state = createPolicyState(createInitialState());
  if (opening !== null) {
    const forced = getLegalMoves(state.game).find((move) => move.pit === opening.pit && move.dir === opening.dir);
    if (!forced) throw new Error(`Illegal forced opening ${opening.pit}:${opening.dir}`);
    const applied = applyPolicyMove(state, forced, THREEFOLD);
    if (!applied.ok) throw new Error(`Failed forced opening: ${applied.error}`);
    state = applied.state;
  }

  const randomP0 = mulberry32(seed ^ 0x9e3779b9);
  const randomP1 = mulberry32(seed ^ 0x85ebca6b);

  while (state.game.status === "playing" && state.adjudication === null && state.game.moveNumber < maxMoves) {
    const player = state.game.currentPlayer;
    const engine = player === "P0" ? p0Engine : p1Engine;
    const random = player === "P0" ? randomP0 : randomP1;
    const started = performance.now();
    const move = chooseEngineMove(state, engine, random);
    aggregate.runtime[engine].decisions += 1;
    aggregate.runtime[engine].elapsedMs += performance.now() - started;

    if (!move) return finalize(game, p0Engine, p1Engine, state, "unresolved");
    const applied = applyPolicyMove(state, move, THREEFOLD);
    if (!applied.ok) throw new Error(`Illegal ${engine} move ${move.pit}:${move.dir}: ${applied.error}`);
    state = applied.state;
  }

  if (state.adjudication?.kind === "repetition-draw") return finalize(game, p0Engine, p1Engine, state, "repetition-draw");
  if (state.game.status === "finished") return finalize(game, p0Engine, p1Engine, state, "natural");
  return finalize(game, p0Engine, p1Engine, state, "unresolved");
}

function chooseEngineMove(state: PolicyState, engine: EngineId, random: () => number): PlayerMove | null {
  if (engine === "policy-pvs") {
    return searchPolicyAwarePvsV5(state, THREEFOLD, {
      evaluationFamily: "strategic",
      maxDepth: pvsDepth,
      nodeBudget: pvsNodes,
      timeBudgetMs,
      usePvs: true,
    }).move;
  }

  const decision = choosePolicyMctsMoveV7(state, THREEFOLD, {
    variant: "uct-pb",
    simulations: mctsSimulations,
    timeBudgetMs,
    rolloutDepth,
    random,
  });
  aggregate.mctsRolloutPolicyDraws += decision.diagnostics.policyDrawRollouts;
  return decision.move;
}

function finalize(
  game: number,
  p0Engine: EngineId,
  p1Engine: EngineId,
  state: PolicyState,
  finishKind: FinishKind,
): GameDetail {
  const winnerSeat = finishKind === "natural" ? state.game.winner : null;
  return {
    game,
    p0Engine,
    p1Engine,
    finishKind,
    winnerSeat,
    winnerEngine: winnerSeat === null ? null : winnerSeat === "P0" ? p0Engine : p1Engine,
    moves: state.game.moveNumber,
    finalScores: { ...state.game.scores },
    repetitionMarginP0: finishKind === "repetition-draw" ? state.game.scores.P0 - state.game.scores.P1 : null,
  };
}

function emptySeat(): SeatResult {
  return { games: 0, wins: 0, losses: 0, draws: 0, unresolved: 0 };
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
