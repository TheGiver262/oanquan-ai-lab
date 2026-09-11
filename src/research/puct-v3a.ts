import { applyMove, getLegalMoves, otherPlayer } from "../engine.js";
import type { GameState, PlayerId, PlayerMove } from "../types.js";
import { exactStrategicStateKey } from "./exact-endgame-v4.js";

export type PuctV3AOptions = {
  simulations?: number;
  timeBudgetMs?: number;
  puctExploration?: number;
  policyTemperature?: number;
};

export type PuctV3ADiagnostics = {
  simulations: number;
  elapsedMs: number;
  expandedNodes: number;
  maxTreeDepth: number;
  cycleCutoffs: number;
  reusedRoot: boolean;
  reusedRootVisits: number;
  retainedNodes: number;
  solvedRoot: -1 | 0 | 1 | null;
};

export type PuctV3AMoveStat = {
  move: PlayerMove;
  visits: number;
  meanValue: number;
  prior: number;
  solvedOutcome: -1 | 0 | 1 | null;
};

export type PuctV3ADecision = {
  move: PlayerMove | null;
  diagnostics: PuctV3ADiagnostics;
  rootStats: PuctV3AMoveStat[];
};

type SolvedOutcome = -1 | 0 | 1 | null;

type Node = {
  key: string;
  state: GameState;
  parent: Node | null;
  move: PlayerMove | null;
  children: Node[];
  visits: number;
  valueSum: number;
  prior: number;
  depth: number;
  expanded: boolean;
  solvedOutcome: SolvedOutcome;
};

const DEFAULT_SIMULATIONS = 100_000;
const DEFAULT_PUCT_EXPLORATION = 1.5;
const DEFAULT_POLICY_TEMPERATURE = 0.6;

/**
 * PUCT V3A research session.
 *
 * Differences from the stateless PUCT V2 baseline:
 * - reuses a previously explored subtree when the real game reaches it;
 * - propagates exact terminal W/D/L bounds through fully solved children;
 * - never assigns a value to repeated strategic positions: a cycle on the
 *   current simulation path is cut and heuristically evaluated, but remains
 *   unsolved because the current ruleset has no repetition adjudication.
 *
 * Proof-number bias is deliberately NOT included here. V3A is the ablation
 * baseline that isolates tree reuse + score-bounded terminal propagation.
 */
export class ReusableScoreBoundedPuct {
  private enginePlayer: PlayerId | null = null;
  private root: Node | null = null;
  private index = new Map<string, Node>();

  reset(): void {
    this.enginePlayer = null;
    this.root = null;
    this.index.clear();
  }

  chooseMove(state: GameState, options: PuctV3AOptions = {}): PuctV3ADecision {
    const started = performance.now();
    if (this.enginePlayer === null) this.enginePlayer = state.currentPlayer;
    if (state.currentPlayer !== this.enginePlayer) {
      throw new Error(`PUCT V3A session belongs to ${this.enginePlayer}, received ${state.currentPlayer}`);
    }

    const sync = this.syncRoot(state);
    const root = sync.root;
    const legalMoves = getLegalMoves(state);
    if (legalMoves.length === 0) {
      return {
        move: null,
        diagnostics: {
          simulations: 0,
          elapsedMs: performance.now() - started,
          expandedNodes: 0,
          maxTreeDepth: 0,
          cycleCutoffs: 0,
          reusedRoot: sync.reused,
          reusedRootVisits: sync.reusedVisits,
          retainedNodes: this.index.size,
          solvedRoot: root.solvedOutcome,
        },
        rootStats: [],
      };
    }

    const maxSimulations = options.simulations ?? DEFAULT_SIMULATIONS;
    const deadline = started + (options.timeBudgetMs ?? Number.POSITIVE_INFINITY);
    const exploration = options.puctExploration ?? DEFAULT_PUCT_EXPLORATION;
    const policyTemperature = options.policyTemperature ?? DEFAULT_POLICY_TEMPERATURE;
    if (!(exploration > 0)) throw new Error("puctExploration must be > 0");
    if (!(policyTemperature > 0)) throw new Error("policyTemperature must be > 0");

    let simulations = 0;
    let expandedNodes = 0;
    let maxTreeDepth = 0;
    let cycleCutoffs = 0;

    while (
      simulations < maxSimulations
      && performance.now() < deadline
      && root.solvedOutcome === null
    ) {
      let node = root;
      const path: Node[] = [root];
      const pathKeys = new Set<string>([root.key]);
      let cycleLeaf = false;

      while (
        node.state.status === "playing"
        && node.solvedOutcome === null
        && node.expanded
        && node.children.length > 0
      ) {
        const child = this.selectChild(node, exploration);
        path.push(child);
        if (pathKeys.has(child.key)) {
          node = child;
          cycleLeaf = true;
          cycleCutoffs += 1;
          break;
        }
        pathKeys.add(child.key);
        node = child;
        if (node.visits === 0) break;
      }

      if (!cycleLeaf && node.state.status === "playing" && node.solvedOutcome === null && !node.expanded) {
        const created = this.expandNode(node, policyTemperature);
        expandedNodes += created;
        maxTreeDepth = Math.max(maxTreeDepth, node.depth + (created > 0 ? 1 : 0));
      }

      const reward = node.solvedOutcome ?? normalizedHeuristic(node.state, this.enginePlayer);
      for (const cursor of path) {
        cursor.visits += 1;
        cursor.valueSum += reward;
      }

      // Cycle-cut simulations may update statistics, but they must never
      // create a solved result. The current game rules do not define a
      // repeated position as draw/win/loss.
      if (!cycleLeaf) {
        for (let index = path.length - 1; index >= 0; index -= 1) {
          const cursor = path[index];
          if (cursor) this.updateSolvedOutcome(cursor);
        }
      }
      simulations += 1;
    }

    if (!root.expanded && root.solvedOutcome === null) {
      const created = this.expandNode(root, policyTemperature);
      expandedNodes += created;
      if (created > 0) maxTreeDepth = Math.max(maxTreeDepth, 1);
    }

    const rankedChildren = this.rankRootChildren(root);
    return {
      move: rankedChildren[0]?.move ?? legalMoves[0] ?? null,
      diagnostics: {
        simulations,
        elapsedMs: performance.now() - started,
        expandedNodes,
        maxTreeDepth,
        cycleCutoffs,
        reusedRoot: sync.reused,
        reusedRootVisits: sync.reusedVisits,
        retainedNodes: this.index.size,
        solvedRoot: root.solvedOutcome,
      },
      rootStats: rankedChildren.map((child) => ({
        move: child.move as PlayerMove,
        visits: child.visits,
        meanValue: child.visits > 0 ? child.valueSum / child.visits : 0,
        prior: child.prior,
        solvedOutcome: child.solvedOutcome,
      })),
    };
  }

  private syncRoot(state: GameState): { root: Node; reused: boolean; reusedVisits: number } {
    const key = exactStrategicStateKey(state);
    const existing = this.index.get(key);
    if (existing) {
      const reusedVisits = existing.visits;
      existing.parent = null;
      existing.depth = 0;
      this.root = existing;
      this.rebuildIndex(existing);
      return { root: existing, reused: true, reusedVisits };
    }

    const root = makeNode(state, null, null, 1, 0, this.enginePlayer as PlayerId);
    this.root = root;
    this.index.clear();
    this.index.set(root.key, root);
    return { root, reused: false, reusedVisits: 0 };
  }

  private rebuildIndex(root: Node): void {
    const next = new Map<string, Node>();
    const stack: Node[] = [root];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node || next.has(node.key)) continue;
      next.set(node.key, node);
      for (const child of node.children) stack.push(child);
    }
    this.index = next;
  }

  private expandNode(node: Node, policyTemperature: number): number {
    if (node.expanded || node.state.status !== "playing") return 0;
    const moves = getLegalMoves(node.state);
    const priors = heuristicPolicyPriors(node.state, moves, this.enginePlayer as PlayerId, policyTemperature);
    for (const move of moves) {
      const result = applyMove(node.state, move);
      if (!result.ok) continue;
      const child = makeNode(
        result.state,
        node,
        move,
        priors.get(moveKey(move)) ?? 0,
        node.depth + 1,
        this.enginePlayer as PlayerId,
      );
      node.children.push(child);
      // Keep the first in-tree representative. Duplicate keys can exist in a
      // loopy graph; the path-level cycle check remains authoritative.
      if (!this.index.has(child.key)) this.index.set(child.key, child);
    }
    node.expanded = true;
    this.updateSolvedOutcome(node);
    return node.children.length;
  }

  private selectChild(node: Node, exploration: number): Node {
    const player = this.enginePlayer as PlayerId;
    const maximizing = node.state.currentPlayer === player;
    const parentVisits = Math.max(1, node.visits);

    // Score bounds: once a child is exactly known to be the worst possible
    // result for the side to move, do not spend visits there while a child
    // with a potentially better bound remains.
    const useful = node.children.filter((child) => {
      if (maximizing) return child.solvedOutcome !== -1;
      return child.solvedOutcome !== 1;
    });
    const candidates = useful.length > 0 ? useful : node.children;

    let best = candidates[0];
    let bestScore = Number.NEGATIVE_INFINITY;
    const sign = maximizing ? 1 : -1;
    for (const child of candidates) {
      const mean = child.visits > 0 ? child.valueSum / child.visits : 0;
      const explorationTerm = exploration * child.prior * Math.sqrt(parentVisits) / (1 + child.visits);
      const score = sign * mean + explorationTerm;
      if (score > bestScore) {
        bestScore = score;
        best = child;
      }
    }
    if (!best) throw new Error("PUCT V3A selection reached a node without children");
    return best;
  }

  private updateSolvedOutcome(node: Node): void {
    if (node.state.status === "finished") {
      node.solvedOutcome = terminalOutcome(node.state, this.enginePlayer as PlayerId);
      return;
    }
    if (!node.expanded || node.children.length === 0) return;

    const maximizing = node.state.currentPlayer === this.enginePlayer;
    if (maximizing) {
      if (node.children.some((child) => child.solvedOutcome === 1)) {
        node.solvedOutcome = 1;
        return;
      }
      if (node.children.every((child) => child.solvedOutcome !== null)) {
        node.solvedOutcome = node.children.some((child) => child.solvedOutcome === 0) ? 0 : -1;
      }
      return;
    }

    if (node.children.some((child) => child.solvedOutcome === -1)) {
      node.solvedOutcome = -1;
      return;
    }
    if (node.children.every((child) => child.solvedOutcome !== null)) {
      node.solvedOutcome = node.children.some((child) => child.solvedOutcome === 0) ? 0 : 1;
    }
  }

  private rankRootChildren(root: Node): Node[] {
    return [...root.children].sort((left, right) => {
      const leftSolved = left.solvedOutcome ?? -2;
      const rightSolved = right.solvedOutcome ?? -2;
      if (leftSolved !== rightSolved && (left.solvedOutcome !== null || right.solvedOutcome !== null)) {
        if (left.solvedOutcome === 1) return -1;
        if (right.solvedOutcome === 1) return 1;
      }
      if (right.visits !== left.visits) return right.visits - left.visits;
      const leftMean = left.visits > 0 ? left.valueSum / left.visits : Number.NEGATIVE_INFINITY;
      const rightMean = right.visits > 0 ? right.valueSum / right.visits : Number.NEGATIVE_INFINITY;
      if (rightMean !== leftMean) return rightMean - leftMean;
      return right.prior - left.prior;
    });
  }
}

function makeNode(
  state: GameState,
  parent: Node | null,
  move: PlayerMove | null,
  prior: number,
  depth: number,
  enginePlayer: PlayerId,
): Node {
  return {
    key: exactStrategicStateKey(state),
    state,
    parent,
    move,
    children: [],
    visits: 0,
    valueSum: 0,
    prior,
    depth,
    expanded: false,
    solvedOutcome: state.status === "finished" ? terminalOutcome(state, enginePlayer) : null,
  };
}

function terminalOutcome(state: GameState, player: PlayerId): -1 | 0 | 1 {
  if (state.winner === player) return 1;
  if (state.winner === null) return 0;
  return -1;
}

function heuristicPolicyPriors(
  state: GameState,
  moves: PlayerMove[],
  enginePlayer: PlayerId,
  policyTemperature: number,
): Map<string, number> {
  if (moves.length === 0) return new Map();
  const sign = state.currentPlayer === enginePlayer ? 1 : -1;
  const scored = moves.map((move) => {
    const result = applyMove(state, move);
    const score = result.ok ? sign * normalizedHeuristic(result.state, enginePlayer) : -1;
    return { move, score };
  });
  const maxScore = Math.max(...scored.map((entry) => entry.score));
  const weights = scored.map((entry) => Math.exp((entry.score - maxScore) / policyTemperature));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const uniform = 1 / moves.length;
  return new Map(
    scored.map((entry, index) => [
      moveKey(entry.move),
      total > 0 && Number.isFinite(total) ? (weights[index] ?? 0) / total : uniform,
    ]),
  );
}

function normalizedHeuristic(state: GameState, player: PlayerId): number {
  if (state.status === "finished") return terminalOutcome(state, player);
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

function moveKey(move: PlayerMove): string {
  return `${move.pit}:${move.dir}`;
}
