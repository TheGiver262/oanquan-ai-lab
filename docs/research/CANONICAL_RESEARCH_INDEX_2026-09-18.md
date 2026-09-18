# Canonical Research Index — 2026-09-18

This file defines the research surface that should be treated as current on
`research/balanced-mode-tournament`.

## Active research

### B3 search-discovery / rescue

Goal: determine whether PUCT can discover the validated B3 defensive resources
without forcing known moves.

Canonical fair-validation verdict:
- `docs/research/B3_FAIR_RESOURCE_VALIDATION_2026-09-18.md`
- `src/benchmarks/b3-fair-move-quality-validation.ts`
- `.github/workflows/b3-fair-move-quality-validation.yml`

The earlier ResourceAware +48 discovery run is discovery evidence only, not a
compute-fair strength comparison.

Canonical code:

- `src/research/mode-aware-puct-v3a.ts` — historical reflection-canonical V3A adapter used by the completed B3 evidence.
- `src/research/mode-aware-puct-v3a1.ts` — canonical V3A.1 adapter for future balance/search work.
- `src/research/resource-aware-puct-v3a.ts` — research-only rescue wrapper.
- `src/benchmarks/b3-resource-aware-selfplay.ts` — asymmetric B3 validation.
- `.github/workflows/b3-resource-aware-selfplay.yml`.

Rules:

- do not hard-code B3 action names into the rescue algorithm;
- completed B3 rescue evidence must preserve its V3A historical baseline; new rescue/challenger work should use V3A.1 as incumbent unless explicitly reproducing a historical experiment;
- candidate rescue must be validated against a strong fresh V3A continuation;
- cross-play is required before calling a search variant stronger.

## Canonical balance evidence

### Reflection-fixed baseline

- `src/benchmarks/balance-mode-v3a-selfplay.ts`
- `.github/workflows/reflection-fixed-balance-rematch.yml`
- `docs/research/BALANCE_CORE_MODES_PROTOCOL_2026-09-18.md`

### B3 deep defensive resources

- `src/benchmarks/double-forced-deviation-selfplay.ts`
- `.github/workflows/qg3f-double-deviation-100k.yml`

Canonical finding: three independent two-deviation B3 resources survived
100,000 simulations/decision across CW/CCW reflection and opener identity,
12/12 cases ending 35-35. This is evidence of a search-discovery problem, not a
proof of the game-theoretic value of B3.

### Positional repetition

- `src/research/balance-modes.ts`
- `tests/positional-threefold-cycle.test.ts`
- `.github/workflows/qg-positional-cycle-validation.yml`
- `.github/workflows/qg-positional-threefold-rematch.yml`
- `docs/research/QG_POSITIONAL_THREEFOLD_VERDICT_2026-09-18.md`

Positional Threefold is research-only. It is regression-tested and
reflection-safe, but the 20-game rematch did not solve opening balance.

## Canonical AI-strength evidence

PUCT V3A.1 material36 is the canonical research incumbent among validated
tested algorithms; this does not mean game-theoretically unbeatable.

Current incumbent:
- `docs/research/V3A1_MATERIAL36_PROMOTION_VERDICT_2026-09-18.md`
- `src/research/puct-v3a1.ts`
- `src/research/mode-aware-puct-v3a1.ts`
- `tests/puct-v3a1.test.ts`
- `.github/workflows/v3a1-material36-promotion-screen.yml`
- `.github/workflows/v3a1-material36-budget-robustness.yml`
- `.github/workflows/v3a1-material36-strong-same-family.yml`
- `.github/workflows/v3a1-material36-vs-trang-nguyen.yml`

Historical V3A promotion evidence remains canonical for the previous incumbent:
- `docs/research/R1_PROMOTION_VERDICT_2026-09-17.md`
- `docs/research/R1D_A_EVIDENCE_2026-09-17.md`
- `docs/research/AI_TRACK_CLOSED_BALANCE_TRACK_2026-09-17.md`
- `src/research/puct-v3a.ts`
- `src/benchmarks/r1d-production-semantics-v3a-vs-trang-nguyen.ts`

Future algorithm challengers must compare against V3A.1. Historical B3 and R1
evidence that was executed before this promotion remains evidence about V3A and
must not be silently relabeled as V3A.1 evidence.

PVS/NegaScout is historical only and excluded from future active evaluation
unless explicitly reopened.

## Closed V4 selective-quiescence track

The selective one-ply quiescence family is closed and rejected:

- `docs/research/V4_SELECTIVE_QUIESCENCE_REJECTION_2026-09-18.md`
- `docs/research/V4_QUIESCENCE_FAMILY_CLOSED_2026-09-18.md`

V4, V4B refutation-only, and V4C opponent-turn refutation all preserved the
known move-2/move-34 V3A.1 repairs but reproduced the same reflected LQ@6
regression that converts a validated V3A.1 winning branch into a draw.

Do not reopen this family by threshold-tuning without a new causal mechanism.
The next active challenger track should compare directly against V3A.1 and
change search structure rather than selective heuristic leaf bootstrap.

## General reusable benchmarks

- `src/benchmarks/research-vs-production.ts`
- `src/benchmarks/research-vs-server-production.ts`
- `src/benchmarks/v3a-challenger-tournament.ts`
- `.github/workflows/balance-mode-v3a-selfplay.yml`
- `.github/workflows/ci.yml`

## Repository hygiene policy

- `results/` must remain empty except for `.gitkeep`.
- GitHub Actions artifacts are temporary execution evidence, not committed data.
- One-off diagnostic scripts/workflows should be deleted after their conclusions
  are captured in a canonical verdict/protocol document.
- New balance conclusions must include reflection and A/B identity integrity.
- Fixed-simulation search is required for balance comparisons; wall-clock search
  is not canonical evidence.
- Never silently change the production rules while studying a research mode.
