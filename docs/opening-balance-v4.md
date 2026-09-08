# Opening Balance V4 — Exact Endgame and Cyclic Game-Graph Foundation

## Scope

Opening Balance V4 is research-only in `TheGiver262/oanquan-ai-lab`. Production repository `TheGiver262/O_an_quan` is not modified.

V4 follows V3's two finalists:

1. `B3:CW` — strongest current candidate neutral opening
2. `B3:CCW` — secondary candidate

The purpose of V4 is not to increase heuristic depth again. It asks whether reduced positions on the V3 principal-variation families can be solved exactly and, if not, why not.

## Exact solver foundation

V4 adds a conservative reduced-state solver with:

- exact terminal score margin as utility
- no heuristic leaf values
- memoization of solved states
- node/time limits
- a rule-relevant canonical strategic-state key
- explicit cycle detection

A repeated strategic position is **not** automatically treated as a draw. The current classic engine does not define a repetition outcome, so the only defensible result for such a branch is `cycle-unresolved`.

This distinction is important: a solver must not create a game rule merely to make the search tree finite.

## Exact PV probes

The probe replayed the four V3 50M principal-variation families and attempted exact solving from the deepest low-material states.

All four families encountered genuine repeated strategic states before exhausting the configured compute budget.

- no tested failure was caused by the 2,000,000-node limit
- no tested failure was caused by the 60-second limit
- `B3:CCW / material` already encountered the problem in a state with weighted board value only **8**
- other low-material B3 states also returned `cycle-unresolved`

Therefore the binding problem is structural, not simply insufficient compute.

## SCC-aware reachable-graph analysis

V4 then replaced tree-only reasoning with explicit reachable-graph analysis and Tarjan strongly connected components (SCCs).

Each probe expanded up to 100,000 unique rule-relevant strategic states from the deepest recorded V3 50M state.

| Opening | Evaluation | Root ply | Root board value | Root scores | Expanded | Edges | Terminal states | Cyclic SCCs | Largest cyclic SCC | Closed cyclic SCCs observed |
| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `B3:CW` | material | 20 | 13 | P0 28 / P1 29 | 26,133 | 117,558 | 58 | **18** | **8** | 0 |
| `B3:CW` | strategic | 17 | 29 | P0 9 / P1 32 | 27,483 | 122,519 | 157 | **69** | **18** | 0 |
| `B3:CCW` | material | 20 | 8 | P0 61 / P1 1 | 27,355 | 120,464 | 192 | **32** | **51** | 0 |
| `B3:CCW` | strategic | 21 | 11 | P0 27 / P1 32 | 26,038 | 119,529 | 56 | **36** | **10** | 0 |

All four graph explorations hit the 100,000-state cap, so `closed cyclic SCCs observed = 0` must **not** be read as proof that no closed cyclic class exists globally.

Several cyclic SCCs found inside the partial graphs were nevertheless fully expanded locally and had legal exits.

## Concrete two-ply cycle witnesses

The cycles are not merely large pathological graph structures. V4 found exact two-ply repetitions such as:

- `B4:CW -> T4:CCW`
- `T4:CCW -> B4:CW`
- `B2:CCW -> T2:CW`
- `T2:CW -> B2:CCW`

A representative sequence returns to the identical canonical strategic state — same pits, scores, side to move and ruleset — after two moves.

This is possible because refill can spend 5 score points to repopulate a player's side. Score therefore is not a monotone quantity: an intermediate move can move value from score back onto the board, and subsequent play can reconstruct the prior complete state.

## What V4 proves and does not prove

### Established by V4

1. The current two-player Ô Ăn Quan transition graph is genuinely **loopy**.
2. Exact repeated strategic states can occur even in very low-material endgames.
3. Simple recursive minimax/Negamax exact DFS is insufficient as a general exact solver unless repetition/nontermination semantics are defined or the loopy graph is solved explicitly.
4. Blindly raising node budgets is not the correct response to this limitation.
5. Repetition is now both an **algorithm problem** and a **competitive-mode design problem**.

### Not established by V4

- a cycle is not automatically a draw
- no opening is exactly solved
- no closed recurrent class has been ruled in or ruled out globally
- `B3:CW` is not proven balanced
- `B3:CCW` is not proven unbalanced
- the classic mode is not yet proven to require a new repetition rule in ordinary human play

## Implication for the final research objective

The final objective remains two separate decisions:

### A. Comprehensive AI/search stack

A robust engine must handle:

- deep tactical search
- stochastic/exploratory search where useful
- exact acyclic endgames
- loopy/repetition-sensitive subgames
- practical latency and memory limits

This makes a hybrid architecture more plausible than a single monolithic algorithm: e.g. PVS or MCTS for the general tree plus exact/retrograde knowledge for solved reduced subgames.

### B. Balanced competitive mode

A competitive mode must be evaluated not only for P0/P1 bias but also for termination behavior. A mode that is statistically seat-balanced but permits strategically exploitable infinite repetition is not a complete competitive design.

V5 should therefore test repetition policies explicitly rather than silently embedding one into the solver.

## V5 recommendation — repetition-policy experiment

Research-only candidate policies:

1. **No repetition adjudication** — current rules; cycles remain a separate nontermination outcome in exact analysis.
2. **Immediate repeated-position draw** — the second occurrence of the same full strategic position ends the game as a draw. Useful as an aggressive baseline, not a production recommendation.
3. **Threefold repetition draw** — the third occurrence of the same full strategic position ends the game as a draw. This is the main candidate to test because it prevents infinite cycling while allowing one repeat.
4. A hard maximum-ply safeguard may be evaluated operationally, but it should not replace a principled repetition rule in game-theoretic research.

For each policy, measure separately:

- whether reduced state graphs become finite/solvable
- exact values for the B3 finalist subgames
- repetition-trigger rate in strong-engine self-play
- effect on P0/P1 fairness
- effect on game length and draw rate
- whether a player can intentionally force repetition to save a lost position

Only after this should the strongest exact knowledge be integrated into PVS/UCT-PB and used in the broader mode tournament across standard, Cấm Quan, Quan ≥5, Pie/Swap and validated-opening protocols.

## Validation

V4 implementation validation includes:

- TypeScript typecheck
- exact-solver tests
- SCC/Tarjan tests
- V3 PVS regression tests
- build

Graph evidence run: `34187542518` at head `4597729398ce569b2a3d4c20216a49d4a9cc294d`.

Use the term **loopy game graph** for the V4 finding. Do not use **draw by repetition** unless a future ruleset explicitly defines it.
