# V4-A selective-quiescence causal result — 2026-09-18

## Purpose

V4-A is a safety/causal screen for selective one-ply quiescence on top of the
canonical V3A.1 material36 incumbent.

The candidate changes leaf evaluation only when an already-expanded immediate
child changes engine-agent score delta by at least a configured threshold, or
an exact solved/terminal child is visible. Stable leaves remain V3A.1 static
leaves.

## Controls

Known V3A.1 repaired cases:

- move 2: B4:CW is the validated winning branch; B5:CCW is a draw basin.
- move 34: B2:CW is the validated winning branch; B5:CCW is a draw basin.

Fixed-simulation controls reproduce V3A.1:

- move 2 at 99,066: B4:CW selected.
- move 34 at 90,000: B2:CW selected.

## Threshold scan

| score swing | move 2 selected | move 34 selected | safety |
|---:|---|---|---|
| 4 | B4:CW | B2:CW | pass |
| 6 | B4:CW | B2:CW | pass |
| 8 | B4:CW | B2:CW | pass |
| 10 | B4:CW | B2:CW | pass |
| 12 | B4:CW | B2:CW | pass |
| 15 | B4:CW | B2:CW | pass |
| 20 | **B5:CCW** | B2:CW | **fail** |

Threshold 20 is rejected because it misses enough tactical leaves to allow the
known move-2 horizon failure to reappear.

## Selected V4-B candidate

**score swing = 10**

Reasons:

1. it passes both causal safety cases;
2. it sits inside the broad safe region 4–15 rather than on a boundary;
3. the engine defines `QUAN_VALUE = 10`, so the trigger corresponds to one
   quan-equivalent immediate score swing and has a rules-grounded
   interpretation rather than being selected only from benchmark fit;
4. no C_puct, policy prior, material36 threshold, tree reuse, solved propagation
   or root ranking parameter is changed.

The frozen V4-B challenger is
`SelectiveQuiescencePuctV4` in `src/research/puct-v4.ts`.

## Interpretation

V4-A is **not strength evidence**. It establishes that a selective tactical
extension can be configured without breaking the two known V3A.1 repairs.

V4-B must still pass the full Stage 1/2/3 same-family screen against V3A.1.
A broad regression rejects V4 even though V4-A passes.

Source workflow: `v4-selective-quiescence-causal-scan`, run
`35345955697`.
