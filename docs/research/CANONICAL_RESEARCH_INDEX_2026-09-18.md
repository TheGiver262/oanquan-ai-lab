# Canonical Research Index — 2026-09-21

The canonical research branch is `research/balanced-mode-tournament`.

## Forward evaluation protocol

Every future AI algorithm promotion/rejection study must evaluate **both**:

1. `pie-threefold`
2. `quan-gia-threefold`

Standard is a historical/reference control only and cannot be the sole future decision basis.

## Provisional baseline

**PUCT V3A.1 material36** is the validated Standard incumbent and the provisional baseline on both target modes pending dual-mode revalidation.

Retained implementation:
- `src/research/puct-v3a.ts`
- `src/research/puct-v3a1.ts`
- `src/research/mode-aware-puct-v3a.ts`
- `src/research/mode-aware-puct-v3a1.ts`
- `src/research/balance-modes.ts`

Retained correctness guards:
- `tests/engine.test.ts`
- `tests/ai.test.ts`
- `tests/puct-v3a.test.ts`
- `tests/puct-v3a1.test.ts`
- `tests/mode-aware-puct-v3a.test.ts`
- `tests/balance-modes.test.ts`
- `tests/quan-gia-threefold.test.ts`
- `tests/server-production-parity.test.ts`

Current reusable benchmark:
- `src/benchmarks/target-mode-v3a1-selfplay.ts`

## Retained evidence

- `docs/research/BALANCE_CORE_MODES_PROTOCOL_2026-09-18.md` — current dual-mode protocol.
- `docs/research/B3_PUCT_ROOT_CAUSE_AUDIT_2026-09-18.md` — causal origin of material36.
- `docs/research/V3A1_MATERIAL36_PROMOTION_VERDICT_2026-09-18.md` — Standard-only V3A.1 promotion evidence.
- `docs/research/V4_QUIESCENCE_FAMILY_CLOSED_2026-09-18.md` — Standard-only failed V4 family report.
- `docs/research/V5_TRANSPOSITION_GRAPH_REJECTION_2026-09-19.md` — Standard-only failed V5 family report.
- `docs/research/QG_POSITIONAL_THREEFOLD_VERDICT_2026-09-18.md` — rejected/superseded positional repetition report.
- `docs/research/HISTORICAL_RESEARCH_SUMMARY_2026-09-21.md` — consolidated summary for removed historical experiments.
- `docs/r1a-production-parity-audit.md` — production parity evidence.

Historical Standard results do **not** prove the same outcome on Pie + Threefold or Quan Gia + Threefold.

## Closed research

- PVS/NegaScout: excluded from active evaluation.
- V4 selective one-ply family: failed on Standard; implementation/tests/workflows removed.
- V5 retained transposition graph family: failed promotion criteria on Standard; implementation/tests/workflows removed.
- Old MCTS/ordering/opening-convergence/R1 intermediate experiments: superseded; only consolidated conclusions retained.
- Positional-threefold variant: not a current target; implementation/test/workflows removed.

## Repository hygiene

- Persistent workflow: `.github/workflows/ci.yml` only.
- Failed/superseded research keeps a report, not an implementation.
- One-off workflows and benchmark scripts are removed after the report is written.
- `results/` contains only `.gitkeep`.
- New one-off research should be developed on a temporary branch and deleted after consolidation.
- PVS/NegaScout must not be reintroduced into active evaluation.
