import { writeFileSync } from "node:fs";
import { applyMove, createInitialState, getLegalMoves } from "../engine.js";
import { MaterialGatedReusableScoreBoundedPuct } from "../research/puct-v3a1.js";
import { SelectiveQuiescencePuctV4 } from "../research/puct-v4.js";
import { parseClassicOpening } from "../research/opening-pie-analysis.js";
import { LIVE_QUAN_BALANCED_POSITIONS, replayLiveQuanPosition } from "../research/v3-live-quan-corpus.js";
import { BALANCED_MIDGAME_POSITIONS, replayBalancedPosition, type BalancedMidgamePosition } from "../research/v3-balanced-midgame-corpus.js";
import type { GameState } from "../types.js";

type StageId = "stage1" | "stage2" | "stage3";
type Position = { id: string; start: () => GameState };
const STAGE3_IDS = new Set(["B3:CW:material@12","B3:CW:material@14","B3:CW:material@19","B3:CCW:strategic@16","B3:CCW:strategic@19"]);

const stage = readStage("--stage");
const simulations = intArg("--fixed-simulations", 10_000);
const outPath = stringArg("--out");
const rows = buildPositions(stage).map((position) => {
  const state = position.start();
  const incumbent = new MaterialGatedReusableScoreBoundedPuct().chooseMove(state, {
    simulations, puctExploration: 1.5, policyTemperature: 0.6, leafScoreWeight: 1.8,
  });
  const candidate = new SelectiveQuiescencePuctV4().chooseMove(state, {
    simulations, puctExploration: 1.5, policyTemperature: 0.6, leafScoreWeight: 1.8,
  });
  const incumbentMove = incumbent.move ? `${incumbent.move.pit}:${incumbent.move.dir}` : null;
  const candidateMove = candidate.move ? `${candidate.move.pit}:${candidate.move.dir}` : null;
  const top = (decision: typeof incumbent) => decision.rootStats.slice(0, 4).map((entry) => ({
    move: `${entry.move.pit}:${entry.move.dir}`, visits: entry.visits,
    meanValue: entry.meanValue, prior: entry.prior,
  }));
  return {
    position: position.id, boardMove: state.moveNumber, currentPlayer: state.currentPlayer,
    incumbentMove, candidateMove, disagrees: incumbentMove !== candidateMove,
    incumbentRoot: top(incumbent), candidateRoot: top(candidate),
  };
});

const result = {
  experiment: "v4-v3a1-root-disagreement-discovery-v1",
  methodology: {
    stage, fixedSimulationsPerDecision: simulations,
    incumbent: "PUCT V3A.1 material36", candidate: "PUCT V4 q10 selective quiescence",
    freshRootPerEngine: true,
    use: "discovery only; branch quality must be independently validated",
  },
  positions: rows.length, disagreements: rows.filter((row) => row.disagrees).length, rows,
};
const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function buildPositions(target: StageId): Position[] {
  if (target === "stage1") return buildStage1Positions();
  if (target === "stage2") return LIVE_QUAN_BALANCED_POSITIONS.map((p) => ({ id: p.id, start: () => replayLiveQuanPosition(p) }));
  const selected = BALANCED_MIDGAME_POSITIONS.filter((p) => STAGE3_IDS.has(p.id));
  if (selected.length !== STAGE3_IDS.size) throw new Error(`Expected ${STAGE3_IDS.size} Stage 3 positions, got ${selected.length}`);
  return selected.map(stage3Position);
}

function buildStage1Positions(): Position[] {
  const positions: Position[] = [];
  for (const opening of [parseClassicOpening("B3:CW"), parseClassicOpening("B3:CCW")]) {
    const opened = applyMove(createInitialState(), opening);
    if (!opened.ok) throw new Error(`Failed opening ${opening.pit}:${opening.dir}`);
    for (const reply of getLegalMoves(opened.state)) {
      const id = `${opening.pit}:${opening.dir}>${reply.pit}:${reply.dir}`;
      positions.push({ id, start: () => {
        const first = applyMove(createInitialState(), opening);
        if (!first.ok) throw new Error(`Failed opening ${id}`);
        const second = applyMove(first.state, reply);
        if (!second.ok) throw new Error(`Failed reply ${id}`);
        return second.state;
      }});
    }
  }
  if (positions.length !== 16) throw new Error(`Expected 16 Stage 1 positions, got ${positions.length}`);
  return positions;
}

function stage3Position(position: BalancedMidgamePosition): Position {
  return { id: position.id, start: () => replayBalancedPosition(position) };
}
function stringArg(name: string): string | null {
  const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] ?? null : null;
}
function intArg(name: string, fallback: number): number {
  const raw = stringArg(name); if (raw === null) return fallback;
  const value = Number(raw); if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}
function readStage(name: string): StageId {
  const value = stringArg(name) ?? "stage2";
  if (value === "stage1" || value === "stage2" || value === "stage3") return value;
  throw new Error(`${name} must be stage1|stage2|stage3`);
}
