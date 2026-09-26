# V3H local RAVE/AMAF rejection — 2026-09-27

## Verdict

**REJECT / CLOSE V3H. V3B.1 PNSum Cpn=2.0 remains the canonical Quan Gia + Threefold incumbent.**

V3H tested node-local RAVE / AMAF as a narrower alternative to the previously
rejected global Progressive History signal.

All three preregistered RAVE equivalence constants produced unfavorable Quan Gia
opening pairs at the 5k screen. The common `B2:CCW` regression was rerun
independently for every coefficient and reproduced every time.

No coefficient advances to 10k.

## Causal hypothesis

V3F Progressive History failed after sharing action statistics globally across
many unrelated positions.

V3H tested whether the same broad idea becomes useful when action generalization
is constrained to one tree node / local subtree:

- each child stores direct PUCT statistics;
- each child also stores local RAVE visits/value;
- later actions by the same research agent in the same simulation path update
  only matching legal children of the ancestor node;
- duplicate later action keys update an ancestor at most once per simulation;
- RAVE influence decays as parent visits grow.

This mechanism was therefore materially more context-local than V3F.

## Frozen incumbent stack

V3H kept V3B.1 frozen:
- V3A.2 positive-only material36 evaluator
- PNSum
- Cpn=2.0
- fixed c_puct=1.5
- policy temperature=0.6
- heuristic priors
- subtree reuse
- cycle cutoff
- exact W/D/L propagation
- ordinary valueSum/visits backup
- visit-based root ranking
- canonical reflection

No Progressive History.
No adaptive c_puct.
No PNRank/PNMax.
No minimax/alpha-beta.
No exact endgame solver.
No transposition graph.

## RAVE formula

For parent visits N and equivalence constant k:

`beta(N,k) = sqrt(k / (3*N + k))`

For a child with RAVE samples:

`Q_blend = (1 - beta) * Q_direct + beta * Q_RAVE`

Selection remained:

`sign * Q_blend + PUCT exploration + Cpn * PNSum`

Children without RAVE samples fall back to direct Q.

## Correctness gates

Before strength testing:
- k=0 reproduced V3B.1 action/rootStats parity;
- beta decayed monotonically with parent visits;
- local AMAF updates were observed when enabled;
- V3B.1 explicitly froze RAVE off;
- all preregistered k values returned legal actions;
- typecheck, tests and build passed.

## Quan Gia 5k screen

Protocol:
- mode: `quan-gia-threefold`
- incumbent: V3B.1 PNSum Cpn=2.0
- 5,000 simulations per decision
- all 10 canonical openings
- candidate once as opener and once as responder
- maxBoardMoves=200
- unresolved games censored

### k=100

Aggregate:
- **8W-0D-12L**
- **0 favorable / 8 neutral / 2 unfavorable / 0 unresolved**
- unfavorable:
  - `B2:CCW`: 0W-0D-2L
  - `B4:CW`: 0W-0D-2L

Decision: reject.

### k=500

Aggregate:
- **10W-2D-8L**
- **2 favorable / 6 neutral / 2 unfavorable / 0 unresolved**
- favorable:
  - `B1:CW`: 2W-0D-0L
  - `B5:CCW`: 2W-0D-0L
- unfavorable:
  - `B2:CCW`: 0W-1D-1L
  - `B4:CW`: 0W-1D-1L

Although aggregate WDL is positive, the preregistered pair criterion rejects
this coefficient because the two unfavorable opening pairs remain.

Decision: reject.

### k=1000

Aggregate:
- **8W-2D-10L**
- **2 favorable / 4 neutral / 4 unfavorable / 0 unresolved**
- favorable:
  - `B1:CW`
  - `B5:CCW`
- unfavorable:
  - `B2:CW`
  - `B2:CCW`
  - `B4:CW`
  - `B4:CCW`

Decision: reject.

## Targeted confirmation

The common unfavorable opening `B2:CCW` was rerun at 5k for all three k:

- k=100: **0W-0D-2L**
- k=500: **0W-1D-1L**
- k=1000: **0W-1D-1L**

All three remain unfavorable and reproduce the original screen exactly.

## Mechanism activity

RAVE was not dormant.

Individual opening-pair runs accumulated approximately 0.7M to 4.1M local
AMAF updates depending on k/opening trajectory.

Therefore the rejection reflects an active change in search allocation rather
than a candidate that happened to behave identically to V3B.1.

## Interpretation

Localizing action statistics fixed the main architectural weakness of V3F
(global cross-position sharing), but it did not produce a robust improvement.

The strongest coefficient, k=500:
- improved two mirrored outer opening pairs;
- regressed two other opening pairs;
- reproduced one common regression independently.

This indicates that even subtree-local action identity remains too
state-dependent in Ô Ăn Quan for this RAVE formulation to be a reliable
selection estimator on top of V3B.1.

The failure is not evidence that all AMAF-style methods are universally bad.
It rejects this preregistered local RAVE formulation and k screen.

## Decision consequence

- Keep **V3B.1 PNSum Cpn=2.0** as Quan Gia + Threefold incumbent.
- Close V3H.
- Do not run 10k/20k/50k.
- Do not run Pie/Standard reference checks.
- Keep V3F Progressive History closed.
- Do not rescue with wider k sweeps or global/local history mixing.
- PVS/NegaScout remains excluded.
- Unresolved games remain censored.

## Evidence runs

- Quan Gia 5k screen: Actions run `36264833458`
- B2:CCW confirmation: Actions run `36265111604`

## Literature context

RAVE/AMAF is a standard MCTS cold-start enhancement that shares later
same-simulation action outcomes with earlier tree nodes and decays its influence
as direct evidence accumulates. Published reviews also emphasize that RAVE is
game-dependent and can improve or degrade performance depending on the domain.

## Repository consequence

Retain only this consolidated rejection report on main.
Remove the V3H implementation, tests, benchmark, temporary workflows and
research branch after consolidation.
