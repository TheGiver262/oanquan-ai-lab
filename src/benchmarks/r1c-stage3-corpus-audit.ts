import { writeFileSync } from "node:fs";
import { applyMove, getLegalMoves } from "../engine.js";
import {
  BALANCED_MIDGAME_POSITIONS,
  replayBalancedPosition,
} from "../research/v3-balanced-midgame-corpus.js";
import type { GameState, PlayerId } from "../types.js";

const maxProbeDepth = intArg("--probe-depth", 10);
const nodeBudget = intArg("--node-budget", 20_000);
const outPath = stringArg("--out");

const positions = BALANCED_MIDGAME_POSITIONS.map((position) => {
  const state = replayBalancedPosition(position);
  const p0Side = sideDan(state, "P0");
  const p1Side = sideDan(state, "P1");
  const totalDan = p0Side + p1Side;
  const probe = cycleProbe(state, maxProbeDepth, nodeBudget);
  return {
    id: position.id,
    source: position.source,
    depth: position.depth,
    currentPlayer: state.currentPlayer,
    scores: { ...state.scores },
    scoreDiff: position.scoreDiff,
    totalDan,
    p0SideDan: p0Side,
    p1SideDan: p1Side,
    danMaterialDiff: position.danMaterialDiff,
    quanAlive: position.quanAlive,
    legalMoves: position.legalMoves,
    nonEmptyPitDiff: position.nonEmptyPitDiff,
    refillExposure: {
      P0: refillExposure(state, "P0"),
      P1: refillExposure(state, "P1"),
    },
    cycleProbe: probe,
  };
});

const result = {
  experiment: "R1c-stage3-structural-corpus-audit",
  ruleset: "oaq:classic_2p:standard:v1",
  methodology: {
    corpus: "ported deterministic balanced mid/endgame PV-derived corpus",
    selectionUsesStrengthOutcome: false,
    cycleProbe:
      "Depth-limited DFS. A cycle-closing edge is an edge whose exact strategic state key already exists on the current DFS path. Repetition is measured only; it is not adjudicated as draw or solved outcome.",
    nodeBudgetPerPosition: nodeBudget,
    maxProbeDepth,
  },
  positionCount: positions.length,
  aggregate: {
    totalDanMin: Math.min(...positions.map((position) => position.totalDan)),
    totalDanMax: Math.max(...positions.map((position) => position.totalDan)),
    totalDanMean: mean(positions.map((position) => position.totalDan)),
    noQuanPositions: positions.filter((position) => position.quanAlive === 0).length,
    oneQuanPositions: positions.filter((position) => position.quanAlive === 1).length,
    twoQuanPositions: positions.filter((position) => position.quanAlive === 2).length,
    positionsWithCycleClosingEdge: positions.filter(
      (position) => position.cycleProbe.cycleClosingEdges > 0,
    ).length,
    totalCycleClosingEdges: positions.reduce(
      (sum, position) => sum + position.cycleProbe.cycleClosingEdges,
      0,
    ),
    budgetExhaustedPositions: positions.filter(
      (position) => position.cycleProbe.budgetExhausted,
    ).length,
  },
  positions,
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function cycleProbe(root: GameState, maxDepth: number, maxNodes: number) {
  let visitedNodes = 0;
  let exploredEdges = 0;
  let cycleClosingEdges = 0;
  let maxReachedDepth = 0;
  let budgetExhausted = false;

  const dfs = (state: GameState, depth: number, path: Set<string>): void => {
    if (budgetExhausted || depth >= maxDepth || state.status !== "playing") return;
    visitedNodes += 1;
    if (visitedNodes >= maxNodes) {
      budgetExhausted = true;
      return;
    }
    maxReachedDepth = Math.max(maxReachedDepth, depth);

    for (const move of getLegalMoves(state)) {
      if (budgetExhausted) break;
      const applied = applyMove(state, move);
      if (!applied.ok) throw new Error(`Audit encountered illegal move: ${applied.error}`);
      exploredEdges += 1;
      const key = strategicStateKey(applied.state);
      if (path.has(key)) {
        cycleClosingEdges += 1;
        continue;
      }
      const nextPath = new Set(path);
      nextPath.add(key);
      dfs(applied.state, depth + 1, nextPath);
    }
  };

  const rootKey = strategicStateKey(root);
  dfs(root, 0, new Set([rootKey]));
  return {
    visitedNodes,
    exploredEdges,
    cycleClosingEdges,
    maxReachedDepth,
    budgetExhausted,
  };
}

function strategicStateKey(state: GameState): string {
  return [
    state.ruleset.canonicalRulesetId,
    state.currentPlayer,
    state.scores.P0,
    state.scores.P1,
    state.status,
    state.winner ?? "-",
    state.moveNumber === 0 ? 1 : 0,
    state.pits.map((pit) => `${pit.id}:${pit.stones}:${pit.quanStones}`).join(","),
  ].join("|");
}

function sideDan(state: GameState, player: PlayerId): number {
  return state.pits
    .filter((pit) => pit.kind === "dan" && pit.owner === player)
    .reduce((sum, pit) => sum + pit.stones, 0);
}

function refillExposure(state: GameState, player: PlayerId) {
  const side = sideDan(state, player);
  return {
    sideDan: side,
    emptySideNow: side === 0,
    canAffordRefillNow: state.scores[player] >= 5,
    nearEmpty: side <= 5,
  };
}

function mean(values: number[]): number | null {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function stringArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function intArg(name: string, fallback: number): number {
  const raw = stringArg(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
