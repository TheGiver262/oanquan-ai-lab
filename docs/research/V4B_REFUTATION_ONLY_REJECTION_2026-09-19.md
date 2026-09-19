# PUCT V4B refutation-only rejection — 2026-09-19

## Verdict

**REJECT — V3A.1 material36 remains incumbent.**

V4B retained the V4 q10 tactical-instability detector but changed the one-ply
bootstrap so it could only lower the V3A.1 static heuristic value:

`min(staticValue, onePlyValue)`.

The intent was to allow tactical refutation without creating the optimism that
caused the original V4 failure.

## Causal guards

V4B preserved both validated V3A.1 repairs:

- move 2 at 99,066 simulations: B4:CW remained selected over B5:CCW;
- move 34 at 90,000 simulations: B2:CW remained selected over B5:CCW.

Therefore V4B passed the narrow causal safety gate.

## Broad 10k screen

| stage | V4B W | D | V3A.1 W | unresolved | completed pairs +/=/- | mean pair diff |
|---|---:|---:|---:|---:|---|---:|
| Stage 1 | 13 | 4 | 13 | 2 | 0/14/0 | 0 |
| Stage 2 | 12 | 4 | 14 | 2 | 0/13/2 | -0.1333 |
| Stage 3 | 4 | 2 | 4 | 0 | 0/5/0 | 0 |

Aggregate resolved W-D-L: **29-10-31**.

Completed pairs:

- favorable: 0
- neutral: 32
- unfavorable: **2**
- mean pair diff: **-0.05882**

This fails the broad non-regression gate.

## Failure identity

The two unfavorable pairs are exactly the same reflection pair that rejected
the original V4 q10 selective-quiescence candidate:

- `LQ@6:B3:CCW:B3:CCW>T2:CW>B4:CCW>T4:CW>B3:CW>T4:CW`
- `LQ@6:B3:CW:B3:CW>T4:CCW>B2:CW>T2:CCW>B3:CCW>T2:CCW`

Each has pairDiff `-1`.

Because the regression survives the optimism clamp and repeats under reflection,
the problem is broader than merely allowing one-ply bootstrap to raise a static
leaf estimate. Applying a tactical one-ply replacement on engine-to-move leaves
can itself distort the search basin.

## Decision consequence

- V4B is closed and must not be promoted.
- V3A.1 material36 remains the canonical research incumbent.
- Do not rescue V4B by changing C_puct, priors, policy temperature or material36.
- The next isolated experiment is **opponent-only refutation**: the tactical
  bootstrap may lower a leaf only when the opponent is the side to move. On
  engine-to-move leaves, preserve the V3A.1 static heuristic exactly.
- PVS/NegaScout remains excluded from active evaluation.

Source workflow: `v4b-refutation-only-gate`, run `35361781615`.
