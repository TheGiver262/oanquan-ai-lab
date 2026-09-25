# V3D exact endgame frontier solver — operational rejection — 2026-09-25

## Verdict

**REJECT / CLOSE V3D before the 5k strength gate.**

V3B.1 PNSum Cpn=2.0 remains the canonical Quan Gia + Threefold incumbent.

V3D was designed to add exact W/D/L solving only at very small frontier states
(material <= 12), with UNKNOWN fallback preserving incumbent behavior whenever
the solver could not prove the result.

Correctness was made conservative, but the compute diagnostic showed that the
registered solver architecture is operationally infeasible: most calls consume
nearly the entire 100,000-node local budget and still return UNKNOWN.

Running the preregistered 5k strength gate would therefore spend orders of
magnitude more compute without evidence that the exact solver is resolving
enough frontier states to justify that cost.

## Candidate

V3D kept V3B.1 frozen:
- PNSum
- Cpn=2.0
- V3A.2 positive-only material36 evaluator
- c_puct=1.5
- policy temperature=0.6
- heuristic priors
- subtree reuse
- cycle cutoff
- exact tree-local W/D/L propagation
- ordinary valueSum/visits backup
- root ranking by visits

New mechanism:
- at unresolved frontier nodes with raw board material <=12;
- invoke an exact full-width W/D/L solver;
- maximum 100,000 solver nodes per invocation;
- exact result may set solvedOutcome;
- UNKNOWN falls back to unmodified V3B.1 heuristic evaluation.

No global exact-result TT was used.

## Correctness work completed

Before the compute diagnostic, several implementation issues were found and
fixed:

1. Recursive search could exceed the JavaScript call stack.
   - Added a recursion-depth guard.
   - Guard returns UNKNOWN, never an invented W/D/L result.

2. Memo key originally included absolute moveNumber.
   - Replaced with first-move phase plus recentMoves and the full strategic
     BalanceState fields needed for rules/history.
   - Prevents strategically identical later positions from being split solely
     by absolute ply count.

3. An UNKNOWN frontier node could be exact-solved repeatedly across later PUCT
   simulations.
   - Added per-tree-node attempt state.
   - Each frontier node now invokes the exact solver at most once.

4. Alpha-beta cutoff results could be memoized as if exact.
   - Cutoff-derived bounds are no longer stored as exact local memo results.

5. Terminal W/D/L, legal-move behavior, incumbent midgame parity and a finite
   legal tiny-endgame fixture were covered by tests.

CI passed after the correctness fixes.

## Compute diagnostic

A non-strength diagnostic was run on:
- mode: quan-gia-threefold
- opening: B3:CW
- candidate vs V3B.1 paired roles
- **50 MCTS simulations per decision**
- maxBoardMoves=200

Result:
- candidate W/D/L: **1W-0D-1L**
- pair status: neutral
- candidate decisions: **15**
- exact-solver calls: **145**
- exact solves: **12**
- UNKNOWN calls: **133**
- total exact-solver nodes: **13,300,140**
- mean solver nodes/call: **91,725.10**
- exact solve rate: **8.28%**

The strength result at 50 simulations is diagnostic-only and is not promotion
evidence.

## Operational interpretation

The key signal is not the neutral 1-1 pair. It is solver efficiency.

At only 50 MCTS simulations:
- the candidate already made 145 exact-solver invocations;
- over 91% of those calls returned UNKNOWN;
- average call cost was ~91.7% of the hard 100k-node cap;
- the solver consumed 13.3 million extra nodes for one opening pair.

This means the current material<=12 trigger does not isolate a tractable
tablebase-like endgame region. Many such states still have a large/cyclic
reachable game graph under Quan Gia + Threefold.

A 5k benchmark would increase the MCTS budget by 100x. Exact-solver cost is not
guaranteed to scale linearly, but the 50-sim diagnostic already shows a severe
cost-to-information imbalance. Launching the registered 10-opening 5k gate is
therefore not justified.

## Decision consequence

- Keep **V3B.1 PNSum Cpn=2.0** as Quan Gia + Threefold incumbent.
- Close V3D.
- Do not run the 5k/10k/20k/50k strength sequence.
- Do not treat the 50-sim neutral pair as strength evidence.
- Do not rescue V3D by post-hoc threshold/budget sweeps.
- Do not reintroduce global solved TT reuse from V3A.3.

A future endgame project would need a fundamentally different architecture,
for example:
- an offline retrograde/tablebase construction for a rigorously bounded state
  subset; or
- a much stronger exact-state compression/decomposition that proves the
  endgame region is tractable before integrating it into PUCT.

Those are new research programs, not V3D parameter tuning.

## Evidence

- Clean 50-sim compute diagnostic: Actions run `36080872806`
- Diagnostic summary:
  - solverCalls=145
  - solverSolved=12
  - solverUnknown=133
  - solverNodes=13,300,140
  - meanSolverNodesPerCall=91,725.10
  - exactSolveRate=8.28%

The earlier V3D 5k attempts are infrastructure/implementation-invalid and are
not strength evidence.
