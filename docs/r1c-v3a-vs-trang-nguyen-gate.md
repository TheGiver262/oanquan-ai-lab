# R1c — V3A vs production Trạng Nguyên promotion gate

Status: pre-registered research benchmark. This document does not authorize a production merge or deployment.

## Purpose

Evaluate whether PUCT V3A remains a credible research promotion candidate when compared directly with the current production Trạng Nguyên code path under the production latency envelope.

This gate is intentionally separate from R1b rules research. The ruleset is frozen to `oaq:classic_2p:standard:v1`.

## Production parity basis

- Production behavior source carried by the lab reference: `73c698762c514d171869a79982fdc86103653e8f`.
- Latest audited production head: `ead93ca80d6c80a3ee8d16c615f74a3281f59320`.
- Compare `73c6987...ead93ca` contains four commits and no changes to classic engine transitions, legal moves, rulesets, state hashing, replay/persistence semantics, or `apps/server/src/match/classic-ai-player.ts`.
- Therefore the copied production Trạng Nguyên behavior remains parity-valid for this gate without rewriting the reference implementation.

The deployed learning snapshot is not stored in the repository. Production documentation references the VPS path `/home/deploy/o-an-quan-data/trang-nguyen-learning-v1.json`. Unless that exact deployed snapshot is supplied separately, every result from this gate must be labeled:

`code-parity-no-live-learning-snapshot`

It must not be described as a complete live-strength comparison.

## Corpus

Use the already-audited R1c corpora only:

- Stage 1: 16 opening+reply positions generated from `B3:CW` and `B3:CCW`.
- Stage 2: 16 balanced live-Quan positions from `LIVE_QUAN_BALANCED_POSITIONS`.
- Stage 3: 5 preselected low-material/cycle-sensitive positions:
  - `B3:CW:material@12`
  - `B3:CW:material@14`
  - `B3:CW:material@19`
  - `B3:CCW:strategic@16`
  - `B3:CCW:strategic@19`

Every exact position is played twice, swapping V3A/candidate ownership between P0 and P1.

## Resource mode

Primary gate: production-envelope wall clock.

- V3A: 1,200 ms per decision, deliberately high simulation ceiling so time is the active resource gate unless the root is solved earlier.
- Trạng Nguyên: production 100,000-node cap and 1,200 ms time cap.
- Trạng Nguyên mistake rate is already 0%; `production-live` and `production-max` differ only if learning state is supplied, so this gate uses the production code path with no learning reader.

Node counts and PUCT simulations are diagnostics only. They are not treated as equivalent units of work.

## Runtime-control protocol

For each stage run two matchups in the same workflow:

1. `tn-null`: Trạng Nguyên vs the identical Trạng Nguyên reference, with candidate seat attribution swapped exactly like the real comparison.
2. `v3a-vs-tn`: V3A vs Trạng Nguyên.

Both searches are deterministic in algorithmic logic, but time-budget cutoffs can vary with runner scheduling/JIT/GC. Therefore repeated workflow runs are runtime replicates, not stochastic seeds.

## Metrics

Report independently for each stage and matchup:

- games, W/L/D/unresolved;
- resolved score rate;
- completed pairs;
- pair differential per position;
- mean/median pair differential;
- favorable/neutral/unfavorable pairs;
- P50/P95/P99/max decision latency;
- V3A simulations, reuse rate, cycle cutoffs, solved roots;
- Trạng Nguyên nodes, completed depth, time/node budget exhaustion counts.

Unresolved games are censored and never heuristic-adjudicated as draws.

## Promotion interpretation

The first runtime replicate is a hygiene gate, not a promotion verdict.

Proceed to additional runtime replicates only if:

- zero illegal moves;
- no state/replay/corpus invariant failure;
- unresolved remains acceptably low;
- null-control does not show pathological outcome drift.

V3A is not "meaningfully stronger" merely because raw score exceeds 50%. A stronger claim requires stable paired advantage across the corpus and resource modes, with uncertainty explicitly reported. Even a successful result here only qualifies V3A for further production review; it does not authorize merge or deploy.
