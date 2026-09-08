export type V3EvaluationFamily = "material" | "strategic";
export type V3FinalistOpening = "B3:CW" | "B3:CCW";

/**
 * Principal variations recorded by Opening Balance V3 at the 50M-node probe.
 * These are evidence seeds, not exact lines and not an opening book.
 * Provenance: docs/opening-balance-v3.md, workflow run 34185314775.
 */
export const V3_50M_PV: Record<`${V3FinalistOpening}:${V3EvaluationFamily}`, readonly string[]> = {
  "B3:CW:material": [
    "T1:CW", "B3:CCW", "T2:CW", "B4:CCW", "T3:CW", "B1:CCW", "T3:CW", "B3:CW",
    "T1:CCW", "B5:CCW", "T3:CW", "B2:CW", "T5:CCW", "B3:CCW", "T5:CW", "B1:CW",
    "T3:CW", "B2:CCW", "T1:CCW",
  ],
  "B3:CW:strategic": [
    "T1:CW", "B1:CCW", "T3:CW", "B2:CW", "T5:CCW", "B5:CCW", "T3:CCW", "B5:CW",
    "T4:CW", "B5:CCW", "T1:CCW", "B2:CW", "T3:CW", "B3:CCW", "T4:CW", "B1:CW",
  ],
  "B3:CCW:material": [
    "T1:CW", "B5:CW", "T2:CW", "B1:CCW", "T4:CW", "B4:CW", "T3:CW", "B2:CCW",
    "T1:CCW", "B5:CW", "T3:CW", "B3:CCW", "T4:CCW", "B4:CCW", "T1:CW", "B5:CW",
    "T3:CCW", "B4:CCW", "T1:CCW",
  ],
  "B3:CCW:strategic": [
    "T4:CCW", "B1:CW", "T3:CCW", "B5:CW", "T1:CW", "B2:CCW", "T3:CCW", "B4:CW",
    "T1:CW", "B1:CCW", "T2:CW", "B3:CW", "T4:CW", "B4:CCW", "T3:CW", "B3:CW",
    "T4:CW", "B4:CCW", "T5:CCW", "B2:CW",
  ],
};
