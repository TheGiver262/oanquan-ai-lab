# PUCT V3B — Cycle-Safe PNMax / GPN Bias

## Status

PUCT V3B is an experimental branch on top of the frozen V3A baseline.

V3A remains the control. V3B changes only tree-selection bias; it does not change the heuristic evaluator, policy prior, final root move rule, bounded two-ply reroot strategy, or exact W/D/L propagation.

Active evaluation excludes Thám Hoa, Bảng Nhãn and PVS.

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

The initial sweep is:

`Cpn ∈ {0, 0.05, 0.1, 0.25, 0.5}`

`0.1` is included because PNMax around that scale performed strongly for Awari in the GPN-MCTS study, but no value is assumed transferable to Ô Ăn Quan.

## Cycle safety

Classic Ô Ăn Quan under the current engine rules has genuine strategic cycles because refill can move score back onto the board.

V3B keeps the V3A rule:

- a repeated strategic key on the current simulation path is a cycle cutoff;
- the simulation may update empirical visits and Q statistics;
- it must not update exact solved outcomes;
- it must not update proof numbers.

A repetition is therefore never interpreted as a draw, win, loss, proof or disproof.

This is intentionally conservative because production rules do not define repetition adjudication.

## Tree reuse and memory

V3B inherits the final V3A memory strategy:

- no session-wide node map;
- the persistent engine searches only the old root plus descendants up to two plies when synchronizing the next real game state;
- once the root is replaced, unreachable siblings have no global references and can be garbage-collected.

The rejected global-index V3A prototype is not reused because it reached the Node heap limit during 600 ms strength runs.

## Evaluation protocol

Primary comparison: **V3B vs frozen V3A**.

Every forced position is played twice with engine ownership swapped between P0 and P1. Primary statistic is swapped-pair point differential; raw W/L is secondary because the game corpus has strong first-seat bias.

Sweep protocol:

- all 16 two-ply prefixes generated from every legal reply after `B3:CW` and `B3:CCW`;
- 100 ms per decision for coarse `Cpn` ranking;
- max 160 moves;
- unresolved games stay unresolved and are excluded from paired differential.

After choosing a candidate `Cpn`, the promotion gate uses 600 ms per decision and multiple seeds/runs against V3A. Unresolved-heavy positions are replayed separately at 320/512 ply instead of being assigned heuristic draws.

## Promotion rule

V3B is not promoted merely because raw score exceeds 50% in one run.

Promotion requires:

1. no material negative paired signal versus V3A;
2. positive paired signal that survives repeated runs better than the V3A/V3A null-control noise level;
3. acceptable wall-clock overhead from maintaining proof numbers;
4. no memory regression or cycle-related false solving;
5. unresolved positions remain censored rather than heuristically adjudicated.
