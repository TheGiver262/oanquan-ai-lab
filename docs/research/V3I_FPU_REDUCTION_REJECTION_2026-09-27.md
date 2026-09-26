# V3I First Play Urgency rejection / no-gain closure — 2026-09-27

## Verdict

**CLOSE V3I. V3B.1 PNSum Cpn=2.0 remains the canonical Quan Gia + Threefold incumbent.**

V3I tested Leela-style First Play Urgency (FPU) reduction for unvisited PUCT
children while keeping the complete V3B.1 stack frozen.

No preregistered coefficient qualifies to advance:
- r=0.1: repeatable unfavorable pairs
- r=0.3: positive aggregate signal but repeatable unfavorable pairs
- r=0.5: completely neutral, no positive pair signal

No 10k/20k/50k or reference-mode gates are justified.

## Mechanism

Incumbent V3B.1 assigns Q=0 to unvisited children.

V3I instead used:

`fpu = parentQ - r * sqrt(visitedPriorMass)`

where:
- parentQ is measured from the acting research agent's perspective;
- visitedPriorMass is the sum of priors of already visited sibling candidates;
- visited children continue to use their actual mean Q.

Selection remained:

`Q_or_FPU + PUCT + Cpn*PNSum`

All other search/value semantics were frozen.

## Correctness

Before strength testing:
- r=0 reproduced exact V3B.1 action/rootStats parity;
- FPU=0 when visitedPriorMass=0 and parentQ=0;
- FPU decreased monotonically as visited prior mass increased;
- acting-agent sign semantics were preserved by selection;
- all preregistered coefficients returned legal actions;
- V3B.1 explicitly froze FPU off;
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

### r=0.1

Aggregate:
- **8W-2D-10L**
- **0 favorable / 8 neutral / 2 unfavorable / 0 unresolved**
- unfavorable:
  - `B2:CCW`: 0W-1D-1L
  - `B4:CW`: 0W-1D-1L

Targeted confirmation:
- `B2:CCW`: **0W-1D-1L**
- regression reproduced exactly

Decision: reject.

### r=0.3

Aggregate:
- **10W-2D-8L**
- **2 favorable / 6 neutral / 2 unfavorable / 0 unresolved**
- favorable:
  - `B2:CW`: 2W-0D-0L
  - `B4:CCW`: 2W-0D-0L
- unfavorable:
  - `B2:CCW`: 0W-1D-1L
  - `B4:CW`: 0W-1D-1L

Targeted confirmation:
- `B2:CCW`: **0W-1D-1L**
- regression reproduced exactly

Decision: reject despite positive aggregate WDL because pair robustness failed.

### r=0.5

Aggregate:
- **10W-0D-10L**
- **0 favorable / 10 neutral / 0 unfavorable / 0 unresolved**
- every opening pair finished 1W-1L

Decision: close for no measurable gain.

## Interpretation

FPU clearly changes search behavior enough to create opening-specific gains at
r=0.3, but those gains are mirrored by repeatable losses in neighboring opening
conditions.

The strongest positive coefficient therefore fails robustness, while the
stronger reduction r=0.5 collapses back to a fully neutral result.

This indicates that unvisited-child Q initialization is not the obvious
remaining bottleneck in the current V3B.1 stack.

The result rejects this preregistered Leela-style FPU formulation and coefficient
screen. It does not imply that every possible FPU schedule is universally bad.

## Decision consequence

- Keep **V3B.1 PNSum Cpn=2.0** as Quan Gia + Threefold incumbent.
- Close V3I.
- Do not run 10k/20k/50k.
- Do not run Pie/Standard reference checks.
- Do not widen the FPU coefficient grid as a rescue.
- Keep proof-number tuning, Progressive History, RAVE, adaptive c_puct,
  minimax hybrids and material-bounded exact solving closed.
- PVS/NegaScout remains excluded.
- Unresolved games remain censored.

## Evidence runs

- Quan Gia 5k screen: Actions run `36268431260`
- B2:CCW confirmation: Actions run `36268697554`

## Literature context

The tested FPU reduction follows the Leela-style idea of replacing Q=0 for
unvisited children with parent-Q reduced according to already visited policy
mass.

## Repository consequence

Retain only this consolidated closure report on main.
Remove V3I implementation, tests, benchmark, temporary workflows and research
branch after consolidation.
