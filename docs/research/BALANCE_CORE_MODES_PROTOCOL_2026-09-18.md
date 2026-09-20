# Core AI evaluation protocol — 2026-09-21

## Mandatory target modes

All future AI research, self-play, tournaments and promotion gates must run on both:

### Pie + Threefold

Mode id: `pie-threefold`.

- Standard capture rules.
- Original opener starts as logical P0.
- After move 1, the original responder has one KEEP/SWAP decision.
- SWAP changes agent-to-seat ownership only.
- Corrected Threefold uses repeated move-pair `ABABAB` semantics.

### Quan Gia + Threefold

Mode id: `quan-gia-threefold`.

- Rule profile: `mature_quan_v1`.
- A live Quan can be captured only when its Quan pit contains at least 5 dân.
- No Pie/Swap.
- Uses corrected Threefold semantics.

## Standard

Standard is historical/reference control only and cannot be the sole basis for future promotion/rejection.

## Current baseline

**V3A.2 positive-only material36** is the baseline on both target modes.

The previous split baseline is retired:
- Pie previously used V3A.1.
- Quan Gia previously used V3A after V3A.1 regressed on B3.

V3A.2 closed that regression while remaining non-regressive against V3A.1 on Pie and V3A on Quan Gia at 10k/20k/50k.

## Evaluation rules

- Use fixed simulations for canonical same-family comparisons.
- Freeze c_puct, policy temperature, priors and rule semantics unless explicitly isolated.
- Pair ownership/seats appropriately; Pie must follow research-agent identity through SWAP.
- Report unresolved games separately; never heuristic-adjudicate them.
- A general replacement must pass on both target modes.
- New challengers compare against **V3A.2** on both target modes.
- Standard-only evidence is diagnostic/historical for future work.

## Cleanup rule

One-off implementations, tests, benchmark scripts and workflows are deleted after a study is closed. Keep only the consolidated verdict plus reusable promoted code/correctness guards.
