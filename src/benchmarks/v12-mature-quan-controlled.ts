import { applyMove, createInitialState, getLegalMoves, MATURE_QUAN_RULESET } from "../engine.js";
import { chooseMctsMove } from "../research/mcts.js";
import { searchNegamaxPvsV3 } from "../research/negamax-pvs-v3.js";
import { parseClassicOpening } from "../research/opening-pie-analysis.js";
import { chooseServerProductionMove, PRODUCTION_SOURCE_COMMIT } from "../reference/server-production-ai.js";
import type { GameState, PlayerId, PlayerMove } from "../types.js";

type EngineId = "uct-pb" | "pvs-strategic" | "trang-nguyen";
const engineA = readEngine("--a");
const engineB = readEngine("--b");
if (engineA === engineB) throw new Error("--a and --b must differ");
const opening = requiredStringArg("--opening");
const parsedOpening = parseClassicOpening(opening);
const games = evenIntArg("--games", 16);
const timeBudgetMs = intArg("--ms", 1_200);
const nodeBudget = intArg("--nodes", 500_000);
const simulations = intArg("--simulations", 200_000);
const rolloutDepth = intArg("--rollout-depth", 20);
const pvsDepth = intArg("--pvs-depth", 16);
const maxMoves = intArg("--max-moves", 220);
const seedBase = intArg("--seed", 20261230);

const aggregate = { aWins: 0, bWins: 0, draws: 0, unresolved: 0, p0Wins: 0, p1Wins: 0, totalMoves: 0, aAsP0: empty(), aAsP1: empty(), details: [] as Array<Record<string, unknown>> };

for (let index = 0; index < games; index += 1) {
  const p0Engine = index % 2 === 0 ? engineA : engineB;
  const p1Engine = index % 2 === 0 ? engineB : engineA;
  let state = createInitialState(MATURE_QUAN_RULESET);
  const forced = getLegalMoves(state).find((move) => move.pit === parsedOpening.pit && move.dir === parsedOpening.dir);
  if (!forced) throw new Error(`Illegal forced opening ${opening}`);
  const first = applyMove(state, forced);
  if (!first.ok) throw new Error(`Failed forced opening ${opening}: ${first.error}`);
  state = first.state;

  const seed = seedBase + index * 7_919 + hashString(`${engineA}:${engineB}:${opening}`);
  const randomP0 = mulberry32(seed ^ 0x9e3779b9);
  const randomP1 = mulberry32(seed ^ 0x85ebca6b);
  while (state.status === "playing" && state.moveNumber < maxMoves) {
    const player = state.currentPlayer;
    const engine = player === "P0" ? p0Engine : p1Engine;
    const move = choose(state, engine, player, player === "P0" ? randomP0 : randomP1);
    if (!move) break;
    const applied = applyMove(state, move);
    if (!applied.ok) throw new Error(`Illegal ${engine} move ${move.pit}:${move.dir}: ${applied.error}`);
    state = applied.state;
  }
  const unresolved = state.status !== "finished";
  const winnerSeat = unresolved ? null : state.winner;
  const winnerEngine = winnerSeat === null ? null : winnerSeat === "P0" ? p0Engine : p1Engine;
  const seat = p0Engine === engineA ? aggregate.aAsP0 : aggregate.aAsP1;
  seat.games += 1;
  if (unresolved) { aggregate.unresolved += 1; seat.unresolved += 1; }
  else if (winnerSeat === null) { aggregate.draws += 1; seat.draws += 1; }
  else {
    if (winnerSeat === "P0") aggregate.p0Wins += 1; else aggregate.p1Wins += 1;
    if (winnerEngine === engineA) { aggregate.aWins += 1; seat.wins += 1; }
    else { aggregate.bWins += 1; seat.losses += 1; }
  }
  aggregate.totalMoves += state.moveNumber;
  aggregate.details.push({ game: index + 1, seed, p0Engine, p1Engine, winnerSeat, winnerEngine, unresolved, moves: state.moveNumber, finalScores: state.scores });
}

const completed = games - aggregate.unresolved;
console.log(JSON.stringify({
  methodology: { phase: "V12 Mature Quan controlled strength", rules: "mature_quan_v1", forcedOpening: opening, seatBalance: "engine A/B alternate P0/P1 after the same forced P0 opening", productionSourceCommit: PRODUCTION_SOURCE_COMMIT },
  engines: { A: engineA, B: engineB },
  config: { opening, games, timeBudgetMs, nodeBudget, simulations, rolloutDepth, pvsDepth, maxMoves, seedBase },
  aggregate: { ...aggregate, aScoreRate: completed === 0 ? 0 : (aggregate.aWins + aggregate.draws * 0.5) / completed, averageMoves: aggregate.totalMoves / games },
}, null, 2));

function choose(state: GameState, engine: EngineId, player: PlayerId, random: () => number): PlayerMove | null {
  if (engine === "uct-pb") return chooseMctsMove(state, { variant: "uct-pb", simulations, timeBudgetMs, rolloutDepth, random }).move;
  if (engine === "pvs-strategic") return searchNegamaxPvsV3(state, { evaluationFamily: "strategic", maxDepth: pvsDepth, nodeBudget, timeBudgetMs, usePvs: true, useTranspositionTable: true }).move;
  const move = chooseServerProductionMove(state, "trang-nguyen", player, { mode: "production-max", timeBudgetMs, nodeBudget, random });
  return move ? { player, ...move } : null;
}
function empty() { return { games: 0, wins: 0, losses: 0, draws: 0, unresolved: 0 }; }
function readEngine(name: string): EngineId { const value = requiredStringArg(name); if (value === "uct-pb" || value === "pvs-strategic" || value === "trang-nguyen") return value; throw new Error(`Unknown engine ${value}`); }
function requiredStringArg(name: string): string { const value = stringArg(name); if (!value) throw new Error(`${name} is required`); return value; }
function stringArg(name: string): string | null { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] ?? null : null; }
function intArg(name: string, fallback: number): number { const raw = stringArg(name); if (raw === null) return fallback; const value = Number.parseInt(raw, 10); if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`); return value; }
function evenIntArg(name: string, fallback: number): number { const value = intArg(name, fallback); if (value % 2 !== 0) throw new Error(`${name} must be even`); return value; }
function hashString(value: string): number { let hash = 2166136261; for (const char of value) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); } return hash >>> 0; }
function mulberry32(seed: number): () => number { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
