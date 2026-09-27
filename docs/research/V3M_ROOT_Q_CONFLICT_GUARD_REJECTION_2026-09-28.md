# V3M Root Q-Conflict Guard rejection — 2026-09-28

## Verdict

**REJECT / CLOSE V3M at the Quan Gia + Threefold 5k gate.**

V3M passed its preregistered causal diagnostic: it removed the B2/B4
large-Q-conflict root flips while preserving the audited B3 action at 5k.
However, full-game strength testing reproduced the same mirrored B3 regression
pattern as V3L.

Canonical incumbent remains:

> **PUCT V3B.1 PNSum Cpn=2.0**

No 10k escalation and no threshold sweep are justified.

## Hypothesis

The post-V3K audit and V3L showed two competing facts:

1. root PNSum can create transient allocation basins that disagree strongly
   with current Q;
2. globally removing root PNSum destroys real B3 strength.

V3M therefore kept PNSum and added one root-only guard.

At each root selection step:
1. compute the ordinary no-proof PUCT winner;
2. compute the ordinary PNSum winner with Cpn=2.0;
3. if both winners are the same, keep PNSum;
4. if they differ and both children have visits, compare direct mean-Q from the
   acting side;
5. suppress the proof term for that one root selection step only when the
   no-proof winner is better by more than **0.10 normalized Q**.

All interior nodes retain unchanged V3B.1 PNSum Cpn=2.0.

The 0.10 gate was preregistered once and was not swept.

## Correctness / TDD

Protocol:
- `docs/research/V3M_ROOT_Q_CONFLICT_GUARD_PROTOCOL_2026-09-28.md`
  on the disposable research branch.

TDD evidence:
- RED: run `36335830746` — V3M API/module did not yet exist;
- GREEN: run `36335930234` — typecheck, full tests and build passed;
- diagnostic proof-snapshot RED: `36335993877`;
- proof-snapshot GREEN: `36336033497`.

The core option defaulted to disabled, so existing V3A/V3B.1 behavior remained
unchanged unless V3M explicitly enabled the guard.

## Causal diagnostic

Canonical run:
- `36336434564`

The diagnostic replayed:
- B2:CCW move 26;
- B4:CW move 26;
- B3:CW move 30;
- B3:CCW move 30;

at 500 / 1k / 2k / 5k / 10k fixed simulations.

Gate result:
- B2/B4 pathology removed: **PASS**;
- B3 5k incumbent action preserved: **PASS**;
- reflection symmetry: **PASS**.

### B2/B4

At the known unstable B2/B4 move-26 states:

V3B.1:
- 1k/2k enters the proof-driven B3 basin;
- returns to B1/B5 by 5k.

V3M:
- stays on B1/B5 at 500/1k/2k/5k/10k.

Thus the 0.10 Q-conflict guard successfully blocked the audited
large-Q-disagreement allocation flip.

### B3 audit state

At B3 move 30:

V3B.1 and V3M selected the same B3 branch at 5k in both mirrored directions.

This was important because V3L's global root-PNSum removal had destroyed the
B3 behavior. V3M appeared to preserve it in this local diagnostic.

## Quan Gia 5k strength screen

Canonical run:
- `36336438498`

Protocol:
- V3M vs V3B.1;
- 5,000 fixed simulations per decision;
- all 10 canonical openings;
- candidate once as opener and once as responder;
- unresolved games censored.

Aggregate:
- **10W-0D-8L**
- unresolved games: **2**
- favorable / neutral / unfavorable / unresolved pairs:
  **2 / 4 / 2 / 2**

Favorable:
- B2:CCW
- B4:CW

Unfavorable:
- B3:CW
- B3:CCW

Unresolved:
- B2:CW
- B4:CCW

The favorable B2/B4 result again matches the causal diagnostic, but the B3
regressions violate the preregistered promotion gate.

## Targeted confirmation

Canonical run:
- `36336696421`

Only the two unfavorable B3 openings were rerun.

B3:CW:
- **0W-0D-2L**
- unfavorable reproduced.

B3:CCW:
- **0W-0D-2L**
- unfavorable reproduced.

This closes V3M immediately. The unresolved B2:CW/B4:CCW pairs do not need
rescue or completion because a reproduced unfavorable pair is already
decisive.

## B3 first-divergence postmortem

Canonical run:
- `36336850177`

This diagnostic was run only after V3M was already rejected. It did not tune
or rescue the candidate.

### Candidate as opener

For both B3:CW and B3:CCW:
- no V3M-vs-fresh-V3B.1 candidate-action divergence was found before terminal
  or the move cap.

### Candidate as responder

The first divergence occurs immediately at **board move 1**, directly after the
forced B3 opening.

B3:CW:
- V3M: T2:CCW
- fresh V3B.1: T2:CW
- fresh V3M: T2:CCW
- full Cpn=0: T2:CW
- subtree reuse: false

B3:CCW mirrors exactly:
- V3M: T4:CW
- fresh V3B.1: T4:CCW
- fresh V3M: T4:CW
- full Cpn=0: T4:CCW
- subtree reuse: false

So the B3 regression is not a subtree-reuse artifact.

At the B3:CW divergence snapshot:
- V3M T2:CCW: 2054 visits, Q=-0.4887;
- V3M T2:CW: 1930 visits, Q=-0.4540.

The final direct-Q gap is only about **0.035**, below the 0.10 guard threshold.

That does **not** mean the guard was inactive. The guard is evaluated during
every root selection inside the 5k search. Earlier transient Q gaps can exceed
0.10, alter root allocation, and therefore change later Q/proof trajectories.
By the final snapshot the tree is already in a different basin even though the
current top-two Q disagreement has become small.

This is the key V3M failure mechanism:

> **A stateful tree search cannot be safely controlled by a memoryless
> instantaneous Q-gap gate. The gate changes allocation, which changes the
> future Q and proof numbers used by the gate itself.**

V3M therefore creates a third allocation trajectory rather than simply
interpolating between V3B.1 and root-neutral/Cpn=0 behavior.

## Interpretation

V3M is more informative than a simple failed threshold.

It proves:
- the post-V3K B2/B4 allocation pathology is real and directly controllable;
- preserving one audited B3 state is not enough to preserve whole-game B3
  strength;
- root proof/Q coupling is path-dependent at a finer timescale than one final
  root snapshot;
- instantaneous root gating can introduce new allocation basins even when its
  final-state condition is no longer true.

Therefore the next step should **not** be a sweep over 0.05 / 0.15 / 0.20 or
another static root-Q threshold. That would tune the symptom while retaining
the same self-interacting mechanism.

## Research consequence

Closed:
- V3M qGap=0.10;
- rescue threshold sweeps for V3M;
- static instantaneous root Q-gap gating as the immediate follow-up strategy.

The strongest next direction is to stop modifying V3B.1's selection dynamics
and instead preserve the incumbent search unchanged while addressing transient
root uncertainty through **additional evidence**, e.g. a bounded adaptive
simulation extension on unstable decisions.

That direction is structurally different:
- search policy remains exactly V3B.1;
- no new child-selection signal is introduced;
- only the amount of search is changed when a preregistered instability
  condition is observed.

This is a hypothesis for a future challenger, not part of V3M.

## Repository consequence

Retain this report on `main`.

Remove:
- V3M implementation and unit tests;
- proof-snapshot diagnostic instrumentation;
- V3M diagnostic/postmortem benchmark scripts;
- one-off workflows;
- the disposable `research/v3m-root-q-conflict-guard` branch.

Canonical implementation remains V3B.1.
