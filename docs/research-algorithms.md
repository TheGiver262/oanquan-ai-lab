# Research algorithms for Ô Ăn Quan

This lab compares search families that are meaningfully different from the production alpha-beta/minimax pipeline.

## Active candidates

### 1. MCTS-UCT

Vanilla Monte Carlo Tree Search using UCT selection. It allocates simulations asymmetrically and estimates action values from sampled continuations instead of exhaustively minimizing a fixed-depth heuristic tree.

### 2. MCTS-UCT + progressive bias + heuristic rollout (`uct-pb`)

Adds domain knowledge as a decaying bias and rollout policy. Early visits are guided by immediate captures, refill safety, material and mobility; as visits grow, empirical MCTS statistics dominate.

UCT-PB remains the strongest independent MCTS baseline from the first research round.

### 3. PUCT with heuristic policy/value (`puct-hv`)

PUCT replaces the UCT exploration bonus with a policy-prior-weighted term:

```text
score(child) = Q(child) + c_puct * P(child) * sqrt(N(parent)) / (1 + N(child))
```

For the first Ô Ăn Quan PUCT experiment there is deliberately **no neural network**:

- `P(child)` is a normalized softmax prior derived from the existing one-ply Ô Ăn Quan heuristic.
- Leaf value is the same bounded heuristic in `[-1, 1]`, with terminal win/draw/loss mapped to `+1/0/-1`.
- No Dirichlet root noise is used during evaluation.
- Initial parameters are `c_puct = 1.5` and policy temperature `0.35`.

This isolates the search-allocation effect of PUCT before introducing training-data or model-quality confounders. A learned policy/value network can be evaluated later as a separate phase if heuristic PUCT shows enough promise.

## Exact / proof-oriented work

- Exact reduced-state endgame search remains active as an oracle/hybrid component.
- Retrograde/tablebase work remains relevant once reduced-state enumeration becomes practical.
- Proof-number / DFPN remains a possible specialized solver for forced subgames rather than the default clock-limited playing bot.

## PVS / NegaScout status — retired from active research

PVS / NegaScout is no longer an active candidate and must not be included in future strength tournaments, algorithm scorecards, hybrid-roadmap recommendations or new experiments.

Existing PVS source files and historical result documents may remain in the repository only to reproduce already-recorded research. They are archival evidence, not a candidate for further development.

Reason: PVS is fundamentally an alpha-beta/minimax optimization family and is too close to the production search lineage to add the independent algorithm diversity now required by this lab.

## Tournament protocol

The active research agents are tested against:

- UCT-PB as the strongest independent MCTS baseline.
- The frozen server-production references for Thám Hoa, Bảng Nhãn and Trạng Nguyên.

Every pairing must be seat-balanced: equal games with the research AI as P0 and P1. Randomness is seeded where applicable. No boss outcome rewriting is allowed. The canonical standard ruleset and engine are used.

For maximum-strength Thám Hoa/Bảng Nhãn comparisons, use `production-max` so intentional mistake rates do not contaminate the result. Trạng Nguyên comparisons without a matching deployed learning snapshot must retain the `code-parity-no-live-learning-snapshot` caveat.

Small two- or six-game matrices are smoke tests only. Claims about superiority require larger paired-seat runs and uncertainty estimates.
