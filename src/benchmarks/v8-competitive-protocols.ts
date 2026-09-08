import { createInitialState, getLegalMoves } from "../engine.js";
import { choosePolicyMctsMoveV7 } from "../research/policy-mcts-v7.js";
import {
  KEEP_MAPPING_V8,
  mappingForResponderSeat,
  rationalResponderSeatFromP1Value,
  winnerAgentFromSeat,
  type CompetitiveAgentId,
  type ImmediateSeatChoiceV8,
  type SeatMappingV8,
} from "../research/competitive-protocol-v8.js";
import { getClassicOpenings, parseClassicOpening } from "../research/opening-pie-analysis.js";
import {
  applyPolicyMove,
  createPolicyState,
  type PolicyState,
} from "../research/repetition-policy-v5.js";
import type { PlayerId, PlayerMove } from "../types.js";

type ProtocolId = "single-b2ccw" | "balanced-pool" | "pie" | "swap2-adapted";
type FinishKind = "natural" | "repetition-draw" | "unresolved";

type PreparedProtocol = {
  state: PolicyState;
  seatToAgent: SeatMappingV8;
  setupMoves: string[];
  responderSeat: ImmediateSeatChoiceV8 | null;
  metaP1Value: number | null;
  metaProbes: number;
  metaElapsedMs: number;
  notes: string[];
};

type GameDetail = {
  game: number;
  seed: number;
  protocol: ProtocolId;
  finishKind: FinishKind;
  winnerSeat: PlayerId | null;
  winnerAgent: CompetitiveAgentId | null;
  moves: number;
  seatScores: { P0: number; P1: number };
  agentScores: { A: number; B: number };
  seatToAgent: SeatMappingV8;
  setupMoves: string[];
  responderSeat: ImmediateSeatChoiceV8 | null;
  metaP1Value: number | null;
  metaProbes: number;
  metaElapsedMs: number;
  p0RolloutPolicyDraws: number;
  p1RolloutPolicyDraws: number;
  notes: string[];
};

type SetupCandidate = {
  state: PolicyState;
  moves: PlayerMove[];
  staticAbsP1Value: number;
};

const THREEFOLD = { kind: "repeat-draw", occurrences: 3 } as const;
const protocol = requiredProtocolArg("--protocol");
const games = intArg("--games", 16);
const timeBudgetMs = intArg("--ms", 350);
const simulations = intArg("--simulations", 100_000);
const rolloutDepth = intArg("--rollout-depth", 20);
const metaBudgetMs = intArg("--meta-ms", 45);
const metaSimulations = intArg("--meta-simulations", 20_000);
const swap2CandidateCap = intArg("--swap2-candidates", 12);
const maxMoves = intArg("--max-moves", 240);
const seedBase = intArg("--seed", 20260908);

const details: GameDetail[] = [];
const aggregate = {
  agentAWins: 0,
  agentBWins: 0,
  naturalDraws: 0,
  repetitionDraws: 0,
  unresolved: 0,
  p0Wins: 0,
  p1Wins: 0,
  totalMoves: 0,
  swaps: 0,
  totalMetaProbes: 0,
  totalMetaElapsedMs: 0,
  p0DecisionMs: 0,
  p1DecisionMs: 0,
  p0Decisions: 0,
  p1Decisions: 0,
  p0RolloutPolicyDraws: 0,
  p1RolloutPolicyDraws: 0,
  setupFrequencies: new Map<string, number>(),
};

for (let index = 0; index < games; index += 1) {
  const seed = seedBase + index * 7_919 + hashString(protocol);
  const detail = playGame(index, seed);
  details.push(detail);
  aggregate.totalMoves += detail.moves;
  aggregate.totalMetaProbes += detail.metaProbes;
  aggregate.totalMetaElapsedMs += detail.metaElapsedMs;
  aggregate.p0RolloutPolicyDraws += detail.p0RolloutPolicyDraws;
  aggregate.p1RolloutPolicyDraws += detail.p1RolloutPolicyDraws;
  if (detail.responderSeat === "P0") aggregate.swaps += 1;
  const setupKey = detail.setupMoves.join(" ");
  aggregate.setupFrequencies.set(setupKey, (aggregate.setupFrequencies.get(setupKey) ?? 0) + 1);

  if (detail.finishKind === "unresolved") aggregate.unresolved += 1;
  else if (detail.finishKind === "repetition-draw") aggregate.repetitionDraws += 1;
  else if (detail.winnerAgent === null) aggregate.naturalDraws += 1;
  else if (detail.winnerAgent === "A") aggregate.agentAWins += 1;
  else aggregate.agentBWins += 1;

  if (detail.finishKind === "natural") {
    if (detail.winnerSeat === "P0") aggregate.p0Wins += 1;
    else if (detail.winnerSeat === "P1") aggregate.p1Wins += 1;
  }
}

const completed = games - aggregate.unresolved;
const draws = aggregate.naturalDraws + aggregate.repetitionDraws;
console.log(JSON.stringify({
  methodology: {
    phase: "V8 competitive protocol comparison",
    engine: "policy-aware UCT-PB controls both agents after protocol setup, with independent seeded RNG streams",
    policy: "threefold repeated strategic position is an exact draw during setup, search and actual match adjudication",
    fairnessUnit: "agent A versus agent B, not raw P0/P1 seat, so swaps are normalized correctly",
    protocols: {
      "single-b2ccw": "A is P0; B2:CCW is forced, then normal play",
      "balanced-pool": "A is P0; games alternate exactly 50/50 between B4:CW and B5:CW",
      pie: "A chooses one legal first move by empirical maximin (minimize absolute estimated seat value); B then chooses the stronger seat",
      "swap2-adapted": "research-only sequential adaptation: A authors a legal P0/P1/P0 three-ply setup, then B chooses the stronger seat; the original Swap2 defer branch is analytically weakly dominated in exact zero-sum seat value and is reported rather than pretended to add value",
    },
    claimLimit: "bounded strong-AI self-play. Pie and Swap2 meta-decisions use short MCTS probes; Swap2 setup selection exhaustively enumerates legal 3-ply states but only MCTS re-ranks a static-balance shortlist",
  },
  config: {
    protocol,
    games,
    timeBudgetMs,
    simulations,
    rolloutDepth,
    metaBudgetMs,
    metaSimulations,
    swap2CandidateCap,
    maxMoves,
    seedBase,
  },
  aggregate: {
    agentAWins: aggregate.agentAWins,
    agentBWins: aggregate.agentBWins,
    naturalDraws: aggregate.naturalDraws,
    repetitionDraws: aggregate.repetitionDraws,
    unresolved: aggregate.unresolved,
    agentAScoreRate: completed === 0 ? 0 : (aggregate.agentAWins + draws * 0.5) / completed,
    agentBScoreRate: completed === 0 ? 0 : (aggregate.agentBWins + draws * 0.5) / completed,
    seatP0Wins: aggregate.p0Wins,
    seatP1Wins: aggregate.p1Wins,
    responderTookP0Count: aggregate.swaps,
    repetitionDrawRate: aggregate.repetitionDraws / games,
    averageMoves: aggregate.totalMoves / games,
    meta: {
      probes: aggregate.totalMetaProbes,
      elapsedMs: aggregate.totalMetaElapsedMs,
      averageMsPerGame: aggregate.totalMetaElapsedMs / games,
    },
    runtime: {
      p0AverageDecisionMs: aggregate.p0Decisions === 0 ? 0 : aggregate.p0DecisionMs / aggregate.p0Decisions,
      p1AverageDecisionMs: aggregate.p1Decisions === 0 ? 0 : aggregate.p1DecisionMs / aggregate.p1Decisions,
      p0RolloutPolicyDraws: aggregate.p0RolloutPolicyDraws,
      p1RolloutPolicyDraws: aggregate.p1RolloutPolicyDraws,
    },
    setupFrequencies: [...aggregate.setupFrequencies.entries()]
      .map(([setup, count]) => ({ setup, count }))
      .sort((a, b) => b.count - a.count || a.setup.localeCompare(b.setup)),
  },
  details,
}, null, 2));

function playGame(index: number, seed: number): GameDetail {
  const prepared = prepareProtocol(index, seed);
  let state = prepared.state;
  const randomByAgent: Record<CompetitiveAgentId, () => number> = {
    A: mulberry32(seed ^ 0x9e3779b9),
    B: mulberry32(seed ^ 0x85ebca6b),
  };
  let p0RolloutPolicyDraws = 0;
  let p1RolloutPolicyDraws = 0;

  while (state.game.status === "playing" && state.adjudication === null && state.game.moveNumber < maxMoves) {
    const seat = state.game.currentPlayer;
    const agent = prepared.seatToAgent[seat];
    const started = performance.now();
    const decision = choosePolicyMctsMoveV7(state, THREEFOLD, {
      variant: "uct-pb",
      simulations,
      timeBudgetMs,
      rolloutDepth,
      random: randomByAgent[agent],
    });
    const elapsed = performance.now() - started;
    if (seat === "P0") {
      aggregate.p0DecisionMs += elapsed;
      aggregate.p0Decisions += 1;
      p0RolloutPolicyDraws += decision.diagnostics.policyDrawRollouts;
    } else {
      aggregate.p1DecisionMs += elapsed;
      aggregate.p1Decisions += 1;
      p1RolloutPolicyDraws += decision.diagnostics.policyDrawRollouts;
    }

    if (!decision.move) {
      return finalize(index + 1, seed, state, prepared, "unresolved", p0RolloutPolicyDraws, p1RolloutPolicyDraws);
    }
    const applied = applyPolicyMove(state, decision.move, THREEFOLD);
    if (!applied.ok) throw new Error(`Illegal ${seat}/${agent} move ${moveKey(decision.move)}: ${applied.error}`);
    state = applied.state;
  }

  if (state.adjudication?.kind === "repetition-draw") {
    return finalize(index + 1, seed, state, prepared, "repetition-draw", p0RolloutPolicyDraws, p1RolloutPolicyDraws);
  }
  if (state.game.status === "finished") {
    return finalize(index + 1, seed, state, prepared, "natural", p0RolloutPolicyDraws, p1RolloutPolicyDraws);
  }
  return finalize(index + 1, seed, state, prepared, "unresolved", p0RolloutPolicyDraws, p1RolloutPolicyDraws);
}

function prepareProtocol(index: number, seed: number): PreparedProtocol {
  switch (protocol) {
    case "single-b2ccw": {
      const state = applyForcedMoves(createPolicyState(createInitialState()), [parseClassicOpening("B2:CCW")]);
      return {
        state,
        seatToAgent: KEEP_MAPPING_V8,
        setupMoves: ["B2:CCW"],
        responderSeat: null,
        metaP1Value: null,
        metaProbes: 0,
        metaElapsedMs: 0,
        notes: ["single-opening control selected by V7 scan"],
      };
    }
    case "balanced-pool": {
      const tag = index % 2 === 0 ? "B4:CW" : "B5:CW";
      const state = applyForcedMoves(createPolicyState(createInitialState()), [parseClassicOpening(tag)]);
      return {
        state,
        seatToAgent: KEEP_MAPPING_V8,
        setupMoves: [tag],
        responderSeat: null,
        metaP1Value: null,
        metaProbes: 0,
        metaElapsedMs: 0,
        notes: ["exact 50/50 deterministic opening pool by game index"],
      };
    }
    case "pie":
      return preparePie(seed);
    case "swap2-adapted":
      return prepareSwap2Adapted(seed);
  }
}

function preparePie(seed: number): PreparedProtocol {
  const started = performance.now();
  const initial = createPolicyState(createInitialState());
  const candidates = getClassicOpenings().map((move, candidateIndex) => {
    const state = applyForcedMoves(initial, [move]);
    const value = estimateCurrentSeatValue(state, seed ^ hashString(moveKey(move)) ^ candidateIndex);
    return { move, state, value };
  }).sort((a, b) => Math.abs(a.value) - Math.abs(b.value) || moveKey(a.move).localeCompare(moveKey(b.move)));

  const chosen = candidates[0];
  if (!chosen) throw new Error("Pie protocol found no legal opening candidate");
  const responderSeat = rationalResponderSeatFromP1Value(chosen.value);
  return {
    state: chosen.state,
    seatToAgent: mappingForResponderSeat(responderSeat),
    setupMoves: [moveKey(chosen.move)],
    responderSeat,
    metaP1Value: chosen.value,
    metaProbes: candidates.length,
    metaElapsedMs: performance.now() - started,
    notes: [
      "A selects the first move that maximizes its empirical pie guarantee -|v|",
      `B takes ${responderSeat} because estimated P1 seat value is ${chosen.value.toFixed(4)}`,
    ],
  };
}

function prepareSwap2Adapted(seed: number): PreparedProtocol {
  const started = performance.now();
  const initial = createPolicyState(createInitialState());
  let frontier: Array<{ state: PolicyState; moves: PlayerMove[] }> = [{ state: initial, moves: [] }];

  for (let ply = 0; ply < 3; ply += 1) {
    const next: Array<{ state: PolicyState; moves: PlayerMove[] }> = [];
    for (const candidate of frontier) {
      for (const move of getLegalMoves(candidate.state.game)) {
        const applied = applyPolicyMove(candidate.state, move, THREEFOLD);
        if (!applied.ok || applied.state.adjudication !== null || applied.state.game.status !== "playing") continue;
        next.push({ state: applied.state, moves: [...candidate.moves, move] });
      }
    }
    frontier = next;
  }

  const staticShortlist: SetupCandidate[] = frontier.map((candidate) => ({
    ...candidate,
    staticAbsP1Value: Math.abs(staticSeatValue(candidate.state, "P1")),
  })).sort((a, b) => a.staticAbsP1Value - b.staticAbsP1Value || moveSequenceKey(a.moves).localeCompare(moveSequenceKey(b.moves)))
    .slice(0, swap2CandidateCap);

  const reranked = staticShortlist.map((candidate, candidateIndex) => ({
    ...candidate,
    metaValue: estimateCurrentSeatValue(candidate.state, seed ^ hashString(moveSequenceKey(candidate.moves)) ^ candidateIndex),
  })).sort((a, b) => Math.abs(a.metaValue) - Math.abs(b.metaValue) || moveSequenceKey(a.moves).localeCompare(moveSequenceKey(b.moves)));

  const chosen = reranked[0];
  if (!chosen) throw new Error("Swap2-adapted protocol found no legal 3-ply setup candidate");
  const responderSeat = rationalResponderSeatFromP1Value(chosen.metaValue);
  return {
    state: chosen.state,
    seatToAgent: mappingForResponderSeat(responderSeat),
    setupMoves: chosen.moves.map(moveKey),
    responderSeat,
    metaP1Value: chosen.metaValue,
    metaProbes: reranked.length,
    metaElapsedMs: performance.now() - started,
    notes: [
      `exhaustively enumerated ${frontier.length} legal 3-ply setups`,
      `MCTS re-ranked ${reranked.length} static-balance finalists`,
      `B takes ${responderSeat}; zero-sum Swap2 defer guarantee is <= 0 and cannot beat immediate |v|=${Math.abs(chosen.metaValue).toFixed(4)}`,
      "this is a research-only sequential adaptation, not the literal Gomoku placement protocol",
    ],
  };
}

function estimateCurrentSeatValue(state: PolicyState, seed: number): number {
  const decision = choosePolicyMctsMoveV7(state, THREEFOLD, {
    variant: "uct-pb",
    simulations: metaSimulations,
    timeBudgetMs: metaBudgetMs,
    rolloutDepth,
    random: mulberry32(seed),
  });
  const selected = decision.rootStats.find((stat) => decision.move && moveKey(stat.move) === moveKey(decision.move))
    ?? decision.rootStats[0];
  return selected?.meanValue ?? staticSeatValue(state, state.game.currentPlayer);
}

function staticSeatValue(state: PolicyState, player: PlayerId): number {
  if (state.adjudication !== null) return 0;
  const game = state.game;
  if (game.status === "finished") {
    if (game.winner === player) return 1;
    if (game.winner === null) return 0;
    return -1;
  }
  const opponent: PlayerId = player === "P0" ? "P1" : "P0";
  const scoreDelta = game.scores[player] - game.scores[opponent];
  const sideDelta = sideStones(state, player) - sideStones(state, opponent);
  const mobilityDelta = playablePits(state, player) - playablePits(state, opponent);
  return Math.tanh((scoreDelta * 1.35 + sideDelta * 0.25 + mobilityDelta * 0.35) / 12);
}

function sideStones(state: PolicyState, player: PlayerId): number {
  return state.game.pits
    .filter((pit) => pit.owner === player && pit.kind === "dan")
    .reduce((sum, pit) => sum + pit.stones, 0);
}

function playablePits(state: PolicyState, player: PlayerId): number {
  return state.game.pits.filter((pit) => pit.owner === player && pit.kind === "dan" && pit.stones > 0).length;
}

function applyForcedMoves(initial: PolicyState, moves: PlayerMove[]): PolicyState {
  let state = initial;
  for (const requested of moves) {
    const legal = getLegalMoves(state.game).find((move) => move.pit === requested.pit && move.dir === requested.dir);
    if (!legal) throw new Error(`Illegal forced setup move ${moveKey(requested)}`);
    const applied = applyPolicyMove(state, legal, THREEFOLD);
    if (!applied.ok) throw new Error(`Failed forced setup move ${moveKey(requested)}: ${applied.error}`);
    state = applied.state;
  }
  return state;
}

function finalize(
  game: number,
  seed: number,
  state: PolicyState,
  prepared: PreparedProtocol,
  finishKind: FinishKind,
  p0RolloutPolicyDraws: number,
  p1RolloutPolicyDraws: number,
): GameDetail {
  const winnerSeat = finishKind === "natural" ? state.game.winner : null;
  const winnerAgent = winnerAgentFromSeat(winnerSeat, prepared.seatToAgent);
  const agentScores = prepared.seatToAgent.P0 === "A"
    ? { A: state.game.scores.P0, B: state.game.scores.P1 }
    : { A: state.game.scores.P1, B: state.game.scores.P0 };
  return {
    game,
    seed,
    protocol,
    finishKind,
    winnerSeat,
    winnerAgent,
    moves: state.game.moveNumber,
    seatScores: { ...state.game.scores },
    agentScores,
    seatToAgent: prepared.seatToAgent,
    setupMoves: prepared.setupMoves,
    responderSeat: prepared.responderSeat,
    metaP1Value: prepared.metaP1Value,
    metaProbes: prepared.metaProbes,
    metaElapsedMs: prepared.metaElapsedMs,
    p0RolloutPolicyDraws,
    p1RolloutPolicyDraws,
    notes: prepared.notes,
  };
}

function requiredProtocolArg(name: string): ProtocolId {
  const value = stringArg(name);
  if (value === "single-b2ccw" || value === "balanced-pool" || value === "pie" || value === "swap2-adapted") return value;
  throw new Error(`${name} must be single-b2ccw|balanced-pool|pie|swap2-adapted`);
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

function moveKey(move: PlayerMove): string {
  return `${move.pit}:${move.dir}`;
}

function moveSequenceKey(moves: PlayerMove[]): string {
  return moves.map(moveKey).join(" ");
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
