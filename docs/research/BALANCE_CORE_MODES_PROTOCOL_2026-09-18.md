# Core AI evaluation protocol — 2026-09-21

## Canonical mode priority

### Primary: Quan Gia + Threefold

Mode id: `quan-gia-threefold`.

- Rule profile: `mature_quan_v1`.
- A live Quan can be captured only when its Quan pit contains at least 5 dân.
- No Pie/Swap.
- Uses corrected Threefold semantics.
- This is the **main optimization, self-play and promotion mode**.

### Reference: Pie + Threefold

Mode id: `pie-threefold`.

- Standard capture rules.
- Original opener starts as logical P0.
- After move 1, the original responder has one KEEP/SWAP decision.
- SWAP changes agent-to-seat ownership only.
- Corrected Threefold uses repeated move-pair `ABABAB` semantics.
- Retained as a secondary comparison mode, not an equal promotion gate.

### Reference: Standard

Mode id: `standard`.

- Retained as the historical/basic-rules reference mode.
- Used for compatibility and behavior comparison, not as the primary optimization target.

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
- New challengers compare primarily against **V3A.2** on `quan-gia-threefold`.
- Pie + Threefold and Standard are secondary reference checks.
- A Pie/Standard regression alone does not automatically veto promotion if the
  challenger is clearly stronger and stable on Quan Gia + Threefold.
- Severe correctness, illegal-move, instability or catastrophic cross-mode
  regressions still block promotion regardless of mode priority.
- Standard-only or Pie-only evidence cannot justify promotion.

## Cleanup rule

One-off implementations, tests, benchmark scripts and workflows are deleted after a study is closed. Keep only the consolidated verdict plus reusable promoted code/correctness guards.
