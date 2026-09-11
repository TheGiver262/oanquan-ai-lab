# PUCT V3A Self-Play Results

## Evaluation policy

Active V3 evaluation excludes Thám Hoa and Bảng Nhãn.

The primary comparison is PUCT against PUCT:

1. PUCT V2 vs PUCT V2 is the null-control for seat/corpus/runtime noise.
2. PUCT V3A vs PUCT V2 is the direct ablation for tree reuse + score-bounded terminal propagation.
3. UCT-PB and Trạng Nguyên are secondary external checks only.

PUCT V2 is frozen at `c_puct=1.5`, heuristic-policy temperature `0.6`, and no root noise.

Every full-prefix smoke job uses all 16 two-ply positions generated from every legal reply after `B3:CW` and `B3:CCW`. Each position is played twice with engine ownership swapped between P0 and P1.

## Full-prefix smoke before reroot optimization

Run `34587669991`, 25 ms/decision, 32 games/job.

### V2 mirror

- research W-L-D-U: `13-16-3-0`
- resolved score: `45.3125%`
- completed swapped pairs: `16`
- mean pair differential: `-0.1875`
- favorable / neutral / unfavorable pairs: `0 / 14 / 2`

### V3A vs V2

- V3A W-L-D-U: `16-15-1-0`
- resolved score: `51.5625%`
- completed swapped pairs: `16`
- mean pair differential: `+0.0625`
- favorable / neutral / unfavorable pairs: `1 / 15 / 0`
- P0/P1 wins overall: `28 / 3`

V3A search diagnostics:

- decisions: `403`
- simulations: `185,487`
- average simulations/decision: `460.27`
- average expanded nodes/decision: `1,729.55`
- milliseconds/simulation: `0.03799`
- reused decisions: `371 / 403 = 92.06%`
- inherited root visits: `73,545`
- cycle cutoffs: `742`, about `0.40%` of simulations
- solved roots: `139`

A 20,000-sample bootstrap over the 16 pair differentials gives a descriptive 95% interval of approximately `[0, +0.1875]`. This is not a superiority proof because the sample is small and the 25 ms time budget itself is noisy.

## Hot-path diagnosis and optimization

The first V3A implementation traversed the entire retained subtree every time a real game state became the new root, solely to rebuild the strategic-state index and rewrite depths. At 25 ms this made V3A about `3.7x` more expensive per simulation than the stateless V2 opponent.

Commit `5d2bcc52b4886b88878e352ad11f86fe0ded94e1` removes that O(subtree) reroot traversal.

The optimized implementation:

- keeps a session-wide strategic-state index;
- treats an indexed equivalent strategic state as a reusable representative from the same fixed engine-player perspective;
- measures tree depth relative to the current simulation path rather than mutating all retained descendant depths;
- uses a compact, collision-free serialization of the same rule-relevant strategic fields used by the V4 exact solver;
- preserves cycle safety and conservative solved-outcome propagation.

CI after this change passes typecheck, the complete test suite, and build.

## Full-prefix smoke after reroot optimization

Run `34588023799`, identical 25 ms/decision protocol.

### Optimized V3A vs V2

- V3A W-L-D-U: `15-14-3-0`
- resolved score: `51.5625%`
- completed swapped pairs: `16`
- mean pair differential: `+0.0625`
- favorable / neutral / unfavorable pairs: `3 / 12 / 1`
- pair differentials: `[0,0,0,0,0,1,0,0,0,0,1,0,0,-2,0,1]`

Optimized V3A search diagnostics:

- decisions: `432`
- simulations: `331,904`
- average simulations/decision: `768.30`
- milliseconds/simulation: `0.02379`
- reused decisions: `400 / 432 = 92.59%`
- inherited root visits: `144,737`
- cycle cutoffs: `1,222`
- solved roots: `150`

Relative to the pre-optimization V3A smoke:

- simulations/decision increased by about `66.9%`;
- milliseconds/simulation decreased by about `37.4%`;
- mean pair differential remained `+0.0625`.

The optimized pair-differential bootstrap interval is wider, approximately `[-0.3125, +0.375]`, because the same net +1 pair point is distributed across three favorable pairs and one `-2` pair. It must therefore be treated as neutral-to-positive smoke evidence, not proof of improvement.

### V2 mirror repeat

The identical V2 mirror in the second 25 ms run produced:

- W-L-D-U: `17-14-1-0`
- mean pair differential: `+0.1875`

The first identical V2 mirror produced `-0.1875`. The sign flip between two identical-engine runs is direct evidence that a 25 ms wall-clock budget is useful for smoke/regression checks but too noisy for fine strength ranking.

## Current conclusion

V3A passes the important direct self-play gate:

- no consistent regression against frozen PUCT V2;
- full-prefix resolved score is `51.5625%` in both pre- and post-optimization runs;
- mean swapped-pair differential is `+0.0625` in both runs;
- tree reuse is actually exercised on more than `92%` of V3A decisions;
- reroot optimization materially increases effective search throughput.

However, superiority over V2 is not statistically established. The next strength evidence must come from the higher-budget paired run, where wall-clock scheduling noise is a much smaller fraction of each decision budget.

GPN/PNMax proof-number bias remains a separate V3B experiment. It should not be mixed into V3A until the optimized V3A baseline is characterized at the higher budget.