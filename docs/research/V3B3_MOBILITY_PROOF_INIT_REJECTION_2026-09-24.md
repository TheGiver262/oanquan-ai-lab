# V3B.3 mobility proof initialization rejection — 2026-09-24

## Verdict

**REJECT / CLOSE V3B.3. V3B.1 PNSum Cpn=2.0 remains the canonical incumbent for Quan Gia + Threefold.**

V3B.3 kept the promoted V3B.1 search configuration and changed only the proof
number initialization of unknown nonterminal leaves to the GPN-MCTS
mobility-based rule.

The Quan Gia 5k gate produced four unfavorable opening pairs. All four
regressions were rerun independently at the identical budget and reproduced
exactly.

No 10k/20k/50k or reference-mode gates are justified.

## Literature hypothesis

Generalized Proof-Number Monte-Carlo Tree Search describes mobility-based
initialization as a classic PNS enhancement applicable to GPN-MCTS.

For an unknown leaf, proof number initialization is:
- OR node for player p: pn[p] = 1
- AND node for player p: pn[p] = number of legal moves at the node

This acts as one-step lookahead for estimating proof-tree size.

## Candidate

V3B.3 froze all promoted V3B.1 settings:
- PNSum
- Cpn=2.0
- V3A.2 positive-only material36 evaluator
- c_puct=1.5
- policy temperature=0.6
- heuristic policy priors
- subtree reuse
- cycle cutoff
- exact W/D/L solved propagation
- ordinary valueSum/visits backup
- final root ranking by visits

Score-Bounded MCTS remained disabled.

Only unknown nonterminal proof-number initialization changed.

For state s:
- m = max(1, legal action count)
- a = agent to move
- pn[a] = 1
- pn[other(a)] = m

Once a node is expanded, proof numbers use the same V3B.1 min/sum propagation.

## Correctness gates

Before strength testing:
- typecheck passed
- tests passed
- build passed
- V3B.1 path remained identical with mobility initialization disabled
- initial Quan Gia root mobility proof numbers were verified as {A:1, B:10}
- OR/AND initialization was verified after a legal move
- legal-action behavior was verified

## Quan Gia 5k gate

Protocol:
- candidate: V3B.3 PNSum Cpn=2.0 + mobility initialization
- incumbent: V3B.1 PNSum Cpn=2.0
- mode: `quan-gia-threefold`
- 5,000 fixed simulations per decision
- all 10 openings
- candidate once as opener and once as responder
- maxBoardMoves=200
- unresolved games censored

Aggregate:
- candidate: **6W-2D-12L**
- favorable / neutral / unfavorable / unresolved pairs:
  **2 / 4 / 4 / 0**

Favorable:
- `B2:CCW`: 1W-1D-0L
- `B4:CW`: 1W-1D-0L

Neutral:
- `B1:CCW`: 1W-0D-1L
- `B2:CW`: 1W-0D-1L
- `B4:CCW`: 1W-0D-1L
- `B5:CW`: 1W-0D-1L

Unfavorable:
- `B1:CW`: 0W-0D-2L
- `B3:CW`: 0W-0D-2L
- `B3:CCW`: 0W-0D-2L
- `B5:CCW`: 0W-0D-2L

No unresolved games.

## Targeted confirmation

All four unfavorable openings were rerun at the identical 5k settings:

- `B1:CW`: **0W-0D-2L** -> reproduced
- `B3:CW`: **0W-0D-2L** -> reproduced
- `B3:CCW`: **0W-0D-2L** -> reproduced
- `B5:CCW`: **0W-0D-2L** -> reproduced

The regression is therefore deterministic/repeatable under the registered
benchmark setup rather than a one-off aggregate fluctuation.

## Interpretation

The mobility initialization changes PNSum allocation substantially enough to
produce gains in two opening pairs, but those gains are outweighed by four
repeatable pair regressions.

For Quan Gia + Threefold with the promoted PNSum Cpn=2.0 selection formula,
legal-move count is therefore not a safe proxy for proof difficulty under this
initialization rule.

This rejects the **mobility initialization addition to V3B.1**, not the
published GPN-MCTS method in general. The paper evaluates a broad set of game
domains and does not guarantee that every enhancement improves every game.

Do not rescue V3B.3 by:
- scaling the mobility value
- applying mobility only above/below an arbitrary branching threshold
- retuning Cpn around the mobility initializer

Those would be new hypotheses requiring separate preregistration.

## Decision consequence

- Keep **V3B.1 PNSum Cpn=2.0** as Quan Gia + Threefold incumbent.
- Close V3B.3.
- Do not run V3B.3 10k/20k/50k.
- Do not run Pie/Standard reference checks.
- Keep V3B.2 closed for no-gain.
- Keep unresolved games censored.
- Keep PVS/NegaScout excluded.

## Evidence runs

- Quan Gia 5k gate: Actions run `35925364412`
- four-opening confirmation: Actions run `35925487364`

## Source

Jakub Kowalski, Dennis J. N. J. Soemers, Szymon Kosakowski, Mark H. M.
Winands, "Generalized Proof-Number Monte-Carlo Tree Search", ECAI 2025,
DOI 10.3233/FAIA251406, Section 3.3; arXiv:2506.13249.

## Repository consequence

Retain only this consolidated rejection evidence on main.
Delete the temporary implementation, tests, benchmark, workflows and research
branch after consolidation.
