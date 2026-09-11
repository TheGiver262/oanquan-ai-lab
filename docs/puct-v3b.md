# PUCT V3B — Cycle-Safe PNMax / GPN Bias

## Status

**PUCT V3B is not promoted. V3A remains the active baseline.**

V3B is retained as an experimental research result on top of frozen V3A. It changes only tree-selection bias: heuristic evaluation, one-ply policy prior, final root move rule, bounded two-ply rerooting and exact W/D/L propagation remain inherited from V3A.

Active evaluation excludes Thám Hoa, Bảng Nhãn and PVS.

The 100 ms sweep produced a small positive signal for `Cpn=0.1`, but the 600 ms promotion gate did not reproduce a positive paired advantage. More importantly, one 600 ms replicate exposed a severe cycle-cutoff pathology. The promotion criteria are therefore not met.

## Motivation

V3A established a memory-bounded PUCT baseline with real subtree reuse and conservative solved-outcome propagation. V3B asks one isolated question: can generalized proof-number information steer limited search budget toward branches that are structurally easier to prove?

The design is inspired by Generalized Proof-Number MCTS (GPN-MCTS), but the published algorithm biases UCT. V3B is therefore an experimental **GPN-PUCT adaptation**, not a reproduction of the paper's exact selection formula.

## Per-player proof numbers

Each node stores one proof number for each player.

For player `p`:

- terminal win for `p`: `pn_p = 0`;
- terminal draw or loss for `p`: `pn_p = infinity`;
- unexpanded non-terminal frontier: `pn_p = 1`.

After expansion:

- if `p` is the player to move, the node is an OR node:
  `pn_p(node) = min pn_p(child)`;
- otherwise it is an AND node:
  `pn_p(node) = sum pn_p(child)`.

The sum is bounded at `Number.MAX_SAFE_INTEGER`; any infinite child makes the AND proof number infinite.

Proof numbers are tracked per player because search selection occurs for both sides. At an opponent node, proof bias must describe what is easy for the opponent to prove, rather than always using the research engine's proof number.

## PNMax normalization and PUCT selection

For candidate children of the current player:

`PNMax(i) = 0` when `pn(i) = infinity`.

Otherwise:

`PNMax(i) = 1 - (pn(i) - minFinite) / (1 + maxFinite - minFinite)`

V3A selection is:

`score = sign * Q + cpuct * P * sqrt(Nparent) / (1 + Nchild)`

V3B adds only:

`score = sign * Q + U_PUCT + Cpn * PNMax`

`Cpn=0` is an ablation invariant. Under a fixed simulation budget, tests verify that V3B with zero proof bias chooses the same move and produces the same root visit distribution as V3A.

## Cycle safety

Classic Ô Ăn Quan under the current engine rules has genuine strategic cycles because refill can move score back onto the board.

V3B keeps V3A's empirical-cycle policy and strengthens proof handling:

- a repeated strategic key on the current simulation path is a cycle cutoff;
- the simulation may update empirical visits and Q statistics;
- it must not update exact solved outcomes;
- the cycle-closing child edge is marked `proofBlockedFromParent`;
- blocked edges are treated as `pn=infinity` by parent proof recomputation and PNMax normalization;
- a blocked edge receives zero PNMax bonus.

A repetition is never interpreted as a draw, win, loss, proof or disproof.

This mask was added after an earlier coarse sweep showed that high `Cpn` could accidentally reward cycle-closing frontier nodes. Those pre-mask results are diagnostic only and are not promotion evidence.

## Tree reuse and memory

V3B inherits V3A's bounded reuse design:

- no session-wide node map;
- next real-game synchronization searches only the old root plus descendants up to two plies;
- once rerooted, unreachable siblings have no global references and can be garbage-collected.

The rejected V3A global-index prototype is not reused because it reached the Node heap limit during 600 ms runs.

## Cycle-safe 100 ms sweep

Run `34597910833`, commit `21499effdd20c470c6c74f4c6eb4e68cc099592e`.

Protocol:

- frozen V3A opponent;
- all 16 two-ply positions from every legal reply after `B3:CW` and `B3:CCW`;
- each position played twice with V3B/V3A ownership swapped between P0/P1;
- 100 ms per decision;
- 160-ply cap;
- no root noise;
- unresolved games remain censored.

| Cpn | W-L-D-U | resolved score | completed pairs | mean pair diff | favorable / neutral / unfavorable | research cycle cutoffs | sims/decision | ms/sim |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 13-13-6-0 | 50.00% | 16 | 0.0000 | 0 / 16 / 0 | 2,026 | 4,044.5 | 0.01742 |
| 0.05 | 14-13-5-0 | 51.56% | 16 | +0.0625 | 1 / 15 / 0 | 994 | 3,395.0 | 0.01662 |
| 0.10 | 15-13-4-0 | 53.13% | 16 | +0.1250 | 1 / 15 / 0 | 626 | 2,980.0 | 0.01917 |
| 0.25 | 15-13-4-0 | 53.13% | 16 | +0.1250 | 1 / 15 / 0 | 745 | 2,893.3 | 0.01984 |
| 0.50 | 14-14-4-0 | 50.00% | 16 | 0.0000 | 0 / 16 / 0 | 1,314 | 2,759.1 | 0.02047 |

The signal was highly concentrated. `B3:CCW>T4:CCW` was the only differentiating position:

- `Cpn=0.05`: pair differential `+1`;
- `Cpn=0.10`: `+2`;
- `Cpn=0.25`: `+2`;
- `Cpn=0.50`: `0`.

`Cpn=0.1` was selected for the 600 ms gate because it matched the best paired result with fewer cycle cutoffs than `0.25`.

## 600 ms promotion gate

Run `34598257320`, commit `92631368562a5e9ec21a24258cdf7f4934998656`.

The matrix used four repeated wall-clock runs for both `Cpn=0` and `Cpn=0.1`. Values `20261001..20261004` are **replicate labels, not effective RNG seeds**: root noise is disabled and the current PUCT implementation does not consume this CLI `seed`. Run-to-run variation is therefore caused primarily by wall-clock timing changing the number of simulations completed before a decision deadline.

Aggregate result:

| Cpn | games | W-L-D-U | aggregate resolved score | completed pairs | favorable / neutral / unfavorable | research cycle cutoffs |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 128 | 54-54-17-3 | 50.00% | 62 | 0 / 62 / 0 | 41,993 |
| 0.10 | 128 | 56-55-16-1 | 50.39% | 63 | 0 / 63 / 0 | 7,246,099 |

The slight raw-score difference for `Cpn=0.1` is not paired evidence: every completed swapped pair for both configurations has differential `0`.

Per-replicate paired result:

- `Cpn=0`: 16, 16, 15 and 15 completed pairs; every completed pair was neutral.
- `Cpn=0.1`: 16, 16, 16 and 15 completed pairs; every completed pair was neutral.

Therefore the positive 100 ms signal did **not** survive at the intended 600 ms budget.

### Cycle-cutoff regression

The first three `Cpn=0.1` replicates had 4,277, 4,104 and 4,087 research cycle cutoffs. The fourth produced **7,233,631** cycle cutoffs and 11.3 million research simulations.

The cycle mask prevented these repetitions from becoming false proof evidence, so this is not a proof-correctness failure. It is still a serious search-hygiene regression: a legal wall-clock run can spend an extreme amount of search effort inside cycle-heavy trajectories.

That failure alone is sufficient to block promotion under the V3B gate.

## Targeted unresolved replay

Run `34599997122`, commit `7832c034a47f1b76518fc890d3b82b902a27310d`.

A dedicated harness replays only the censored two-ply prefixes, preserving P0/P1 ownership swapping and never heuristic-adjudicating a game at the move cap.

### `Cpn=0.1`, `B3:CW>T2:CW`

- 320-ply replay: both games resolved, V3B 1-1, pair differential `0`.
- 512-ply replay: identical result, pair differential `0`.
- P0 won both games; V3B won as P0 and lost as P1.

This censored gate game therefore does not hide a PNMax advantage.

### `Cpn=0`, `B3:CCW>T4:CCW`

- 320-ply replay: both games resolved, V3B lost both, pair differential `-2`; games ended at 242 and 225 plies.
- 512-ply replay: both games resolved, one win and one loss, pair differential `0`; both ended at 242 plies.

The 320 and 512 runs use the same nominal search configuration, and every game in both runs finished before 320 plies. The different second-game outcome therefore cannot be caused by the move cap. It is another direct example of wall-clock timing sensitivity: different simulation throughput changed a later move choice and sent the game down a different trajectory.

The 512 result is neutral, but the larger lesson is that this wall-clock benchmark should not be interpreted as deterministic game-theoretic evidence.

## Decision

**Reject V3B as a promotion candidate. Keep V3A as the baseline.**

Reasons:

1. The positive `+0.125` paired signal at 100 ms disappeared completely at 600 ms.
2. Across the 600 ms gate, every completed pair for both `Cpn=0` and `Cpn=0.1` was neutral.
3. `Cpn=0.1` exhibited a pathological 7.23M-cycle-cutoff replicate even after proof-cycle masking.
4. Targeted replay did not uncover a hidden positive pair for the censored `Cpn=0.1` position.
5. Wall-clock repeatability is materially sensitive to runtime throughput, so small raw-score differences must not be promoted as strength improvements.

V3B remains useful as a negative research result and as reusable infrastructure for future proof-number variants. It should not replace V3A in the active strength baseline.

## Follow-up research rule

Do not spend more runs tuning PNMax `Cpn` on the current opening corpus. The current corpus is too seat-biased and the 600 ms gate has already falsified the promotion hypothesis for this PNMax formulation.

If proof-number research continues, the next experiment should be isolated against V3A and should change one structural factor at a time, for example PNSum rather than another PNMax coefficient sweep. It should also use a more discriminating balanced midgame corpus and report fixed-simulation diagnostics alongside wall-clock strength results.

FPU remains a separate future experiment and must not be mixed into the first follow-up proof-number ablation.