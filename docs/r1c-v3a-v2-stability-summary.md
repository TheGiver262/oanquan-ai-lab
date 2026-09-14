# R1c — V3A vs frozen PUCT V2 stability summary

Status: research evidence summary. No production merge or deployment is implied.

## Fixed-simulation evidence after repeat-parity correction

The documented `repeated_moves` rule is enabled and recent-move history is included in all rule-relevant state identity used by the R1c corpus/search paths.

Canonical fixed-simulation results:

| Stage | Mean pair diff | Favorable | Neutral | Unfavorable | Unresolved |
| --- | ---: | ---: | ---: | ---: | ---: |
| Stage 1 | +0.1250 | 3 | 13 | 0 | 0 |
| Stage 2 | +0.1875 | 3 | 13 | 0 | 0 |
| Stage 3 | 0.0000 | 0 | 5 | 0 | 0 |

These are deterministic corpus results, not stochastic-seed evidence.

## 600 ms production-style wall-clock replicates

Each row below is a runtime replicate, not an independent RNG seed. Both frozen V2 and V3A are deterministic in search logic; variation comes from wall-clock cutoff/JIT/GC/scheduler effects.

### Stage 1

| Replicate | V2↔V2 null mean pair diff | V3A↔V2 mean pair diff | Null-adjusted diff | Candidate favorable/neutral/unfavorable | Unresolved |
| --- | ---: | ---: | ---: | --- | ---: |
| 1 | 0.0000 | +0.1875 | +0.1875 | 2 / 14 / 0 | 0 |
| 2 | -0.1250 | +0.0625 | +0.1875 | 1 / 15 / 0 | 0 |
| 3 | 0.0000 | +0.1250 | +0.1250 | 1 / 15 / 0 | 0 |
| 4 | 0.0000 | +0.2500 | +0.2500 | 2 / 14 / 0 | 0 |

The replicate-2 null drift is material to interpretation: the wall-clock runner is not perfectly outcome-neutral. However, candidate-minus-null remains positive in all four Stage-1 runtime replicates.

### Stage 2

| Replicate | V2↔V2 null mean pair diff | V3A↔V2 mean pair diff | Null-adjusted diff | Candidate favorable/neutral/unfavorable | Unresolved |
| --- | ---: | ---: | ---: | --- | ---: |
| 1 | 0.0000 | +0.2500 | +0.2500 | 3 / 13 / 0 | 0 |
| 2 | 0.0000 | +0.1250 | +0.1250 | 2 / 14 / 0 | 0 |
| 3 | 0.0000 | +0.2500 | +0.2500 | 3 / 13 / 0 | 0 |
| 4 | 0.0000 | +0.1875 | +0.1875 | 2 / 14 / 0 | 0 |

### Stage 3

All four V2↔V2 null controls and all four V3A↔V2 candidate runs are exactly neutral across all five pairs, with zero unresolved games.

## Runtime diagnostics

V3A keeps approximately 92–95% root-reuse coverage in the Stage-1/2 runtime runs and frequently solves roots early. Frozen V2 often consumes the whole soft deadline.

A repeated diagnostic anomaly appears in V2 inside the candidate matchups: occasional soft-deadline tail latency exceeds 600 ms, with observed maxima roughly 0.85–1.44 s depending on stage/replicate. V2↔V2 null controls are usually near 602–604 ms max. This is treated as a GC/scheduler/soft-deadline diagnostic, not as production-performance proof for V3A.

## Interpretation

The evidence supports the wording:

> V3A is a stable research candidate under the audited fixed-simulation and 600 ms runtime modes, with a small positive paired signal against frozen PUCT V2 and no observed Stage-3 regression. The evidence does not establish statistically independent superiority because the search paths consume no RNG and the positive signal is concentrated in a small number of discriminating corpus pairs.

This is stronger than the earlier wording "positive signal only", but it is still not a production-promotion verdict.

The next promotion gate is a direct paired comparison against the production Trạng Nguyên code path under its 1,200 ms / 100,000-node envelope, with a matching Trạng Nguyên null-control. Unless the deployed learning snapshot is supplied, that comparison must remain labeled `code-parity-no-live-learning-snapshot`.
