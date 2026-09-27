# V3L Root-Neutral PNSum rejection — 2026-09-27

## Verdict

**Rejected at the Quan Gia + Threefold 5k gate.**

V3L successfully removed the root-allocation instability identified by the
post-V3K audit, but that intervention also removed real incumbent strength on
the mirrored B3 openings.

No 10k escalation, no coefficient rescue, and no production/canonical
implementation retention.

The canonical primary incumbent remains:

> **PUCT V3B.1 PNSum Cpn=2.0**

## Hypothesis

V3L tested one isolated structural change:

> Disable the proof-number term only when selecting a child of the current
> root, while retaining PNSum Cpn=2.0 at every interior node.

Frozen:
- V3A.2 positive-only material36 leaf semantics;
- c_puct=1.5;
- policy temperature=0.6;
- incumbent policy priors;
- exact solved propagation;
- subtree reuse;
- cycle handling;
- cumulative visit-based root ranking;
- interior PNSum Cpn=2.0.

No new tunable coefficient was introduced.

## TDD / correctness

Preregistered protocol:
- `docs/research/V3L_ROOT_NEUTRAL_PNSUM_PROTOCOL_2026-09-27.md` on the
  disposable research branch.

TDD evidence:
- RED: run `36317140686` — tests were committed before the V3L implementation;
- GREEN: run `36317194924` — typecheck, full test suite and build passed after
  implementation.

The core hook defaulted the root proof coefficient to the global coefficient,
so existing behavior stayed unchanged unless explicitly overridden.

V3B.1 was explicitly frozen to:
- root Cpn=2.0;
- interior Cpn=2.0.

V3L used:
- root Cpn=0;
- interior Cpn=2.0.

## Causal diagnostic

Canonical diagnostic run:
- `36317303136`

Targets:
- B2:CCW at board move 26;
- B4:CW at board move 26;
- B3:CW at board move 30;
- B3:CCW at board move 30.

Fresh probes:
- V3B.1;
- V3L;
- full Cpn=0 reference;
- fixed budgets 500 / 1k / 2k / 5k / 10k.

### B2/B4

The previous audit found a transient V3B.1 root basin:

B2:CCW:
- 500 -> B1:CW
- 1k -> B3:CW
- 2k -> B3:CW
- 5k -> B1:CW
- 10k -> B1:CW

V3L:
- B1:CW at every tested budget.

B4:CW mirrored the result:
- V3L selected B5:CCW at every tested budget.

Thus root-neutral PNSum **did remove the specific B2/B4 root allocation
pathology**.

### B3

B3:CW at move 30:

V3B.1:
- 500/1k/2k/5k -> B3:CCW
- 10k -> B3:CW

V3L:
- B3:CW at every tested budget.

B3:CCW mirrored it:
- V3L selected B3:CCW from 500 through 10k.

Again, V3L removed a transient root proof-driven basin and matched the action
that V3B.1 eventually reached at 10k.

Therefore the causal mechanism was real: suppressing root PNSum changes exactly
the audited allocation behavior.

## Quan Gia 5k strength screen

Canonical run:
- `36317419329`

Candidate:
- V3L root Cpn=0 / interior Cpn=2.0

Incumbent:
- V3B.1 root/interior Cpn=2.0

Protocol:
- 10 canonical forced openings;
- candidate once as opener and once as responder;
- 5,000 simulations per decision;
- unresolved games censored.

Aggregate:
- **10W-0D-8L**
- 2 unresolved games
- 2 favorable pairs
- 4 neutral pairs
- 2 unfavorable pairs
- 2 unresolved pairs

Favorable:
- B2:CCW
- B4:CW

Unfavorable:
- B3:CW
- B3:CCW

Unresolved:
- B2:CW
- B4:CCW

The favorable B2/B4 result is consistent with the causal diagnostic: V3L fixed
the same root allocation region that had repeatedly appeared in prior
regressions.

However the mirrored B3 regressions violate the preregistered 5k gate.

## Targeted confirmation

Canonical confirmation run:
- `36317656885`

Only the unfavorable pairs were rerun.

B3:CW:
- **0W-0D-2L**
- 1 unfavorable pair
- 0 unresolved

B3:CCW:
- **0W-0D-2L**
- 1 unfavorable pair
- 0 unresolved

Both regressions reproduced exactly.

V3L is therefore closed without 10k escalation or rescue tuning.

## Interpretation

The important result is not merely that V3L failed.

The experiment shows that **root PNSum has two opposing effects**:

1. it can create transient, path-dependent root visit basins that disagree with
   current Q;
2. it also contributes real playing strength in the B3 family.

This is especially significant because the promoted V3B.1 50k evidence had:
- B3:CW favorable;
- B3:CCW favorable;
- all other opening pairs neutral.

Those were the incumbent's only favorable 50k pairs.

V3L removed the exact root mechanism implicated by the allocation audit and
then lost those same mirrored B3 pairs.

Therefore:

> Root PNSum is not pure noise that can be globally disabled. It is a
> high-gain signal whose transient errors and useful B3 guidance are entangled.

## Research consequence

Closed:
- global root PNSum removal;
- root Cpn=0 as a V3B.1 replacement;
- rescue sweeps of root Cpn/thresholds for V3L.

The next challenger should not simply suppress root proof guidance.

A future hypothesis, if pursued, must distinguish **when root proof guidance is
temporarily inconsistent with value evidence** while preserving cases where it
provides the B3 strength that V3B.1 demonstrated.

That is a different problem from tuning Cpn.

## Repository consequence

Retain:
- this rejection report;
- the post-V3K root-cause report;
- final diagnostic / 5k / targeted-confirmation evidence runs.

Remove:
- V3L implementation;
- V3L unit test;
- diagnostic instrumentation;
- one-off benchmark scripts;
- one-off workflows;
- disposable research branch.

Canonical `main` remains on V3B.1.
