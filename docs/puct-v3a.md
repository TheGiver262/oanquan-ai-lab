# PUCT V3A — Tree Reuse + Score-Bounded Terminal Propagation

## Scope

PUCT V3A is research-only in `TheGiver262/oanquan-ai-lab`.

It is deliberately an ablation step before adding generalized proof-number (GPN) bias. The purpose is to isolate the effect of two structural changes that PUCT V2 does not have:

1. reuse the explored subtree when the real game reaches a previously searched state;
2. propagate exact terminal W/D/L bounds through solved children.

PUCT V3A does **not** claim to be GPN-PUCT yet.

## Baseline

The frozen direct baseline is PUCT V2 with:

- `c_puct = 1.5`
- heuristic-policy temperature `0.6`
- root noise disabled
- heuristic value leaf evaluation

The earlier `2.5 / 0.6` candidate was not promoted because the diversified validation improved against some alpha-beta profiles but regressed against UCT-PB.

## V3A algorithm

`ReusableScoreBoundedPuct` keeps one search session per engine/player.

When a later real game state already exists in the retained subtree, that node is promoted to the new root and its visits/value statistics are preserved. Nodes outside the new root subtree are discarded from the lookup index.

Terminal positions have exact values from the engine player's perspective:

- win: `+1`
- draw: `0`
- loss: `-1`

Those exact outcomes are propagated conservatively:

- maximizing node is solved win if any child is solved win;
- minimizing node is solved loss if any child is solved loss;
- otherwise a node is solved only when every child is solved.

Selection avoids spending visits on a child already proven to be the worst possible result for the side to move while a potentially better child remains.

## Cycle safety

The current classic Ô Ăn Quan graph is loopy. V3A therefore tracks strategic-state keys on every simulation path.

If a repeated strategic state is encountered:

- the simulation is cut;
- its heuristic value may update visit/value statistics;
- the repetition is **not** marked as win, draw or loss;
- no solved result is propagated from that cycle-cut simulation.

This preserves the V4 exact-endgame rule that current game rules do not define repetition adjudication.

## Evaluation change requested for V3

Thám Hoa is removed from the active benchmark set.

Bảng Nhãn also remains excluded because its known opponent move-ordering/selective-pruning bug contaminates strength conclusions.

The V3A benchmark has four jobs:

1. `PUCT V2 vs PUCT V2` — null-control mirror to expose residual seat/corpus bias;
2. `PUCT V3A vs PUCT V2` — primary direct ablation;
3. `PUCT V3A vs UCT-PB` — external MCTS-family check;
4. `PUCT V3A vs Trạng Nguyên` — strongest production-code reference currently retained, labeled `code-parity-no-live-learning-snapshot`.

Every selected forced position is played twice with engine ownership swapped between P0 and P1. The full reply corpus contains every legal P1 reply after `B3:CW` and `B3:CCW`.

Primary metrics remain:

- completed swapped-pair differential;
- favorable / neutral / unfavorable completed pairs;
- unresolved rate;
- P0/P1 win split;
- resolved score only as a secondary statistic.

V3 diagnostics additionally record:

- subtree reuse rate;
- visits inherited at reused roots;
- cycle cutoffs;
- roots exactly solved by terminal bound propagation.

## Current experiment

Workflow: `puct-v3a-strength`

Initial run configuration:

- reply corpus: enabled
- one swapped pair per forced position
- `100000` simulation cap per decision
- `c_puct = 1.5`
- policy temperature `0.6`
- PUCT/UCT-PB budget: `600 ms`
- Trạng Nguyên matchup: `1200 ms` each side
- max move cap: `160`
- seed: `20260911`

Any unresolved pairs are not converted into heuristic draws. They remain censored and should be replayed at a higher move cap after the primary run.

## Next gate

GPN-PUCT V3B should be implemented only if V3A is technically stable and its direct `V3A vs V2` result can be interpreted against the V2 mirror control.

The first GPN experiment should add a small proof-number bias sweep while freezing all V3A parameters. This avoids mixing tree-reuse gains, score-bound gains and GPN gains in one result.
