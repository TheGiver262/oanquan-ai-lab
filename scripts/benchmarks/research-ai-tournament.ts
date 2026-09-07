import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyMove,
  createInitialState,
  getLegalMoves,
  type GameState,
  type PlayerId,
  type PlayerMove,
} from "../../packages/game-engine/src/index";
import {
  AI_DIFFICULTY_PROFILES,
  chooseAiMoveWithDiagnostics,
  type AiDifficulty,
} from "../../apps/web/src/game/ai-player";

const RESEARCH_VARIANTS = ["uct", "uct-pb"] as const;
type ResearchVariant = (typeof RESEARCH_VARIANTS)[number];
const OPPONENTS = ["tham-hoa", "bang-nhan", "trang-nguyen"] as const satisfies readonly AiDifficulty[];

type MctsConfig = {
  simulations: number;
  rolloutPlies: number;
  exploration: number;
  progressiveBiasWeight: number;
  heuristicRolloutProbability: number;
};

type MctsNode = {
  state: GameState;
  parent: MctsNode | null;
  move: PlayerMove | null;
  children: MctsNode[];
  untriedMoves: PlayerMove[];
  visits: number;
  value: number;
  priorRoot: number;
};

type MatchResult = {
  winner: PlayerId | null;
  moveNumber: number;
  scores: Record<PlayerId, number>;
  truncated: boolean;
  researchSeat: PlayerId;
  seed: number;
};

type PairingSummary = {
  variant: ResearchVariant;
  opponent: AiDifficulty;
  games: number;
  researchWins: number;
  productionWins: number;
  draws: number;
  truncated: number;
  researchWinRate: number;
  productionWinRate: number;
  drawRate: number;
  asP0: { games: number; wins: number; losses: number; draws: number };
  asP1: { games: number; wins: number; losses: number; draws: number };
  averageMoves: number;
  results: MatchResult[];
};

const gamesPerPairing = evenPositiveInt(argument("--games") ?? "6", 6);
const simulations = positiveInt(argument("--simulations") ?? "1200", 1200);
const rolloutPlies = positiveInt(argument("--rollout-plies") ?? "24", 24);
const maxMoves = positiveInt(argument("--max-moves") ?? "160", 160);
const outputPath = argument("--output");
const baseSeed = positiveInt(argument("--seed") ?? "2620907", 2620907);

const config: MctsConfig = {
  simulations,
  rolloutPlies,
  exploration: Math.SQRT2,
  progressiveBiasWeight: 0.65,
  heuristicRolloutProbability: 0.8,
};

const startedAt = Date.now();
const pairings: PairingSummary[] = [];
let pairingIndex = 0;
for (const variant of RESEARCH_VARIANTS) {
  for (const opponent of OPPONENTS) {
    const results: MatchResult[] = [];
    for (let gameIndex = 0; gameIndex < gamesPerPairing; gameIndex += 1) {
      const researchSeat: PlayerId = gameIndex % 2 === 0 ? "P0" : "P1";
      const seed = baseSeed + pairingIndex * 10_000 + gameIndex;
      results.push(playMatch(variant, opponent, researchSeat, seed));
    }
    pairings.push(summarizePairing(variant, opponent, results));
    pairingIndex += 1;
  }
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: {
    productionAi: "apps/web/src/game/ai-player.ts",
    productionEngine: "packages/game-engine/src",
  },
  config: {
    gamesPerPairing,
    maxMoves,
    baseSeed,
    mcts: config,
    productionProfiles: Object.fromEntries(
      OPPONENTS.map((difficulty) => [difficulty, AI_DIFFICULTY_PROFILES[difficulty]]),
    ),
  },
  elapsedMs: Date.now() - startedAt,
  pairings,
};

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) {
  const absolute = resolve(repositoryRoot(), outputPath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, serialized, "utf8");
}
console.log(serialized);

function playMatch(
  variant: ResearchVariant,
  opponent: AiDifficulty,
  researchSeat: PlayerId,
  seed: number,
): MatchResult {
  let state = createInitialState();
  const researchRandom = mulberry32(seed ^ 0xa5a5a5a5);
  const productionRandom = mulberry32(seed ^ 0x5a5a5a5a);

  while (state.status !== "finished" && state.moveNumber < maxMoves) {
    const player = state.currentPlayer;
    let move: PlayerMove | null = null;
    if (player === researchSeat) {
      move = chooseMctsMove(state, variant, config, researchRandom);
    } else {
      const decision = chooseAiMoveWithDiagnostics(state, opponent, player, {
        random: productionRandom,
      });
      if (decision.move) move = { player, ...decision.move };
    }
    if (!move) break;
    const result = applyMove(state, move);
    if (!result.ok) {
      throw new Error(
        `Illegal move ${move.player}:${move.pit}:${move.dir} from ${player}: ${result.error}`,
      );
    }
    state = result.state;
  }

  return {
    winner: state.status === "finished" ? state.winner : null,
    moveNumber: state.moveNumber,
    scores: { ...state.scores },
    truncated: state.status !== "finished",
    researchSeat,
    seed,
  };
}

function chooseMctsMove(
  state: GameState,
  variant: ResearchVariant,
  searchConfig: MctsConfig,
  random: () => number,
): PlayerMove | null {
  const legalMoves = getLegalMoves(state);
  if (legalMoves.length === 0) return null;
  if (legalMoves.length === 1) return legalMoves[0] ?? null;

  const rootPlayer = state.currentPlayer;
  const root = createNode(state, null, null, rootPlayer, variant);

  for (let simulation = 0; simulation < searchConfig.simulations; simulation += 1) {
    let node = root;

    while (node.untriedMoves.length === 0 && node.children.length > 0 && node.state.status !== "finished") {
      node = selectChild(node, rootPlayer, variant, searchConfig, random);
    }

    if (node.state.status !== "finished" && node.untriedMoves.length > 0) {
      const moveIndex = Math.floor(random() * node.untriedMoves.length);
      const [move] = node.untriedMoves.splice(moveIndex, 1);
      if (move) {
        const applied = applyMove(node.state, move);
        if (!applied.ok) throw new Error(`MCTS expansion produced illegal move: ${applied.error}`);
        const child = createNode(applied.state, node, move, rootPlayer, variant);
        node.children.push(child);
        node = child;
      }
    }

    const reward = rollout(node.state, rootPlayer, variant, searchConfig, random);
    for (let cursor: MctsNode | null = node; cursor; cursor = cursor.parent) {
      cursor.visits += 1;
      cursor.value += reward;
    }
  }

  const ranked = [...root.children].sort((left, right) => {
    if (right.visits !== left.visits) return right.visits - left.visits;
    const leftMean = left.visits > 0 ? left.value / left.visits : -Infinity;
    const rightMean = right.visits > 0 ? right.value / right.visits : -Infinity;
    if (rightMean !== leftMean) return rightMean - leftMean;
    return moveKey(left.move).localeCompare(moveKey(right.move));
  });
  return ranked[0]?.move ?? legalMoves[0] ?? null;
}

function createNode(
  state: GameState,
  parent: MctsNode | null,
  move: PlayerMove | null,
  rootPlayer: PlayerId,
  variant: ResearchVariant,
): MctsNode {
  return {
    state,
    parent,
    move,
    children: [],
    untriedMoves: getLegalMoves(state),
    visits: 0,
    value: 0,
    priorRoot: variant === "uct-pb" ? heuristicReward(state, rootPlayer) : 0,
  };
}

function selectChild(
  node: MctsNode,
  rootPlayer: PlayerId,
  variant: ResearchVariant,
  searchConfig: MctsConfig,
  random: () => number,
): MctsNode {
  const actingForRoot = node.state.currentPlayer === rootPlayer;
  const logParent = Math.log(Math.max(1, node.visits));
  let bestScore = -Infinity;
  let best: MctsNode[] = [];

  for (const child of node.children) {
    const meanRoot = child.visits > 0 ? child.value / child.visits : 0;
    const exploitation = actingForRoot ? meanRoot : -meanRoot;
    const exploration =
      child.visits > 0
        ? searchConfig.exploration * Math.sqrt(logParent / child.visits)
        : Infinity;
    const signedPrior = actingForRoot ? child.priorRoot : -child.priorRoot;
    const progressiveBias =
      variant === "uct-pb" && child.visits > 0
        ? (searchConfig.progressiveBiasWeight * signedPrior) / (child.visits + 1)
        : 0;
    const score = exploitation + exploration + progressiveBias;
    if (score > bestScore) {
      bestScore = score;
      best = [child];
    } else if (score === bestScore) {
      best.push(child);
    }
  }

  return best[Math.floor(random() * best.length)] ?? node.children[0]!;
}

function rollout(
  initial: GameState,
  rootPlayer: PlayerId,
  variant: ResearchVariant,
  searchConfig: MctsConfig,
  random: () => number,
): number {
  let state = initial;
  for (let ply = 0; ply < searchConfig.rolloutPlies && state.status !== "finished"; ply += 1) {
    const legalMoves = getLegalMoves(state);
    if (legalMoves.length === 0) break;
    let move: PlayerMove | undefined;
    if (variant === "uct-pb" && random() < searchConfig.heuristicRolloutProbability) {
      move = chooseHeuristicRolloutMove(state, legalMoves, random);
    } else {
      move = legalMoves[Math.floor(random() * legalMoves.length)];
    }
    if (!move) break;
    const applied = applyMove(state, move);
    if (!applied.ok) throw new Error(`MCTS rollout produced illegal move: ${applied.error}`);
    state = applied.state;
  }
  return state.status === "finished" ? terminalReward(state, rootPlayer) : heuristicReward(state, rootPlayer);
}

function chooseHeuristicRolloutMove(
  state: GameState,
  legalMoves: readonly PlayerMove[],
  random: () => number,
): PlayerMove | undefined {
  const actor = state.currentPlayer;
  let bestScore = -Infinity;
  let best: PlayerMove[] = [];
  for (const move of legalMoves) {
    const before = state.scores[actor];
    const applied = applyMove(state, move);
    if (!applied.ok) continue;
    const immediateGain = applied.state.scores[actor] - before;
    const score = immediateGain * 2.5 + heuristicReward(applied.state, actor);
    if (score > bestScore) {
      bestScore = score;
      best = [move];
    } else if (score === bestScore) {
      best.push(move);
    }
  }
  return best[Math.floor(random() * best.length)] ?? legalMoves[0];
}

function terminalReward(state: GameState, rootPlayer: PlayerId): number {
  if (state.winner === rootPlayer) return 1;
  if (state.winner === null) return 0;
  return -1;
}

function heuristicReward(state: GameState, rootPlayer: PlayerId): number {
  const opponent: PlayerId = rootPlayer === "P0" ? "P1" : "P0";
  const scoreDelta = state.scores[rootPlayer] - state.scores[opponent];
  const sideDelta = sideStones(state, rootPlayer) - sideStones(state, opponent);
  const rootMobility =
    state.status === "playing" && state.currentPlayer === rootPlayer ? getLegalMoves(state, rootPlayer).length : 0;
  const opponentMobility =
    state.status === "playing" && state.currentPlayer === opponent ? getLegalMoves(state, opponent).length : 0;
  const mobilityDelta = rootMobility - opponentMobility;
  const refillDelta = refillSafety(state, rootPlayer) - refillSafety(state, opponent);
  const raw = scoreDelta * 1.0 + sideDelta * 0.22 + mobilityDelta * 0.08 + refillDelta * 0.6;
  return Math.tanh(raw / 14);
}

function sideStones(state: GameState, player: PlayerId): number {
  return state.pits.filter((pit) => pit.owner === player).reduce((sum, pit) => sum + pit.stones, 0);
}

function refillSafety(state: GameState, player: PlayerId): number {
  const stones = sideStones(state, player);
  if (stones === 0) return state.scores[player] >= 5 ? 1 : -2;
  return Math.min(5, stones) / 5;
}

function summarizePairing(
  variant: ResearchVariant,
  opponent: AiDifficulty,
  results: MatchResult[],
): PairingSummary {
  let researchWins = 0;
  let productionWins = 0;
  let draws = 0;
  let truncated = 0;
  const asP0 = { games: 0, wins: 0, losses: 0, draws: 0 };
  const asP1 = { games: 0, wins: 0, losses: 0, draws: 0 };

  for (const result of results) {
    const seat = result.researchSeat === "P0" ? asP0 : asP1;
    seat.games += 1;
    if (result.truncated) truncated += 1;
    if (result.winner === result.researchSeat) {
      researchWins += 1;
      seat.wins += 1;
    } else if (result.winner === null) {
      draws += 1;
      seat.draws += 1;
    } else {
      productionWins += 1;
      seat.losses += 1;
    }
  }

  return {
    variant,
    opponent,
    games: results.length,
    researchWins,
    productionWins,
    draws,
    truncated,
    researchWinRate: ratio(researchWins, results.length),
    productionWinRate: ratio(productionWins, results.length),
    drawRate: ratio(draws, results.length),
    asP0,
    asP1,
    averageMoves: round(results.reduce((sum, result) => sum + result.moveNumber, 0) / results.length),
    results,
  };
}

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function positiveInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function evenPositiveInt(value: string, fallback: number): number {
  const parsed = positiveInt(value, fallback);
  return parsed % 2 === 0 ? parsed : parsed + 1;
}

function ratio(value: number, total: number): number {
  return total > 0 ? round(value / total) : 0;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function moveKey(move: PlayerMove | null): string {
  return move ? `${move.player}:${move.pit}:${move.dir}` : "";
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function repositoryRoot(): string {
  return fileURLToPath(new URL("../../", import.meta.url));
}
