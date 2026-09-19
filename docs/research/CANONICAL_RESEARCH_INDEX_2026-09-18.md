# Canonical Research Index — 2026-09-19

This file defines the current research surface for `oanquan-ai-lab`.
The canonical research branch is `research/balanced-mode-tournament`.

## Canonical AI incumbent

**PUCT V3A.1 material36** is the canonical Standard/classic 2-player research incumbent.

Core implementation:
- `src/research/puct-v3a.ts` — historical V3A core with the research leaf-score material gate.
- `src/research/puct-v3a1.ts` — frozen V3A.1 material36 wrapper.
- `src/research/mode-aware-puct-v3a.ts` — reflection-canonical balance adapter.
- `src/research/mode-aware-puct-v3a1.ts` — frozen V3A.1 balance adapter.
- `tests/puct-v3a.test.ts`
- `tests/puct-v3a1.test.ts`
- `tests/mode-aware-puct-v3a.test.ts`

Canonical promotion evidence:
- `docs/research/V3A1_MATERIAL36_PROMOTION_VERDICT_2026-09-18.md`
- `.github/workflows/v3a1-material36-promotion-screen.yml`
- `.github/workflows/v3a1-material36-budget-robustness.yml`
- `.github/workflows/v3a1-material36-strong-same-family.yml`
- `.github/workflows/v3a1-material36-vs-trang-nguyen.yml`
- `src/benchmarks/v3a1-vs-v3a-fixed.ts`
- `src/benchmarks/v3a1-leaf-score-root-ablation.ts`
- `src/benchmarks/r1d-production-semantics-v3a-vs-trang-nguyen.ts`

Historical V3A evidence:
- `docs/research/R1_PROMOTION_VERDICT_2026-09-17.md`
- `docs/research/R1D_A_EVIDENCE_2026-09-17.md`
- `docs/research/AI_TRACK_CLOSED_BALANCE_TRACK_2026-09-17.md`

Trạng Nguyên comparisons remain `code-parity-no-live-learning-snapshot` unless the deployed learning snapshot is supplied.

## B3 search-discovery evidence

Canonical root-cause and fair-validation records:
- `docs/research/B3_PUCT_ROOT_CAUSE_AUDIT_2026-09-18.md`
- `docs/research/B3_FAIR_RESOURCE_VALIDATION_2026-09-18.md`

Reusable code:
- `src/research/resource-aware-puct-v3a.ts`
- `src/benchmarks/b3-fair-move-quality-validation.ts`
- `src/benchmarks/b3-resource-aware-selfplay.ts`
- `.github/workflows/b3-fair-move-quality-validation.yml`
- `.github/workflows/b3-resource-aware-selfplay.yml`

Canonical finding: the B3 instability was traced to static-leaf heuristic horizon bias dominated by temporary `scoreDelta`; V3A.1 material36 repairs the validated move-2 and move-34 failures. Historical ResourceAware rescue evidence remains discovery evidence, not a promotion result.

## Canonical balance evidence

Reflection/balance:
- `docs/research/BALANCE_CORE_MODES_PROTOCOL_2026-09-18.md`
- `src/benchmarks/balance-mode-v3a-selfplay.ts`
- `.github/workflows/balance-mode-v3a-selfplay.yml`
- `.github/workflows/reflection-fixed-balance-rematch.yml`

Deep B3 defensive resources:
- `src/benchmarks/double-forced-deviation-selfplay.ts`
- `.github/workflows/qg3f-double-deviation-100k.yml`

Positional repetition:
- `docs/research/QG_POSITIONAL_THREEFOLD_VERDICT_2026-09-18.md`
- `src/research/balance-modes.ts`
- `tests/positional-threefold-cycle.test.ts`
- `.github/workflows/qg-positional-cycle-validation.yml`
- `.github/workflows/qg-positional-threefold-rematch.yml`

## Closed V4 selective-quiescence family

V4, V4B and V4C are closed/rejected. Their durable record is consolidated in:
- `docs/research/V4_QUIESCENCE_FAMILY_CLOSED_2026-09-18.md`

The experimental V4 engines, tests, trace benchmarks and one-off workflows were intentionally deleted after the closure verdict was recorded.

Do not reopen this family by threshold tuning. A future challenger must compare against V3A.1 and should change search structure rather than selectively replacing heuristic leaf values.

## Reusable general surface

- `src/benchmarks/research-vs-production.ts`
- `src/benchmarks/research-vs-server-production.ts`
- `src/benchmarks/v3a-challenger-tournament.ts`
- `.github/workflows/r1a-production-parity.yml`
- `.github/workflows/ci.yml`

PVS/NegaScout is historical only and excluded from active research/evaluation.

## Repository hygiene policy

- `results/` remains empty except for `.gitkeep`.
- Durable conclusions belong in canonical verdict/audit documents, not committed benchmark output.
- One-off diagnostic workflows and trace scripts are deleted after their conclusion is captured.
- Closed challenger implementations are removed unless they are required for a canonical regression guard.
- Fixed-simulation search is required for canonical same-family/balance comparisons.
- New challengers must use V3A.1 material36 as the incumbent.
- Never silently change production rules or baseline semantics inside an algorithm comparison.
