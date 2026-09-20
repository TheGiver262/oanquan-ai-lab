# V3A.2 positive-only material gate promotion — 2026-09-21

## Verdict

**Promote V3A.2 as the canonical incumbent for both target modes:**
- Pie + Threefold
- Quan Gia + Threefold

V3A.2 is a causal correction to V3A.1, not a new search architecture.

Above raw board material 36:
- V3A.1 suppressed the scoreDelta term symmetrically.
- V3A.2 suppresses **positive** scoreDelta only.
- Negative scoreDelta remains active, preserving an early/midgame penalty when the engine is behind.

At material <=36, V3A.2 uses the original score weight 1.8 exactly as V3A/V3A.1.

## Root cause

Dual-mode revalidation showed that V3A.1 was clean on Pie + Threefold but regressed on Quan Gia + Threefold at both 10k and 20k:
- B3:CW
- B3:CCW

The causal audit localized the first divergence to the **first responder move after B3**.

Representative B3:CW state:
- move number: 1
- responder to move
- raw board material: 46
- live Quan: 2
- score: opener 6, responder 0

V3A.1 material36 removed scoreDelta entirely because material 46 > 36.
That also removed the responder's legitimate **-6 score deficit**.

At 10k:
- V3A.1 selected T4:CW.
- V3A selected T2:CW.
- The mirrored B3:CCW state showed the symmetric divergence.

The opener-side B3 trajectory did not diverge between V3A.1 and V3A on the audited path. The regression was therefore specifically associated with the responder's high-material negative scoreDelta being suppressed.

## Fixed-threshold ablation

A simple replacement of threshold 36 was rejected.

Quan Gia + Threefold, all 10 openings, 10k fixed simulations vs V3A:

| threshold | W-D-L | favorable / neutral / unfavorable | mean pair diff |
|---:|---:|---:|---:|
| 18 | 6-0-14 | 2 / 2 / 6 | -0.4 |
| 24 | 8-4-8 | 4 / 2 / 4 | 0 |
| 30 | 2-4-14 | 0 / 4 / 6 | -0.6 |
| 36 | 4-10-6 | 0 / 8 / 2 | -0.1 |
| 42 | 4-8-8 | 0 / 8 / 2 | -0.2 |
| 48 | 6-8-6 | 0 / 10 / 0 | 0 |

Threshold 48 was clean, but for the forced-opening suite it is effectively a return toward V3A because post-opening B3 material is already 46. It does not preserve the causal benefit of material36 while fixing the negative-score regression.

## V3A.2 rule

For a heuristic leaf:

- if raw board material <=36: scoreDelta weight = 1.8;
- if raw board material >36 and scoreDelta >0: scoreDelta weight = 0;
- if raw board material >36 and scoreDelta <=0: scoreDelta weight = 1.8.

Everything else remains frozen:
- PUCT selection
- c_puct
- policy priors
- policy temperature
- subtree reuse
- exact solved propagation
- cycle handling
- root visit-count ranking
- other heuristic terms.

## Promotion evidence

Protocol:
- all 10 legal initial openings;
- two games per opening;
- candidate once as opener and once as responder;
- fixed simulations;
- no root noise;
- Pie ownership follows research-agent identity through SWAP;
- unresolved games censored, never heuristic-adjudicated.

Mode-appropriate baselines:
- Pie + Threefold: V3A.1 material36.
- Quan Gia + Threefold: V3A.

### 10k

Pie + Threefold:
- 6W-8D-6L
- 0 favorable / 10 neutral / 0 unfavorable
- mean pair diff 0
- unresolved 0

Quan Gia + Threefold:
- 6W-8D-6L
- 0 / 10 / 0
- mean pair diff 0
- unresolved 0

### 20k

Pie + Threefold:
- 6W-8D-6L
- 0 / 10 / 0
- mean pair diff 0
- unresolved 0

Quan Gia + Threefold:
- 6W-8D-6L
- 0 / 10 / 0
- mean pair diff 0
- unresolved 0

### 50k strong gate

Pie + Threefold:
- 6W-8D-6L
- 0 / 10 / 0
- mean pair diff 0
- unresolved 0

Quan Gia + Threefold:
- 8W-4D-8L
- 0 / 10 / 0
- mean pair diff 0
- unresolved 0

Across the three budgets:
- 120 games
- 60 completed opening pairs
- **0 unfavorable pairs**
- 0 unresolved games.

## B3 regression closure

At 10k, 20k and 50k the old Quan Gia B3 regression is absent.

At 50k:
- B3:CW: opener loses 20-50, responder wins 50-20 -> pair score 1.
- B3:CCW: same mirrored result -> pair score 1.

This is the desired seat-balanced behavior for the paired protocol and replaces V3A.1's responder draw regression.

## Promotion decision

V3A.2 becomes the canonical target-mode incumbent.

Future challengers must compare against V3A.2 on **both** Pie + Threefold and Quan Gia + Threefold.

Standard remains historical/reference only. V3A.1 remains the historical Standard incumbent; this promotion does not claim a new Standard tournament result.

PVS/NegaScout remains excluded from active evaluation.

## Cleanup

The causal-audit benchmark, threshold-sweep benchmark, promotion-screen benchmark, temporary workflows, artifacts and temporary research branch are one-off research assets and are removed after this report is consolidated.
