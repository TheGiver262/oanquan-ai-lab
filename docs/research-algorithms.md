# Research algorithms for Ô Ăn Quan

This lab compares algorithms that are meaningfully different from the production alpha-beta minimax pipeline.

## Round 1 candidates

### 1. MCTS-UCT

Vanilla Monte Carlo Tree Search using UCT selection. This provides a search family with very different failure modes from alpha-beta: it allocates simulations asymmetrically and estimates action values from sampled continuations instead of exhaustively minimizing a fixed-depth heuristic tree.

### 2. MCTS-UCT + progressive bias + heuristic rollout

Adds domain knowledge only as a decaying bias and rollout policy. Early visits are guided by immediate captures, refill safety, material, mobility and quan pressure; as visits grow, empirical MCTS statistics dominate.

This is the primary research challenger in the first tournament because the production AI already has a strong heuristic function that can be reused without turning the search back into minimax.

## Deferred candidates

- PVS / NegaScout: useful alpha-beta optimization, but too close to the current production family for the first independent-strength comparison.
- MTD(f): potentially efficient with a strong transposition table, but still fundamentally minimax/alpha-beta value search.
- Proof-number / DFPN: highly relevant for proving forced wins and opening/endgame solving; better suited to the later solver phase than a clock-limited general playing bot.
- PUCT with a learned policy/value network: promising later, but requires training data/model infrastructure and would not be a fair algorithm-only first comparison.

## Tournament protocol

The research agents are tested against a frozen reference copy of the current 2-player production logic for:

- Thám Hoa
- Bảng Nhãn
- Trạng Nguyên

Every pairing must be seat-balanced: equal games with the research AI as P0 and P1. Randomness is seeded. No boss outcome rewriting is allowed. The canonical standard ruleset and engine are used.

The first smoke tournament is intentionally small enough for CI. Larger statistically useful runs are performed by raising `--games` after correctness is verified.
