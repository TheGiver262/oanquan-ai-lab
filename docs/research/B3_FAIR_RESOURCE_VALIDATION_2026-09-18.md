# B3 Fair Resource Validation Verdict — 2026-09-18

## Purpose

This verdict supersedes any interpretation of the earlier ResourceAware +48 discovery run as a search-strength comparison.

The discovery run was useful for finding a candidate move, but it was not compute-fair: ResourceAware used additional forecast/probe/validation search while the responder used a single vanilla V3A budget.

The canonical question here is narrower and fairer:

> Is the move discovered by ResourceAware actually better than the vanilla top-1 move when BOTH resulting branches are continued by fresh vanilla V3A with identical fixed simulation budgets?

This experiment measures **move quality**, not ResourceAware search strength.

## Method

Canonical harness:
- `src/benchmarks/b3-fair-move-quality-validation.ts`
- workflow: `.github/workflows/b3-fair-move-quality-validation.yml`
- GitHub Actions run: `35319708071`

For every case:
1. force only the requested opening `B3:CW` or `B3:CCW`;
2. build the prefix to board move 4 using vanilla reflection-canonical V3A with the SAME fixed budget used for continuation;
3. at the exact same target state:
   - obtain vanilla V3A top-1;
   - let ResourceAware propose a candidate;
4. branch the state;
5. discard both proposal search trees;
6. evaluate BOTH branches using fresh vanilla V3A for BOTH agents with exactly the same fixed simulations/decision.

Budgets:
- 20,000 simulations/decision;
- 50,000 simulations/decision;
- 100,000 simulations/decision.

Coverage:
- `B3:CW` and `B3:CCW`;
- opener identity A and B;
- 12 branch pairs total.

No wall-clock cutoff is used.

## Integrity

- branch pairs: **12/12**
- reflection mismatches: **0**
- A/B identity mismatches: **0**

The results are exactly symmetric across left-right reflection and stable across research-agent identity.

## Results

| Budget | Opening class | Vanilla move at board move 4 | ResourceAware proposal | Vanilla branch result | Candidate branch result |
|---:|---|---|---|---|---|
| 20k | B3 CW/CCW | B3 same direction | B3 opposite direction | responder win, opener margin **-24** | unresolved at 240 moves, score **27-28** |
| 50k | B3 CW/CCW | B3 same direction | B3 opposite direction | responder win, opener margin **-30** | unresolved at 240 moves, score **27-28** |
| 100k | B3:CW | **B1:CW** | **B1:CW** | opener win **+22** | same branch, opener win **+22** |
| 100k | B3:CCW | **B5:CCW** | **B5:CCW** | opener win **+22** | same branch, opener win **+22** |

All A/B identity cases match these rows exactly.

### 20k

At board move 4:
- vanilla top-1 remains the same-direction B3 move;
- ResourceAware proposes the opposite-direction B3 move;
- the candidate is vanilla root rank 3;
- vanilla continuation loses by 24;
- candidate continuation does NOT reproduce the earlier +48;
- under equal 20k continuation compute it enters the known long basin and remains unresolved at the 240-move censor cap with score P0 27, P1 28.

### 50k

The same qualitative result survives:
- vanilla top-1 loses by 30;
- the ResourceAware candidate is now vanilla root rank 2;
- the candidate branch again remains unresolved at 240 moves with score 27-28.

Thus the candidate is a real tactical/strategic resource in the sense that equal-strength vanilla continuation cannot refute it at 20k or 50k within 240 moves.

It is NOT evidence that the candidate wins.

### 100k

The prefix itself changes before the old anomaly is reached.

At the board-move-4 target state:
- `B3:CW`: vanilla 100k already selects `B1:CW`;
- `B3:CCW`: vanilla 100k already selects the mirror `B5:CCW`;
- ResourceAware makes exactly the same choice;
- both branches are identical;
- vanilla continuation wins for the opener by **+22**.

Therefore the old move-4 rescue is **budget-contingent**. At 100k, vanilla search changes the earlier principal variation enough that the specific rescue is no longer needed.

## Interpretation

### What is supported

1. The earlier +48 result was NOT a fair strength comparison.
2. ResourceAware successfully discovered a non-top-1 B3 resource at lower budgets without hard-coded action names.
3. Under equal continuation compute, that resource improves the 20k/50k situation from a resolved loss to an unresolved long-cycle basin.
4. At 100k, vanilla V3A itself changes the principal variation and wins +22 in this harness; ResourceAware does not improve on it.
5. B3 search behavior is highly budget-sensitive and has not converged monotonically across 20k -> 50k -> 100k.

### What is NOT supported

- Do not claim ResourceAware is stronger than vanilla V3A from this experiment.
- Do not claim the move-4 rescue wins.
- Do not claim B3 is game-theoretically winning, drawing, or losing.
- Do not use the earlier +48 selfplay outcome as canonical balance evidence.

## Research consequence

The central problem is now better described as **search instability / non-convergence on B3**, not simply failure to inspect rank-low actions.

At 20k and 50k, vanilla chooses a losing principal variation while the discovered alternative reaches a long unresolved basin.
At 100k, vanilla changes the prefix and finds a winning line before the same decision structure is reached.

The next search-strength comparison, if pursued, must normalize total compute between ResourceAware and vanilla. Until such a protocol exists, ResourceAware remains a discovery tool rather than a promoted stronger engine.
