# PUCT V3A.4 implicit-minimax rejection — 2026-09-23

## Verdict

**REJECT / CLOSE V3A.4. V3A.2 positive-only material36 remains the canonical incumbent for both target modes.**

V3A.4 tested fixed-weight implicit minimax backups as a search-allocation signal.
It produced a strong 5k screen, but the mandatory 10k Quan Gia + Threefold gate
produced four unfavorable opening pairs. No 20k or 50k promotion run is
justified.

## Hypothesis

Keep all V3A.2 value semantics intact while maintaining a second heuristic
minimax value per node and blend it into tree selection only:

`Q_im = (1 - alpha) * Q + alpha * v`

Frozen incumbent behavior:
- V3A.2 positive-only material36 leaf evaluator;
- ordinary `valueSum/visits` backup unchanged;
- policy priors unchanged;
- subtree reuse unchanged;
- cycle cutoff unchanged;
- exact solved propagation unchanged;
- final root ranking by visits unchanged.

The implementation was guarded by an alpha=0 parity test: with implicit minimax
disabled, V3A.4 produced the same root action/statistics as V3A.2.

## Preregistered 5k alpha screen

All values used 5,000 fixed simulations, both target modes, all 10 openings,
and candidate ownership paired once as opener and once as responder.

### alpha 0.10

Pie:
- 8W-4D-8L
- pairs favorable / neutral / unfavorable / unresolved: **2 / 6 / 2 / 0**
- unfavorable: `B3:CW`, `B3:CCW`

Both unfavorable pairs reproduced on targeted same-budget confirmation:
- `B3:CW`: 0W-1D-1L
- `B3:CCW`: 0W-1D-1L

Quan Gia:
- resolved games: 10W-2D-4L
- unresolved games: 4
- pairs: **4 / 4 / 0 / 2**
- censored pairs: `B2:CW`, `B4:CCW`

Decision: alpha 0.10 rejected.

### alpha 0.20

Pie:
- 10W-4D-6L
- pairs: **4 / 6 / 0 / 0**

Quan Gia:
- resolved games: 8W-0D-10L
- unresolved games: 2
- pairs: **0 / 8 / 0 / 2**
- censored pairs: `B2:CW`, `B4:CCW`

Non-regressive on completed pairs, but no positive Quan Gia pair signal.

### alpha 0.30

Pie:
- 10W-6D-4L
- pairs: **4 / 6 / 0 / 0**

Quan Gia:
- resolved games: 14W-0D-2L
- unresolved games: 4
- pairs: **6 / 2 / 0 / 2**
- censored pairs: `B2:CW`, `B4:CCW`

The censored Quan Gia pairs were rerun with the execution ceiling increased
from 200 to 400 board moves. Both games in each pair still remained unresolved
and were kept censored.

Alpha 0.30 therefore advanced as the strongest clean 5k candidate.

## Mandatory 10k gate: alpha 0.30 vs V3A.2

### Pie + Threefold

- candidate: **8W-6D-6L**
- favorable / neutral / unfavorable / unresolved pairs: **2 / 8 / 0 / 0**
- unresolved games: 0

Pie remained non-regressive, although the positive signal weakened from four
favorable pairs at 5k to two at 10k.

### Quan Gia + Threefold

- candidate: **6W-6D-8L**
- favorable / neutral / unfavorable / unresolved pairs: **4 / 2 / 4 / 0**
- unfavorable openings:
  - `B2:CW`
  - `B2:CCW`
  - `B4:CW`
  - `B4:CCW`
- unresolved games: 0

This fails the dual-mode promotion requirement.

## Interpretation

The 5k result shows that fixed implicit-minimax guidance can improve early
search allocation. The 10k result shows that the gain is not stable as search
budget increases: Quan Gia changes from a strong positive completed-pair signal
at 5k to four explicit regressions at 10k.

This evidence does not show that heuristic guidance is universally harmful.
It specifically rejects a **fixed alpha implicit-minimax blend** as a safe
general replacement for V3A.2.

A future revisit would require a distinct causal hypothesis rather than tuning
the failed fixed-alpha grid. One plausible hypothesis is visit-decayed
heuristic influence: use heuristic minimax guidance mainly while empirical Q is
uncertain, then force its weight toward zero as visits accumulate. That directly
targets the observed 5k-positive / 10k-regressive budget instability and should
be treated as a new experiment, not a rescue of V3A.4.

## Decision consequence

- Keep **V3A.2 positive-only material36** as official incumbent.
- Close V3A.4 fixed implicit minimax.
- Do not run V3A.4 20k/50k promotion gates.
- Do not tune fixed alpha after the failed 10k gate.
- Keep all future AI promotion tests on both `pie-threefold` and
  `quan-gia-threefold`.
- Keep unresolved games censored.
- PVS/NegaScout remains excluded.

## Evidence runs

- 5k alpha screen: Actions run `35890605029`
- targeted confirmation: Actions run `35891448054`
- 10k alpha 0.30 gate: Actions run `35892021842`
