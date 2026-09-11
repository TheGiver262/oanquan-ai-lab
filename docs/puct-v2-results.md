# PUCT V2 — tuning and paired-strength evidence

Status: active research report for PR #8. PVS / NegaScout is excluded from all active evaluation; historical artifacts are not part of this scorecard.

## Methodology

PUCT-HV uses heuristic policy priors and heuristic leaf values; it is not AlphaZero and has no neural policy/value network. Evaluation disables root Dirichlet noise.

To reduce the large P0/opening confound seen in the initial smoke tournament, V2 uses paired positions: each forced opening state is played twice with engine ownership swapped between P0 and P1. Strength runs use B3:CW and B3:CCW plus all legal P1 replies, producing 16 two-ply positions and 32 games per opponent at one pair per position.

Primary comparison metrics:

- resolved score rate = (wins + 0.5 * draws) / resolved games;
- completed-pair mean point differential, which is less sensitive to seat advantage;
- unresolved count at the 160-move cap;
- search diagnostics (simulations, expanded nodes, root entropy/effective branching, max tree depth and ms/simulation).

Equal wall-clock budgets are used for playing-strength comparisons. PUCT-HV has no rollout while UCT-PB does, so simulation counts are diagnostic rather than a fairness target.

## Coarse grid vs UCT-PB

Coarse sweep: 4 games/config, paired over B3:CW and B3:CCW, 600 ms per side.

| c_puct | policy temp | W-L-D-U | resolved score | completed pairs | mean pair diff |
|---:|---:|---:|---:|---:|---:|
| 0.75 | 0.20 | 1-2-1-0 | 37.5% | 2 | -0.5 |
| 0.75 | 0.35 | 3-0-0-1 | 100.0% | 1 | +2.0 |
| 0.75 | 0.60 | 3-0-0-1 | 100.0% | 1 | +2.0 |
| 1.50 | 0.20 | 1-2-1-0 | 37.5% | 2 | -0.5 |
| 1.50 | 0.35 | 3-1-0-0 | 75.0% | 2 | +1.0 |
| 1.50 | 0.60 | 4-0-0-0 | 100.0% | 2 | +2.0 |
| 2.50 | 0.20 | 1-2-1-0 | 37.5% | 2 | -0.5 |
| 2.50 | 0.35 | 3-0-1-0 | 87.5% | 2 | +1.5 |
| 2.50 | 0.60 | 3-0-1-0 | 87.5% | 2 | +1.5 |

Interpretation: temperature 0.20 is consistently poor across all tested c_puct values. The useful region is approximately temperature 0.35–0.60, with 0.60 the most consistent across the follow-up validation.

## Finalist validation vs UCT-PB

Validation: 12 games/config, 600 ms per side.

| config | W-L-D-U | resolved score | completed pairs | mean pair diff |
|---|---:|---:|---:|---:|
| c=1.5, t=0.60 | 9-1-2-0 | 83.33% | 6 | +1.333 |
| c=2.5, t=0.35 | 7-0-3-2 | 85.00% | 4 | +1.250 |
| c=2.5, t=0.60 | 9-0-2-1 | 90.91% | 5 | +1.600 |

The best finalist result is c_puct=2.5, policyTemperature=0.60. It is not yet promoted as the definitive setting solely from this 12-game sample; it requires the diversified two-ply corpus used for strength testing.

## Diversified two-ply strength — c=1.5, t=0.60

Each opponent: 16 two-ply positions, 32 games, one swapped-seat pair per position.

| opponent | budget/side | W-L-D-U | resolved score | completed pairs | mean pair diff | seat result |
|---|---:|---:|---:|---:|---:|---:|
| UCT-PB | 600 ms | 15-13-0-4 | 53.57% | 12 | +0.167 | P0 26, P1 2 |
| Thám Hoa production-max | 600 ms | 16-10-1-5 | 61.11% | 13 | +0.385 | P0 22, P1 4 |
| Trạng Nguyên production-max | 1200 ms | 18-12-0-2 | 60.00% | 14 | +0.286 | P0 26, P1 4 |

Trạng Nguyên remains `code-parity-no-live-learning-snapshot`; this is not a complete comparison against the deployed learning state.

The raw seat counts show that the forced-prefix corpus still contains a severe P0 advantage. Therefore raw win rate alone is not sufficient; completed-pair differential and per-position outcomes carry more weight.

Bảng Nhãn is intentionally absent from the strong-baseline table because its known minimizing-node move-ordering/selective-pruning defect contaminates strength conclusions. It remains useful only as a regression/vulnerability target until corrected.

## Current validation gate

A second diversified-corpus run has been launched for the finalist c_puct=2.5, policyTemperature=0.60 with a new seed (`20260915`) against UCT-PB, Thám Hoa and Trạng Nguyên under the same wall-clock budgets. Do not promote 2.5/0.60 over 1.5/0.60 until that run is complete and compared on paired metrics.

## Research direction after the gate

If 2.5/0.60 remains stronger or at least non-inferior on completed-pair differential, narrow tuning around c_puct 1.5–2.5 and temperature about 0.60 rather than reopening the full coarse grid. The next algorithmic enhancement should be evaluated separately (for example FPU/root-value initialization) so its effect is distinguishable from parameter tuning.
