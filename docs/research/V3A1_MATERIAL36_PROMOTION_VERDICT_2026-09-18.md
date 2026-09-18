# PUCT V3A.1 material36 promotion verdict — 2026-09-18

## Verdict

**PROMOTE — canonical research incumbent.**

PUCT V3A.1 is the new canonical Standard/classic 2-player research incumbent.
Its implementation is `MaterialGatedReusableScoreBoundedPuct` in
`src/research/puct-v3a1.ts`, with the mode-aware adapter
`ModeAwarePuctV3A1` in `src/research/mode-aware-puct-v3a1.ts`.

V3A.1 keeps V3A search, priors, subtree reuse, solved-outcome propagation,
root ranking and score coefficient `1.8`. Its single promoted algorithmic
change is:

- heuristic `scoreDelta` contributes only when remaining raw board material
  (dan stones + quan stones) is `<= 36`;
- above 36 raw board material, the leaf score coefficient is effectively zero;
- policy priors remain frozen to the original V3A score coefficient.

The original `ReusableScoreBoundedPuct` remains unchanged as the historical
V3A baseline.

This verdict is a **research promotion only**. It does not authorize direct
production deployment and does not claim superiority over the live deployed
Trạng Nguyên because the cross-family reference remains
`code-parity-no-live-learning-snapshot`.

## Root cause that motivated V3A.1

The B3 diagnostic track isolated a repeatable V3A horizon-bias failure.

At the move-2 transition around 99,066 simulations, V3A selected `B5:CCW`
with 47,624 visits over `B4:CW` with 47,623 visits even though independent
continuations showed B4 remained a winning branch while B5 resolved to a draw.
Root-leaf provenance showed:

- cycle-cutoff contribution was zero for both branches;
- B5 value was dominated by heuristic leaves;
- the inflated B5 heuristic was driven primarily by a large temporary
  `scoreDelta`.

The same causal shape reappeared at the later move-34 transition, where V3A
switched from independently winning `B2:CW` to drawing `B5:CCW`.

Therefore the validated defect was not PUCT exploration, policy prior, cycle
handling or root visit ranking in isolation. It was over-trusting temporary
score lead at unsolved early/midgame heuristic leaves.

## Rejected candidate fixes

The promotion track deliberately tested single-cause fixes before accepting
material36.

### Leaf score weight = 0

Removing the score term repaired both known anomalies, proving the score term
was causal, but it materially weakened general play.

At the 10k fixed-simulation promotion corpus the candidate scored:

- candidate wins: 22
- draws: 4
- incumbent wins: 44
- unresolved: 4
- completed-pair mean diff: -0.54545

**Rejected.**

### Constant score-weight tuning

Intermediate constant weights were nonlinear and unstable.

Examples:

- weight 1.0 still selected B5 at move 2;
- weight 0.25 repaired move 2 but failed move 34;
- no tested constant coefficient gave a robust fix across both anomalies.

**Rejected.**

### One-ply heuristic bootstrap

Evaluating already-expanded child states instead of the leaf itself repaired
move 34 but made the move-2 B5 preference substantially stronger.

**Rejected.**

## Material36 causal evidence

With score weight kept at 1.8 and score enabled only at raw board material
`<= 36`, both known anomalies are repaired.

Budget-robustness results:

| case | tested budgets | promoted branch |
|---|---|---|
| move 2 | 68k, 80k, 90k, 99,066, 120k | B4:CW at every budget |
| move 34 | 80k, 90k, 100k, 120k | B2:CW at every budget |

This rules out a fix that only happens to land correctly at one simulation
checkpoint.

## Same-family non-regression evidence

Every exact corpus position is seat-swapped. Unresolved games are censored and
never heuristic-adjudicated.

### 10,000 fixed simulations per decision

- Stage 1: 12 W / 8 D / 12 L, 0 unresolved, pairs 0/16/0
- Stage 2: 14 W / 2 D / 14 L, 2 unresolved, pairs 0/15/0
- Stage 3: 4 W / 2 D / 4 L, 0 unresolved, pairs 0/5/0
- Aggregate resolved W-D-L: **30-12-30**
- Completed pairs: **36 neutral, 0 favorable, 0 unfavorable**

### 20,000 fixed simulations per decision

- Stage 1: 14 W / 4 D / 14 L, 0 unresolved, pairs 0/16/0
- Stage 2: 13 W / 4 D / 13 L, 2 unresolved, pairs 0/15/0
- Stage 3: 4 W / 2 D / 4 L, 0 unresolved, pairs 0/5/0
- Aggregate resolved W-D-L: **31-10-31**
- Completed pairs: **36 neutral, 0 favorable, 0 unfavorable**

### 50,000 fixed simulations per decision

- Stage 1: 13 W / 4 D / 13 L, 2 unresolved, pairs 0/15/0
- Stage 2: 11 W / 8 D / 11 L, 2 unresolved, pairs 0/15/0
- Stage 3: 4 W / 2 D / 4 L, 0 unresolved, pairs 0/5/0
- Aggregate resolved W-D-L: **28-14-28**
- Completed pairs: **35 neutral, 0 favorable, 0 unfavorable**

Across 10k/20k/50k, no completed same-family pair is unfavorable to V3A.1.

The first strong-gate workflow run `35336100865` had six successful benchmark
jobs and failed only in the report summarizer because it read
`methodology.fixedSimulations` instead of
`methodology.fixedSimulationsPerDecision`. This was a reporting defect, not
a benchmark failure. The summarizer was corrected in commit
`c6be85492e7498b805dd3c03fcbaf02629cd8164`.

## Code-parity Trạng Nguyên evidence

Production-envelope comparison:

- V3A.1: 1,200 ms wall-clock envelope, high simulation ceiling;
- Trạng Nguyên: production-parity code path, 100,000 node cap and 1,200 ms guard;
- live learning snapshot: **not loaded**.

Results:

| stage | V3A.1 W | D | TN W | unresolved | completed pairs +/=/- | mean pair diff |
|---|---:|---:|---:|---:|---|---:|
| Stage 1 | 20 | 0 | 10 | 2 | 4/10/0 | +0.5714 |
| Stage 2 | 22 | 4 | 6 | 0 | 9/7/0 | +1.0000 |
| Stage 3 | 4 | 4 | 2 | 0 | 2/3/0 | +0.4000 |

Aggregate resolved W-D-L from the V3A.1 perspective: **46-8-18**.

Across all completed pairs:

- favorable: 15
- neutral: 20
- unfavorable: **0**
- mean pair diff: **+0.742857**

Stage 2 is stronger than the first archived V3A runtime replicate
(20 W / 5 D / 7 L, mean pair diff +0.8125), but this single runtime comparison
is not sufficient to claim statistical superiority of V3A.1 over V3A.

## Why promotion is justified

V3A.1 satisfies the intended research promotion bar:

1. it repairs both validated horizon-bias cases;
2. the repair survives all tested anomaly budgets up to 120k simulations;
3. it introduces one isolated value-estimation change rather than retuning
   exploration or priors;
4. it shows no unfavorable completed pair against V3A at 10k, 20k or 50k
   across the full promotion corpus;
5. it retains positive evidence in every Trạng Nguyên validation stratum;
6. the original V3A implementation is preserved for historical reproducibility;
7. dedicated V3A.1 wrappers freeze the promoted configuration at material max
   36 so future experiments do not depend on an undocumented CLI option.

## Scope limits

- This does not prove game-theoretic optimality.
- Trạng Nguyên evidence is code-parity only; the deployed learning snapshot is
  absent.
- Wall-clock runtime replicates are not independent stochastic seeds.
- The value 36 is a promoted engineering/research threshold supported by the
  tested corpus; it is not asserted to be a mathematically unique boundary.
- Future changes to rules, production AI semantics or the learning baseline
  require a new integration gate.

## Decision consequence

V3A.1 material36 supersedes V3A as the canonical research incumbent for
Standard/classic 2-player.

Future V4/MCGS/PNS-style challengers must be evaluated against V3A.1, not V3A.
V3A remains the historical same-family baseline for regression and causal
comparison.

PVS/NegaScout remains historical-only and excluded from active evaluation.
