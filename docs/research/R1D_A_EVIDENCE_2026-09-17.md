# R1d-A exact-production evidence archive — 2026-09-17

This file preserves the verdict-relevant evidence extracted from the R1d-A GitHub Actions logs before the heavy workflow runs/artifacts are deleted.

## Provenance and methodology

- Experiment: `R1d-A-v3a-vs-production-trang-nguyen-legacy-no-repeat`.
- Source runs: `34978920546` (replicate 1 gate) and `34980320282` (replicates 2–4).
- Ruleset: `oaq:classic_2p:standard:v1`.
- Production behavior source: `73c698762c514d171869a79982fdc86103653e8f`.
- Latest audited production head recorded by the benchmark: `ead93ca80d6c80a3ee8d16c615f74a3281f59320`.
- Trạng Nguyên baseline integrity: `code-parity-no-live-learning-snapshot`; `learningSnapshotLoaded=false`.
- Exact audited legacy production semantics: `repeated_moves` termination disabled; `recentMoves` does not terminate games.
- Resource envelope: V3A `1200 ms` wall clock with `5,000,000` simulation ceiling; Trạng Nguyên `100,000` node cap plus `1200 ms` wall-clock guard.
- Pairing: every exact position is played twice with candidate ownership swapped P0/P1.
- Unresolved games are censored at the stage move cap and never heuristic-adjudicated. Any pair containing an unresolved game is excluded from pair statistics.
- Runtime replicates are jitter/resource robustness checks, **not independent stochastic seeds**.
- Trạng Nguyên nodes and V3A simulations are diagnostics, not equivalent units of work.

Replicate 1 executed from benchmark checkout `d6dffa51a9a87cccbc2542d922f3ca6946b88e99`; replicates 2–4 executed from `888e933c8cf2c2388f6ebc50a67cd6d2e6361fe2`.

## V3A vs Trạng Nguyên — primary paired results

| Rep | Stage | W | L | D | U | completed pairs | meanPairDiff | median | favorable | neutral | unfavorable |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | S1 | 20 | 10 | 0 | 2 | 14 | +0.5714 | 0 | 4 | 10 | 0 |
| 1 | S2 | 20 | 7 | 5 | 0 | 16 | +0.8125 | +0.5 | 8 | 8 | 0 |
| 1 | S3 | 4 | 2 | 4 | 0 | 5 | +0.4000 | 0 | 2 | 3 | 0 |
| 2 | S1 | 20 | 9 | 0 | 3 | 13 | +0.6154 | 0 | 4 | 9 | 0 |
| 2 | S2 | 20 | 7 | 5 | 0 | 16 | +0.8125 | +0.5 | 8 | 8 | 0 |
| 2 | S3 | 4 | 2 | 4 | 0 | 5 | +0.4000 | 0 | 2 | 3 | 0 |
| 3 | S1 | 20 | 10 | 0 | 2 | 14 | +0.5714 | 0 | 4 | 10 | 0 |
| 3 | S2 | 21 | 7 | 4 | 0 | 16 | +0.8750 | +0.5 | 8 | 8 | 0 |
| 3 | S3 | 4 | 2 | 4 | 0 | 5 | +0.4000 | 0 | 2 | 3 | 0 |
| 4 | S1 | 20 | 9 | 0 | 3 | 13 | +0.6154 | 0 | 4 | 9 | 0 |
| 4 | S2 | 20 | 7 | 5 | 0 | 16 | +0.8125 | +0.5 | 8 | 8 | 0 |
| 4 | S3 | 4 | 2 | 4 | 0 | 5 | +0.4000 | 0 | 2 | 3 | 0 |

No completed pair is unfavorable to V3A in any of the 12 candidate jobs.

### Pair-diff vectors

Vectors below are emitted in benchmark corpus order after pairs containing unresolved games are excluded.

- R1 S1: `[2,0,0,0,0,2,0,0,0,0,2,0,0,2]`
- R1 S2: `[1,0,2,0,1,2,2,0,0,2,0,0,1,2,0,0]`
- R1 S3: `[0,0,1,1,0]`
- R2 S1: `[2,0,0,2,0,0,0,0,2,0,0,0,2]`
- R2 S2: `[1,0,2,0,1,2,2,0,0,2,0,0,1,2,0,0]`
- R2 S3: `[0,0,1,1,0]`
- R3 S1: `[2,0,0,0,2,0,0,0,0,2,0,0,0,2]`
- R3 S2: `[1,0,2,0,2,2,2,0,0,2,0,0,1,2,0,0]`
- R3 S3: `[0,0,1,1,0]`
- R4 S1: `[2,0,0,0,2,0,0,0,0,2,0,0,2]`
- R4 S2: `[1,0,2,0,1,2,2,0,0,2,0,0,1,2,0,0]`
- R4 S3: `[0,0,1,1,0]`

### Stage-1 unresolved cases

All unresolved games reached the `158` continuation-move cap, were on candidate seat `P1`, and were excluded from pair statistics.

- R1: `B3:CCW>T2:CCW`, `B3:CCW>T4:CW`.
- R2: `B3:CW>T2:CCW`, `B3:CW>T4:CW`, `B3:CCW>T2:CCW`.
- R3: `B3:CW>T2:CCW`, `B3:CCW>T2:CCW`.
- R4: `B3:CW>T4:CW`, `B3:CCW>T2:CCW`, `B3:CCW>T4:CW`.

Stages 2 and 3 had zero unresolved games in all four replicates.

## Trạng Nguyên ↔ Trạng Nguyên null controls

| Rep | Stage | W | L | D | U | pairs | meanPairDiff | favorable | neutral | unfavorable |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | S1 | 16 | 16 | 0 | 0 | 16 | 0 | 0 | 16 | 0 |
| 1 | S2 | 14 | 14 | 4 | 0 | 16 | 0 | 0 | 16 | 0 |
| 1 | S3 | 3 | 3 | 4 | 0 | 5 | 0 | 0 | 5 | 0 |
| 2 | S1 | 16 | 16 | 0 | 0 | 16 | 0 | 0 | 16 | 0 |
| 2 | S2 | 14 | 14 | 4 | 0 | 16 | 0 | 0 | 16 | 0 |
| 2 | S3 | 3 | 3 | 4 | 0 | 5 | 0 | 0 | 5 | 0 |
| 3 | S1 | 16 | 16 | 0 | 0 | 16 | 0 | 0 | 16 | 0 |
| 3 | S2 | 14 | 14 | 4 | 0 | 16 | 0 | 0 | 16 | 0 |
| 3 | S3 | 3 | 3 | 4 | 0 | 5 | 0 | 0 | 5 | 0 |
| 4 | S1 | 16 | 16 | 0 | 0 | 16 | 0 | 0 | 16 | 0 |
| 4 | S2 | 14 | 14 | 4 | 0 | 16 | 0 | 0 | 16 | 0 |
| 4 | S3 | 3 | 3 | 4 | 0 | 5 | 0 | 0 | 5 | 0 |

Every null-control pairDiff is exactly `0`.

## Search/runtime diagnostics retained from candidate jobs

`V3A ms` and `TN ms` are average latency per decision; `p95` is p95 decision latency. `sims` and `nodes` are totals. `reuse` is V3A reuse rate. `cycles` is V3A cycle-cutoff count. TN depth is average completed depth.

| Rep | Stage | V3A ms | V3A p95 | V3A max | sims | reuse | cycles | solved | TN ms | TN p95 | TN max | TN nodes | TN depth/max |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
|1|S1|801.7|1200.9|1205.6|168855273|0.9380|161366472|179|415.1|446.9|686.7|51157734|3.50/15|
|1|S2|717.8|1202.4|1207.6|32556678|0.8971|1068113|133|468.2|564.2|689.0|30900053|3.69/11|
|1|S3|731.6|1201.8|1206.7|15648006|0.8387|1056716|26|442.9|518.1|796.6|6308174|4.05/10|
|2|S1|860.6|1201.4|1215.0|251715336|0.9428|245274278|165|457.8|559.8|685.9|55257734|3.28/15|
|2|S2|711.3|1201.7|1205.6|32480831|0.8951|1203707|130|465.9|569.6|741.3|30400053|3.69/11|
|2|S3|739.2|1201.2|1202.4|16050871|0.8387|1101003|24|470.6|552.7|579.1|6308174|4.05/10|
|3|S1|807.9|1201.0|1207.5|175758527|0.9369|168532276|173|435.2|487.4|704.3|50057734|3.45/15|
|3|S2|703.9|1201.0|1202.7|37878014|0.9056|1925331|147|349.6|395.9|760.8|33800025|3.84/11|
|3|S3|736.7|1201.6|1204.0|15711205|0.8387|990331|25|448.3|564.0|603.7|6308174|4.05/10|
|4|S1|859.2|1201.3|1212.5|235807624|0.9440|228884837|169|427.3|488.8|626.0|56657734|3.32/15|
|4|S2|728.9|1201.4|1422.7|35060701|0.9050|1286146|141|413.8|447.5|923.9|33700025|3.76/11|
|4|S3|728.9|1201.7|1202.9|15998180|0.8387|1116717|26|424.9|461.6|524.7|6308174|4.05/10|

All candidate jobs reported V3A `timeBudgetExhaustions=0` and `nodeBudgetExhaustions=0`; TN was predominantly capped by the 100k node budget, as expected for this benchmark envelope.

Null-control runtime latency remained symmetric between the two identical TN sides. Average decision latency A/B by replicate was: S1 `395.6/395.6`, `323.0/322.7`, `239.5/238.5`, `410.5/410.0` ms; S2 `392.3/392.1`, `383.1/382.5`, `408.7/408.2`, `410.7/410.5` ms; S3 `380.8/381.9`, `381.5/379.8`, `309.0/308.7`, `308.1/307.7` ms. Null-control node totals/depths were identical by side within each job: S1 `36.9M`, avg depth `3.079`, max `10`; S2 `35.4M`, avg depth `3.559`, max `9`; S3 `6.508M`, avg depth `3.667`, max `8`.

## Corpus ordering used by pair vectors

- S1: `B3:CW>T1:CW`, `B3:CW>T1:CCW`, `B3:CW>T2:CW`, `B3:CW>T2:CCW`, `B3:CW>T4:CW`, `B3:CW>T4:CCW`, `B3:CW>T5:CW`, `B3:CW>T5:CCW`, `B3:CCW>T1:CW`, `B3:CCW>T1:CCW`, `B3:CCW>T2:CW`, `B3:CCW>T2:CCW`, `B3:CCW>T4:CW`, `B3:CCW>T4:CCW`, `B3:CCW>T5:CW`, `B3:CCW>T5:CCW`.
- S2: 16 live-Quan positions `LQ@4` through `LQ@11` from the canonical `v3-live-quan` corpus, in benchmark order.
- S3: `B3:CW:material@12`, `B3:CW:material@14`, `B3:CW:material@19`, `B3:CCW:strategic@16`, `B3:CCW:strategic@19`.

## Storage-cleanup note

R1d-B corrected-repeat evidence is already retained in committed repo history at `docs/research/R1_CANONICAL_RESULTS_2026-09-16.md` on branch `research/r1c-repeat-parity` (commit `7c23553b0acf10c00a91c5dbfa8451a83368d430`). That archive preserves R1d-B reps 1–4, null controls, pair vectors, unresolved status and interpretation.

With this R1d-A archive committed, the heavy Actions runs `34978920546`, `34980320282`, `34817344495`, and `34818104961` are disposable storage rather than the sole evidence source.

## Evidence-only interpretation

Under audited exact production/no-repeat semantics, V3A has positive completed-pair evidence in every required stratum across all four runtime replicates, with zero unfavorable completed pairs. Stage 1 retains a small censored/unresolved tail (2–3 games of 32 per replicate); Stages 2 and 3 resolve completely. All TN↔TN null controls are exactly pair-neutral. This section records evidence only; final promotion scope must still respect the baseline-integrity limitation above and the promotion protocol guards.
