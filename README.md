# oanquan-ai-lab

Lean research lab for **Ô Ăn Quan** AI. Production web/app code is intentionally excluded.

## Current research target

Canonical evaluation modes:
- **Primary:** `quan-gia-threefold`
- **Reference:** `pie-threefold`
- **Reference:** `standard`

Future AI research is optimized and judged primarily on **Quan Gia + Threefold**.
Pie + Threefold and Standard remain comparison/reference modes and no longer
have equal veto power over promotion decisions.

## Current incumbent

**Primary mode — Quan Gia + Threefold:** **PUCT V3B.1 PNSum Cpn=2.0**.

Primary promotion evidence vs V3A.2:
- 5k: 6 favorable / 4 neutral / **0 unfavorable** pairs;
- 10k: 4 favorable / 6 neutral / **0 unfavorable** pairs;
- 20k: 4 favorable / 6 neutral / **0 unfavorable** pairs;
- 50k: 2 favorable / 8 neutral / **0 unfavorable** pairs;
- no unresolved games in the promoted Cpn=2.0 primary gates.

**Reference modes — Pie + Threefold / Standard:** retain **V3A.2 positive-only material36** as the comparison baseline. V3B.1 regressed on these reference modes and is not claimed as a universal replacement.

PVS/NegaScout remains excluded from active research.

## Setup

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Canonical benchmarks

Primary Quan Gia incumbent vs V3A.2:

```bash
npm run benchmark:primary -- --fixed-simulations 10000
```

V3A.2 reference benchmark:

```bash
npm run benchmark:target-modes -- --mode pie-threefold --fixed-simulations 10000
npm run benchmark:target-modes -- --mode quan-gia-threefold --fixed-simulations 10000
```

Pie ownership follows research-agent identity through SWAP.

## Production reference

Frozen server-production reference:

```text
TheGiver262/O_an_quan
commit 73c698762c514d171869a79982fdc86103653e8f
```

`tests/server-production-parity.test.ts` remains the production parity guard.

## Retained research evidence

- `docs/research/CANONICAL_RESEARCH_INDEX_2026-09-18.md`
- `docs/research/BALANCE_CORE_MODES_PROTOCOL_2026-09-18.md`
- `docs/research/B3_PUCT_ROOT_CAUSE_AUDIT_2026-09-18.md`
- `docs/research/V3A1_MATERIAL36_PROMOTION_VERDICT_2026-09-18.md`
- `docs/research/V3A1_DUAL_MODE_REVALIDATION_2026-09-21.md`
- `docs/research/V3A2_POSITIVE_ONLY_PROMOTION_2026-09-21.md`
- `docs/research/V3A2_TARGET_MODE_BALANCE_AUDIT_2026-09-22.md`
- `docs/research/V3A3_BOUNDED_SOLVED_TT_REJECTION_2026-09-22.md`
- `docs/research/V3A4_IMPLICIT_MINIMAX_REJECTION_2026-09-23.md`
- `docs/research/V3A5_VISIT_DECAYED_IMPLICIT_MINIMAX_REJECTION_2026-09-24.md`
- `docs/research/V3B_PNMAX_REJECTION_2026-09-24.md`
- `docs/research/V3B1_PNSUM_PROMOTION_2026-09-24.md`
- `docs/research/V3B2_SCORE_BOUNDED_NO_GAIN_2026-09-24.md`
- `docs/research/V3B3_MOBILITY_PROOF_INIT_REJECTION_2026-09-24.md`
- `docs/research/V3B4_PNRANK_REJECTION_2026-09-24.md`
- `docs/research/V3C_ROOT_ALPHA_BETA_VERIFIER_REJECTION_2026-09-24.md`
- `docs/research/V4_QUIESCENCE_FAMILY_CLOSED_2026-09-18.md`
- `docs/research/V5_TRANSPOSITION_GRAPH_REJECTION_2026-09-19.md`
- `docs/research/QG_POSITIONAL_THREEFOLD_VERDICT_2026-09-18.md`
- `docs/research/HISTORICAL_RESEARCH_SUMMARY_2026-09-21.md`
- `docs/r1a-production-parity-audit.md`

## Repository policy

- Keep current reusable code and correctness guards only.
- Closed/failed research keeps a consolidated report, not one-off code.
- Delete one-off benchmark scripts/workflows/runs after consolidation.
- `results/` stays empty except for `.gitkeep`.
- `.github/workflows/ci.yml` is the only persistent workflow.
- Future promotion is decided primarily on `quan-gia-threefold`; `pie-threefold` and `standard` are secondary reference checks.
- Unresolved games are censored, never heuristic-adjudicated.

## License

MIT.
