# V10 — Pie + Threefold Cross-Engine Tournament

## Scope

V10 answers a specific production-facing question: how does the frozen server-reference **Trạng Nguyên** perform inside the current best competitive-mode candidate, **Pie/Swap + threefold**, against the strongest research engines?

This phase does **not** modify `TheGiver262/O_an_quan`. All work stays in `oanquan-ai-lab`.

## Engines

- `trang-nguyen`: frozen server-production reference from production source commit `4984701ce151ee270a6a5ba5fc9211a6ec2b6996`; best-first search, no live learning snapshot loaded.
- `policy-uct-pb`: policy-aware UCT + progressive bias; tree edges and rollouts understand threefold.
- `policy-pvs`: policy-aware PVS using full repetition history and strategic evaluation.

The WDL/tablebase PVS variant was intentionally excluded because V6 holdout work found sparse generalization and no demonstrated strength gain.

## Protocol

A neutral policy-aware UCT-PB meta-referee handles Pie setup so that engine gameplay strength is not mixed with an engine-specific implementation of the Pie decision:

1. Evaluate all 10 classic first moves.
2. Choose the opening with minimum absolute estimated P1 seat value, i.e. maximize the bounded Pie guarantee `-|v|` for original opener A.
3. The responder takes the estimated stronger seat via KEEP/SWAP.
4. Participant engines alternate Pie Agent A/B roles every game.
5. Actual gameplay is adjudicated with threefold repetition.

Important limitation: Trạng Nguyên remains **repetition-blind inside its search**. Its played moves are adjudicated by threefold externally. Therefore TN comparisons are production-compatibility tests, not a perfectly algorithm-fair comparison of threefold-aware search.

## Compute

GitHub Actions run: `34507347418`

- 3 pairings
- 4 fresh seed groups per pairing
- 12 games per seed group
- **48 games per pairing / 144 games total**
- 1,200 ms wall-clock budget per move
- TN node cap: 500,000
- PVS node cap: 500,000; max depth 16
- UCT-PB simulation cap: 200,000; rollout depth 20
- neutral Pie meta probe: 200 ms per opening; 50,000 simulation cap
- max game length: 220 plies

Validation gate passed typecheck, targeted policy/protocol/parity tests, and build before tournament jobs started. All 12 tournament jobs completed successfully; no game was unresolved.

## Main results

| Pairing | First engine wins | Second engine wins | Natural draws | Threefold draws | First engine score | Second engine score |
|---|---:|---:|---:|---:|---:|---:|
| Trạng Nguyên vs policy-PVS | 22 | 26 | 0 | 0 | 45.83% | **54.17%** |
| Trạng Nguyên vs policy-UCT-PB | 13 | **26** | 8 | 1 | 36.46% | **63.54%** |
| policy-UCT-PB vs policy-PVS | **39** | 1 | 3 | 5 | **89.58%** | 10.42% |

### Per-seed score rate of first engine

| Pairing | seed 01 | seed 02 | seed 03 | seed 04 |
|---|---:|---:|---:|---:|
| TN vs PVS | 58.33% | 58.33% | 33.33% | 33.33% |
| TN vs UCT-PB | 54.17% | 37.50% | 50.00% | 4.17% |
| UCT-PB vs PVS | 91.67% | 83.33% | 87.50% | 95.83% |

The TN–PVS sample is close and does not establish a large strength separation. The UCT-PB–PVS result is much stronger and stable across all four seed groups. TN–UCT also favors UCT-PB overall, although seed 04 is an extreme outlier and the 48-game sample remains modest.

## Role and seat robustness

### Trạng Nguyên vs UCT-PB

Trạng Nguyên as Pie Agent A: 7 W / 13 L / 4 D.

Trạng Nguyên as Pie Agent B: 6 W / 13 L / 5 D.

Equivalently, UCT-PB beats TN from **both Pie roles**.

Trạng Nguyên as P0: 4 W / 12 L / 4 D.

Trạng Nguyên as P1: 9 W / 14 L / 5 D.

Equivalently, UCT-PB also beats TN from **both logical seats**, so its edge is not explained by simply receiving the favored seat after the swap decision.

### UCT-PB vs PVS

UCT-PB as Pie Agent A: 17 W / 1 L / 6 D.

UCT-PB as Pie Agent B: 22 W / 0 L / 2 D.

UCT-PB as P0: 20 W / 0 L / 1 D.

UCT-PB as P1: 19 W / 1 L / 7 D.

This is the strongest robustness result in V10: UCT-PB dominates PVS from both roles and both seats.

### TN vs PVS

TN as Agent A: 8 W / 16 L.

TN as Agent B: 14 W / 10 L.

TN as P0: 11 W / 11 L.

TN as P1: 11 W / 15 L.

This matchup is much more interaction-sensitive than UCT-PB matchups. It is not evidence that PVS should replace TN as a standalone production AI solely from this sample.

## Pie setup distribution

The meta-referee mostly selected the same two openings already identified by V8/V9:

- TN–PVS: B4:CW 24, B2:CCW 21, B1:CCW 2, B5:CW 1.
- TN–UCT-PB: B4:CW 24, B2:CCW 20, B1:CCW 3, B5:CW 1.
- UCT-PB–PVS: B2:CCW 23, B4:CW 22, B1:CCW 3.

Because the meta-referee uses a 200 ms wall-clock limit, separate CI runners produced small 1–2 game differences in opening distribution despite using the same seed groups. This does not invalidate each direct head-to-head result because roles alternate inside each pairing, but it limits exact between-pair comparison. The exact V9 Pie setup fixtures have therefore been preserved in `results/v9-pie-holdout-fixtures.json` for a future identical-fixture replay if needed.

## Runtime

Average decision time across all seed groups:

- TN vs PVS: TN ~1200.1 ms, PVS ~1185.6 ms.
- TN vs UCT-PB: TN ~1195.4 ms, UCT-PB ~1146.3 ms.
- UCT-PB vs PVS: UCT-PB ~1169.8 ms, PVS ~1192.4 ms.

The tournament therefore compares engines at approximately equal wall-clock resources, with algorithm-specific node/simulation caps acting as secondary safeguards.

## Threefold behavior

Across all 144 games there were 6 repetition draws (4.17%).

- TN–PVS: 0 / 48.
- TN–UCT-PB: 1 / 48.
- UCT-PB–PVS: 5 / 48.

One UCT-PB–PVS game ended by threefold with UCT-PB occupying P0 while the score was 9–57. This shows that a threefold-aware strong engine can use repetition as a genuine defensive resource. That is not automatically a defect—draw-by-repetition rules are expected to allow defensive drawing resources—but it should remain a monitored competitive-design metric.

The sole TN–UCT repetition draw occurred with TN on P0 at 26–20. Since TN is repetition-blind internally, this is an example of why a future production Pie+threefold implementation should eventually make every top AI policy-aware rather than relying only on external adjudication.

## Current algorithm verdict

V10 strengthens the existing ranking:

1. **policy-aware UCT-PB** — strongest single algorithm currently benchmarked in the lab.
2. **policy-aware PVS / frozen Trạng Nguyên** — much closer to one another; PVS won the direct V10 sample 26–22 but the separation is small.
3. PVS remains more valuable as a deterministic tactical verifier than as the main strategic engine because UCT-PB beat it 39–1 with 8 draws.
4. WDL/tablebase remains an optional endgame proof/safety module, not the core search.

The long-term hybrid candidate remains **UCT-PB core + PVS tactical verification + exact/WDL endgame support**.

## Current mode verdict

V10 does not overturn the V9 mode result. Pie+threefold still behaves as a viable competitive environment across substantially different engines. However, mode fairness itself should continue to be judged primarily by same-strength/same-engine role-swapped experiments (such as V9), while V10 measures robustness to heterogeneous engine styles.

Current competitive-mode candidate remains:

**Pie/Swap + threefold**, with **forced B2:CCW + threefold** as the simpler fallback.

Neither is yet claimed to be game-theoretically proven balanced.
