# V3K target-mode one-ply leaf bootstrap rejection — 2026-09-27

## Verdict

**REJECT / CLOSE V3K on both target modes.**

Canonical incumbents remain unchanged:
- Quan Gia + Threefold: **V3B.1 PNSum Cpn=2.0**
- Pie + Threefold reference: **V3A.2 positive-only material36**

No 10k/20k/50k escalation is justified.

## Hypothesis

The retained V4 family had rejected selective one-ply quiescence on Standard,
but its own report explicitly said that result must not be generalized to
Pie + Threefold or Quan Gia + Threefold without target-mode revalidation.

V3K tested that missing target-mode question with one isolated change:
replace the static heuristic leaf reward with a one-ply adversarial max/min
bootstrap over the already-expanded child states.

Everything else remained mode-appropriate incumbent behavior.

## Frozen behavior

Common:
- V3A.2 positive-only material36 leaf score semantics;
- policy priors;
- c_puct=1.5;
- policy temperature=0.6;
- ordinary valueSum/visits backup;
- subtree reuse;
- cycle handling;
- exact solved propagation;
- root ranking by visits.

Mode-specific proof guidance:
- Quan Gia + Threefold: PNSum Cpn=2.0, matching V3B.1;
- Pie + Threefold: Cpn=0, matching V3A.2.

Only `leafBootstrap` changed from `static` to `one_ply`.

## Correctness / TDD evidence

The adapter was implemented with a RED -> GREEN sequence.

RED:
- run `36298934688`
- expected failure: V3K module did not yet exist.

GREEN:
- run `36298967210`
- typecheck passed;
- full tests passed;
- build passed.

Benchmark/type/build verification:
- run `36299032091`
- typecheck passed;
- full tests passed;
- build passed.

Correctness guards covered:
- V3K equals the direct one-ply configuration at the same fixed simulation budget;
- legal actions on both target modes;
- invalid proof-number coefficients rejected.

## 5k dual-mode gate

Evidence:
- run `36299084469`

Protocol:
- 5,000 fixed simulations per decision;
- all 10 canonical openings;
- candidate once as opener and once as responder;
- maxBoardMoves=200;
- unresolved games censored.

### Pie + Threefold

Incumbent: V3A.2 positive-only material36.

Initial 5k:
- candidate W-D-L: **4-10-6**
- favorable / neutral / unfavorable / unresolved pairs: **0 / 8 / 2 / 0**
- unfavorable:
  - `B2:CCW`
  - `B4:CW`

Targeted confirmation:
- run `36299188617`

Both regressions reproduced:
- `B2:CCW`: **0W-1D-1L**, unfavorable
- `B4:CW`: **0W-1D-1L**, unfavorable

Decision: **close V3K on Pie**.

### Quan Gia + Threefold

Incumbent: V3B.1 PNSum Cpn=2.0.

Initial 5k:
- resolved candidate W-D-L: **6-0-12**
- unresolved games: **2**
- favorable / neutral / unfavorable / unresolved pairs: **0 / 6 / 2 / 2**
- unfavorable:
  - `B3:CW`
  - `B3:CCW`
- unresolved:
  - `B2:CCW`
  - `B4:CW`

Targeted confirmation:
- run `36299270925`

Both unfavorable openings reproduced more strongly:
- `B3:CW`: **0W-0D-2L**, unfavorable
- `B3:CCW`: **0W-0D-2L**, unfavorable

The repeated unfavorable evidence is already decisive, so the two unresolved
initial opening pairs do not need rescue or rerun.

Decision: **close V3K on Quan Gia**.

## Interpretation

The target-mode evidence does not support one-ply adversarial heuristic-leaf
bootstrap as an improvement over the current incumbents.

The failure is mode-specific but repeatable:
- Pie regresses on B2:CCW and B4:CW;
- Quan Gia regresses symmetrically on B3:CW and B3:CCW.

The Quan Gia result is especially decisive because both B3 regressions repeat
as two candidate losses in the confirmation run.

This experiment therefore closes the exact V3K mechanism tested here.
It does not retroactively rewrite the historical Standard-only V4 evidence,
but there is now direct target-mode evidence against the unrestricted one-ply
bootstrap used by V3K.

## Decision consequence

- Keep V3B.1 PNSum Cpn=2.0 as the Quan Gia incumbent.
- Keep V3A.2 as the Pie reference baseline.
- Do not run V3K at 10k/20k/50k.
- Do not rescue with threshold, policy-temperature, c_puct, Cpn or selector sweeps.
- Remove V3K implementation, tests, benchmark and one-off workflows after this report is consolidated.
- Future research should move away from one-ply heuristic leaf replacement.

## Repository consequence

Retain only this consolidated report on `main`.
The temporary V3K research branch is disposable after cleanup.
