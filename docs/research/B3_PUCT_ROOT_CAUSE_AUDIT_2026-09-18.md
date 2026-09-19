# B3 PUCT Search Instability — Root Cause Audit (2026-09-18)

## Verdict

The B3 instability is primarily a **static-leaf heuristic horizon bias**, amplified by cumulative PUCT backup and then exposed as a sharp action switch by visit-count root selection.

This is not supported as a cycle-cutoff bug, reflection bug, wall-clock artifact, RNG artifact, or subtree-reuse bug.

## Controlled evidence

Canonical state:
- research mode: `quan-gia-threefold`
- opening: `B3:CW`
- opener identity: A
- target: board move 2
- fixed simulations only
- fresh target root; no inherited subtree required for this audit
- observation-only instrumentation; action/rootStats are unchanged with audit enabled

### Root leaf provenance

At 99,066 simulations:

`B4:CW`
- visits: 47,623
- root mean: 0.066758
- cycle contribution: 0
- heuristic leaves: 24.72% of samples, contribution ~0.0659
- terminal leaves: 0.34%, 0 wins / 162 draws / 0 losses, contribution 0
- solved-nonterminal leaves: 74.94%, contribution ~0.0009

`B5:CCW`
- visits: 47,624
- root mean: 0.570222
- cycle contribution: 0
- heuristic leaves: 82.77% of samples, contribution ~0.4731
- terminal leaves: 0.05%, 0 wins / 23 draws / 0 losses, contribution 0
- solved-nonterminal leaves: 17.18%, contribution ~0.0971

Thus roughly 83% of the B5 root mean comes from static heuristic leaf evaluations. No terminal win contributes to the high B5 mean.

### Heuristic feature audit

| budget | action | root mean | heuristic fraction | heuristic mean | avg score delta | avg side delta | avg mobility delta | avg refill delta | avg material |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 68k | B4:CW | 0.067391 | 24.92% | 0.266723 | +5.034 | +0.110 | -0.090 | -0.043 | 8.933 |
| 68k | B5:CCW | 0.071422 | 82.38% | 0.075239 | +1.702 | -0.116 | +0.012 | +0.004 | 3.030 |
| 80k | B4:CW | 0.066758 | 24.72% | 0.266476 | +5.033 | +0.107 | -0.090 | -0.043 | 8.928 |
| 80k | B5:CCW | 0.388655 | 82.19% | 0.388344 | +9.615 | -0.295 | -0.109 | -0.038 | 16.991 |
| 90k | B4:CW | 0.066758 | 24.72% | 0.266476 | +5.033 | +0.107 | -0.090 | -0.043 | 8.928 |
| 90k | B5:CCW | 0.501164 | 82.79% | 0.502940 | +12.702 | -0.382 | -0.126 | -0.051 | 22.461 |
| 99,066 | B4:CW | 0.066758 | 24.72% | 0.266476 | +5.033 | +0.107 | -0.090 | -0.043 | 8.928 |
| 99,066 | B5:CCW | 0.570222 | 82.77% | 0.571544 | +14.606 | -0.443 | -0.146 | -0.060 | 25.825 |

The B5 heuristic inflation is overwhelmingly associated with **scoreDelta**. Side-stone, mobility, and refill deltas are small and mostly negative while B5's heuristic value rises.

The current evaluator uses:

`material = scoreDelta*1.8 + sideDelta*0.45 + mobilityDelta*0.8 + refillDelta*2.5`

so temporary captured-score leads dominate frontier evaluation even when fresh continuation does not preserve that advantage.

## Amplification mechanism

1. B5 enters frontier states with increasingly large temporary score leads.
2. Static heuristic evaluates those frontier states strongly positive.
3. PUCT backs the same leaf reward through every node on the sampled path.
4. Those historical heuristic rewards remain permanently in `valueSum/visits`.
5. Higher B5 mean attracts more B5 simulations, producing a positive feedback loop.
6. Root output is still ranked by visit count, so the old B4 visit lead delays the actual action switch.
7. At 99,066 simulations B5 exceeds B4 by exactly one visit and the selected action flips.

This explains the two observed thresholds:
- ~68k: B5 mean first exceeds B4.
- 99,066: B5 visits finally exceed B4 and root action flips.

## Excluded causes

Current evidence does not support the following as the primary cause:
- cycle cutoff: zero cycle contribution in the audited root samples;
- terminal proof: B5's high mean contains zero terminal wins;
- reflection ordering: reflection-canonical tests pass;
- A/B identity: paired checks pass;
- wall-clock jitter: fixed-simulation protocol;
- root subtree reuse: provenance audit uses a fresh target-root engine.

## Important limitation

Fresh V3A continuation is not a game-theoretic oracle. For example, a forced B4 branch can win in V3A selfplay while the search tree itself contains many locally solved draw nodes. Therefore this audit establishes why the PUCT estimate becomes unstable; it does not prove the true minimax value of B4 or B5.

## Next causal gate

Do not change root ranking from visits to mean.

The next experiment should isolate the leaf evaluator:
1. freeze PUCT selection/backup/root-ranking;
2. create research-only evaluator ablations;
3. first remove or reduce only the scoreDelta dominance while keeping all other terms fixed;
4. measure whether the B5 value inflation and 68k/99,066 phase transition disappear;
5. validate any promising evaluator against the existing R1 strength corpus and B3 reflection/A-B gates before considering promotion.

Routine runs should print results to Actions logs and should not upload artifacts.
