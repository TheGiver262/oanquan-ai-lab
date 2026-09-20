# Historical research summary — 2026-09-21

This document preserves only the durable conclusions from research that has been removed from the active code surface.

## Early MCTS and production-ordering work

Early UCT/UCT-PB tournaments were useful for exposing a production selective-ordering weakness in the iterative Alpha-Beta profiles, especially Bảng Nhãn/Thám Hoa. Those MCTS implementations, causal ordering experiments and dedicated parity tests are no longer part of the active algorithm track and have been removed.

The production-reference parity guard itself remains because it is still operationally relevant.

## Opening-balance V2/V3/V4 and PVS

The older opening-convergence track used Negamax/PVS and exact/cyclic endgame experiments to study Standard opening bias and repeated states. It established that Standard has meaningful seat/opening bias and that the game graph contains genuine cycles.

PVS/NegaScout was later explicitly excluded from active evaluation. The implementation, tests and intermediate opening reports were removed. Current mode research is governed by the dual target-mode protocol instead.

## R1 / V3A / B3 intermediate work

The R1 and B3 sequence isolated the important Standard PUCT failure: temporary early/midgame `scoreDelta` could dominate heuristic leaves and redirect root visits toward inferior branches.

The durable causal record is retained in:
- `B3_PUCT_ROOT_CAUSE_AUDIT_2026-09-18.md`
- `V3A1_MATERIAL36_PROMOTION_VERDICT_2026-09-18.md`

Intermediate R1 protocols, fair-resource reports, ResourceAware rescue code, corpus generators and one-off workflows were removed after consolidation.

## V4 selective one-ply family

V4/V4B/V4C failed their Standard promotion gate. Only the consolidated report is retained:
- `V4_QUIESCENCE_FAMILY_CLOSED_2026-09-18.md`

No V4 implementation, dedicated test, benchmark or workflow is retained.

## V5 retained transposition graph family

V5-A/V5-B failed the Standard promotion criteria: graph reuse did not produce validated strength gain, added substantial runtime overhead, and V5-B showed poor high-budget memory scaling.

Only the consolidated report is retained:
- `V5_TRANSPOSITION_GRAPH_REJECTION_2026-09-19.md`

No V5 implementation, dedicated benchmark or workflow is retained.

## Positional Threefold experiment

The positional-repetition variant is not a current target. Its durable conclusion remains in:
- `QG_POSITIONAL_THREEFOLD_VERDICT_2026-09-18.md`

The implementation-specific regression test and workflows were removed.

## Current direction

Future research uses both:
- Pie + Threefold
- Quan Gia + Threefold

Standard is a historical control. Old Standard-only verdicts remain valid within that scope but do not decide the two target modes.
