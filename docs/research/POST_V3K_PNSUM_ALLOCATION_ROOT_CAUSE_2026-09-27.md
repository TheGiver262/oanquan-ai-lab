# Post-V3K root-cause audit — PNSum allocation coupling — 2026-09-27

## Verdict

The repeated post-V3B.1 regression pattern is best explained by a **search-allocation coupling problem**, not by a single broken opening, cycle bug, reflection bug, or subtree-reuse bug.

The strongest directly demonstrated mechanism is:

> **heuristic/frontier perturbation -> changed tree/proof trajectory -> PNSum reallocates visits -> cumulative root visits preserve a transient basin advantage -> visit-based root ranking can select a branch whose current direct Q is worse.**

This mechanism is proven directly for the V3K B3 regressions and is strongly supported by the mirrored B2/B4 allocation behavior.

V3B.1 PNSum Cpn=2.0 remains the incumbent. The audit does **not** show that V3B.1 itself should be reverted.

## Canonical evidence

Final diagnostic runs:
- corrected target/control root audit with proof-number snapshots: `36301281043`
- direct B3 first-divergence trace with proof-number snapshots: `36301278087`

Excluded evidence:
- `36300604498`: initial fragility selector could admit solved roots; superseded by the corrected unsolved-root + absolute-margin criterion.
- `36300911852`: runtime harness failure before research data was produced.

## Finding 1 — generic near-tie behavior is real but not causal enough

Targets:
- B2:CCW
- B3:CW
- B3:CCW
- B4:CW

Controls:
- B1:CW
- B5:CCW

The corrected 5k audit found low-margin and budget-sensitive roots in both target and control openings.

Therefore generic "near tie" / "multi-basin root" behavior is a property of the search, but is **not specific enough** to explain the recurring regression openings.

## Finding 2 — B2/B4 expose a mirrored PNSum allocation basin

The clearest state is board move 26.

### B2:CCW

The baseline root is fresh:
- subtree reuse: false
- cycle cutoffs: 0
- top branches are dominated by heuristic leaves (~82-85%)

At 5k:
- B1:CW: 1658 visits, Q=-0.5455, proof(A)=32
- B3:CW: 1526 visits, Q=-0.8549, proof(A)=18
- normalized top-two visit margin: 4.15%

The actor is A. Lower A proof number receives the stronger PNSum bias.

Fresh V3B.1 action by budget:
- 500 -> B1:CW
- 1k -> B3:CW
- 2k -> B3:CW
- 5k -> B1:CW
- 10k -> B1:CW

With Cpn=0:
- B1:CW at every tested budget from 500 through 10k.

V3K one-ply + PNSum:
- 500 -> B1:CW
- 1k -> B3:CW
- 2k -> B3:CW
- 5k -> B3:CW
- 10k -> B1:CW

Thus PNSum creates a transient alternate allocation basin, and one-ply extends how long that basin survives.

### B4:CW

B4:CW is the exact reflection:
- B5:CCW corresponds to B1:CW
- B3:CCW corresponds to B3:CW
- the budget switch pattern and root metrics mirror B2:CCW.

This argues against a reflection/canonicalization defect.

## Finding 3 — direct B3 V3K failure requires one-ply × PNSum

The direct divergence trace replayed the exact V3K 5k setup for B3:CW and B3:CCW in both candidate roles.

### Candidate as responder

B3:CW:
- first divergence: board move 7
- root is fresh
- static V3B.1: T3:CW
- V3K: T5:CCW

B3:CCW mirrors it:
- static: T3:CCW
- V3K: T1:CW

At the identical state:
- static + Cpn=2 stays on T3 at 500/1k/2k/5k/10k;
- one-ply + Cpn=0 stays on T3 at all tested budgets;
- one-ply + Cpn=2 flips away from T3 only at 5k, then returns to T3 at 10k.

Therefore:
- one-ply alone is insufficient;
- PNSum with the static evaluator is insufficient;
- subtree reuse is unnecessary;
- the observed flip requires the **one-ply + PNSum interaction**.

### Candidate as opener

B3:CW:
- first divergence: board move 12
- persistent V3K root reused ~4983 visits
- actual V3K: B4:CCW
- fresh static 5k: B3:CCW
- fresh one-ply + Cpn=2 at 5k: B3:CCW
- fresh one-ply + Cpn=2 at 10k: B4:CCW
- one-ply + Cpn=0 remains B3:CCW through 10k

B3:CCW mirrors it.

Subtree reuse therefore does not invent the alternate basin; it **accelerates** a preference that a fresh one-ply + PNSum tree reaches only with more simulations.

## Finding 4 — current Q can disagree with the accumulated visit winner

B3:CW responder at 5k, one-ply + Cpn=2:
- T5:CCW: 2538 visits, Q=-0.3657, proof(B)=20
- T3:CW: 2136 visits, Q=-0.3190, proof(B)=14

T3 has both the better current Q and the better final proof number for actor B, yet fewer accumulated visits.

The final snapshot therefore cannot explain the root visit leader. The search history matters:
1. one-ply changes frontier rewards;
2. expansion follows a different trajectory;
3. proof numbers evolve on a different tree;
4. PNSum changes subsequent allocation;
5. a branch accumulates a visit lead;
6. later Q/proof evidence can reverse while the old visit lead remains;
7. root ranking still selects by cumulative visits.

At 10k the same search self-corrects:
- T3:CW reaches 7136 visits and becomes selected;
- T5:CCW remains at 2538 visits.

The 5k failure is a **transient allocation lock-in**.

## Finding 5 — another B3 state shows direct proof bias overriding better Q

B3:CW opener, fresh one-ply at 10k:
- B4:CCW: 3502 visits, Q=-0.6922, proof(A)=42
- B3:CCW: 3291 visits, Q=-0.6107, proof(A)=51

B3:CCW has the better Q, but B4:CCW has the better proof number for actor A and wins the visit count.

With one-ply + Cpn=0 at the same state:
- B3:CCW receives 7490 visits and remains selected.

This is direct evidence that the PNSum allocation axis can outweigh current Q ordering at a mature root.

## What is ruled out

### Subtree reuse bug
Rejected as primary cause:
- B3 responder divergence occurs on a fresh root;
- B2/B4 move-26 instability also occurs on a fresh root.

Reuse can accelerate an existing basin switch but is not necessary.

### Cycle handling
Rejected at the clearest B2/B4 states:
- cycle cutoffs are zero.

### Reflection/canonicalization bug
Rejected:
- B2/B4 and B3 CW/CCW behavior mirrors almost exactly.

### Generic near-tie roots
Insufficient:
- controls also contain low-margin, budget-sensitive roots.

### One-ply evaluator alone
Rejected for B3:
- one-ply with Cpn=0 preserves the static action across every 500-10k probe.

### PNSum alone at the B3 divergence states
Rejected:
- static V3B.1 with Cpn=2 preserves the static action.

## Supported causal statement

> **PNSum is an effective incumbent improvement but a high-gain, path-dependent allocation amplifier. When another mechanism changes frontier Q or expansion order, the combined search can enter a different proof/visit basin. Because root selection is based on cumulative visits, transient allocation advantages can survive after current Q or proof evidence no longer supports them.**

For V3K-B3 this is directly demonstrated.

For B2/B4 the same mechanism class is strongly supported by:
- transient Cpn=2 action flips;
- stability at Cpn=0;
- proof preference toward the worse-Q branch in the unstable budget window;
- exact mirrored behavior.

This audit does **not** claim every historical V3F/V3H/V3I regression has individually been replayed and proven to share this exact chain.

## Research consequence

The recent strategy of stacking another local modifier directly onto V3B.1 is now poorly justified.

Future research should separate:
1. whether a new mechanism is independently useful;
2. whether it is composition-safe with PNSum.

Recommended protocol:
- do not automatically use V3B.1 as the base for every new heuristic;
- first test the new mechanism independently from PNSum when meaningful;
- only after a positive standalone signal, run a separate composition gate;
- diagnostics should record Q, proof numbers, visits and subtree reuse, not only final WDL.

## Best-supported V3L hypothesis

The cleanest next causal experiment is **Root-Neutral PNSum**:

- retain V3B.1 exactly below the root;
- set the proof-number selection term to zero only for root-child selection;
- keep Cpn=2.0 on every interior-node selection;
- keep policy priors, V3A.2 value semantics, backup, subtree reuse and visit-based root ranking unchanged;
- introduce no new tunable coefficient.

Hypothesis:

> Interior PNSum can retain useful proof guidance while preventing the proof term from directly distorting the same root visit counts used for final action ranking.

This is distinct from another Cpn grid or proof-bias formula sweep. It has not yet been implemented or strength-tested.

## Repository consequence

Retain this report on `main`.

Remove the temporary diagnostic harnesses, observation-only proof instrumentation, one-off workflows and `research/post-v3k-root-cause-audit` branch after consolidation.
