import type { MatchFinishReason } from "../types.js";
import {
  applyBalanceAction,
  balanceActionKey,
  createBalanceInitialState,
  currentAgent,
  getBalanceActions,
  seatForAgent,
  winnerAgent,
  type BalanceAction,
  type BalanceModeId,
  type BalanceState,
  type ResearchAgentId,
} from "../research/balance-modes.js";
import { ModeAwarePuctV3A2 } from "../research/mode-aware-puct-v3a2.js";
import { ModeAwarePuctV3B1Global } from "../research/mode-aware-puct-v3b1-global.js";

type CandidateRole = "opener" | "responder";
type PairStatus = "favorable" | "neutral" | "unfavorable" | "unresolved";

const OPENINGS = [
  "B1:CW", "B1:CCW",
  "B2:CW", "B2:CCW",
  "B3:CW", "B3:CCW",
  "B4:CW", "B4:CCW",
  "B5:CW", "B5:CCW",
] as const;

const mode = readMode();
const fixedSimulations = intArg("--fixed-simulations", 10_000);
const maxBoardMoves = intArg("--max-board-moves", 200);

const pairs = OPENINGS.map((opening) => {
  const candidateOpener = runGame(opening, "opener");
  const candidateResponder = runGame(opening, "responder");
  const values = [candidateOpener.candidateValue, candidateResponder.candidateValue];
  const pairValue = values.every((value) => value !== null)
    ? (values[0] as number) + (values[1] as number)
    : null;
  const status: PairStatus = pairValue === null
    ? "unresolved"
    : pairValue > 0
      ? "favorable"
      : pairValue < 0
        ? "unfavorable"
        : "neutral";
  return { opening, status, pairValue, games: [candidateOpener, candidateResponder] };
});

const games = pairs.flatMap((pair) => pair.games);
const resolved = games.filter((game) => game.candidateValue !== null);
const wins = resolved.filter((game) => game.candidateValue === 1).length;
const draws = resolved.filter((game) => game.candidateValue === 0).length;
const losses = resolved.filter((game) => game.candidateValue === -1).length;

const result = {
  experiment: "v3b1-global-safe-pnsum-v1",
  mode,
  config: {
    fixedSimulationsPerDecision: fixedSimulations,
    maxBoardMoves,
    candidate: "V3B.1-G global-safe PNSum",
    incumbent: "V3A.2 positive-only material36",
  },
  aggregate: {
    candidateWDL: { wins, draws, losses },
    passesUserGate: wins >= losses,
    unresolvedGames: games.length - resolved.length,
    favorablePairs: pairs.filter((pair) => pair.status === "favorable").length,
    neutralPairs: pairs.filter((pair) => pair.status === "neutral").length,
    unfavorablePairs: pairs.filter((pair) => pair.status === "unfavorable").length,
    unresolvedPairs: pairs.filter((pair) => pair.status === "unresolved").length,
  },
  pairs,
};

console.log(JSON.stringify(result, null, 2));
console.log("V3B1_GLOBAL_SUMMARY " + JSON.stringify({
  mode,
  fixedSimulations,
  ...result.aggregate,
  favorableOpenings: pairs.filter((pair) => pair.status === "favorable").map((pair) => pair.opening),
  unfavorableOpenings: pairs.filter((pair) => pair.status === "unfavorable").map((pair) => pair.opening),
  unresolvedOpenings: pairs.filter((pair) => pair.status === "unresolved").map((pair) => pair.opening),
}));

if (wins < losses) process.exitCode = 2;

function runGame(opening: string, candidateRole: CandidateRole) {
  const candidateAgent: ResearchAgentId = candidateRole === "opener" ? "A" : "B";
  const incumbentAgent: ResearchAgentId = candidateAgent === "A" ? "B" : "A";
  let state = createBalanceInitialState(mode, "A");
  let finishReason: MatchFinishReason | null = null;

  const candidate = new ModeAwarePuctV3B1Global();
  const incumbent = new ModeAwarePuctV3A2();

  const forced = getBalanceActions(state).find(
    (action) =>
      action.kind === "move"
      && balanceActionKey(action).toUpperCase() === opening.toUpperCase(),
  );
  if (!forced) throw new Error(`Illegal opening ${opening}`);
  state = applyChecked(state, forced);

  while (state.game.status === "playing" && state.game.moveNumber < maxBoardMoves) {
    const actor = currentAgent(state);
    const engine = actor === candidateAgent ? candidate : incumbent;
    const decision = engine.chooseAction(state, { simulations: fixedSimulations });
    if (!decision.action) break;
    state = applyChecked(state, decision.action);
  }

  const unresolved = state.game.status !== "finished";
  const winner = unresolved ? null : winnerAgent(state);
  const candidateSeat = seatForAgent(state, candidateAgent);
  const incumbentSeat = seatForAgent(state, incumbentAgent);
  const candidateValue = unresolved
    ? null
    : winner === null
      ? 0
      : winner === candidateAgent
        ? 1
        : -1;

  return {
    candidateRole,
    candidateAgent,
    unresolved,
    finishReason,
    winnerAgent: winner,
    candidateValue,
    boardMoves: state.game.moveNumber,
    finalCandidateScore: state.game.scores[candidateSeat],
    finalIncumbentScore: state.game.scores[incumbentSeat],
    finalSeatMapping: state.seatToAgent,
    swapUsed: state.swap.used,
  };

  function applyChecked(target: BalanceState, action: BalanceAction): BalanceState {
    const applied = applyBalanceAction(target, action);
    if (!applied.ok) {
      throw new Error(`Illegal action ${balanceActionKey(action)}: ${applied.error}`);
    }
    for (const event of applied.events) {
      if (event.type === "match_finished") finishReason = event.reason;
    }
    return applied.state;
  }
}

function readMode(): BalanceModeId {
  const value = stringArg("--mode") ?? "quan-gia-threefold";
  if (value === "standard" || value === "pie-threefold" || value === "quan-gia-threefold") {
    return value;
  }
  throw new Error("--mode must be standard|pie-threefold|quan-gia-threefold");
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
