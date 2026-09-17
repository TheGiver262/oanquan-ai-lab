# AI track closed; balanced-mode track opened — 2026-09-17

## Decision

The algorithm-discovery race is closed for the current research cycle.

PUCT V3A (`ReusableScoreBoundedPuct`) is the canonical research incumbent for Standard/classic 2-player Ô Ăn Quan. No additional challenger tournament is required before the project moves to competitive-mode balance research.

This decision means:

- PUCT V3A remains the primary AI/search stack to optimize.
- Future work on V3A may include latency/memory tuning, production integration, stronger evaluation features, and self-learning/experience components.
- Self-learning is treated as an optimization layer, not as proof of game-theoretic invincibility.
- PVS/NegaScout remains excluded from future active algorithm research.
- UCT, UCT-PB, Alpha-Beta, Minimax, Bảng Nhãn, Thám Hoa, and Trạng Nguyên are not reopened as promotion candidates in this research cycle.
- Existing independent engines may still be used as balance cross-checks so that mode fairness is not judged by one search style alone.

## Balance-study evaluator policy

A self-learning engine must not remain mutable while it is being used to measure game balance. Otherwise learning an opening exploit can be mistaken for evidence that the ruleset itself is biased.

Therefore balance experiments use:

1. a frozen deterministic PUCT V3A snapshot as the primary evaluator;
2. fixed independent control evaluators drawn from existing implementations (especially UCT/UCT-PB and the audited Trạng Nguyên reference) only to test engine-consensus;
3. no further tuning of those control engines inside a balance comparison;
4. identical evaluator snapshots across every ruleset/mode in the same experiment.

## Research question

The active project question is now:

> Which two-player competitive mode/ruleset minimizes opener/seat advantage while preserving acceptable game length, draw rate, strategic variety, and product UX?

## Candidate set

The balance tournament should evaluate candidates independently before combinations are allowed:

1. unrestricted Standard/classic;
2. forced `B3:CW`;
3. forced `B3:CCW`;
4. a validated Balanced Opening Pool if enough neutral openings can be established;
5. Standard + Pie Rule;
6. BO2/paired format with alternating first player;
7. `no_first_quan_v1` / Cấm Quan;
8. `mature_quan_v1` / Quan >=5;
9. Swap2-inspired opening protocol only if plain Pie remains materially exploitable;
10. combinations only after the components have been measured independently.

## First comparison order

### Gate B1 — baseline and current extended rules

Measure independently under the frozen evaluator pool:

- Standard;
- Cấm Quan;
- Quan >=5.

This establishes the raw ruleset effect before any opening protocol is added.

### Gate B2 — opening protocols

Measure:

- forced `B3:CW`;
- forced `B3:CCW`;
- Standard + Pie;
- BO2/paired alternating-first-player format.

The existing R1b Cấm Quan vs Standard+Pie protocol is retained as prior methodology but must be updated to make frozen V3A the primary evaluator.

### Gate B3 — finalist confirmation

Only modes that materially reduce opener advantage without unacceptable UX regressions advance. Finalists are rerun with:

- multiple independent UCT-family seeds where applicable;
- frozen V3A runtime robustness;
- audited Trạng Nguyên cross-check;
- unresolved replay at higher move caps;
- per-opening and paired-seat reporting.

## Required metrics

For every candidate mode/ruleset report:

- opener/P0 and responder/P1 W-L-D-U;
- normalized opener score/value;
- paired-seat differential;
- per-opening value and worst-opening bias;
- median absolute opening bias;
- best guaranteed opener value;
- opening/reply concentration and entropy;
- draw/repetition/unresolved rate;
- median/P95 game length;
- score-margin distribution and comeback potential;
- evaluator consensus/disagreement;
- search/runtime diagnostics;
- UX impact reported separately from fairness.

No candidate is called a `balanced mode` from a small self-play sample alone.

## Status language

Use:

- `baseline mode` — reference only;
- `balanced candidate mode` — bounded/statistical evidence supports improved fairness;
- `balanced mode` — evidence is strong enough for a production fairness claim;
- `game solved` — reserved for an actual game-theoretic solution under an explicit ruleset/opening protocol.

## Immediate next action

Build the balance benchmark on `research/balanced-mode-tournament`, beginning with Gate B1 (Standard vs Cấm Quan vs Quan >=5) using one frozen V3A snapshot and unchanged cross-check evaluators. Do not alter production during this research phase.
