import { applyMove, getLegalMoves, otherPlayer } from "../engine.js";
import type { GameState, PlayerId, PlayerMove } from "../types.js";

export type PuctV2Options = {
  simulations?: number;
  timeBudgetMs?: number;
  puctExploration?: number;
  policyTemperature?: number;
};

export type PuctV2Diagnostics = {
  simulations: number;
  elapsedMs: number;
  rootVisits: number;
  expandedNodes: number;
  maxTreeDepth: number;
};

export type PuctV2MoveStat = {
  move: PlayerMove;
  visits: number;
  meanValue: number;
  prior: number;
};

export type PuctV2Decision = {
  move: PlayerMove | null;
  diagnostics: PuctV2Diagnostics;
  rootStats: PuctV2MoveStat[];
};

type PuctNode = {
  state: GameState;
  parent: PuctNode | null;
  move: PlayerMove | null;
  children: PuctNode[];
  visits: number;
  valueSum: number;
  prior: number;
  depth: number;
  expanded: boolean;
};

const DEFAULT_SIMULATIONS = 1_000;
export const FROZEN_PUCT_V2_EXPLORATION = 1.5;
export const FROZEN_PUCT_V2_POLICY_TEMPERATURE = 0.6;

/**
 * Frozen stateless PUCT V2 baseline used by the V3A ablation.
 *
 * This is the historical `puct-hv` search path extracted from the old mixed
 * MCTS module so R1c does not have to mutate the current UCT/UCT-PB baseline.
 * The historical implementation had a module default policy temperature of
 * 0.35, but every promoted V2/V3A comparison explicitly froze temperature at
 * 0.6. R1c therefore makes 0.6 the wrapper default to prevent accidental drift.
 *
 * V2 has no rollout and consumes no RNG: it expands all legal children,
 * builds a one-ply heuristic softmax prior, evaluates the selected leaf with
 * the normalized heuristic, and rebuilds a fresh tree on every decision.
 */
export function chooseFrozenPuctV2(
  state: GameState,
  options: PuctV2Options = {},
): PuctV2Decision {
  const started = performance.now();
  const rootPlayer = state.currentPlayer;
  const maxSimulations = options.simulations ?? DEFAULT_SIMULATIONS;
  const deadline = started + (options.timeBudgetMs ?? Number.POSITIVE_INFINITY);
  const exploration = options.puctExploration ?? FROZEN_PUCT_V2_EXPLORATION;
  const policyTemperature =
    options.policyTemperature ?? FROZEN_PUCT_V2_POLICY_TEMPERATURE;

  if (!(exploration > 0)) throw new Error("puctExploration must be > 0");
  if (!(policyTemperature > 0)) throw new Error("policyTemperature must be > 0");
  if (!Number.isSafeInteger(maxSimulations) || maxSimulations < 0) {
    throw new Error("simulations must be a non-negative safe integer");
  }

  const root = makePuctNode(state, null, null, 1, 0);
  const legalMoves = getLegalMoves(state);
  if (legalMoves.length === 0) {
    return {
      move: null,
      diagnostics: {
        simulations: 0,
        elapsedMs: performance.now() - started,
        rootVisits: 0,
        expandedNodes: 1,
        maxTreeDepth: 0,
      },
      rootStats: [],
    };
  }

  let simulations = 0;
  let expandedNodes = 1;
  let maxTreeDepth = 0;

  while (simulations < maxSimulations && performance.now() < deadline) {
    let node = root;

    while (
      node.state.status === "playing"
      && node.expanded
      && node.children.length > 0
    ) {
      node = selectPuctChild(node, rootPlayer, exploration);
      if (node.visits === 0) break;
    }

    if (node.state.status === "playing" && !node.expanded) {
      const created = expandPuctNode(node, rootPlayer, policyTemperature);
      expandedNodes += created;
      if (created > 0) maxTreeDepth = Math.max(maxTreeDepth, node.depth + 1);
    }

    const reward = normalizedHeuristic(node.state, rootPlayer);
    for (let cursor: PuctNode | null = node; cursor; cursor = cursor.parent) {
      cursor.visits += 1;
      cursor.valueSum += reward;
    }
    simulations += 1;
  }

  if (!root.expanded) {
    const created = expandPuctNode(root, rootPlayer, policyTemperature);
    expandedNodes += created;
    if (created > 0) maxTreeDepth = Math.max(maxTreeDepth, 1);
  }

  const rankedChildren = [...root.children].sort((left, right) => {
    if (right.visits !== left.visits) return right.visits - left.visits;
    const leftMean = left.visits > 0
      ? left.valueSum / left.visits
      : Number.NEGATIVE_INFINITY;
    const rightMean = right.visits > 0
      ? right.valueSum / right.visits
      : Number.NEGATIVE_INFINITY;
    if (rightMean !== leftMean) return rightMean - leftMean;
    return right.prior - left.prior;
  });

  return {
    move: rankedChildren[0]?.move ?? legalMoves[0] ?? null,
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

function makePuctNode(
  state: GameState,
  parent: PuctNode | null,
  move: PlayerMove | null,
  prior: number,
  depth: number,
): PuctNode {
  return {
    state,
    parent,
    move,
    children: [],
    visits: 0,
    valueSum: 0,
    prior,
    depth,
    expanded: false,
  };
}

function expandPuctNode(
  node: PuctNode,
  rootPlayer: PlayerId,
  policyTemperature: number,
): number {
  if (node.expanded || node.state.status !== "playing") return 0;
  const moves = getLegalMoves(node.state);
  const priors = heuristicPolicyPriors(
    node.state,
    moves,
    rootPlayer,
    policyTemperature,
  );

  for (const move of moves) {
    const result = applyMove(node.state, move);
    if (!result.ok) continue;
    node.children.push(
      makePuctNode(
        result.state,
        node,
        move,
        priors.get(moveKey(move)) ?? 0,
        node.depth + 1,
      ),
    );
  }

  node.expanded = true;
  return node.children.length;
}

function heuristicPolicyPriors(
  state: GameState,
  moves: PlayerMove[],
  rootPlayer: PlayerId,
  policyTemperature: number,
): Map<string, number> {
  if (moves.length === 0) return new Map();
  const sign = state.currentPlayer === rootPlayer ? 1 : -1;
  const scored = moves.map((move) => {
    const result = applyMove(state, move);
    const score = result.ok
      ? sign * normalizedHeuristic(result.state, rootPlayer)
      : -1;
    return { move, score };
  });
  const maxScore = Math.max(...scored.map((entry) => entry.score));
  const weights = scored.map((entry) =>
    Math.exp((entry.score - maxScore) / policyTemperature)
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const uniform = 1 / moves.length;

  return new Map(
    scored.map((entry, index) => [
      moveKey(entry.move),
      total > 0 && Number.isFinite(total)
        ? (weights[index] ?? 0) / total
        : uniform,
    ]),
  );
}

function selectPuctChild(
  node: PuctNode,
  rootPlayer: PlayerId,
  exploration: number,
): PuctNode {
  const sign = node.state.currentPlayer === rootPlayer ? 1 : -1;
  const parentVisits = Math.max(1, node.visits);
  let best = node.children[0];
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const child of node.children) {
    const mean = child.visits > 0 ? child.valueSum / child.visits : 0;
    const explorationTerm =
      exploration * child.prior * Math.sqrt(parentVisits) / (1 + child.visits);
    const score = sign * mean + explorationTerm;
    if (score > bestScore) {
      bestScore = score;
      best = child;
    }
  }

  if (!best) throw new Error("PUCT selection reached a node without children");
  return best;
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
  const material =
    scoreDelta * 1.8
    + sideDelta * 0.45
    + mobilityDelta * 0.8
    + refillDelta * 2.5;
  return Math.tanh(material / 18);
}

function sideStones(state: GameState, player: PlayerId): number {
  return state.pits
    .filter((pit) => pit.owner === player)
    .reduce((sum, pit) => sum + pit.stones, 0);
}

function playablePits(state: GameState, player: PlayerId): number {
  return state.pits.filter(
    (pit) => pit.owner === player && pit.kind === "dan" && pit.stones > 0,
  ).length;
}

function refillSafety(state: GameState, player: PlayerId): number {
  const stones = sideStones(state, player);
  if (stones > 0) return Math.min(stones, 5) / 5;
  return state.scores[player] >= 5 ? 0.25 : -1;
}

function moveKey(move: PlayerMove): string {
  return `${move.pit}:${move.dir}`;
}
