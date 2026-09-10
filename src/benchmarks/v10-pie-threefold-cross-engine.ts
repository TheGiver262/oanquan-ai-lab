import { createInitialState, getLegalMoves } from "../engine.js";
import {
  mappingForResponderSeat,
  rationalResponderSeatFromP1Value,
  winnerAgentFromSeat,
  type CompetitiveAgentId,
  type ImmediateSeatChoiceV8,
  type SeatMappingV8,
} from "../research/competitive-protocol-v8.js";
import { getClassicOpenings } from "../research/opening-pie-analysis.js";
import { searchPolicyAwarePvsV5 } from "../research/policy-aware-pvs-v5.js";
import { choosePolicyMctsMoveV7 } from "../research/policy-mcts-v7.js";
import {
  applyPolicyMove,
  createPolicyState,
  type PolicyState,
} from "../research/repetition-policy-v5.js";
import {
  PRODUCTION_SOURCE_COMMIT,
  chooseServerProductionMove,
} from "../reference/server-production-ai.js";
import type { PlayerId, PlayerMove } from "../types.js";

type EngineId = "trang-nguyen" | "policy-uct-pb" | "policy-pvs";
type FinishKind = "natural" | "repetition-draw" | "unresolved";

type SplitResult = {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  unresolved: number;
};

type RuntimeResult = {
  decisions: number;
  elapsedMs: number;
};

type PreparedPie = {
  state: PolicyState;
  seatToAgent: SeatMappingV8;
  opening: string;
  responderSeat: ImmediateSeatChoiceV8;
  metaP1Value: number;
  metaElapsedMs: number;
};

type GameDetail = {
  game: number;
  seed: number;
  engineForAgentA: EngineId;
  engineForAgentB: EngineId;
  p0Engine: EngineId;
  p1Engine: EngineId;
  seatToAgent: SeatMappingV8;
  opening: string;
  responderSeat: ImmediateSeatChoiceV8;
  swapped: boolean;
  metaP1Value: number;
  metaElapsedMs: number;
  finishKind: FinishKind;
  winnerSeat: PlayerId | null;
  winnerAgent: CompetitiveAgentId | null;
  winnerEngine: EngineId | null;
  moves: number;
  finalScores: { P0: number; P1: number };
  repetitionDrawMarginP0: number | null;
};

const THREEFOLD = { kind: "repeat-draw", occurrences: 3 } as const;
const engineA = readEngine("--a");
const engineB = readEngine("--b");
if (engineA === engineB) throw new Error("--a and --b must be different engines");

const games = evenIntArg("--games", 12);
const timeBudgetMs = intArg("--ms", 1_200);
const tnNodes = intArg("--tn-nodes", 500_000);
const pvsNodes = intArg("--pvs-nodes", 500_000);
const pvsDepth = intArg("--pvs-depth", 16);
const mctsSimulations = intArg("--simulations", 200_000);
const rolloutDepth = intArg("--rollout-depth", 20);
const metaBudgetMs = intArg("--meta-ms", 200);
const metaSimulations = intArg("--meta-simulations", 50_000);
const maxMoves = intArg("--max-moves", 220);
const seedBase = intArg("--seed", 20261101);

const aggregate = {
  engineAWins: 0,
  engineBWins: 0,
  naturalDraws: 0,
  repetitionDraws: 0,
  unresolved: 0,
  agentAWins: 0,
  agentBWins: 0,
  p0Wins: 0,
  p1Wins: 0,
  swaps: 0,
  totalMoves: 0,
  totalMetaElapsedMs: 0,
  engineAAsAgentA: emptySplit(),
  engineAAsAgentB: emptySplit(),
  engineAAsP0: emptySplit(),
  engineAAsP1: emptySplit(),
  runtime: {
    [engineA]: { decisions: 0, elapsedMs: 0 },
    [engineB]: { decisions: 0, elapsedMs: 0 },
  } as Record<EngineId, RuntimeResult>,
  openingFrequencies: new Map<string, number>(),
};
const details: GameDetail[] = [];

for (let index = 0; index < games; index += 1) {
  const seed = seedBase + index * 7_919;
  const engineForAgentA = index % 2 === 0 ? engineA : engineB;
  const engineForAgentB = index % 2 === 0 ? engineB : engineA;
  const detail = playGame(index + 1, seed, engineForAgentA, engineForAgentB);
  details.push(detail);
  aggregate.totalMoves += detail.moves;
  aggregate.totalMetaElapsedMs += detail.metaElapsedMs;
  aggregate.openingFrequencies.set(detail.opening, (aggregate.openingFrequencies.get(detail.opening) ?? 0) + 1);
  if (detail.swapped) aggregate.swaps += 1;

  if (detail.finishKind === "unresolved") aggregate.unresolved += 1;
  else if (detail.finishKind === "repetition-draw") aggregate.repetitionDraws += 1;
  else if (detail.winnerSeat === null) aggregate.naturalDraws += 1;
  else {
    if (detail.winnerSeat === "P0") aggregate.p0Wins += 1;
    else aggregate.p1Wins += 1;
    if (detail.winnerAgent === "A") aggregate.agentAWins += 1;
    else if (detail.winnerAgent === "B") aggregate.agentBWins += 1;
    if (detail.winnerEngine === engineA) aggregate.engineAWins += 1;
    else if (detail.winnerEngine === engineB) aggregate.engineBWins += 1;
  }

  const engineAAgentSplit = detail.engineForAgentA === engineA ? aggregate.engineAAsAgentA : aggregate.engineAAsAgentB;
  recordSplit(engineAAgentSplit, detail, engineA);
  const engineASeatSplit = detail.p0Engine === engineA ? aggregate.engineAAsP0 : aggregate.engineAAsP1;
  recordSplit(engineASeatSplit, detail, engineA);
}

const completed = games - aggregate.unresolved;
const draws = aggregate.naturalDraws + aggregate.repetitionDraws;
console.log(JSON.stringify({
  methodology: {
    phase: "V10 Pie + threefold cross-engine tournament",
    protocol: "A's opening and B's KEEP/SWAP decision are selected by a neutral policy-aware UCT-PB meta-referee; participant engines alternate Agent A/B each game",
    metaSemantics: "the neutral referee evaluates all 10 classic openings and selects the opening minimizing |estimated P1 value|, equivalent to maximizing A's bounded Pie guarantee -|v|; B then takes the estimated stronger seat",
    gameplayPolicy: "threefold repeated strategic position is an exact draw in actual match adjudication",
    policyAwareness: {
      "policy-uct-pb": "threefold-aware in tree and rollout",
      "policy-pvs": "threefold-aware in PVS search using full PolicyState history",
      "trang-nguyen": "frozen server production-reference search is repetition-blind internally; its actual moves are still adjudicated by threefold externally",
    },
    resourcePrimary: "equal wall-clock budget per move; algorithm-specific node/simulation caps are secondary safety caps",
    roleBalance: "the two participant engines alternate Pie Agent A/B roles; seat P0/P1 ownership is then determined by the Pie KEEP/SWAP mapping",
    claimLimit: "production-compatibility stress test, not a fully algorithm-fair repetition comparison because Trạng Nguyên does not reason about threefold inside search and no live learning snapshot is loaded",
    productionSourceCommit: PRODUCTION_SOURCE_COMMIT,
  },
  engines: { a: engineA, b: engineB },
  config: {
    games,
    timeBudgetMs,
    tnNodes,
    pvsNodes,
    pvsDepth,
    mctsSimulations,
    rolloutDepth,
    metaBudgetMs,
    metaSimulations,
    maxMoves,
    seedBase,
  },
  aggregate: {
    engineAWins: aggregate.engineAWins,
    engineBWins: aggregate.engineBWins,
    naturalDraws: aggregate.naturalDraws,
    repetitionDraws: aggregate.repetitionDraws,
    unresolved: aggregate.unresolved,
    engineAScoreRate: completed === 0 ? 0 : (aggregate.engineAWins + draws * 0.5) / completed,
    engineBScoreRate: completed === 0 ? 0 : (aggregate.engineBWins + draws * 0.5) / completed,
    agentAWins: aggregate.agentAWins,
    agentBWins: aggregate.agentBWins,
    agentAScoreRate: completed === 0 ? 0 : (aggregate.agentAWins + draws * 0.5) / completed,
    p0Wins: aggregate.p0Wins,
    p1Wins: aggregate.p1Wins,
    responderTookP0Count: aggregate.swaps,
    repetitionDrawRate: aggregate.repetitionDraws / games,
    averageMoves: aggregate.totalMoves / games,
    averageMetaMsPerGame: aggregate.totalMetaElapsedMs / games,
    engineAAsAgentA: aggregate.engineAAsAgentA,
    engineAAsAgentB: aggregate.engineAAsAgentB,
    engineAAsP0: aggregate.engineAAsP0,
    engineAAsP1: aggregate.engineAAsP1,
    runtime: Object.fromEntries(Object.entries(aggregate.runtime).map(([engine, runtime]) => [engine, {
      ...runtime,
      averageDecisionMs: runtime.decisions === 0 ? 0 : runtime.elapsedMs / runtime.decisions,
    }])),
    openingFrequencies: [...aggregate.openingFrequencies.entries()]
      .map(([opening, count]) => ({ opening, count }))
      .sort((left, right) => right.count - left.count || left.opening.localeCompare(right.opening)),
  },
  details,
}, null, 2));

function playGame(
  game: number,
  seed: number,
  engineForAgentA: EngineId,
  engineForAgentB: EngineId,
): GameDetail {
  const prepared = preparePie(seed);
  let state = prepared.state;
  const p0Engine = prepared.seatToAgent.P0 === "A" ? engineForAgentA : engineForAgentB;
  const p1Engine = prepared.seatToAgent.P1 === "A" ? engineForAgentA : engineForAgentB;
  const randomByAgent: Record<CompetitiveAgentId, () => number> = {
    A: mulberry32(seed ^ 0x9e3779b9),
    B: mulberry32(seed ^ 0x85ebca6b),
  };

  while (state.game.status === "playing" && state.adjudication === null && state.game.moveNumber < maxMoves) {
    const seat = state.game.currentPlayer;
    const agent = prepared.seatToAgent[seat];
    const engine = agent === "A" ? engineForAgentA : engineForAgentB;
    const started = performance.now();
    const move = chooseEngineMove(state, engine, seat, randomByAgent[agent]);
    const elapsed = performance.now() - started;
    const runtime = aggregate.runtime[engine] ?? (aggregate.runtime[engine] = { decisions: 0, elapsedMs: 0 });
    runtime.decisions += 1;
    runtime.elapsedMs += elapsed;

    if (!move) {
      return finalize(game, seed, engineForAgentA, engineForAgentB, p0Engine, p1Engine, prepared, state, "unresolved");
    }
    const applied = applyPolicyMove(state, move, THREEFOLD);
    if (!applied.ok) throw new Error(`Illegal ${engine}/${seat} move ${moveKey(move)}: ${applied.error}`);
    state = applied.state;
  }

  if (state.adjudication?.kind === "repetition-draw") {
    return finalize(game, seed, engineForAgentA, engineForAgentB, p0Engine, p1Engine, prepared, state, "repetition-draw");
  }
  if (state.game.status === "finished") {
    return finalize(game, seed, engineForAgentA, engineForAgentB, p0Engine, p1Engine, prepared, state, "natural");
  }
  return finalize(game, seed, engineForAgentA, engineForAgentB, p0Engine, p1Engine, prepared, state, "unresolved");
}

function preparePie(seed: number): PreparedPie {
  const started = performance.now();
  const initial = createPolicyState(createInitialState());
  const candidates = getClassicOpenings().map((move, index) => {
    const applied = applyPolicyMove(initial, move, THREEFOLD);
    if (!applied.ok) throw new Error(`Pie meta-referee failed opening ${moveKey(move)}: ${applied.error}`);
    const value = estimateCurrentSeatValue(applied.state, seed ^ hashString(moveKey(move)) ^ index);
    return { move, state: applied.state, value };
  }).sort((left, right) => Math.abs(left.value) - Math.abs(right.value) || moveKey(left.move).localeCompare(moveKey(right.move)));

  const chosen = candidates[0];
  if (!chosen) throw new Error("Pie meta-referee found no legal opening");
  const responderSeat = rationalResponderSeatFromP1Value(chosen.value);
  return {
    state: chosen.state,
    seatToAgent: mappingForResponderSeat(responderSeat),
    opening: moveKey(chosen.move),
    responderSeat,
    metaP1Value: chosen.value,
    metaElapsedMs: performance.now() - started,
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

function chooseEngineMove(
  state: PolicyState,
  engine: EngineId,
  player: PlayerId,
  random: () => number,
): PlayerMove | null {
  if (engine === "policy-uct-pb") {
    return choosePolicyMctsMoveV7(state, THREEFOLD, {
      variant: "uct-pb",
      simulations: mctsSimulations,
      timeBudgetMs,
      rolloutDepth,
      random,
    }).move;
  }
  if (engine === "policy-pvs") {
    return searchPolicyAwarePvsV5(state, THREEFOLD, {
      evaluationFamily: "strategic",
      maxDepth: pvsDepth,
      nodeBudget: pvsNodes,
      timeBudgetMs,
    }).move;
  }

  const production = chooseServerProductionMove(state.game, "trang-nguyen", player, {
    mode: "production-max",
    timeBudgetMs,
    nodeBudget: tnNodes,
    random,
  });
  return production ? { player, ...production } : null;
}

function finalize(
  game: number,
  seed: number,
  engineForAgentA: EngineId,
  engineForAgentB: EngineId,
  p0Engine: EngineId,
  p1Engine: EngineId,
  prepared: PreparedPie,
  state: PolicyState,
  finishKind: FinishKind,
): GameDetail {
  const winnerSeat = finishKind === "natural" ? state.game.winner : null;
  const winnerAgent = finishKind === "natural" ? winnerAgentFromSeat(winnerSeat, prepared.seatToAgent) : null;
  const winnerEngine = winnerAgent === null
    ? null
    : winnerAgent === "A" ? engineForAgentA : engineForAgentB;
  return {
    game,
    seed,
    engineForAgentA,
    engineForAgentB,
    p0Engine,
    p1Engine,
    seatToAgent: prepared.seatToAgent,
    opening: prepared.opening,
    responderSeat: prepared.responderSeat,
    swapped: prepared.responderSeat === "P0",
    metaP1Value: prepared.metaP1Value,
    metaElapsedMs: prepared.metaElapsedMs,
    finishKind,
    winnerSeat,
    winnerAgent,
    winnerEngine,
    moves: state.game.moveNumber,
    finalScores: { ...state.game.scores },
    repetitionDrawMarginP0: finishKind === "repetition-draw" ? state.game.scores.P0 - state.game.scores.P1 : null,
  };
}

function recordSplit(split: SplitResult, detail: GameDetail, trackedEngine: EngineId): void {
  split.games += 1;
  if (detail.finishKind === "unresolved") {
    split.unresolved += 1;
    return;
  }
  if (detail.winnerEngine === null) {
    split.draws += 1;
    return;
  }
  if (detail.winnerEngine === trackedEngine) split.wins += 1;
  else split.losses += 1;
}

function emptySplit(): SplitResult {
  return { games: 0, wins: 0, losses: 0, draws: 0, unresolved: 0 };
}

function sideStones(state: PolicyState, player: PlayerId): number {
  return state.game.pits
    .filter((pit) => pit.owner === player && pit.kind === "dan")
    .reduce((sum, pit) => sum + pit.stones, 0);
}

function playablePits(state: PolicyState, player: PlayerId): number {
  return getLegalMoves(state.game, player).length;
}

function readEngine(name: string): EngineId {
  const value = requiredStringArg(name);
  if (value === "trang-nguyen" || value === "policy-uct-pb" || value === "policy-pvs") return value;
  throw new Error(`Unknown engine ${value}`);
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

function evenIntArg(name: string, fallback: number): number {
  const value = intArg(name, fallback);
  if (value % 2 !== 0) throw new Error(`${name} must be even`);
  return value;
}

function moveKey(move: PlayerMove): string {
  return `${move.pit}:${move.dir}`;
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
