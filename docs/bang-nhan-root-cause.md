# Bảng Nhãn root-cause: opponent move ordering + selective pruning

## Scope

This report isolates why the server-production Bảng Nhãn baseline was losing 6/6 to both UCT and UCT-PB in the initial seat-balanced smoke tournament.

Production baseline is pinned to `TheGiver262/O_an_quan@4984701ce151ee270a6a5ba5fc9211a6ec2b6996`.

## Production behavior

Bảng Nhãn uses iterative-deepening Alpha-Beta with:

- search depth: 8
- second-player depth bonus: +3
- full-width depth: 2
- max branching moves: 5 (+ second-player branching bonus when applicable)
- node budget: 55,000
- time budget: 900 ms
- transposition cache and move ordering enabled

After `fullWidthDepth`, `orderSearchCandidates()` sorts candidates and then keeps only the first `maxBranchingMoves` entries.

At an opponent/minimizing node production sorts ordering scores ascending, but `moveOrderingScore()` still adds the mover's `candidate.immediateGain` as a positive term. Therefore a stronger immediate capture by the opponent receives a higher ordering score and is pushed later in the ascending list. Selective pruning can then remove the strongest opponent replies from the search tree.

## Concrete regression counterexample

The regression test `tests/bang-nhan-ordering-regression.test.ts` found a state where Bảng Nhãn, while modeling the opponent, keeps five replies that each gain 6 points but prunes two replies that each gain 11 points:

Kept by production ordering:

- `B1:CCW` — gain 6
- `B2:CW` — gain 6
- `B2:CCW` — gain 6
- `B3:CW` — gain 6
- `B3:CCW` — gain 6

Pruned by production ordering:

- `B1:CW` — gain 11
- `B5:CCW` — gain 11

This demonstrates that the issue is not merely theoretical: the selective-pruning boundary can discard materially more dangerous opponent replies.

## Isolated causal experiment

`src/research/bang-nhan-ordering-experiment.ts` preserves the Bảng Nhãn production pipeline and exposes two modes:

- `production-ordering`
- `fixed-opponent-ordering`

The isolated fix changes only one term at opponent nodes:

```ts
const immediateGain =
  orderingMode === "fixed-opponent-ordering" && !isAiTurn
    ? -candidate.immediateGain
    : candidate.immediateGain;
```

No depth, node budget, time budget, opening book, heuristic weights, endgame settings, branch cap, cache policy, or MCTS parameters were changed.

Before running the causal matches, `tests/bang-nhan-experiment-parity.test.ts` verifies that `production-ordering` matches the exact server-production baseline on a deterministic corpus for:

- selected move
- completed depth
- node count

The parity gate passed.

## Results

All matches use six games, alternating MCTS between P0 and P1, the same base seed, `production-max`, 900 ms per side, MCTS rollout depth 20, and the same MCTS configuration used by the previous smoke test.

| Research AI | Bảng Nhãn mode | MCTS wins | Bảng Nhãn wins | Draws | Unresolved |
|---|---|---:|---:|---:|---:|
| UCT | server production baseline | 6 | 0 | 0 | 0 |
| UCT | fixed opponent ordering | 3 | 3 | 0 | 0 |
| UCT-PB | server production baseline | 6 | 0 | 0 | 0 |
| UCT-PB | fixed opponent ordering | 3 | 2 | 0 | 1 |

Seat split is more diagnostic than the aggregate score:

### UCT

- baseline, MCTS as P0: 3/3 wins
- baseline, MCTS as P1: 3/3 wins
- fixed, MCTS as P0: 3/3 wins
- fixed, MCTS as P1: 0/3 wins; Bảng Nhãn wins 3/3

### UCT-PB

- baseline, MCTS as P0: 3/3 wins
- baseline, MCTS as P1: 3/3 wins
- fixed, MCTS as P0: 3/3 wins
- fixed, MCTS as P1: 0 wins, 2 losses, 1 unresolved at the 160-move cap

## Conclusion

The wrong-sign opponent ordering, combined with Bảng Nhãn's narrow selective-pruning cap, is a major causal reason for the 6/6 MCTS wins. Fixing that single ordering term removes every completed MCTS win from P1 in both UCT variants.

This does **not** explain or solve the remaining P0 advantage. After the ordering fix, MCTS still wins all six tested games in which it is P0. First-player/opening balance must therefore be analyzed separately.

## Production recommendation

Do not copy the experimental implementation wholesale into the game server. Apply the smallest production patch to the shared ordering logic, add the regression counterexample as a production test, then re-run parity and tournament checks.

A separate secondary issue should also be fixed/tested: the server search context accepts an override `nodeBudget`, but the production minimax budget check uses `context.profile.nodeBudget` instead of `context.nodeBudget`, so an explicit node-budget override can be ignored.
