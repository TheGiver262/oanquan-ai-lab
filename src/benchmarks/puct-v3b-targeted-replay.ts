import { writeFileSync } from "node:fs";
import { applyMove, createInitialState } from "../engine.js";
import { ReusableScoreBoundedPuct } from "../research/puct-v3a.js";
import { GpnPuctV3B } from "../research/puct-v3b.js";
import type { PlayerId, PlayerMove } from "../types.js";

type Score = 0 | 0.5 | 1;

type TargetPosition = {
  label: string;
  moves: PlayerMove[];
};

type GameResult = {
  researchSeat: PlayerId;
  winner: PlayerId | null;
  unresolved: boolean;
  moves: number;
  researchScore: Score | null;
};

const targets: Record<string, TargetPosition> = {
  "B3:CW>T2:CW": {
    label: "B3:CW>T2:CW",
    moves: [
      { player: "P0", pit: "B3", dir: "CW" },
      { player: "P1", pit: "T2", dir: "CW" },
    ],
  },
  "B3:CCW>T4:CCW": {
    label: "B3:CCW>T4:CCW",
    moves: [
      { player: "P0", pit: "B3", dir: "CCW" },
      { player: "P1", pit: "T4", dir: "CCW" },
    ],
  },
};

const targetLabel = requiredStringArg("--position");
const target = targets[targetLabel];
if (!target) throw new Error(`Unsupported --position ${targetLabel}`);

const simulations = intArg("--simulations", 100_000);
const maxMoves = intArg("--max-moves", 320);
const researchTimeBudgetMs = intArg("--research-ms", 600);
const opponentTimeBudgetMs = intArg("--opponent-ms", researchTimeBudgetMs);
const puctExploration = positiveNumberArg("--cpuct", 1.5);
const policyTemperature = positiveNumberArg("--policy-temperature", 0.6);
const proofBias = nonNegativeNumberArg("--cpn", 0.1);
const seed = intArg("--seed", 20261004);
const outPath = stringArg("--out");

const details = (["P0", "P1"] as const).map((researchSeat) => playGame(target, researchSeat));
const resolved = details.filter((game) => !game.unresolved && game.researchScore !== null);
const researchPoints = resolved.reduce((sum, game) => sum + (game.researchScore ?? 0), 0);
const pairPointDifferential = resolved.length === 2 ? researchPoints - (2 - researchPoints) : null;

const result = {
  matchup: "puct-v3b-vs-puct-v3a-targeted-replay",
  methodology: {
    pairedPosition: "The exact forced two-ply prefix is replayed twice with V3B/V3A ownership swapped between P0 and P1.",
    unresolvedPolicy: "No heuristic adjudication. A game still playing at maxMoves remains unresolved.",
    purpose: "Classify long-game positions censored by the 160-ply V3B promotion gate.",
  },
  position: target.label,
  games: details.length,
  resolvedGames: resolved.length,
  unresolved: details.filter((game) => game.unresolved).length,
  researchWins: resolved.filter((game) => game.winner === game.researchSeat).length,
  opponentWins: resolved.filter((game) => game.winner !== null && game.winner !== game.researchSeat).length,
  draws: resolved.filter((game) => game.winner === null).length,
  researchPoints,
  pairPointDifferential,
  config: {
    simulations,
    maxMoves,
    researchTimeBudgetMs,
    opponentTimeBudgetMs,
    puctExploration,
    policyTemperature,
    proofBias,
    seed,
  },
  details,
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function playGame(position: TargetPosition, researchSeat: PlayerId): GameResult {
  let state = createInitialState();
  for (const forcedMove of position.moves) {
    const forced = applyMove(state, forcedMove);
    if (!forced.ok) throw new Error(`Failed forced prefix ${position.label}: ${forced.error}`);
    state = forced.state;
  }

  const researchEngine = new GpnPuctV3B();
  const opponentEngine = new ReusableScoreBoundedPuct();

  while (state.status === "playing" && state.moveNumber < maxMoves) {
    const player = state.currentPlayer;
    const decision = player === researchSeat
      ? researchEngine.chooseMove(state, {
          simulations,
          timeBudgetMs: researchTimeBudgetMs,
          puctExploration,
          policyTemperature,
          proofBias,
        })
      : opponentEngine.chooseMove(state, {
          simulations,
          timeBudgetMs: opponentTimeBudgetMs,
          puctExploration,
          policyTemperature,
        });

    if (!decision.move) {
      return { researchSeat, winner: null, unresolved: true, moves: state.moveNumber, researchScore: null };
    }
    const applied = applyMove(state, decision.move);
    if (!applied.ok) throw new Error(`Illegal ${player} move ${decision.move.pit}:${decision.move.dir}: ${applied.error}`);
    state = applied.state;
  }

  if (state.status !== "finished") {
    return { researchSeat, winner: null, unresolved: true, moves: state.moveNumber, researchScore: null };
  }

  const researchScore: Score = state.winner === null ? 0.5 : state.winner === researchSeat ? 1 : 0;
  return {
    researchSeat,
    winner: state.winner,
    unresolved: false,
    moves: state.moveNumber,
    researchScore,
  };
}

function requiredStringArg(name: string): string {
  const value = stringArg(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function stringArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function intArg(name: string, fallback: number): number {
  const raw = stringArg(name);
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function positiveNumberArg(name: string, fallback: number): number {
  const raw = stringArg(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be > 0`);
  return value;
}

function nonNegativeNumberArg(name: string, fallback: number): number {
  const raw = stringArg(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and >= 0`);
  return value;
}
