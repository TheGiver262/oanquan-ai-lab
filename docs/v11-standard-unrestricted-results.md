# V11 Standard Unrestricted — UCT-PB vs Trạng Nguyên

## Purpose

Measure UCT-PB against the frozen server production-reference Trạng Nguyên under the canonical Standard game from the true initial position, with no forced opening, no Pie/Swap, and no research repetition adjudication.

This benchmark is specifically designed to separate two questions:

1. What is the raw head-to-head result when both engines are allowed to choose their own first move under Standard rules?
2. How large is the P0/P1 seat-opening effect at strong-AI budgets?

## Methodology

- Repository: `TheGiver262/oanquan-ai-lab` only. Production was not modified.
- Workflow run: `34512415853`.
- 10 independent seed jobs: `20261201` through `20261210`.
- 10 games per seed, 100 games total.
- Engine A: UCT-PB.
- Engine B: frozen server production-reference Trạng Nguyên.
- Seats alternate every game, giving each engine exactly 50 games as P0 and 50 as P1.
- Starting position: true initial board; each engine chooses its own opening.
- Rules: canonical current Standard game.
- No Pie/Swap.
- No threefold/repetition adjudication.
- 1,200 ms wall-clock budget per move.
- Trạng Nguyên node cap: 500,000.
- UCT-PB simulation cap: 200,000; rollout depth 20.
- Max move guard: 220; any non-terminal game at the guard would be reported as unresolved, not as a draw.
- Frozen production-reference commit: `4984701ce151ee270a6a5ba5fc9211a6ec2b6996`.
- No live Trạng Nguyên learning snapshot was available.

## Results

### Head-to-head

| Result | Count |
| --- | ---: |
| UCT-PB wins | 50 |
| Trạng Nguyên wins | 46 |
| Natural score draws | 4 |
| Unresolved | 0 |
| UCT-PB score rate | 52.0% |

The raw 52%-48% style result must **not** be interpreted as evidence that the engines are equal. It is overwhelmingly dominated by seat/opening advantage.

### Seat outcome

| Seat result | Count |
| --- | ---: |
| P0 wins | 96 |
| P1 wins | 0 |
| Draws | 4 |
| Unresolved | 0 |
| P0 score rate including half-draws | 98.0% |

UCT-PB as P0: **50-0-0**.

UCT-PB as P1: **0-46-4**.

Because Trạng Nguyên occupies P0 in exactly the complementary 50 games, Trạng Nguyên as P0 is **46-0-4**, while as P1 it is **0-50-0**.

No P1 engine won a single game in the 100-game sample.

### Per-seed results

| Seed | UCT | TN | Draw | P0 | P1 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 20261201 | 5 | 5 | 0 | 10 | 0 |
| 20261202 | 5 | 5 | 0 | 10 | 0 |
| 20261203 | 5 | 5 | 0 | 10 | 0 |
| 20261204 | 5 | 4 | 1 | 9 | 0 |
| 20261205 | 5 | 4 | 1 | 9 | 0 |
| 20261206 | 5 | 5 | 0 | 10 | 0 |
| 20261207 | 5 | 5 | 0 | 10 | 0 |
| 20261208 | 5 | 4 | 1 | 9 | 0 |
| 20261209 | 5 | 5 | 0 | 10 | 0 |
| 20261210 | 5 | 4 | 1 | 9 | 0 |

All four draws were natural final-score ties at **35-35**, not repetition draws or max-move adjudications.

Average game length was **29.16 moves**. Average measured decision time was approximately **1,190.4 ms for UCT-PB** and **1,200.1 ms for Trạng Nguyên**, so both engines used essentially the intended production-scale wall-clock budget.

## Interpretation

### Standard unrestricted is not a useful raw strength discriminator

The empirical result is almost entirely determined by P0. UCT-PB wins every one of its 50 P0 games and none of its 50 P1 games. Trạng Nguyên shows the complementary pattern.

Therefore the raw UCT 50 — TN 46 — draw 4 result does **not** contradict the earlier forced-opening resource-fair evidence where UCT-PB beat Trạng Nguyên 8-0 on `B3:CW` and 8-0 on `B3:CCW`.

Those experiments answer different questions:

- V11 Standard unrestricted measures the real current starting protocol and exposes its seat/opening bias.
- Forced-opening tests suppress much of that bias and are more informative about algorithmic playing strength.

### Balance implication

Under the tested strong-AI budget, canonical Standard from the true initial position is extremely P0-favored: **96 P0 wins, 0 P1 wins, 4 draws**.

This is empirical evidence, not a mathematical proof that Standard is game-theoretically won for P0. However, it is far too large and consistent an effect to ignore in a competitive ranked design.

This result materially strengthens the case for a balancing opening protocol such as Pie/Swap rather than using unrestricted Standard as the ranked protocol.

## Claim limits

- The frozen Trạng Nguyên reference does not include a live optional learning snapshot.
- UCT-PB is stochastic; additional seeds can further narrow uncertainty, but the seat effect here is already qualitatively dominant.
- V11 does not record the exact first-move distribution in its artifact. A follow-up opening-choice instrumentation run would be required to attribute the P0 dominance among specific self-selected openings.
- No claim is made that the game is solved or that P0 is mathematically guaranteed to win.
