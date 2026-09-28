# V3B.1 Three-Mode 10k Retest — 2026-09-28

## Scope

Fresh retest of **PUCT V3B.1 PNSum Cpn=2.0** against **V3A.2 positive-only material36** on all three supported research modes using one shared benchmark configuration:

- 10,000 fixed simulations per decision;
- 10 canonical forced openings;
- candidate once as opener and once as responder;
- maxBoardMoves=200;
- unresolved games censored.

Evidence run:
- `36435990816`

The workflow commit passed the repository CI before results were accepted:
- CI run `36435989781`

## Results

### Quan Gia + Threefold

- W-D-L: **14-0-6**
- favorable / neutral / unfavorable / unresolved pairs: **4 / 6 / 0 / 0**

Favorable:
- B1:CCW
- B3:CW
- B3:CCW
- B5:CW

All other opening pairs were neutral.

### Pie + Threefold

- W-D-L: **6-6-8**
- favorable / neutral / unfavorable / unresolved pairs: **2 / 6 / 2 / 0**

Favorable:
- B1:CCW
- B5:CW

Unfavorable:
- B2:CCW
- B4:CW

All other opening pairs were neutral.

### Standard

- resolved W-D-L: **4-4-10**
- unresolved games: **2**
- favorable / neutral / unfavorable / unresolved pairs: **0 / 4 / 4 / 2**

Unfavorable:
- B2:CCW
- B3:CW
- B3:CCW
- B4:CW

Unresolved:
- B1:CCW
- B5:CW

Neutral:
- B1:CW
- B2:CW
- B4:CCW
- B5:CCW

## Reproducibility

This fresh retest reproduces the prior canonical 10k V3B.1 measurements exactly at the aggregate level for all three modes:

- Quan Gia: **14-0-6**, 4/6/0/0 pairs
- Pie: **6-6-8**, 2/6/2/0 pairs
- Standard: **4-4-10 + 2 unresolved**, 0/4/4/2 pairs

Therefore the mode-specific promotion conclusion is reinforced:

- **Quan Gia + Threefold:** V3B.1 Cpn=2.0 remains the canonical incumbent.
- **Pie + Threefold:** V3B.1 is not promoted; retain V3A.2 baseline.
- **Standard:** V3B.1 is not promoted; retain historical/reference baseline policy.

No implementation change is implied by this retest.
