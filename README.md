# oanquan-ai-lab

Standalone, open-source research lab for **Ô Ăn Quan** AI.

The repository intentionally contains only the classic 2-player rules/search surface, production-reference AI code, experimental algorithms, benchmarks, CLI utilities and tests. It does **not** contain the production web app, auth, lobby, database, assets or deployment infrastructure.

## What this lab is for

- Compare minimax / alpha-beta and experimental search algorithms on identical states.
- Inspect and rank legal moves.
- Run deterministic self-play and seat-balanced tournaments.
- Measure first-player advantage and opening concentration.
- Test Pie Rule / alternative opening rules.
- Run `perft` and parity tests to detect engine/search regressions.
- Test MCTS or future solvers against the actual top production AI behavior without modifying the game repo.

## Production reference

The server-production reference is pinned to:

```text
TheGiver262/O_an_quan
commit 73c698762c514d171869a79982fdc86103653e8f
```

The top-three reference behavior mirrors `apps/server/src/match/classic-ai-player.ts`, not the older browser-only approximation.

- **Thám Hoa** and **Bảng Nhãn** use the production iterative-deepening alpha-beta pipeline, opening book, move ordering, transposition cache and their production budgets.
- **Trạng Nguyên** uses the production `searchTrangNguyenBestFirst(...)` path, including root W/D/L bounds and optional learning-based root filtering.
- `tests/server-production-parity.test.ts` ports production invariants/expected moves as parity guards.

### `production-live` vs `production-max`

`production-live` preserves intentional production mistake rates:

- Thám Hoa: 5%
- Bảng Nhãn: 1%
- Trạng Nguyên: 0%

`production-max` suppresses the intentional Thám Hoa/Bảng Nhãn mistakes while leaving the search budgets and algorithm unchanged.

Trạng Nguyên learning memory is file-backed in the real server. The lab accepts a snapshot with `--learning-file <snapshot.json>`. If no snapshot is supplied, a Trạng Nguyên result is explicitly marked:

```text
baselineIntegrity: code-parity-no-live-learning-snapshot
```

Do **not** call that result a complete live-strength comparison if the deployed server currently has `OAQ_TRANG_NGUYEN_LEARNING_PATH` enabled. With a matching snapshot loaded, the result can be marked `full-code-parity`.

## Setup

```bash
npm install
npm test
npm run typecheck
npm run build
```

## Research benchmark against server production AI

```bash
npm run benchmark:server -- \
  --variant uct-pb \
  --opponent trang-nguyen \
  --production-mode production-live \
  --games 20
```

Maximum-strength comparison for Thám Hoa/Bảng Nhãn:

```bash
npm run benchmark:server -- \
  --variant uct-pb \
  --opponent bang-nhan \
  --production-mode production-max \
  --games 20
```

With a Trạng Nguyên learning snapshot:

```bash
npm run benchmark:server -- \
  --variant uct-pb \
  --opponent trang-nguyen \
  --production-mode production-live \
  --learning-file ./fixtures/trang-nguyen-learning-v1.json \
  --games 20
```

Every tournament alternates the research AI between P0 and P1.

## Current top production profiles

| ID | Name | Base depth | P1 bonus | Nodes | Time | Extra |
|---|---|---:|---:|---:|---:|---|
| `tham-hoa` | Thám Hoa | 6 | +3 | 36,000 | 600 ms | opening book, TT, ordering, P1 branching +2 |
| `bang-nhan` | Bảng Nhãn | 8 | +3 | 55,000 | 900 ms | opening book, TT, ordering, endgame +2 |
| `trang-nguyen` | Trạng Nguyên | 11 | +5 | 100,000 | 1,200 ms | best-first root search, endgame +4, optional learning |

## Current research status

- **PUCT V3A.1 material36** is the current validated research incumbent.
- V3A.1 fixes the validated V3A early/midgame score-horizon bias while remaining non-regressive against V3A across the promoted 10k/20k/50k fixed-simulation corpus.
- V4/V4B/V4C selective one-ply quiescence is closed and rejected after reproducing the same reflection-consistent LQ@6 regression.
- V5-A/V5-B retained transposition-graph search is also closed: no strength gain across 10k/20k/50k, ~24–28% timing overhead, and V5-B hit a ~6 GB heap OOM on one 100k target.
- PVS/NegaScout is historical only and excluded from active evaluation.
- The active baseline for future challengers is V3A.1. Do not continue the closed one-ply bootstrap or retained full-graph families without a new causal/architectural mechanism.
- Balance/B3 evidence remains available as canonical audit and validation documents.

See `docs/research/CANONICAL_RESEARCH_INDEX_2026-09-18.md` for the authoritative list of current evidence and reproducible workflows.

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

The generic CLI/search layer remains an independent research implementation. For claims about the strength of the game’s top bots, use the **server-production benchmark** rather than the generic lab profile alone.

### Pie Rule semantics used by the lab

For each first move `X` made by opener A:

- **KEEP**: A remains P0; responder B remains P1 and moves next.
- **SWAP**: identities swap seats; the board does not rotate. A becomes P1 and, because the engine state is already on P1's turn after the opening, A moves next.
- `guaranteed = min(KEEP, SWAP)` from the original opener's perspective.

The opener is assumed to choose the move maximizing this worst-case value.

## Project layout

```text
src/
  engine.ts
  search.ts
  analysis.ts
  cli.ts
  research/
    puct-v3a.ts
    puct-v3a1.ts
    mode-aware-puct-v3a.ts
    mode-aware-puct-v3a1.ts
    resource-aware-puct-v3a.ts
    balance-modes.ts
    ...historical/auxiliary research engines
  reference/
    production-ai.ts
    server-production-ai.ts
    trang-nguyen-best-first-search.ts
    trang-nguyen-learning.ts
  benchmarks/
    research-vs-production.ts
    research-vs-server-production.ts
    balance-mode-v3a-selfplay.ts
    double-forced-deviation-selfplay.ts
    b3-resource-aware-selfplay.ts
    r1d-production-semantics-v3a-vs-trang-nguyen.ts
    v3a-challenger-tournament.ts
tests/
  ...engine, parity, PUCT, balance and positional-cycle regressions
docs/research/
  CANONICAL_RESEARCH_INDEX_2026-09-18.md
  ...canonical verdict/protocol documents
results/
  .gitkeep
```

Committed benchmark outputs are intentionally not kept in `results/`. Temporary execution outputs belong in GitHub Actions artifacts; durable conclusions belong in canonical research documents. Closed one-off experiments are removed once their verdict is consolidated.

## Research rules

1. Pin every production reference to a source commit.
2. Pass parity tests before interpreting tournament results.
3. Alternate P0/P1 evenly.
4. Give compared algorithms explicit, reported time/node budgets.
5. Report unresolved games instead of silently scoring them as draws.
6. Never label a Trạng Nguyên comparison “full live strength” without the deployed learning snapshot when learning is enabled.

## License

MIT.
