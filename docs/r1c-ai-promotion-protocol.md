# R1c AI promotion protocol

## Status

Pre-registered research protocol for the Standard/classic 2-player ruleset. No production behavior changes are authorized by this document.

## Objective

Determine whether the current research incumbent, PUCT V3A, is meaningfully stronger than its frozen PUCT V2 baseline and remains competitive against clean external baselines before any later structural candidate can replace it.

A "meaningfully stronger" claim requires consistent paired evidence across more than one state distribution. A single opening suite, raw W/L count, or timing-sensitive replay is insufficient.

## Fixed rules semantics

Primary ruleset: `oaq:classic_2p:standard:v1`.

- No Pie decision inside these AI-strength games.
- No threefold adjudication.
- Repeated strategic states inside V3A search are heuristic cycle cutoffs only; they are never automatic draws or solved proof evidence.
- Game-cap exhaustion is unresolved/censored, never heuristic-adjudicated.
- No root Dirichlet noise.

Pie + threefold belongs to a later dedicated rule profile after the strongest Standard algorithm is settled.

## Production parity prerequisite

R1c is stacked on the completed R1a production-parity audit. The production reference pin is:

`TheGiver262/O_an_quan@73c698762c514d171869a79982fdc86103653e8f`

R1a verified that core classic move legality/rules semantics were unchanged and refreshed state-hash parity. R1c may not make a strength claim if those parity tests regress.

## Incumbent

PUCT V3A: `ReusableScoreBoundedPuct`.

Frozen properties:

- two-ply bounded subtree reuse;
- no session-wide global node map;
- exact terminal W/D/L propagation;
- cycle cutoff + heuristic for repeated strategic state;
- no repetition-as-draw assumption;
- `c_puct = 1.5`;
- policy temperature `0.6`;
- no rollout;
- heuristic policy/value;
- no root noise.

Historical V3A evidence is retained as context only. The earlier 128-game V2 comparison showed a mild reproducible positive signal, not statistical proof of superiority.

## Frozen same-family baseline

PUCT V2 is a fresh-root, stateless PUCT search with the same heuristic policy/value family.

Frozen comparison settings:

- `c_puct = 1.5`;
- policy temperature `0.6`;
- no rollout;
- no root noise;
- fixed-simulation comparisons against V3A use exactly the same simulation budget per decision.

The isolated R1c implementation lives in `src/research/puct-v2.ts`. It is extracted from the historical `puct-hv` path rather than re-adding that variant to the current mixed MCTS module.

## Evidence strata

A promotion-strength conclusion requires evidence from all three strata:

1. **Opening/reply corpus** — historical B3:CW and B3:CCW forced openings with legal reply diversification. This is continuity/regression evidence.
2. **Balanced live-Quan corpus** — deterministic balanced early/midgame states while both Quan stones remain alive. R1c ports the exact previously-audited V3C generator blob `eaccc3e1fd44be7f99e75d6fb0bcfdb96a7e71e7` plus test blob `b6969ef017a5a8a60a96516daf3b957b156b76ad`. The corpus targets depths 4–11, two positions per depth, score difference <= 8, dân-material difference <= 10, >= 3 legal moves, and both Quan alive.
3. **Low-material / cycle-sensitive corpus** — late positions that stress refill/cycle behavior and exact terminal propagation. This stratum must be audited separately before use.

No candidate may be called strongest from only one stratum.

## Pairing

For every forced state:

- play candidate as P0 and baseline as P1;
- play baseline as P0 and candidate as P1;
- keep the same forced prefix/state;
- `pairDiff` is the primary result unit.

For a two-game pair, candidate points use win=1, draw=0.5, loss=0. Pair difference is candidate points minus baseline points, range [-2,+2]. A pair is excluded from resolved pair statistics if either game is unresolved.

Report raw W/L/D/U separately; do not substitute it for paired differential.

## Resource fairness

### Same-family V3A vs V2

Primary diagnostic mode is fixed simulations with identical `c_puct` and temperature. No wall-clock search cap is applied except an external workflow runaway timeout.

This isolates the structural contribution of bounded subtree reuse + exact solved propagation from machine scheduling noise.

Both V2 and V3A are deterministic at fixed simulations. Repeating them under different labels does not create independent random samples and must not be called a multi-seed experiment.

### Cross-family comparisons

Cross-family promotion evidence uses equal wall-clock budget per decision. Simulation count is reported as a diagnostic, not normalized against alpha-beta/best-first node count.

For Trạng Nguyên without the deployed learning snapshot, label results:

`code-parity-no-live-learning-snapshot`

Such a comparison is a clean code-path baseline, not a complete deployed-strength statement if production learning memory is enabled.

## Stage 1 — direct V3A ablation

Run, in order:

1. V2 vs V2 null control on the opening/reply corpus.
2. V3A vs V2 on the exact same corpus and fixed simulation budget.

Frozen first-pass budget:

- 4,000 simulations per decision;
- `c_puct=1.5`;
- policy temperature `0.6`;
- move cap 160;
- B3:CW and B3:CCW with all legal replies;
- no RNG labels.

Null-control validity condition: all completed V2 mirror pairs must be pair-neutral. If not, the harness is invalid and V3A result is not interpreted.

Stage 1 is continuity evidence, not sufficient for final promotion.

## Stage 2 — balanced live-Quan

After Stage 1 harness validation, run the same fixed-simulation V3A vs V2 pairing on all 16 audited live-Quan states. The exact corpus generator/test must pass on the R1a audited engine before results are interpreted.

## Stage 3 — low-material/cycle-sensitive

Construct/audit a separate deterministic corpus emphasizing:

- low dân material;
- refill-relevant states;
- recurrent/cycle-prone state graphs;
- both players to move;
- multiple opening ancestries;
- no heuristic outcome labels baked into selection.

Then run the same paired fixed-simulation V3A vs V2 gate.

## Stage 4 — cross-family wall-clock

Only after the same-family structural evidence is understood, compare the incumbent/candidate against clean cross-family baselines such as Trạng Nguyên with equal wall-clock budgets. Do not call fixed PUCT simulations equivalent to best-first nodes.

## Reporting

Every artifact must report:

- source commit / ruleset;
- forced position identifier;
- engine ownership P0/P1;
- fixed simulations or wall-clock budget as appropriate;
- W/L/D/U;
- completed pairs;
- pair-diff distribution and mean;
- unresolved rate;
- per-position results;
- search diagnostics (simulations, expanded nodes, depth, elapsed time);
- V3A reuse, retained-tree/cycle diagnostics where available.

No fake seed count or pseudo-replication is allowed.

## Candidate promotion rule

V3A remains incumbent unless a later candidate demonstrates:

- no correctness/parity regression;
- paired non-regression on every required stratum;
- positive paired evidence on at least one discriminative stratum;
- no pathological cycle or memory behavior;
- acceptable wall-clock throughput;
- no dependence on heuristic adjudication of unresolved games.

For replacing V3A with a new algorithm, evidence must be materially stronger than a handful of raw wins. Exact statistical thresholds may be pre-registered for a stochastic candidate, but deterministic corpora are interpreted at the position/pair level rather than by inventing random seeds.

## What R1c does not authorize

- production AI changes;
- rank/MMR changes;
- Pie + threefold implementation;
- resurrection of PVS/NegaScout as an active candidate;
- treating Bảng Nhãn as a clean strength baseline;
- labeling Trạng Nguyên as full live strength without a matching learning snapshot.
