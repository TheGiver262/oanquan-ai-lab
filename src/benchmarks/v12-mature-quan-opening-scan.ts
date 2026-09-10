import { applyMove, createInitialState, getLegalMoves, MATURE_QUAN_RULESET } from "../engine.js";
import { chooseMctsMove } from "../research/mcts.js";
import { parseClassicOpening } from "../research/opening-pie-analysis.js";
import type { PlayerId } from "../types.js";

const opening = requiredStringArg("--opening");
const games = evenIntArg("--games", 8);
const timeBudgetMs = intArg("--ms", 500);
const simulations = intArg("--simulations", 100_000);
const rolloutDepth = intArg("--rollout-depth", 20);
const maxMoves = intArg("--max-moves", 220);
const seedBase = intArg("--seed", 20261220);

const parsedOpening = parseClassicOpening(opening);
const aggregate = { p0Wins: 0, p1Wins: 0, draws: 0, unresolved: 0, totalMoves: 0, details: [] as Array<Record<string, unknown>> };

for (let game = 0; game < games; game += 1) {
  let state = createInitialState(MATURE_QUAN_RULESET);
  const forced = getLegalMoves(state).find((move) => move.pit === parsedOpening.pit && move.dir === parsedOpening.dir);
  if (!forced) throw new Error(`Illegal forced opening ${opening}`);
  const appliedOpening = applyMove(state, forced);
  if (!appliedOpening.ok) throw new Error(`Failed forced opening ${opening}: ${appliedOpening.error}`);
  state = appliedOpening.state;

  const seed = seedBase + game * 7_919 + hashString(opening);
  const randomP0 = mulberry32(seed ^ 0x9e3779b9);
  const randomP1 = mulberry32(seed ^ 0x85ebca6b);

  while (state.status === "playing" && state.moveNumber < maxMoves) {
    const player: PlayerId = state.currentPlayer;
    const random = player === "P0" ? randomP0 : randomP1;
    const decision = chooseMctsMove(state, { variant: "uct-pb", simulations, timeBudgetMs, rolloutDepth, random });
    if (!decision.move) break;
    const applied = applyMove(state, decision.move);
    if (!applied.ok) throw new Error(`Illegal UCT move ${decision.move.pit}:${decision.move.dir}: ${applied.error}`);
    state = applied.state;
  }

  const unresolved = state.status !== "finished";
  if (unresolved) aggregate.unresolved += 1;
  else if (state.winner === "P0") aggregate.p0Wins += 1;
  else if (state.winner === "P1") aggregate.p1Wins += 1;
  else aggregate.draws += 1;
  aggregate.totalMoves += state.moveNumber;
  aggregate.details.push({ game: game + 1, seed, winner: unresolved ? null : state.winner, unresolved, moves: state.moveNumber, finalScores: state.scores });
}

const completed = games - aggregate.unresolved;
console.log(JSON.stringify({
  methodology: {
    phase: "V12 Mature Quan opening scan",
    rules: "mature_quan_v1",
    engine: "UCT-PB self-play after one forced P0 opening",
    purpose: "screen all ten classic first moves for seat-neutral Mature Quan candidates before cross-engine strength replay",
  },
  config: { opening, games, timeBudgetMs, simulations, rolloutDepth, maxMoves, seedBase },
  aggregate: {
    ...aggregate,
    p0ScoreRate: completed === 0 ? 0 : (aggregate.p0Wins + aggregate.draws * 0.5) / completed,
    averageMoves: aggregate.totalMoves / games,
  },
}, null, 2));

function requiredStringArg(name: string): string { const value = stringArg(name); if (!value) throw new Error(`${name} is required`); return value; }
function stringArg(name: string): string | null { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] ?? null : null; }
function intArg(name: string, fallback: number): number { const raw = stringArg(name); if (raw === null) return fallback; const value = Number.parseInt(raw, 10); if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`); return value; }
function evenIntArg(name: string, fallback: number): number { const value = intArg(name, fallback); if (value % 2 !== 0) throw new Error(`${name} must be even`); return value; }
function hashString(value: string): number { let hash = 2166136261; for (const char of value) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); } return hash >>> 0; }
function mulberry32(seed: number): () => number { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
