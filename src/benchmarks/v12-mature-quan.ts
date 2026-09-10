import { applyMove, createInitialState, getLegalMoves, MATURE_QUAN_RULESET } from "../engine.js";
import { chooseMctsMove } from "../research/mcts.js";
import { searchNegamaxPvsV3 } from "../research/negamax-pvs-v3.js";
import {
  PRODUCTION_SOURCE_COMMIT,
  chooseServerProductionMove,
} from "../reference/server-production-ai.js";
import type { GameState, PlayerId, PlayerMove } from "../types.js";

type EngineId = "uct-pb" | "pvs-strategic" | "trang-nguyen";
type SeatStats = { games: number; wins: number; losses: number; draws: number; unresolved: number };
type RuntimeStats = { decisions: number; elapsedMs: number };
type GameDetail = {
  game: number;
  seed: number;
  p0Agent: "A" | "B";
  p1Agent: "A" | "B";
  p0Engine: EngineId;
  p1Engine: EngineId;
  openingMove: string | null;
  winnerSeat: PlayerId | null;
  winnerAgent: "A" | "B" | null;
  winnerEngine: EngineId | null;
  unresolved: boolean;
  moves: number;
  finalScores: { P0: number; P1: number };
};

const engineA = readEngine("--a");
const engineB = readEngine("--b");
const games = evenIntArg("--games", 12);
const timeBudgetMs = intArg("--ms", 1_200);
const nodeBudget = intArg("--nodes", 500_000);
const mctsSimulations = intArg("--simulations", 200_000);
const rolloutDepth = intArg("--rollout-depth", 20);
const pvsDepth = intArg("--pvs-depth", 16);
const maxMoves = intArg("--max-moves", 220);
const seedBase = intArg("--seed", 20261211);

const aggregate = {
  agentAWins: 0,
  agentBWins: 0,
  draws: 0,
  unresolved: 0,
  p0Wins: 0,
  p1Wins: 0,
  totalMoves: 0,
  agentAAsP0: emptySeat(),
  agentAAsP1: emptySeat(),
  runtimeA: { decisions: 0, elapsedMs: 0 } as RuntimeStats,
  runtimeB: { decisions: 0, elapsedMs: 0 } as RuntimeStats,
  openings: new Map<string, number>(),
  details: [] as GameDetail[],
};

for (let index = 0; index < games; index += 1) {
  const p0Agent: "A" | "B" = index % 2 === 0 ? "A" : "B";
  const p1Agent: "A" | "B" = p0Agent === "A" ? "B" : "A";
  const seed = seedBase + index * 7_919 + hashString(`${engineA}:${engineB}:mature-quan`);
  const detail = playGame(index + 1, p0Agent, p1Agent, seed);
  aggregate.details.push(detail);
  aggregate.totalMoves += detail.moves;
  if (detail.openingMove) aggregate.openings.set(detail.openingMove, (aggregate.openings.get(detail.openingMove) ?? 0) + 1);

  const aSeat = p0Agent === "A" ? aggregate.agentAAsP0 : aggregate.agentAAsP1;
  aSeat.games += 1;
  if (detail.unresolved) {
    aggregate.unresolved += 1;
    aSeat.unresolved += 1;
  } else if (detail.winnerAgent === null) {
    aggregate.draws += 1;
    aSeat.draws += 1;
  } else if (detail.winnerAgent === "A") {
    aggregate.agentAWins += 1;
    aSeat.wins += 1;
  } else {
    aggregate.agentBWins += 1;
    aSeat.losses += 1;
  }
  if (!detail.unresolved && detail.winnerSeat === "P0") aggregate.p0Wins += 1;
  if (!detail.unresolved && detail.winnerSeat === "P1") aggregate.p1Wins += 1;
}

const completed = games - aggregate.unresolved;
console.log(JSON.stringify({
  methodology: {
    phase: "V12 Mature Quan algorithm and balance screening",
    rules: "mature_quan_v1: a Quan pit that still contains its Quan stone can only be captured with at least 5 citizen stones; otherwise the capture chain stops",
    start: "true initial position; no forced opening, no Pie/Swap, no research threefold adjudication",
    seatBalance: "Agents A and B alternate P0/P1 every game",
    resourcePrimary: "equal wall-clock budget per move; algorithm-specific node/simulation caps reported separately",
    productionBaseline: "frozen server production-reference Trạng Nguyên in production-max mode, without a live learning snapshot",
    productionSourceCommit: PRODUCTION_SOURCE_COMMIT,
  },
  engines: { A: engineA, B: engineB },
  config: { games, timeBudgetMs, nodeBudget, mctsSimulations, rolloutDepth, pvsDepth, maxMoves, seedBase },
  aggregate: {
    agentAWins: aggregate.agentAWins,
    agentBWins: aggregate.agentBWins,
    draws: aggregate.draws,
    unresolved: aggregate.unresolved,
    p0Wins: aggregate.p0Wins,
    p1Wins: aggregate.p1Wins,
    agentAScoreRate: completed === 0 ? 0 : (aggregate.agentAWins + aggregate.draws * 0.5) / completed,
    p0ScoreRate: completed === 0 ? 0 : (aggregate.p0Wins + aggregate.draws * 0.5) / completed,
    averageMoves: aggregate.totalMoves / games,
    agentAAsP0: aggregate.agentAAsP0,
    agentAAsP1: aggregate.agentAAsP1,
    runtimeA: withAverage(aggregate.runtimeA),
    runtimeB: withAverage(aggregate.runtimeB),
    openings: Object.fromEntries([...aggregate.openings.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
  },
  details: aggregate.details,
}, null, 2));

function playGame(game: number, p0Agent: "A" | "B", p1Agent: "A" | "B", seed: number): GameDetail {
  let state = createInitialState(MATURE_QUAN_RULESET);
  const randomA = mulberry32(seed ^ 0x9e3779b9);
  const randomB = mulberry32(seed ^ 0x85ebca6b);
  let openingMove: string | null = null;

  while (state.status === "playing" && state.moveNumber < maxMoves) {
    const player = state.currentPlayer;
    const agent = player === "P0" ? p0Agent : p1Agent;
    const engine = agent === "A" ? engineA : engineB;
    const random = agent === "A" ? randomA : randomB;
    const started = performance.now();
    const move = chooseEngineMove(state, engine, player, random);
    const elapsed = performance.now() - started;
    const runtime = agent === "A" ? aggregate.runtimeA : aggregate.runtimeB;
    runtime.decisions += 1;
    runtime.elapsedMs += elapsed;
    if (!move) return finalize(game, seed, p0Agent, p1Agent, state, openingMove, true);
    if (state.moveNumber === 0) openingMove = `${move.pit}:${move.dir}`;
    const applied = applyMove(state, move);
    if (!applied.ok) throw new Error(`Illegal ${engine} move ${move.pit}:${move.dir}: ${applied.error}`);
    state = applied.state;
  }
  return finalize(game, seed, p0Agent, p1Agent, state, openingMove, state.status !== "finished");
}

function chooseEngineMove(state: GameState, engine: EngineId, player: PlayerId, random: () => number): PlayerMove | null {
  if (engine === "uct-pb") {
    return chooseMctsMove(state, {
      variant: "uct-pb",
      simulations: mctsSimulations,
      timeBudgetMs,
      rolloutDepth,
      random,
    }).move;
  }
  if (engine === "pvs-strategic") {
    return searchNegamaxPvsV3(state, {
      evaluationFamily: "strategic",
      maxDepth: pvsDepth,
      nodeBudget,
      timeBudgetMs,
      usePvs: true,
      useTranspositionTable: true,
    }).move;
  }
  const move = chooseServerProductionMove(state, "trang-nguyen", player, {
    mode: "production-max",
    timeBudgetMs,
    nodeBudget,
    random,
  });
  return move ? { player, ...move } : null;
}

function finalize(
  game: number,
  seed: number,
  p0Agent: "A" | "B",
  p1Agent: "A" | "B",
  state: GameState,
  openingMove: string | null,
  unresolved: boolean,
): GameDetail {
  const winnerSeat = unresolved ? null : state.winner;
  const winnerAgent = winnerSeat === null ? null : winnerSeat === "P0" ? p0Agent : p1Agent;
  return {
    game,
    seed,
    p0Agent,
    p1Agent,
    p0Engine: p0Agent === "A" ? engineA : engineB,
    p1Engine: p1Agent === "A" ? engineA : engineB,
    openingMove,
    winnerSeat,
    winnerAgent,
    winnerEngine: winnerAgent === null ? null : winnerAgent === "A" ? engineA : engineB,
    unresolved,
    moves: state.moveNumber,
    finalScores: { ...state.scores },
  };
}

function emptySeat(): SeatStats { return { games: 0, wins: 0, losses: 0, draws: 0, unresolved: 0 }; }
function withAverage(runtime: RuntimeStats) {
  return { ...runtime, averageDecisionMs: runtime.decisions === 0 ? 0 : runtime.elapsedMs / runtime.decisions };
}
function readEngine(name: string): EngineId {
  const value = requiredStringArg(name);
  if (value === "uct-pb" || value === "pvs-strategic" || value === "trang-nguyen") return value;
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
function hashString(value: string): number {
  let hash = 2166136261;
  for (const char of value) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
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
