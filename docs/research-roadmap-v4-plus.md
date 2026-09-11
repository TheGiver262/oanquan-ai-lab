# Research Roadmap V4+

## Final objective

The lab has two separate final decisions to make:

1. **Best comprehensive AI/search stack** for Ô Ăn Quan.
2. **Most balanced competitive game mode/ruleset** for two-player play.

These decisions must not be conflated. A weak engine can make an unfair mode look balanced, and a strong but style-specific engine can make a balanced mode look biased. Every future phase therefore measures algorithm strength and game balance on separate axes before combining them.

## Track A — comprehensive AI algorithm

Active families:

- production-reference iterative-deepening alpha-beta/minimax (frozen benchmark baseline)
- UCT-PB MCTS
- PUCT-HV: PUCT with Ô Ăn Quan heuristic policy priors and heuristic leaf values
- V4 exact endgame solver

PVS / NegaScout is retired from active research. Existing implementation/results are archival only and must not be used in future candidate comparisons or new hybrid work.

Planned composite engines:

- **PUCT-HV + exact endgame oracle**
- **UCT-PB + exact endgame oracle**
- optionally the frozen production alpha-beta family + exact oracle as a control comparison
- optional proof-oriented/DFPN component for forced subgames if the game graph warrants it
- optional retrograde/tablebase component once reduced-state enumeration is practical

A learned policy/value PUCT variant is a later optional extension. It is not required to evaluate whether PUCT's prior-guided tree allocation is useful for Ô Ăn Quan.

### Algorithm scorecard

Every candidate engine should eventually be evaluated on:

- head-to-head score against a fixed reference pool
- paired-seat score with P0/P1 alternation
- Elo or equivalent rating with confidence intervals
- node/simulation efficiency
- wall-clock efficiency
- peak memory / tree or transposition-table pressure
- deterministic reproducibility where applicable
- exact-endgame hit rate
- tactical error/regret against exact solved subgames
- root-move stability as budget increases
- robustness across `standard_v1`, `no_first_quan_v1`, and `mature_quan_v1`
- robustness across opening protocols rather than only the initial standard position

A final production AI should not merely have the highest raw win rate. It should have a good strength/latency/memory trade-off and should not depend on a narrow opening exploit.

## Track B — balanced competitive mode

Balance candidates to test independently of engine identity:

1. unrestricted classic standard opening
2. forced `B3:CW`
3. forced `B3:CCW`
4. exact-validated Balanced Opening Pool
5. Pie Rule / swap-after-opening
6. Swap2-inspired opening protocol if Pie remains exploitable
7. BO2/paired format with alternating first player
8. `no_first_quan_v1` / **Cấm Quan**
9. `mature_quan_v1` / **Quan ≥5**
10. combinations of an opening protocol with a ruleset only when each component has already been measured independently

### Balance scorecard

For each mode/ruleset, measure:

- exact or best-bounded initial game value
- P0/P1 win and score rate with confidence intervals
- paired-seat score
- opening-by-opening minimax value
- best guaranteed opener EV
- opening entropy / concentration
- responder reply concentration
- draw/repetition/unresolved rate
- game length distribution
- comeback potential / score-margin distribution
- engine-consensus: do independent strong algorithms agree on the sign and best reply?
- human-data fairness later, once enough real PvP games exist

No mode is called **balanced** from a small self-play sample alone.

## V4 — exact endgame foundation

V4 adds a conservative exact reduced-state solver:

- no heuristic leaves
- exact final score margin as utility
- rule-relevant canonical strategic state key
- memoization of solved states
- explicit node/time budgets
- cycle detection
- cycles remain unresolved because the current game rules do not define repetition as a draw

The first probes start from the deepest states on the recorded V3 principal variations for the main opening candidates. Historical PVS-generated corpora may be retained as archived input data, but no new PVS search is run.

V4 success criteria:

- CI correctness
- terminal and reduced-state exactness tests
- identify the first practical board-value frontier where exact solving succeeds reliably
- obtain exact values for at least some states on a principal-variation family, or produce a quantified reason why the current solver is insufficient

## V5 — PUCT and hybrid search

First establish PUCT-HV as an independent clock-limited player:

- tune `c_puct` and policy temperature on a training/tuning corpus that is separate from the final evaluation seeds
- compare PUCT-HV directly with UCT-PB at equal wall-clock budgets
- compare PUCT-HV with Thám Hoa, Bảng Nhãn and Trạng Nguyên server-production references with seats alternated
- report P0/P1 splits, unresolved games and confidence intervals before strength claims

After the exact frontier is measured, build two primary hybrids:

- PUCT-HV + exact oracle
- UCT-PB + exact oracle

Use the same solved-state corpus to measure tactical regret and exact-hit rate. This phase begins answering which algorithm is the best **comprehensive** player rather than merely the best opening-search tool.

## V6 — proof/database escalation

If exact DFS cannot move the frontier far enough:

- construct reduced endgame databases by retrograde analysis where state enumeration is tractable
- explicitly handle strongly connected components/cycles instead of declaring them draws
- evaluate proof-number/DFPN only for subproblems that can be expressed as useful win/loss/draw proof targets
- feed exact database/proof results into the hybrid search stack

The goal is to increase the fraction of the tree backed by exact knowledge rather than endlessly raising heuristic depth.

## V7 — mode tournament

Run the strongest independent engine pool across the balance candidates. Use paired-seat designs and opening/ruleset stratification. A candidate mode advances only if multiple strong algorithms agree that first-player exploitability is small.

## V8 — production recommendation

The final recommendation will contain two explicit choices:

### AI stack

For example: `PUCT-HV + exact tablebase`, `UCT-PB + exact tablebase`, or another active stack if experiments beat them.

### Competitive mode

For example: classic rules + validated opening protocol, or an extended ruleset if it is measurably fairer without unacceptable gameplay cost.

The two choices are then regression-tested together before anything is proposed for `O_an_quan` production.

## Evidence language

Use these labels consistently:

- **heuristic signal** — bounded or heuristic search only
- **candidate neutral opening** — multiple bounded signals support near-neutrality
- **exact solved state** — all required descendants resolved to terminal values under the implemented rules
- **balanced candidate mode** — statistical and/or bounded evidence, not proof
- **balanced mode** — reserved for evidence strong enough to justify a production fairness claim
- **game solved** — reserved for an actual game-theoretic solve under an explicit ruleset and opening protocol
