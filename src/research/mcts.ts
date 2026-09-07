import { applyMove, getLegalMoves, otherPlayer } from "../engine.js";
import type { GameState, PlayerId, PlayerMove } from "../types.js";

export type MctsVariant = "uct" | "uct-pb";

export type MctsOptions = {
  variant?: MctsVariant;
  simulations?: number;
  timeBudgetMs?: number;
  exploration?: number;
  rolloutDepth?: number;
  progressiveBiasWeight?: number;
  random?: () => number;
};

export type MctsDiagnostics = {
  simulations: number;
  elapsedMs: number;
  rootVisits: number;
  expandedNodes: number;
  maxTreeDepth: number;
};

export type MctsMoveStat = {
  move: PlayerMove;
  visits: number;
  meanValue: number;
  prior: number;
};

export type MctsDecision = {
  move: PlayerMove | null;
  diagnostics: MctsDiagnostics;
  rootStats: MctsMoveStat[];
};

type Node = {
  state: GameState;
  parent: Node | null;
  move: PlayerMove | null;
  children: Node[];
  untriedMoves: PlayerMove[];
  visits: number;
  valueSum: number;
  prior: number;
  depth: number;
};

const DEFAULT_SIMULATIONS = 1_000;
const DEFAULT_ROLLOUT_DEPTH = 24;
const DEFAULT_EXPLORATION = Math.SQRT2;
const DEFAULT_PROGRESSIVE_BIAS = 0.65;

export function chooseMctsMove(state: GameState, options: MctsOptions = {}): MctsDecision {
  const started = performance.now();
  const rootPlayer = state.currentPlayer;
  const random = options.random ?? Math.random;
  const variant = options.variant ?? "uct";
  const maxSimulations = options.simulations ?? DEFAULT_SIMULATIONS;
  const deadline = started + (options.timeBudgetMs ?? Number.POSITIVE_INFINITY);
  const exploration = options.exploration ?? DEFAULT_EXPLORATION;
  const rolloutDepth = options.rolloutDepth ?? DEFAULT_ROLLOUT_DEPTH;
  const progressiveBiasWeight = options.progressiveBiasWeight ?? DEFAULT_PROGRESSIVE_BIAS;

  const root = makeNode(state, null, null, rootPlayer, 0);
  if (root.untriedMoves.length === 0) {
    return {
      move: null,
      diagnostics: { simulations: 0, elapsedMs: performance.now() - started, rootVisits: 0, expandedNodes: 1, maxTreeDepth: 0 },
      rootStats: [],
    };
  }

  let simulations = 0;
  let expandedNodes = 1;
  let maxTreeDepth = 0;

  while (simulations < maxSimulations && performance.now() < deadline) {
    let node = root;

    while (node.state.status === "playing" && node.untriedMoves.length === 0 && node.children.length > 0) {
      node = selectChild(node, rootPlayer, exploration, variant, progressiveBiasWeight);
    }

    if (node.state.status === "playing" && node.untriedMoves.length > 0) {
      const moveIndex = chooseExpansionIndex(node, rootPlayer, variant, random);
      const [move] = node.untriedMoves.splice(moveIndex, 1);
      if (move) {
        const result = applyMove(node.state, move);
        if (result.ok) {
          const child = makeNode(result.state, node, move, rootPlayer, node.depth + 1);
          node.children.push(child);
          node = child;
          expandedNodes += 1;
          maxTreeDepth = Math.max(maxTreeDepth, child.depth);
        }
      }
    }

    const reward = rollout(node.state, rootPlayer, variant, rolloutDepth, random);
    for (let cursor: Node | null = node; cursor; cursor = cursor.parent) {
      cursor.visits += 1;
      cursor.valueSum += reward;
    }
    simulations += 1;
  }

  const rankedChildren = [...root.children].sort((a, b) => {
    if (b.visits !== a.visits) return b.visits - a.visits;
    const aMean = a.visits > 0 ? a.valueSum / a.visits : -Infinity;
    const bMean = b.visits > 0 ? b.valueSum / b.visits : -Infinity;
    return bMean - aMean;
  });

  return {
    move: rankedChildren[0]?.move ?? root.untriedMoves[0] ?? null,
    diagnostics: {
      simulations,
      elapsedMs: performance.now() - started,
      rootVisits: root.visits,
      expandedNodes,
      maxTreeDepth,
    },
    rootStats: rankedChildren.map((child) => ({
      move: child.move as PlayerMove,
      visits: child.visits,
      meanValue: child.visits > 0 ? child.valueSum / child.visits : 0,
      prior: child.prior,
    })),
  };
}

function makeNode(
  state: GameState,
  parent: Node | null,
  move: PlayerMove | null,
  rootPlayer: PlayerId,
  depth: number,
): Node {
  return {
    state,
    parent,
    move,
    children: [],
    untriedMoves: getLegalMoves(state),
    visits: 0,
    valueSum: 0,
    prior: normalizedHeuristic(state, rootPlayer),
    depth,
  };
}

function selectChild(
  node: Node,
  rootPlayer: PlayerId,
  exploration: number,
  variant: MctsVariant,
  progressiveBiasWeight: number,
): Node {
  const sign = node.state.currentPlayer === rootPlayer ? 1 : -1;
  const parentVisits = Math.max(1, node.visits);
  let best = node.children[0];
  let bestScore = -Infinity;

  for (const child of node.children) {
    if (child.visits === 0) return child;
    const mean = child.valueSum / child.visits;
    const explorationTerm = exploration * Math.sqrt(Math.log(parentVisits + 1) / child.visits);
    const progressiveBias = variant === "uct-pb"
      ? sign * child.prior * progressiveBiasWeight / (child.visits + 1)
      : 0;
    const score = sign * mean + explorationTerm + progressiveBias;
    if (score > bestScore) {
      bestScore = score;
      best = child;
    }
  }

  if (!best) throw new Error("MCTS selection reached a node without children");
  return best;
}

function chooseExpansionIndex(node: Node, rootPlayer: PlayerId, variant: MctsVariant, random: () => number): number {
  if (variant === "uct") return Math.floor(random() * node.untriedMoves.length);

  const maximizing = node.state.currentPlayer === rootPlayer;
  let bestIndex = 0;
  let bestValue = maximizing ? -Infinity : Infinity;
  for (let index = 0; index < node.untriedMoves.length; index += 1) {
    const move = node.untriedMoves[index];
    if (!move) continue;
    const result = applyMove(node.state, move);
    if (!result.ok) continue;
    const value = normalizedHeuristic(result.state, rootPlayer);
    if ((maximizing && value > bestValue) || (!maximizing && value < bestValue)) {
      bestValue = value;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function rollout(
  start: GameState,
  rootPlayer: PlayerId,
  variant: MctsVariant,
  rolloutDepth: number,
  random: () => number,
): number {
  let state = start;
  for (let ply = 0; ply < rolloutDepth && state.status === "playing"; ply += 1) {
    const moves = getLegalMoves(state);
    if (moves.length === 0) break;
    const move = variant === "uct-pb"
      ? chooseHeuristicRolloutMove(state, moves, rootPlayer, random)
      : moves[Math.floor(random() * moves.length)];
    if (!move) break;
    const result = applyMove(state, move);
    if (!result.ok) break;
    state = result.state;
  }

  if (state.status === "finished") {
    if (state.winner === rootPlayer) return 1;
    if (state.winner === null) return 0;
    return -1;
  }
  return normalizedHeuristic(state, rootPlayer);
}

function chooseHeuristicRolloutMove(
  state: GameState,
  moves: PlayerMove[],
  rootPlayer: PlayerId,
  random: () => number,
): PlayerMove | undefined {
  // Keep exploration in heavy playouts: 20% random, otherwise best one-ply heuristic for side to move.
  if (random() < 0.2) return moves[Math.floor(random() * moves.length)];
  const maximizing = state.currentPlayer === rootPlayer;
  let bestMove = moves[0];
  let bestValue = maximizing ? -Infinity : Infinity;
  for (const move of moves) {
    const result = applyMove(state, move);
    if (!result.ok) continue;
    const value = normalizedHeuristic(result.state, rootPlayer);
    if ((maximizing && value > bestValue) || (!maximizing && value < bestValue)) {
      bestValue = value;
      bestMove = move;
    }
  }
  return bestMove;
}

function normalizedHeuristic(state: GameState, player: PlayerId): number {
  if (state.status === "finished") {
    if (state.winner === player) return 1;
    if (state.winner === null) return 0;
    return -1;
  }

  const opponent = otherPlayer(player);
  const scoreDelta = state.scores[player] - state.scores[opponent];
  const sideDelta = sideStones(state, player) - sideStones(state, opponent);
  const mobilityDelta = playablePits(state, player) - playablePits(state, opponent);
  const refillDelta = refillSafety(state, player) - refillSafety(state, opponent);
  const material = scoreDelta * 1.8 + sideDelta * 0.45 + mobilityDelta * 0.8 + refillDelta * 2.5;
  return Math.tanh(material / 18);
}

function sideStones(state: GameState, player: PlayerId): number {
  return state.pits.filter((pit) => pit.owner === player).reduce((sum, pit) => sum + pit.stones, 0);
}

function playablePits(state: GameState, player: PlayerId): number {
  return state.pits.filter((pit) => pit.owner === player && pit.kind === "dan" && pit.stones > 0).length;
}

function refillSafety(state: GameState, player: PlayerId): number {
  const stones = sideStones(state, player);
  if (stones > 0) return Math.min(stones, 5) / 5;
  return state.scores[player] >= 5 ? 0.25 : -1;
}
