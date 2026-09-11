# PUCT V3A Self-Play Results

## Evaluation policy

Active V3 evaluation excludes Thám Hoa, Bảng Nhãn, and PVS.

The primary comparison is PUCT against PUCT:

1. PUCT V2 vs PUCT V2 is the null-control for seat/corpus/runtime noise.
2. PUCT V3A vs PUCT V2 is the direct ablation for tree reuse + score-bounded terminal propagation.
3. Future V3B must be compared directly against frozen V3A so proof-number bias is isolated.
4. UCT-PB and Trạng Nguyên are secondary external checks only; Trạng Nguyên remains `code-parity-no-live-learning-snapshot`.

PUCT V2 is frozen at `c_puct=1.5`, heuristic-policy temperature `0.6`, and no root noise.

The full-prefix corpus contains all 16 two-ply positions generated from every legal reply after `B3:CW` and `B3:CCW`. Each position is played twice with engine ownership swapped between P0 and P1. Raw W/L is secondary because the corpus remains strongly P0-biased; swapped-pair differential is the primary strength metric.

An unresolved game at the move cap is censored. It is never silently converted to a draw, win, or heuristic result.

## V3A implementation status

V3A adds two features to the frozen PUCT V2 search stack:

- conservative score-bounded terminal/solved-outcome propagation;
- tree reuse between consecutive turns of the same engine.

The first optimized reuse experiment used a session-wide strategic-state index. It improved low-budget throughput, but at the 600 ms strength budget the retained tree/index grew to roughly 4 GB and caused Node to OOM. That design is retired and is not the promoted V3A implementation.

The current V3A uses bounded two-ply rerooting. When the same engine is called again after its move and the opponent reply, it searches only the retained root -> own move -> opponent move window for the actual strategic state, reroots there, and allows unrelated sibling branches to become collectible. This matches the two-player turn cadence, keeps reuse useful, and bounds retained memory. Dedicated tests cover the two-ply reroot path.

Repeated strategic states remain cycle-safe: repetition is not adjudicated as a draw because the current Ô Ăn Quan rules do not define a repetition result.

## Historical 25 ms smoke

The 25 ms full-prefix smoke runs were useful for regression detection but too noisy for fine ranking. V2-vs-V2 mirror pair differential flipped sign between nominally identical runs (`-0.1875` then `+0.1875`). Therefore these runs are retained only as implementation history, not promotion evidence.

Tree reuse was exercised on more than 92% of V3A decisions in these smoke runs. The hot-path optimization increased simulations per decision from about `460` to `768`, but the later global-index OOM showed that throughput alone was not a sufficient design criterion.

## Memory-bounded 600 ms single-seed check

After switching to bounded two-ply rerooting, the full-strength workflow completed without OOM.

For V3A vs V2 across 32 games / 16 swapped positions at 600 ms per decision:

- V3A W-L-D-U: `14-13-5-0`
- resolved score: `51.5625%`
- completed swapped pairs: `16`
- mean pair differential: `+0.0625`
- favorable / neutral / unfavorable pairs: `1 / 15 / 0`

This was sufficient to justify a multi-seed gate, not a superiority claim.

## Multi-seed promotion gate

Workflow run `34593442375` evaluates four independent seeds: `20260921`, `20260922`, `20260923`, and `20260924`. Every job uses the same 16-position corpus, one swapped pair per position, 600 ms per side, `c_puct=1.5`, temperature `0.6`, and `maxMoves=160`.

### V3A vs frozen V2

| Seed | W-L-D-U | Resolved score | Completed pairs | Mean pair diff |
| --- | --- | ---: | ---: | ---: |
| 20260921 | 14-13-4-1 | 51.61% | 15 | 0.0000 |
| 20260922 | 15-11-5-1 | 56.45% | 15 | +0.2000 |
| 20260923 | 15-12-4-1 | 54.84% | 15 | +0.1333 |
| 20260924 | 15-12-4-1 | 54.84% | 15 | +0.1333 |

Combined direct-ablation result:

- games: `128`
- V3A W-L-D-U: `59-48-17-4`
- resolved games: `124`
- resolved score: `54.435%`
- completed swapped pairs: `60`
- mean pair differential: `+0.1167`
- pair distribution: `56 x 0`, `1 x +1`, `3 x +2`, `0` negative pairs
- tree-reuse rate by seed: approximately `93.4-94.1%`
- average V3A simulations/decision by seed: approximately `25.3k-27.9k`

The repeated positive discriminator is `B3:CCW>T4:CCW`, which produced a `+2` pair for V3A in seeds 20260922, 20260923, and 20260924. Seed 20260922 also produced `+1` at `B3:CW>T2:CW`.

The same individual game remains unresolved in every direct seed: `B3:CCW>T2:CW` with V3A as P1, capped at move 160. It is kept out of paired-differential scoring until replayed at a higher move cap.

A naive bootstrap over all 60 completed pair observations gives a descriptive 95% interval of roughly `[+0.0167, +0.2500]` for the mean pair differential. This must not be interpreted as an independent-sample superiority interval because the same 16 positions are repeated across seeds and therefore observations are correlated.

### V2 vs V2 null-control

Across the four mirror jobs:

- completed swapped pairs: `52`
- every completed pair differential is exactly `0`
- combined unresolved individual games: `23`
- per-seed mean pair differential: `0, 0, 0, 0`

The mirror therefore shows no residual directional pair bias on completed pairs at the 600 ms budget. It also confirms that the corpus contains several long/cyclic candidates that frequently hit `maxMoves=160`.

V3A-vs-V2 has only `4/128` unresolved games compared with `23/128` in the V2 mirror. This is useful behavioral evidence, but it is not itself a direct strength score because the algorithms create different trajectories.

## Promotion decision

V3A **passes the V3 baseline promotion / non-regression gate**.

The evidence supports promoting the current memory-bounded V3A implementation as the frozen baseline for the next proof-number experiment because:

- four direct seeds have non-negative mean paired differential;
- among 60 completed direct swapped pairs there are four favorable observations and no unfavorable observations;
- the matched V2-vs-V2 null-control has exactly zero differential on all 52 completed pairs;
- V3A tree reuse is actually exercised on roughly 93-94% of decisions;
- the current two-ply reroot implementation completes the 600 ms benchmark without the global-index OOM failure.

This is **not** a claim that V3A is statistically proven superior to V2. Only four direct pair observations are discriminating, and three come from the same forced position across different seeds. The defensible conclusion is that V3A is a stable, non-regressing, mildly positive search-stack baseline worth freezing for V3B.

## Next experiment: V3B

After unresolved replay is recorded, V3B should add cycle-safe generalized proof-number bias on top of frozen V3A, with no other search-policy changes mixed into the ablation.

Initial plan:

- name the experimental engine `gpn-puct` / V3B, not published `GPN-MCTS`, because selection remains PUCT;
- start with PNMax;
- keep `c_puct=1.5` and policy temperature `0.6` fixed;
- first measure `Cpn=0` to quantify proof-number bookkeeping overhead;
- then sweep small `Cpn` values such as `0.05`, `0.1`, `0.25`, and `0.5`;
- compare V3B directly against frozen V3A using the same swapped-prefix methodology;
- keep any repeated strategic state `UNKNOWN/cycle-unresolved`, never auto-draw;
- do not add FPU, dynamic cpuct, neural policy/value, Thám Hoa, Bảng Nhãn, or PVS to this ablation.
