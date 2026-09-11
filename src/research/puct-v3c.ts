import { applyMove, getLegalMoves, otherPlayer } from "../engine.js";
import type { GameState, PlayerId, PlayerMove } from "../types.js";
import { computePnSumBonuses } from "./pnsum.js";

export type PuctV3COptions = {
  simulations?: number;
  timeBudgetMs?: number;
  puctExploration?: number;
  policyTemperature?: number;
  proofBias?: number;
};

export type PuctV3CDiagnostics = {
  simulations: number;
  elapsedMs: number;
  expandedNodes: number;
  maxTreeDepth: number;
  cycleCutoffs: number;
  proofCycleBlocks: number;
  reusedRoot: boolean;
  reusedRootVisits: number;
  retainedNodes: number;
  solvedRoot: -1 | 0 | 1 | null;
  rootProofNumbers: Record<PlayerId, number | null>;
  proofBiasSelections: number;
};

export type PuctV3CMoveStat = {
  move: PlayerMove;
  visits: number;
  meanValue: number;
  prior: number;
  solvedOutcome: -1 | 0 | 1 | null;
  proofNumberForMover: number | null;
  pnSumBonus: number;
  proofBlockedFromParent: boolean;
};

export type PuctV3CDecision = {
  move: PlayerMove | null;
  diagnostics: PuctV3CDiagnostics;
  rootStats: PuctV3CMoveStat[];
};

type SolvedOutcome = -1 | 0 | 1 | null;
type ProofNumbers = Record<PlayerId, number>;

type Node = {
  key: string;
  state: GameState;
  move: PlayerMove | null;
  children: Node[];
  visits: number;
  valueSum: number;
  prior: number;
  expanded: boolean;
  solvedOutcome: SolvedOutcome;
  proofNumbers: ProofNumbers;
  /**
   * Conservative edge-local proof mask. If this node was reached through an
   * edge that closed a strategic cycle, its parent must never use this edge as
   * proof evidence. The node may later become a real reroot; the mask applies
   * only when a parent reads the child, not to the node's own subtree.
   */
  proofBlockedFromParent: boolean;
};

const DEFAULT_SIMULATIONS = 100_000;
const DEFAULT_PUCT_EXPLORATION = 1.5;
const DEFAULT_POLICY_TEMPERATURE = 0.6;
const DEFAULT_PROOF_BIAS = 0.1;
const REAL_MOVE_REUSE_PLIES = 2;
const PROOF_NUMBER_CAP = Number.MAX_SAFE_INTEGER;
const PLAYERS: readonly PlayerId[] = ["P0", "P1"];

/**
 * Experimental PNSum-PUCT V3C research session.
 *
 * V3C keeps V3A's memory-bounded two-ply tree reuse, exact W/D/L propagation,
 * and empirical cycle policy, then adds a Generalized Proof-Number PNSum bias to PUCT selection:
 *
 *   score = sign * Q + U_PUCT + Cpn * PNSum
 *
 * Proof numbers are tracked per player. At a node controlled by player p,
 * pn_p is an OR/min recurrence; at a node controlled by the other player it is
 * an AND/sum recurrence. Non-terminal frontier leaves start at 1, a terminal
 * win for p is 0, and a terminal non-win for p is infinity.
 *
 * Repeated strategic states are empirical cycle cutoffs only. A cycle-closing
 * edge is permanently masked from proof evidence in its current parent tree.
 * This is conservative across reroots: it may withhold useful proof evidence,
 * but cannot turn repetition into a false proof.
 *
 * This is an experimental PNSum adaptation of GPN-MCTS to PUCT, not the exact UCT
 * selection formula evaluated in the published GPN-MCTS paper.
 */
export class PnSumPuctV3C {
  private enginePlayer: PlayerId | null = null;
  private root: Node | null = null;

  reset(): void {
    this.enginePlayer = null;
    this.root = null;
  }

  chooseMove(state: GameState, options: PuctV3COptions = {}): PuctV3CDecision {
    const started = performance.now();
    if (this.enginePlayer === null) this.enginePlayer = state.currentPlayer;
    if (state.currentPlayer !== this.enginePlayer) {
      throw new Error(`PUCT V3C session belongs to ${this.enginePlayer}, received ${state.currentPlayer}`);
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
          proofCycleBlocks: 0,
          reusedRoot: sync.reused,
          reusedRootVisits: sync.reusedVisits,
          retainedNodes: countLookupWindowNodes(root),
          solvedRoot: root.solvedOutcome,
          rootProofNumbers: serializableProofNumbers(root.proofNumbers),
          proofBiasSelections: 0,
        },
        rootStats: [],
      };
    }

    const maxSimulations = options.simulations ?? DEFAULT_SIMULATIONS;
    const deadline = started + (options.timeBudgetMs ?? Number.POSITIVE_INFINITY);
    const exploration = options.puctExploration ?? DEFAULT_PUCT_EXPLORATION;
    const policyTemperature = options.policyTemperature ?? DEFAULT_POLICY_TEMPERATURE;
    const proofBias = options.proofBias ?? DEFAULT_PROOF_BIAS;
    if (!(exploration > 0)) throw new Error("puctExploration must be > 0");
    if (!(policyTemperature > 0)) throw new Error("policyTemperature must be > 0");
    if (!(proofBias >= 0) || !Number.isFinite(proofBias)) throw new Error("proofBias must be finite and >= 0");

    let simulations = 0;
    let expandedNodes = 0;
    let maxTreeDepth = 0;
    let cycleCutoffs = 0;
    let proofCycleBlocks = 0;
    let proofBiasSelections = 0;

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
        const selected = this.selectChild(node, exploration, proofBias, pathKeys);
        if (selected.proofBiasActive) proofBiasSelections += 1;
        const child = selected.child;
        path.push(child);
        if (pathKeys.has(child.key)) {
          if (!child.proofBlockedFromParent) {
            child.proofBlockedFromParent = true;
            proofCycleBlocks += 1;
          }
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

      if (!cycleLeaf && node.state.status === "playing" && node.solvedOutcome === null && !node.expanded) {
        const created = this.expandNode(node, policyTemperature);
        expandedNodes += created;
        if (created > 0) maxTreeDepth = Math.max(maxTreeDepth, path.length);
      }

      const reward = node.solvedOutcome ?? normalizedHeuristic(node.state, this.enginePlayer);
      for (const cursor of path) {
        cursor.visits += 1;
        cursor.valueSum += reward;
      }

      // Cyclic simulations are useful empirical samples, but never proof
      // evidence. The newly blocked edge is picked up by future cycle-free
      // proof recomputations from its parent.
      if (!cycleLeaf) {
        for (let index = path.length - 1; index >= 0; index -= 1) {
          const cursor = path[index];
          if (!cursor) continue;
          this.updateSolvedOutcome(cursor);
          updateProofNumbers(cursor);
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
    const rootProofValues = rankedChildren.map((child) =>
      child.proofBlockedFromParent || child.key === root.key
        ? Number.POSITIVE_INFINITY
        : child.proofNumbers[root.state.currentPlayer],
    );
    const rootBonuses = pnSumBonusValues(rootProofValues);
    return {
      move: rankedChildren[0]?.move ?? legalMoves[0] ?? null,
      diagnostics: {
        simulations,
        elapsedMs: performance.now() - started,
        expandedNodes,
        maxTreeDepth,
        cycleCutoffs,
        proofCycleBlocks,
        reusedRoot: sync.reused,
        reusedRootVisits: sync.reusedVisits,
        retainedNodes: countLookupWindowNodes(root),
        solvedRoot: root.solvedOutcome,
        rootProofNumbers: serializableProofNumbers(root.proofNumbers),
        proofBiasSelections,
      },
      rootStats: rankedChildren.map((child, index) => ({
        move: child.move as PlayerMove,
        visits: child.visits,
        meanValue: child.visits > 0 ? child.valueSum / child.visits : 0,
        prior: child.prior,
        solvedOutcome: child.solvedOutcome,
        proofNumberForMover: serializableProofNumber(rootProofValues[index] ?? Number.POSITIVE_INFINITY),
        pnSumBonus: rootBonuses[index] ?? 0,
        proofBlockedFromParent: child.proofBlockedFromParent,
      })),
    };
  }

  private syncRoot(state: GameState): { root: Node; reused: boolean; reusedVisits: number } {
    const key = strategicStateKey(state);
    const existing = this.root ? findBestMatchingDescendant(this.root, key, REAL_MOVE_REUSE_PLIES) : null;
    if (existing) {
      this.root = existing;
      return { root: existing, reused: true, reusedVisits: existing.visits };
    }

    const root = makeNode(state, null, 1, this.enginePlayer as PlayerId);
    this.root = root;
    return { root, reused: false, reusedVisits: 0 };
  }

  private expandNode(node: Node, policyTemperature: number): number {
    if (node.expanded || node.state.status !== "playing") return 0;
    const moves = getLegalMoves(node.state);
    const priors = heuristicPolicyPriors(node.state, moves, this.enginePlayer as PlayerId, policyTemperature);

    for (const move of moves) {
      const result = applyMove(node.state, move);
      if (!result.ok) continue;
      node.children.push(
        makeNode(
          result.state,
          move,
          priors.get(moveKey(move)) ?? 0,
          this.enginePlayer as PlayerId,
        ),
      );
    }

    node.expanded = true;
    this.updateSolvedOutcome(node);
    updateProofNumbers(node);
    return node.children.length;
  }

  private selectChild(
    node: Node,
    exploration: number,
    proofBias: number,
    pathKeys: Set<string>,
  ): { child: Node; proofBiasActive: boolean } {
    const maximizing = node.state.currentPlayer === this.enginePlayer;
    const parentVisits = Math.max(1, node.visits);
    const mover = node.state.currentPlayer;

    let hasUseful = false;
    for (const child of node.children) {
      if (maximizing ? child.solvedOutcome !== -1 : child.solvedOutcome !== 1) {
        hasUseful = true;
        break;
      }
    }

    let finiteCount = 0;
    let finiteSum = 0;
    let minFinite = Number.POSITIVE_INFINITY;
    let maxFinite = Number.NEGATIVE_INFINITY;
    let hasInfinite = false;
    for (const child of node.children) {
      if (hasUseful && !(maximizing ? child.solvedOutcome !== -1 : child.solvedOutcome !== 1)) continue;
      const proofNumber = child.proofBlockedFromParent || pathKeys.has(child.key)
        ? Number.POSITIVE_INFINITY
        : child.proofNumbers[mover];
      if (Number.isFinite(proofNumber)) {
        finiteCount += 1;
        finiteSum = Math.min(PROOF_NUMBER_CAP, finiteSum + proofNumber);
        if (proofNumber < minFinite) minFinite = proofNumber;
        if (proofNumber > maxFinite) maxFinite = proofNumber;
      } else {
        hasInfinite = true;
      }
    }

    const proofDenominator = 1 + finiteSum;
    const proofBiasActive = proofBias > 0
      && finiteCount > 0
      && (hasInfinite || maxFinite > minFinite);

    let best: Node | undefined;
    let bestScore = Number.NEGATIVE_INFINITY;
    const sign = maximizing ? 1 : -1;
    for (const child of node.children) {
      if (hasUseful && !(maximizing ? child.solvedOutcome !== -1 : child.solvedOutcome !== 1)) continue;
      const mean = child.visits > 0 ? child.valueSum / child.visits : 0;
      const explorationTerm = exploration * child.prior * Math.sqrt(parentVisits) / (1 + child.visits);
      const proofNumber = child.proofBlockedFromParent || pathKeys.has(child.key)
        ? Number.POSITIVE_INFINITY
        : child.proofNumbers[mover];
      const proofBonus = Number.isFinite(proofNumber)
        ? 1 - proofNumber / proofDenominator
        : 0;
      const score = sign * mean + explorationTerm + proofBias * proofBonus;
      if (score > bestScore) {
        bestScore = score;
        best = child;
      }
    }

    if (!best) throw new Error("PUCT V3C selection reached a node without children");
    return { child: best, proofBiasActive };
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

/**
 * Published PNSum normalization. `null` represents infinity in the
 * exported/testable API. The implementation is shared with unit tests.
 */
export { computePnSumBonuses };

function pnSumBonusValues(proofNumbers: number[]): number[] {
  return computePnSumBonuses(
    proofNumbers.map((value) => Number.isFinite(value) ? value : null),
  );
}
function updateProofNumbers(node: Node): void {
  if (node.state.status === "finished") {
    node.proofNumbers = terminalProofNumbers(node.state);
    return;
  }
  if (!node.expanded || node.children.length === 0) return;

  for (const player of PLAYERS) {
    if (node.state.currentPlayer === player) {
      let minimum = Number.POSITIVE_INFINITY;
      for (const child of node.children) {
        const value = child.proofBlockedFromParent
          ? Number.POSITIVE_INFINITY
          : child.proofNumbers[player];
        if (value < minimum) minimum = value;
      }
      node.proofNumbers[player] = minimum;
      continue;
    }

    let total = 0;
    let infinite = false;
    for (const child of node.children) {
      const value = child.proofBlockedFromParent
        ? Number.POSITIVE_INFINITY
        : child.proofNumbers[player];
      if (!Number.isFinite(value)) {
        infinite = true;
        break;
      }
      total = Math.min(PROOF_NUMBER_CAP, total + value);
    }
    node.proofNumbers[player] = infinite ? Number.POSITIVE_INFINITY : total;
  }
}

function terminalProofNumbers(state: GameState): ProofNumbers {
  return {
    P0: state.winner === "P0" ? 0 : Number.POSITIVE_INFINITY,
    P1: state.winner === "P1" ? 0 : Number.POSITIVE_INFINITY,
  };
}

function frontierProofNumbers(state: GameState): ProofNumbers {
  return state.status === "finished"
    ? terminalProofNumbers(state)
    : { P0: 1, P1: 1 };
}

function serializableProofNumber(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

function serializableProofNumbers(values: ProofNumbers): Record<PlayerId, number | null> {
  return {
    P0: serializableProofNumber(values.P0),
    P1: serializableProofNumber(values.P1),
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
  for (let depth = 0; depth <= REAL_MOVE_REUSE_PLIES && frontier.length > 0; depth += 1) {
    count += frontier.length;
    if (depth === REAL_MOVE_REUSE_PLIES) break;
    const next: Node[] = [];
    for (const node of frontier) next.push(...node.children);
    frontier = next;
  }
  return count;
}

function makeNode(
  state: GameState,
  move: PlayerMove | null,
  prior: number,
  enginePlayer: PlayerId,
): Node {
  return {
    key: strategicStateKey(state),
    state,
    move,
    children: [],
    visits: 0,
    valueSum: 0,
    prior,
    expanded: false,
    solvedOutcome: state.status === "finished" ? terminalOutcome(state, enginePlayer) : null,
    proofNumbers: frontierProofNumbers(state),
    proofBlockedFromParent: false,
  };
}

function strategicStateKey(state: GameState): string {
  const pits = state.pits
    .map((pit) => `${pit.id}:${pit.stones}:${pit.quanStones}`)
    .join(",");
  return [
    state.ruleset.canonicalRulesetId,
    state.currentPlayer,
    state.scores.P0,
    state.scores.P1,
    state.status,
    state.winner ?? "-",
    state.moveNumber === 0 ? 1 : 0,
    pits,
  ].join("|");
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
