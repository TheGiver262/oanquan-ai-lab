import { createInitialState, getLegalMoves } from "../engine.js";
import { choosePolicyMctsMoveV7 } from "../research/policy-mcts-v7.js";
import { parseClassicOpening } from "../research/opening-pie-analysis.js";
import {
  applyPolicyMove,
  createPolicyState,
  type PolicyState,
} from "../research/repetition-policy-v5.js";
import type { PlayerId, PlayerMove } from "../types.js";

type FinishKind = "natural" | "repetition-draw" | "unresolved";

type GameDetail = {
  game: number;
  seed: number;
  finishKind: FinishKind;
  winner: PlayerId | null;
  moves: number;
  scores: { P0: number; P1: number };
  repetitionMarginP0: number | null;
  p0RolloutPolicyDraws: number;
  p1RolloutPolicyDraws: number;
};

const THREEFOLD = { kind: "repeat-draw", occurrences: 3 } as const;
const openingRaw = requiredStringArg("--opening");
const opening = openingRaw === "none" ? null : parseClassicOpening(openingRaw);
const games = intArg("--games", 12);
const timeBudgetMs = intArg("--ms", 500);
const simulations = intArg("--simulations", 100_000);
const rolloutDepth = intArg("--rollout-depth", 20);
const maxMoves = intArg("--max-moves", 240);
const seedBase = intArg("--seed", 20260908);

const details: GameDetail[] = [];
const aggregate = {
  p0Wins: 0,
  p1Wins: 0,
  naturalDraws: 0,
  repetitionDraws: 0,
  unresolved: 0,
  totalMoves: 0,
  repetitionAbsMarginTotal: 0,
  repetitionDrawsWithLeader: 0,
  p0DecisionMs: 0,
  p1DecisionMs: 0,
  p0Decisions: 0,
  p1Decisions: 0,
  p0RolloutPolicyDraws: 0,
  p1RolloutPolicyDraws: 0,
};

for (let index = 0; index < games; index += 1) {
  const seed = seedBase + index * 7_919 + hashString(openingRaw);
  const detail = playGame(index + 1, seed);
  details.push(detail);
  aggregate.totalMoves += detail.moves;
  aggregate.p0RolloutPolicyDraws += detail.p0RolloutPolicyDraws;
  aggregate.p1RolloutPolicyDraws += detail.p1RolloutPolicyDraws;

  if (detail.finishKind === "unresolved") aggregate.unresolved += 1;
  else if (detail.finishKind === "repetition-draw") {
    aggregate.repetitionDraws += 1;
    const margin = Math.abs(detail.repetitionMarginP0 ?? 0);
    aggregate.repetitionAbsMarginTotal += margin;
    if (margin > 0) aggregate.repetitionDrawsWithLeader += 1;
  } else if (detail.winner === null) aggregate.naturalDraws += 1;
  else if (detail.winner === "P0") aggregate.p0Wins += 1;
  else aggregate.p1Wins += 1;
}

const completed = games - aggregate.unresolved;
console.log(JSON.stringify({
  methodology: {
    phase: "V7 stochastic seat-fairness",
    engine: "policy-aware UCT-PB controls both seats with independent seeded RNG streams",
    policy: "threefold repeated strategic position is an exact draw in both tree search and actual match adjudication",
    opening: opening === null ? "unrestricted initial position" : `forced ${opening.pit}:${opening.dir}`,
    objective: "isolate P0/P1 protocol bias from cross-engine strength differences",
    claimLimit: "bounded stochastic self-play; this is candidate-mode statistical evidence, not a game-theoretic proof",
  },
  config: {
    games,
    opening: opening === null ? "none" : `${opening.pit}:${opening.dir}`,
    policy: THREEFOLD,
    timeBudgetMs,
    simulations,
    rolloutDepth,
    maxMoves,
    seedBase,
  },
  aggregate: {
    p0Wins: aggregate.p0Wins,
    p1Wins: aggregate.p1Wins,
    naturalDraws: aggregate.naturalDraws,
    repetitionDraws: aggregate.repetitionDraws,
    unresolved: aggregate.unresolved,
    p0ScoreRate: completed === 0 ? 0 : (aggregate.p0Wins + (aggregate.naturalDraws + aggregate.repetitionDraws) * 0.5) / completed,
    p1ScoreRate: completed === 0 ? 0 : (aggregate.p1Wins + (aggregate.naturalDraws + aggregate.repetitionDraws) * 0.5) / completed,
    repetitionDrawRate: aggregate.repetitionDraws / games,
    averageAbsScoreMarginAtRepetitionDraw: aggregate.repetitionDraws === 0
      ? 0
      : aggregate.repetitionAbsMarginTotal / aggregate.repetitionDraws,
    repetitionDrawsWithLeader: aggregate.repetitionDrawsWithLeader,
    averageMoves: aggregate.totalMoves / games,
    runtime: {
      p0AverageDecisionMs: aggregate.p0Decisions === 0 ? 0 : aggregate.p0DecisionMs / aggregate.p0Decisions,
      p1AverageDecisionMs: aggregate.p1Decisions === 0 ? 0 : aggregate.p1DecisionMs / aggregate.p1Decisions,
      p0RolloutPolicyDraws: aggregate.p0RolloutPolicyDraws,
      p1RolloutPolicyDraws: aggregate.p1RolloutPolicyDraws,
    },
  },
  details,
}, null, 2));

function playGame(game: number, seed: number): GameDetail {
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
  let p0RolloutPolicyDraws = 0;
  let p1RolloutPolicyDraws = 0;

  while (state.game.status === "playing" && state.adjudication === null && state.game.moveNumber < maxMoves) {
    const player = state.game.currentPlayer;
    const started = performance.now();
    const decision = choosePolicyMctsMoveV7(state, THREEFOLD, {
      variant: "uct-pb",
      simulations,
      timeBudgetMs,
      rolloutDepth,
      random: player === "P0" ? randomP0 : randomP1,
    });
    const elapsed = performance.now() - started;
    if (player === "P0") {
      aggregate.p0DecisionMs += elapsed;
      aggregate.p0Decisions += 1;
      p0RolloutPolicyDraws += decision.diagnostics.policyDrawRollouts;
    } else {
      aggregate.p1DecisionMs += elapsed;
      aggregate.p1Decisions += 1;
      p1RolloutPolicyDraws += decision.diagnostics.policyDrawRollouts;
    }

    const move: PlayerMove | null = decision.move;
    if (!move) return finalize(game, seed, state, "unresolved", p0RolloutPolicyDraws, p1RolloutPolicyDraws);
    const applied = applyPolicyMove(state, move, THREEFOLD);
    if (!applied.ok) throw new Error(`Illegal ${player} move ${move.pit}:${move.dir}: ${applied.error}`);
    state = applied.state;
  }

  if (state.adjudication?.kind === "repetition-draw") {
    return finalize(game, seed, state, "repetition-draw", p0RolloutPolicyDraws, p1RolloutPolicyDraws);
  }
  if (state.game.status === "finished") {
    return finalize(game, seed, state, "natural", p0RolloutPolicyDraws, p1RolloutPolicyDraws);
  }
  return finalize(game, seed, state, "unresolved", p0RolloutPolicyDraws, p1RolloutPolicyDraws);
}

function finalize(
  game: number,
  seed: number,
  state: PolicyState,
  finishKind: FinishKind,
  p0RolloutPolicyDraws: number,
  p1RolloutPolicyDraws: number,
): GameDetail {
  return {
    game,
    seed,
    finishKind,
    winner: finishKind === "natural" ? state.game.winner : null,
    moves: state.game.moveNumber,
    scores: { ...state.game.scores },
    repetitionMarginP0: finishKind === "repetition-draw" ? state.game.scores.P0 - state.game.scores.P1 : null,
    p0RolloutPolicyDraws,
    p1RolloutPolicyDraws,
  };
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
