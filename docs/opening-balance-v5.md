# Opening Balance V5 — Repetition Policy Study

## Scope

V5 is research-only in `TheGiver262/oanquan-ai-lab`. It does **not** modify the production repository `TheGiver262/O_an_quan`.

V4 established that reachable reduced positions can contain genuine strategic-state cycles. V5 therefore asks a narrower rules question before any further opening-balance claim:

> If repetition is explicitly adjudicated as a draw, does that make the game/search finite enough to study safely, and does the rule itself create an exploitable draw-escape mechanic?

The two tested policies are:

- **repeat-2**: draw on the second occurrence of the same strategic state.
- **repeat-3 / threefold**: draw on the third occurrence of the same strategic state.

A separate max-ply draw exists only as an operational fallback experiment. It is not treated as the preferred gameplay rule.

The repeated-state identity is the V4 exact strategic key: board contents, scores, side to move, ruleset-relevant state, and other engine state that changes future legal play. Move-history cosmetics are not part of identity.

## Implementation work

V5 added:

- explicit repetition-policy state and adjudication
- exact policy-aware reduced-state solver
- policy-blind full-game repetition observer
- repetition-aware PVS search
- deterministic and stochastic policy-aware self-play benchmarks
- max-ply root-history regression coverage

### Solver failures discovered and fixed

The first policy-exact implementation failed for engineering reasons rather than game-theoretic reasons:

1. recursive DFS could exceed the Node.js call stack on very deep cyclic paths;
2. copying/stringifying the entire repetition history per node could exceed the ~4 GB runner heap.

The solver was rewritten to use:

- explicit-stack DFS
- one mutable occurrence map for the current DFS path
- rollback on child return
- alpha-beta cutoffs
- no repetition-history transposition-table shortcut that would conflate identical boards reached with different repetition histories

After this rewrite, the validation gate and all eight policy-exact matrix jobs completed successfully without stack or heap failure.

## Policy-exact matrix

Workflow run: `34189201268`.

Matrix:

- openings: `B3:CW`, `B3:CCW`
- PV families: material, strategic
- policies: repeat-2, repeat-3
- 2,000,000 nodes per job
- 60 s cap
- maximum accepted root board value: 30; benchmark probes reduced V3 PV states from low material upward

Result:

- **0/8 matrix roots were fully exact-solved inside the 2M-node budget.**
- all eight jobs exited cleanly with budget exhaustion rather than runtime failure.
- repeat-2 required materially shorter proof/search paths than repeat-3 in the observed jobs.
- observed maximum path depth was roughly 24k–47k plies for repeat-2 and 36k–81k for repeat-3.

Across the four 2M-node jobs for each policy, policy-draw leaves were of similar order of magnitude. The main computational difference was therefore not simply the number of draw leaves; repeat-3 permits much longer cyclic paths before adjudication and substantially increases proof depth.

This is useful engineering evidence but **not** a game-theoretic result for the opening. Even with repetition made finite by rule, the reduced state space is still large enough that a naive exact DFS is not a practical whole-opening solver.

## Policy-blind full-game observation

Workflow run: `34189087247`.

Three engine pairings were tested on both B3 opening candidates, four games per pairing, alternating seats:

- PVS strategic vs production-reference Trạng Nguyên
- PVS strategic vs UCT-PB
- UCT-PB vs production-reference Trạng Nguyên

Total: **24 games**.

Repetition adjudication was disabled. An external observer counted full strategic-state occurrences only.

Result:

- games reaching a second occurrence: **0/24**
- games reaching a third occurrence: **0/24**

Thus ordinary bounded self-play from these two openings did not naturally cycle in this small sample.

The seat outcome in this low-budget observer was strongly P1-heavy, so this run must **not** be used as opening-fairness evidence. Its purpose is only natural repetition incidence.

## Policy-aware deterministic smoke

Workflow run: `34189713864`.

V5 then made PVS genuinely aware of the draw rule inside its search tree. The actual match was also adjudicated under the tested policy.

The smoke matrix produced one notable threefold draw:

- opening: `B3:CCW`
- aware-strategic PVS: P0
- blind-strategic PVS: P1
- draw at ply 27
- captured-score state at the trigger: approximately `27–28`

This demonstrated that an explicit draw rule can become part of an agent's tactical search. It did **not** prove that the aware player had escaped a forced loss; the position was only down one captured point and the benchmark is bounded.

A later 12-game deterministic targeted workflow (`34189972105`) was deliberately **not** treated as 12 independent samples. Deterministic engines, fixed opening and fixed seat assignment repeat the same trajectories, so replay count does not create statistical independence.

## Stochastic exploitability matrix

Workflow run: `34190152471` at benchmark commit `e8c11cd78eb8c1e2c0081ff799ccf809625071ef`.

This is the main V5 behavioral result.

Pairing:

- repetition-aware strategic PVS
- stochastic policy-blind UCT-PB
- seats alternate every game
- a distinct seeded UCT-PB RNG stream is used for every game

Budgets:

- PVS: 30k nodes, depth cap 12, 300 ms/move
- UCT-PB: 4k simulations, 300 ms/move
- max game length: 240 moves

Each cell contains 20 games, for **80 total games**.

### Raw results

| Opening | Policy | Aware wins | UCT-PB wins | Natural draws | Repetition draws | P0 wins | P1 wins | Avg moves |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `B3:CW` | repeat-2 | 5 | 12 | 2 | **1** | 5 | 12 | 47.65 |
| `B3:CCW` | repeat-2 | 6 | 11 | 3 | **0** | 6 | 11 | 39.05 |
| `B3:CW` | repeat-3 | 6 | 12 | 2 | **0** | 3 | 15 | 56.50 |
| `B3:CCW` | repeat-3 | 3 | 15 | 2 | **0** | 11 | 7 | 49.40 |

Combined by policy:

### repeat-2 — 40 games

- aware wins: 11
- UCT-PB wins: 23
- natural draws: 5
- repetition draws: **1**
- unresolved: 0
- repetition draw rate: **2.5%**
- aware-triggered repetition draws: **0**
- UCT-PB-triggered repetition draws: **1**

The only repeat-2 draw occurred in `B3:CW`, game 6:

- UCT-PB was P0
- aware PVS was P1
- repetition triggered at move 37
- captured scores were `P0=10`, `P1=56`
- the triggering side was therefore trailing by **46 points**
- the triggering UCT-PB agent was policy-blind; it did not search for the draw rule

This is an important game-design failure mode: a second-occurrence rule can rescue a catastrophically losing side even **without** intentional draw-seeking behavior.

### repeat-3 — 40 games

- aware wins: 9
- UCT-PB wins: 27
- natural draws: 4
- repetition draws: **0**
- unresolved: 0
- aware-triggered repetition draws: **0**
- UCT-PB-triggered repetition draws: **0**

No threefold draw occurred in this 40-game stochastic sample.

The raw W/L values primarily reflect the configured engine strengths and seat/opening interactions. They are not used to rank repeat-2 versus repeat-3. V5's comparison criterion is draw incidence and trigger attribution.

## V5 conclusions

### 1. Repetition is not the primary opening-balance mechanism

Across the policy-blind 24-game observer, no strategic state repeated even twice. Across the 80-game stochastic policy-aware matrix, only one repetition adjudication occurred.

Therefore repetition does not appear common enough in these samples to be the main source of P0/P1 imbalance.

Opening fairness should continue to be addressed through opening protocol/search evidence, not by hoping that a repetition rule neutralizes seat advantage.

### 2. Repeat-2 is rejected as the preferred gameplay rule

Repeat-2 is computationally cheaper than repeat-3, but it is also more intrusive. V5 produced a concrete undesirable behavior: a policy-blind player down 46 captured points received a draw on the second occurrence.

That is too permissive for a competitive rule unless a much stronger justification emerges.

### 3. Threefold is the current repetition-rule candidate, but not yet a production recommendation

Threefold:

- did not fire in the 40-game stochastic sample;
- did not fire in the policy-blind 24-game observer;
- is less intrusive than repeat-2;
- still guarantees that a deliberately repeated cycle terminates after a bounded number of returns.

However, V5 has only stress-test evidence. It has not proven that a strong policy-aware agent cannot construct a threefold draw from a losing position in other states.

So the correct wording is:

> **threefold is the current research candidate for cycle termination, not a production-approved fairness rule.**

### 4. Exact search must become hybrid/graph-oriented

Making repetition finite did not make naive exact DFS cheap enough. Even reduced low-material V3 PV roots exhausted 2M nodes.

The next solver should not blindly exact-search every descendant. It should combine:

- bounded PVS / UCT-PB for the large state space;
- exact oracle probes only in states where exact solving is tractable;
- cached exact W/D/L or score-margin values when solved;
- SCC/graph information for cyclic reduced regions;
- proof-status propagation that never labels heuristic values as exact.

## V5 decision

For subsequent research:

- **do not use repeat-2 as the default candidate**;
- carry **threefold** as the explicit cycle-termination candidate;
- retain max-ply only as an operational watchdog/fallback experiment;
- move opening fairness work back to Balanced Opening / Pie / Swap / Swap2 and hybrid exact-oracle search;
- keep all repetition-aware benchmark results separated from current production rules until a production rule change is explicitly approved.

No production code or rules are changed by V5.
