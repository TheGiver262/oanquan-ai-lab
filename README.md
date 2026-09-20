# oanquan-ai-lab

Lean research lab for **Ô Ăn Quan** AI. Production web/app code is intentionally excluded.

## Current research target

Future AI promotion research must run on **both** target modes:

- `pie-threefold` — Standard board rules + one-shot Pie/Swap + corrected Threefold.
- `quan-gia-threefold` — Quan Gia (`mature_quan_v1`) + corrected Threefold.

`standard` remains a historical/reference control only. It is not sufficient by itself for future promotion or rejection.

## Current baseline

Dual-mode revalidation changed the baseline policy:

- **Pie + Threefold:** V3A.1 material36 remains acceptable against V3A.
- **Quan Gia + Threefold:** V3A remains the safer baseline because V3A.1 reproduced two unfavorable B3 opening pairs at both 10k and 20k fixed simulations.
- **Standard:** V3A.1 material36 remains the validated historical incumbent.

A future general replacement must be non-regressive on both target modes.

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

The benchmark uses the mode-aware **V3A.1 material36** adapter. Pie ownership is tracked by research-agent identity, so a SWAP changes seat ownership without mirroring or rewriting the board.

## Production reference

The frozen server-production reference remains pinned to:

```text
TheGiver262/O_an_quan
commit 73c698762c514d171869a79982fdc86103653e8f
```

`tests/server-production-parity.test.ts` is retained as the production parity guard. Trạng Nguyên comparisons without the deployed learning snapshot remain `code-parity-no-live-learning-snapshot`.

## Retained research evidence

Authoritative documents:

- `docs/research/CANONICAL_RESEARCH_INDEX_2026-09-18.md`
- `docs/research/BALANCE_CORE_MODES_PROTOCOL_2026-09-18.md`
- `docs/research/B3_PUCT_ROOT_CAUSE_AUDIT_2026-09-18.md`
- `docs/research/V3A1_MATERIAL36_PROMOTION_VERDICT_2026-09-18.md`
- `docs/research/V3A1_DUAL_MODE_REVALIDATION_2026-09-21.md`
- `docs/research/V4_QUIESCENCE_FAMILY_CLOSED_2026-09-18.md`
- `docs/research/V5_TRANSPOSITION_GRAPH_REJECTION_2026-09-19.md`
- `docs/research/QG_POSITIONAL_THREEFOLD_VERDICT_2026-09-18.md`
- `docs/research/HISTORICAL_RESEARCH_SUMMARY_2026-09-21.md`
- `docs/r1a-production-parity-audit.md`

Failed/superseded experiments keep their conclusions in reports only. Their implementations, dedicated tests, benchmarks and workflows are deliberately removed.

## Repository policy

- Keep only reusable current code and correctness guards.
- Keep one consolidated report for failed/superseded research.
- Delete one-off benchmark scripts/workflows after conclusions are captured.
- Do not commit benchmark outputs; `results/` stays empty except for `.gitkeep`.
- `.github/workflows/ci.yml` is the only persistent workflow.
- Every future algorithm promotion must be evaluated on both target modes.
- Unresolved games are censored, never heuristic-adjudicated.

## License

MIT.
