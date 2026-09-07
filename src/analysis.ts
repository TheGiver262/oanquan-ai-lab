import { applyMove, createInitialState, getLegalMoves } from "./engine.js";
import { AI_DIFFICULTIES, AI_DIFFICULTY_PROFILES, type AiDifficulty } from "./profiles.js";
import { analyzePosition, type SearchOptions } from "./search.js";
import type { GameState, PlayerId, PlayerMove } from "./types.js";

export type MatchSummary = {
  games: number;
  p0Wins: number;
  p1Wins: number;
  draws: number;
  averageMoves: number;
};

export function playMatch(
  p0: AiDifficulty,
  p1: AiDifficulty,
  options: { maxMoves?: number; seed?: number; search?: SearchOptions } = {},
): GameState {
  let state = createInitialState();
  const random = seededRandom(options.seed ?? 1);
  const maxMoves = options.maxMoves ?? 200;
  while (state.status !== "finished" && state.moveNumber < maxMoves) {
    const difficulty = state.currentPlayer === "P0" ? p0 : p1;
    const result = analyzePosition(state, difficulty, { ...(options.search ?? {}), random });
    if (!result.bestMove) break;
    const applied = applyMove(state, result.bestMove);
    if (!applied.ok) throw new Error(`AI selected illegal move: ${applied.error}`);
    state = applied.state;
  }
  return state;
}

export function runMatchSeries(
  p0: AiDifficulty,
  p1: AiDifficulty,
  games: number,
  options: { swapSides?: boolean; search?: SearchOptions; seed?: number } = {},
): MatchSummary {
  let p0Wins = 0;
  let p1Wins = 0;
  let draws = 0;
  let moves = 0;
  for (let game = 0; game < games; game += 1) {
    const swapped = Boolean(options.swapSides) && game % 2 === 1;
    const left = swapped ? p1 : p0;
    const right = swapped ? p0 : p1;
    const playOptions: { seed: number; search?: SearchOptions } = { seed: (options.seed ?? 1) + game };
    if (options.search) playOptions.search = options.search;
    const state = playMatch(left, right, playOptions);
    moves += state.moveNumber;
    const normalizedWinner: PlayerId | null =
      state.winner === null ? null : swapped ? (state.winner === "P0" ? "P1" : "P0") : state.winner;
    if (normalizedWinner === "P0") p0Wins += 1;
    else if (normalizedWinner === "P1") p1Wins += 1;
    else draws += 1;
  }
  return { games, p0Wins, p1Wins, draws, averageMoves: games > 0 ? moves / games : 0 };
}

export function runTournament(gamesPerPair = 4, search: SearchOptions = { depth: 2, timeBudgetMs: 200, nodeBudget: 5000 }): Array<{ ai: AiDifficulty; points: number; wins: number; draws: number; losses: number }> {
  const rows = new Map<AiDifficulty, { ai: AiDifficulty; points: number; wins: number; draws: number; losses: number }>();
  for (const ai of AI_DIFFICULTIES) rows.set(ai, { ai, points: 0, wins: 0, draws: 0, losses: 0 });
  for (let a = 0; a < AI_DIFFICULTIES.length; a += 1) {
    for (let b = a + 1; b < AI_DIFFICULTIES.length; b += 1) {
      const aiA = AI_DIFFICULTIES[a]!;
      const aiB = AI_DIFFICULTIES[b]!;
      const summary = runMatchSeries(aiA, aiB, gamesPerPair, { swapSides: true, search, seed: a * 1000 + b * 100 });
      const rowA = rows.get(aiA)!;
      const rowB = rows.get(aiB)!;
      rowA.wins += summary.p0Wins; rowA.losses += summary.p1Wins; rowA.draws += summary.draws; rowA.points += summary.p0Wins + summary.draws * 0.5;
      rowB.wins += summary.p1Wins; rowB.losses += summary.p0Wins; rowB.draws += summary.draws; rowB.points += summary.p1Wins + summary.draws * 0.5;
    }
  }
  return [...rows.values()].sort((a, b) => b.points - a.points);
}

export function analyzeOpenings(difficulty: AiDifficulty = "trang-nguyen", options: SearchOptions = {}): Array<{ move: PlayerMove; score: number }> {
  const state = createInitialState();
  const profile = AI_DIFFICULTY_PROFILES[difficulty];
  return getLegalMoves(state).map((move) => {
    const result = applyMove(state, move);
    if (!result.ok) throw new Error(result.error);
    const reply = analyzePosition(result.state, difficulty, options);
    const score = reply.rankedMoves.length > 0 ? -reply.rankedMoves[0]!.score : result.state.scores.P0 - result.state.scores.P1;
    return { move, score: score / Math.max(1, profile.weights.score) };
  }).sort((a, b) => b.score - a.score);
}

export function analyzePieRule(difficulty: AiDifficulty = "trang-nguyen", options: SearchOptions = {}): Array<{ opening: PlayerMove; keep: number; swap: number; guaranteed: number }> {
  const initial = createInitialState();
  return getLegalMoves(initial).map((opening) => {
    const applied = applyMove(initial, opening);
    if (!applied.ok) throw new Error(applied.error);
    const afterOpening = applied.state;
    const keepSearch = analyzePosition(afterOpening, difficulty, options);
    const keep = keepSearch.rankedMoves.length > 0 ? -keepSearch.rankedMoves[0]!.score : afterOpening.scores.P0 - afterOpening.scores.P1;
    const swapState: GameState = { ...afterOpening, scores: { ...afterOpening.scores }, pits: afterOpening.pits.map((p) => ({ ...p })) };
    const swapSearch = analyzePosition(swapState, difficulty, options);
    const swap = swapSearch.rankedMoves[0]?.score ?? (swapState.scores.P1 - swapState.scores.P0);
    return { opening, keep, swap, guaranteed: Math.min(keep, swap) };
  }).sort((a, b) => b.guaranteed - a.guaranteed);
}

export function perft(state: GameState, depth: number): number {
  if (depth === 0) return 1;
  if (state.status === "finished") return 1;
  let nodes = 0;
  for (const move of getLegalMoves(state)) {
    const result = applyMove(state, move);
    if (result.ok) nodes += perft(result.state, depth - 1);
  }
  return nodes;
}

export function seededRandom(seed: number): () => number {
  let x = seed | 0;
  return () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return ((x >>> 0) % 0x100000000) / 0x100000000;
  };
}
