# PUCT V4 selective-quiescence family closure — 2026-09-18

## Verdict

**CLOSE / REJECT the selective one-ply quiescence family tested in V4, V4B and V4C.**

The canonical incumbent remains **PUCT V3A.1 material36**.

PVS/NegaScout remains excluded from active evaluation.

## V4 q10 — optimistic selective one-ply

V4 applied one-ply max/min bootstrap at tactically unstable heuristic leaves
(score swing >= 10 or exact solved/terminal child).

Causal safety passed the known move-2 and move-34 V3A.1 repairs, but the 10k
same-family screen failed:

- Stage 1: 14 W / 4 D / 14 L, pairs 0/16/0
- Stage 2: 12 W / 5 D / 14 L, 1 unresolved, pairs 0/13/2
- Stage 3: 4 W / 2 D / 4 L, pairs 0/5/0
- aggregate completed pairs: 0 favorable / 34 neutral / 2 unfavorable

Both unfavorable pairs were the reflected LQ@6 B3 positions. Independent fresh
V3A.1 continuation showed the V4 branch changed a validated 37-33 P0 win into
35-35.

See `V4_SELECTIVE_QUIESCENCE_REJECTION_2026-09-18.md`.

## V4B — refutation-only clamp

V4B retained the q10 instability detector but changed bootstrap semantics:

- the one-ply value may lower the V3A.1 static leaf value;
- it may never raise the static value.

Known causal guards still passed:

- move 2 -> B4:CW
- move 34 -> B2:CW

However Stage 2 reproduced the same reflected regression:

- 12 W / 4 D / 14 L
- 2 unresolved
- completed pairs 0 favorable / 13 neutral / 2 unfavorable
- mean pair diff -0.1333

The unfavorable positions were exactly the same two reflected LQ@6 cases as V4.

Interpretation: preventing direct optimistic value inflation is insufficient.
Lowering other leaves can still distort relative branch values and redirect
visits toward the same inferior draw basin.

## V4C — opponent-turn refutation only

V4C narrowed V4B further:

- only opponent-to-move tactical leaves may use the one-ply refutation;
- engine-to-move leaves preserve V3A.1 static evaluation exactly;
- any applied one-ply result may only lower the static value.

Known causal guards again passed strongly:

- move 2 at 99,066 simulations -> B4:CW
- move 34 at 90,000 simulations -> B2:CW

Stage 3 remained fully neutral (4 W / 2 D / 4 L, 5/5 neutral pairs).

A targeted 10k regression on the two LQ@6 reflection failures was decisive:

### LQ@6 B3:CCW reflection

- V4C=P0 -> draw 35-35
- V4C=P1 -> P0 wins 37-33
- pairDiff = -1

### LQ@6 B3:CW reflection

- V4C=P0 -> draw 35-35
- V4C=P1 -> P0 wins 37-33
- pairDiff = -1

Thus opponent-only refutation still converts the same validated V3A.1 winning
branch into a draw.

## Family-level conclusion

Three increasingly conservative forms of one-ply heuristic bootstrap reproduce
the same symmetry-consistent failure:

1. unrestricted selective one-ply;
2. refutation-only clamped one-ply;
3. opponent-turn-only refutation.

The evidence indicates the problem is not only the sign of the value update.
Replacing a static V3A.1 leaf estimate with a selective one-ply heuristic
estimate changes relative branch values enough to destabilize root ranking.

Further threshold retuning of this bootstrap family would be overfitting the
known LQ@6 cases and is not justified.

## Decision consequence

- V3A.1 material36 remains canonical.
- V4/V4B/V4C selective one-ply quiescence is closed.
- Do not rescue this family by changing C_puct, priors, policy temperature or
  material36 in the same experiment.
- The next challenger should change search structure rather than continue
  modifying heuristic leaf bootstrap.

The next proposed track is **transposition-aware graph PUCT / MCGS-style
search**, with V3A.1 evaluation and policy behavior frozen.
