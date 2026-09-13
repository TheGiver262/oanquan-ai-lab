import { writeFileSync } from "node:fs";
import { applyMove, getLegalMoves } from "../engine.js";
import { chooseFrozenPuctV2 } from "../research/puct-v2.js";
import { boardValue, solveExactEndgame } from "../research/exact-endgame-v4.js";
import { ReusableScoreBoundedPuct } from "../research/puct-v3a.js";
import { LIVE_QUAN_BALANCED_POSITIONS, replayLiveQuanPosition } from "../research/v3-live-quan-corpus.js";
import type { GameState, PlayerMove } from "../types.js";

const TARGET_ID = "LQ@9:B2:CCW:B2:CCW>T1:CW>B4:CCW>T3:CW>B5:CW>T4:CCW>B4:CCW>T5:CCW>B5:CW";
const simulations = intArg("--simulations", 4_000);
const solverNodeBudget = intArg("--solver-node-budget", 500_000);
const solverTimeMs = intArg("--solver-time-ms", 5_000);
const outPath = stringArg("--out");
const position = LIVE_QUAN_BALANCED_POSITIONS.find((entry) => entry.id === TARGET_ID);
if (!position) throw new Error("Missing target position");

const recurrentRoot = findFirstRepeatedP0Root();
const rootSolve = solveExactEndgame(recurrentRoot, {
  maxRootBoardValue: 18,
  nodeBudget: solverNodeBudget,
  timeBudgetMs: solverTimeMs,
});

const exits = getLegalMoves(recurrentRoot).map((move) => {
  const applied = applyMove(recurrentRoot, move);
  if (!applied.ok) throw new Error(`Illegal root move ${moveKey(move)}: ${applied.error}`);
  const child = applied.state;
  const solved = solveExactEndgame(child, {
    maxRootBoardValue: 18,
    nodeBudget: solverNodeBudget,
    timeBudgetMs: solverTimeMs,
  });
  return {
    move: moveKey(move),
    childBoardValue: boardValue(child),
    childPlayerToMove: child.currentPlayer,
    solver: solved,
    interpretationFromP0: solved.solved
      ? solved.outcome === "win" ? "P0-loss" : solved.outcome === "loss" ? "P0-win" : "draw"
      : solved.status,
  };
});

const result = {
  experiment: "R1c-cycle-exit-exact-diagnosis",
  evidenceClass: "exact-solver-diagnostic",
  ruleset: recurrentRoot.ruleset.canonicalRulesetId,
  target: TARGET_ID,
  recurrentRoot: {
    moveNumber: recurrentRoot.moveNumber,
    currentPlayer: recurrentRoot.currentPlayer,
    scores: recurrentRoot.scores,
    boardValue: boardValue(recurrentRoot),
    legalMoves: getLegalMoves(recurrentRoot).map(moveKey),
    pits: recurrentRoot.pits.map((pit) => ({ id: pit.id, stones: pit.stones, quanStones: pit.quanStones })),
  },
  rootSolve,
  exits,
};
const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function findFirstRepeatedP0Root(): GameState {
  let state = replayLiveQuanPosition(position!);
  const v3a = new ReusableScoreBoundedPuct();
  const seenP0 = new Set<string>();
  for (let continuation = 0; continuation < 160 && state.status === "playing"; continuation += 1) {
    if (state.currentPlayer === "P0") {
      const key = strategicStateKey(state);
      if (seenP0.has(key)) return structuredClone(state);
      seenP0.add(key);
      const move = v3a.chooseMove(state, { simulations, puctExploration: 1.5, policyTemperature: 0.6 }).move;
      if (!move) throw new Error("V3A returned no move before recurrence");
      const applied = applyMove(state, move);
      if (!applied.ok) throw new Error(applied.error);
      state = applied.state;
    } else {
      const move = chooseFrozenPuctV2(state, { simulations, puctExploration: 1.5, policyTemperature: 0.6 }).move;
      if (!move) throw new Error("V2 returned no move before recurrence");
      const applied = applyMove(state, move);
      if (!applied.ok) throw new Error(applied.error);
      state = applied.state;
    }
  }
  throw new Error("No repeated P0 root found within 160 continuation moves");
}

function strategicStateKey(state: GameState): string {
  const pits = state.pits.map((pit) => `${pit.id}:${pit.stones}:${pit.quanStones}`).join(",");
  return [state.ruleset.canonicalRulesetId, state.currentPlayer, state.scores.P0, state.scores.P1, state.status, state.winner ?? "-", state.moveNumber === 0 ? 1 : 0, pits].join("|");
}
function moveKey(move: Pick<PlayerMove, "pit" | "dir">): string { return `${move.pit}:${move.dir}`; }
function stringArg(name: string): string | null { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] ?? null : null; }
function intArg(name: string, fallback: number): number {
  const raw = stringArg(name); if (raw === null) return fallback;
  const value = Number(raw); if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`); return value;
}
