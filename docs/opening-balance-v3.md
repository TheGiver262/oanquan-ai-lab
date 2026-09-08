# Opening Balance V3

## Scope

Opening Balance V3 is research-only in `TheGiver262/oanquan-ai-lab`. It does **not** modify production repository `TheGiver262/O_an_quan`.

V2 reduced the ten classic P0 openings to two current finalists:

- `B3:CW`
- `B3:CCW`

V3 therefore stops spending compute across all ten openings and stress-tests only this B3 pair.

This remains bounded heuristic research. No result below is an exact game-theoretic solve, calibrated win probability, or proof that an opening is fair.

## Methodology

V3 keeps the V2 solver/results unchanged and adds a separate deterministic iterative-deepening Negamax search with:

- alpha-beta pruning
- Principal Variation Search (PVS)
- aspiration windows
- transposition table with exact/lower/upper bounds
- deterministic move ordering and tie-breaking
- node and time budgets

Two leaf-evaluation families are used:

### Material

The V2 independent material formula is preserved:

`scoreDelta * 20 + sideDelta * 10 + refillDelta * 3`

### Strategic

A second deliberately independent evaluator is added:

`scoreDelta * 16 + sideDelta * 5 + refillDelta * 6 + mobilityDelta * 24 + spreadDelta * 4 + emptyDelta * 8`

Neither family copies production Trạng Nguyên tuning.

Before the heavy run, the V3 test gate required:

- material V3 to reproduce V2 at the same fixed depth when optional search optimizations are disabled
- PVS to agree with full-window alpha-beta for both evaluation families
- deterministic repeated results
- repository typecheck and build success

The heavy GitHub Actions run was `34185314775` at benchmark head `28bc01c33a9b61c35f904b016fee295ccaeda954`. The production-reference Trạng Nguyên snapshot used by paired play was `4984701ce151ee270a6a5ba5fc9211a6ec2b6996`.

## Deep convergence results

Scores are reported from the original P0 opener's perspective after forcing the opening and searching from P1.

- positive: P0/opener heuristic signal
- negative: P1/responder heuristic signal
- zero: neutral under that bounded search

Raw score magnitudes from different evaluation families should not be treated as calibrated to the same probability scale.

### `B3:CW`

| Evaluation | 10M | Depth | Reply | 25M | Depth | Reply | 50M | Depth | Reply |
| --- | ---: | ---: | --- | ---: | ---: | --- | ---: | ---: | --- |
| material | -60 | 17 | `T1:CW` | 0 | 18 | `T1:CW` | **-30** | 19 | `T1:CW` |
| strategic | -64 | 17 | `T1:CW` | +4 | 18 | `T1:CW` | **-30** | 20 | `T1:CW` |

The strongest evidence for `B3:CW` is not the final `-30` itself. Its root best reply is `T1:CW` in all six deep measurements across both evaluation families and all three node budgets.

The scores are still horizon-sensitive rather than monotonically converged:

- material: `-60 -> 0 -> -30`
- strategic: `-64 -> +4 -> -30`

Both families agree at 50M nodes, but that agreement does not establish the true game value.

### `B3:CCW`

| Evaluation | 10M | Depth | Reply | 25M | Depth | Reply | 50M | Depth | Reply |
| --- | ---: | ---: | --- | ---: | ---: | --- | ---: | ---: | --- |
| material | -10 | 16 | `T4:CCW` | 0 | 18 | `T1:CCW` | **-30** | 20 | `T1:CW` |
| strategic | -2 | 16 | `T4:CCW` | +4 | 18 | `T4:CCW` | **-30** | 20 | `T4:CCW` |

Its score trajectories are also close to neutral and horizon-sensitive:

- material: `-10 -> 0 -> -30`
- strategic: `-2 -> +4 -> -30`

However, its root reply is less stable. The material evaluator changes from `T4:CCW` to `T1:CCW` to `T1:CW`, while strategic remains on `T4:CCW`. At 50M the two evaluators therefore disagree on the responder's root move even though they return the same scalar score.

## Paired full-game stress test

Each opening was forced, then six engine pairings played four games each while alternating which engine owned P0/P1. This produces 24 games per opening.

Engines:

- PVS material
- PVS strategic
- UCT-PB
- production-reference Trạng Nguyên

Per-move budgets were intentionally practical rather than solver-scale:

- PVS: 80k nodes, depth cap 12, 800 ms
- UCT-PB: 10k simulations, rollout depth 20, 800 ms
- Trạng Nguyên reference: 80k nodes, 800 ms
- maximum game length: 160 moves

### `B3:CW`

| Pair | A wins | B wins | P0 wins | P1 wins | Draws | Unresolved |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| material vs strategic | 2 | 0 | 0 | 2 | 2 | 0 |
| material vs Trạng Nguyên | 0 | 4 | 2 | 2 | 0 | 0 |
| material vs UCT-PB | 0 | 4 | 2 | 2 | 0 | 0 |
| strategic vs Trạng Nguyên | 0 | 4 | 2 | 2 | 0 | 0 |
| strategic vs UCT-PB | 1 | 2 | 3 | 0 | 1 | 0 |
| UCT-PB vs Trạng Nguyên | 4 | 0 | 2 | 2 | 0 | 0 |

Combined seat result:

- P0: **11**
- P1: **10**
- draws: **3**
- unresolved: **0**

### `B3:CCW`

| Pair | A wins | B wins | P0 wins | P1 wins | Draws | Unresolved |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| material vs strategic | 2 | 2 | 4 | 0 | 0 | 0 |
| material vs Trạng Nguyên | 0 | 4 | 2 | 2 | 0 | 0 |
| material vs UCT-PB | 0 | 4 | 2 | 2 | 0 | 0 |
| strategic vs Trạng Nguyên | 2 | 2 | 0 | 4 | 0 | 0 |
| strategic vs UCT-PB | 0 | 4 | 2 | 2 | 0 | 0 |
| UCT-PB vs Trạng Nguyên | 3 | 1 | 1 | 3 | 0 | 0 |

Combined seat result:

- P0: **11**
- P1: **13**
- draws: **0**
- unresolved: **0**

These are small paired stress tests, not confidence-interval-quality win-rate estimates. Engine-strength differences are large, so the aggregate seat totals are supporting evidence only.

## V3 conclusion

V3 strengthens the case for **`B3:CW` as the best current candidate neutral opening**, but it does not prove that `B3:CW` is balanced.

Why `B3:CW` remains candidate #1:

1. Both independent evaluations repeatedly keep its bounded value relatively close to zero as depth rises.
2. Both return the same `-30` at 50M nodes.
3. More importantly, responder root move `T1:CW` remains stable across all six 10M/25M/50M searches.
4. Its paired full-game seat aggregate is 11 P0 wins, 10 P1 wins and 3 draws across the deliberately mixed engine matrix.

`B3:CCW` remains candidate #2. Its scalar scores are at least as close to zero at shallower budgets and also end at `-30`, but its responder root move is less stable and the two evaluation families still disagree on the 50M root reply.

Therefore the current evidence ranking is:

1. **`B3:CW` — strongest current candidate, still unproven**
2. **`B3:CCW` — viable secondary candidate, lower convergence confidence**

No production Balanced Opening Pool should be shipped from V3 alone.

## Recommended next phase

Blindly increasing bounded search from 50M to 100M or 500M nodes is now lower-value than improving proof strength. The next phase should become proof-oriented:

- build an exact/endgame solver for sufficiently reduced states
- seed exact subgame solving from deep principal variations, especially the stable `B3:CW -> T1:CW` response family
- propagate exact terminal/subgame values back into the bounded search when possible
- test whether the deep B3 principal variation itself stabilizes, not just the first reply
- run a larger paired full-game sample only after engine budgets are normalized enough to reduce the current strength confound

Until that work is done, use the wording **candidate neutral opening**, not **balanced opening** or **solved opening**.
