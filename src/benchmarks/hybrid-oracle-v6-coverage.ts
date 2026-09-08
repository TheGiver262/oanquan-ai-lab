import { createInitialState, getLegalMoves } from "../engine.js";
import { boardValue, solveExactEndgame } from "../research/exact-endgame-v4.js";
import { solveExactPolicyState } from "../research/exact-policy-solver-v5.js";
import { canUseCanonicalAcyclicOracle } from "../research/hybrid-exact-oracle-v6.js";
import {
  applyPolicyMove,
  createPolicyState,
  type PolicyState,
  type RepetitionPolicy,
} from "../research/repetition-policy-v5.js";
import { V3_50M_PV } from "../research/v3-pv-corpus.js";
import type { Direction, PlayerMove } from "../types.js";

const maxBoardValue = intArg("--max-board-value", 12);
const oracleNodes = intArg("--oracle-nodes", 50_000);
const oracleMs = intArg("--oracle-ms", 50);
const maxProbesPerLine = intArg("--max-probes-per-line", 12);
const policyName = stringArg("--policy") ?? "repeat3";
const oracleMode = stringArg("--oracle-mode") ?? "policy";

if (oracleMode !== "policy" && oracleMode !== "canonical-acyclic") {
  throw new Error("--oracle-mode must be policy or canonical-acyclic");
}

const policy: RepetitionPolicy = policyName === "repeat2"
  ? { kind: "repeat-draw", occurrences: 2 }
  : policyName === "repeat3"
    ? { kind: "repeat-draw", occurrences: 3 }
    : policyName === "none"
      ? { kind: "none" }
      : (() => { throw new Error("--policy must be repeat2, repeat3 or none"); })();

const lines = Object.entries(V3_50M_PV).map(([line, pv]) => {
  const openingKey = line.startsWith("B3:CW:") ? "B3:CW" : "B3:CCW";
  const snapshots = replayPolicyPv(openingKey, pv, policy);
  const eligible = snapshots
    .filter((snapshot) => snapshot.state.game.status === "finished" || snapshot.boardValue <= maxBoardValue)
    .sort((a, b) => b.ply - a.ply)
    .slice(0, maxProbesPerLine);

  const probes = eligible.map((snapshot) => {
    const result = runProbe(snapshot.state);
    return {
      ply: snapshot.ply,
      moveApplied: snapshot.moveApplied,
      boardValue: snapshot.boardValue,
      currentPlayer: snapshot.state.game.currentPlayer,
      scores: snapshot.state.game.scores,
      historyMaxOccurrence: maxHistoryOccurrence(snapshot.state),
      canonicalSafe: canUseCanonicalAcyclicOracle(snapshot.state, policy),
      ...result,
    };
  });

  return {
    line,
    eligibleSnapshots: eligible.length,
    solved: probes.filter((probe) => probe.solved).length,
    probes,
  };
});

const allProbes = lines.flatMap((line) => line.probes);
const solved = allProbes.filter((probe) => probe.solved);
const statusCounts = Object.fromEntries(
  [...new Set(allProbes.map((probe) => probe.status))].sort().map((status) => [
    status,
    allProbes.filter((probe) => probe.status === status).length,
  ]),
);

console.log(JSON.stringify({
  methodology: {
    phase: "Hybrid Exact Oracle V6 coverage",
    sourceCorpus: "four V3 50M principal variations recorded in src/research/v3-pv-corpus.ts",
    policyHistory: "the selected repetition policy is applied during PV replay, so every oracle receives the real accumulated PolicyState rather than a fresh board-only history",
    exactness: oracleMode === "policy"
      ? "a hit is counted only when the full policy-history-aware exact solver returns solved=true"
      : "a hit is counted only when canonical reuse is proof-safe under the current history and solveExactEndgame returns solved=true; any future cycle makes that solver unresolved",
    purpose: "measure whether an exact oracle is tractable often enough at production-like per-probe budgets before using it in expensive match tournaments",
  },
  config: {
    policy,
    oracleMode,
    maxBoardValue,
    oracleNodes,
    oracleMs,
    maxProbesPerLine,
  },
  aggregate: {
    lines: lines.length,
    probes: allProbes.length,
    solved: solved.length,
    hitRate: allProbes.length === 0 ? 0 : solved.length / allProbes.length,
    canonicalSafeProbes: allProbes.filter((probe) => probe.canonicalSafe).length,
    totalOracleNodes: allProbes.reduce((sum, probe) => sum + probe.diagnostics.nodeCount, 0),
    totalPolicyDrawLeaves: allProbes.reduce((sum, probe) => sum + probe.diagnostics.policyDrawLeaves, 0),
    totalNaturalTerminalLeaves: allProbes.reduce((sum, probe) => sum + probe.diagnostics.naturalTerminalLeaves, 0),
    totalCycleEdges: allProbes.reduce((sum, probe) => sum + probe.diagnostics.cycleEdges, 0),
    statusCounts,
  },
  lines,
}, null, 2));

type Snapshot = {
  ply: number;
  moveApplied: string;
  boardValue: number;
  state: PolicyState;
};

type NormalizedProbe = {
  status: string;
  solved: boolean;
  value: number | null;
  outcome: "win" | "draw" | "loss" | null;
  bestMove: string | null;
  diagnostics: {
    nodeCount: number;
    policyDrawLeaves: number;
    naturalTerminalLeaves: number;
    cycleEdges: number;
    maxDepth: number;
    budgetReason: "node" | "time" | null;
  };
};

function runProbe(state: PolicyState): NormalizedProbe {
  if (oracleMode === "canonical-acyclic") {
    if (!canUseCanonicalAcyclicOracle(state, policy)) {
      return {
        status: "unsafe-history",
        solved: false,
        value: null,
        outcome: null,
        bestMove: null,
        diagnostics: {
          nodeCount: 0,
          policyDrawLeaves: 0,
          naturalTerminalLeaves: 0,
          cycleEdges: 0,
          maxDepth: 0,
          budgetReason: null,
        },
      };
    }

    const result = solveExactEndgame(state.game, {
      maxRootBoardValue: maxBoardValue,
      nodeBudget: oracleNodes,
      timeBudgetMs: oracleMs,
    });
    return {
      status: result.status,
      solved: result.solved,
      value: result.value,
      outcome: result.outcome,
      bestMove: result.bestMove ? moveKey(result.bestMove) : null,
      diagnostics: {
        nodeCount: result.diagnostics.nodeCount,
        policyDrawLeaves: 0,
        naturalTerminalLeaves: 0,
        cycleEdges: result.diagnostics.cycleEdges,
        maxDepth: result.diagnostics.maxDepth,
        budgetReason: result.diagnostics.budgetReason,
      },
    };
  }

  const result = solveExactPolicyState(state, policy, {
    maxRootBoardValue: maxBoardValue,
    nodeBudget: oracleNodes,
    timeBudgetMs: oracleMs,
  });
  return {
    status: result.status,
    solved: result.solved,
    value: result.value,
    outcome: result.outcome,
    bestMove: result.bestMove ? moveKey(result.bestMove) : null,
    diagnostics: {
      nodeCount: result.diagnostics.nodeCount,
      policyDrawLeaves: result.diagnostics.policyDrawLeaves,
      naturalTerminalLeaves: result.diagnostics.naturalTerminalLeaves,
      cycleEdges: result.diagnostics.cycleEdges,
      maxDepth: result.diagnostics.maxDepth,
      budgetReason: result.diagnostics.budgetReason,
    },
  };
}

function replayPolicyPv(
  openingKey: string,
  pv: readonly string[],
  repetitionPolicy: RepetitionPolicy,
): Snapshot[] {
  let state = createPolicyState(createInitialState());
  const openingMove = findMove(state, openingKey);
  const opened = applyPolicyMove(state, openingMove, repetitionPolicy);
  if (!opened.ok) throw new Error(`Failed opening ${openingKey}: ${opened.error}`);
  state = opened.state;

  const snapshots: Snapshot[] = [{
    ply: 1,
    moveApplied: openingKey,
    boardValue: boardValue(state.game),
    state: clonePolicyState(state),
  }];

  for (let index = 0; index < pv.length; index += 1) {
    if (state.game.status === "finished" || state.adjudication !== null) break;
    const key = pv[index]!;
    const move = findMove(state, key);
    const applied = applyPolicyMove(state, move, repetitionPolicy);
    if (!applied.ok) {
      throw new Error(`Recorded V3 PV became illegal at ply ${index + 2}, move ${key}: ${applied.error}`);
    }
    state = applied.state;
    snapshots.push({
      ply: index + 2,
      moveApplied: key,
      boardValue: boardValue(state.game),
      state: clonePolicyState(state),
    });
  }

  return snapshots;
}

function clonePolicyState(state: PolicyState): PolicyState {
  return {
    game: structuredClone(state.game),
    repetitionCounts: new Map(state.repetitionCounts),
    plies: state.plies,
    adjudication: state.adjudication ? structuredClone(state.adjudication) : null,
  };
}

function maxHistoryOccurrence(state: PolicyState): number {
  let max = 0;
  for (const count of state.repetitionCounts.values()) max = Math.max(max, count);
  return max;
}

function findMove(state: PolicyState, key: string): PlayerMove {
  const [pit, dir] = key.split(":") as [PlayerMove["pit"], Direction];
  const move = getLegalMoves(state.game).find((candidate) => candidate.pit === pit && candidate.dir === dir);
  if (!move) throw new Error(`Illegal recorded move ${key} for ${state.game.currentPlayer} at move ${state.game.moveNumber}`);
  return move;
}

function moveKey(move: PlayerMove): string {
  return `${move.pit}:${move.dir}`;
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
