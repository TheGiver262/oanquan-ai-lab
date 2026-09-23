# V3B.1 PNSum promotion — 2026-09-24

## Verdict

**PROMOTE V3B.1 PNSum with Cpn=2.0 as the canonical incumbent for `quan-gia-threefold`.**

This is a **mode-specific promotion**, not a universal replacement.

- Primary Quan Gia + Threefold incumbent: **V3B.1 PNSum Cpn=2.0**
- Pie + Threefold reference baseline: **V3A.2 positive-only material36**
- Standard remains a reference/historical mode; V3B.1 is not promoted there.

V3A.2 remains retained because V3B.1 regressed on both reference modes.

## Candidate

V3B.1 keeps V3A.2 value semantics and adds per-agent PNSum proof-number
guidance to tree selection only.

For the agent to move:

- unknown unexpanded leaf: proof number = 1;
- terminal win: 0;
- terminal loss/draw: infinity;
- own-turn OR node: minimum child proof number;
- opponent-turn AND node: sum of child proof numbers.

For sibling set I:

`PNSum(i,I) = 0` for infinite pn(i), otherwise

`PNSum(i,I) = 1 - pn(i) / (1 + sumFinite(I))`.

Selection adds:

`Cpn * PNSum`

with canonical `Cpn = 2.0`.

The following V3A.2 semantics remain unchanged:
- positive-only material36 leaf evaluator;
- policy priors;
- ordinary valueSum/visits backup;
- subtree reuse;
- cycle cutoff;
- exact W/D/L solved propagation;
- final root ranking by visits.

A Cpn=0 correctness guard verifies behavioral parity with V3A.2.

## Pre-registered 5k screen

Quan Gia + Threefold, 5,000 fixed simulations per decision, all 10 paired
openings.

### Cpn=0.5
- resolved candidate games: **6W-6D-6L**
- unresolved games: 2
- favorable / neutral / unfavorable / unresolved pairs: **4 / 2 / 2 / 2**
- unfavorable: `B1:CCW`, `B5:CW`
- targeted confirmation reproduced `B1:CCW` as 0W-1D-1L

Decision: reject.

### Cpn=1.0
- candidate: **6W-6D-8L**
- unresolved games: 0
- pairs: **4 / 2 / 4 / 0**
- unfavorable: `B1:CW`, `B1:CCW`, `B5:CW`, `B5:CCW`
- targeted confirmation reproduced `B1:CCW` as 0W-1D-1L

Decision: reject.

### Cpn=2.0
- candidate: **16W-0D-4L**
- unresolved games: 0
- pairs: **6 favorable / 4 neutral / 0 unfavorable / 0 unresolved**

Decision: advance Cpn=2.0.

## Primary promotion gates

### Quan Gia 10k
- candidate: **14W-0D-6L**
- pairs: **4 favorable / 6 neutral / 0 unfavorable / 0 unresolved**

### Quan Gia 20k
- candidate: **14W-0D-6L**
- pairs: **4 favorable / 6 neutral / 0 unfavorable / 0 unresolved**

The 10k and 20k aggregate results were identical.

### Quan Gia 50k
The final gate was split by opening for parallel execution without changing
engine settings or per-decision simulation count.

Aggregate:
- candidate: **12W-0D-8L**
- pairs: **2 favorable / 8 neutral / 0 unfavorable / 0 unresolved**
- favorable openings:
  - `B3:CW` -> 2W-0L
  - `B3:CCW` -> 2W-0L
- all other opening pairs: 1W-1L

One `B2:CW` runner failed during GitHub checkout because of a transient TLS
certificate verification error before the benchmark started. The same opening
was rerun independently at the identical 50k settings and completed 1W-1L.

The 50k promotion criterion therefore passes with no unfavorable or unresolved
pair.

## Reference-mode checks at 10k

### Pie + Threefold
- candidate: **6W-6D-8L**
- unresolved: 0
- pairs: **2 favorable / 6 neutral / 2 unfavorable / 0 unresolved**
- unfavorable: `B2:CCW`, `B4:CW`

### Standard
- resolved candidate games: **4W-4D-10L**
- unresolved games: 2
- pairs: **0 favorable / 4 neutral / 4 unfavorable / 2 unresolved**
- unfavorable: `B2:CCW`, `B3:CW`, `B3:CCW`, `B4:CW`
- unresolved: `B1:CCW`, `B5:CW`

These reference results show that PNSum Cpn=2.0 is not a universal strength
improvement.

Under the canonical mode hierarchy, Pie and Standard are secondary reference
checks rather than equal promotion gates. They showed no illegal actions,
crashes or rules/correctness failures, so their strength regressions do not
override the clean Quan Gia 5k/10k/20k/50k evidence.

## Promotion scope

Promote:
- **Quan Gia + Threefold -> V3B.1 PNSum Cpn=2.0**

Do not promote:
- Pie + Threefold -> retain V3A.2 baseline
- Standard -> retain existing reference/historical baseline policy

Future research challengers should compare primarily against V3B.1 Cpn=2.0 on
Quan Gia + Threefold. Pie and Standard continue to be reference checks.

## Evidence runs

- 5k coefficient screen: `35907396959`
- loser confirmation: `35907868800`
- Quan Gia 10k: `35908060434`
- Quan Gia 20k: `35908797193`
- Pie/Standard reference 10k: `35916969954`
- Quan Gia 50k parallel gate: `35917607145`
- B2:CW runner retry: `35917718890`

## Repository consequence

Retain:
- promoted V3B.1 implementation;
- PNSum correctness/parity guards;
- reusable V3B.1 benchmark;
- this consolidated promotion report.

Remove:
- one-off workflows;
- temporary branch after consolidation;
- temporary/intermediate research-only reports once their evidence is fully
  represented here;
- old completed Actions runs where safe.
