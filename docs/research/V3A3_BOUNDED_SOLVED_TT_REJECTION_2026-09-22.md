# PUCT V3A.3 bounded exact-solved TT rejection — 2026-09-22

## Verdict

**REJECT / CLOSE V3A.3. V3A.2 remains the canonical incumbent for both target modes.**

V3A.3 preserved the V3A.2 evaluator and PUCT behavior, adding only a bounded
transposition table for exact nonterminal W/D/L outcomes. Approximate visits,
value sums and priors remained parent-local.

The mechanism produced real proof reuse, but it failed the mandatory 10k
all-opening Quan Gia + Threefold gate with four unfavorable opening pairs.

No 20k or 50k promotion run is justified.

## Hypothesis tested

V5 showed real transpositions but its retained graph was neutral in strength,
roughly 24-28% slower, and exposed poor memory scaling. Its closure report
explicitly suggested a lower-overhead bounded cache/transposition table if
transposition reuse was revisited.

V3A.3 therefore tested a narrower design:
- incumbent V3A.2 positive-only material36 leaf evaluation unchanged;
- PUCT selection unchanged;
- policy priors / temperature unchanged;
- parent-local visits and value sums unchanged;
- root visit-count ranking unchanged;
- exact solved propagation unchanged;
- only exact nonterminal W/D/L outcomes reusable by strategic state key;
- FIFO hard cap: 16,384 entries.

## Structural 5k screen

Forced B3:CW / B3:CCW, candidate once as opener and once as responder.

Pie + Threefold:
- exact-cache hits ranged from 0 to 72 per candidate game;
- peak cache entries: 764-1,121;
- both B3 opening pairs remained neutral.

Quan Gia + Threefold:
- exact-cache hits ranged from 1,059 to 3,089;
- stores ranged from 9,001 to 9,304;
- peak entries stayed below the 16,384 bound;
- both B3 opening pairs remained neutral.

This established that the cache was active and especially relevant under Quan
Gia, without violating the memory cap.

Workflow: `v3a3-bounded-solved-tt-structural`, run `35731657935`.

## Canonical 10k all-opening screen

Protocol:
- both mandatory target modes;
- all 10 legal initial openings;
- two games per opening;
- V3A.3 once as original opener and once as original responder;
- V3A.2 as opponent;
- fixed 10,000 simulations per decision;
- no heuristic adjudication of unresolved games;
- Pie ownership follows research-agent identity through SWAP.

### Pie + Threefold

Aggregate:
- V3A.3: **6W-8D-6L**
- completed opening pairs: 10
- favorable / neutral / unfavorable: **0 / 10 / 0**
- unresolved: 0

Pie was non-regressive at this gate.

### Quan Gia + Threefold

Aggregate:
- V3A.3: **6W-2D-12L**
- completed opening pairs: 10
- favorable / neutral / unfavorable: **0 / 6 / 4**
- unresolved: 0

Unfavorable opening pairs:
- `B1:CCW`
- `B2:CCW`
- `B4:CW`
- `B5:CW`

The 10k run also exercised the hard memory bound: several games reached 16,384
entries and evicted older exact proofs rather than growing without bound.

Workflow: `v3a3-vs-v3a2-10k-all-openings`, run `35731803371`.

## Interpretation

The experiment answers the narrow question:

> Can a bounded exact-solved transposition table be added to V3A.2 and produce
> a safe general replacement on both target modes?

At the tested design point, **no**.

Exact proof reuse is real, but under a fixed simulation budget it changes search
allocation enough to produce a clear Quan Gia regression. Since the promotion
protocol requires a general challenger to be non-regressive on both target
modes, the four unfavorable pairs are sufficient to close this variant.

This does not prove all bounded transposition techniques are intrinsically bad.
It does show that simply injecting reusable solved-state outcomes into the
current V3A.2 tree is not a safe next incumbent.

## Decision consequence

- Keep **V3A.2 positive-only material36** as official incumbent.
- Do not run 20k/50k promotion gates for V3A.3.
- Do not rescue this exact design by capacity tuning; that would be post-failure
  parameter fitting without a new causal hypothesis.
- Full retained-graph V5 remains closed.
- PVS/NegaScout remains excluded.
- Next AI work should change search/value behavior with a distinct hypothesis,
  rather than another transposition-cache size sweep.

## Cleanup

After this report is retained, remove the V3A.3 implementation, dedicated test,
benchmark, temporary workflows and planning file. Failed research keeps the
verdict/evidence, not the one-off code.
