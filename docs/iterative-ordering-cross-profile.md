# Cross-profile diagnosis: opponent ordering and selective pruning

## Scope

This note checks whether the Bảng Nhãn opponent-ordering bug documented in `docs/bang-nhan-root-cause.md` also explains the behavior of the other top production AI profiles in the frozen AI Lab snapshot.

The production snapshot remains pinned to `TheGiver262/O_an_quan@4984701ce151ee270a6a5ba5fc9211a6ec2b6996`.

No change in this investigation modifies `TheGiver262/O_an_quan`. All code, tests, workflows, and experiments live only in `TheGiver262/oanquan-ai-lab`.

## Profiles in the frozen snapshot

The current top-production profile list is:

- `tham-hoa`
- `bang-nhan`
- `trang-nguyen`

There is no `tien-si` entry in this frozen top-production snapshot, so this investigation does not invent or infer a Tiến Sĩ implementation.

## Server search routing

`chooseServerProductionMoveWithDiagnostics()` uses two distinct search architectures:

| Difficulty | Server search path | Selective branch cap used by iterative Alpha-Beta? |
|---|---|---|
| Thám Hoa | iterative Alpha-Beta | yes |
| Bảng Nhãn | iterative Alpha-Beta | yes |
| Trạng Nguyên | best-first search | no |

Thám Hoa and Bảng Nhãn therefore share the same `orderSearchCandidates()` / `moveOrderingScore()` behavior. At minimizing/opponent nodes, the production ordering sorts ascending while the mover's `candidate.immediateGain` remains a positive term. After `fullWidthDepth`, only the first `maxBranchingMoves` candidates are kept.

This is the same logical defect already demonstrated for Bảng Nhãn.

Trạng Nguyên is different. Its best-first search obtains all `legalMoves()` and recursively evaluates all children at each expanded node. It does not apply the iterative Alpha-Beta `slice(maxBranchingMoves)` selective-pruning mechanism, so it is not affected by this specific wrong-sign-plus-selective-pruning failure mode.

This does not prove Trạng Nguyên has no other search defects; it only excludes this specific mechanism.

## Thám Hoa production parameters relevant to the test

- base search depth: 6
- second-player depth bonus: +3
- full-width depth: 2
- max branching moves: 6
- second-player branching bonus: +2
- node budget: 36,000
- time budget: 600 ms

Compared with Bảng Nhãn, Thám Hoa has a wider selective branch cap and a shallower search.

## Parity gate

`tests/tham-hoa-experiment-parity.test.ts` verifies that the research experiment in `production-ordering` mode matches the exact server-production Thám Hoa baseline on a deterministic corpus for:

- selected move
- completed depth
- node count

The parity gate passed before running the causal tournament.

## Isolated causal tournament

`src/benchmarks/tham-hoa-ordering-causal.ts` compares:

1. exact server-production Thám Hoa (`production-max`), and
2. the same iterative search with only one isolated change: negate `candidate.immediateGain` when ordering opponent nodes.

No search depth, branch cap, node budget, heuristic weight, opening-book policy, MCTS rollout depth, or other strength parameter is intentionally changed.

Each condition uses:

- 6 games
- alternating MCTS seat (3 as P0, 3 as P1)
- deterministic seeds
- 600 ms per side
- MCTS rollout depth 20
- 100,000 simulation cap
- 160-move unresolved cap

### Results

| Research AI | Thám Hoa mode | MCTS wins | Thám Hoa wins | Draws | Unresolved |
|---|---|---:|---:|---:|---:|
| UCT | server production baseline | 3 | 3 | 0 | 0 |
| UCT | fixed opponent ordering | 3 | 3 | 0 | 0 |
| UCT-PB | server production baseline | 3 | 3 | 0 | 0 |
| UCT-PB | fixed opponent ordering | 3 | 3 | 0 | 0 |

The seat split is identical in all four conditions:

- MCTS as P0: 3/3 wins
- MCTS as P1: 0/3 wins; Thám Hoa wins 3/3

In other words, P0 won every tested game in every Thám Hoa condition.

The isolated ordering fix did alter some trajectories, move counts, completed-depth averages, and node counts, but it did not change a winner in this six-game smoke sample.

## Comparison with Bảng Nhãn

The same isolated fix had a large outcome-level effect on Bảng Nhãn:

| Research AI | Bảng Nhãn baseline | Fixed opponent ordering |
|---|---|---|
| UCT | MCTS 6-0 | 3-3 |
| UCT-PB | MCTS 6-0 | MCTS 3, Bảng Nhãn 2, 1 unresolved |

For Bảng Nhãn, every completed MCTS-as-P1 win disappeared after the fix.

For Thám Hoa, MCTS was already 0/3 as P1 before the fix, so there was no corresponding winner-level exploit to remove in this sample.

## Conclusion

Three conclusions are supported by the current evidence:

1. **The wrong-sign opponent ordering defect exists on both iterative Alpha-Beta profiles, Thám Hoa and Bảng Nhãn.** They share the same production ordering logic.
2. **The defect is a major causal weakness for Bảng Nhãn, but not an outcome-level cause in the current six-game Thám Hoa smoke test.** Thám Hoa's winners were unchanged by the isolated fix.
3. **Trạng Nguyên is not affected by this specific selective-pruning bug because its server path uses a different best-first search and does not truncate internal legal moves with the iterative branch cap.**

A plausible explanation for the difference between Thám Hoa and Bảng Nhãn is that Thám Hoa's wider branch allowance (`6`, plus `+2` for P1) and shallower search make the wrong ordering less destructive than Bảng Nhãn's narrower cap of `5`. This is a hypothesis consistent with the architecture and results; the present experiment does not prove that mechanism by itself.

The much stronger signal across the Thám Hoa results is seat advantage: P0 won all 24 games across the four six-game conditions. Combined with the post-fix Bảng Nhãn results, first-player/opening balance should be treated as a separate research problem from opponent-ordering correctness.

## Production status

No production patch is applied or proposed by this branch. `TheGiver262/O_an_quan` remains untouched.

If a future production change is explicitly authorized, the safe implementation target would be the shared iterative Alpha-Beta opponent-ordering logic so Thám Hoa and Bảng Nhãn remain consistent. Trạng Nguyên should not be modified for this specific bug without separate evidence.
