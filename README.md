# oanquan-ai-lab

Lean research lab for **Ô Ăn Quan** AI. Production web/app code is intentionally excluded.

## Current research target

All three supported modes are now mandatory global evaluation gates:
- `standard`
- `pie-threefold`
- `quan-gia-threefold`

A future global challenger must satisfy **wins >= losses against the current baseline/incumbent in every mode independently**. A gain in one ruleset no longer compensates for a regression in another.

## Current incumbent

**Global incumbent: PUCT V3B.1-G (Global Safe).**

Ruleset-aware configuration:
- Quan Gia + Threefold -> V3B.1 PNSum `Cpn=2.0`;
- Pie + Threefold -> V3A.2 semantics / `Cpn=0`;
- Standard -> V3A.2 semantics / `Cpn=0`.

Global evidence vs V3A.2:

| Budget | Standard | Pie + Threefold | Quan Gia + Threefold |
| --- | --- | --- | --- |
| 10k | **8W-4D-8L** | **6W-8D-6L** | **14W-0D-6L** |
| 20k | **6W-4D-6L** + 4 unresolved | **6W-8D-6L** | **14W-0D-6L** |

Thus V3B.1-G keeps the validated Quan Gia improvement while never losing more games than it wins against V3A.2 on Pie or Standard.

PVS/NegaScout remains excluded from active research.

## Setup

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Canonical benchmarks

Global incumbent vs V3A.2:

```bash
npm run benchmark:global -- --mode standard --fixed-simulations 10000
npm run benchmark:global -- --mode pie-threefold --fixed-simulations 10000
npm run benchmark:global -- --mode quan-gia-threefold --fixed-simulations 10000
```

Quan Gia V3B.1 specialist benchmark remains available:

```bash
npm run benchmark:primary -- --fixed-simulations 10000
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
- `docs/research/V3B1_GLOBAL_SAFE_PROMOTION_2026-09-28.md`
- `docs/research/V3B2_SCORE_BOUNDED_NO_GAIN_2026-09-24.md`
- `docs/research/V3B3_MOBILITY_PROOF_INIT_REJECTION_2026-09-24.md`
- `docs/research/V3B4_PNRANK_REJECTION_2026-09-24.md`
- `docs/research/V3C_ROOT_ALPHA_BETA_VERIFIER_REJECTION_2026-09-24.md`
- `docs/research/V3D_EXACT_ENDGAME_OPERATIONAL_REJECTION_2026-09-25.md`
- `docs/research/V3E_TABLEBASE_FEASIBILITY_REJECTION_2026-09-25.md`
- `docs/research/V3F_PROGRESSIVE_HISTORY_REJECTION_2026-09-26.md`
- `docs/research/V3G_VISIT_ADAPTIVE_PUCT_NO_GAIN_2026-09-26.md`
- `docs/research/V3H_LOCAL_RAVE_REJECTION_2026-09-27.md`
- `docs/research/V3I_FPU_REDUCTION_REJECTION_2026-09-27.md`
- `docs/research/V3J_POLICY_PRIOR_ALIGNMENT_NO_GAIN_2026-09-27.md`
- `docs/research/V3K_TARGET_MODE_ONE_PLY_REJECTION_2026-09-27.md`
- `docs/research/POST_V3K_PNSUM_ALLOCATION_ROOT_CAUSE_2026-09-27.md`
- `docs/research/V3L_ROOT_NEUTRAL_PNSUM_REJECTION_2026-09-27.md`
- `docs/research/V3M_ROOT_Q_CONFLICT_GUARD_REJECTION_2026-09-28.md`
- `docs/research/V3N_ADAPTIVE_SIMULATION_EXTENSION_NO_GAIN_2026-09-28.md`
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
- Future global promotion requires `wins >= losses` independently on Standard, Pie + Threefold, and Quan Gia + Threefold.
- Unresolved games are censored, never heuristic-adjudicated.

## License

MIT.
