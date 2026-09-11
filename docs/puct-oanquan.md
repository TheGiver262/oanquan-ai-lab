# PUCT for Ô Ăn Quan — first research design

## Research question

Can PUCT allocate a fixed thinking-time budget more effectively than UCT-PB on Ô Ăn Quan, without requiring a trained neural network?

The first implementation is named `puct-hv` (**PUCT — heuristic policy/value**). It is intentionally a search experiment, not an AlphaZero claim.

## Why PUCT is plausible here

A normal position has at most ten legal actions: five owned dân pits times two sowing directions. The action count is small, but a move can trigger long sow/pickup/capture chains and full games can have long tactical horizons.

UCT gives every underexplored action an exploration bonus that depends mainly on visit counts. PUCT additionally weights exploration by a policy prior `P`, allowing the tree to spend more visits early on moves that domain knowledge considers promising while still letting repeated search statistics override a weak prior.

## Selection rule

At a node, `puct-hv` selects the child maximizing:

```text
Q + c_puct * P * sqrt(N_parent) / (1 + N_child)
```

where:

- `Q` is the child's empirical mean value from the root player's perspective.
- `P` is the policy prior for that move.
- `N_parent` and `N_child` are visit counts.
- `c_puct` controls exploration pressure.

Because values are stored from one fixed root-player perspective, selection multiplies `Q` by `+1` on the root player's turn and `-1` on the opponent's turn.

Initial tuning point:

```text
c_puct = 1.5
policy_temperature = 0.35
```

These are starting parameters, not claimed optima.

## Policy prior without a neural network

For every legal move, the engine applies that move once and evaluates the resulting state with the same bounded Ô Ăn Quan heuristic already used by the MCTS research baseline.

The heuristic contains:

- captured-score differential
- dân remaining on each player's side
- mobility / count of playable pits
- refill safety

The one-ply values are converted to a probability distribution with softmax. At an opponent node, the sign is reversed before softmax so the prior favors actions that look good for the side actually moving.

This makes `P` deterministic for a state and removes model-training quality as a confounder.

## Leaf value

`puct-hv` does not run random rollout playouts. When a selected leaf is reached, its value is:

- `+1` if terminal and root player won
- `0` if terminal draw
- `-1` if terminal and root player lost
- otherwise the bounded domain heuristic in `[-1, 1]`

This makes each simulation much cheaper than a 20-ply UCT-PB rollout, potentially allowing PUCT to grow a deeper/wider explicit tree within the same wall-clock budget.

## Evaluation settings

Evaluation mode intentionally disables root Dirichlet noise. Noise is useful for self-play data diversity, but it makes deterministic strength comparison harder and is unnecessary for a fixed evaluation tournament.

All strength comparisons must:

1. use the canonical engine and standard ruleset;
2. alternate P0/P1 evenly;
3. use equal wall-clock budgets within a pairing;
4. report unresolved games rather than silently converting them to draws;
5. report seat splits because prior work found a substantial P0/opening effect;
6. use `production-max` for Thám Hoa/Bảng Nhãn when measuring maximum search strength;
7. retain the Trạng Nguyên learning-snapshot caveat when no deployed snapshot is supplied.

## Opponent pool

Active comparison pool:

- UCT-PB
- Thám Hoa server-production reference
- Bảng Nhãn server-production reference
- Trạng Nguyên server-production reference

PVS / NegaScout is excluded from current and future research comparisons. Historical PVS files may remain solely for reproducibility of already-recorded results.

## Known interpretation hazards

### First-player effect

Previous seat-balanced experiments often showed P0 winning regardless of algorithm identity. Aggregate W/L alone is therefore insufficient; PUCT must be examined separately as P0 and P1.

### Bảng Nhãn baseline defect

The frozen production Bảng Nhãn baseline has a documented opponent-ordering/selective-pruning defect. A PUCT win over that frozen baseline is useful as a compatibility measurement but is not, by itself, proof that PUCT is stronger than a corrected alpha-beta implementation.

### Trạng Nguyên learning

Without the deployed learning-memory snapshot, Trạng Nguyên comparisons are code-parity search comparisons but not complete live-learning-strength comparisons.

## Next tuning stage

If the smoke tests are correct, tune at least:

- `c_puct`: e.g. `0.5, 1.0, 1.5, 2.0, 3.0`
- policy temperature: e.g. `0.15, 0.25, 0.35, 0.5, 0.8`
- optional value mixing between raw heuristic leaf value and short tactical rollout

Tuning seeds/states must be separated from final evaluation seeds to avoid optimizing directly on the tournament set.

Only after parameter tuning should the lab run larger paired-seat tournaments and compute confidence intervals/Elo-like estimates.
