# V3B.4 PNRank rejection and proof-bias tuning closure — 2026-09-24

## Verdict

**REJECT / CLOSE V3B.4 PNRank. V3B.1 PNSum Cpn=2.0 remains the canonical Quan Gia + Threefold incumbent.**

All preregistered PNRank coefficients failed the primary Quan Gia 5k gate.
No coefficient produced a single favorable opening pair.

The same `B3:CW` regression was reproduced in a separate parallel rerun for
all three coefficients, with the candidate losing both paired games every time.

Per the preregistered stop condition, the current proof-number **bias-formula /
coefficient tuning line is closed**. Do not follow this result with another
PNRank/PNSum/PNMax hybrid or post-hoc coefficient search without a genuinely
new causal mechanism.

## Why PNRank was tested

PNRank discards the magnitudes of proof-number differences and keeps only their
relative ordering.

This directly targeted the concern exposed by V3B.3 mobility initialization:
absolute proof-number scale can become misleading when branching-factor
information changes those magnitudes.

The GPN-MCTS literature also reports PNRank as a comparatively robust bias
choice across its tested games, and the published Awari grid peaks at Cpn=0.5.

## Candidate definition

V3B.4 kept V3B.1 semantics frozen except for the proof-number selection bias.

Frozen:
- V3A.2 positive-only material36 evaluator
- per-player proof numbers
- unknown proof-number initialization = 1
- min/sum proof propagation
- c_puct=1.5
- policy temperature=0.6
- heuristic priors
- subtree reuse
- cycle cutoff
- exact W/D/L solved propagation
- ordinary valueSum/visits backup
- root ranking by visits

Changed:
- V3B.1 PNSum selection bias -> PNRank selection bias

No Score-Bounded MCTS.
No mobility proof initialization.

## PNRank semantics

For sibling proof numbers:
1. sort distinct values ascending;
2. lowest proof number receives rank 1;
3. tied proof numbers receive equal rank;
4. infinity is the worst rank;
5. `PNRank = 1 - rank / maxRank`.

Correctness tests verified tie handling, infinity handling, legal actions and
explicit PNSum parity for the V3B.1 path.

## Pre-registered Quan Gia 5k screen

Protocol:
- primary mode: `quan-gia-threefold`
- incumbent: V3B.1 PNSum Cpn=2.0
- 5,000 fixed simulations per decision
- all 10 canonical openings
- candidate once as opener and once as responder
- maxBoardMoves=200
- unresolved games censored

### PNRank Cpn=0.1

- resolved candidate games: **6W-0D-12L**
- unresolved games: 2
- pairs: **0 favorable / 4 neutral / 4 unfavorable / 2 unresolved**
- unfavorable:
  - `B1:CCW`
  - `B3:CW`
  - `B3:CCW`
  - `B5:CW`
- unresolved:
  - `B2:CW`
  - `B4:CCW`

Decision: reject.

### PNRank Cpn=0.5

- candidate: **6W-0D-14L**
- unresolved games: 0
- pairs: **0 favorable / 6 neutral / 4 unfavorable / 0 unresolved**
- unfavorable:
  - `B2:CCW`
  - `B3:CW`
  - `B3:CCW`
  - `B4:CW`

Decision: reject.

### PNRank Cpn=1.0

- candidate: **4W-0D-16L**
- unresolved games: 0
- pairs: **0 favorable / 4 neutral / 6 unfavorable / 0 unresolved**
- unfavorable:
  - `B2:CW`
  - `B2:CCW`
  - `B3:CW`
  - `B3:CCW`
  - `B4:CW`
  - `B4:CCW`

Decision: reject.

## Independent regression confirmation

A separately launched parallel 5k workflow reran every coefficient/opening
pair with the same registered engine settings.

For the common regression `B3:CW`:
- Cpn=0.1: **0W-0D-2L**
- Cpn=0.5: **0W-0D-2L**
- Cpn=1.0: **0W-0D-2L**

Thus every coefficient has at least one repeatable unfavorable opening pair.

## Interpretation

PNRank does not solve the domain problem that made PNMax unsafe while retaining
the gains of PNSum.

The result is stronger than a simple coefficient miss:
- none of the three preregistered coefficients produced any favorable pair;
- all three produced multiple unfavorable pairs;
- one common regression reproduces at all three coefficients.

Together with prior evidence:
- PNMax: rejected
- PNSum Cpn=2.0: promoted
- Score-Bounded addition: no measurable gain
- mobility initialization: rejected
- PNRank: rejected

the evidence now supports treating **V3B.1 PNSum Cpn=2.0 as the endpoint of the
current proof-number tuning line**, rather than continuing local PNS variants.

## Decision consequence

- Keep **V3B.1 PNSum Cpn=2.0** as Quan Gia + Threefold incumbent.
- Do not run V3B.4 10k/20k/50k.
- Do not run V3B.4 Pie/Standard reference checks.
- Close proof-number bias-formula / Cpn tuning for now.
- Future research should move to a structurally different search mechanism.
- PVS/NegaScout remains excluded.
- Unresolved games remain censored.

## Evidence runs

- full 5k coefficient screen: Actions run `36030628250`
- independent parallel rerun: Actions run `36030938326`

## Literature references

- Elliot Doe et al., "Combining Monte-Carlo Tree Search with Proof-Number
  Search", 2022.
- Jakub Kowalski et al., "Proof Number Based Monte-Carlo Tree Search", 2024.
- Jakub Kowalski et al., "Generalized Proof-Number Monte-Carlo Tree Search",
  ECAI 2025 / arXiv:2506.13249.

## Repository consequence

Retain only this consolidated rejection report on main.
Remove V3B.4 implementation, tests, benchmark, temporary workflows and research
branch after consolidation.
