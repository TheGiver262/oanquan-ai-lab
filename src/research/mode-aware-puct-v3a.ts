import { otherPlayer } from "../engine.js";
import type { GameState, PlayerId } from "../types.js";
import {
  applyBalanceAction,
  balanceActionKey,
  currentAgent,
  getBalanceActions,
  seatForAgent,
  winnerAgent,
  type BalanceAction,
  type BalanceState,
  type ResearchAgentId,
} from "./balance-modes.js";

export type ModeAwarePuctV3AOptions = {
  simulations?: number;
  timeBudgetMs?: number;
  puctExploration?: number;
  policyTemperature?: number;
};

export type ModeAwarePuctV3ADiagnostics = {
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

export type ModeAwarePuctV3AActionStat = {
  action: BalanceAction;
  visits: number;
  meanValue: number;
  prior: number;
  solvedOutcome: -1 | 0 | 1 | null;
};

export type ModeAwarePuctV3ADecision = {
  action: BalanceAction | null;
  diagnostics: ModeAwarePuctV3ADiagnostics;
  rootStats: ModeAwarePuctV3AActionStat[];
};

type SolvedOutcome = -1 | 0 | 1 | null;

type Node = {
  key: string;
  state: BalanceState;
  action: BalanceAction | null;
  children: Node[];
  visits: number;
  valueSum: number;
  prior: number;
  expanded: boolean;
  solvedOutcome: SolvedOutcome;
};

const DEFAULT_SIMULATIONS = 100_000;
const DEFAULT_PUCT_EXPLORATION = 1.5;
const DEFAULT_POLICY_TEMPERATURE = 0.6;
const REAL_ACTION_REUSE_PLIES = 2;

/**
 * PUCT V3A adapted to product-mode state.
 *
 * Search math intentionally mirrors ReusableScoreBoundedPuct:
 * - PUCT selection with heuristic policy priors;
 * - two-action bounded subtree reuse;
 * - conservative exact terminal W/D/L propagation;
 * - cycle cutoff without declaring a draw.
 *
 * The only semantic change is perspective. The engine owns research agent A/B,
 * not a fixed logical seat P0/P1. This is required for Pie variants because a
 * SWAP changes seat ownership without changing the board or logical side to move.
 */
export class ModeAwarePuctV3A {
  private engineAgent: ResearchAgentId | null = null;
  private root: Node | null = null;

  reset(): void {
    this.engineAgent = null;
    this.root = null;
  }

  chooseAction(state: BalanceState, options: ModeAwarePuctV3AOptions = {}): ModeAwarePuctV3ADecision {
    const started = performance.now();
    if (this.engineAgent === null) this.engineAgent = currentAgent(state);
    if (currentAgent(state) !== this.engineAgent) {
      throw new Error(`Mode-aware PUCT V3A session belongs to agent ${this.engineAgent}, received ${currentAgent(state)}`);
    }

    const sync = this.syncRoot(state);
    const root = sync.root;
    const legalActions = getBalanceActions(state);
    if (legalActions.length === 0) {
      return {
        action: null,
        diagnostics: {
          simulations: 0,
          elapsedMs: performance.now() - started,
          expandedNodes: 0,
          maxTreeDepth: 0,
          cycleCutoffs: 0,
          reusedRoot: sync.reused,
          reusedRootVisits: sync.reusedVisits,
          retainedNodes: countLookupWindowNodes(root),
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
        node.state.game.status === "playing"
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

      maxTreeDepth = Math.max(maxTreeDepth, path.length - 1);

      if (!cycleLeaf && node.state.game.status === "playing" && node.solvedOutcome === null && !node.expanded) {
        const created = this.expandNode(node, policyTemperature);
        expandedNodes += created;
        if (created > 0) maxTreeDepth = Math.max(maxTreeDepth, path.length);
      }

      const reward = node.solvedOutcome ?? normalizedAgentHeuristic(node.state, this.engineAgent);
      for (const cursor of path) {
        cursor.visits += 1;
        cursor.valueSum += reward;
      }

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
      action: rankedChildren[0]?.action ?? legalActions[0] ?? null,
      diagnostics: {
        simulations,
        elapsedMs: performance.now() - started,
        expandedNodes,
        maxTreeDepth,
        cycleCutoffs,
        reusedRoot: sync.reused,
        reusedRootVisits: sync.reusedVisits,
        retainedNodes: countLookupWindowNodes(root),
        solvedRoot: root.solvedOutcome,
      },
      rootStats: rankedChildren.map((child) => ({
        action: child.action as BalanceAction,
        visits: child.visits,
        meanValue: child.visits > 0 ? child.valueSum / child.visits : 0,
        prior: child.prior,
        solvedOutcome: child.solvedOutcome,
      })),
    };
  }

  private syncRoot(state: BalanceState): { root: Node; reused: boolean; reusedVisits: number } {
    const key = strategicBalanceStateKey(state);
    const existing = this.root ? findBestMatchingDescendant(this.root, key, REAL_ACTION_REUSE_PLIES) : null;
    if (existing) {
      this.root = existing;
      return { root: existing, reused: true, reusedVisits: existing.visits };
    }

    const root = makeNode(state, null, 1, this.engineAgent as ResearchAgentId);
    this.root = root;
    return { root, reused: false, reusedVisits: 0 };
  }

  private expandNode(node: Node, policyTemperature: number): number {
    if (node.expanded || node.state.game.status !== "playing") return 0;
    const actions = getBalanceActions(node.state);
    const priors = heuristicPolicyPriors(node.state, actions, this.engineAgent as ResearchAgentId, policyTemperature);

    for (const action of actions) {
      const result = applyBalanceAction(node.state, action);
      if (!result.ok) continue;
      node.children.push(
        makeNode(
          result.state,
          action,
          priors.get(balanceActionKey(action)) ?? 0,
          this.engineAgent as ResearchAgentId,
        ),
      );
    }

    node.expanded = true;
    this.updateSolvedOutcome(node);
    return node.children.length;
  }

  private selectChild(node: Node, exploration: number): Node {
    const maximizing = currentAgent(node.state) === this.engineAgent;
    const parentVisits = Math.max(1, node.visits);
    const useful = node.children.filter((child) => maximizing ? child.solvedOutcome !== -1 : child.solvedOutcome !== 1);
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

    if (!best) throw new Error("Mode-aware PUCT V3A selection reached a node without children");
    return best;
  }

  private updateSolvedOutcome(node: Node): void {
    if (node.state.game.status === "finished") {
      node.solvedOutcome = terminalAgentOutcome(node.state, this.engineAgent as ResearchAgentId);
      return;
    }
    if (!node.expanded || node.children.length === 0) return;

    const maximizing = currentAgent(node.state) === this.engineAgent;
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
      if (root.solvedOutcome !== null) {
        const leftSolved = left.solvedOutcome ?? -2;
        const rightSolved = right.solvedOutcome ?? -2;
        if (rightSolved !== leftSolved) return rightSolved - leftSolved;
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
  state: BalanceState,
  action: BalanceAction | null,
  prior: number,
  engineAgent: ResearchAgentId,
): Node {
  return {
    key: strategicBalanceStateKey(state),
    state,
    action,
    children: [],
    visits: 0,
    valueSum: 0,
    prior,
    expanded: false,
    solvedOutcome: state.game.status === "finished" ? terminalAgentOutcome(state, engineAgent) : null,
  };
}

function findBestMatchingDescendant(root: Node, key: string, maxDepth: number): Node | null {
  let best: Node | null = null;
  let frontier: Node[] = [root];
  for (let depth = 0; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const next: Node[] = [];
    for (const node of frontier) {
      if (node.key === key && (!best || node.visits > best.visits)) best = node;
      if (depth < maxDepth) next.push(...node.children);
    }
    frontier = next;
  }
  return best;
}

function countLookupWindowNodes(root: Node): number {
  let count = 0;
  let frontier: Node[] = [root];
  for (let depth = 0; depth <= REAL_ACTION_REUSE_PLIES && frontier.length > 0; depth += 1) {
    count += frontier.length;
    if (depth === REAL_ACTION_REUSE_PLIES) break;
    const next: Node[] = [];
    for (const node of frontier) next.push(...node.children);
    frontier = next;
  }
  return count;
}

function strategicBalanceStateKey(state: BalanceState): string {
  const game = state.game;
  const pits = game.pits.map((pit) => `${pit.id}:${pit.stones}:${pit.quanStones}`).join(",");
  const repeat = game.ruleset.repetitionPolicy === "threefold"
    ? game.recentMoves.map((move) => `${move.player}:${move.pit}:${move.dir}`).join(",")
    : "-";
  return [
    game.ruleset.canonicalRulesetId,
    state.mode,
    `P0=${state.seatToAgent.P0}`,
    `P1=${state.seatToAgent.P1}`,
    `swap=${state.swap.enabled ? 1 : 0}:${state.swap.used ? 1 : 0}:${state.swap.responderNormalMovesTaken}:${state.swap.maxResponderNormalMovesBeforeExpiry ?? "open"}`,
    game.currentPlayer,
    game.scores.P0,
    game.scores.P1,
    game.status,
    game.winner ?? "-",
    game.moveNumber === 0 ? 1 : 0,
    `repeat=${repeat}`,
    pits,
  ].join("|");
}

function terminalAgentOutcome(state: BalanceState, agent: ResearchAgentId): -1 | 0 | 1 {
  const winner = winnerAgent(state);
  if (winner === agent) return 1;
  if (winner === null) return 0;
  return -1;
}

function heuristicPolicyPriors(
  state: BalanceState,
  actions: BalanceAction[],
  engineAgent: ResearchAgentId,
  policyTemperature: number,
): Map<string, number> {
  if (actions.length === 0) return new Map();
  const sign = currentAgent(state) === engineAgent ? 1 : -1;
  const scored = actions.map((action) => {
    const result = applyBalanceAction(state, action);
    const score = result.ok ? sign * normalizedAgentHeuristic(result.state, engineAgent) : -1;
    return { action, score };
  });
  const maxScore = Math.max(...scored.map((entry) => entry.score));
  const weights = scored.map((entry) => Math.exp((entry.score - maxScore) / policyTemperature));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const uniform = 1 / actions.length;
  return new Map(
    scored.map((entry, index) => [
      balanceActionKey(entry.action),
      total > 0 && Number.isFinite(total) ? (weights[index] ?? 0) / total : uniform,
    ]),
  );
}

function normalizedAgentHeuristic(state: BalanceState, agent: ResearchAgentId): number {
  if (state.game.status === "finished") return terminalAgentOutcome(state, agent);
  const seat = seatForAgent(state, agent);
  const opponentSeat = otherPlayer(seat);
  const scoreDelta = state.game.scores[seat] - state.game.scores[opponentSeat];
  const sideDelta = sideStones(state.game, seat) - sideStones(state.game, opponentSeat);
  const mobilityDelta = playablePits(state.game, seat) - playablePits(state.game, opponentSeat);
  const refillDelta = refillSafety(state.game, seat) - refillSafety(state.game, opponentSeat);
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
