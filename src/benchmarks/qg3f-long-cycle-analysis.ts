import { writeFileSync } from "node:fs";
import {
  applyBalanceAction,
  balanceActionKey,
  createBalanceInitialState,
  currentAgent,
  getBalanceActions,
  type BalanceAction,
  type BalanceState,
  type ResearchAgentId,
} from "../research/balance-modes.js";
import { ModeAwarePuctV3A } from "../research/mode-aware-puct-v3a.js";

const opening = stringArg("--opening") ?? "B3:CW";
const forceBoardMove = intArg("--force-board-move", 4);
const forceActionKey = stringArg("--force-action") ?? "B3:CCW";
const openerAgent = readAgent("--opener-agent", "A");
const simulations = intArg("--fixed-simulations", 20_000);
const maxBoardMoves = intArg("--max-board-moves", 600);
const outPath = stringArg("--out");

let state = createBalanceInitialState("quan-gia-threefold", openerAgent);
const openingAction = getBalanceActions(state).find(
  (action) => action.kind === "move" && balanceActionKey(action).toUpperCase() === opening.toUpperCase(),
);
if (!openingAction) throw new Error(`Illegal opening ${opening}`);
const opened = applyBalanceAction(state, openingAction);
if (!opened.ok) throw new Error(opened.error);
state = opened.state;

const engines = { A: new ModeAwarePuctV3A(), B: new ModeAwarePuctV3A() };
const exactSeen = new Map<string, number>();
const boardSeen = new Map<string, number>();
const exactRepeats: Array<{ firstMove: number; repeatMove: number; period: number }> = [];
const boardRepeats: Array<{ firstMove: number; repeatMove: number; period: number; scoreP0: number; scoreP1: number }> = [];
const actions: Array<{ move: number; agent: ResearchAgentId; action: string }> = [];
let forced = false;

recordState(state);

while (state.game.status === "playing" && state.game.moveNumber < maxBoardMoves) {
  const agent = currentAgent(state);
  const decision = engines[agent].chooseAction(state, {
    simulations,
    puctExploration: 1.5,
    policyTemperature: 0.6,
  });
  if (!decision.action) break;

  let action: BalanceAction = decision.action;
  if (!forced && state.game.moveNumber === forceBoardMove && agent === openerAgent) {
    const candidate = getBalanceActions(state).find(
      (entry) => entry.kind === "move" && balanceActionKey(entry).toUpperCase() === forceActionKey.toUpperCase(),
    );
    if (!candidate) throw new Error(`Forced action ${forceActionKey} unavailable at move ${forceBoardMove}`);
    action = candidate;
    forced = true;
  }

  actions.push({ move: state.game.moveNumber, agent, action: balanceActionKey(action) });
  const applied = applyBalanceAction(state, action);
  if (!applied.ok) throw new Error(applied.error);
  state = applied.state;
  recordState(state);
}

const result = {
  experiment: "qg3f-long-cycle-analysis-v1",
  opening,
  openerAgent,
  force: { boardMove: forceBoardMove, action: forceActionKey, reached: forced },
  config: { fixedSimulations: simulations, maxBoardMoves },
  outcome: {
    unresolved: state.game.status !== "finished",
    boardMoves: state.game.moveNumber,
    scores: state.game.scores,
    status: state.game.status,
    winner: state.game.winner,
  },
  cycleEvidence: {
    exactStrategicRepeats: exactRepeats.length,
    boardPositionRepeats: boardRepeats.length,
    firstExactRepeat: exactRepeats[0] ?? null,
    shortestExactPeriod: exactRepeats.length ? Math.min(...exactRepeats.map((r) => r.period)) : null,
    firstBoardRepeat: boardRepeats[0] ?? null,
    shortestBoardPeriod: boardRepeats.length ? Math.min(...boardRepeats.map((r) => r.period)) : null,
    lastExactRepeats: exactRepeats.slice(-20),
    lastBoardRepeats: boardRepeats.slice(-20),
  },
  actionWindows: {
    first40: actions.slice(0, 40),
    aroundFirstExactRepeat: exactRepeats[0]
      ? actions.filter((a) => a.move >= exactRepeats[0]!.firstMove - 4 && a.move <= exactRepeats[0]!.repeatMove + 4)
      : [],
    last40: actions.slice(-40),
  },
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function recordState(target: BalanceState): void {
  const eKey = exactKey(target);
  const bKey = boardKey(target);
  const move = target.game.moveNumber;

  const eFirst = exactSeen.get(eKey);
  if (eFirst !== undefined) exactRepeats.push({ firstMove: eFirst, repeatMove: move, period: move - eFirst });
  else exactSeen.set(eKey, move);

  const bFirst = boardSeen.get(bKey);
  if (bFirst !== undefined) {
    boardRepeats.push({
      firstMove: bFirst,
      repeatMove: move,
      period: move - bFirst,
      scoreP0: target.game.scores.P0,
      scoreP1: target.game.scores.P1,
    });
  } else boardSeen.set(bKey, move);
}

function exactKey(target: BalanceState): string {
  const game = target.game;
  return [
    game.currentPlayer,
    game.scores.P0,
    game.scores.P1,
    game.pits.map((p) => `${p.id}:${p.stones}:${p.quanStones}`).join(","),
    game.recentMoves.map((m) => `${m.player}:${m.pit}:${m.dir}`).join(","),
  ].join("|");
}

function boardKey(target: BalanceState): string {
  const game = target.game;
  return [
    game.currentPlayer,
    game.scores.P0,
    game.scores.P1,
    game.pits.map((p) => `${p.id}:${p.stones}:${p.quanStones}`).join(","),
  ].join("|");
}

function readAgent(name: string, fallback: ResearchAgentId): ResearchAgentId {
  const value = stringArg(name) ?? fallback;
  if (value === "A" || value === "B") return value;
  throw new Error(`${name} must be A or B`);
}
function stringArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}
function intArg(name: string, fallback: number): number {
  const raw = stringArg(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}
