# Canonical Research Index — 2026-09-21

The canonical branch is `main`. Temporary research branches are disposable and must not be treated as canonical after evidence is consolidated.

## Forward evaluation protocol

Canonical mode priority:
1. **Primary:** `quan-gia-threefold`
2. **Reference:** `pie-threefold`
3. **Reference:** `standard`

Future AI promotion/rejection decisions are driven primarily by Quan Gia +
Threefold. Pie + Threefold and Standard are retained as secondary comparison
modes, but a regression there alone does not automatically veto a challenger
that is clearly stronger and stable on the primary mode. Any severe
cross-mode correctness or stability regression must still be reported.

## Current incumbent

### Primary: Quan Gia + Threefold

**PUCT V3B.1 PNSum Cpn=2.0** is the canonical primary-mode incumbent.

Promotion evidence vs V3A.2:
- 5k: 6 favorable / 4 neutral / 0 unfavorable / 0 unresolved pairs;
- 10k: 4 / 6 / 0 / 0;
- 20k: 4 / 6 / 0 / 0;
- 50k: 2 / 8 / 0 / 0.

Final 50k aggregate: **12W-0D-8L**, with `B3:CW` and `B3:CCW` favorable and all other opening pairs neutral.

Canonical record:
- `docs/research/V3B1_PNSUM_PROMOTION_2026-09-24.md`

### Reference modes

**V3A.2 positive-only material36** remains the Pie + Threefold / general comparison baseline because V3B.1 regressed on Pie and Standard at the 10k reference check.

Standard's older historical V3A.1 evidence remains historical; no V3B.1 Standard promotion is claimed.

## Retained implementation

- `src/research/puct-v3a.ts`
- `src/research/puct-v3a1.ts`
- `src/research/mode-aware-puct-v3a.ts`
- `src/research/mode-aware-puct-v3a1.ts`
- `src/research/mode-aware-puct-v3a2.ts`
- `src/research/mode-aware-puct-v3b1.ts`
- `src/research/balance-modes.ts`

## Retained correctness guards

- `tests/engine.test.ts`
- `tests/ai.test.ts`
- `tests/puct-v3a.test.ts`
- `tests/puct-v3a1.test.ts`
- `tests/mode-aware-puct-v3a.test.ts`
- `tests/mode-aware-puct-v3b1.test.ts`
- `tests/balance-modes.test.ts`
- `tests/quan-gia-threefold.test.ts`
- `tests/server-production-parity.test.ts`

Current reusable benchmarks:
- `src/benchmarks/v3b1-pnsum-screen.ts` — primary Quan Gia incumbent vs V3A.2.
- `src/benchmarks/target-mode-v3a2-selfplay.ts` — V3A.2 reference benchmark.

## Retained evidence

- `docs/research/BALANCE_CORE_MODES_PROTOCOL_2026-09-18.md` — current dual-mode protocol.
- `docs/research/B3_PUCT_ROOT_CAUSE_AUDIT_2026-09-18.md` — original score-horizon causal evidence.
- `docs/research/V3A1_MATERIAL36_PROMOTION_VERDICT_2026-09-18.md` — Standard-only V3A.1 evidence.
- `docs/research/V3A1_DUAL_MODE_REVALIDATION_2026-09-21.md` — identified V3A.1 Quan Gia regression.
- `docs/research/V3A2_POSITIVE_ONLY_PROMOTION_2026-09-21.md` — causal fix and dual-mode promotion.
- `docs/research/V3A2_TARGET_MODE_BALANCE_AUDIT_2026-09-22.md` — 10k rule-balance audit comparing Pie + Threefold vs Quan Gia + Threefold under frozen V3A.2.
- `docs/research/V3A3_BOUNDED_SOLVED_TT_REJECTION_2026-09-22.md` — rejected bounded exact-solved TT challenger; V3A.2 retained.
- `docs/research/V3A4_IMPLICIT_MINIMAX_REJECTION_2026-09-23.md` — fixed-weight implicit-minimax challenger rejected after four unfavorable Quan Gia opening pairs at 10k.
- `docs/research/V3A5_VISIT_DECAYED_IMPLICIT_MINIMAX_REJECTION_2026-09-24.md` — visit-decayed implicit-minimax challenger rejected after six unfavorable Quan Gia opening pairs at 10k.
- `docs/research/V3B_PNMAX_REJECTION_2026-09-24.md` — PNMax proof-number guidance rejected at the Quan Gia 5k screen; Cpn=0.1 retained two repeatable unfavorable pairs.
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
- V3A.3 bounded exact-solved TT: closed after the 10k Quan Gia gate produced four unfavorable opening pairs.
- V3A.4 fixed implicit minimax: closed after a clean Pie 10k gate but four unfavorable Quan Gia opening pairs at 10k.
- V3A.5 visit-decayed implicit minimax: closed after H=128 regressed on six Quan Gia opening pairs at 10k.
- V3B PNMax proof-number guidance: closed after every preregistered coefficient produced Quan Gia regressions at 5k.
- V3B.2 Score-Bounded PNSum: closed after a non-regressive but zero-signal Quan Gia 5k gate; no 10k escalation.
- V3B.3 mobility proof initialization: closed after four Quan Gia 5k regressions, all reproduced in targeted confirmation.
- Old MCTS/ordering/opening/R1 intermediates: consolidated and removed.
- Positional-threefold variant: closed.

## Repository hygiene

- Persistent workflow: `.github/workflows/ci.yml` only.
- Failed/superseded research keeps reports, not implementations.
- One-off workflows/benchmarks/results are removed after consolidation.
- `results/` contains only `.gitkeep`.
- Future one-off research uses a temporary branch and is deleted after verdict consolidation.
