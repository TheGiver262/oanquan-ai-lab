# Quan Gia + Positional Threefold — Research Verdict (2026-09-18)

## Scope

Research-only balance mode on branch `research/balanced-mode-tournament`.

- Base rules: `mature_quan_v1` (Quan Gia)
- No Pie/SWAP
- Positional repetition: third occurrence of the same Markov game position
  - same logical player to move
  - same P0/P1 scores
  - same stones + Quan stones in every pit
- Repetition adjudication keeps the existing research semantics:
  - collect remaining dan from owned dan pits
  - do not auto-collect live Quan
  - winner is determined from the resulting scores
- This is not a production-rule change.

## Exact-cycle regression

Canonical deterministic regression:
`tests/positional-threefold-cycle.test.ts`

The fixture is derived from the previously observed B3 long-cycle basin.

For both the CW trajectory and its exact left-right reflection:

- legacy `quan-gia-threefold` remains playing through the 74-move replay;
- `quan-gia-positional-threefold` stops at game `moveNumber = 37`;
- finish reason is `repeated_position`;
- P1 wins after the remaining-dan collection semantics are applied;
- the mirrored trajectory gives the same result.

The earlier cycle analyzer reported:
- first board-position repeat: move 28 -> 32, period 4;
- first repeat of its stricter diagnostic key (which also included recent-move context): move 34 -> 54, period 20;
- the original QG3F line remained unresolved at move 600 with score P0 27, P1 28.

These are not contradictory: Positional Threefold intentionally keys the Markov position, not the stricter analyzer key containing recent-move history.

## Reflection-fixed 20/20 rematch

Evaluator:
- reflection-canonical ModeAware PUCT V3A
- fixed 20,000 simulations per decision
- no wall-clock cutoff
- max 240 board moves
- 10 legal P0 opening moves x opener identity A/B = 20 games

Integrity:
- games: 20/20
- unresolved: 0
- reflection mismatches: 0/10
- A/B identity-result mismatches: 0/10
- self-play finishes by `repeated_position`: 0/20

Aggregate:
- opener wins: 4
- responder wins: 8
- draws: 8

| Opening | A opens | B opens | Opener margin A/B | Moves A/B | Finish A/B |
|---|---|---|---:|---:|---|
| B1:CW | RW | RW | -30 / -30 | 24 / 24 | both_quan_empty / both_quan_empty |
| B1:CCW | D | D | 0 / 0 | 28 / 28 | both_quan_empty / both_quan_empty |
| B2:CW | OW | OW | +57 / +57 | 55 / 55 | no_refill / no_refill |
| B2:CCW | D | D | 0 / 0 | 20 / 20 | both_quan_empty / both_quan_empty |
| B3:CW | RW | RW | -56 / -56 | 84 / 84 | both_quan_empty / both_quan_empty |
| B3:CCW | RW | RW | -56 / -56 | 84 / 84 | both_quan_empty / both_quan_empty |
| B4:CW | D | D | 0 / 0 | 20 / 20 | both_quan_empty / both_quan_empty |
| B4:CCW | OW | OW | +57 / +57 | 55 / 55 | no_refill / no_refill |
| B5:CW | D | D | 0 / 0 | 28 / 28 | both_quan_empty / both_quan_empty |
| B5:CCW | RW | RW | -30 / -30 | 24 / 24 | both_quan_empty / both_quan_empty |

Symmetry classes:

- responder-favored:
  - `B1:CW <-> B5:CCW`
  - `B3:CW <-> B3:CCW`
- opener-favored:
  - `B2:CW <-> B4:CCW`
- draw:
  - `B1:CCW <-> B5:CW`
  - `B2:CCW <-> B4:CW`

## Interpretation

Positional Threefold is now a well-defined and regression-tested research rule, but this 20k self-play batch does not show it solving opening balance.

It also does not invalidate the separate tactical-resource evidence for B3. In the earlier forced-resource study, three two-deviation B3 defenses survived 100k simulations per decision across CW/CCW reflection and A/B identity, 12/12 cases ending 35-35. Therefore the current top-line B3 self-play loss should be read as a search-discovery problem, not as proof that the B3 symmetry class is game-theoretically lost.

## Canonical evidence

- GitHub Actions rematch run: `35309638629`
- Rematch summary artifact: `qg-positional-threefold-summary`
- Exact-cycle regression CI: `35311515272`
- Exact-cycle regression commit: `d6c17d1bab90b5f2a541dc85b920c734536450f1`
- Deterministic cycle workflow cleanup commit follows the regression and replaces the obsolete PUCT-dependent forced-cycle assertion.
