# Canonical Research Index — 2026-09-21

The canonical branches are `main` and `research/balanced-mode-tournament`; they are kept synchronized after research promotion/cleanup.

## Forward evaluation protocol

Every future AI algorithm promotion/rejection study must evaluate both:
1. `pie-threefold`
2. `quan-gia-threefold`

Standard is historical/reference control only.

## Current incumbent

**PUCT V3A.2 positive-only material36** is the canonical baseline for both target modes.

Mechanism:
- material <=36: scoreDelta weight 1.8;
- material >36 with positive scoreDelta: suppress scoreDelta;
- material >36 with zero/negative scoreDelta: retain scoreDelta weight 1.8.

Promotion evidence:
- 10k, 20k and 50k fixed-simulation all-opening paired gates;
- 120 games total;
- 60 completed pairs;
- 0 unfavorable pairs;
- 0 unresolved games.

The full causal and promotion record is:
- `docs/research/V3A2_POSITIVE_ONLY_PROMOTION_2026-09-21.md`

Standard historical incumbent remains V3A.1 material36; no new Standard promotion is claimed.

## Retained implementation

- `src/research/puct-v3a.ts`
- `src/research/puct-v3a1.ts`
- `src/research/mode-aware-puct-v3a.ts`
- `src/research/mode-aware-puct-v3a1.ts`
- `src/research/mode-aware-puct-v3a2.ts`
- `src/research/balance-modes.ts`

## Retained correctness guards

- `tests/engine.test.ts`
- `tests/ai.test.ts`
- `tests/puct-v3a.test.ts`
- `tests/puct-v3a1.test.ts`
- `tests/mode-aware-puct-v3a.test.ts`
- `tests/balance-modes.test.ts`
- `tests/quan-gia-threefold.test.ts`
- `tests/server-production-parity.test.ts`

Current reusable benchmark:
- `src/benchmarks/target-mode-v3a2-selfplay.ts`

## Retained evidence

- `docs/research/BALANCE_CORE_MODES_PROTOCOL_2026-09-18.md` — current dual-mode protocol.
- `docs/research/B3_PUCT_ROOT_CAUSE_AUDIT_2026-09-18.md` — original score-horizon causal evidence.
- `docs/research/V3A1_MATERIAL36_PROMOTION_VERDICT_2026-09-18.md` — Standard-only V3A.1 evidence.
- `docs/research/V3A1_DUAL_MODE_REVALIDATION_2026-09-21.md` — identified V3A.1 Quan Gia regression.
- `docs/research/V3A2_POSITIVE_ONLY_PROMOTION_2026-09-21.md` — causal fix and dual-mode promotion.
- `docs/research/V4_QUIESCENCE_FAMILY_CLOSED_2026-09-18.md` — Standard-only failed V4 family.
- `docs/research/V5_TRANSPOSITION_GRAPH_REJECTION_2026-09-19.md` — Standard-only failed V5 family.
- `docs/research/QG_POSITIONAL_THREEFOLD_VERDICT_2026-09-18.md` — rejected positional repetition variant.
- `docs/research/HISTORICAL_RESEARCH_SUMMARY_2026-09-21.md` — consolidated removed history.
- `docs/r1a-production-parity-audit.md` — production parity evidence.

## Closed research

- PVS/NegaScout: excluded.
- Fixed-threshold retuning for the V3A.1 Quan Gia regression: rejected; thresholds 18/24/30/36/42 regressed elsewhere and 48 effectively returned toward V3A in the forced-opening suite.
- V4 one-ply family: closed for Standard.
- V5 retained transposition graph family: closed for Standard.
- Old MCTS/ordering/opening/R1 intermediates: consolidated and removed.
- Positional-threefold variant: closed.

## Repository hygiene

- Persistent workflow: `.github/workflows/ci.yml` only.
- Failed/superseded research keeps reports, not implementations.
- One-off workflows/benchmarks/results are removed after consolidation.
- `results/` contains only `.gitkeep`.
- Future one-off research uses a temporary branch and is deleted after verdict consolidation.
