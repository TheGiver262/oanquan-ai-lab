# V3G visit-adaptive PUCT no-gain closure — 2026-09-26

## Verdict

**CLOSE / NO PROMOTION. V3B.1 PNSum Cpn=2.0 remains the canonical Quan Gia + Threefold incumbent.**

V3G replaced V3B.1's fixed PUCT exploration coefficient with a MuZero-style
visit-adaptive coefficient while keeping the incumbent evaluator, policy priors
and PNSum proof guidance frozen.

The Quan Gia 5k gate was perfectly neutral:
- **10W-0D-10L**
- **0 favorable / 10 neutral / 0 unfavorable / 0 unresolved pairs**
- every canonical opening finished exactly 1W-1L

The preregistered protocol required both zero unfavorable pairs and at least one
favorable pair to advance. V3G therefore stops at 5k.

## Candidate

Frozen from V3B.1:
- V3A.2 positive-only material36 evaluator
- PNSum
- Cpn=2.0
- policy temperature=0.6
- heuristic policy priors
- subtree reuse
- cycle cutoff
- exact W/D/L propagation
- ordinary valueSum/visits backup
- final root ranking by visits

Changed:
- fixed PUCT exploration coefficient -> visit-adaptive coefficient

## Exploration schedule

Fixed constants:
- c_init = 1.5
- c_base = 19652

For parent visit count N:

`c(N) = 1.5 + log((N + 19652 + 1) / 19652)`

The exploration term remained:

`U = c(N) * prior * sqrt(parentVisits) / (1 + childVisits)`

This preserves approximately the incumbent 1.5 coefficient at low visit counts
and raises exploration gradually as a node accumulates visits.

## Correctness gates

Before strength testing:
- fixed schedule reproduced V3B.1 action/rootStats parity
- adaptive coefficient was verified monotonic in parent visits
- c(0) remained approximately 1.5
- PNSum Cpn=2.0 stayed frozen
- returned actions were legal
- typecheck, tests and build passed

## Quan Gia 5k gate

Protocol:
- candidate: V3G V3B.1 + visit-adaptive PUCT
- incumbent: V3B.1 PNSum Cpn=2.0 fixed c_puct=1.5
- mode: `quan-gia-threefold`
- 5,000 simulations per decision
- all 10 canonical openings
- candidate once as opener and once as responder
- maxBoardMoves=200
- unresolved games censored

Aggregate:
- **10W-0D-10L**
- **0 favorable pairs**
- **10 neutral pairs**
- **0 unfavorable pairs**
- **0 unresolved pairs**

Every opening pair was exactly 1W-1L:
- B1:CW
- B1:CCW
- B2:CW
- B2:CCW
- B3:CW
- B3:CCW
- B4:CW
- B4:CCW
- B5:CW
- B5:CCW

## Interpretation

The visit-dependent exploration schedule was correctness-safe and
non-regressive, but produced no measurable playing-strength gain at the 5k
gate.

This indicates that the fixed V3B.1 exploration coefficient is not the obvious
remaining bottleneck at this budget, at least for the tested MuZero-style
schedule.

The result does not imply that all adaptive exploration schedules are useless.
It rejects this preregistered schedule:
- c_init=1.5
- c_base=19652
- MuZero logarithmic visit adaptation

Do not rescue V3G by immediately sweeping c_init/c_base or changing the
schedule shape. Those are separate hypotheses.

## Decision consequence

- Keep **V3B.1 PNSum Cpn=2.0** as Quan Gia + Threefold incumbent.
- Close V3G.
- Do not run 10k/20k/50k.
- Do not run Pie reference checks.
- Keep proof-number tuning closed.
- Keep Progressive History closed.
- PVS/NegaScout remains excluded.
- Unresolved games remain censored.

## Evidence run

- Quan Gia 5k gate: Actions run `36252407168`

## Literature context

The schedule form follows MuZero's visit-dependent prior coefficient, with
c_init anchored to V3B.1's incumbent 1.5 rather than MuZero's pseudocode
default.

## Repository consequence

Retain only this consolidated closure report on main.
Remove the V3G implementation, tests, benchmark, temporary workflow and research
branch after consolidation.
