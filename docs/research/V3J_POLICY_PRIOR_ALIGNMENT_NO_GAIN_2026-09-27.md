# V3J policy-prior alignment — no-gain closure — 2026-09-27

## Verdict

**CLOSE V3J for no measurable gain.**

V3B.1 PNSum Cpn=2.0 remains the canonical Quan Gia + Threefold incumbent.

V3J tested one isolated inconsistency left in the incumbent stack: V3A.2/V3B.1
already use the positive-only material36 rule for heuristic leaf values, while
policy priors still scored successor states with the older always-on
scoreDelta*1.8 heuristic.

V3J aligned policy-prior score handling to the same V3A.2 rule and froze the
rest of V3B.1.

## Candidate

Frozen from V3B.1:
- V3A.2 positive-only material36 leaf evaluator;
- PNSum;
- Cpn=2.0;
- c_puct=1.5;
- policy temperature=0.6;
- ordinary valueSum/visits backup;
- subtree reuse;
- cycle handling;
- exact solved propagation;
- root ranking by visits.

Only policy-prior scoring changed:
- raw board material <=36: scoreDelta weight=1.8;
- material >36 and research-agent scoreDelta >0: scoreDelta weight=0;
- material >36 and scoreDelta <=0: scoreDelta weight=1.8.

## Correctness gate

Before strength testing:
- TypeScript typecheck passed.
- Full Vitest suite passed.
- Build passed.
- A high-material positive-score fixture changed policy priors relative to V3B.1.
- A high-material negative-score fixture preserved incumbent priors.
- V3J returned legal Quan Gia actions.
- Existing V3B.1 correctness/parity guards remained green.

Correctness evidence:
- Actions run `36293156392`
- research commit `6724fc5e77000eebd0078f3b2b5f3ec10ce7c5f2`

## Quan Gia 5k gate

Protocol:
- mode: `quan-gia-threefold`;
- incumbent: V3B.1 PNSum Cpn=2.0;
- 5,000 fixed simulations per decision;
- all 10 canonical openings;
- candidate once as opener and once as responder;
- maxBoardMoves=200;
- unresolved games censored.

Result:
- candidate W-D-L: **10-0-10**
- favorable pairs: **0**
- neutral pairs: **10**
- unfavorable pairs: **0**
- unresolved pairs: **0**
- every opening pair finished **1W-1L**

Strength evidence:
- Actions run `36293193725`

## Interpretation

The experiment confirms that policy-prior score handling can be changed
independently and conservatively, but the aligned rule produced no measurable
primary-mode strength signal at the preregistered 5k gate.

This is not a regression rejection: there were no unfavorable pairs. It is a
no-gain closure. The candidate changed priors on the intended high-material
positive-score states, yet those changes did not alter any paired opening
outcome against V3B.1 at 5k.

Under the preregistered gate, a zero-favorable / zero-unfavorable result does not
justify a 10k escalation.

## Decision consequence

- Keep **V3B.1 PNSum Cpn=2.0** as Quan Gia + Threefold incumbent.
- Close V3J.
- Do not run 10k/20k/50k.
- Do not run Pie/Standard reference checks.
- Do not rescue V3J by tuning material threshold, policy temperature, c_puct or Cpn.
- Treat leaf-value/policy-prior score alignment as tested and currently
  non-bottlenecking at this granularity.
- Future work should target a different mechanism rather than another
  score-gate synchronization sweep.

## Repository consequence

Retain only this consolidated report on `main`.
Remove the V3J implementation, tests, benchmark, one-off workflow and temporary
research branch after consolidation.
