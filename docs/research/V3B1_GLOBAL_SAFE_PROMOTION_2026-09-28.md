# V3B.1-G Global Safe promotion — 2026-09-28

## Verdict

**PROMOTE V3B.1-G as the global incumbent.**

User acceptance rule:
- evaluate Standard, Pie + Threefold and Quan Gia + Threefold independently;
- against V3A.2, candidate wins must be >= candidate losses in every mode.

V3B.1-G passes this rule at both 10k and 20k.

## Model

One mode-aware model class with V3A.2 value semantics everywhere:

- Quan Gia + Threefold: PNSum Cpn=2.0, identical to V3B.1.
- Pie + Threefold: Cpn=0, identical to V3A.2.
- Standard: Cpn=0, identical to V3A.2.

This preserves the proven Quan Gia gain while eliminating V3B.1's Pie/Standard regressions.

No core search math changed.

## Naming note

The temporary research prototype was initially labeled V3B.2 in benchmark/workflow output.
That name conflicted with the older closed V3B.2 Score-Bounded PNSum study, so the promoted
candidate was renamed **V3B.1-G** after the strength runs. The rename changed identifiers only,
not behavior. Final renamed HEAD passed full CI.

## Correctness

TDD evidence:
- RED: run `36450938258`
- GREEN: run `36451041315`
- final conflict-free rename CI: run `36453732336`

Correctness guards prove:
- Quan Gia parity with V3B.1 Cpn=2.0;
- Pie parity with V3A.2;
- Standard parity with V3A.2;
- legal actions in all three modes.

## Global 10k gate

Evidence run: `36451202211`

### Standard
- **8W-4D-8L**
- 0 favorable / 10 neutral / 0 unfavorable / 0 unresolved pairs
- user gate: PASS

### Pie + Threefold
- **6W-8D-6L**
- 0 / 10 / 0 / 0
- user gate: PASS

### Quan Gia + Threefold
- **14W-0D-6L**
- 4 favorable / 6 neutral / 0 unfavorable / 0 unresolved
- favorable: B1:CCW, B3:CW, B3:CCW, B5:CW
- user gate: PASS

## Global 20k confirmation

Evidence run: `36451946897`

### Standard
- resolved: **6W-4D-6L**
- unresolved games: 4
- 0 favorable / 8 neutral / 0 unfavorable / 2 unresolved pairs
- unresolved: B1:CCW, B5:CW
- user gate: PASS because wins == losses

### Pie + Threefold
- **6W-8D-6L**
- 0 / 10 / 0 / 0
- user gate: PASS

### Quan Gia + Threefold
- **14W-0D-6L**
- 4 / 6 / 0 / 0
- user gate: PASS

## Interpretation

V3B.1 itself is not a universal improvement: Cpn=2.0 helps Quan Gia but regresses Pie and Standard.

V3B.1-G is the first global incumbent under the new objective because it forms a Pareto-safe
ruleset-aware model:
- retains all validated V3B.1 strength on Quan Gia;
- never gives up V3A.2 strength on Pie or Standard.

The current objective is now global rather than Quan-Gia-primary. Future challengers must be
compared against V3B.1-G across all three modes and must satisfy wins >= losses independently
in each mode.

## Repository consequence

Retain:
- V3B.1-G implementation;
- V3B.1-G parity/legal-action tests;
- reusable three-mode V3B.1-G benchmark;
- this promotion report.

V3B.1 and V3A.2 remain retained as component/reference implementations.
