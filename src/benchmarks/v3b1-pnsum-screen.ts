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
import { ModeAwarePuctV3B1 } from "../research/mode-aware-puct-v3b1.js";

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
const cpn = floatArg("--cpn", 1.0, true);
const fixedSimulations = intArg("--fixed-simulations", 5_000);
const maxBoardMoves = intArg("--max-board-moves", 200);
const puctExploration = floatArg("--puct-exploration", 1.5);
const policyTemperature = floatArg("--policy-temperature", 0.6);
const requestedOpening = stringArg("--opening");
const selectedOpenings = requestedOpening === null
  ? [...OPENINGS]
  : OPENINGS.filter((opening) => opening.toUpperCase() === requestedOpening.toUpperCase());
if (selectedOpenings.length === 0) throw new Error(`Unknown --opening ${requestedOpening}`);

const pairs = selectedOpenings.map((opening) => {
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

const allGames = pairs.flatMap((pair) => pair.games);
const resolved = allGames.filter((game) => game.candidateValue !== null);
const wins = resolved.filter((game) => game.candidateValue === 1).length;
const draws = resolved.filter((game) => game.candidateValue === 0).length;
const losses = resolved.filter((game) => game.candidateValue === -1).length;

const result = {
  experiment: "v3b1-proof-number-pnsum-v1",
  mode,
  cpn,
  config: {
    fixedSimulationsPerDecision: fixedSimulations,
    puctExploration,
    policyTemperature,
    maxBoardMoves,
    openings: selectedOpenings,
    pairing: "candidate once as forced opener and once as responder for each opening",
    incumbent: "V3A.2 positive-only material36",
    proofGuidance: "per-agent proof numbers + PNSum selection bias",
  },
  aggregate: {
    candidateWDL: { wins, draws, losses },
    unresolvedGames: allGames.length - resolved.length,
    favorablePairs: pairs.filter((pair) => pair.status === "favorable").length,
    neutralPairs: pairs.filter((pair) => pair.status === "neutral").length,
    unfavorablePairs: pairs.filter((pair) => pair.status === "unfavorable").length,
    unresolvedPairs: pairs.filter((pair) => pair.status === "unresolved").length,
  },
  pairs,
};

console.log(JSON.stringify(result, null, 2));
console.log("V3B_SCREEN_SUMMARY " + JSON.stringify({
  mode,
  cpn,
  ...result.aggregate,
  unfavorableOpenings: pairs.filter((pair) => pair.status === "unfavorable").map((pair) => pair.opening),
  unresolvedOpenings: pairs.filter((pair) => pair.status === "unresolved").map((pair) => pair.opening),
}));

function runGame(opening: string, candidateRole: CandidateRole) {
  const openerAgent: ResearchAgentId = "A";
  const candidateAgent: ResearchAgentId = candidateRole === "opener" ? "A" : "B";
  const incumbentAgent: ResearchAgentId = candidateAgent === "A" ? "B" : "A";
  let state = createBalanceInitialState(mode, openerAgent);
  let finishReason: MatchFinishReason | null = null;
  let protocolDecisions = 0;

  const candidate = new ModeAwarePuctV3B1(cpn);
  const incumbent = new ModeAwarePuctV3A2();

  const forced = getBalanceActions(state).find(
    (action) =>
      action.kind === "move"
      && balanceActionKey(action).toUpperCase() === opening.toUpperCase(),
  );
  if (!forced) throw new Error(`Illegal opening ${opening}`);
  state = applyChecked(state, forced);

  while (state.game.status === "playing" && state.game.moveNumber < maxBoardMoves) {
    const agent = currentAgent(state);
    const decision = agent === candidateAgent
      ? candidate.chooseAction(state, {
          simulations: fixedSimulations,
          puctExploration,
          policyTemperature,
        })
      : incumbent.chooseAction(state, {
          simulations: fixedSimulations,
          puctExploration,
          policyTemperature,
        });
    protocolDecisions += 1;
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
    protocolDecisions,
    finalCandidateScore: state.game.scores[candidateSeat],
    finalIncumbentScore: state.game.scores[incumbentSeat],
    finalSeatMapping: state.seatToAgent,
    swapUsed: state.swap.used,
  };

  function applyChecked(target: BalanceState, action: BalanceAction): BalanceState {
    const applied = applyBalanceAction(target, action);
    if (!applied.ok) throw new Error(`Illegal action ${balanceActionKey(action)}: ${applied.error}`);
    for (const event of applied.events) {
      if (event.type === "match_finished") finishReason = event.reason;
    }
    return applied.state;
  }
}

function readMode(): BalanceModeId {
  const value = stringArg("--mode") ?? "quan-gia-threefold";
  if (value === "standard" || value === "pie-threefold" || value === "quan-gia-threefold") return value;
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
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function floatArg(name: string, fallback: number, allowZero = false): number {
  const raw = stringArg(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  const valid = Number.isFinite(value) && (allowZero ? value >= 0 : value > 0);
  if (!valid) throw new Error(`${name} must be ${allowZero ? "a non-negative" : "a positive"} number`);
  return value;
}
