import { describe, expect, it } from "vitest";
import { computePnSumBonuses } from "../src/research/pnsum.js";

describe("PNSum normalization", () => {
  it("uses the published finite-sum normalization", () => {
    const values = computePnSumBonuses([1, 2, null]);
    expect(values[0]).toBeCloseTo(0.75, 12);
    expect(values[1]).toBeCloseTo(0.5, 12);
    expect(values[2]).toBe(0);
  });

  it("gives proven zero proof number the maximum bonus", () => {
    const values = computePnSumBonuses([0, 1]);
    expect(values[0]).toBe(1);
    expect(values[1]).toBeCloseTo(0.5, 12);
  });

  it("returns zero when no finite proof evidence exists", () => {
    expect(computePnSumBonuses([null, null])).toEqual([0, 0]);
  });

  it("rejects invalid negative proof numbers", () => {
    expect(() => computePnSumBonuses([1, -1])).toThrow(/proof numbers/);
  });
});
