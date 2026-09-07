import { createStateHash } from "../engine.js";
import type { GameState, PlayerId } from "../types.js";
import type { ProductionAiMove } from "./production-ai.js";

export type LearnedMoveStats = {
  wins: number;
  draws: number;
  losses: number;
  lossWeight: number;
  updatedAt: number;
};

export type LearnedPositionRecord = LearnedMoveStats & {
  positionKey: string;
  move: ProductionAiMove;
};

export type TrangNguyenSolvedOutcome = "win" | "draw" | "loss";

export type TrangNguyenSolvedStateRecord = {
  ruleset: "classic-v1";
  stateHash: string;
  player: PlayerId;
  outcome: TrangNguyenSolvedOutcome;
  lowerBound: TrangNguyenSolvedOutcome;
  upperBound: TrangNguyenSolvedOutcome;
  depth: number;
  bestMove: ProductionAiMove | null;
  updatedAt: number;
};

export type TrangNguyenLearningSnapshotV1 = {
  version: 1;
  updatedAt: number;
  entries: LearnedPositionRecord[];
  lossGames?: unknown[];
  completedMatchIds?: string[];
  solvedStates?: TrangNguyenSolvedStateRecord[];
};

export type TrangNguyenLearningReader = {
  lookup: (state: GameState, aiPlayer: PlayerId, move: ProductionAiMove) => LearnedMoveStats | null;
  filterCandidates: (
    state: GameState,
    aiPlayer: PlayerId,
    candidates: readonly ProductionAiMove[],
  ) => ProductionAiMove[];
  compareMoves: (
    state: GameState,
    aiPlayer: PlayerId,
    left: ProductionAiMove,
    right: ProductionAiMove,
  ) => number;
  lookupSolvedState: (state: GameState, aiPlayer: PlayerId) => TrangNguyenSolvedStateRecord | null;
};

export function trangNguyenPositionKey(state: GameState, aiPlayer: PlayerId): string {
  return `classic-v1:${aiPlayer}:${createStateHash(state)}`;
}

export function createTrangNguyenLearningReader(
  snapshot: TrangNguyenLearningSnapshotV1,
): TrangNguyenLearningReader {
  if (snapshot.version !== 1) throw new Error(`Unsupported Trang Nguyen learning snapshot version: ${snapshot.version}`);
  const entries = new Map<string, LearnedPositionRecord>();
  for (const entry of snapshot.entries ?? []) {
    entries.set(entryKey(entry.positionKey, entry.move), {
      ...entry,
      move: { ...entry.move },
    });
  }
  const solvedStates = new Map<string, TrangNguyenSolvedStateRecord>();
  for (const solved of snapshot.solvedStates ?? []) {
    if (solved.ruleset !== "classic-v1") continue;
    solvedStates.set(solvedStateKey(solved.stateHash, solved.player), {
      ...solved,
      bestMove: solved.bestMove ? { ...solved.bestMove } : null,
    });
  }

  function lookup(state: GameState, aiPlayer: PlayerId, move: ProductionAiMove): LearnedMoveStats | null {
    const entry = entries.get(entryKey(trangNguyenPositionKey(state, aiPlayer), move));
    return entry
      ? {
          wins: entry.wins,
          draws: entry.draws,
          losses: entry.losses,
          lossWeight: entry.lossWeight,
          updatedAt: entry.updatedAt,
        }
      : null;
  }

  function filterCandidates(
    state: GameState,
    aiPlayer: PlayerId,
    candidates: readonly ProductionAiMove[],
  ): ProductionAiMove[] {
    const unproven = candidates.filter((move) => (lookup(state, aiPlayer, move)?.losses ?? 0) === 0);
    return [...(unproven.length > 0 ? unproven : candidates)];
  }

  function compareMoves(
    state: GameState,
    aiPlayer: PlayerId,
    left: ProductionAiMove,
    right: ProductionAiMove,
  ): number {
    return learnedUtility(lookup(state, aiPlayer, right)) - learnedUtility(lookup(state, aiPlayer, left));
  }

  function lookupSolvedState(state: GameState, aiPlayer: PlayerId): TrangNguyenSolvedStateRecord | null {
    const solved = solvedStates.get(solvedStateKey(createStateHash(state), aiPlayer));
    return solved
      ? { ...solved, bestMove: solved.bestMove ? { ...solved.bestMove } : null }
      : null;
  }

  return { lookup, filterCandidates, compareMoves, lookupSolvedState };
}

function learnedUtility(stats: LearnedMoveStats | null): number {
  if (!stats) return 0;
  return stats.wins * 3 + stats.draws - stats.losses * 4 - stats.lossWeight;
}

function moveKey(move: ProductionAiMove): string {
  return `${move.pit}:${move.dir}`;
}

function entryKey(positionKey: string, move: ProductionAiMove): string {
  return `${positionKey}:${moveKey(move)}`;
}

function solvedStateKey(stateHash: string, aiPlayer: PlayerId): string {
  return `classic-v1:${aiPlayer}:${stateHash}`;
}
