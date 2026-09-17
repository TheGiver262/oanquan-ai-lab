# R1 V3A promotion verdict — 2026-09-17

## Verdict

**PROMOTE — scoped R1 research promotion.**

PUCT V3A (`ReusableScoreBoundedPuct`) is promoted as the **canonical Standard/classic 2-player research incumbent and the candidate to carry forward into a separate production-integration gate**.

This verdict **does not authorize direct production deployment** and **does not claim statistical superiority over the live deployed Trạng Nguyên**, because the cross-family reference remains `code-parity-no-live-learning-snapshot`.

## Why the R1 gate passes

1. **Correctness/parity guard:** R1 is stacked on the R1a production-parity audit; the current research branch CI remains green after evidence archival/cleanup.
2. **Same-family structural evidence (R1c):** at fixed 4,000 simulations V3A vs V2 produced mean pairDiff `+0.125` on Stage 1, `+0.1875` on Stage 2, and `0` on Stage 3, with zero unresolved games. Runtime robustness retained the same qualitative pattern: positive S1/S2 and neutral S3.
3. **Corrected-repeat cross-family evidence (R1d-B):** V3A had positive mean pairDiff in all three required strata across reps 1–4, zero unresolved games, zero unfavorable completed pairs in the reported R1d-B strata, and neutral TN↔TN controls.
4. **Exact current-production/no-repeat evidence (R1d-A):** all four runtime replicates are positive in all three strata. Stage 1 mean pairDiff is `+0.5714` or `+0.6154`; Stage 2 `+0.8125` to `+0.875`; Stage 3 `+0.4`. No completed candidate pair is unfavorable. TN↔TN null controls are exactly pair-neutral.
5. **Unresolved handling:** the only R1d-A unresolved tail is Stage 1 (2–3/32 games per replicate). Those games are censored at the move cap and their pairs are excluded; no heuristic winner is invented. Stages 2 and 3 resolve completely.
6. **Runtime/search behavior:** V3A runs inside the intended 1,200 ms production-envelope benchmark, with p95 latency near the budget and no V3A time/node-budget exhaustion recorded. Bounded reuse/cycle handling remained stable enough to complete every required stratum; no R1 evidence shows an unbounded global-memory failure.

## Scope limits

- Runtime replicates are jitter/resource robustness checks, not independent stochastic seeds; do not pool them into a fake significance claim.
- Trạng Nguyên was benchmarked without the deployed learning snapshot. Therefore R1 supports a clean code-path comparison, not a complete live-strength comparison.
- Production currently implements legacy no-`repeated_moves` termination semantics. R1d-A is the deployment-parity strength gate; R1d-B is retained separately as corrected-rule research evidence. If production adopts corrected `repeated_moves`, rerun the production-integration gate under that ruleset.
- The production repository has advanced beyond the R1a audited head. The observed post-audit bot-related change is think-delay/animation timing rather than move-selection strength, but a deployment PR must still repin production parity to the exact target production commit.

## Decision consequence

R1 is **closed**. V3A remains the algorithmic incumbent for Standard/classic 2-player and may proceed to production-integration validation. Deeper V4/MCGS/PNS-style research can now be evaluated against V3A as the incumbent without reopening R1, unless the ruleset, V3A algorithm, production AI semantics, or Trạng Nguyên learning baseline changes materially.

## Evidence retained after Actions cleanup

- R1d-A: `docs/research/R1D_A_EVIDENCE_2026-09-17.md` on `research/r1d-production-semantics`.
- R1c + R1d-B canonical archive: `docs/research/R1_CANONICAL_RESULTS_2026-09-16.md` on `research/r1c-repeat-parity`.
- Promotion protocol: `docs/r1c-ai-promotion-protocol.md`.

Heavy historical workflow runs R1d-A/R1d-B were deleted only after these compact evidence archives were committed.
