# Core balance-mode protocol — 2026-09-18

## Scope decision

The balance study no longer uses forced openings as candidate competitive modes. In particular, `B3:CW`, `B3:CCW`, and any mandatory opening move are removed from the primary candidate set. Historical opening research remains useful as evidence about opening bias, but players must retain free opening choice in the target product mode.

The three primary modes are:

1. **Standard** — baseline/reference mode.
2. **Pie + Threefold** — Standard opening freedom, Pie/swap decision after the opener's first move, plus the corrected Threefold termination rule.
3. **Quan Gia** — `mature_quan_v1`, evaluated as a complete mode against Standard.

Standard is the benchmark. Pie + Threefold and Quan Gia are judged only by whether they improve or regress fairness and UX relative to Standard.

## Exact rule semantics

### Standard

Use `oaq:classic_2p:standard:v1` as the reference ruleset. Do not force an opening.

### Pie + Threefold

Base board/capture rules are Standard.

After the opener A makes move 1, responder B chooses:

- **KEEP** — identities remain `{P0: A, P1: B}` and B makes move 2;
- **SWAP** — identities become `{P0: B, P1: A}`; the board/history are not mirrored or rewritten, and A makes move 2 as logical P1.

Threefold uses the corrected research semantics already implemented on the repeat-parity line: when the last six full move signatures form `ABABAB`, where both A moves are identical and all three B moves are identical by `(player, pit, direction)`, the game terminates with reason `repeated_moves`. Remaining **dan** on player-owned pits are collected; remaining Quan are not automatically collected by the repetition rule; scores then determine the winner.

Pie + Threefold is intentionally evaluated as one complete product mode. The primary comparison does not attempt to attribute its effect separately to Pie versus Threefold. Component ablation is diagnostic-only if later needed.

### Quan Gia

Use `oaq:classic_2p:mature_quan:v1`.

If a Quan stone is still present in a Quan pit, that pit can be captured only when it contains at least **5 dan**. If it has fewer than 5 dan, the capture chain stops at that Quan pit. Once the Quan stone is gone, ordinary capture behavior applies to remaining dan in that pit.

No opening is forced.

## Evaluator policy

The official balance comparison uses the strongest current research engine: **PUCT V3A (`ReusableScoreBoundedPuct`)**.

Rules:

- freeze one exact V3A snapshot for the entire comparison;
- use the same search parameters and resource envelope for all three modes;
- do not allow online/self-learning updates while collecting balance evidence;
- if a materially stronger optimized/self-learning V3A snapshot is later frozen, rerun the final confirmation on all three modes with that same new snapshot;
- older engines may be used only as optional sanity checks, never as the primary mode score.

Primary runtime envelope for the first full comparison:

- `1,200 ms` per decision;
- V3A simulation ceiling `5,000,000` as a runaway guard;
- `c_puct = 1.5`;
- policy temperature `0.6`;
- no root noise.

A deeper confirmation lane may raise the time/simulation budget, but results from different resource lanes are never pooled.

## Opening freedom and evaluation design

Because no opening is forced, the benchmark must measure the whole legal opening landscape rather than only self-play from one root choice.

### Standard and Quan Gia

1. Enumerate every legal first move from the initial state.
2. For each opening, continue the game with frozen V3A on both sides.
3. Record the opener's normalized value and final outcome for every opening.
4. Report:
   - V3A-selected root opening;
   - best bounded opener value;
   - median opening value;
   - worst responder-side opening value;
   - opening-value spread and concentration.

This avoids hiding an exploitable opening behind a near-50/50 aggregate.

### Pie + Threefold

For every legal Standard opening `X`, evaluate both branches under frozen V3A:

- `V_keep(X)` from original opener A's perspective;
- `V_swap(X)` from original opener A's perspective after identity ownership swaps.

Responder-optimal opening value:

`V_pie(X) = min(V_keep(X), V_swap(X))`

Bounded opener-equilibrium proxy:

`E_pie = max_X V_pie(X)`

The primary fairness benchmark uses this responder-optimal Pie decision, because the first question is whether the mode itself can neutralize opener advantage when both branches are evaluated by the strongest available engine. A later product-policy study may measure how well a practical player/bot chooses KEEP/SWAP.

## Standard-relative scorecard

For each mode report at minimum:

- P0/opener W-L-D-U;
- normalized opener score/value on `[-1,+1]`;
- absolute opener advantage `|V|`;
- per-opening values;
- best bounded opener value;
- median absolute opening bias;
- worst-opening absolute bias;
- opening/reply concentration and entropy;
- draw rate;
- Threefold termination rate where applicable;
- unresolved rate;
- median and P95 game length;
- final score-margin distribution;
- comeback frequency/potential where measurable;
- V3A search diagnostics and latency.

For Pie + Threefold also report KEEP and SWAP separately for every opening.

The comparison table must express Pie + Threefold and Quan Gia as deltas from Standard, not merely as standalone percentages.

## Interpretation

A mode is **better than Standard on fairness** when the strongest-V3A evidence shows a smaller absolute opener advantage and the improvement is not created merely by a large unresolved rate.

A mode is **worse than Standard** when opener advantage materially increases or when a nominal fairness gain is bought with an unacceptable UX regression such as excessive draws, repetition endings, or game length.

Do not call any mode `balanced` merely because aggregate P0/P1 W-L is near 50/50. Opening-level exploitability remains mandatory evidence.

## Backup candidate pipeline

If Standard, Pie + Threefold, and Quan Gia all retain too much P0 advantage, investigate these without forcing a specific opening move:

1. **BO2 alternating-first-player match** — two games, players swap P0/P1, aggregate match result/score decides the winner. This structurally neutralizes seat assignment at the match level while preserving complete opening freedom in each game. Product cost: longer ranked matches.
2. **Pie + Quan Gia + Threefold** — combine the two main anti-bias mechanisms only after their independent effects are known. This is the first combination candidate, not part of the initial three-mode comparison.
3. **Responder komi / score compensation** — give P1 a calibrated virtual score or tie-break compensation derived from frozen-V3A equilibrium estimates. This preserves opening freedom but is more artificial and must be calibrated conservatively.
4. **Extended/late swap protocol** — a Swap2-inspired second ownership-choice window after more opening information is revealed, without prescribing a concrete move. This is higher-complexity and should be attempted only if ordinary Pie remains exploitable.
5. **BO2 + Pie** — if single-game Pie still has residual bias but BO2 is too costly alone, evaluate Pie inside an alternating-seat two-game competitive match as a last-resort tournament format.

Randomly choosing who is P0 is not considered a solution to per-game first-player advantage; it only distributes that advantage over many matches.

## Immediate implementation order

1. Port/enable corrected Threefold semantics on `research/balanced-mode-tournament` without altering the three existing rule profiles.
2. Add Pie ownership/turn semantics as a benchmark protocol layer, not as board mirroring.
3. Verify V3A state keys and subtree reuse include every rule-relevant field needed by Threefold.
4. Build one common V3A balance harness for Standard, Pie + Threefold, and Quan Gia.
5. Run correctness tests before any strength/fairness evidence is interpreted.
6. Execute the 1,200 ms primary comparison and report every result relative to Standard.

Production remains unchanged during this research phase.
