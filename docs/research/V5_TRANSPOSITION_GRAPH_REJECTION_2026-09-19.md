# PUCT V5-A conservative transposition graph rejection — 2026-09-19

## Verdict

**REJECT / CLOSE V5-A. PUCT V3A.1 material36 remains the canonical research incumbent.**

V5-A shared deterministic graph state/expansion/exact solved outcomes across
transpositions while keeping action visits, value sums and priors parent-local.
V3A.1 policy priors, leaf evaluation, material36, PUCT constant, root ranking,
cycle semantics and terminal proof rules were frozen.

## Structural result

Current canonical rerun:
- workflow: `v5-transposition-strength-gate`
- run: `35435314695`
- fixed simulations: 10,000
- representative positions: 8
- root disagreements vs V3A.1: **0 / 8**
- transposition hits: **17,768 / 281,400 created edges**
- transposition hit rate: **6.314%**
- highest observed position hit rate: **12.740%**
- aggregate unique-state reduction vs incumbent expanded-node count: **7.521%**

Thus transpositions are real and repeatable in the search space.

## Same-family strength screen

Equal 10,000 fixed simulations per decision, every exact position seat-swapped:

| Stage | V5 W | Draw | V3A.1 W | Unresolved | Pair +/=/- | Mean pair diff |
|---|---:|---:|---:|---:|---|---:|
| Stage 1 | 13 | 5 | 12 | 2 | 0/14/0 | 0 |
| Stage 2 | 14 | 2 | 14 | 2 | 0/15/0 | 0 |
| Stage 3 | 4 | 2 | 4 | 0 | 0/5/0 | 0 |

Aggregate:
- resolved W-D-L from V5 perspective: **31-9-30**
- unresolved: **4**
- completed pairs: **34**
- favorable / neutral / unfavorable: **0 / 34 / 0**
- mean pair diff: **0**

V5-A therefore showed no broad strength regression, but also no validated
strength improvement and no root disagreement on the structural corpus.

## Compute-efficiency audit

Workflow:
- `v5-transposition-efficiency`
- run: `35435663577`

Protocol:
- 10,000 fixed simulations per decision
- 8 positions
- 3 replicates
- 24 paired timing observations
- one warm-up per engine
- execution order alternated between replicates

Aggregate:
- V3A.1 elapsed: **8,065.35 ms**
- V5-A elapsed: **10,282.39 ms**
- graph / incumbent elapsed ratio: **1.2749**
- median per-decision ratio: **1.2923**
- V5-A is therefore about **27.5% slower in aggregate** and **29.2% slower at the median**
- incumbent expanded nodes: **855,240**
- graph unique nodes: **790,920**
- unique-state reduction: **7.521%**
- graph transposition hits: **53,304 / 844,200 edges = 6.314%**
- root disagreements across all 24 timing observations: **0**

GitHub-hosted runner timing is noisy, but the slowdown is large, consistent
across the aggregate/median, and opposite the intended compute-efficiency goal.

## Interpretation

The conservative parent-local-edge graph design is safe but too conservative to
produce a search-quality change, while hash-map/graph bookkeeping costs more
than the saved state duplication at the observed transposition density.

The result does **not** show that transposition-aware search is intrinsically
bad for Ô Ăn Quan. It shows that this V5-A architecture fails its promotion
criterion:

- measurable transposition reuse: yes;
- same-family non-regression: yes;
- positive validated disagreement: no;
- material compute-efficiency gain: **no — material slowdown instead**.

## Decision consequence

- V3A.1 material36 remains incumbent.
- Do not promote V5-A.
- Do not spend 20k/50k or Trạng Nguyên gate budget on V5-A.
- Do not rescue V5-A by tuning C_puct, priors, leaf weights or material36.
- If transposition search is revisited, it needs a materially different
  architecture (for example lower-overhead caching or deliberately shared
  search statistics), not incremental tuning of this conservative graph.
- V4 selective one-ply leaf bootstrap remains closed.
- PVS/NegaScout remains excluded from active evaluation.
