# V3C root alpha-beta verifier rejection — 2026-09-24

## Verdict

**REJECT / CLOSE V3C. V3B.1 PNSum Cpn=2.0 remains the canonical Quan Gia + Threefold incumbent.**

V3C kept the full V3B.1 MCTS search unchanged and added a post-search tactical
verifier:
- take the two highest-ranked root moves from V3B.1;
- run a full-width depth-3 alpha-beta search from each child state;
- choose the move with the better verifier score;
- preserve V3B.1 ordering on score ties.

The hypothesis failed decisively at the primary Quan Gia 5k gate.

## Why this was a distinct experiment

Earlier failed minimax-guidance families altered the search itself:
- V3A.4 blended implicit minimax values into PUCT selection;
- V3A.5 decayed that selection bias by visits;
- V4 changed heuristic leaf values via selective one-ply bootstrap.

V3C deliberately avoided those mechanisms.

V3B.1 still performed:
- the same PUCT selection;
- the same PNSum Cpn=2.0 proof guidance;
- the same V3A.2 positive-only material36 evaluation;
- the same backups;
- the same subtree reuse;
- the same exact W/D/L propagation;
- the same visit-based root ranking.

Only final root move selection could be overridden after the MCTS search had
completed.

## Alpha-beta verifier

Frozen implementation:
- top-K root candidates: **2**
- alpha-beta depth: **3 plies from the root-child state**
- full-width BalanceState legal actions
- ordinary max/min alpha-beta pruning
- maximizing/minimizing by `currentAgent(state)`
- no PVS/NegaScout
- no transposition table
- no proof-number logic inside the verifier

Leaf evaluation:
- same V3A.2 positive-only material36 static heuristic
- terminal win = +2
- terminal draw = 0
- terminal loss = -2

This ensured forced terminal W/D/L inside the verifier dominated any unresolved
heuristic leaf in [-1,+1].

## Correctness gates

Before strength testing:
- verifier-disabled V3C matched V3B.1 root action and root statistics exactly;
- terminal W/D/L scores were verified;
- max/min alternation followed current research-agent ownership rather than ply
  parity;
- verifier considered only the top two incumbent root moves;
- verifier score ties preserved incumbent order;
- root statistics were unchanged by verification;
- returned moves were legal;
- typecheck, tests and build passed.

## Quan Gia 5k gate

Protocol:
- candidate: V3C V3B.1 + root alpha-beta verifier
- incumbent: V3B.1 PNSum Cpn=2.0
- mode: `quan-gia-threefold`
- 5,000 fixed MCTS simulations per decision
- all 10 canonical openings
- candidate once as opener and once as responder
- maxBoardMoves=200
- unresolved games censored

Aggregate:
- candidate: **2W-0D-18L**
- pairs: **0 favorable / 2 neutral / 8 unfavorable / 0 unresolved**

Neutral:
- `B3:CW`: 1W-0D-1L
- `B3:CCW`: 1W-0D-1L

Unfavorable:
- `B1:CW`: 0W-0D-2L
- `B1:CCW`: 0W-0D-2L
- `B2:CW`: 0W-0D-2L
- `B2:CCW`: 0W-0D-2L
- `B4:CW`: 0W-0D-2L
- `B4:CCW`: 0W-0D-2L
- `B5:CW`: 0W-0D-2L
- `B5:CCW`: 0W-0D-2L

No favorable pair.
No unresolved game.

## Targeted confirmation

`B5:CW` was rerun independently with the identical settings.

Result:
- **0W-0D-2L**
- unfavorable pair reproduced exactly

This satisfies the preregistered rejection condition.

## Compute overhead

Across the 20-game 5k gate, candidate-side verification performed:
- **59,146 additional alpha-beta nodes**
- across **328 candidate decisions**
- mean: **180.32 alpha-beta nodes per candidate decision**
- verifier overrides: **94**
- override rate: **28.66%**

The overhead itself was modest in node-count terms relative to 5,000 MCTS
simulations per decision, but the verifier intervened far too frequently and
strongly degraded playing strength.

The failure therefore cannot be defended as a compute-for-strength trade:
additional computation produced a large negative strength result.

## Interpretation

A shallow full-width tactical search is not automatically a safe correction for
V3B.1's selective MCTS root ranking.

The depth-3 heuristic verifier appears to overvalue short-horizon tactical
positions and replace long-horizon MCTS choices too often:
- about 29% of candidate decisions were overridden;
- 8 of 10 opening pairs regressed;
- no opening pair improved.

The result supports the earlier evidence that short-horizon heuristic minimax
signals are dangerous in this Ô Ăn Quan search stack, even when they are moved
out of PUCT allocation and applied only as a final root verifier.

This rejects the **fixed top-2, depth-3 heuristic alpha-beta verifier**.

Do not rescue V3C by immediately retuning:
- alpha-beta depth;
- top-K;
- a score-difference threshold;
- blend weight;
- MCTS simulations.

Those are new hypotheses and require separate preregistration.

The result does not imply every possible MCTS/minimax hybrid is invalid. A
future revisit would need a qualitatively different mechanism, such as exact
endgame solving rather than shallow heuristic override.

## Decision consequence

- Keep **V3B.1 PNSum Cpn=2.0** as Quan Gia + Threefold incumbent.
- Close V3C.
- Do not run 10k/20k/50k.
- Do not run Pie/Standard reference checks.
- Keep proof-number bias tuning closed.
- Keep PVS/NegaScout excluded.
- Keep unresolved games censored.

## Evidence runs

- Quan Gia 5k gate: Actions run `36032773184`
- B5:CW targeted confirmation: Actions run `36032890432`

## Literature context

The experiment was motivated by MCTS-minimax hybrid research showing that
shallow full-width minimax/alpha-beta can compensate for tactical weaknesses of
selective MCTS trees. The result here is domain-specific evidence that this
particular post-search verifier is harmful for the current Ô Ăn Quan stack.

## Repository consequence

Retain only this consolidated rejection report on main.
Delete the temporary V3C implementation, tests, benchmark, workflows and
research branch after consolidation.
