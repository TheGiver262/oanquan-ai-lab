# V3A.2 target-mode balance audit — 2026-09-22

## Goal

Compare the two forward rule modes under the same strongest validated AI,
**PUCT V3A.2 positive-only material36**, so AI changes do not confound rule
balance.

Target modes:
1. `pie-threefold`
2. `quan-gia-threefold`

Standard is historical/reference only.

## Metrics

Primary seat-balance indicators:
- original opener W/D/L across all 10 legal initial openings;
- signed mean outcome value: win=+1, draw=0, loss=-1, ideal=0;
- mean original-opener score differential, ideal near 0.

Secondary:
- mean absolute score differential;
- unresolved games;
- Pie SWAP usage.

All runs use fixed simulations and no heuristic adjudication.

## 10k screen

### Pie + Threefold

Original opener:
- **0W-4D-6L**
- mean outcome value: **-0.60**
- mean score differential: **-26.8**
- mean absolute score differential: **26.8**
- unresolved: 0
- SWAP used on 6/10 forced openings

Per-opening outcome:
- B1:CW L
- B1:CCW L
- B2:CW L
- B2:CCW D
- B3:CW D
- B3:CCW D
- B4:CW D
- B4:CCW L
- B5:CW L
- B5:CCW L

The responder is strongly favored at this budget.

### Quan Gia + Threefold

Original opener:
- **2W-4D-4L**
- mean outcome value: **-0.20**
- mean score differential: **+3.0**
- mean absolute score differential: **19.8**
- unresolved: 0

Per-opening outcome:
- B1:CW L
- B1:CCW D
- B2:CW W
- B2:CCW D
- B3:CW L
- B3:CCW L
- B4:CW D
- B4:CCW W
- B5:CW D
- B5:CCW L

The result is reflection-consistent:
- B1:CW mirrors B5:CCW -> L/L
- B1:CCW mirrors B5:CW -> D/D
- B2:CW mirrors B4:CCW -> W/W
- B2:CCW mirrors B4:CW -> D/D
- B3:CW mirrors B3:CCW -> L/L

## Interim conclusion

At 10k, **Quan Gia + Threefold is materially more seat-balanced than Pie +
Threefold** by both outcome bias and absolute score margin.

This is not yet the final rule verdict. Re-run at 20k and 50k before declaring
the canonical balanced mode, because finite-budget PUCT action switches can
change individual openings.

Workflow source for the 10k evidence was temporary and is removed after
consolidation.
