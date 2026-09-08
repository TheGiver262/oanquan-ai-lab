import { getLegalMoves } from "../engine.js";
import type { PlayerId, PlayerMove } from "../types.js";
import {
  applyPolicyMove,
  validatePolicy,
  type PolicyState,
  type RepetitionPolicy,
} from "./repetition-policy-v5.js";

export type PolicyMctsVariantV7 = "uct" | "uct-pb";

export type PolicyMctsOptionsV7 = {
  variant?: PolicyMctsVariantV7;
  simulations?: number;
  timeBudgetMs?: number;
  exploration?: number;
  rolloutDepth?: number;
  progressiveBiasWeight?: number;
  random?: () => number;
};

export type PolicyMctsDiagnosticsV7 = {
  simulations: number;
  elapsedMs: number;
  rootVisits: number;
  expandedNodes: number;
  maxTreeDepth: number;
  policyDrawRollouts: number;
  naturalTerminalRollouts: number;
  heuristicRollouts: number;
};

export type PolicyMctsMoveStatV7 = {
  move: PlayerMove;
  visits: number;
  meanValue: number;
  prior: number;
};

export type PolicyMctsDecisionV7 = {
  move: PlayerMove | null;
  diagnostics: PolicyMctsDiagnosticsV7;
  rootStats: PolicyMctsMoveStatV7[];
};

type Node = {
  state: PolicyState;
  parent: Node | null;
  move: PlayerMove | null;
  children: Node[];
  untriedMoves: PlayerMove[];
  visits: number;
  valueSum: number;
  prior: number;
  depth: number;
};

type RolloutCounters = {
  policyDraws: number;
  naturalTerminals: number;
  heuristic: number;
};

const DEFAULT_SIMULATIONS = 1_000;
const DEFAULT_ROLLOUT_DEPTH = 24;
const DEFAULT_EXPLORATION = Math.SQRT2;
const DEFAULT_PROGRESSIVE_BIAS = 0.65;

/**
 * Policy-aware MCTS for V7 mode research.
 *
 * Unlike the legacy MCTS implementation, every tree edge and rollout move is
 * applied through applyPolicyMove(). Repetition history therefore travels with
 * the node and a threefold/max-ply adjudication is an exact draw terminal with
 * reward 0. This makes the engine suitable for comparing candidate competitive
 * modes whose game definition includes a research repetition policy.
 */
export function choosePolicyMctsMoveV7(
  rootState: PolicyState,
  policy: RepetitionPolicy,
  options: PolicyMctsOptionsV7 = {},
): PolicyMctsDecisionV7 {
  validatePolicy(policy);
  const started = performance.now();
  const rootPlayer = rootState.game.currentPlayer;
  const random = options.random ?? Math.random;
  const variant = options.variant ?? "uct-pb";
  const maxSimulations = options.simulations ?? DEFAULT_SIMULATIONS;
  const deadline = started + (options.timeBudgetMs ?? Number.POSITIVE_INFINITY);
  const exploration = options.exploration ?? DEFAULT_EXPLORATION;
  const rolloutDepth = options.rolloutDepth ?? DEFAULT_ROLLOUT_DEPTH;
  const progressiveBiasWeight = options.progressiveBiasWeight ?? DEFAULT_PROGRESSIVE_BIAS;
  const rolloutCounters: RolloutCounters = { policyDraws: 0, naturalTerminals: 0, heuristic: 0 };

  if (isTerminal(rootState)) {
    return emptyDecision(started, rolloutCounters);
  }

  const root = makeNode(rootState, null, null, rootPlayer, 0);
  if (root.untriedMoves.length === 0) {
    return emptyDecision(started, rolloutCounters);
  }

  let simulations = 0;
  let expandedNodes = 1;
  let maxTreeDepth = 0;

  while (simulations < maxSimulations && performance.now() < deadline) {
    let node = root;

    while (!isTerminal(node.state) && node.untriedMoves.length === 0 && node.children.length > 0) {
      node = selectChild(node, rootPlayer, exploration, variant, progressiveBiasWeight);
    }

    if (!isTerminal(node.state) && node.untriedMoves.length > 0) {
      const moveIndex = chooseExpansionIndex(node, rootPlayer, variant, policy, random);
      const [move] = node.untriedMoves.splice(moveIndex, 1);
      if (move) {
        const applied = applyPolicyMove(node.state, move, policy);
        if (applied.ok) {
          const child = makeNode(applied.state, node, move, rootPlayer, node.depth + 1);
          node.children.push(child);
          node = child;
          expandedNodes += 1;
          maxTreeDepth = Math.max(maxTreeDepth, child.depth);
        }
      }
    }

    const reward = rollout(node.state, rootPlayer, variant, rolloutDepth, policy, random, rolloutCounters);
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
    if (bMean !== aMean) return bMean - aMean;
    return compareMove(a.move, b.move);
  });

  return {
    move: rankedChildren[0]?.move ?? root.untriedMoves[0] ?? null,
    diagnostics: {
      simulations,
      elapsedMs: performance.now() - started,
      rootVisits: root.visits,
      expandedNodes,
      maxTreeDepth,
      policyDrawRollouts: rolloutCounters.policyDraws,
      naturalTerminalRollouts: rolloutCounters.naturalTerminals,
      heuristicRollouts: rolloutCounters.heuristic,
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
  state: PolicyState,
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
    untriedMoves: isTerminal(state) ? [] : getLegalMoves(state.game),
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
  variant: PolicyMctsVariantV7,
  progressiveBiasWeight: number,
): Node {
  const sign = node.state.game.currentPlayer === rootPlayer ? 1 : -1;
  const parentVisits = Math.max(1, node.visits);
  let best: Node | undefined;
  let bestScore = -Infinity;

  for (const child of node.children) {
    if (child.visits === 0) return child;
    const mean = child.valueSum / child.visits;
    const explorationTerm = exploration * Math.sqrt(Math.log(parentVisits + 1) / child.visits);
    const progressiveBias = variant === "uct-pb"
      ? sign * child.prior * progressiveBiasWeight / (child.visits + 1)
      : 0;
    const score = sign * mean + explorationTerm + progressiveBias;
    if (score > bestScore || (score === bestScore && compareMove(child.move, best?.move ?? null) < 0)) {
      bestScore = score;
      best = child;
    }
  }

  if (!best) throw new Error("Policy MCTS selection reached a node without children");
  return best;
}

function chooseExpansionIndex(
  node: Node,
  rootPlayer: PlayerId,
  variant: PolicyMctsVariantV7,
  policy: RepetitionPolicy,
  random: () => number,
): number {
  if (variant === "uct") return Math.floor(random() * node.untriedMoves.length);

  const maximizing = node.state.game.currentPlayer === rootPlayer;
  let bestIndex = 0;
  let bestValue = maximizing ? -Infinity : Infinity;
  for (let index = 0; index < node.untriedMoves.length; index += 1) {
    const move = node.untriedMoves[index];
    if (!move) continue;
    const applied = applyPolicyMove(node.state, move, policy);
    if (!applied.ok) continue;
    const value = normalizedHeuristic(applied.state, rootPlayer);
    if ((maximizing && value > bestValue) || (!maximizing && value < bestValue)) {
      bestValue = value;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function rollout(
  start: PolicyState,
  rootPlayer: PlayerId,
  variant: PolicyMctsVariantV7,
  rolloutDepth: number,
  policy: RepetitionPolicy,
  random: () => number,
  counters: RolloutCounters,
): number {
  let state = start;
  for (let ply = 0; ply < rolloutDepth && !isTerminal(state); ply += 1) {
    const moves = getLegalMoves(state.game);
    if (moves.length === 0) break;
    const move = variant === "uct-pb"
      ? chooseHeuristicRolloutMove(state, moves, rootPlayer, policy, random)
      : moves[Math.floor(random() * moves.length)];
    if (!move) break;
    const applied = applyPolicyMove(state, move, policy);
    if (!applied.ok) break;
    state = applied.state;
  }

  if (state.adjudication !== null) {
    counters.policyDraws += 1;
    return 0;
  }
  if (state.game.status === "finished") {
    counters.naturalTerminals += 1;
    if (state.game.winner === rootPlayer) return 1;
    if (state.game.winner === null) return 0;
    return -1;
  }
  counters.heuristic += 1;
  return normalizedHeuristic(state, rootPlayer);
}

function chooseHeuristicRolloutMove(
  state: PolicyState,
  moves: PlayerMove[],
  rootPlayer: PlayerId,
  policy: RepetitionPolicy,
  random: () => number,
): PlayerMove | undefined {
  if (random() < 0.2) return moves[Math.floor(random() * moves.length)];
  const maximizing = state.game.currentPlayer === rootPlayer;
  let bestMove = moves[0];
  let bestValue = maximizing ? -Infinity : Infinity;
  for (const move of moves) {
    const applied = applyPolicyMove(state, move, policy);
    if (!applied.ok) continue;
    const value = normalizedHeuristic(applied.state, rootPlayer);
    if ((maximizing && value > bestValue) || (!maximizing && value < bestValue)) {
      bestValue = value;
      bestMove = move;
    }
  }
  return bestMove;
}

function normalizedHeuristic(state: PolicyState, player: PlayerId): number {
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

function isTerminal(state: PolicyState): boolean {
  return state.adjudication !== null || state.game.status === "finished";
}

function emptyDecision(started: number, counters: RolloutCounters): PolicyMctsDecisionV7 {
  return {
    move: null,
    diagnostics: {
      simulations: 0,
      elapsedMs: performance.now() - started,
      rootVisits: 0,
      expandedNodes: 0,
      maxTreeDepth: 0,
      policyDrawRollouts: counters.policyDraws,
      naturalTerminalRollouts: counters.naturalTerminals,
      heuristicRollouts: counters.heuristic,
    },
    rootStats: [],
  };
}

function moveKey(move: PlayerMove | null): string {
  return move ? `${move.pit}:${move.dir}` : "";
}

function compareMove(left: PlayerMove | null, right: PlayerMove | null): number {
  return moveKey(left).localeCompare(moveKey(right));
}
