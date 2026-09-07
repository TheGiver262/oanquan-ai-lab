# oanquan-ai-lab

Standalone, open-source research lab for **Ô Ăn Quan** AI.

This repository is intentionally small: it contains only the classic 2-player engine needed for deterministic search, the seven AI difficulty profiles used by the main game, search/analysis code, a CLI, tests and benchmark-oriented utilities. It does **not** contain the production web app, server, auth, database, assets or private infrastructure.

## What this lab is for

- Compare minimax and alpha-beta search on identical game states.
- Inspect and rank every legal move from a position.
- Re-run the seven difficulty profiles in a standalone environment.
- Run deterministic self-play and round-robin tournaments.
- Measure first-player advantage and opening concentration.
- Test the **Pie Rule** for competitive balance.
- Run `perft` to detect engine/search regressions.
- Add experimental solvers such as MCTS, negamax, tablebases or learned evaluators without touching production code.

## Parity note

The board rules and move application in this repository are derived from the current classic 2-player production engine (`classic_v1`, quan value 10, refill cost 5, standard/no-first-quan/mature-quan rule profiles).

The seven AI profile values are mirrored from the current local AI configuration as of September 2026.

The lab search implementation is intentionally independent and inspectable. It is **not yet guaranteed to be byte-for-byte decision-compatible** with production `apps/web/src/game/ai-player.ts`, because production also contains opening-book/endgame and tuning details. Before the main game imports this package, export a production parity corpus and make the regression suite pass.

## Setup

```bash
npm install
npm test
npm run typecheck
npm run build
```

## CLI

```bash
npm run cli -- profiles
npm run cli -- suggest --state initial --level trang-nguyen --top 10
npm run cli -- evaluate --state initial --move B3:CW --level trang-nguyen
npm run cli -- match --p0 trang-nguyen --p1 bang-nhan --games 100 --swap-sides --depth 4
npm run cli -- tournament --games 4 --depth 2
npm run cli -- openings --level trang-nguyen --depth 6
npm run cli -- pie --level trang-nguyen --depth 6
npm run cli -- perft --depth 1
```

Search overrides are available via `--algorithm minimax|alpha-beta`, `--depth`, `--nodes`, and `--time`.

### Pie Rule semantics used by the lab

For each first move `X` made by opener A:

- **KEEP**: A remains P0; responder B remains P1 and moves next.
- **SWAP**: identities swap seats; the board does not rotate. A becomes P1 and, because the engine state is already on P1's turn after the opening, A moves next.
- `guaranteed = min(KEEP, SWAP)` from the original opener's perspective.

The opener is assumed to choose the move maximizing this worst-case value. This directly tests whether search can find an opening that stays favorable even when the opponent gets the swap option.

## Seven AI levels

| ID | Name | Base depth | P1 depth bonus | Node budget | Time budget |
|---|---|---:|---:|---:|---:|
| `thu-sinh` | Thư sinh | 0 | 0 | 300 | 20 ms |
| `tu-tai` | Tú Tài | 0 | 0 | 600 | 30 ms |
| `cu-nhan` | Cử nhân | 0 | 0 | 1,200 | 40 ms |
| `tien-si` | Tiến sĩ | 4 | 1 | 20,000 | 120 ms |
| `tham-hoa` | Thám hoa | 6 | 2 | 24,000 | 450 ms |
| `bang-nhan` | Bảng nhãn | 7 | 2 | 28,000 | 650 ms |
| `trang-nguyen` | Trạng nguyên | 11 | 5 | 100,000 | 1,000 ms |

## Project layout

```text
src/
  engine.ts       deterministic classic 2P rules + legal moves + state hash
  types.ts        standalone domain types
  profiles.ts     seven AI profiles
  search.ts       minimax / alpha-beta + heuristic evaluation
  analysis.ts     self-play, tournament, opening, Pie Rule, perft
  cli.ts          research CLI
  index.ts        public exports
tests/
  engine.test.ts
  ai.test.ts
results/
  .gitkeep
```

## Recommended next experiments

1. Production parity corpus: export 100-1,000 representative states and expected rankings.
2. Full-width minimax vs alpha-beta benchmark: nodes, cutoffs and NPS.
3. Transposition-table exact/lower/upper bounds and cached best-move ordering.
4. Opening entropy over first 2/4/6 plies.
5. Deeper seat-aware Pie Rule solving.
6. MCTS behind the same search interface.
7. Endgame tablebases for exact validation.

## License

MIT.
