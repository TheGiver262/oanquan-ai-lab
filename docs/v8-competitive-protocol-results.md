# V8 Competitive Protocol Results

Run: `34254218962`

Commit under test: `7b4ec8efbccd8a2ecec91b5538836b2605425dde`

## Purpose

V8 compares candidate ways to reduce first-seat bias under the research threefold policy while keeping gameplay controlled by the same policy-aware UCT-PB engine on both sides.

Fairness is measured by logical agents A/B after protocol seat swaps, not by raw P0/P1 seat identity.

Each protocol was tested on two independent seeds (`20260908`, `20260909`) with 16 games per seed, for 32 games per protocol. Gameplay used 350 ms/move, up to 100,000 MCTS simulations, rollout depth 20 and a 240-move safety ceiling.

## Results

| Protocol | A wins | B wins | Draws | A score | Seed scores | Distance from 50% | Avg moves | Repetition draws |
|---|---:|---:|---:|---:|---|---:|---:|---:|
| single `B2:CCW` | 14 | 15 | 3 | **48.4375%** | 43.75%, 53.125% | **1.5625 pp** | 27.4375 | 0 |
| 50/50 pool `B4:CW` / `B5:CW` | 15 | 13 | 4 | **53.125%** | 56.25%, 50.0% | **3.125 pp** | 28.125 | 0 |
| Pie | 13 | 16 | 3 | 45.3125% | 37.5%, 53.125% | 4.6875 pp | 23.0 | 0 |
| Swap2-adapted | 17 | 11 | 4 | 59.375% | 65.625%, 53.125% | 9.375 pp | 24.15625 | 1 |

Approximate game-resampling bootstrap 95% intervals for A score are broad at only 32 games: B2:CCW about 32.8%-65.6%, balanced pool about 37.5%-68.8%, Pie about 29.7%-62.5%, and Swap2-adapted about 43.8%-75.0%. These intervals overlap substantially, so V8 is a screening round rather than a final statistical decision.

## Interpretation

### B2:CCW

Best point estimate in V8 and the simplest finalist. It is also consistent with the earlier V7 eight-game opening scan, where B2:CCW produced a 56.25% P0 score. The two V8 seeds straddle 50%, which is encouraging, but another holdout is required.

### Balanced opening pool

The exact 50/50 B4:CW / B5:CW pool is second by point-estimate distance from 50% and showed a smaller between-seed swing than Pie or Swap2-adapted. Within V8, B4:CW scored exactly 50% for A across 16 pool games; B5:CW scored 56.25% across 16 pool games. The pool remains a strong candidate but introduces more protocol/state-selection complexity than a single opening.

### Pie

The short 45 ms meta evaluator was noisy: the selected opening varied materially across games and seeds. Pie's aggregate point estimate is not poor, but its seed swing (37.5% to 53.125%) and roughly 454 ms/game of meta-evaluation overhead indicate that V8 did not yet test Pie with sufficiently stable opening/seat decisions. V9 should keep Pie as a challenger but strengthen the meta evaluator before rejection.

### Swap2-adapted

The research-only sequential adaptation is not competitive in V8: 59.375% for A and the largest bias among the four protocols. It is also the most complicated protocol and incurred about 553 ms/game of meta-evaluation overhead.

More importantly, the literal Gomoku Swap2 defer idea does not transfer cleanly to this zero-sum sequential game. Under an exact seat-value model, after B authors two extra setup plies and A is then allowed to choose a seat, B's guaranteed value is `-|v| <= 0`; immediately choosing the stronger seat after the three-ply setup guarantees `|v3| >= 0`. The defer branch is therefore weakly dominated in the strong-AI abstraction. V8 drops Swap2-adapted from the main finalist set.

## V9 gate

Keep three finalists:

1. single `B2:CCW` + threefold;
2. exact 50/50 `B4:CW` / `B5:CW` pool + threefold;
3. Pie + threefold with a substantially stronger meta evaluator.

V9 must use fresh seeds not present in V7/V8, at least 500 ms gameplay search, and enough games to reduce seed noise. Do not reintroduce B3 or Swap2-adapted unless new evidence changes the screening result.

## Algorithm track note

Separately from protocol fairness, the V7 resource-fair check raised server-reference Trạng Nguyên to a 500,000-node cap and equal 1,200 ms move clock. UCT-PB still won 8-0 at forced B3:CW and 8-0 at forced B3:CCW, with four wins from each seat in each pairing. This establishes UCT-PB as the current algorithm finalist against the frozen server production-reference **without a live Trạng Nguyên learning snapshot**; it does not claim superiority to an unavailable live learning-enabled snapshot.
