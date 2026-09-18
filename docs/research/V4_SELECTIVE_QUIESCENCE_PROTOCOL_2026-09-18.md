# PUCT V4 selective-quiescence research protocol — 2026-09-18

## Baseline

Canonical incumbent: **PUCT V3A.1 material36**.

V4 must be evaluated against V3A.1, not against historical V3A.

Historical PVS/NegaScout remains excluded from active evaluation.

## Hypothesis

V3A.1 fixed a validated horizon bias caused by over-trusting temporary
scoreDelta at early/midgame heuristic leaves. The next likely residual weakness
is different: some leaves are evaluated immediately before a large tactical
score swing that is already visible one legal move deeper.

Blind one-ply bootstrap was previously rejected because applying it to every
heuristic leaf distorted search and made the known move-2 B5 branch stronger.

V4 therefore tests **selective quiescence**:

- default leaf evaluation remains exactly V3A.1;
- after a heuristic leaf is expanded, inspect the already-created children;
- only if an immediate child changes engine-agent score delta by at least a
  configured threshold, or contains an exact solved/terminal child, treat the
  leaf as tactically unstable;
- only unstable leaves use a one-ply max/min heuristic bootstrap;
- stable leaves keep the V3A.1 static heuristic;
- no extra game move is generated beyond children V3A already expanded;
- PUCT exploration, priors, tree reuse, solved propagation and root ranking are
  unchanged.

This isolates one question: can a narrow tactical extension improve leaf
quality without reintroducing the broad one-ply failure?

## Phase V4-A — causal safety scan

Use the two previously validated horizon-bias cases as regression guards:

- move 2: winning B4:CW must remain preferred over drawing B5:CCW;
- move 34: winning B2:CW must remain preferred over drawing B5:CCW.

Candidate thresholds should be scanned at fixed high budgets with
`leafScoreMaterialMax=36`.

Initial score-swing thresholds:

- 4
- 6
- 8
- 10
- 12
- 15
- 20

Reject any threshold that flips either known case back to the inferior branch.

The scan is a safety gate, not evidence that V4 is stronger.

## Phase V4-B — broad same-family screen

For surviving thresholds:

- compare selective-quiescence V4 against canonical V3A.1;
- use the same Stage 1/2/3 seat-swapped corpus used for V3A.1 promotion;
- start at 10,000 fixed simulations per decision;
- unresolved games are censored, never heuristic-adjudicated;
- do not pool incomplete pairs.

A candidate with clear broad regression is rejected even if it looks tactical
in isolated positions.

## Phase V4-C — disagreement validation

If V4 survives the broad screen, collect positions where V4 and V3A.1 choose
different root moves.

For each disagreement:

1. freeze the exact position;
2. independently continue each candidate root action with a strong fresh V3A.1
   search;
3. use seat/reflection controls where applicable;
4. classify whether V4 discovered a better branch, merely changed a draw basin,
   or introduced a worse move.

Promotion requires concrete positive branch-quality evidence, not merely a
different root action.

## Phase V4-D — promotion gate

Only after V4-C shows genuine positive disagreements:

- rerun Stage 1/2/3 at 20k and 50k fixed simulations;
- run code-parity Trạng Nguyên envelope comparison;
- preserve V3A.1 as frozen baseline;
- document all rejected thresholds and failure modes.

## Promotion criteria

V4 may replace V3A.1 only if all are true:

1. no known V3A.1 repaired anomaly regresses;
2. no material broad same-family regression;
3. at least one independently validated disagreement favors V4;
4. the benefit survives more than one search budget;
5. code-parity Trạng Nguyên evidence remains non-regressive in every required
   stratum;
6. the change remains isolated to selective leaf quiescence.

If these conditions are not met, V3A.1 remains incumbent.

## Non-goals

This track does not tune:

- C_puct;
- policy temperature;
- root visit ranking;
- policy-prior score weight;
- material36 threshold;
- random rollouts;
- PNS/MCGS;
- production learning snapshot.

Those are separate experiments and must not be mixed into V4 selective
quiescence.
