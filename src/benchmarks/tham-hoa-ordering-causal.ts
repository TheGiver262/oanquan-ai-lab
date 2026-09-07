import { applyMove, createInitialState } from "../engine.js";
import { chooseMctsMove, type MctsVariant } from "../research/mcts.js";
import { chooseIterativeOrderingExperimentMove } from "../research/iterative-ordering-experiment.js";
import { chooseServerProductionMoveWithDiagnostics } from "../reference/server-production-ai.js";
import type { PlayerId, PlayerMove } from "../types.js";

type OpponentMode = "server-baseline" | "fixed-opponent-ordering";
type SeatResult = { games: number; wins: number; losses: number; draws: number; unresolved: number };

const variant = readVariant();
const opponentMode = readOpponentMode();
const games = 6;
const seedBase = 20260908;
const timeBudgetMs = 600;
const aggregate = {
  mctsWins: 0,
  thamHoaWins: 0,
  draws: 0,
  unresolved: 0,
  mctsAsP0: emptySeat(),
  mctsAsP1: emptySeat(),
  gameDetails: [] as Array<{
    game: number;
    mctsSeat: PlayerId;
    winner: PlayerId | null;
    unresolved: boolean;
    moves: number;
    thamHoaAvgDepth: number;
    thamHoaAvgNodes: number;
  }>,
};

for (let index = 0; index < games; index += 1) {
  const mctsSeat: PlayerId = index % 2 === 0 ? "P0" : "P1";
  const seed = seedBase + index * 7919 + hashString(`${variant}:tham-hoa:production-max`);
  const game = playGame(index + 1, mctsSeat, seed);
  const seat = mctsSeat === "P0" ? aggregate.mctsAsP0 : aggregate.mctsAsP1;
  seat.games += 1;
  if (game.unresolved) {
    aggregate.unresolved += 1;
    seat.unresolved += 1;
  } else if (game.winner === null) {
    aggregate.draws += 1;
    seat.draws += 1;
  } else if (game.winner === mctsSeat) {
    aggregate.mctsWins += 1;
    seat.wins += 1;
  } else {
    aggregate.thamHoaWins += 1;
    seat.losses += 1;
  }
  aggregate.gameDetails.push(game);
}

console.log(JSON.stringify({
  difficulty: "tham-hoa",
  variant,
  opponentMode,
  isolatedChange: opponentMode === "fixed-opponent-ordering"
    ? "negate candidate.immediateGain only when ordering opponent nodes"
    : "none (exact server production baseline)",
  timeBudgetMs,
  games,
  ...aggregate,
}, null, 2));

function playGame(gameNumber: number, mctsSeat: PlayerId, seed: number) {
  let state = createInitialState();
  const researchRandom = mulberry32(seed ^ 0x9e3779b9);
  const productionRandom = mulberry32(seed ^ 0x85ebca6b);
  const depths: number[] = [];
  const nodes: number[] = [];

  while (state.status === "playing" && state.moveNumber < 160) {
    const player = state.currentPlayer;
    let move: PlayerMove | null = null;

    if (player === mctsSeat) {
      move = chooseMctsMove(state, {
        variant,
        simulations: 100_000,
        timeBudgetMs,
        rolloutDepth: 20,
        random: researchRandom,
      }).move;
    } else if (opponentMode === "server-baseline") {
      const decision = chooseServerProductionMoveWithDiagnostics(state, "tham-hoa", player, {
        mode: "production-max",
        timeBudgetMs,
        random: productionRandom,
      });
      depths.push(decision.completedDepth);
      nodes.push(decision.nodeCount);
      move = decision.move ? { player, ...decision.move } : null;
    } else {
      const decision = chooseIterativeOrderingExperimentMove(state, "tham-hoa", player, {
        orderingMode: "fixed-opponent-ordering",
        timeBudgetMs,
        random: productionRandom,
      });
      depths.push(decision.completedDepth);
      nodes.push(decision.nodeCount);
      move = decision.move ? { player, ...decision.move } : null;
    }

    if (!move) {
      return summarize(gameNumber, mctsSeat, null, true, state.moveNumber, depths, nodes);
    }
    const applied = applyMove(state, move);
    if (!applied.ok) throw new Error(`Illegal ${player} move ${move.pit}:${move.dir}: ${applied.error}`);
    state = applied.state;
  }

  return summarize(
    gameNumber,
    mctsSeat,
    state.status === "finished" ? state.winner : null,
    state.status !== "finished",
    state.moveNumber,
    depths,
    nodes,
  );
}

function summarize(
  game: number,
  mctsSeat: PlayerId,
  winner: PlayerId | null,
  unresolved: boolean,
  moves: number,
  depths: number[],
  nodes: number[],
) {
  return {
    game,
    mctsSeat,
    winner,
    unresolved,
    moves,
    thamHoaAvgDepth: average(depths),
    thamHoaAvgNodes: average(nodes),
  };
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function emptySeat(): SeatResult {
  return { games: 0, wins: 0, losses: 0, draws: 0, unresolved: 0 };
}

function readVariant(): MctsVariant {
  const value = stringArg("--variant") ?? "uct";
  if (value === "uct" || value === "uct-pb") return value;
  throw new Error(`Unknown variant: ${value}`);
}

function readOpponentMode(): OpponentMode {
  const value = stringArg("--opponent-mode") ?? "server-baseline";
  if (value === "server-baseline" || value === "fixed-opponent-ordering") return value;
  throw new Error(`Unknown opponent mode: ${value}`);
}

function stringArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
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
