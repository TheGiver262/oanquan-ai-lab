# PUCT V3A.5 visit-decayed implicit-minimax rejection — 2026-09-24

## Verdict

**REJECT / CLOSE V3A.5. V3A.2 positive-only material36 remains the official incumbent.**

V3A.5 tested whether the V3A.4 budget instability could be fixed by reducing
implicit-minimax influence as child visits accumulated. The preregistered
half-life screen selected H=128, but the mandatory Quan Gia + Threefold 10k
gate produced six unfavorable opening pairs.

No 20k, 50k or reference-mode promotion runs are justified.

## Hypothesis

V3A.4 used a fixed implicit-minimax blend and was positive at 5k but regressed
at 10k. V3A.5 kept the same separate heuristic minimax value and changed only
selection weighting:

`alpha_eff(n) = 0.30 * H / (H + n)`

where:
- initial alpha was frozen at 0.30;
- n was child visit count before selection;
- H was a visit half-life.

At n=H the heuristic weight is 0.15, and at large n the search converges toward
ordinary V3A.2 empirical Q.

V3A.2 leaf reward, valueSum/visits backup, priors, subtree reuse, cycle cutoff,
exact solved propagation and root visit ranking remained unchanged.

An alpha=0 parity guard verified that disabling implicit minimax preserves the
incumbent V3A.2 path.

## Preregistered Quan Gia 5k screen

All candidates used:
- `quan-gia-threefold`;
- 5,000 fixed simulations per decision;
- all 10 openings;
- candidate once as opener and once as responder;
- V3A.2 as incumbent;
- unresolved games censored.

### H=32

- resolved candidate games: **6W-6D-4L**
- unresolved games: **4**
- pairs favorable / neutral / unfavorable / unresolved: **4 / 2 / 2 / 2**
- unfavorable: `B1:CCW`, `B5:CW`
- unresolved: `B2:CW`, `B4:CCW`

Targeted same-budget confirmation reproduced both failures:
- `B1:CCW`: 0W-1D-1L
- `B5:CW`: 0W-1D-1L

H=32 was rejected.

### H=128

- resolved candidate games: **8W-4D-6L**
- unresolved games: **2**
- pairs: **4 favorable / 4 neutral / 0 unfavorable / 2 unresolved**
- unresolved: `B2:CW`, `B4:CCW`

### H=512

- resolved candidate games: **10W-0D-8L**
- unresolved games: **2**
- pairs: **2 favorable / 6 neutral / 0 unfavorable / 2 unresolved**
- unresolved: `B2:CW`, `B4:CCW`

H=128 advanced by the preregistered rule: strongest favorable-pair signal among
clean configurations.

## Mandatory Quan Gia 10k gate: H=128 vs V3A.2

- candidate: **4W-6D-10L**
- unresolved games: **0**
- pairs favorable / neutral / unfavorable / unresolved: **2 / 2 / 6 / 0**
- unfavorable openings:
  - `B1:CCW`
  - `B2:CW`
  - `B2:CCW`
  - `B4:CW`
  - `B4:CCW`
  - `B5:CW`

This is a decisive failure of the primary promotion gate.

## Interpretation

Simple child-visit decay does **not** solve the fixed-alpha V3A.4 instability.
The selected schedule was clean and positive at 5k, but became substantially
worse than V3A.2 at 10k.

The result weakens the hypothesis that V3A.4 failed merely because heuristic
influence stayed too large at highly visited nodes. With the tested rational
half-life schedule, the search-allocation changes still destabilize Quan Gia as
the simulation budget rises.

Do not rescue V3A.5 by post-hoc testing the runner-up H=512 at 10k. That would
break the preregistered selection rule. A future heuristic-guidance experiment
requires a new causal hypothesis, not additional half-life tuning.

## Decision consequence

- Keep **V3A.2 positive-only material36** as official incumbent.
- Close V3A.5 visit-decayed implicit minimax.
- Do not run V3A.5 20k/50k.
- Do not run Pie/Standard reference gates because the primary Quan Gia gate
  already failed.
- Do not tune H further without a distinct causal hypothesis.
- Keep unresolved games censored.
- Keep Quan Gia + Threefold as the primary optimization/promotion mode.
- Pie + Threefold and Standard remain reference modes.
- PVS/NegaScout remains excluded.

## Evidence runs

- Quan Gia 5k half-life screen: Actions run `35897073226`
- H=32 targeted confirmation: Actions run `35897694388`
- H=128 Quan Gia 10k gate: Actions run `35897922787`

## Literature context

The experiment was motivated by Lanctot et al. (CIG 2014 /
arXiv:1406.0486), who separated MCTS estimates and implicit minimax heuristic
values, tested progressive heuristic bias, and identified alternative decay
functions as future work. A later 2023 thesis on network-based implicit minimax
also reported favorable results from a decreasing-alpha selection variant.

Those external results motivated the hypothesis but do not override the direct
Quan Gia evidence above.
