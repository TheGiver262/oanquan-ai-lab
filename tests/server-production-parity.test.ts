import { describe, expect, it } from "vitest";
import { applyMove, createInitialState, createStateHash } from "../src/engine.js";
import { PRODUCTION_TOP_PROFILES } from "../src/reference/production-ai.js";
import {
  PRODUCTION_SOURCE_COMMIT,
  chooseServerProductionMove,
  chooseServerProductionMoveWithDiagnostics,
} from "../src/reference/server-production-ai.js";
import {
  createTrangNguyenLearningReader,
  trangNguyenPositionKey,
  type TrangNguyenLearningSnapshotV1,
} from "../src/reference/trang-nguyen-learning.js";

describe("server production parity snapshot", () => {
  it("pins the production source commit and initial state hash", () => {
    expect(PRODUCTION_SOURCE_COMMIT).toBe("4984701ce151ee270a6a5ba5fc9211a6ec2b6996");
    expect(createStateHash(createInitialState())).toBe("56f223bd");
  });

  it("keeps the full top-three production profiles", () => {
    expect(PRODUCTION_TOP_PROFILES["tham-hoa"]).toMatchObject({
      searchDepth: 6,
      secondPlayerDepthBonus: 3,
      fullWidthDepth: 2,
      maxBranchingMoves: 6,
      secondPlayerBranchingBonus: 2,
      nodeBudget: 36_000,
      timeBudgetMs: 600,
      useCache: true,
      useMoveOrdering: true,
      useOpeningBook: true,
      mistakeRate: 0.05,
    });
    expect(PRODUCTION_TOP_PROFILES["bang-nhan"]).toMatchObject({
      searchDepth: 8,
      secondPlayerDepthBonus: 3,
      fullWidthDepth: 2,
      maxBranchingMoves: 5,
      nodeBudget: 55_000,
      timeBudgetMs: 900,
      useCache: true,
      useMoveOrdering: true,
      useOpeningBook: true,
      useEndgameSolver: true,
      mistakeRate: 0.01,
    });
    expect(PRODUCTION_TOP_PROFILES["trang-nguyen"]).toMatchObject({
      searchDepth: 11,
      secondPlayerDepthBonus: 5,
      fullWidthDepth: 3,
      maxBranchingMoves: 6,
      nodeBudget: 100_000,
      timeBudgetMs: 1_200,
      useCache: true,
      useMoveOrdering: true,
      useOpeningBook: true,
      useEndgameSolver: true,
      mistakeRate: 0,
      bossBuff: { tieCountsAsAiWin: false, virtualScoreBonus: 0, endgameDepthBonus: 4 },
    });
  });

  it("preserves the production Tham Hoa reply book", () => {
    const opening = applyMove(createInitialState(), { player: "P0", pit: "B2", dir: "CW" });
    if (!opening.ok) throw new Error("Expected B2 CW to be legal");
    const move = chooseServerProductionMove(opening.state, "tham-hoa", "P1", {
      random: () => 0.5,
    });
    expect(move).toEqual({ pit: "T3", dir: "CW" });
  });

  it("uses the server best-first path for Trang Nguyen", () => {
    const opening = applyMove(createInitialState(), { player: "P0", pit: "B2", dir: "CW" });
    if (!opening.ok) throw new Error("Expected B2 CW to be legal");
    const decision = chooseServerProductionMoveWithDiagnostics(
      opening.state,
      "trang-nguyen",
      "P1",
      {
        nodeBudget: 100_000,
        random: () => 0.5,
        timeBudgetMs: 5_000,
      },
    );
    expect(decision.source).toBe("trang-nguyen-best-first");
    expect(decision.move).toEqual({ pit: "T5", dir: "CW" });
    expect(decision.nodeCount).toBeGreaterThan(0);
  }, 10_000);

  it("filters a learned losing root move like the production learning reader", () => {
    const opening = applyMove(createInitialState(), { player: "P0", pit: "B2", dir: "CW" });
    if (!opening.ok) throw new Error("Expected B2 CW to be legal");
    const snapshot: TrangNguyenLearningSnapshotV1 = {
      version: 1,
      updatedAt: 1,
      entries: [
        {
          positionKey: trangNguyenPositionKey(opening.state, "P1"),
          move: { pit: "T3", dir: "CW" },
          wins: 0,
          draws: 0,
          losses: 1,
          lossWeight: 1,
          updatedAt: 1,
        },
      ],
      solvedStates: [],
    };
    const learning = createTrangNguyenLearningReader(snapshot);
    const move = chooseServerProductionMove(opening.state, "trang-nguyen", "P1", {
      learning,
      nodeBudget: 2_000,
      random: () => 0.5,
      timeBudgetMs: 200,
    });
    expect(move).not.toEqual({ pit: "T3", dir: "CW" });
    expect(move).not.toBeNull();
  });

  it("production-max suppresses intentional Tham Hoa/Bang Nhan mistakes", () => {
    const state = createInitialState();
    for (const difficulty of ["tham-hoa", "bang-nhan"] as const) {
      const live = chooseServerProductionMove(state, difficulty, "P0", {
        mode: "production-live",
        random: () => 0,
        timeBudgetMs: 20,
      });
      const max = chooseServerProductionMove(state, difficulty, "P0", {
        mode: "production-max",
        random: () => 0,
        timeBudgetMs: 20,
      });
      expect(live).not.toBeNull();
      expect(max).not.toBeNull();
    }
  });
});
