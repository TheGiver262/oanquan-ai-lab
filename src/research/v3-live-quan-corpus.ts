import { applyMove, createInitialState, getLegalMoves } from "../engine.js";
import type { GameState, PlayerMove } from "../types.js";

export type LiveQuanPosition = {
  id: string;
  depth: number;
  opening: string;
  moves: PlayerMove[];
  scoreDiff: number;
  danMaterialDiff: number;
  nonEmptyPitDiff: number;
  legalMoves: number;
  balancePenalty: number;
};

type BeamCandidate = LiveQuanPosition & {
  state: GameState;
};

const TARGET_DEPTHS = [4, 5, 6, 7, 8, 9, 10, 11] as const;
const POSITIONS_PER_DEPTH = 2;
const MAX_BEAM = 240;
const MAX_PER_OPENING = 32;
const MAX_SCORE_DIFF = 8;
const MAX_DAN_MATERIAL_DIFF = 10;
const MIN_LEGAL_MOVES = 3;

export const LIVE_QUAN_BALANCED_POSITIONS: readonly LiveQuanPosition[] = buildLiveQuanBalancedCorpus();

export function buildLiveQuanBalancedCorpus(): LiveQuanPosition[] {
  let beam: BeamCandidate[] = [candidateFromState(createInitialState(), [])];
  const selected: LiveQuanPosition[] = [];
  const selectedKeys = new Set<string>();

  for (let depth = 1; depth <= TARGET_DEPTHS[TARGET_DEPTHS.length - 1]; depth += 1) {
    const dedup = new Map<string, BeamCandidate>();

    for (const parent of beam) {
      for (const move of getLegalMoves(parent.state)) {
        const applied = applyMove(parent.state, move);
        if (!applied.ok || applied.state.status !== "playing") continue;
        const moves = [...parent.moves, move];
        const candidate = candidateFromState(applied.state, moves);
        if (!hasBothQuan(candidate.state)) continue;
        if (candidate.scoreDiff > MAX_SCORE_DIFF) continue;
        if (candidate.danMaterialDiff > MAX_DAN_MATERIAL_DIFF) continue;
        if (candidate.legalMoves < MIN_LEGAL_MOVES) continue;

        const key = strategicStateKey(candidate.state);
        const previous = dedup.get(key);
        if (!previous || compareCandidate(candidate, previous) < 0) dedup.set(key, candidate);
      }
    }

    beam = retainDiverseBeam([...dedup.values()]);
    if (TARGET_DEPTHS.includes(depth as (typeof TARGET_DEPTHS)[number])) {
      const depthPicks = chooseDepthPositions(beam, POSITIONS_PER_DEPTH, selectedKeys);
      for (const pick of depthPicks) {
        selectedKeys.add(strategicStateKey(pick.state));
        selected.push(stripState(pick));
      }
    }

    if (beam.length === 0) break;
  }

  return selected;
}

export function replayLiveQuanPosition(position: LiveQuanPosition): GameState {
  let state = createInitialState();
  for (const move of position.moves) {
    const applied = applyMove(state, move);
    if (!applied.ok) throw new Error(`Failed live-quan replay at ${move.pit}:${move.dir}: ${applied.error}`);
    state = applied.state;
  }
  return state;
}

function candidateFromState(state: GameState, moves: PlayerMove[]): BeamCandidate {
  const metrics = metricsFor(state);
  const opening = moves[0] ? `${moves[0].pit}:${moves[0].dir}` : "ROOT";
  return {
    id: `LQ@${moves.length}:${opening}:${pathToken(moves)}`,
    depth: moves.length,
    opening,
    moves,
    state,
    scoreDiff: metrics.scoreDiff,
    danMaterialDiff: metrics.danMaterialDiff,
    nonEmptyPitDiff: metrics.nonEmptyPitDiff,
    legalMoves: metrics.legalMoves,
    balancePenalty:
      metrics.scoreDiff * 3 +
      metrics.danMaterialDiff * 2 +
      metrics.nonEmptyPitDiff * 2 +
      Math.max(0, 5 - metrics.legalMoves),
  };
}

function metricsFor(state: GameState) {
  const dan = state.pits.filter((pit) => pit.kind === "dan");
  const p0 = dan.filter((pit) => pit.owner === "P0");
  const p1 = dan.filter((pit) => pit.owner === "P1");
  const p0Stones = p0.reduce((sum, pit) => sum + pit.stones, 0);
  const p1Stones = p1.reduce((sum, pit) => sum + pit.stones, 0);
  const p0NonEmpty = p0.filter((pit) => pit.stones > 0).length;
  const p1NonEmpty = p1.filter((pit) => pit.stones > 0).length;
  return {
    scoreDiff: Math.abs(state.scores.P0 - state.scores.P1),
    danMaterialDiff: Math.abs(p0Stones - p1Stones),
    nonEmptyPitDiff: Math.abs(p0NonEmpty - p1NonEmpty),
    legalMoves: getLegalMoves(state).length,
  };
}

function hasBothQuan(state: GameState): boolean {
  const quan = state.pits.filter((pit) => pit.kind === "quan");
  return quan.length === 2 && quan.every((pit) => pit.quanStones > 0);
}

function retainDiverseBeam(candidates: BeamCandidate[]): BeamCandidate[] {
  const groups = new Map<string, BeamCandidate[]>();
  for (const candidate of candidates.sort(compareCandidate)) {
    const group = groups.get(candidate.opening) ?? [];
    if (group.length < MAX_PER_OPENING) group.push(candidate);
    groups.set(candidate.opening, group);
  }

  const orderedOpenings = [...groups.keys()].sort();
  const retained: BeamCandidate[] = [];
  let index = 0;
  while (retained.length < MAX_BEAM) {
    let added = false;
    for (const opening of orderedOpenings) {
      const candidate = groups.get(opening)?.[index];
      if (!candidate) continue;
      retained.push(candidate);
      added = true;
      if (retained.length >= MAX_BEAM) break;
    }
    if (!added) break;
    index += 1;
  }
  return retained;
}

function chooseDepthPositions(
  candidates: BeamCandidate[],
  count: number,
  selectedKeys: Set<string>,
): BeamCandidate[] {
  const picks: BeamCandidate[] = [];
  const usedOpenings = new Set<string>();
  for (const candidate of [...candidates].sort(compareCandidate)) {
    const key = strategicStateKey(candidate.state);
    if (selectedKeys.has(key)) continue;
    if (usedOpenings.has(candidate.opening)) continue;
    picks.push(candidate);
    usedOpenings.add(candidate.opening);
    if (picks.length === count) return picks;
  }

  for (const candidate of [...candidates].sort(compareCandidate)) {
    const key = strategicStateKey(candidate.state);
    if (selectedKeys.has(key) || picks.some((pick) => strategicStateKey(pick.state) === key)) continue;
    picks.push(candidate);
    if (picks.length === count) break;
  }
  return picks;
}

function stripState(candidate: BeamCandidate): LiveQuanPosition {
  const { state: _state, ...position } = candidate;
  return position;
}

function compareCandidate(left: BeamCandidate, right: BeamCandidate): number {
  return left.balancePenalty - right.balancePenalty
    || right.legalMoves - left.legalMoves
    || pathToken(left.moves).localeCompare(pathToken(right.moves));
}

function pathToken(moves: readonly PlayerMove[]): string {
  return moves.map((move) => `${move.pit}:${move.dir}`).join(">");
}

function strategicStateKey(state: GameState): string {
  return JSON.stringify({
    currentPlayer: state.currentPlayer,
    scores: state.scores,
    status: state.status,
    pits: state.pits.map((pit) => [pit.id, pit.stones, pit.quanStones]),
  });
}
