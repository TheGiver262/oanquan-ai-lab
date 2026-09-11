const PROOF_NUMBER_CAP = Number.MAX_SAFE_INTEGER;

/**
 * Generalized proof-number PNSum normalization.
 * `null` represents infinity in the public/testable API.
 *
 * PNSum(i) = 0,                                if pn(i) = infinity
 *          = 1 - pn(i) / (1 + sum finite pn), otherwise
 */
export function computePnSumBonuses(proofNumbers: readonly (number | null)[]): number[] {
  let finiteSum = 0;
  let finiteCount = 0;
  for (const value of proofNumbers) {
    if (value == null || !Number.isFinite(value)) continue;
    if (value < 0) throw new Error("proof numbers must be >= 0");
    finiteCount += 1;
    finiteSum = Math.min(PROOF_NUMBER_CAP, finiteSum + value);
  }
  if (finiteCount === 0) return new Array<number>(proofNumbers.length).fill(0);

  const denominator = 1 + finiteSum;
  return proofNumbers.map((value) => {
    if (value == null || !Number.isFinite(value)) return 0;
    return 1 - value / denominator;
  });
}
