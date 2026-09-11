# PUCT V3B — Cycle-Safe PNMax / GPN Bias

## Status

PUCT V3B is an experimental branch on top of the frozen V3A baseline.

V3A remains the control. V3B changes only tree-selection bias; it does not change the heuristic evaluator, policy prior, final root move rule, bounded two-ply reroot strategy, or exact W/D/L propagation.

Active evaluation excludes Thám Hoa, Bảng Nhãn and PVS.

The current candidate for the 600 ms promotion gate is `Cpn=0.1`.

## Motivation

V3A established a stable memory-bounded PUCT baseline with real subtree reuse and conservative solved-outcome propagation. The next isolated question is whether proof-number information can steer limited search budget toward branches that are structurally easier to prove.

The design is inspired by Generalized Proof-Number MCTS (GPN-MCTS), but the published algorithm biases UCT. V3B is therefore explicitly an experimental **GPN-PUCT adaptation**, not a reproduction of the paper's exact selection formula.

## Per-player proof numbers

Each node stores one proof number for each player.

For player `p`:

- terminal win for `p`: `pn_p = 0`;
- terminal draw or loss for `p`: `pn_p = infinity`;
- unexpanded non-terminal frontier: `pn_p = 1`.

After expansion:

- if `p` is the player to move at the node, the node is an OR node for `p`:

  `pn_p(node) = min pn_p(child)`

- otherwise the node is an AND node for `p`:

  `pn_p(node) = sum pn_p(child)`

The sum is bounded at `Number.MAX_SAFE_INTEGER`; any infinite child makes the AND proof number infinite.

Tracking proof numbers per player is important because selection occurs for both sides. At an opponent node, the proof bias must describe what is easy for the opponent to prove, rather than always using the research engine's proof number.

## PNMax normalization

For the current player's proof numbers over candidate children, V3B computes:

`PNMax(i) = 0` when `pn(i) = infinity`.

Otherwise:

`PNMax(i) = 1 - (pn(i) - minFinite) / (1 + maxFinite - minFinite)`

Therefore a smaller finite proof number receives a larger bonus, while impossible/already-disproved wins receive zero.

## PUCT selection

V3A selection is:

`score = sign * Q + cpuct * P * sqrt(Nparent) / (1 + Nchild)`

V3B adds only:

`score = sign * Q + U_PUCT + Cpn * PNMax`

`Cpn=0` is a required ablation invariant. Under a fixed simulation budget, V3B must make the same selections as V3A. Unit tests compare the chosen move and root visit distribution directly.

The coarse sweep is:

`Cpn ∈ {0, 0.05, 0.1, 0.25, 0.5}`

`0.1` was included because PNMax around that scale performed strongly for Awari in the GPN-MCTS study, but no value was assumed transferable to Ô Ăn Quan.

## Cycle safety

Classic Ô Ăn Quan under the current engine rules has genuine strategic cycles because refill can move score back onto the board.

V3B keeps the V3A rule and strengthens proof handling:

- a repeated strategic key on the current simulation path is a cycle cutoff;
- the simulation may update empirical visits and Q statistics;
- it must not update exact solved outcomes;
- the cycle-closing child edge is marked `proofBlockedFromParent`;
- blocked edges are treated as `pn=infinity` when the parent recomputes proof numbers or PNMax selection bias;
- a blocked edge therefore receives zero PNMax bonus.

A repetition is never interpreted as a draw, win, loss, proof or disproof. The edge mask is deliberately conservative: after a later reroot it may withhold some useful proof information, but it cannot convert a strategic loop into false proof evidence.

This stronger mask was added after the first coarse sweep showed pathological high-bias behavior: `Cpn=0.25` and `0.5` produced roughly 19.9k and 35.0k research cycle cutoffs respectively because a cycle-closing frontier could still expose `pn=1` to PNMax. Those results are diagnostic only and are not valid promotion evidence.

## Tree reuse and memory

V3B inherits the final V3A memory strategy:

- no session-wide node map;
- the persistent engine searches only the old root plus descendants up to two plies when synchronizing the next real game state;
- once the root is replaced, unreachable siblings have no global references and can be garbage-collected.

The rejected global-index V3A prototype is not reused because it reached the Node heap limit during 600 ms strength runs.

## Cycle-safe 100 ms sweep

Run `34597910833`, commit `21499effdd20c470c6c74f4c6eb4e68cc099592e`.

Protocol:

- frozen V3A opponent;
- all 16 two-ply positions generated from every legal reply after `B3:CW` and `B3:CCW`;
- each position played twice with V3B/V3A ownership swapped between P0/P1;
- 100 ms per decision;
- 160-ply cap;
- no root noise;
- unresolved games remain censored.

Results:

| Cpn | W-L-D-U | resolved score | completed pairs | mean pair diff | favorable / neutral / unfavorable | research cycle cutoffs | sims/decision | ms/sim |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 13-13-6-0 | 50.00% | 16 | 0.0000 | 0 / 16 / 0 | 2,026 | 4,044.5 | 0.01742 |
| 0.05 | 14-13-5-0 | 51.56% | 16 | +0.0625 | 1 / 15 / 0 | 994 | 3,395.0 | 0.01662 |
| 0.10 | 15-13-4-0 | 53.13% | 16 | +0.1250 | 1 / 15 / 0 | 626 | 2,980.0 | 0.01917 |
| 0.25 | 15-13-4-0 | 53.13% | 16 | +0.1250 | 1 / 15 / 0 | 745 | 2,893.3 | 0.01984 |
| 0.50 | 14-14-4-0 | 50.00% | 16 | 0.0000 | 0 / 16 / 0 | 1,314 | 2,759.1 | 0.02047 |

The only differentiating position in this sweep is `B3:CCW>T4:CCW`:

- `Cpn=0.05`: pair differential `+1`;
- `Cpn=0.10`: `+2`;
- `Cpn=0.25`: `+2`;
- `Cpn=0.50`: `0`.

This is too concentrated to establish superiority, but it is enough to choose a promotion candidate. `Cpn=0.1` is preferred over `0.25` because both produced the same paired advantage while `0.1` had fewer cycle cutoffs and slightly better throughput.

`Cpn=0` is an important overhead control. Fixed-simulation tests prove V3B with zero proof bias follows the same selections as V3A, but under wall-clock budgeting V3B still performs fewer simulations because proof-number bookkeeping is extra work. The 600 ms gate therefore includes both `Cpn=0` and `Cpn=0.1` against the same frozen V3A baseline.

## Evaluation protocol

Primary comparison: **V3B vs frozen V3A**.

Every forced position is played twice with engine ownership swapped between P0 and P1. Primary statistic is swapped-pair point differential; raw W/L is secondary because the game corpus has strong first-seat bias.

After choosing `Cpn=0.1`, the promotion gate uses 600 ms per decision and multiple independent runs against V3A. `Cpn=0` is run alongside it as an overhead/control ablation. Unresolved-heavy positions are replayed separately at 320/512 ply instead of being assigned heuristic draws.

## Promotion rule

V3B is not promoted merely because raw score exceeds 50% in one run.

Promotion requires:

1. no material negative paired signal versus V3A;
2. positive paired signal that survives repeated runs better than the zero-bias/control behavior;
3. acceptable wall-clock overhead from maintaining proof numbers;
4. no memory regression or cycle-related false solving;
5. unresolved positions remain censored rather than heuristically adjudicated.
