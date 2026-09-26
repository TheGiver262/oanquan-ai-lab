# V3F Progressive History rejection — 2026-09-26

## Verdict

**REJECT / CLOSE V3F. V3B.1 PNSum Cpn=2.0 remains the canonical Quan Gia + Threefold incumbent.**

V3F added Progressive History as a new online global move-history signal on top
of the frozen V3B.1 search stack.

All three preregistered history weights produced unfavorable Quan Gia opening
pairs at the 5k screen. A targeted rerun reproduced one unfavorable pair for
every coefficient.

No coefficient advances to 10k.

## Candidate

Frozen from V3B.1:
- V3A.2 positive-only material36 evaluator
- PNSum
- Cpn=2.0
- c_puct=1.5
- policy temperature=0.6
- heuristic priors
- subtree reuse
- cycle cutoff
- exact W/D/L propagation
- ordinary valueSum/visits backup
- final root ranking by visits

Changed:
- added Progressive History term during selection

No RAVE/AMAF.
No minimax/alpha-beta.
No exact endgame solver.
No transposition table.

## Progressive History semantics

History is stored per research agent + canonical action key.

For simulation reward r in [-1,+1]:
- engine-agent move success = (1+r)/2
- opponent move success = (1-r)/2

Selection adds:

`historyMean * W / ((1 - actorNodeSuccess) * visits + 1)`

Unseen actions receive zero history bias.

## Correctness

Before strength testing:
- W=0 preserved V3B.1 action/rootStats parity
- history updates occurred only when enabled
- reset cleared accumulated history state
- returned actions were legal
- CI passed

## Quan Gia 5k screen

Protocol:
- mode: `quan-gia-threefold`
- incumbent: V3B.1 PNSum Cpn=2.0
- 5,000 simulations per decision
- 10 canonical openings
- candidate once as opener and once as responder
- maxBoardMoves=200
- unresolved games censored

### W=0.1

Aggregate:
- **8W-0D-12L**
- **0 favorable / 8 neutral / 2 unfavorable / 0 unresolved**
- unfavorable:
  - `B3:CW`
  - `B3:CCW`

Targeted confirmation:
- `B3:CW`: **0W-0D-2L**
- regression reproduced

### W=0.5

Aggregate:
- **8W-2D-10L**
- **0 favorable / 8 neutral / 2 unfavorable / 0 unresolved**
- unfavorable:
  - `B2:CCW`
  - `B4:CW`

Targeted confirmation:
- `B2:CCW`: **0W-1D-1L**
- pair remains unfavorable

### W=1.0

Aggregate:
- **8W-2D-10L**
- **0 favorable / 8 neutral / 2 unfavorable / 0 unresolved**
- unfavorable:
  - `B2:CCW`
  - `B4:CW`

Targeted confirmation:
- `B2:CCW`: **0W-1D-1L**
- pair remains unfavorable

## Interpretation

Progressive History successfully accumulated a large amount of cross-tree move
statistics, but this global move signal did not improve any canonical opening
pair against V3B.1.

Key evidence:
- **zero favorable pairs at every W**
- every W has two unfavorable pairs
- one unfavorable pair per W reproduces in an independent targeted rerun

This suggests that action quality in Ô Ăn Quan is too state-dependent for this
simple global action-history statistic to provide a reliable additive selection
bias on top of V3B.1.

The result rejects this Progressive History formulation, not history heuristics
in all possible forms.

## Decision consequence

- Keep **V3B.1 PNSum Cpn=2.0** as Quan Gia + Threefold incumbent.
- Close V3F.
- Do not run 10k/20k/50k.
- Do not run Pie reference checks.
- Do not rescue with a wider W sweep.
- Do not immediately add RAVE/AMAF as a post-hoc extension.
- Future work requires a separately preregistered causal hypothesis.
- PVS/NegaScout remains excluded.

## Evidence runs

- 5k screen: Actions run `36250221668`
- targeted confirmation: Actions run `36252039325`

## Repository consequence

Retain only this consolidated rejection report on main.
Remove the V3F implementation, tests, benchmark, temporary workflows and
research branch after consolidation.
