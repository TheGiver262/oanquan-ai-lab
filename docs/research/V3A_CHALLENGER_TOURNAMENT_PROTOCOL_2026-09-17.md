# V3A Challenger Tournament Protocol — 2026-09-17

Status: research-only. This protocol does not authorize production deployment or production AI changes.

## Question

PUCT V3A (`ReusableScoreBoundedPuct`) is the closed-R1 research incumbent. This tournament directly tests every currently implemented full-game search algorithm in the AI Lab that has not already completed a direct R1 matchup against V3A, subject to the project exclusions below.

## Included challengers

1. `uct` — vanilla UCT MCTS from `src/research/mcts.ts`.
2. `uct-pb` — UCT with progressive bias and heuristic rollout from `src/research/mcts.ts`.
3. `lab-minimax` — the independent AI-Lab minimax path from `src/search.ts`, using the zero-mistake `trang-nguyen` research profile only as its heuristic/resource profile. This is **not** the production Trạng Nguyên best-first implementation.
4. `lab-alpha-beta` — the independent AI-Lab alpha-beta path from `src/search.ts`, with the same zero-mistake research profile. This is **not** Bảng Nhãn or Thám Hoa production code.

## Explicit exclusions

- Bảng Nhãn and Thám Hoa: excluded by user request.
- Production Trạng Nguyên: already completed direct R1d-A/R1d-B matchups against V3A.
- PUCT V2: already completed the direct R1c matchup against V3A.
- PVS/NegaScout: remains excluded from future active algorithm evaluation by prior project decision. Historical PVS opening evidence remains valid but PVS is not a challenger here.
- Exact endgame DFS/SCC tools: research oracles/analysis tools, not complete game-playing policies.
- MCGS, PNS/DFPN, neural PUCT, tablebase hybrids: not currently implemented as complete full-game challengers in this branch, so they cannot be honestly included yet.

## Rules and parity lane

Primary screen runs on the exact audited production-semantics branch inherited from R1d-A:

- ruleset: `oaq:classic_2p:standard:v1`;
- legacy production semantics: no `repeated_moves` terminal adjudication;
- unresolved games stay unresolved and are never scored by heuristic adjudication.

This keeps the first challenger screen directly comparable to the production-parity R1d-A evidence. A corrected-repeat confirmation lane may be added later without pooling the two rulesets.

## Corpus

Reuse the frozen R1 three-stratum corpus:

- Stage 1: 16 B3 opening/reply states (`B3:CW` and `B3:CCW` followed by every legal reply).
- Stage 2: 16 balanced live-Quan states from `LIVE_QUAN_BALANCED_POSITIONS`.
- Stage 3: the same 5 low-material/cycle-sensitive states used by R1.

Every exact state is played twice with challenger ownership swapped between P0 and P1.

## Primary metric

The unit of comparison is the paired state, not an individual game.

For each state:

- challenger win = 1 point;
- draw = 0.5;
- loss = 0;
- if either game in the pair is unresolved, that pair is censored from resolved pair statistics;
- `pairDiff = challengerPoints - V3APoints`, range `[-2,+2]`.

Positive `pairDiff` favors the challenger. Negative favors V3A.

Report per stage:

- W/L/D/U;
- completed-pair count;
- mean/median pairDiff;
- favorable/neutral/unfavorable pairs;
- full pair vector;
- per-position outcomes;
- latency and search-consumption diagnostics for both engines.

## Resource fairness

The cross-family primary screen uses **equal wall-clock**, not equal nodes/simulations:

- 600 ms per decision for both sides;
- V3A simulation ceiling: 5,000,000 (runaway guard, not a work-equivalence target);
- UCT/UCT-PB simulation ceiling: 5,000,000;
- lab minimax/alpha-beta node ceiling: 5,000,000;
- UCT rollout depth: 20;
- V3A uses its frozen R1 values `c_puct=1.5`, policy temperature `0.6`.

Nodes and simulations are reported separately and must never be treated as equivalent work units.

The 600 ms pass is a screening gate. A challenger that is positive, materially close to neutral, or shows a stage-specific win against V3A should receive a later 1,200 ms confirmation rather than being declared stronger from the screen alone.

## Randomness and repeats

- `uct` and `uct-pb` consume a deterministic seeded RNG; the seed is real search randomness, not a label.
- The first full screen uses seed `20260917` to cover every challenger and every stratum without excessive Actions cost.
- Further UCT-family confirmation must use additional independent seeds.
- V3A, lab minimax and lab alpha-beta use runtime repeats only for jitter/robustness; identical deterministic repeats are not independent statistical samples.

## Null control

A V3A-vs-V3A null control is run on all three strata under the same harness. Any non-neutral completed pair must be investigated before interpreting close challenger results.

## Interpretation

This screen can establish direct evidence that a challenger is clearly weaker, competitive, or promising against V3A under the declared budget and corpus. It does **not** by itself establish statistical superiority, global game-theoretic strength, or production readiness.

A direct challenger promotion requires a separate confirmation gate with multiple true seeds for stochastic challengers, runtime robustness for deterministic challengers, clean null controls, and no correctness/parity regression.
