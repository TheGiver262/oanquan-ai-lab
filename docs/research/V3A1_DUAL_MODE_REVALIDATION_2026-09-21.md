# V3A.1 dual-target-mode revalidation verdict — 2026-09-21

## Verdict

**V3A.1 material36 is not promoted as a general dual-mode incumbent.**

It remains clean against V3A on **Pie + Threefold**, but shows a repeatable
regression on **Quan Gia + Threefold** at both 10k and 20k fixed simulations.

Therefore:

- Pie + Threefold baseline: **V3A.1 material36** remains acceptable.
- Quan Gia + Threefold baseline: **V3A** remains the safer comparison baseline.
- A future general replacement must beat or at least not regress against the
  appropriate baseline on both target modes.

## Protocol

Candidate:
- PUCT V3A.1 material36.

Baseline:
- PUCT V3A.

Target modes:
- `pie-threefold`
- `quan-gia-threefold`

For each mode and budget:
- every legal initial P0 opening was forced;
- 10 openings total;
- each opening played twice;
- V3A.1 once as opener and once as responder;
- fixed simulations per decision;
- no root noise;
- max continuation: 160 board moves;
- unresolved games censored, never heuristic-adjudicated;
- Pie ownership followed research-agent identity through SWAP.

Budgets:
- 10,000 simulations/decision;
- 20,000 simulations/decision.

Total:
- 20 games per mode per budget;
- 80 games overall;
- 40 paired opening comparisons.

## Pie + Threefold

### 10k

- V3A.1 wins: **6**
- draws: **8**
- V3A wins: **6**
- unresolved: **0**
- completed pairs: **10**
- favorable / neutral / unfavorable: **0 / 10 / 0**
- mean pair diff: **0**

### 20k

- V3A.1 wins: **6**
- draws: **8**
- V3A wins: **6**
- unresolved: **0**
- completed pairs: **10**
- favorable / neutral / unfavorable: **0 / 10 / 0**
- mean pair diff: **0**

Interpretation: no detected V3A.1 regression on the complete initial-opening
suite at either tested budget.

## Quan Gia + Threefold

### 10k

- V3A.1 wins: **4**
- draws: **10**
- V3A wins: **6**
- unresolved: **0**
- completed pairs: **10**
- favorable / neutral / unfavorable: **0 / 8 / 2**
- mean pair diff: **-0.1**

Unfavorable pairs:
- `B3:CW`: pair score 0.5, pair diff -0.5.
- `B3:CCW`: pair score 0.5, pair diff -0.5.

At 10k both B3 directions had the same causal outcome shape:
- V3A.1 as opener lost **29-41**;
- V3A.1 as responder reached a **23-23 Threefold draw**.

### 20k

- V3A.1 wins: **4**
- draws: **10**
- V3A wins: **6**
- unresolved: **0**
- completed pairs: **10**
- favorable / neutral / unfavorable: **0 / 8 / 2**
- mean pair diff: **-0.1**

The same two openings, `B3:CW` and `B3:CCW`, remained unfavorable.
This exact pair-level repetition across 10k and 20k makes a simple low-budget
noise explanation unlikely.

## Interpretation

The Standard-derived fixed `material36` gate does not transfer cleanly to
Quan Gia + Threefold.

A plausible hypothesis is that the Mature Quan capture rule changes how long
material remains on the board and when temporary score lead becomes reliable,
so raw board material alone is no longer a sufficient phase proxy. This is a
research hypothesis, not yet a proven root cause.

The next version should therefore investigate a **mode-aware or state-aware
leaf score gate** rather than assuming the Standard threshold 36 is universal.

## Decision consequence

- Do not use V3A.1 material36 as the sole incumbent on both target modes.
- Do not discard V3A.1: it remains the validated Standard incumbent and passes
  the tested Pie + Threefold suite.
- For new dual-mode challengers:
  - compare against V3A.1 on Pie + Threefold;
  - compare against V3A on Quan Gia + Threefold;
  - preferably also report cross-checks against both historical baselines.
- The next research track should first explain the B3 Quan Gia regression before
  adding unrelated search complexity.
- PVS/NegaScout remains excluded from active evaluation.

## Execution evidence

Temporary workflow:
- `v3a1-dual-mode-revalidation`
- run `35533120356`

The one-off benchmark/workflow/branch are intentionally removed after this
verdict is consolidated.
