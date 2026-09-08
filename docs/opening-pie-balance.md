# Opening balance and Pie Rule diagnosis

## Scope and safety

This investigation is research-only and lives entirely in `TheGiver262/oanquan-ai-lab`.

- Production repository `TheGiver262/O_an_quan` was not modified.
- No production branch, commit, patch, or pull request was created.
- The server-production reference remains pinned to `O_an_quan@4984701ce151ee270a6a5ba5fc9211a6ec2b6996`.
- Trạng Nguyên tests use the frozen server-production reference in `production-max` mode without a live learning snapshot.

The purpose is to answer two separate questions:

1. How much does the forced first move change logical-seat advantage?
2. Would a correctly implemented Pie Rule actually make the opening fair, or merely let the responder choose the favorable seat?

## Correct Pie Rule semantics

Let A be the original opener and B the responder.

1. A makes the first normal move as logical seat P0.
2. B receives exactly one decision:
   - **KEEP**: A stays P0, B stays P1, then B makes move 2.
   - **SWAP**: B takes P0 and A takes P1. SWAP consumes B's decision, so the board is left exactly as it was after move 1 and A makes move 2 as P1.
3. The board is never mirrored or rewritten. Only agent-to-seat ownership changes.

Unit tests in `tests/opening-pie-analysis.test.ts` lock these semantics.

## Game-theoretic correction

Suppose a forced opening X leaves logical P0 with value `V(X)` under symmetric optimal play.

```text
KEEP(X) = V(X)
SWAP(X) = -V(X)
```

The responder chooses the branch that is worse for the original opener:

```text
min(KEEP(X), SWAP(X))
= min(V(X), -V(X))
= -|V(X)|
```

The opener therefore chooses:

```text
max_X -|V(X)|
= -min_X |V(X)|
```

So Pie Rule does **not** imply 50/50 fairness. It prevents the opener from simply owning a known favorable seat. If every legal opening leaves one logical seat strongly favored, the responder can choose that seat and Pie Rule may shift the structural advantage to the responder.

For fairness, the useful target is an opening with `V(X)` close to zero, not merely a negative opener worst-case value after KEEP/SWAP.

## Research layers

Three independent signals were collected.

### A. Bounded Trạng Nguyên opening probe

After forcing each legal P0 opening, Trạng Nguyên best-first search evaluates the position from P1's perspective; results are converted back to an opener/P0 score.

This is a bounded heuristic search, **not a solved game value**. In every 2M-node run the WDL interval remained `loss..win`.

### B. Trạng Nguyên vs Trạng Nguyên KEEP/SWAP self-play

For each opening, the same Trạng Nguyên reference plays both seats. Three deterministic replicates are run for KEEP and three for SWAP.

This validates seat ownership and terminal behavior under the Pie mapping, but a deterministic same-policy terminal result should not be treated as a calibrated win probability.

### C. UCT-PB vs Trạng Nguyên forced-opening seat swap

For each opening:

- 6 games
- same forced first move
- UCT-PB owns P0 in 3 games and P1 in 3 games
- Trạng Nguyên owns the opposite seat
- UCT-PB: 100k simulation cap, rollout depth 20, 1200 ms
- Trạng Nguyên: production-max, 100k node cap, 1200 ms
- maximum 160 moves

This test separates logical-seat effects from engine-strength effects better than same-policy self-play.

## Ten-opening baseline: 100k-node probe

| Opening | Best P1 reply | Opener score | TN-vs-TN winning seat | KEEP opener EV | SWAP opener EV |
|---|---|---:|---|---:|---:|
| B1:CW | T3:CW | -2236.5 | P1 | -1 | +1 |
| B1:CCW | T4:CW | -28.5 | P0 | +1 | -1 |
| B2:CW | T5:CW | +1931.5 | P0 | +1 | -1 |
| B2:CCW | T3:CW | +382.5 | P1 | -1 | +1 |
| B3:CW | T1:CW | +340.5 | P1 | -1 | +1 |
| B3:CCW | T5:CCW | +340.5 | P1 | -1 | +1 |
| B4:CW | T3:CCW | +382.5 | P1 | -1 | +1 |
| B4:CCW | T1:CCW | +1931.5 | P0 | +1 | -1 |
| B5:CW | T2:CCW | -28.5 | P0 | +1 | -1 |
| B5:CCW | T3:CCW | -2236.5 | P1 | -1 | +1 |

The left/right symmetry is strong, but the 100k score ranking proved unstable when search was deepened.

## Probe stability across search budgets

Four initially interesting openings were deepened to 500k nodes. B3:CW/B3:CCW appeared close to neutral at completed depth 7 (`+58.5`), while B1:CCW/B5:CW moved from `-28.5` to `-892`.

The B3 pair was then pushed to 2M nodes and completed depth 8. Its score returned to `+340.5`.

For B3, the observed sequence was:

```text
100k nodes / depth 6: +340.5
500k nodes / depth 7: +58.5
2M nodes / depth 8: +340.5
```

This is a depth-parity oscillation, not convergence.

A full 2M-node comparison was therefore run for all ten openings.

## Full 2M-node bounded probe

All positions remained WDL-unresolved (`loss..win`). Smaller absolute score means only "closer to neutral under this bounded heuristic at this completed depth".

| Opening | Best P1 reply | Opener score | |score| | Completed depth |
|---|---|---:|---:|---:|
| B1:CW | T3:CW | -2480 | 2480 | 8 |
| B1:CCW | T4:CW | +396.5 | 396.5 | 8 |
| B2:CW | T5:CW | +1602.75 | 1602.75 | 7 |
| B2:CCW | T1:CCW | +702.5 | 702.5 | 7 |
| B3:CW | T1:CW | +340.5 | 340.5 | 8 |
| B3:CCW | T5:CCW | +340.5 | 340.5 | 8 |
| B4:CW | T5:CW | +702.5 | 702.5 | 7 |
| B4:CCW | T1:CCW | +1602.75 | 1602.75 | 7 |
| B5:CW | T2:CCW | +396.5 | 396.5 | 8 |
| B5:CCW | T3:CCW | -2480 | 2480 | 8 |

At this depth, B3:CW/B3:CCW have the smallest absolute heuristic score. That is **not** evidence that they are solved-fair openings because:

- their score oscillates with depth;
- all WDL bounds remain unresolved;
- terminal self-play can disagree with the probe sign.

## Cross-algorithm forced-opening results

Workflow run `34176828551` completed successfully for all ten openings.

| Opening | UCT-PB wins | Trạng Nguyên wins | Draws | P0 wins | P1 wins | Dominant signal |
|---|---:|---:|---:|---:|---:|---|
| B1:CW | 3 | 3 | 0 | 0 | 6 | **P1 seat** |
| B1:CCW | 6 | 0 | 0 | 3 | 3 | **UCT-PB engine** |
| B2:CW | 2 | 3 | 1 | 5 | 0 | **P0 seat** |
| B2:CCW | 5 | 0 | 1 | 3 | 2 | UCT-PB engine / mixed seat |
| B3:CW | 5 | 1 | 0 | 2 | 4 | UCT-PB engine + P1 tendency |
| B3:CCW | 5 | 1 | 0 | 2 | 4 | UCT-PB engine + P1 tendency |
| B4:CW | 5 | 0 | 1 | 3 | 2 | UCT-PB engine / mixed seat |
| B4:CCW | 3 | 3 | 0 | 6 | 0 | **P0 seat** |
| B5:CW | 6 | 0 | 0 | 3 | 3 | **UCT-PB engine** |
| B5:CCW | 3 | 3 | 0 | 0 | 6 | **P1 seat** |

Across all 60 games:

- P0 wins: 27
- P1 wins: 30
- draws: 3
- UCT-PB wins: 43
- Trạng Nguyên wins: 14
- draws: 3

The aggregate seat result is superficially close to even, while UCT-PB is much stronger in this matchup. The per-opening breakdown shows why the aggregate is misleading.

### Strong seat-bias evidence

Four symmetric opening regions show strong seat behavior even when the engines are swapped:

- `B1:CW` / `B5:CCW`: P1 wins **6/6** in each opening.
- `B4:CCW`: P0 wins **6/6**.
- `B2:CW`: P0 wins **5/6**, with the remaining game drawn.

Because the winning logical seat persists when UCT-PB and Trạng Nguyên exchange seats, these outcomes are much stronger evidence of opening/seat bias than an ordinary engine-vs-engine win rate.

### Engine-dominant evidence

Other openings do not isolate seat advantage:

- `B1:CCW` / `B5:CW`: UCT-PB wins **6/6** regardless of seat.
- `B2:CCW` / `B4:CW`: UCT-PB wins **5/6**, with one draw.
- `B3:CW` / `B3:CCW`: UCT-PB wins **5/6**, while P1 wins 4/6.

For these openings, the current sample cannot cleanly separate a modest seat effect from the large engine-strength gap.

## What the evidence supports

### 1. Opening choice materially changes who is favored

This is now supported by both same-policy and cross-algorithm tests. The first move is not merely cosmetic. Some openings produce a robust logical-seat advantage that survives swapping the two search engines.

### 2. A global P0/P1 win rate is insufficient

The 60-game cross-engine aggregate is almost even by seat (27 P0, 30 P1, 3 draws), yet individual openings range from P0 6/6 to P1 6/6.

A production analytics metric that reports only overall first-player win rate can therefore hide a severe opening-selection problem.

### 3. Pie Rule is directionally useful but is not proven fair

For a heavily biased opening, Pie Rule lets B take the favorable logical seat instead of allowing A to select both the opening and the favorable seat for free.

However, if the best available opening still has `|V(X)| > 0`, Pie Rule gives the responder the ability to choose the favored seat. It changes who controls the structural advantage; it does not make the position intrinsically neutral.

### 4. No opening is currently proven balanced

B3:CW/B3:CCW are the closest to zero in the 2M-node depth-8 heuristic probe, but their score is depth-unstable and cross-engine play still shows a P1 tendency alongside a large UCT-PB strength advantage.

They are **research candidates**, not solved balanced openings.

### 5. A Balanced Opening Pool is premature as a production rule

A future balanced pool is plausible, but an opening should enter it only after it is stable across:

- deeper search depths/budgets;
- multiple algorithm families;
- both logical seats;
- repeated stochastic seeds;
- ideally a stronger solver or solved WDL bound.

The present evidence is enough to reject several strongly biased openings from a hypothetical balanced pool, but not enough to certify any opening as fair.

## Practical classification from the current evidence

### Strongly biased; avoid treating as neutral

- `B1:CW` / `B5:CCW` — strong P1 evidence.
- `B2:CW` / `B4:CCW` — strong P0 evidence.

### Unresolved / engine-confounded

- `B1:CCW` / `B5:CW`
- `B2:CCW` / `B4:CW`
- `B3:CW` / `B3:CCW`

The unresolved group should not be called balanced. It only lacks clean seat-isolation evidence in the present UCT-PB-vs-Trạng-Nguyên sample.

## Limitations

- The best-first probes are bounded and all 2M-node WDL intervals remain unresolved.
- Trạng Nguyên uses the frozen production reference without a live learning snapshot.
- Cross-algorithm testing currently uses only two search families: UCT-PB MCTS and Trạng Nguyên best-first.
- Six cross-engine games per opening are useful for strong 6/6 or 5/6 signals but still a small stochastic sample.
- Time-limited search can introduce runtime variance despite deterministic RNG seeds.
- Heuristic scores are not probabilities and are not directly comparable to terminal EV.

## Recommended next research gate

Do not change production rules yet.

The next useful gate is to focus compute on the unresolved candidate group and reduce engine confounding:

1. run larger seat-swapped samples for `B3:CW`, `B3:CCW`, `B1:CCW`, `B5:CW`;
2. add at least one independent deterministic search family, preferably corrected full-width/very-wide Alpha-Beta on opening subtrees;
3. require consistency of seat-value sign across engines and depths before proposing a Balanced Opening Pool;
4. only then test Pie Rule equilibrium over the surviving near-neutral openings.

Until that gate passes, the defensible conclusion is: **Ô ăn quan opening choice can create large logical-seat bias, and Pie Rule alone is not evidence of a 50/50 competitive opening.**
