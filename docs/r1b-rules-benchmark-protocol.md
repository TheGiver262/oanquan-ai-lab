# R1b — Pre-registered rules benchmark: Cấm Quan vs Standard + Pie

Status: research-only protocol. This document freezes the first R1b comparison before any promotion-strength run is interpreted.

R1b does **not** modify production and does not test `Cấm Quan + Pie`. That third hypothesis is deferred unless Standard + Pie first clears the R1b gate.

## Questions kept separate

R1b has two experiments and two reports.

### R1b-1 — Intrinsic opening fairness

Question:

> If KEEP and SWAP are both available and the responder is allowed to choose the better branch, does Standard + Pie produce a more neutral 2-player opening than the current Cấm Quan ruleset?

KEEP/SWAP are **forced**. No learned or heuristic Pie decision policy participates in this experiment.

### R1b-2 — Pie decision quality

Question:

> Given a Pie position after move 1, can a practical player/bot policy choose KEEP/SWAP close enough to the better branch?

This experiment is not allowed to change the R1b-1 fairness score. Its main metric is branch-selection regret.

R1b-2 starts only after R1b-1 is technically valid. A theoretically useful Pie rule and a weak KEEP/SWAP policy must remain distinguishable.

## Compared rules

### A — Cấm Quan

Canonical research ruleset:

`oaq:classic_2p:no_first_quan:v1`

The opening corpus is enumerated from the engine with `getLegalMoves(createInitialState(NO_FIRST_QUAN_RULESET))`. No opening is hard-coded as legal.

There is no post-opening decision. Original opener A remains P0 and responder B remains P1.

### B — Standard + Pie Rule

Base ruleset:

`oaq:classic_2p:standard:v1`

All legal Standard openings are enumerated from the engine.

For every opening, both branches are evaluated:

- KEEP: `{ P0: A, P1: B }`; B makes move 2.
- SWAP: `{ P0: B, P1: A }`; board/history are not mirrored or rewritten; A makes move 2 as P1.

The responder-optimal opener value for an opening is evaluated only after both branches are available:

`V_pie(X) = min(V_keep(X), V_swap(X))`

The bounded empirical opening-equilibrium proxy is:

`E_pie = max_X V_pie(X)`

For Cấm Quan:

`E_cam_quan = max_X V_cam_quan(X)`

These are **bounded-engine empirical proxies**, not solved game-theoretic values unless a future exact solver proves the relevant states.

## Engine-assignment pairing

The opener/responder identities are distinct from logical seats and from search-engine identity.

For each opening/branch and each engine matchup `X vs Y`, run an engine-assignment pair:

1. original opener A uses engine X; responder B uses engine Y;
2. original opener A uses engine Y; responder B uses engine X.

For Pie SWAP, the engines follow their agents when ownership swaps. The board remains unchanged.

This pairing reduces engine-strength confounding without pretending that logical P0/P1 are interchangeable.

## Search policies in the full R1b-1 matrix

The first full matrix uses at least three practical search policies/configurations available on the audited R1a base:

1. vanilla UCT;
2. UCT-PB;
3. server-reference Trạng Nguyên in `production-max` mode.

UCT and UCT-PB consume a seeded RNG; their independent stochastic runs must use true seeds passed into search. Trạng Nguyên has no intentional mistake at this profile and is treated as deterministic for this experiment unless a code audit shows RNG affects its selected move.

PVS may be reported separately as a bounded independent evaluator, but it is not reintroduced as an active AI promotion candidate and is not mixed into terminal-game W/L/D/U aggregates.

V3A is not silently copied into this branch. It remains the R1c incumbent candidate on its own research line until a common audited base is explicitly prepared.

## Resource modes

R1b reports fixed-resource and wall-clock evidence separately.

### Fixed-resource

Primary algorithmic comparison where supported:

- UCT / UCT-PB: fixed simulations;
- deterministic search: fixed node budget where available;
- a generous hard time ceiling acts only as a runaway guard.

### Wall-clock

Secondary practical comparison:

- equal declared time envelope for the compared agents in a matchup;
- actual simulations/nodes are diagnostics, not a fairness target.

Fixed-resource and wall-clock results are never pooled into one score.

## Game termination

Default full-game cap: `160` plies after the initial state unless the harness explicitly records a different cap.

A game still playing at the cap is `unresolved`.

Unresolved games:

- are never converted to heuristic draws;
- are excluded from resolved paired point differential;
- contribute conservative `[-1,+1]` uncertainty to opener-value bounds;
- are replayed at higher caps before any promotion claim if unresolved rate exceeds the gate.

Current Standard/Cấm Quan rules do not adjudicate repetition as draw. A repeated strategic state is therefore not silently turned into a terminal result.

## Metrics

Every `ruleset × search-policy/matchup × resource-mode` report is separate and includes:

- W/L/D/U from original opener A's identity perspective;
- resolved score / mean opener value;
- unresolved rate;
- P0/P1 win split;
- opener/responder identity split;
- game-length median and P95;
- per-opening result;
- engine-assignment paired differential;
- KEEP and SWAP values separately for Pie;
- responder-optimal Pie value only after both branches are evaluated;
- opening-equilibrium proxy;
- cycle/search diagnostics exposed by the selected engine;
- actual simulations/nodes and elapsed time.

No aggregate may mix different rulesets, opponents/search policies, or resource modes.

## Confidence intervals

The independent sampling unit is not an individual seat result.

For stochastic UCT-family runs, a seed is valid only when the seeded RNG is actually consumed by search. Confidence intervals are computed over seed-level, engine-assignment-paired opening observations, stratified by opening where possible.

Deterministic repeated runs at the same fixed resource budget do not create new statistical samples. Wall-clock repeats are labeled runtime replicates and are used for robustness/latency, not fake multi-seed significance.

## Pre-registered R1b-1 promotion gate

Standard + Pie may advance from "research rule" to a production-design review only if all of the following hold in the full R1b-1 evidence:

1. zero illegal moves and zero replay/state-hash mismatches in the benchmark harness;
2. primary-cap unresolved rate `<= 1%`, with every unresolved-heavy opening replayed at a higher cap;
3. the median absolute opening-bias metric improves by at least `25%` versus Cấm Quan under at least two of the three registered search policies/configurations;
4. worst-opening absolute bias improves by at least `20%` under at least two of the three registered policies/configurations;
5. no registered policy shows a material fairness regression greater than `0.05` in normalized opener value at its equilibrium proxy;
6. the clustered/paired 95% interval for the main opener/responder fairness contrast must not support a practically meaningful advantage larger than `0.10` for either identity;
7. draw rate and median/P95 game length are reported and any increase large enough to affect product UX is treated as a separate gate, not hidden inside fairness;
8. KEEP and SWAP branch data remain separately inspectable.

Passing this gate does **not** authorize production changes. It authorizes only a production-design review and, if desired, R1b-2 decision-policy research.

## R1b-2 decision-quality metric

For each Pie decision position with branch values measured under the same search-policy/resource configuration:

`regret = value(best responder branch) - value(chosen branch)`

from the responder's perspective.

Report:

- exact KEEP/SWAP choice accuracy when one branch is strictly better;
- mean/median/P95 regret;
- catastrophic-choice rate where regret exceeds a pre-registered threshold;
- timeout/default-choice behavior separately.

R1b-2 results are never substituted for intrinsic fairness results.

## Smoke phase

Before any full matrix, only a correctness smoke is allowed:

- enumerate both opening corpora from the engine;
- verify KEEP/SWAP ownership and mover semantics;
- play a very small fixed-resource subset to prove the harness can terminate, swap engine assignments, and report unresolved correctly;
- typecheck, tests, and build must pass.

Smoke results are explicitly non-promotional and must not be quoted as evidence that one rule is fairer.
