import { writeFileSync } from "node:fs";
import { applyMove } from "../engine.js";
import { chooseFrozenPuctV2 } from "../research/puct-v2.js";
import { ReusableScoreBoundedPuct } from "../research/puct-v3a.js";
import {
  LIVE_QUAN_BALANCED_POSITIONS,
  replayLiveQuanPosition,
  type LiveQuanPosition,
} from "../research/v3-live-quan-corpus.js";
import type { GameState, PlayerMove } from "../types.js";

const TARGET_IDS = new Set([
  "LQ@5:B2:CW:B2:CW>T5:CCW>B5:CW>T3:CCW>B1:CW",
  "LQ@9:B2:CCW:B2:CCW>T1:CW>B4:CCW>T3:CW>B5:CW>T4:CCW>B4:CCW>T5:CCW>B5:CW",
]);

type Mode = "normal" | "reset-on-repeat" | "reset-every-turn";
const MODES: readonly Mode[] = ["normal", "reset-on-repeat", "reset-every-turn"];
const simulations = intArg("--simulations", 4_000);
const maxContinuationMoves = intArg("--max-continuation-moves", 512);
const repeatStop = intArg("--repeat-stop", 6);
const outPath = stringArg("--out");
const positions = LIVE_QUAN_BALANCED_POSITIONS.filter((position) => TARGET_IDS.has(position.id));
if (positions.length !== TARGET_IDS.size) throw new Error(`Expected ${TARGET_IDS.size} positions, got ${positions.length}`);

const runs = positions.flatMap((position) => MODES.map((mode) => play(position, mode)));
const result = {
  experiment: "R1c-V3A-real-root-reuse-ablation",
  evidenceClass: "causal-diagnostic",
  ruleset: "oaq:classic_2p:standard:v1",
  methodology: {
    fixedMatchup: "V3A controls P0; frozen V2 controls P1",
    normal: "Unmodified V3A session with two-ply subtree reuse.",
    resetOnRepeat: "Reset V3A only when the actual P0 root strategic state was previously observed in the same game.",
    resetEveryTurn: "Reset V3A before every P0 decision; retains V3A search/solver semantics but removes cross-turn subtree reuse.",
    repetition: "Observed only; never scored as draw or terminal.",
    purpose: "Separate cross-turn reuse inertia from search-objective preference for recurrence.",
  },
  config: { simulations, maxContinuationMoves, repeatStop, puctExploration: 1.5, policyTemperature: 0.6 },
  runs,
};
const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function play(position: LiveQuanPosition, mode: Mode) {
  let state = replayLiveQuanPosition(position);
  const startMove = state.moveNumber;
  let v3a = new ReusableScoreBoundedPuct();
  const allSeen = new Map<string, number>();
  const p0RootSeen = new Set<string>();
  let repeatObservations = 0;
  let p0RootRepeats = 0;
  let resets = 0;
  let stoppedForRecurrence = false;
  const p0Moves: Array<{ moveNumber: number; chosenMove: string | null; repeatedRoot: boolean; reset: boolean; reusedRoot: boolean; reusedRootVisits: number; cycleCutoffs: number }> = [];
  let firstRepeat: null | { firstMoveNumber: number; repeatMoveNumber: number; period: number; player: string } = null;

  while (state.status === "playing" && state.moveNumber - startMove < maxContinuationMoves) {
    const key = strategicStateKey(state);
    const previous = allSeen.get(key);
    if (previous !== undefined) {
      repeatObservations += 1;
      if (!firstRepeat) firstRepeat = { firstMoveNumber: previous, repeatMoveNumber: state.moveNumber, period: state.moveNumber - previous, player: state.currentPlayer };
    } else {
      allSeen.set(key, state.moveNumber);
    }

    let move: PlayerMove | null;
    if (state.currentPlayer === "P0") {
      const repeatedRoot = p0RootSeen.has(key);
      if (repeatedRoot) p0RootRepeats += 1;
      let didReset = false;
      if (mode === "reset-every-turn" || (mode === "reset-on-repeat" && repeatedRoot)) {
        v3a.reset();
        resets += 1;
        didReset = true;
      }
      p0RootSeen.add(key);
      const decision = v3a.chooseMove(state, { simulations, puctExploration: 1.5, policyTemperature: 0.6 });
      move = decision.move;
      p0Moves.push({
        moveNumber: state.moveNumber,
        chosenMove: move ? moveKey(move) : null,
        repeatedRoot,
        reset: didReset,
        reusedRoot: decision.diagnostics.reusedRoot,
        reusedRootVisits: decision.diagnostics.reusedRootVisits,
        cycleCutoffs: decision.diagnostics.cycleCutoffs,
      });
    } else {
      move = chooseFrozenPuctV2(state, { simulations, puctExploration: 1.5, policyTemperature: 0.6 }).move;
    }

    if (!move) break;
    const applied = applyMove(state, move);
    if (!applied.ok) throw new Error(`Illegal move ${moveKey(move)}: ${applied.error}`);
    state = applied.state;
    if (repeatObservations >= repeatStop) {
      stoppedForRecurrence = true;
      break;
    }
  }

  return {
    position: position.id,
    mode,
    startMoveNumber: startMove,
    finalMoveNumber: state.moveNumber,
    continuationMoves: state.moveNumber - startMove,
    status: state.status,
    winner: state.winner,
    repeatObservations,
    p0RootRepeats,
    resets,
    stoppedForRecurrence,
    firstRepeat,
    lastP0Moves: p0Moves.slice(-12),
  };
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
