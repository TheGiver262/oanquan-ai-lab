import { solveExactPolicyState } from "../research/exact-policy-solver-v5.js";
import { replayV3PvWithPolicy } from "../research/pv-policy-replay-v5.js";
import type { RepetitionPolicy } from "../research/repetition-policy-v5.js";
import type { V3EvaluationFamily, V3FinalistOpening } from "../research/v3-pv-corpus.js";

const opening = requiredStringArg("--opening") as V3FinalistOpening;
const family = requiredStringArg("--family") as V3EvaluationFamily;
const policy = parsePolicy(requiredStringArg("--policy"));
const maxRootBoardValue = intArg("--max-board-value", 30);
const nodeBudget = intArg("--nodes", 2_000_000);
const timeBudgetMs = intArg("--time", 60_000);

if (opening !== "B3:CW" && opening !== "B3:CCW") {
  throw new Error("--opening must be B3:CW or B3:CCW");
}
if (family !== "material" && family !== "strategic") {
  throw new Error("--family must be material or strategic");
}

const replay = replayV3PvWithPolicy(opening, family, policy);
const eligible = replay.snapshots
  .filter((snapshot) => snapshot.state.game.status === "finished" || snapshot.state.adjudication !== null || snapshot.boardValue <= maxRootBoardValue)
  .sort((a, b) => b.ply - a.ply);
const selected = eligible[0] ?? replay.snapshots[replay.snapshots.length - 1]!;

const result = solveExactPolicyState(selected.state, policy, {
  maxRootBoardValue,
  nodeBudget,
  timeBudgetMs,
});

console.log(JSON.stringify({
  methodology: {
    phase: "Opening Balance V5 repetition-policy exact probe",
    purpose: "test whether explicit repetition semantics make V3 finalist subgames exactly solvable",
    history: "the selected deep node retains repetition counts accumulated from the true initial position",
    utility: "natural terminal score margin; policy adjudication is exact draw value 0",
    claimLimit: "exact only when the policy-aware solver returns solved; budget exhaustion is not a game value",
  },
  opening,
  family,
  policy,
  replay: {
    completedRecordedLine: replay.completedRecordedLine,
    stoppedReason: replay.stoppedReason,
    finalRecordedPly: replay.snapshots[replay.snapshots.length - 1]!.ply,
    finalAdjudication: replay.snapshots[replay.snapshots.length - 1]!.state.adjudication,
  },
  selectedRoot: {
    ply: selected.ply,
    moveApplied: selected.moveApplied,
    boardValue: selected.boardValue,
    currentPlayer: selected.state.game.currentPlayer,
    scores: selected.state.game.scores,
    historyPlies: selected.state.plies,
    adjudication: selected.state.adjudication,
    distinctStrategicStatesSeen: selected.state.repetitionCounts.size,
    maximumOccurrenceCount: Math.max(...selected.state.repetitionCounts.values()),
  },
  config: { maxRootBoardValue, nodeBudget, timeBudgetMs },
  result: {
    status: result.status,
    solved: result.solved,
    value: result.value,
    outcome: result.outcome,
    bestMove: result.bestMove ? `${result.bestMove.pit}:${result.bestMove.dir}` : null,
    principalVariation: result.principalVariation.map((move) => `${move.pit}:${move.dir}`),
    diagnostics: result.diagnostics,
  },
}, null, 2));

function parsePolicy(value: string): RepetitionPolicy {
  if (value === "none") return { kind: "none" };
  if (value === "repeat2") return { kind: "repeat-draw", occurrences: 2 };
  if (value === "repeat3") return { kind: "repeat-draw", occurrences: 3 };
  if (value.startsWith("max")) {
    const maxPlies = Number.parseInt(value.slice(3), 10);
    if (!Number.isFinite(maxPlies) || maxPlies <= 0) throw new Error(`Invalid max-ply policy ${value}`);
    return { kind: "max-ply", maxPlies };
  }
  throw new Error(`Unknown policy ${value}`);
}

function requiredStringArg(name: string): string {
  const value = stringArg(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function stringArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function intArg(name: string, fallback: number): number {
  const raw = stringArg(name);
  if (raw === null) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}
