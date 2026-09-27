# V3N Adaptive Simulation Extension — No Gain — 2026-09-28

## Verdict

**CLOSE V3N for no measurable playing-strength signal.**

V3N preserved V3B.1 search semantics exactly and used a bounded adaptive
5k->10k continuation only when the top-two unsolved root children remained
visit-close after the base 5k search.

The causal mechanism worked exactly as designed, but the full Quan Gia 5k
paired screen was completely neutral.

Canonical incumbent remains:

> **PUCT V3B.1 PNSum Cpn=2.0**

No 10k escalation, compute-control promotion gate, threshold sweep or budget
rescue is justified.

## Hypothesis

V3L/V3M showed that changing V3B.1 root selection can create new
path-dependent search basins.

V3N therefore changed **only search budget**:

1. run canonical V3B.1 for 5,000 simulations;
2. inspect top-two root visit counts;
3. if both top children are unsolved and

       abs(V1 - V2) / (V1 + V2) <= 0.10

   continue the same V3B.1 root for 5,000 more simulations;
4. otherwise return the 5k decision.

Maximum new work per decision: 10k simulations.

Frozen:
- V3A.2 positive-only material36 value semantics;
- PNSum Cpn=2.0 at root and interior nodes;
- c_puct=1.5;
- policy temperature=0.6;
- policy priors;
- exact solved propagation;
- backup;
- cycle handling;
- subtree reuse;
- visit-based root ranking.

No child-selection or value formula was modified.

## TDD / correctness

Preregistered protocol:
- `docs/research/V3N_ADAPTIVE_SIMULATION_EXTENSION_PROTOCOL_2026-09-28.md`
  on the disposable branch.

Evidence:
- RED: run `36338174977` — V3N module did not exist;
- GREEN: run `36338232865` — typecheck, full tests and build passed.

Correctness tests established:
- visit-margin trigger behavior;
- solved/underdetermined roots do not extend;
- repeated `chooseAction` on the identical state reuses the existing V3B.1
  root;
- split continuation is behaviorally equivalent to one-shot search;
- V3N returns legal actions and bounded budget metadata.

## Causal diagnostic

Canonical run:
- `36338381477`

States:
- B2:CCW move 26;
- B4:CW move 26;
- B3:CW move 30;
- B3:CCW move 30.

Result:
- extension fired on all four states;
- each continuation reported `reusedRoot=true`;
- reused-root visits were exactly 5,000 before the extension;
- V3N final action matched fixed V3B.1 10k on all four;
- full root statistics matched fixed 10k exactly;
- reflection symmetry held.

Observed base 5k margins:
- B2:CCW: ~0.04146;
- B4:CW: ~0.04146;
- B3:CW: ~0.09098;
- B3:CCW: ~0.09098.

Notably, the mirrored B3 states changed from their 5k actions to the same
actions selected by fixed V3B.1 10k.

Therefore the adaptive mechanism is technically sound:

> V3N does not create a third search policy. When extension fires, it is exactly
> continued V3B.1 search.

## Quan Gia adaptive 5k strength gate

Canonical run:
- `36338504374`

Candidate:
- V3N adaptive V3B.1 5k->10k.

Incumbent:
- fixed V3B.1 5k.

Protocol:
- 10 canonical forced openings;
- candidate once as opener and once as responder;
- unresolved games censored;
- max 200 board moves.

Aggregate:
- **10W-0D-10L**
- favorable pairs: **0**
- neutral pairs: **10**
- unfavorable pairs: **0**
- unresolved pairs: **0**

Compute behavior:
- candidate decisions: **420**
- extensions: **10**
- extension rate: **2.38%**
- total candidate simulations: **2,150,000**
- mean simulations per candidate decision: **5,119.05**

So V3N added only about **2.38% average simulation cost** over fixed 5k, but
that extra search did not change any paired opening result.

## Interpretation

V3N is a useful negative result because it separates search-policy risk from
budget allocation.

Unlike V3L/V3M:
- it did not introduce regressions;
- it did not alter PNSum allocation rules;
- it behaved exactly like fixed 10k whenever the preregistered instability
  trigger fired.

However:
- extension fired on only 10 of 420 candidate decisions;
- those additional 50,000 simulations produced no favorable opening pair;
- the 5k paired screen remained perfectly neutral.

Therefore the audited low-margin roots are real convergence points but are not,
by themselves, a sufficiently high-impact intervention target for strength
improvement at this gate.

## Research consequence

Closed:
- V3N margin<=0.10 adaptive 5k->10k;
- rescue sweeps of the margin threshold;
- rescue sweeps of the extension amount.

Do not reinterpret the result as evidence that more simulations never help.
It only shows that this specific sparse top-two-visit trigger did not produce
measurable paired WDL gain.

The next challenger should target a mechanism with broader information value
than a rare root-budget extension, while still avoiding selection modifiers
that feed back into PNSum.

## Repository consequence

Retain this report on `main`.

Remove:
- V3N implementation and tests;
- one-off V3N benchmarks/workflows;
- disposable research branch.

Canonical implementation remains V3B.1.
