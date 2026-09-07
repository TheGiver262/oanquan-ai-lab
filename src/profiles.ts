export const AI_DIFFICULTIES = [
  "thu-sinh",
  "tu-tai",
  "cu-nhan",
  "tien-si",
  "tham-hoa",
  "bang-nhan",
  "trang-nguyen",
] as const;

export type AiDifficulty = (typeof AI_DIFFICULTIES)[number];

export type AiHeuristicWeights = {
  score: number;
  side: number;
  refill: number;
  quanPressure: number;
  immediateCapture: number;
  opponentThreat: number;
  mobility: number;
  endgame: number;
};

export type AiDifficultyProfile = {
  id: AiDifficulty;
  label: string;
  searchDepth: number;
  secondPlayerDepthBonus: number;
  mistakeRate: number;
  captureWeight: number;
  retaliationPenalty: number;
  positionWeight: number;
  useCache: boolean;
  useMoveOrdering: boolean;
  useOpeningBook: boolean;
  useEndgameSolver: boolean;
  fullWidthDepth: number;
  maxBranchingMoves: number;
  secondPlayerBranchingBonus?: number;
  nodeBudget: number;
  timeBudgetMs: number;
  maxCacheEntries: number;
  weights: AiHeuristicWeights;
};

const BASIC_WEIGHTS: AiHeuristicWeights = {
  score: 100, side: 5, refill: 12, quanPressure: 1, immediateCapture: 90,
  opponentThreat: 70, mobility: 2, endgame: 20,
};
const NOVICE_WEIGHTS: AiHeuristicWeights = {
  score: 70, side: 3, refill: 6, quanPressure: 0.5, immediateCapture: 35,
  opponentThreat: 15, mobility: 1, endgame: 8,
};
const MASTER_WEIGHTS: AiHeuristicWeights = {
  score: 155, side: 7, refill: 22, quanPressure: 2.5, immediateCapture: 140,
  opponentThreat: 125, mobility: 4, endgame: 42,
};
const GRANDMASTER_WEIGHTS: AiHeuristicWeights = { ...MASTER_WEIGHTS, opponentThreat: 126 };

// Mirrored from the current local-game AI profiles in O_an_quan (2026-09).
export const AI_DIFFICULTY_PROFILES: Record<AiDifficulty, AiDifficultyProfile> = {
  "thu-sinh": {
    id: "thu-sinh", label: "Thư sinh", searchDepth: 0, secondPlayerDepthBonus: 0,
    mistakeRate: 0.1, captureWeight: 28, retaliationPenalty: 6, positionWeight: 0.1,
    useCache: false, useMoveOrdering: false, useOpeningBook: false, useEndgameSolver: false,
    fullWidthDepth: 0, maxBranchingMoves: 10, nodeBudget: 300, timeBudgetMs: 20, maxCacheEntries: 0,
    weights: NOVICE_WEIGHTS,
  },
  "tu-tai": {
    id: "tu-tai", label: "Tú Tài", searchDepth: 0, secondPlayerDepthBonus: 0,
    mistakeRate: 0.1, captureWeight: 90, retaliationPenalty: 35, positionWeight: 0.35,
    useCache: false, useMoveOrdering: false, useOpeningBook: false, useEndgameSolver: false,
    fullWidthDepth: 0, maxBranchingMoves: 10, nodeBudget: 600, timeBudgetMs: 30, maxCacheEntries: 0,
    weights: { ...NOVICE_WEIGHTS, immediateCapture: 70, opponentThreat: 35 },
  },
  "cu-nhan": {
    id: "cu-nhan", label: "Cử nhân", searchDepth: 0, secondPlayerDepthBonus: 0,
    mistakeRate: 0.1, captureWeight: 120, retaliationPenalty: 85, positionWeight: 0.75,
    useCache: false, useMoveOrdering: false, useOpeningBook: false, useEndgameSolver: false,
    fullWidthDepth: 0, maxBranchingMoves: 10, nodeBudget: 1200, timeBudgetMs: 40, maxCacheEntries: 0,
    weights: { ...BASIC_WEIGHTS, score: 85, side: 4, refill: 8, opponentThreat: 30, endgame: 10 },
  },
  "tien-si": {
    id: "tien-si", label: "Tiến sĩ", searchDepth: 4, secondPlayerDepthBonus: 1,
    mistakeRate: 0.1, captureWeight: 125, retaliationPenalty: 92, positionWeight: 1,
    useCache: true, useMoveOrdering: true, useOpeningBook: true, useEndgameSolver: false,
    fullWidthDepth: 2, maxBranchingMoves: 8, nodeBudget: 20000, timeBudgetMs: 120, maxCacheEntries: 5000,
    weights: { score: 125, side: 6, refill: 16, quanPressure: 2, immediateCapture: 120, opponentThreat: 90, mobility: 3, endgame: 28 },
  },
  "tham-hoa": {
    id: "tham-hoa", label: "Thám hoa", searchDepth: 6, secondPlayerDepthBonus: 2,
    mistakeRate: 0.05, captureWeight: 130, retaliationPenalty: 98, positionWeight: 1.15,
    useCache: true, useMoveOrdering: true, useOpeningBook: true, useEndgameSolver: false,
    fullWidthDepth: 2, maxBranchingMoves: 6, secondPlayerBranchingBonus: 1,
    nodeBudget: 24000, timeBudgetMs: 450, maxCacheEntries: 7500,
    weights: { score: 145, side: 6.5, refill: 20, quanPressure: 2.25, immediateCapture: 132, opponentThreat: 115, mobility: 3.5, endgame: 34 },
  },
  "bang-nhan": {
    id: "bang-nhan", label: "Bảng nhãn", searchDepth: 7, secondPlayerDepthBonus: 2,
    mistakeRate: 0.01, captureWeight: 135, retaliationPenalty: 104, positionWeight: 1.2,
    useCache: true, useMoveOrdering: true, useOpeningBook: true, useEndgameSolver: true,
    fullWidthDepth: 2, maxBranchingMoves: 5, nodeBudget: 28000, timeBudgetMs: 650, maxCacheEntries: 12000,
    weights: MASTER_WEIGHTS,
  },
  "trang-nguyen": {
    id: "trang-nguyen", label: "Trạng nguyên", searchDepth: 11, secondPlayerDepthBonus: 5,
    mistakeRate: 0, captureWeight: 145, retaliationPenalty: 112, positionWeight: 1.3,
    useCache: true, useMoveOrdering: true, useOpeningBook: true, useEndgameSolver: true,
    fullWidthDepth: 3, maxBranchingMoves: 6, nodeBudget: 100000, timeBudgetMs: 1000, maxCacheEntries: 20000,
    weights: GRANDMASTER_WEIGHTS,
  },
};
