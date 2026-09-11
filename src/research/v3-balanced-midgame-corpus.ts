import { applyMove, createInitialState, getLegalMoves } from "../engine.js";
import type { GameState, PlayerMove } from "../types.js";
import { V3_50M_PV, type V3EvaluationFamily, type V3FinalistOpening } from "./v3-pv-corpus.js";

export type MidgameSource = `${V3FinalistOpening}:${V3EvaluationFamily}`;

export type BalancedMidgamePosition = {
  id: string;
  source: MidgameSource;
  depth: number;
  moves: PlayerMove[];
  scoreDiff: number;
  danMaterialDiff: number;
  nonEmptyPitDiff: number;
  legalMoves: number;
  balancePenalty: number;
};

const WINDOWS = [
  [6, 9],
  [10, 13],
  [14, 17],
  [18, 21],
] as const;

export const BALANCED_MIDGAME_POSITIONS: readonly BalancedMidgamePosition[] = buildBalancedMidgameCorpus();

export function buildBalancedMidgameCorpus(): BalancedMidgamePosition[] {
  const selected: BalancedMidgamePosition[] = [];
  const seen = new Set<string>();

  for (const source of Object.keys(V3_50M_PV) as MidgameSource[]) {
    const candidates = buildCandidates(source);
    for (const [lo, hi] of WINDOWS) {
      const inWindow = candidates.filter((candidate) => candidate.depth >= lo && candidate.depth <= hi);
      const pool = inWindow.length > 0 ? inWindow : candidates;
      const chosen = [...pool]
        .filter((candidate) => !seen.has(positionSignature(replay(candidate.moves))))
        .sort((a, b) => a.balancePenalty - b.balancePenalty || a.depth - b.depth)[0];
      if (!chosen) continue;
      const signature = positionSignature(replay(chosen.moves));
      seen.add(signature);
      selected.push(chosen);
    }
  }

  return selected;
}

export function replayBalancedPosition(position: BalancedMidgamePosition): GameState {
  return replay(position.moves);
}

function buildCandidates(source: MidgameSource): BalancedMidgamePosition[] {
  const [opening] = source.split(":", 1) as [V3FinalistOpening];
  const continuation = V3_50M_PV[source];
  const state = createInitialState();
  const openingMove = legalMoveFromToken(state, opening);
  const moves: PlayerMove[] = [openingMove];
  let current = mustApply(state, openingMove, source);
  const candidates: BalancedMidgamePosition[] = [];

  for (const token of continuation) {
    if (current.status !== "playing") break;
    const move = legalMoveFromToken(current, token);
    moves.push(move);
    current = mustApply(current, move, source);
    const depth = moves.length;
    if (depth < 6 || current.status !== "playing") continue;

    const metrics = stateMetrics(current);
    if (!metrics.bothQuanAlive) continue;
    if (metrics.nonEmptyP0 < 2 || metrics.nonEmptyP1 < 2) continue;
    if (metrics.legalMoves < 2) continue;
    if (metrics.scoreDiff > 14 || metrics.danMaterialDiff > 14) continue;

    candidates.push({
      id: `${source}@${depth}`,
      source,
      depth,
      moves: moves.map((entry) => ({ ...entry })),
      scoreDiff: metrics.scoreDiff,
      danMaterialDiff: metrics.danMaterialDiff,
      nonEmptyPitDiff: Math.abs(metrics.nonEmptyP0 - metrics.nonEmptyP1),
      legalMoves: metrics.legalMoves,
      balancePenalty:
        metrics.scoreDiff * 2 +
        metrics.danMaterialDiff +
        Math.abs(metrics.nonEmptyP0 - metrics.nonEmptyP1) * 2 +
        (metrics.legalMoves === 2 ? 2 : 0),
    });
  }

  return candidates;
}

function stateMetrics(state: GameState) {
  const dan = state.pits.filter((pit) => pit.kind === "dan");
  const p0Stones = dan.filter((pit) => pit.owner === "P0").reduce((sum, pit) => sum + pit.stones, 0);
  const p1Stones = dan.filter((pit) => pit.owner === "P1").reduce((sum, pit) => sum + pit.stones, 0);
  const nonEmptyP0 = dan.filter((pit) => pit.owner === "P0" && pit.stones > 0).length;
  const nonEmptyP1 = dan.filter((pit) => pit.owner === "P1" && pit.stones > 0).length;
  const quan = state.pits.filter((pit) => pit.kind === "quan");
  return {
    scoreDiff: Math.abs(state.scores.P0 - state.scores.P1),
    danMaterialDiff: Math.abs(p0Stones - p1Stones),
    nonEmptyP0,
    nonEmptyP1,
    legalMoves: getLegalMoves(state).length,
    bothQuanAlive: quan.length === 2 && quan.every((pit) => pit.quanStones > 0),
  };
}

function legalMoveFromToken(state: GameState, token: string): PlayerMove {
  const [pit, dir] = token.toUpperCase().split(":");
  const move = getLegalMoves(state).find((candidate) => candidate.pit === pit && candidate.dir === dir);
  if (!move) throw new Error(`Illegal PV token ${token} at ply ${state.moveNumber + 1}`);
  return move;
}

function mustApply(state: GameState, move: PlayerMove, source: string): GameState {
  const applied = applyMove(state, move);
  if (!applied.ok) throw new Error(`Failed ${source} move ${move.pit}:${move.dir}: ${applied.error}`);
  return applied.state;
}

function replay(moves: readonly PlayerMove[]): GameState {
  let state = createInitialState();
  for (const move of moves) state = mustApply(state, move, "balanced-midgame-replay");
  return state;
}

function positionSignature(state: GameState): string {
  return JSON.stringify({
    currentPlayer: state.currentPlayer,
    scores: state.scores,
    pits: state.pits.map((pit) => [pit.id, pit.stones, pit.quanStones]),
  });
}
