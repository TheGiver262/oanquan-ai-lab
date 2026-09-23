# oanquan-ai-lab

Lean research lab for **Ô Ăn Quan** AI. Production web/app code is intentionally excluded.

## Current research target

Every future AI promotion study must run on **both**:
- `pie-threefold`
- `quan-gia-threefold`

`standard` is historical/reference control only.

## Current incumbent

**PUCT V3A.2 positive-only material36** is the canonical incumbent for both target modes.

V3A.2 keeps the V3A.1 high-material protection against temporary **positive** score leads, but no longer erases a legitimate **negative** score deficit when material >36.

Promotion evidence across 10k/20k/50k fixed simulations:
- 120 games;
- 60 completed opening pairs;
- **0 unfavorable pairs**;
- 0 unresolved games.

The previous Quan Gia regressions at `B3:CW` and `B3:CCW` are closed.

PVS/NegaScout is excluded from active research.

## Setup

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Canonical target-mode benchmark

```bash
npm run benchmark:target-modes -- --mode pie-threefold --fixed-simulations 10000
npm run benchmark:target-modes -- --mode quan-gia-threefold --fixed-simulations 10000
```

The benchmark uses **V3A.2**. Pie ownership follows research-agent identity through SWAP.

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
- Future promotion requires acceptable evidence on both target modes.
- Unresolved games are censored, never heuristic-adjudicated.

## License

MIT.
