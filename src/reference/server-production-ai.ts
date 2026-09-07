import { applyMove, getLegalMoves } from "../engine.js";
import type { GameState, PlayerId } from "../types.js";
import {
  PRODUCTION_TOP_PROFILES,
  chooseProductionMove,
  enumerateProductionMoves,
  evaluateProductionState,
  type ProductionAiMove,
  type ProductionAiMoveCandidate,
  type ProductionTopDifficulty,
} from "./production-ai.js";
import {
  SearchBudgetExhausted,
  searchTrangNguyenBestFirst,
  type TrangNguyenBoundedOutcome,
  type TrangNguyenWdl,
} from "./trang-nguyen-best-first-search.js";
import type { TrangNguyenLearningReader } from "./trang-nguyen-learning.js";

export const PRODUCTION_SOURCE_COMMIT = "4984701ce151ee270a6a5ba5fc9211a6ec2b6996" as const;
export type ProductionStrengthMode = "production-live" | "production-max";

export type ServerProductionOptions = {
  mode?: ProductionStrengthMode;
  learning?: TrangNguyenLearningReader;
  nodeBudget?: number;
  now?: () => number;
  random?: () => number;
  timeBudgetMs?: number;
};

export type ServerProductionDecision = {
  move: ProductionAiMove | null;
  source: "iterative-alpha-beta" | "trang-nguyen-best-first";
  completedDepth: number;
  nodeCount: number;
  budgetReason: "node" | "time" | null;
  learningEnabled: boolean;
};

type TrangNguyenRankedCandidate = {
  candidate: ProductionAiMoveCandidate;
  score: number;
  outcome?: TrangNguyenBoundedOutcome;
  lowerBound?: TrangNguyenWdl;
  upperBound?: TrangNguyenWdl;
  completedDepth?: number;
  visits?: number;
};

export function chooseServerProductionMove(
  state: GameState,
  difficulty: ProductionTopDifficulty,
  aiPlayer = state.currentPlayer,
  options: ServerProductionOptions = {},
): ProductionAiMove | null {
  return chooseServerProductionMoveWithDiagnostics(state, difficulty, aiPlayer, options).move;
}

export function chooseServerProductionMoveWithDiagnostics(
  state: GameState,
  difficulty: ProductionTopDifficulty,
  aiPlayer = state.currentPlayer,
  options: ServerProductionOptions = {},
): ServerProductionDecision {
  if (difficulty !== "trang-nguyen") {
    const profile = PRODUCTION_TOP_PROFILES[difficulty];
    const mode = options.mode ?? "production-live";
    const baseRandom = options.random ?? Math.random;
    const random = mode === "production-max" ? suppressMistakes(baseRandom) : baseRandom;
    const move = chooseProductionMove(state, difficulty, aiPlayer, {
      ...(options.nodeBudget !== undefined ? { nodeBudget: options.nodeBudget } : {}),
      ...(options.timeBudgetMs !== undefined ? { timeBudgetMs: options.timeBudgetMs } : {}),
      ...(options.now ? { now: options.now } : {}),
      random,
    });
    return {
      move,
      source: "iterative-alpha-beta",
      completedDepth: 0,
      nodeCount: 0,
      budgetReason: null,
      learningEnabled: false,
    };
  }

  return chooseTrangNguyenServerMove(state, aiPlayer, options);
}

function chooseTrangNguyenServerMove(
  state: GameState,
  aiPlayer: PlayerId,
  options: ServerProductionOptions,
): ServerProductionDecision {
  const profile = PRODUCTION_TOP_PROFILES["trang-nguyen"];
  const now = options.now ?? (() => globalThis.performance.now());
  const startedAt = now();
  const deadline = startedAt + (options.timeBudgetMs ?? profile.timeBudgetMs);
  const nodeBudget = options.nodeBudget ?? profile.nodeBudget;
  const random = options.random ?? Math.random;
  const learning = options.learning;
  const candidates = enumerateProductionMoves(state, aiPlayer);
  if (candidates.length === 0) {
    return {
      move: null,
      source: "trang-nguyen-best-first",
      completedDepth: 0,
      nodeCount: 0,
      budgetReason: null,
      learningEnabled: Boolean(learning),
    };
  }

  const learnedCandidates = learning
    ? filterLearnedCandidates(state, candidates, aiPlayer, learning)
    : candidates;
  const openingMove = profile.useOpeningBook
    ? chooseOpeningBookMove(state, learnedCandidates, aiPlayer)
    : null;

  let nodeCount = 0;
  const orderedRoot = [...candidates].sort((left, right) => {
    if (openingMove) {
      const leftIsOpening = sameMove(left.move, openingMove);
      const rightIsOpening = sameMove(right.move, openingMove);
      if (leftIsOpening !== rightIsOpening) return leftIsOpening ? -1 : 1;
    }
    return moveOrderingScore(right, aiPlayer) - moveOrderingScore(left, aiPlayer);
  });
  const rootCandidates = new Map(orderedRoot.map((candidate) => [moveKey(candidate.move), candidate]));
  const shallowScores = new Map<GameState, number>(
    candidates.map((candidate) => [candidate.state, scoreHeuristicCandidate(candidate, aiPlayer)]),
  );

  const result = searchTrangNguyenBestFirst({
    rootState: state,
    perspective: aiPlayer,
    maxDepth: effectiveTrangNguyenDepth(state, aiPlayer),
    adapter: {
      currentPlayer: (candidateState) => candidateState.currentPlayer,
      legalMoves: (candidateState) =>
        candidateState === state
          ? orderedRoot.map((candidate) => candidate.move)
          : getLegalMoves(candidateState, candidateState.currentPlayer).map((move) => ({
              pit: move.pit,
              dir: move.dir,
            })),
      applyMove: (candidateState, move) => {
        const applied = applyMove(candidateState, {
          player: candidateState.currentPlayer,
          pit: move.pit,
          dir: move.dir,
        });
        if (!applied.ok) throw new Error(`Server reference search received illegal move ${moveKey(move)}`);
        return applied.state;
      },
      terminalOutcome: (candidateState, perspective) => {
        if (candidateState.status !== "finished") return null;
        if (candidateState.winner === perspective) return "win";
        if (candidateState.winner === null) return "draw";
        return "loss";
      },
      heuristic: (candidateState, perspective) =>
        shallowScores.get(candidateState) ?? evaluateProductionState(candidateState, perspective, profile),
      moveKey,
    },
    budget: {
      shouldStop: () => {
        if (now() >= deadline) return "time";
        if (nodeCount >= nodeBudget) return "node";
        return null;
      },
      consumeNode: () => {
        if (now() >= deadline) throw new SearchBudgetExhausted("time");
        if (nodeCount >= nodeBudget) throw new SearchBudgetExhausted("node");
        nodeCount += 1;
      },
    },
  });

  let ranked: TrangNguyenRankedCandidate[] = result.branches.flatMap((branch) => {
    const candidate = rootCandidates.get(moveKey(branch.move));
    return candidate
      ? [{
          candidate,
          score: branch.score,
          outcome: branch.outcome,
          lowerBound: branch.lowerBound,
          upperBound: branch.upperBound,
          completedDepth: branch.completedDepth,
          visits: branch.visits,
        }]
      : [];
  });

  const tieBreakByMove = new Map(ranked.map(({ candidate }) => [moveKey(candidate.move), random()]));
  ranked.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (right.candidate.immediateGain !== left.candidate.immediateGain) {
      return right.candidate.immediateGain - left.candidate.immediateGain;
    }
    const tie = (tieBreakByMove.get(moveKey(left.candidate.move)) ?? 0) -
      (tieBreakByMove.get(moveKey(right.candidate.move)) ?? 0);
    if (tie !== 0 && profile.mistakeRate > 0) return tie;
    return moveTieBreaker(left.candidate.move) - moveTieBreaker(right.candidate.move);
  });

  if (learning && !ranked.some(({ outcome, score }) => outcome === "win" || score >= 1_000_000)) {
    const allowed = new Set(
      learning
        .filterCandidates(state, aiPlayer, ranked.map(({ candidate }) => candidate.move))
        .map(moveKey),
    );
    const filtered = ranked.filter(({ candidate }) => allowed.has(moveKey(candidate.move)));
    if (filtered.length > 0 && filtered.length < ranked.length) {
      ranked = filtered;
    } else {
      ranked.sort((left, right) => {
        const learnedOrder = learning.compareMoves(
          state,
          aiPlayer,
          left.candidate.move,
          right.candidate.move,
        );
        if (learnedOrder !== 0) return learnedOrder;
        return right.score - left.score;
      });
    }
  }

  const completedDepth = result.branches.reduce(
    (depth, branch) => Math.min(depth, branch.completedDepth),
    result.branches[0]?.completedDepth ?? 0,
  );
  return {
    move: ranked[0]?.candidate.move ?? null,
    source: "trang-nguyen-best-first",
    completedDepth,
    nodeCount,
    budgetReason: result.budgetReason,
    learningEnabled: Boolean(learning),
  };
}

function filterLearnedCandidates(
  state: GameState,
  candidates: ProductionAiMoveCandidate[],
  aiPlayer: PlayerId,
  learning: TrangNguyenLearningReader,
): ProductionAiMoveCandidate[] {
  const allowed = new Set(
    learning
      .filterCandidates(state, aiPlayer, candidates.map((candidate) => candidate.move))
      .map(moveKey),
  );
  const filtered = candidates.filter((candidate) => allowed.has(moveKey(candidate.move)));
  return filtered.length > 0 ? filtered : candidates;
}

function scoreHeuristicCandidate(candidate: ProductionAiMoveCandidate, aiPlayer: PlayerId): number {
  const profile = PRODUCTION_TOP_PROFILES["trang-nguyen"];
  const opponent = otherPlayer(aiPlayer);
  const opponentThreat = bestImmediateGain(candidate.state, opponent);
  return (
    candidate.immediateGain * profile.weights.immediateCapture -
    opponentThreat * profile.weights.opponentThreat +
    evaluateProductionState(candidate.state, aiPlayer, profile) * profile.positionWeight -
    candidate.state.scores[opponent] * 20
  );
}

function moveOrderingScore(candidate: ProductionAiMoveCandidate, aiPlayer: PlayerId): number {
  const profile = PRODUCTION_TOP_PROFILES["trang-nguyen"];
  const opponentThreat = bestImmediateGain(candidate.state, otherPlayer(aiPlayer));
  return (
    candidate.immediateGain * profile.weights.immediateCapture -
    opponentThreat * profile.weights.opponentThreat +
    evaluateProductionState(candidate.state, aiPlayer, profile) * 0.05
  );
}

function bestImmediateGain(state: GameState, player: PlayerId): number {
  if (state.status === "finished" || state.currentPlayer !== player) return 0;
  return Math.max(0, ...enumerateProductionMoves(state, player).map((candidate) => candidate.immediateGain));
}

function effectiveTrangNguyenDepth(state: GameState, aiPlayer: PlayerId): number {
  const profile = PRODUCTION_TOP_PROFILES["trang-nguyen"];
  let depth = profile.searchDepth;
  if (aiPlayer === "P1") depth += profile.secondPlayerDepthBonus;
  if (profile.useEndgameSolver && isEndgameState(state)) {
    depth += profile.bossBuff?.endgameDepthBonus ?? profile.secondPlayerDepthBonus;
  }
  return depth;
}

function isEndgameState(state: GameState): boolean {
  const quanValue = state.pits
    .filter((pit) => pit.kind === "quan")
    .reduce((sum, pit) => sum + pit.stones + pit.quanStones * 10, 0);
  return quanValue <= 8 || state.moveNumber >= 28;
}

function chooseOpeningBookMove(
  state: GameState,
  candidates: ProductionAiMoveCandidate[],
  aiPlayer: PlayerId,
): ProductionAiMove | null {
  const preferredMoves: ProductionAiMove[] = [];
  if (state.moveNumber === 0 && aiPlayer === "P0") {
    preferredMoves.push(
      { pit: "B3", dir: "CW" },
      { pit: "B3", dir: "CCW" },
      { pit: "B2", dir: "CCW" },
      { pit: "B4", dir: "CW" },
    );
  }
  if (state.moveNumber === 1 && aiPlayer === "P1") {
    const previousMove = state.recentMoves.at(-1);
    if (previousMove?.pit === "B2" && previousMove.dir === "CW") {
      preferredMoves.push(
        { pit: "T3", dir: "CW" },
        { pit: "T5", dir: "CCW" },
        { pit: "T1", dir: "CCW" },
        { pit: "T5", dir: "CW" },
      );
    } else if (previousMove?.pit === "B3" && previousMove.dir === "CW") {
      preferredMoves.push(
        { pit: "T2", dir: "CW" },
        { pit: "T4", dir: "CCW" },
        { pit: "T1", dir: "CW" },
      );
    }
  }
  if (state.moveNumber === 3 && aiPlayer === "P1") {
    const [firstMove, secondMove, thirdMove] = state.recentMoves.slice(-3);
    if (
      firstMove?.player === "P0" && firstMove.pit === "B2" && firstMove.dir === "CW" &&
      secondMove?.player === "P1" && secondMove.pit === "T3" && secondMove.dir === "CW" &&
      thirdMove?.player === "P0" && thirdMove.pit === "B3" && thirdMove.dir === "CW"
    ) {
      preferredMoves.push({ pit: "T5", dir: "CW" });
    }
  }
  for (const preferred of preferredMoves) {
    if (candidates.some((candidate) => sameMove(candidate.move, preferred))) return preferred;
  }
  return null;
}

function suppressMistakes(random: () => number): () => number {
  return () => 0.5 + random() * 0.5;
}

function moveTieBreaker(move: ProductionAiMove): number {
  const pits = ["B1", "B2", "B3", "B4", "B5", "T1", "T2", "T3", "T4", "T5"];
  return pits.indexOf(move.pit) * 2 + (move.dir === "CW" ? 0 : 1);
}

function moveKey(move: ProductionAiMove): string {
  return `${move.pit}:${move.dir}`;
}

function sameMove(left: ProductionAiMove, right: ProductionAiMove): boolean {
  return left.pit === right.pit && left.dir === right.dir;
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === "P0" ? "P1" : "P0";
}
