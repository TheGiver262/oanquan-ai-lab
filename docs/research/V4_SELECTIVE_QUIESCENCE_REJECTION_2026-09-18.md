# PUCT V4 q10 selective-quiescence rejection verdict — 2026-09-18

## Verdict

**REJECT — do not promote.**

V4 q10 selective quiescence does not replace the canonical PUCT V3A.1
material36 incumbent.

V4 keeps V3A.1 material36 and adds one-ply max/min bootstrap only at heuristic
leaves where an immediate already-expanded child changes engine-agent score
delta by at least 10 points (one `QUAN_VALUE`) or exposes an exact
solved/terminal child.

## V4-A causal safety

The threshold safety scan tested score-swing triggers 4, 6, 8, 10, 12, 15 and
20 on the two known V3A.1 repaired horizon cases.

- thresholds 4–15 preserved both repaired branches;
- threshold 20 regressed move 2 back to B5:CCW;
- q10 was selected because it lies inside the safe region and maps directly to
  `QUAN_VALUE = 10`.

V4-A therefore passed as a safety screen only.

Evidence:
`docs/research/V4A_SELECTIVE_QUIESCENCE_CAUSAL_2026-09-18.md`.

## V4-B broad same-family screen

At 10,000 fixed simulations per decision against V3A.1:

| stage | V4 W | D | V3A.1 W | unresolved | completed pairs +/=/- | mean pair diff |
|---|---:|---:|---:|---:|---|---:|
| Stage 1 | 14 | 4 | 14 | 0 | 0/16/0 | 0 |
| Stage 2 | 12 | 5 | 14 | 1 | 0/13/2 | -0.1333 |
| Stage 3 | 4 | 2 | 4 | 0 | 0/5/0 | 0 |

Aggregate resolved W-D-L: **30-11-32**.

Aggregate completed pairs:

- favorable: **0**
- neutral: **34**
- unfavorable: **2**
- mean pair diff: **-0.05556**

This fails the protocol's broad non-regression gate. No promotion-strength gate
or Trạng Nguyên gate is justified for V4 q10.

Source workflow: `v4-vs-v3a1-10k-screen`, run `35346349241`.

## Reflection-consistent failure

Both unfavorable completed pairs are the depth-6 B3 CW/CCW reflections:

- `LQ@6:B3:CCW:B3:CCW>T2:CW>B4:CCW>T4:CW>B3:CW>T4:CW`
- `LQ@6:B3:CW:B3:CW>T4:CCW>B2:CW>T2:CCW>B3:CCW>T2:CCW`

In both seat-swapped pairs:

- candidate V4 as P1 follows the same moves a shadow V3A.1 session would choose
  and loses 33-37;
- the regression comes from the V4-as-P0 game, where V4 changes one move and
  turns the pair's P0 result into a 35-35 draw.

The unique candidate-side divergence occurs at move 8 with scores P0=7, P1=9.

Reflection A:

- V3A.1: `B4:CCW`
- V4: `B1:CW`

Reflection B:

- V3A.1: `B2:CW`
- V4: `B5:CCW`

The root statistics show a large evaluation inversion. In reflection A:

- V3A.1 `B4:CCW`: 18,287 visits, mean +0.3401;
- V3A.1 `B1:CW`: 89 visits, mean -0.3998;
- V4 `B1:CW`: 14,634 visits, mean +0.0265.

The mirrored case shows the same structure:

- V3A.1 `B2:CW`: 18,377 visits, mean +0.3640;
- V3A.1 `B5:CCW`: 92 visits, mean -0.3499;
- V4 `B5:CCW`: 12,433 visits, mean +0.0321.

This is symmetry-consistent algorithmic evidence, not an isolated noisy root.

## Independent branch-quality validation

Fresh V3A.1 material36 continuation was started after forcing exactly one of
the competing move-8 branches, with independent sessions for both players.

At 20,000 fixed simulations per decision, both reflections agree:

- V3A.1 baseline branch `B4:CCW` / `B2:CW` -> **P0 wins 37-33**;
- rejected V4 branch `B1:CW` / `B5:CCW` -> **draw 35-35**.

Thus V4 does not merely alter visits or reach another equivalent basin. It
systematically converts a validated winning branch into a draw.

Source workflow: `v4-rejected-branch-quality`.

## Root cause interpretation

The rejected V4 bootstrap is allowed to replace the static V3A.1 leaf value
with a one-ply max/min child heuristic. At the reflected move-8 failures, this
mechanism changes a branch V3A.1 values strongly negatively into an almost
neutral/positive search basin. The large policy prior on the affected B1/B5
move then receives enough support to dominate visits.

This is the failure mode that blind one-ply bootstrap had already hinted at,
now reproduced under a selective tactical trigger.

## Decision consequence

- V3A.1 material36 remains the canonical research incumbent.
- q10 selective one-ply V4 is closed and must not be promoted.
- Do not rescue q10 by retuning C_puct, policy temperature, priors or
  material36; that would confound the experiment.
- Threshold 20 is also explicitly rejected from V4-A.
- PVS/NegaScout remains excluded from active evaluation.

A successor may reuse the tactical-instability detector only if it prevents the
one-ply extension from **increasing heuristic optimism**. The natural next
controlled experiment is a refutation-only bootstrap: the tactical extension
may lower the incumbent static leaf value when it exposes a bad reply, but may
not raise the value above V3A.1's static estimate.
