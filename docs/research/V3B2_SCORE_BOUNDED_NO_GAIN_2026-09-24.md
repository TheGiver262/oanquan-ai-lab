# V3B.2 Score-Bounded PNSum no-gain closure — 2026-09-24

## Verdict

**CLOSE / NO PROMOTION. V3B.1 PNSum Cpn=2.0 remains the canonical incumbent for Quan Gia + Threefold.**

V3B.2 added parameter-free Score-Bounded MCTS propagation and safe dominance
cuts on top of V3B.1. The preregistered Quan Gia 5k gate finished with every
opening pair neutral.

Because the promotion protocol required both:
1. zero unfavorable pairs; and
2. a positive signal,

V3B.2 does not advance to 10k.

## Candidate

V3B.2 kept the promoted V3B.1 configuration frozen:
- PNSum
- Cpn=2.0
- V3A.2 positive-only material36 evaluator
- c_puct=1.5
- policy temperature=0.6
- heuristic priors
- subtree reuse
- cycle cutoff
- exact W/D/L propagation
- ordinary valueSum/visits backup
- final root ranking by visits

The only new mechanism was Score-Bounded MCTS:
- each node stores admissible lower/upper utility bounds;
- Max propagates max(child bounds);
- Min propagates min(child bounds);
- dominated children are skipped with safe alpha-beta-style bound cuts.

## Winner-safe utility

Raw score differential alone is not a safe objective in this engine because
`no_refill` can explicitly force the opponent to win.

V3B.2 therefore used:

`utility = 71 * WDL + finalScoreDiff`

where WDL is +1 / 0 / -1.

The total initial material value is 70:
- 50 dân
- 2 quan * 10

A tier gap of 71 therefore keeps win/draw/loss lexicographically dominant over
score differential.

For nonterminal states:
- `d = engineScore - opponentScore`
- `R = remaining board value`
- lower = `-71 + d - R`
- upper = `+71 + d + R`

Terminal bounds collapse to the exact lexicographic utility.

## Correctness gates

Before strength testing:
- typecheck passed;
- tests passed;
- build passed;
- V3B.1 behavior remained identical when Score-Bounded mode was disabled;
- initial Quan Gia bounds were verified as [-141, 141];
- terminal winner-safe utility was verified;
- max/min bound propagation was verified;
- V3B.2 returned legal moves.

## Quan Gia 5k result

Protocol:
- candidate: V3B.2 PNSum Cpn=2.0 + Score-Bounded MCTS
- incumbent: V3B.1 PNSum Cpn=2.0
- mode: `quan-gia-threefold`
- fixed simulations per decision: 5,000
- all 10 openings
- candidate once as opener and once as responder
- maxBoardMoves=200
- unresolved games censored

Aggregate:
- **10W-0D-10L**
- **0 favorable pairs**
- **10 neutral pairs**
- **0 unfavorable pairs**
- **0 unresolved pairs**

Every opening pair finished exactly 1W-1L:
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

The Score-Bounded extension was correctness-safe and non-regressive at 5k, but
it produced **no measurable strength gain at all** against V3B.1 under the
registered opening-pair protocol.

This is materially different from a regression:
- V3B.2 did not fail by losing opening pairs;
- it failed the advancement criterion by producing no positive pair signal.

Running 10k after a zero-signal 5k gate would violate the preregistered promotion
sequence and spend compute on a candidate with no demonstrated advantage.

The result does not show that Score-Bounded MCTS is universally useless for
Ô Ăn Quan. It shows that this parameter-free safe-pruning implementation adds no
observable playing-strength benefit on top of V3B.1 at the 5k gate.

## Decision consequence

- Keep **V3B.1 PNSum Cpn=2.0** as Quan Gia + Threefold incumbent.
- Close V3B.2.
- Do not run V3B.2 10k/20k/50k.
- Do not run Pie/Standard reference checks.
- Do not add post-hoc gamma/delta bound bias to rescue this version; that would
  be a new experiment with a new causal hypothesis.
- Keep unresolved-game censoring and the existing mode hierarchy.

## Evidence

- V3B.2 Quan Gia 5k Actions run: `35924375272`

## Literature context

The implementation follows the safe bound propagation and dominance-cut ideas
from Cazenave & Saffidine's Score Bounded Monte-Carlo Tree Search, combined with
the proof-number selection family discussed by Kowalski et al. in Generalized
Proof-Number Monte-Carlo Tree Search.

## Repository consequence

Per repository hygiene, retain only this consolidated closure report on main.
Remove the research branch, V3B.2 implementation/tests/benchmark, and temporary
workflow after consolidation.
