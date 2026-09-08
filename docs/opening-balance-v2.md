# Opening Balance V2

## Scope

This phase is research-only in `TheGiver262/oanquan-ai-lab`. It does not modify `TheGiver262/O_an_quan`.

The purpose is to add a third search family, independent from both the production Trạng Nguyên implementation and MCTS, then check whether the six non-red-flag classic openings show stable seat-value signals as search budget grows.

This is **not an exact game solver**. Every score below is a bounded heuristic search result.

## Independent search baseline

`src/research/negamax-pvs.ts` implements:

- iterative deepening
- Negamax
- alpha-beta pruning
- Principal Variation Search (PVS)
- aspiration windows
- transposition table with exact/lower/upper bounds
- deterministic move ordering and tie breaking
- node/time budgets

Its evaluation is intentionally not copied from production Trạng Nguyên. It uses only:

- terminal result and score margin
- captured-score difference
- side-stone difference
- refill-reserve difference

Before opening analysis, the lab requires PVS to agree with full-window alpha-beta at the same fixed depth and verifies node-budget determinism.

## Interpretation of score

A classic P0 opening is forced, then search begins from P1. The benchmark reports `openerScore`, the value from the original P0 opener's perspective.

- positive: heuristic signal favors P0/opener
- negative: heuristic signal favors P1/responder
- zero: neutral under this bounded search/evaluation

Small magnitude does not prove fairness. Stable sign does not prove a forced result.

## Six-opening convergence pass

Scores are `openerScore` at 100k, 500k and 2M node budgets.

| Opening | 100k | 500k | 2M | Sign sequence | Best-reply stability | V2 status |
| --- | ---: | ---: | ---: | --- | --- | --- |
| `B1:CCW` | 0 | +10 | -20 | neutral → P0 → P1 | unstable | finalist, unstable |
| `B2:CCW` | +40 | +60 | +70 | P0 → P0 → P0 | unstable | demoted: persistent P0 signal |
| `B3:CW` | +20 | -20 | 0 | P0 → P1 → neutral | **stable** (`T1:CW`) | finalist |
| `B3:CCW` | +20 | -20 | 0 | P0 → P1 → neutral | unstable | finalist |
| `B4:CW` | +40 | +60 | +70 | P0 → P0 → P0 | unstable | demoted: persistent P0 signal |
| `B5:CW` | 0 | +10 | 0 | neutral → P0 → neutral | **stable** (`T2:CCW`) | finalist |

`B2:CCW` and `B4:CW` are not declared solved or unfair, but they are weaker balanced-opening candidates than the other four because the independent solver kept the same P0-favored sign while budget increased to 2M nodes.

## 5M-node finalist pass

The four finalists were then searched with 5M nodes and a maximum depth of 24. All four completed depth 15 before exhausting the node budget.

| Opening | Previous sequence | 5M score | 5M best reply | Completed depth | Interpretation |
| --- | --- | ---: | --- | ---: | --- |
| `B1:CCW` | 0 → +10 → -20 | **-80** | `T1:CW` | 15 | deeper search strengthens P1 signal |
| `B3:CW` | +20 → -20 → 0 | **-30** | `T1:CW` | 15 | smallest observed deep bias; reply stable across all budgets |
| `B3:CCW` | +20 → -20 → 0 | **-30** | `T2:CW` | 15 | smallest observed deep bias; root reply changed across earlier budgets |
| `B5:CW` | 0 → +10 → 0 | **-80** | `T2:CCW` | 15 | prior near-zero result was a shallower-horizon artifact |

The 5M pass materially changes the interpretation of `B5:CW`: despite a stable best reply and near-zero values through 2M, depth 15 moves its value to -80. Therefore a near-zero score at one depth/budget must not be treated as evidence of balance.

## Current candidate ranking

Using only this independent solver's convergence evidence:

1. `B3:CW` — strongest candidate. Deep score -30 and best reply `T1:CW` remained stable through 100k/500k/2M/5M.
2. `B3:CCW` — equally small deep score (-30), but root best reply was less stable at shallower budgets.
3. `B1:CCW` / `B5:CW` — both moved to -80 at 5M and are downgraded.
4. `B2:CCW` / `B4:CW` — persistent +40 → +60 → +70 P0 signal through 2M and are downgraded.

This ranking is not a game-theoretic ranking and must not be used directly as a production Balanced Opening Pool.

## Relation to prior cross-engine evidence

The prior forced-opening UCT-PB vs production-reference Trạng Nguyên experiment found large opening-specific seat effects, while aggregate P0/P1 results were close to even. It also showed a large engine-strength confound because UCT-PB won most games overall.

The independent PVS solver is valuable because it introduces a third evaluation/search family. It does **not** eliminate uncertainty:

- UCT-PB vs Trạng Nguyên outcomes are stochastic and engine-confounded.
- Trạng Nguyên bounded scores use a different heuristic and best-first search.
- PVS scores here use a deliberately simple independent heuristic.
- none of these systems has solved the complete initial game tree.

Agreement among them is stronger evidence than any single engine, but disagreement must be preserved rather than averaged away.

## Current conclusion

Opening choice clearly matters. The research now supports three tiers:

### Strong red flags from prior cross-engine testing

- `B1:CW` — strong P1 signal
- `B2:CW` — strong P0 signal
- `B4:CCW` — strong P0 signal
- `B5:CCW` — strong P1 signal

### Downgraded in V2 independent-search testing

- `B1:CCW`
- `B2:CCW`
- `B4:CW`
- `B5:CW`

### Best current candidates, still unproven

- `B3:CW`
- `B3:CCW`

No Balanced Opening Pool should be shipped yet. The next research phase should stress-test the B3 pair with higher compute, multiple evaluation families, exact/endgame solving where feasible, and paired full-game play under multiple engines before a production rule is proposed.
