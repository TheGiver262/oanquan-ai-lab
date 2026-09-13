# R1a — Production parity audit

Status: research-only. No production repository changes, merge, deploy, or strength benchmark are part of this phase.

## Scope

R1a audits the previous AI-lab production pin against the current reviewed production commit before any R1b rules benchmark or R1c AI promotion benchmark is interpreted.

- Previous lab pin: `TheGiver262/O_an_quan@4984701ce151ee270a6a5ba5fc9211a6ec2b6996`
- Audited production commit: `TheGiver262/O_an_quan@73c698762c514d171869a79982fdc86103653e8f`
- Git compare reports the production head is 100 commits ahead of the old pin.

The commit count is not itself evidence of parity failure. R1a classifies only changes that can affect engine transitions, rulesets/legal moves, AI behavior, state identity/hash, learning, replay/persistence semantics, or benchmark validity.

## Findings

### 1. Classic engine transition and ruleset semantics are unchanged

The following production files have identical Git blob SHA at both audited commits:

| File | Blob SHA at old pin | Blob SHA at audited head | R1a classification |
| --- | --- | --- | --- |
| `packages/game-engine/src/apply-move.ts` | `ce13c521c9d10a256fb0434067d757db306b3c56` | same | parity preserved |
| `packages/game-engine/src/legal-moves.ts` | `468117bb676700eba7819c6cd0ec7860844fd720` | same | parity preserved |
| `packages/game-engine/src/rulesets.ts` | `985d41d6f6953448032e57faa7e223e8b9f1ab10` | same | parity preserved |
| `packages/game-engine/src/board.ts` | `70e7b1a7202df1bb0727e3b7acf15d6935e17ffd` | same | parity preserved |
| `packages/game-engine/src/three-player.ts` | `2b726cfef4cf8ad98bb8530b4d683d66ccbe4e7f` | same | unchanged, but 3P remains outside the current 2P R1 rule/AI benchmark |

**Fact:** no move-application, legal-move, board, or ruleset code change is present in the audited range.

**Inference:** existing AI-lab 2P transition/ruleset parity does not need to be rewritten merely because production advanced by 100 commits.

### 2. State hashing changed and is benchmark-relevant

Production `packages/game-engine/src/state-hash.ts` changed from blob:

- old: `7195c100b030b97ecd056a1758cf168fe6b1526b`
- audited: `b47f626c911a0d62d80f902e6ca589c77564d7ee`

The relevant semantic delta is classic `recentMoves` hashing.

Old behavior:

```ts
recentMoves: state.recentMoves
```

Audited behavior:

```ts
recentMoves: state.recentMoves.map((move) => ({
  player: move.player,
  pit: move.pit,
  dir: move.dir,
}))
```

The server persisted/legacy hash path applies the same canonicalization.

**Fact:** production now excludes any incidental replay/persistence metadata attached to recent-move objects from the canonical state hash.

**Inference:** this is relevant to replay/hash and transposition-cache identity, but it does not change legal transitions or game rules. The AI-lab engine hash has been aligned and a regression test verifies that extra hydrated move metadata cannot alter the hash.

### 3. Runtime classic AI behavior was not modified in the audited range

Production `apps/server/src/match/classic-ai-player.ts` changed from blob `f7c7f95b1fbc14bd6b895fee226547552ccc0ef1` to `bd84e3cdf6d41eaa31c5355cf449b35cb7e09793`.

The relevant production commit is:

`579832dbdc820607875b3bbaea4218d72eef5605 — feat(replay): add deterministic classic reference evaluator`

Its diff appends a separate `REFERENCE_CLASSIC_2P_PROFILE`, `Classic2pReferenceOptions`, and `evaluateClassic2pReferenceMoves(...)` after the existing runtime AI implementation. The commit adds 151 lines to `classic-ai-player.ts` without deleting or modifying the existing runtime path.

**Fact:** no existing top-three runtime AI selection/search code is changed by this production delta.

**Inference:** the copied Thám Hoa/Bảng Nhãn/Trạng Nguyên runtime reference remains behaviorally valid for this audited production commit. The new replay reference evaluator is useful production tooling but is not the deployed bot decision path and therefore is not silently substituted into strength benchmarks.

### 4. Production reference pin can be refreshed narrowly

Because engine/ruleset/legal-move blobs are unchanged, runtime AI code is unchanged, and the only state-identity delta has been ported, the lab reference pin is refreshed to:

`73c698762c514d171869a79982fdc86103653e8f`

This refresh does **not** imply a live-strength claim for Trạng Nguyên. Without the matching deployed learning snapshot, Trạng Nguyên benchmarks must remain labeled:

`code-parity-no-live-learning-snapshot`

## Changes made in AI lab

Branch: `research/r1-production-parity`

R1a intentionally makes only parity-scoped changes:

1. `src/engine.ts`
   - canonicalize `recentMoves` before state hashing, matching audited production.
2. `src/reference/server-production-ai.ts`
   - update `PRODUCTION_SOURCE_COMMIT` to the audited production commit.
3. `tests/server-production-parity.test.ts`
   - pin the audited production commit;
   - preserve existing production-profile and expected-move guards;
   - add a hash-canonicalization guard for hydrated replay metadata.
4. `README.md`
   - record the new audited production pin and scope.

No production repository file is modified.

## R1a gate

R1a is complete only if all of the following pass on this branch:

- TypeScript typecheck;
- `tests/server-production-parity.test.ts`;
- existing engine/ruleset tests;
- full repository unit tests if the normal CI already runs them;
- build.

No tournament or strength benchmark is required for R1a because the audited runtime AI behavior did not change. Running a heavy tournament here would add cost without answering a parity question.

## Implication for R1b and R1c

After the R1a gate is green:

- **R1b** may pre-register and implement only `Cấm Quan` vs `Standard + Pie Rule`; `Cấm Quan + Pie` is deferred.
- R1b must keep intrinsic forced KEEP/SWAP fairness separate from KEEP/SWAP decision-policy quality.
- **R1c** must evaluate AI strength independently on one frozen ruleset and must not interpret deterministic PUCT wall-clock replicates as independent RNG seeds.

R1a itself provides no evidence that Pie should replace Cấm Quan and no evidence that any research AI should replace the current production AI.
