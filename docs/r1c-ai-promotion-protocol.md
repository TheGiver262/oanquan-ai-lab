# R1c — AI promotion research protocol

Status: pre-registered research protocol. No production change, merge, deploy, or AI replacement is authorized by this document.

Base: `research/r1-production-parity`, which audits the production reference against `TheGiver262/O_an_quan@73c698762c514d171869a79982fdc86103653e8f`.

## Research question

R1c asks only:

> Which AI/search stack is stronger and more operationally stable on one frozen 2-player ruleset?

R1c does **not** change the game rule while comparing AI. Pie/Cấm Quan research belongs to R1b and may not be mixed into the headline R1c strength result.

## Frozen ruleset

Primary R1c ruleset:

`oaq:classic_2p:standard:v1`

This preserves continuity with the existing PUCT V2/V3A/V3B research evidence. If a future rules decision promotes Pie or another competitive ruleset, that ruleset requires a separate validation pass; it does not retroactively change R1c Standard evidence.

## Current incumbent wording

PUCT V3A is treated as:

> research incumbent/candidate with a mild positive signal; not statistically proven stronger.

Do not call V3A the proven strongest AI.

V3B/PNMax remains a rejected promotion experiment and is not reopened in R1c.

## Baselines

R1c distinguishes three baseline roles.

### Production reference

Audited server production AI reference, with Trạng Nguyên as the strongest retained production-code comparator.

Without the exact deployed learning snapshot, every Trạng Nguyên result must remain labeled:

`code-parity-no-live-learning-snapshot`

Such a result is not a complete comparison against live deployed strength.

### Direct algorithmic baseline

Frozen PUCT V2 (`c_puct=1.5`, heuristic-policy temperature `0.6`, root noise disabled) is retained only where a direct same-family ablation is needed.

### Research incumbent

Memory-bounded PUCT V3A:

- bounded two-ply tree reuse;
- conservative exact terminal W/D/L propagation;
- cycle cutoff without inventing repetition-as-draw;
- no global session-wide node map.

## Corpus strata

A production promotion claim may not rely on one opening family.

R1c uses three independently reported strata:

1. **opening/reply corpus** — opening-sensitive positions, including the historical B3 reply corpus for continuity;
2. **balanced live-Quan midgame corpus** — both Quan alive, balanced score/material, sufficient branching, generated deterministically and audited before use;
3. **low-material / cycle-sensitive corpus** — reduced positions that exercise endgame, refill, and loopy-state behavior.

Results are reported per stratum before any aggregate. A candidate that gains only on one repeated position is not promoted as generally stronger.

## Pairing

Every benchmark state is played with engine ownership swapped between P0 and P1.

Primary game-level statistic:

`pairDiff = candidatePoints - baselinePoints`, range `[-2,+2]`.

Unresolved individual games censor the corresponding pair until replay or higher-cap resolution. They are never heuristic-adjudicated.

Raw W/L/D remains secondary when logical-seat bias is large.

## Resource modes must remain separate

### A. Fixed-simulation / fixed-node algorithmic tests

Use only when resource units are comparable within an algorithm family.

Examples:

- V3A vs V2: same fixed simulation budget;
- a future PUCT variant vs V3A: same fixed simulation budget.

Do **not** claim that 10,000 PUCT simulations equal 10,000 alpha-beta/Trạng Nguyên nodes.

Fixed-resource tests answer algorithmic allocation/reproducibility questions; they do not by themselves establish production latency suitability.

### B. Wall-clock playing-strength tests

Cross-family comparisons use equal declared wall-clock envelopes and separately report actual work completed.

For every engine:

- actual decisions;
- actual simulations/nodes;
- elapsed search time;
- budget-stop reason;
- cycle diagnostics where exposed.

Wall-clock results are practical playing-strength evidence, not deterministic game-theoretic proof.

## Randomness and replicates

A value is called a **seed** only if it is consumed by the tested search path.

Current V3A has no search RNG/root noise in its active path. Therefore:

- fixed-simulation V3A is deterministic on a fixed state/config;
- repeated fixed-simulation executions do not create independent samples;
- repeated wall-clock V3A executions are runtime replicates because timing changes completed work, not RNG seeds.

Stochastic opponents may use true seeds, but this does not make the deterministic candidate itself independently seeded.

## Correctness gate before strength

A candidate is not strength-tested until all pass:

- typecheck/tests/build;
- legal move invariant;
- state/ruleset hash parity with the audited R1a base;
- deterministic fixed-resource replay where applicable;
- cycle/repetition semantics preserved;
- no hidden heuristic adjudication of unresolved games;
- bounded retained-memory design verified for stateful search.

## Strength evidence classes

R1c uses four explicit labels.

### `legal/correctness only`

The AI produces valid moves and satisfies technical invariants. No strength claim.

### `non-regressing research baseline`

Direct paired evidence shows no meaningful regression and implementation/runtime behavior is stable enough for further research.

### `meaningfully stronger`

Requires a positive paired signal that is not concentrated in one state, persists across relevant corpus strata/resource checks, and has an uncertainty interval excluding no-gain under the registered analysis.

### `production-review eligible`

Requires `meaningfully stronger` plus operational gates below. This label still does not authorize merge/deploy.

## Common promotion metrics

Every promotion-quality report includes:

- W/L/D/U;
- resolved score;
- completed swapped pairs;
- mean/median pair differential;
- favorable/neutral/unfavorable pair counts;
- per-position and per-stratum results;
- unresolved rate;
- P0/P1 split;
- cycle cutoffs;
- simulations/nodes per decision;
- P50/P95/P99 decision latency;
- peak heap/RSS in the production-like harness;
- cancellation/timeout behavior;
- fallback legality;
- replay determinism classification.

## Uncertainty

Do not manufacture statistical power by replaying a deterministic state under new labels.

For stochastic search, confidence intervals may resample true seed-level paired observations.

For deterministic fixed-resource corpora, a bootstrap over positions is only a **descriptive corpus-sensitivity interval**. It must be labeled as such and must not be described as independent repeated game evidence.

Repeated wall-clock runs may quantify runtime robustness, but they are not independent RNG samples.

## Reject gates

Reject or keep research-only if any of the following occurs:

- positive gain exists only in a smoke/low-budget run and disappears at the intended budget;
- paired advantage is zero/negative at the intended gate;
- gain is concentrated in one repeated benchmark state without broader support;
- unresolved/censoring asymmetry creates the apparent raw-score gain;
- cycle-cutoff behavior becomes pathological;
- memory grows without a bounded retention strategy or causes OOM;
- P95/P99 latency breaches the production envelope;
- cancellation cannot reliably stop search and return a legal fallback;
- current audited production parity is lost.

V3B is the canonical example of a rejected result: a low-budget signal disappeared at 600 ms and cycle behavior regressed severely.

## Operational production-review gate

Before a research AI can become production-review eligible, run a production-like server harness and pre-register limits for:

- P50/P95/P99 latency;
- peak process RSS and JS heap;
- concurrent AI decisions under expected server load;
- cancellation deadline;
- legal fallback after cancellation/timeout;
- long-run retained-memory stability;
- replay/state-hash consistency.

The limits must be compared with the current production baseline and server capacity target; they may not be invented after seeing candidate measurements.

## R1c first implementation step

The first R1c code change is intentionally narrow:

1. port the **final memory-bounded V3A** implementation onto the audited R1a base;
2. port its correctness/reuse/cycle tests;
3. verify that no old production pin is reintroduced;
4. do not bring the rejected V3A global-index prototype or V3B PNMax into the incumbent implementation;
5. do not run a strength tournament until this correctness gate is green.

No R1c result authorizes production changes without a later explicit production-review approval.
