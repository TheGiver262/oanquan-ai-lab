# PUCT V5 transposition-graph family closure — 2026-09-19

## Scope correction — 2026-09-21

This closure verdict is supported by **Standard/classic** simulations only.
It must not be generalized to **Pie + Threefold** or **Quan Gia + Threefold**
without rerunning the family under those exact mode semantics.

V5-A/V5-B remain closed for Standard; the retained-graph family is
**unverified** on the two forward research modes.

## Verdict

**REJECT / CLOSE V5-A and V5-B. PUCT V3A.1 material36 remains the canonical research incumbent.**

The V5 family tested whether transposition-aware graph search could improve
effective search coverage without changing the promoted V3A.1 policy/value
semantics.

PVS/NegaScout remains excluded from active evaluation.

## V5-A — conservative parent-local graph

V5-A shared deterministic graph state, expansion and exact solved outcomes
across transpositions while keeping visits, value sums and priors parent-local.

Structural 10k result:
- 8 representative positions;
- 17,768 transposition hits / 281,400 created edges;
- transposition hit rate: **6.314%**;
- highest observed position hit rate: **12.740%**;
- unique-state reduction vs incumbent expanded-node count: **7.521%**;
- root disagreements vs V3A.1: **0 / 8**.

Same-family 10k screen:
- Stage 1: 13 W / 5 D / 12 L / 2 unresolved, pairs 0/14/0;
- Stage 2: 14 W / 2 D / 14 L / 2 unresolved, pairs 0/15/0;
- Stage 3: 4 W / 2 D / 4 L / 0 unresolved, pairs 0/5/0;
- aggregate completed pairs: **0 favorable / 34 neutral / 0 unfavorable**.

Efficiency audit, workflow run `35435663577`:
- V3A.1 elapsed: 8,065.35 ms;
- V5-A elapsed: 10,282.39 ms;
- graph/incumbent elapsed ratio: **1.2749**;
- median per-decision ratio: **1.2923**;
- V5-A was about **27.5% slower in aggregate**;
- root disagreements across 24 timing observations: **0**.

V5-A therefore demonstrated real transposition reuse but failed to turn that
reuse into either strength gain or compute-efficiency gain.

## V5-B — shared-state-Q graph

V5-B retained parent-local edge visits/priors but additionally shared empirical
state Q across transposed graph nodes.

This was deliberately more aggressive than V5-A while still freezing:
- V3A.1 material36 leaf evaluation;
- policy priors and temperature;
- PUCT exploration constant;
- root ranking by parent-local visits;
- exact terminal/solved semantics;
- cycle cutoff semantics.

### 10k same-family screen

| Stage | V5-B W | Draw | V3A.1 W | Unresolved | Pair +/=/- |
|---|---:|---:|---:|---:|---|
| Stage 1 | 13 | 5 | 12 | 2 | 0/14/0 |
| Stage 2 | 14 | 2 | 14 | 2 | 0/15/0 |
| Stage 3 | 4 | 2 | 4 | 0 | 0/5/0 |

Aggregate:
- W-D-L: **31-9-30**;
- unresolved: **4**;
- completed pairs: **34**;
- favorable / neutral / unfavorable: **0 / 34 / 0**.

### 20k strong screen

| Stage | V5-B W | Draw | V3A.1 W | Unresolved | Pair +/=/- |
|---|---:|---:|---:|---:|---|
| Stage 1 | 14 | 4 | 14 | 0 | 0/16/0 |
| Stage 2 | 13 | 4 | 13 | 2 | 0/15/0 |
| Stage 3 | 4 | 2 | 4 | 0 | 0/5/0 |

Aggregate:
- W-D-L: **31-10-31**;
- unresolved: **2**;
- completed pairs: **36**;
- favorable / neutral / unfavorable: **0 / 36 / 0**.

### 50k strong screen

| Stage | V5-B W | Draw | V3A.1 W | Unresolved | Pair +/=/- |
|---|---:|---:|---:|---:|---|
| Stage 1 | 13 | 4 | 14 | 1 | 0/15/0 |
| Stage 2 | 11 | 8 | 11 | 2 | 0/15/0 |
| Stage 3 | 4 | 2 | 4 | 0 | 0/5/0 |

Aggregate:
- W-D-L: **28-14-29**;
- unresolved: **3**;
- completed pairs: **35**;
- favorable / neutral / unfavorable: **0 / 35 / 0**.

Across 10k + 20k + 50k, V5-B produced **105 completed pairs**:
- favorable: **0**;
- neutral: **105**;
- unfavorable: **0**.

Thus shared-state-Q remained non-regressive but showed no validated strength
improvement at any tested broad-search budget.

### Efficiency audit

10k x 3 timing audit:
- V3A.1 elapsed: **8,042.19 ms**;
- V5-B elapsed: **9,976.72 ms**;
- graph/incumbent elapsed ratio: **1.2405**;
- median per-decision ratio: **1.2884**;
- V5-B was about **24.1% slower in aggregate**;
- unique-state reduction: **8.244%**;
- transposition hit rate: **6.411%**;
- root disagreements: **0**.

Shared-state-Q improved state reuse slightly relative to V5-A but did not
recover the graph-management overhead.

### 100k targeted scaling

Three transposition-rich Stage 3 targets were attempted:

- `B3:CW:material@12`: 1 W / 0 D / 1 L, pairDiff 0;
- `B3:CCW:strategic@19`: 0 W / 2 D / 0 L, pairDiff 0;
- `B3:CW:material@19`: **failed with JavaScript heap OOM**.

The failing run reached the Node heap limit near 6 GB after roughly 220 seconds.
This is a scalability/resource failure, not an illegal move or game-logic
failure.

Strong-gate workflow: `v5b-shared-state-q-strong-gate`, run `35437892841`.

## Family-level interpretation

Both graph designs showed real, repeatable transpositions in Ô Ăn Quan search.
However:

1. V5-A reduced duplicate state expansion but was ~27.5% slower and behaviorally neutral.
2. V5-B shared empirical state Q more aggressively, but remained behaviorally
   neutral over **105/105 completed pairs** across 10k/20k/50k.
3. V5-B was still ~24.1% slower in aggregate.
4. V5-B also exposed poor memory scaling with a 100k OOM on one difficult
   transposition-rich position.

The evidence does **not** show transposition-aware search is intrinsically bad.
It shows these retained full-graph architectures do not justify their CPU/RAM
cost for the observed transposition density.

## Decision consequence

- V3A.1 material36 remains canonical.
- V5-A and V5-B are closed and must not be promoted.
- Do not spend a Trạng Nguyên gate on V5-B: there is no promotion signal.
- Do not rescue this family by tuning C_puct, priors, material36 or leaf weights.
- Do not continue with another full retained graph that only changes how Q/visits
  are shared.
- If transposition reuse is revisited, use a lower-overhead bounded cache /
  transposition table rather than a retained search graph, or pursue a
  structurally different search mechanism.
- V4 selective one-ply leaf-bootstrap remains closed.
- PVS/NegaScout remains excluded from active evaluation.
