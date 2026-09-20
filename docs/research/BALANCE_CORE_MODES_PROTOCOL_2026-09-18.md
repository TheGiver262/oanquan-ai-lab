# Core AI evaluation protocol — 2026-09-21

## Mandatory target modes

All future AI research, self-play, tournaments and promotion gates must run on both:

### Pie + Threefold

Mode id: `pie-threefold`.

- Standard capture rules.
- Original opener starts as logical P0.
- After move 1, the original responder has one KEEP/SWAP decision.
- SWAP changes agent-to-seat ownership only; board, scores, history and logical side-to-move are unchanged.
- Corrected Threefold uses the engine's repeated move-pair `ABABAB` semantics.

### Quan Gia + Threefold

Mode id: `quan-gia-threefold`.

- Rule profile: `mature_quan_v1`.
- A live Quan can be captured only when its Quan pit contains at least 5 dân.
- No Pie/Swap.
- Uses the same corrected Threefold termination semantics.

## Standard

`standard` remains available only as a historical/reference control. Earlier V3A.1/V4/V5 strength conclusions were produced on Standard and must not be generalized to the two target modes.

## Evaluation rules

- Use fixed simulations for canonical same-family comparisons.
- Freeze `c_puct`, policy temperature, priors and rule semantics unless the experiment explicitly isolates one of them.
- Pair ownership/seats appropriately; Pie comparisons must follow research-agent identity through SWAP.
- Report unresolved games separately; never heuristic-adjudicate them.
- A general replacement must pass on **both** target modes.
- A candidate that passes only one target mode is mode-specific evidence, not a general promotion.
- Standard-only failure/success is diagnostic evidence only for future work.

## Baseline

Dual-mode revalidation is complete:

- Pie + Threefold baseline: **V3A.1 material36**.
- Quan Gia + Threefold baseline: **V3A**.
- Standard historical incumbent: **V3A.1 material36**.

The split exists because V3A.1 was neutral against V3A across all 10 paired Pie openings at both 10k and 20k, but produced repeatable unfavorable `B3:CW` and `B3:CCW` pairs under Quan Gia + Threefold at both budgets.

A future general replacement must pass against the appropriate baseline on both target modes.

## Cleanup rule

One-off implementations, tests, benchmark scripts and workflows are deleted after a study is closed. Failed or superseded studies keep only a consolidated verdict/report with the essential quantitative evidence.
