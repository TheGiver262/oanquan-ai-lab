import { describe, expect, it } from "vitest";
import { createInitialState, getLegalMoves } from "../src/engine.js";
import { exactStrategicStateKey } from "../src/research/exact-endgame-v4.js";
import { searchPolicyAwarePvsV5 } from "../src/research/policy-aware-pvs-v5.js";
import { createPolicyState } from "../src/research/repetition-policy-v5.js";
import { searchTablebasePvsV6 } from "../src/research/tablebase-pvs-v6.js";
import {
  createWdlTablebaseV6,
  deserializeWdlTablebaseV6,
  lookupWdlTablebaseV6,
  serializeWdlTablebaseV6,
} from "../src/research/wdl-tablebase-v6.js";

const THREEFOLD = { kind: "repeat-draw", occurrences: 3 } as const;

describe("V6 tablebase PVS", () => {
  it("matches V5 PVS when no tablebase is supplied", () => {
    const root = createPolicyState(createInitialState());
    const options = {
      maxDepth: 3,
      nodeBudget: 100_000,
      timeBudgetMs: 10_000,
      aspirationWindow: 250,
      usePvs: true,
      evaluationFamily: "strategic" as const,
    };

    const baseline = searchPolicyAwarePvsV5(root, THREEFOLD, options);
    const candidate = searchTablebasePvsV6(root, THREEFOLD, options);

    expect(candidate.move).toEqual(baseline.move);
    expect(candidate.score).toBe(baseline.score);
    expect(candidate.principalVariation).toEqual(baseline.principalVariation);
    expect(candidate.diagnostics.completedDepth).toBe(baseline.diagnostics.completedDepth);
    expect(candidate.diagnostics.nodeCount).toBe(baseline.diagnostics.nodeCount);
    expect(candidate.diagnostics.tablebaseLookups).toBe(0);
    expect(candidate.diagnostics.tablebaseHits).toBe(0);
  });

  it("returns an exact root WDL tablebase hit without search and above bounded terminal utility", () => {
    const root = createPolicyState(createInitialState());
    const proofMove = getLegalMoves(root.game)[0]!;
    const tablebase = createWdlTablebaseV6([[
      {
        key: exactStrategicStateKey(root.game),
        outcome: "win",
        proofMove,
      },
    ]]);

    const result = searchTablebasePvsV6(root, THREEFOLD, {
      tablebase,
      tablebaseMaxBoardValue: 100,
      maxDepth: 12,
      nodeBudget: 100_000,
      timeBudgetMs: 1_000,
    });

    expect(result.scoreSource).toBe("tablebase");
    expect(result.exactWdl).toBe("win");
    expect(result.move).toEqual(proofMove);
    expect(result.score).toBeGreaterThan(10_000_100);
    expect(result.diagnostics.nodeCount).toBe(0);
    expect(result.diagnostics.tablebaseLookups).toBe(1);
    expect(result.diagnostics.tablebaseHits).toBe(1);
  });

  it("round-trips exact WDL entries and rejects contradictory merges", () => {
    const root = createPolicyState(createInitialState());
    const proofMove = getLegalMoves(root.game)[0]!;
    const key = exactStrategicStateKey(root.game);
    const tablebase = createWdlTablebaseV6([[
      { key, outcome: "win", proofMove },
    ]]);

    const serialized = serializeWdlTablebaseV6(tablebase);
    const roundTripped = deserializeWdlTablebaseV6(serialized);
    expect(lookupWdlTablebaseV6(roundTripped, root, THREEFOLD)).toEqual({
      key,
      outcome: "win",
      proofMove,
    });

    expect(() => createWdlTablebaseV6([
      [{ key, outcome: "win", proofMove }],
      [{ key, outcome: "loss", proofMove: null }],
    ])).toThrow(/Contradictory WDL tablebase proof/);
  });
});
