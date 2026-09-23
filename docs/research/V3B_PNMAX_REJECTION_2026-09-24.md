# PUCT V3B PNMax proof-number guidance rejection — 2026-09-24

## Verdict

**REJECT / CLOSE V3B PNMax. V3A.2 positive-only material36 remains the official incumbent.**

V3B tested per-agent Proof-Number Search guidance as an additional PUCT
selection term. Unlike rejected V3A.4/V3A.5, this guidance used no heuristic
state value; it was derived only from terminal/unknown tree structure.

All preregistered PNMax coefficients produced unfavorable Quan Gia opening
pairs at 5k. The lightest coefficient, Cpn=0.1, had both of its unfavorable
pairs reproduced exactly in targeted confirmation.

No 10k/20k/50k promotion gate is justified.

## Motivation

The original V3A roadmap explicitly deferred proof-number bias to V3B.

The experiment was based on the MCTS-Solver / PN-MCTS / GPN-MCTS research line:
- Winands, Björnsson and Saito, "Monte-Carlo Tree Search Solver" (2008);
- Doe et al., "Combining Monte-Carlo Tree Search with Proof-Number Search"
  (CoG 2022);
- Kowalski et al., "Proof Number Based Monte-Carlo Tree Search"
  (IEEE Transactions on Games, 2024);
- Kowalski et al., "Generalized Proof-Number Monte-Carlo Tree Search"
  (arXiv:2506.13249 / ECAI 2025).

The latest GPN-MCTS work tracks proof numbers per player and proposes PNMax as
a low-overhead selection bias. Its published experiments included Awari, a
Mancala-family game, where PNMax's strongest tested coefficient was Cpn=0.1.

## Candidate definition

Each node maintained proof numbers independently for research agents A and B:

- unknown unexpanded leaf: pn = 1;
- terminal win for agent p: pn[p] = 0;
- terminal loss or draw for p: pn[p] = infinity;
- node where p moves (OR): pn[p] = min(child pn[p]);
- opponent node (AND): pn[p] = sum(child pn[p]).

Selection used proof numbers for the agent to move at the current node.

For siblings I:

`PNMax(i,I) = 0` when pn(i) is infinity, otherwise

`PNMax(i,I) = 1 - (pn(i)-minFinite)/(1+maxFinite-minFinite)`.

Selection:

`PUCT_V3B = PUCT_V3A2 + Cpn * PNMax`.

Frozen V3A.2 semantics:
- positive-only material36 evaluator;
- ordinary valueSum/visits backup;
- policy priors;
- subtree reuse;
- cycle cutoff;
- exact W/D/L solved propagation;
- root move ranking by visits.

A Cpn=0 parity guard verified incumbent behavior remained unchanged when
proof-number bias was disabled.

## Preregistered primary-mode 5k screen

Protocol:
- mode: `quan-gia-threefold`;
- 5,000 fixed simulations per decision;
- all 10 openings;
- candidate once as opener and once as responder;
- unresolved games censored;
- incumbent: V3A.2 positive-only material36.

### Cpn=1.0

- candidate: **6W-0D-14L**
- unresolved games: 0
- favorable / neutral / unfavorable / unresolved pairs: **2 / 2 / 6 / 0**
- unfavorable:
  - `B2:CW`
  - `B2:CCW`
  - `B3:CW`
  - `B3:CCW`
  - `B4:CW`
  - `B4:CCW`

Decision: reject.

### Cpn=0.5

- candidate: **8W-4D-8L**
- unresolved games: 0
- pairs: **2 / 4 / 4 / 0**
- unfavorable:
  - `B2:CCW`
  - `B3:CW`
  - `B3:CCW`
  - `B4:CW`

Decision: reject.

### Cpn=0.1

- resolved candidate games: **8W-2D-8L**
- unresolved games: 2
- pairs: **4 favorable / 2 neutral / 2 unfavorable / 2 unresolved**
- unfavorable:
  - `B1:CCW`
  - `B5:CW`
- unresolved:
  - `B2:CW`
  - `B4:CCW`

Targeted same-budget confirmation:
- `B1:CCW`: **0W-0D-2L** -> unfavorable
- `B5:CW`: **0W-0D-2L** -> unfavorable

Both regressions therefore reproduced decisively.

## Interpretation

The result rejects **PNMax selection bias with the preregistered coefficient
grid** as a safe improvement over V3A.2 for Quan Gia + Threefold.

The failure pattern is monotonic enough to be informative:
- Cpn=1.0 overweights proof pressure severely;
- Cpn=0.5 still creates four regressions;
- Cpn=0.1 reduces the damage but retains two repeatable edge-opening
  regressions.

This does not reject the entire proof-number research family. The literature
shows that PNRank, PNMax and PNSum can behave very differently by game, and the
best Cpn is strongly domain-dependent. It does reject PNMax as the first V3B
candidate under the current initialization and selection design.

Do not rescue PNMax post hoc with coefficients below 0.1. A future proof-number
experiment should introduce a distinct causal change, such as a different
bias formula (PNRank/PNSum) or mobility-based proof-number initialization, and
must be preregistered as a new study.

## Decision consequence

- Keep **V3A.2 positive-only material36** as official incumbent.
- Close V3B PNMax.
- Do not run V3B PNMax 10k/20k/50k.
- Do not run Pie/Standard reference gates because the primary Quan Gia gate
  already failed.
- Keep Quan Gia + Threefold as primary optimization/promotion mode.
- Pie + Threefold and Standard remain reference modes.
- Keep unresolved games censored.
- PVS/NegaScout remains excluded.

## Evidence runs

- Quan Gia 5k coefficient screen: Actions run `35904162847`
- Cpn=0.1 targeted confirmation: Actions run `35904819817`
