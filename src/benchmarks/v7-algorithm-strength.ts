import { applyMove, createInitialState, getLegalMoves } from "../engine.js";
import { chooseMctsMove } from "../research/mcts.js";
import { searchNegamaxPvsV3 } from "../research/negamax-pvs-v3.js";
import { parseClassicOpening } from "../research/opening-pie-analysis.js";
import {
  PRODUCTION_SOURCE_COMMIT,
  chooseServerProductionMove,
} from "../reference/server-production-ai.js";
import type { PlayerId, PlayerMove } from "../types.js";

type EngineId = "pvs-strategic" | "uct-pb" | "trang-nguyen" | "bang-nhan";
type OpeningSpec = "none" | `${string}:${"CW" | "CCW"}`;

type EngineSeatResult = {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  unresolved: number;
};

type EngineRuntime = {
  decisions: number;
  elapsedMs: number;
};

type GameDetail = {
  game: number;
  p0Engine: EngineId;
  p1Engine: EngineId;
  winnerSeat: PlayerId | null;
  winnerEngine: EngineId | null;
  unresolved: boolean;
  moves: number;
  finalScores: { P0: number; P1: number };
};

const engineA = readEngine("--a");
const engineB = readEngine("--b");
if (engineA === engineB) throw new Error("--a and --b must differ");
const opening = readOpening();
const games = evenIntArg("--games", 4);
const timeBudgetMs = intArg("--ms", 600);
const nodeBudget = intArg("--nodes", 100_000);
const mctsSimulations = intArg("--simulations", 100_000);
const rolloutDepth = intArg("--rollout-depth", 20);
const pvsDepth = intArg("--pvs-depth", 14);
const maxMoves = intArg("--max-moves", 180);
const seedBase = intArg("--seed", 20260908);

const aggregate = {
  engineAWins: 0,
  engineBWins: 0,
  draws: 0,
  unresolved: 0,
  p0Wins: 0,
  p1Wins: 0,
  totalMoves: 0,
  engineAAsP0: emptySeat(),
  engineAAsP1: emptySeat(),
  runtime: {
    [engineA]: { decisions: 0, elapsedMs: 0 },
    [engineB]: { decisions: 0, elapsedMs: 0 },
  } as Record<EngineId, EngineRuntime>,
  details: [] as GameDetail[],
};

for (let index = 0; index < games; index += 1) {
  const p0Engine = index % 2 === 0 ? engineA : engineB;
  const p1Engine = index % 2 === 0 ? engineB : engineA;
  const seed = seedBase + index * 7_919 + hashString(`${engineA}:${engineB}:${opening}`);
  const detail = playGame(index + 1, p0Engine, p1Engine, seed);
  aggregate.details.push(detail);
  aggregate.totalMoves += detail.moves;

  const aSeat = p0Engine === engineA ? aggregate.engineAAsP0 : aggregate.engineAAsP1;
  aSeat.games += 1;

  if (detail.unresolved) {
    aggregate.unresolved += 1;
    aSeat.unresolved += 1;
    continue;
  }
  if (detail.winnerSeat === null) {
    aggregate.draws += 1;
    aSeat.draws += 1;
    continue;
  }

  if (detail.winnerSeat === "P0") aggregate.p0Wins += 1;
  else aggregate.p1Wins += 1;

  if (detail.winnerEngine === engineA) {
    aggregate.engineAWins += 1;
    aSeat.wins += 1;
  } else {
    aggregate.engineBWins += 1;
    aSeat.losses += 1;
  }
}

const completed = games - aggregate.unresolved;
console.log(JSON.stringify({
  methodology: {
    phase: "V7 raw algorithm strength",
    rules: "canonical current classic game; no research repetition adjudication",
    opening: opening === "none"
      ? "engines choose from the true initial position"
      : `forced ${opening} is applied before engine control`,
    seatBalance: "Engine A and B alternate P0/P1 every game",
    resourcePrimary: "equal wall-clock budget per move; node/simulation caps are reported because units differ by algorithm",
    productionBaselines: "server production-reference in production-max mode, without a live Trạng Nguyên learning snapshot",
    claimLimit: "small research tournament; use as strength-screening evidence, not final Elo",
    productionSourceCommit: PRODUCTION_SOURCE_COMMIT,
  },
  engines: { a: engineA, b: engineB },
  config: {
    games,
    opening,
    timeBudgetMs,
    nodeBudget,
    mctsSimulations,
    rolloutDepth,
    pvsDepth,
    maxMoves,
    seedBase,
  },
  aggregate: {
    engineAWins: aggregate.engineAWins,
    engineBWins: aggregate.engineBWins,
    draws: aggregate.draws,
    unresolved: aggregate.unresolved,
    p0Wins: aggregate.p0Wins,
    p1Wins: aggregate.p1Wins,
    engineAScoreRate: completed === 0 ? 0 : (aggregate.engineAWins + aggregate.draws * 0.5) / completed,
    averageMoves: aggregate.totalMoves / games,
    engineAAsP0: aggregate.engineAAsP0,
    engineAAsP1: aggregate.engineAAsP1,
    runtime: Object.fromEntries(Object.entries(aggregate.runtime).map(([engine, runtime]) => [engine, {
      ...runtime,
      averageDecisionMs: runtime.decisions === 0 ? 0 : runtime.elapsedMs / runtime.decisions,
    }])),
  },
  details: aggregate.details,
}, null, 2));

function playGame(game: number, p0Engine: EngineId, p1Engine: EngineId, seed: number): GameDetail {
  let state = createInitialState();
  if (opening !== "none") {
    const parsed = parseClassicOpening(opening);
    const forced = getLegalMoves(state).find((move) => move.pit === parsed.pit && move.dir === parsed.dir);
    if (!forced) throw new Error(`Illegal forced opening ${opening}`);
    const applied = applyMove(state, forced);
    if (!applied.ok) throw new Error(`Failed forced opening ${opening}: ${applied.error}`);
    state = applied.state;
  }

  const randomP0 = mulberry32(seed ^ 0x9e3779b9);
  const randomP1 = mulberry32(seed ^ 0x85ebca6b);

  while (state.status === "playing" && state.moveNumber < maxMoves) {
    const player = state.currentPlayer;
    const engine = player === "P0" ? p0Engine : p1Engine;
    const random = player === "P0" ? randomP0 : randomP1;
    const started = performance.now();
    const move = chooseEngineMove(state, engine, player, random);
    const elapsed = performance.now() - started;
    const runtime = aggregate.runtime[engine] ?? (aggregate.runtime[engine] = { decisions: 0, elapsedMs: 0 });
    runtime.decisions += 1;
    runtime.elapsedMs += elapsed;

    if (!move) return finalize(game, p0Engine, p1Engine, state, true);
    const applied = applyMove(state, move);
    if (!applied.ok) throw new Error(`Illegal ${engine} move ${move.pit}:${move.dir}: ${applied.error}`);
    state = applied.state;
  }

  return finalize(game, p0Engine, p1Engine, state, state.status !== "finished");
}

function chooseEngineMove(
  state: ReturnType<typeof createInitialState>,
  engine: EngineId,
  player: PlayerId,
  random: () => number,
): PlayerMove | null {
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
  if (engine === "uct-pb") {
    return chooseMctsMove(state, {
      variant: "uct-pb",
      simulations: mctsSimulations,
      timeBudgetMs,
      rolloutDepth,
      random,
    }).move;
  }

  const difficulty = engine === "trang-nguyen" ? "trang-nguyen" : "bang-nhan";
  const production = chooseServerProductionMove(state, difficulty, player, {
    mode: "production-max",
    timeBudgetMs,
    nodeBudget,
    random,
  });
  return production ? { player, ...production } : null;
}

function finalize(
  game: number,
  p0Engine: EngineId,
  p1Engine: EngineId,
  state: ReturnType<typeof createInitialState>,
  unresolved: boolean,
): GameDetail {
  const winnerSeat = unresolved ? null : state.winner;
  return {
    game,
    p0Engine,
    p1Engine,
    winnerSeat,
    winnerEngine: winnerSeat === null ? null : winnerSeat === "P0" ? p0Engine : p1Engine,
    unresolved,
    moves: state.moveNumber,
    finalScores: { ...state.scores },
  };
}

function emptySeat(): EngineSeatResult {
  return { games: 0, wins: 0, losses: 0, draws: 0, unresolved: 0 };
}

function readEngine(name: string): EngineId {
  const value = requiredStringArg(name);
  if (value === "pvs-strategic" || value === "uct-pb" || value === "trang-nguyen" || value === "bang-nhan") return value;
  throw new Error(`Unknown engine ${value}`);
}

function readOpening(): OpeningSpec {
  const value = stringArg("--opening") ?? "none";
  if (value === "none") return value;
  const parsed = parseClassicOpening(value);
  return `${parsed.pit}:${parsed.dir}`;
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
