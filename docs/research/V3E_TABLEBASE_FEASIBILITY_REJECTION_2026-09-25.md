# V3E offline tablebase feasibility — closure rejection — 2026-09-25

## Verdict

**CLOSE V3E without PUCT integration.**

V3B.1 PNSum Cpn=2.0 remains the canonical Quan Gia + Threefold incumbent.

V3E tested whether a compact offline endgame tablebase could be defined by a
small raw-physical-material threshold after V3D's online exact solver proved too
expensive.

The answer for the tested material-bounded formulation is **no**.

The decisive blocker is not raw board-state count alone. It is that
`material <= M` domains are not closed under legal Quan Gia transitions:
refill can raise board material again, so retrograde closure at a fixed
material threshold requires successor values outside the proposed tablebase.

This directly triggers the preregistered V3E stop condition.

## External precedent

Awari was solved using large-scale retrograde analysis over a very large state
space. The modern VU database describes about 889 billion Awari positions.

Practical Oware engines therefore use partial endgame tablebases; Aalina
advertises endgame tablebases at 12 seeds or fewer.

V3E intentionally did not copy the Oware threshold. Ô Ăn Quan includes refill,
quan state, score state and Threefold history, so tractability had to be
measured independently.

## Static board-layout census

For dân count d and remaining quan count q:

`count(d,q) = C(d+11,11) * C(2,q)`

For raw physical material <= M:

`B(M) = sum(q=0..2) C(2,q) * C(M-q+12,12)`

Static counts:

| M | board layouts <=M | including side to move |
|---:|---:|---:|
| 4 | 2,821 | 5,642 |
| 6 | 32,760 | 65,520 |
| 8 | 245,310 | 490,620 |
| 10 | 1,360,476 | 2,720,952 |
| 12 | 6,054,958 | 12,109,916 |

These are combinatorial board-layout counts, not reachable strategic-state
counts.

## Threefold history compression result

The engine keeps up to six full MoveSignatures and terminates when the last six
moves form:

`A, B, A, B, A, B`

V3E implemented a compact streaming automaton that stores at most:
- two move-signature anchors; and
- progress length through the alternating pattern.

For a fixed side-to-move phase:
- naive six-ply history upper bound: **1,000,000** histories;
- compact nonterminal automaton upper bound: **411** states.

The automaton was tested against the naive repetition rule:
- exhaustive generic alphabet sequences;
- legal alternating MoveSignature sequences;
- detection compared at every prefix until the engine-equivalent terminal
  repetition event.

CI passed.

This is a useful representation result even though the material-bounded
tablebase itself is rejected.

## Compact Quan Gia state-key findings

For the primary Quan Gia + Threefold mode:

- seat/swap state is not part of the game rules and is unnecessary for the
  primary tablebase key;
- `skipCounts` currently does not affect any legal transition or terminal rule
  in the engine;
- `moveNumber` matters to the no-first-quan profile, but not to the
  mature-quan profile after initial-state distinction;
- scores cannot be ignored because refill legality depends on them;
- Threefold history must be retained, but can use the compact automaton instead
  of the raw six-move array.

The census also verified conservation for every sampled playing state:

`scoreP0 + scoreP1 + board weighted value = 70`

Therefore one score can in principle determine the other when board weighted
value is known.

## Reachable-state census

Deterministic diagnostic:
- mode: quan-gia-threefold
- 5,000 games
- seeded uniformly random legal action policy
- seed: 388830
- maxBoardMoves: 200

Aggregate:
- finished games: **5,000**
- unresolved games: **0**
- total moves: **134,135**
- conservation violations: **0**

This sample is an empirical lower bound only, not a proof of the complete
reachable state count.

### Sampled state multiplicity

| M | unique board keys | unique compact strategic keys | strategic / board | max strategic states per board |
|---:|---:|---:|---:|---:|
| 4 | 668 | 2,630 | 3.94x | 22 |
| 6 | 4,064 | 8,342 | 2.05x | 22 |
| 8 | 10,032 | 16,508 | 1.65x | 32 |
| 10 | 16,949 | 24,861 | 1.47x | 32 |
| 12 | 22,961 | 31,826 | 1.39x | 32 |

The same board position can therefore correspond to many strategically distinct
states due to score/history metadata.

### Sampled branching

| M | mean legal branching | max |
|---:|---:|---:|
| 4 | 2.24 | 6 |
| 6 | 2.79 | 10 |
| 8 | 3.42 | 10 |
| 10 | 3.82 | 10 |
| 12 | 4.10 | 10 |

## Transition-closure test

For every sampled playing state at each threshold, V3E enumerated legal
successors and measured whether a successor remained inside the same
material-bounded domain.

Results:

| M | states with an escaping legal successor | escaping legal actions | max successor material |
|---:|---:|---:|---:|
| 4 | **25.44%** | 22.49% | 9 |
| 6 | **24.69%** | 21.23% | 11 |
| 8 | **20.14%** | 16.92% | 13 |
| 10 | **14.40%** | 12.28% | 15 |
| 12 | **8.06%** | 6.52% | 17 |

Even at M<=12, roughly one sampled state in twelve had at least one legal move
that escaped the proposed tablebase domain.

The maximum jump is consistently +5 material, matching the engine's five-stone
refill mechanism.

## Interpretation

A raw-board-material threshold is not a valid independent retrograde domain for
Quan Gia + Threefold.

Unlike ordinary capture-only endgames where remaining material trends downward,
Ô Ăn Quan can spend captured score to refill five dân onto an empty side.
Therefore physical board material is non-monotonic.

This explains both:
- why V3D's online exact solver often consumed its full budget and returned
  UNKNOWN; and
- why an Oware-style "N seeds or fewer" tablebase threshold cannot be copied
  directly.

The issue persists across every tested threshold from 4 through 12.

## Decision consequence

- Keep **V3B.1 PNSum Cpn=2.0** as Quan Gia + Threefold incumbent.
- Do not integrate V3E into PUCT.
- Do not build a retrograde tablebase indexed only by raw physical material.
- Keep the compact Threefold repetition automaton as a valid research result.
- Keep the conservation/key analysis as future infrastructure evidence.
- Do not rescue V3E by simply raising M above 12; closure failure is structural,
  not a threshold-tuning problem.

A future exact-tablebase project would require a domain definition that is
actually closed under refill transitions, or a much broader state-space solve.
That is a new research problem.

## Evidence

- V3E reachable census run: `36082038119`
- V3E closure census run: `36082234714`
- V3E automaton/census CI: PASS

## Sources

- J.W. Romein, H.E. Bal, "Solving the Game of Awari using Parallel Retrograde
  Analysis", IEEE Computer, 2003.
- VU Awari game score database.
- Aalina Oware engine documentation.
