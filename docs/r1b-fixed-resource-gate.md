# R1b-1 fixed-resource gate execution plan

This document freezes the primary R1b-1 execution configuration before any full-gate result is run or interpreted. It refines, but does not replace, `docs/r1b-rules-benchmark-protocol.md`.

Calibration artifacts produced before this document are explicitly non-promotional. They may be used to validate runtime feasibility, corpus enumeration, unresolved handling, and artifact schema only. Their W/L/fairness values must not be used to change the thresholds or resource budgets below.

## Primary question

Compare only:

- A — `Cấm Quan`: `oaq:classic_2p:no_first_quan:v1`
- B — `Standard + Pie`: `oaq:classic_2p:standard:v1` with forced KEEP and forced SWAP branches

`Cấm Quan + Pie` remains out of R1b-1.

## Primary policy configurations

The fairness question is first measured with same-policy self-play so engine-strength differences do not become the headline fairness signal.

### Policy 1 — UCT

- engine A: `uct`
- engine B: `uct`
- assignment mode: `single`
- simulations per decision: `2,000`
- rollout depth: `20`
- max game moves: `160`
- true seed bases: `20260914, 20260915, 20260916, 20260917, 20260918, 20260919, 20260920, 20260921`

The seeded RNG is consumed by UCT expansion/rollout, so these are genuine stochastic search replicates.

### Policy 2 — UCT-PB

- engine A: `uct-pb`
- engine B: `uct-pb`
- assignment mode: `single`
- simulations per decision: `2,000`
- rollout depth: `20`
- max game moves: `160`
- true seed bases: the same eight values as UCT

The seeded RNG is consumed by UCT-PB rollout/exploration, so these are genuine stochastic search replicates.

### Policy 3 — audited Trạng Nguyên reference

Run only if the early-stop rule below does not already make the R1b gate impossible.

- engine A: `trang-nguyen`
- engine B: `trang-nguyen`
- assignment mode: `single`
- node budget per decision: `100,000`
- hard time ceiling: `5,000 ms` only as a runaway guard
- max game moves: `160`
- one deterministic fixed-node pass; no fake multi-seed labels
- integrity label: `code-parity-no-live-learning-snapshot`

A fixed-node Trạng Nguyên result is valid only if `timeBudgetStops == 0`. If the hard wall-clock guard fires, the run is not treated as a clean fixed-node sample. The protocol must be amended or the guard raised before a replacement run; the partial result may be retained only as diagnostic evidence.

## Why same-policy uses one assignment

When X and Y are the same deterministic policy, `xy` and `yx` are not independent engine assignments. Duplicating them would artificially increase sample count.

For stochastic UCT-family policies, independent evidence comes from the eight actual RNG seeds, not from renaming identical engines as X/Y.

Cross-engine `xy/yx` pairing remains available as a later robustness check, but it is not the primary R1b-1 fairness estimator.

## Corpus

The corpus is always enumerated by the engine at runtime.

Current calibration confirms, without using outcome values for promotion:

- Cấm Quan: 8 legal openings
- Standard + Pie: 10 legal Standard openings, each with KEEP and SWAP

These counts are facts about the audited engine; the harness must still emit the exact opening list in every artifact.

## Early-stop rule

Run full UCT and full UCT-PB evidence first.

Pie must eventually pass the pre-registered fairness-improvement thresholds in at least two of the three policy configurations.

Therefore:

- if Pie fails the median-opening-bias improvement threshold in both UCT and UCT-PB, stop R1b-1 before Trạng Nguyên;
- or if Pie fails the worst-opening-bias improvement threshold in both UCT and UCT-PB, stop R1b-1 before Trạng Nguyên;
- or if both UCT-family configurations show a material equilibrium fairness regression beyond the pre-registered tolerance, stop before Trạng Nguyên.

Reason: after two failures, a single remaining Trạng Nguyên pass cannot satisfy an `at least 2 of 3` gate.

If one stochastic policy passes and the other is pass/ambiguous/fail, run Trạng Nguyên because the final 2-of-3 decision is still mathematically open.

This early-stop rule is frozen before full UCT/UCT-PB results exist.

## Aggregation unit

For UCT-family policies:

1. each seed produces all legal openings under both A and B;
2. KEEP/SWAP remain separate in raw data;
3. within each Pie opening and seed, responder-optimal value is computed only after both branches are available;
4. per-opening values are aggregated across true seeds;
5. confidence intervals resample seed-level complete-corpus observations, keeping A/B paired by seed.

Individual games are not treated as independent samples.

For Trạng Nguyên, repeated identical fixed-node execution is not used to manufacture a confidence interval.

## Required resource diagnostics

Every full artifact must report actual search consumption by engine:

- decisions;
- simulations and expanded nodes for UCT-family search;
- nodes for Trạng Nguyên;
- elapsed search time;
- node-budget stops;
- time-budget stops.

A result missing these diagnostics is not promotion-quality evidence.

## Fixed-resource gate metrics

For each policy independently, report at minimum:

- per-opening mean opener value;
- Pie KEEP and SWAP raw branch results;
- responder-optimal Pie value by opening;
- median absolute opening bias;
- worst absolute opening bias;
- empirical opening-equilibrium proxy;
- unresolved rate;
- W/L/D/U as secondary descriptive data;
- median/P95 game length;
- confidence intervals where genuine stochastic seeds exist.

Primary improvement thresholds remain those frozen in the main R1b protocol:

- median absolute opening bias improves at least `25%`;
- worst-opening absolute bias improves at least `20%`;
- no material equilibrium fairness regression greater than `0.05`;
- unresolved rate `<= 1%` at the primary cap, otherwise unresolved positions are replayed before promotion interpretation.

No result in R1b-1 authorizes merge, deployment, or production ruleset changes.
