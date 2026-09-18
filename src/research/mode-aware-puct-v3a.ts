import { otherPlayer } from "../engine.js";
import type { DanPitId, Direction, GameState, PitId, PlayerId } from "../types.js";
import {
  applyBalanceAction,
  balanceActionKey,
  currentAgent,
  getBalanceActions,
  positionalHistoryContextKey,
  reflectPositionalHistory,
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
  /**
   * Diagnostics-only. Records how leaf rewards contributing to each root child
   * were produced. This must not alter selection, expansion, backup or ranking.
   */
  auditRootLeaves?: boolean;
  /**
   * Research-only leaf-value ablation. The incumbent V3A value is 1.8.
   * This coefficient affects leaf evaluation only; policy priors stay frozen
   * to the incumbent 1.8 score weight so experiments isolate value estimation.
   */
  leafScoreWeight?: number;
  /**
   * Research-only leaf bootstrap. "static" is incumbent V3A. "one_ply"
   * evaluates the already-expanded child states with a one-ply max/min backup.
   * It does not alter priors, tree selection, exact solved propagation or
   * final root ranking.
   */
  leafBootstrap?: "static" | "one_ply" | "unstable_one_ply" | "unstable_refutation_only" | "unstable_opponent_refutation_only";
  /**
   * V4 research-only selective-quiescence trigger. For unstable_one_ply,
   * bootstrap through already-expanded children only when an immediate child
   * changes the engine-agent score delta by at least this many points, or when
   * an exact solved/terminal child is present.
   */
  leafQuiescenceScoreSwing?: number;
  /**
   * Research-only phase gate for the leaf score term. When finite, scoreDelta
   * contributes only when raw board material (dan stones + quan stones) is at
   * or below this threshold. Infinity reproduces incumbent V3A.
   */
  leafScoreMaterialMax?: number;
};

export type ModeAwarePuctV3ALeafSource =
  | "cycle"
  | "terminal"
  | "solved_nonterminal"
  | "heuristic";

export type ModeAwarePuctV3ALeafAuditBucket = {
  count: number;
  rewardSum: number;
  meanReward: number;
  minReward: number | null;
  maxReward: number | null;
  depthSum: number;
  meanDepth: number;
};

export type ModeAwarePuctV3ARootLeafAudit = {
  action: BalanceAction;
  replies: Array<{
    action: BalanceAction;
    visits: number;
    meanValue: number;
    prior: number;
    solvedOutcome: -1 | 0 | 1 | null;
  }>;
  total: ModeAwarePuctV3ALeafAuditBucket;
  cycle: ModeAwarePuctV3ALeafAuditBucket;
  terminal: ModeAwarePuctV3ALeafAuditBucket;
  solvedNonterminal: ModeAwarePuctV3ALeafAuditBucket;
  heuristic: ModeAwarePuctV3ALeafAuditBucket;
  terminalWins: number;
  terminalDraws: number;
  terminalLosses: number;
  heuristicComponents: {
    count: number;
    meanScoreDelta: number;
    meanSideDelta: number;
    meanMobilityDelta: number;
    meanRefillDelta: number;
    meanMaterial: number;
    meanValue: number;
  };
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
  rootLeafAudit?: ModeAwarePuctV3ARootLeafAudit[];
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

type MutableLeafBucket = {
  count: number;
  rewardSum: number;
  minReward: number;
  maxReward: number;
  depthSum: number;
};

type MutableRootLeafAudit = {
  total: MutableLeafBucket;
  cycle: MutableLeafBucket;
  terminal: MutableLeafBucket;
  solvedNonterminal: MutableLeafBucket;
  heuristic: MutableLeafBucket;
  terminalWins: number;
  terminalDraws: number;
  terminalLosses: number;
  heuristicComponentCount: number;
  heuristicScoreDeltaSum: number;
  heuristicSideDeltaSum: number;
  heuristicMobilityDeltaSum: number;
  heuristicRefillDeltaSum: number;
  heuristicMaterialSum: number;
  heuristicValueSum: number;
};

const DEFAULT_SIMULATIONS = 100_000;
const DEFAULT_PUCT_EXPLORATION = 1.5;
const DEFAULT_POLICY_TEMPERATURE = 0.6;
const DEFAULT_LEAF_SCORE_WEIGHT = 1.8;
const DEFAULT_LEAF_BOOTSTRAP: "static" | "one_ply" | "unstable_one_ply" | "unstable_refutation_only" | "unstable_opponent_refutation_only" = "static";
const DEFAULT_LEAF_QUIESCENCE_SCORE_SWING = 10;
const REAL_ACTION_REUSE_PLIES = 2;

const REFLECT_PIT: Readonly<Record<PitId, PitId>> = Object.freeze({
  L: "R",
  R: "L",
  T1: "T5",
  T2: "T4",
  T3: "T3",
  T4: "T2",
  T5: "T1",
  B1: "B5",
  B2: "B4",
  B3: "B3",
  B4: "B2",
  B5: "B1",
});

/**
 * PUCT V3A adapted to product-mode state.
 *
 * Search math intentionally mirrors ReusableScoreBoundedPuct:
 * - PUCT selection with heuristic policy priors;
 * - two-action bounded subtree reuse;
 * - conservative exact terminal W/D/L propagation;
 * - cycle cutoff without declaring a draw.
 *
 * Product-mode search additionally canonicalizes the left/right reflection of
 * every externally supplied root. This removes arbitrary B1->B5 / CW->CCW
 * action-order bias from mirrored positions while leaving the underlying PUCT
 * selection, heuristic and exact terminal propagation unchanged.
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
    const canonical = canonicalizeBalanceStateForSearch(state);
    const searchState = canonical.state;
    if (this.engineAgent === null) this.engineAgent = currentAgent(searchState);
    if (currentAgent(searchState) !== this.engineAgent) {
      throw new Error(`Mode-aware PUCT V3A session belongs to agent ${this.engineAgent}, received ${currentAgent(searchState)}`);
    }

    const sync = this.syncRoot(searchState);
    const root = sync.root;
    const legalActions = getBalanceActions(searchState);
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
    const leafScoreWeight = options.leafScoreWeight ?? DEFAULT_LEAF_SCORE_WEIGHT;
    const leafBootstrap = options.leafBootstrap ?? DEFAULT_LEAF_BOOTSTRAP;
    const leafQuiescenceScoreSwing =
      options.leafQuiescenceScoreSwing ?? DEFAULT_LEAF_QUIESCENCE_SCORE_SWING;
    const leafScoreMaterialMax = options.leafScoreMaterialMax ?? Number.POSITIVE_INFINITY;
    if (!(exploration > 0)) throw new Error("puctExploration must be > 0");
    if (!(policyTemperature > 0)) throw new Error("policyTemperature must be > 0");
    if (!Number.isFinite(leafScoreWeight) || leafScoreWeight < 0) {
      throw new Error("leafScoreWeight must be a finite non-negative number");
    }
    if (!(leafScoreMaterialMax >= 0)) {
      throw new Error("leafScoreMaterialMax must be a non-negative number");
    }
    if (!Number.isFinite(leafQuiescenceScoreSwing) || leafQuiescenceScoreSwing < 0) {
      throw new Error("leafQuiescenceScoreSwing must be a finite non-negative number");
    }

    let simulations = 0;
    let expandedNodes = 0;
    let maxTreeDepth = 0;
    let cycleCutoffs = 0;
    const rootLeafAudit = options.auditRootLeaves
      ? new Map<Node, MutableRootLeafAudit>()
      : null;

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

      const reward = node.solvedOutcome ?? (
        cycleLeaf
          ? normalizedAgentHeuristic(
              node.state,
              this.engineAgent,
              effectiveLeafScoreWeight(node.state, leafScoreWeight, leafScoreMaterialMax),
            )
          : heuristicLeafReward(
              node,
              this.engineAgent as ResearchAgentId,
              leafScoreWeight,
              leafScoreMaterialMax,
              leafBootstrap,
              leafQuiescenceScoreSwing,
            )
      );
      if (rootLeafAudit && path.length > 1) {
        const rootChild = path[1];
        if (rootChild) {
          const source: ModeAwarePuctV3ALeafSource = cycleLeaf
            ? "cycle"
            : node.state.game.status === "finished"
              ? "terminal"
              : node.solvedOutcome !== null
                ? "solved_nonterminal"
                : "heuristic";
          recordRootLeafAudit(
            rootLeafAudit,
            rootChild,
            source,
            reward,
            path.length - 1,
            node.state.game.status === "finished" ? node.solvedOutcome : null,
            node.state,
            this.engineAgent as ResearchAgentId,
            effectiveLeafScoreWeight(node.state, leafScoreWeight, leafScoreMaterialMax),
          );
        }
      }
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
    const toCaller = (action: BalanceAction): BalanceAction => canonical.reflected ? reflectBalanceAction(action) : action;
    const selected = rankedChildren[0]?.action ?? legalActions[0] ?? null;
    return {
      action: selected ? toCaller(selected) : null,
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
        action: toCaller(child.action as BalanceAction),
        visits: child.visits,
        meanValue: child.visits > 0 ? child.valueSum / child.visits : 0,
        prior: child.prior,
        solvedOutcome: child.solvedOutcome,
      })),
      ...(rootLeafAudit
        ? {
            rootLeafAudit: rankedChildren.map((child) =>
              serializeRootLeafAudit(
                child,
                toCaller,
                rootLeafAudit.get(child) ?? makeMutableRootLeafAudit(),
              ),
            ),
          }
        : {}),
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

function makeMutableLeafBucket(): MutableLeafBucket {
  return {
    count: 0,
    rewardSum: 0,
    minReward: Number.POSITIVE_INFINITY,
    maxReward: Number.NEGATIVE_INFINITY,
    depthSum: 0,
  };
}

function makeMutableRootLeafAudit(): MutableRootLeafAudit {
  return {
    total: makeMutableLeafBucket(),
    cycle: makeMutableLeafBucket(),
    terminal: makeMutableLeafBucket(),
    solvedNonterminal: makeMutableLeafBucket(),
    heuristic: makeMutableLeafBucket(),
    terminalWins: 0,
    terminalDraws: 0,
    terminalLosses: 0,
    heuristicComponentCount: 0,
    heuristicScoreDeltaSum: 0,
    heuristicSideDeltaSum: 0,
    heuristicMobilityDeltaSum: 0,
    heuristicRefillDeltaSum: 0,
    heuristicMaterialSum: 0,
    heuristicValueSum: 0,
  };
}

function addLeafSample(bucket: MutableLeafBucket, reward: number, depth: number): void {
  bucket.count += 1;
  bucket.rewardSum += reward;
  bucket.depthSum += depth;
  bucket.minReward = Math.min(bucket.minReward, reward);
  bucket.maxReward = Math.max(bucket.maxReward, reward);
}

function recordRootLeafAudit(
  audits: Map<Node, MutableRootLeafAudit>,
  child: Node,
  source: ModeAwarePuctV3ALeafSource,
  reward: number,
  depth: number,
  terminalOutcomeValue: SolvedOutcome,
  leafState: BalanceState,
  engineAgent: ResearchAgentId,
  leafScoreWeight: number,
): void {
  let audit = audits.get(child);
  if (!audit) {
    audit = makeMutableRootLeafAudit();
    audits.set(child, audit);
  }
  addLeafSample(audit.total, reward, depth);
  if (source === "cycle") addLeafSample(audit.cycle, reward, depth);
  else if (source === "terminal") addLeafSample(audit.terminal, reward, depth);
  else if (source === "solved_nonterminal") addLeafSample(audit.solvedNonterminal, reward, depth);
  else {
    addLeafSample(audit.heuristic, reward, depth);
    const breakdown = agentHeuristicBreakdown(leafState, engineAgent, leafScoreWeight);
    audit.heuristicComponentCount += 1;
    audit.heuristicScoreDeltaSum += breakdown.scoreDelta;
    audit.heuristicSideDeltaSum += breakdown.sideDelta;
    audit.heuristicMobilityDeltaSum += breakdown.mobilityDelta;
    audit.heuristicRefillDeltaSum += breakdown.refillDelta;
    audit.heuristicMaterialSum += breakdown.material;
    audit.heuristicValueSum += breakdown.value;
  }

  if (source === "terminal") {
    if (terminalOutcomeValue === 1) audit.terminalWins += 1;
    else if (terminalOutcomeValue === 0) audit.terminalDraws += 1;
    else if (terminalOutcomeValue === -1) audit.terminalLosses += 1;
  }
}

function serializeLeafBucket(bucket: MutableLeafBucket): ModeAwarePuctV3ALeafAuditBucket {
  return {
    count: bucket.count,
    rewardSum: bucket.rewardSum,
    meanReward: bucket.count > 0 ? bucket.rewardSum / bucket.count : 0,
    minReward: bucket.count > 0 ? bucket.minReward : null,
    maxReward: bucket.count > 0 ? bucket.maxReward : null,
    depthSum: bucket.depthSum,
    meanDepth: bucket.count > 0 ? bucket.depthSum / bucket.count : 0,
  };
}

function serializeRootLeafAudit(
  child: Node,
  toCaller: (action: BalanceAction) => BalanceAction,
  audit: MutableRootLeafAudit,
): ModeAwarePuctV3ARootLeafAudit {
  const replies = [...child.children]
    .sort((left, right) => right.visits - left.visits)
    .map((reply) => ({
      action: toCaller(reply.action as BalanceAction),
      visits: reply.visits,
      meanValue: reply.visits > 0 ? reply.valueSum / reply.visits : 0,
      prior: reply.prior,
      solvedOutcome: reply.solvedOutcome,
    }));
  return {
    action: toCaller(child.action as BalanceAction),
    replies,
    total: serializeLeafBucket(audit.total),
    cycle: serializeLeafBucket(audit.cycle),
    terminal: serializeLeafBucket(audit.terminal),
    solvedNonterminal: serializeLeafBucket(audit.solvedNonterminal),
    heuristic: serializeLeafBucket(audit.heuristic),
    terminalWins: audit.terminalWins,
    terminalDraws: audit.terminalDraws,
    terminalLosses: audit.terminalLosses,
    heuristicComponents: {
      count: audit.heuristicComponentCount,
      meanScoreDelta: audit.heuristicComponentCount > 0 ? audit.heuristicScoreDeltaSum / audit.heuristicComponentCount : 0,
      meanSideDelta: audit.heuristicComponentCount > 0 ? audit.heuristicSideDeltaSum / audit.heuristicComponentCount : 0,
      meanMobilityDelta: audit.heuristicComponentCount > 0 ? audit.heuristicMobilityDeltaSum / audit.heuristicComponentCount : 0,
      meanRefillDelta: audit.heuristicComponentCount > 0 ? audit.heuristicRefillDeltaSum / audit.heuristicComponentCount : 0,
      meanMaterial: audit.heuristicComponentCount > 0 ? audit.heuristicMaterialSum / audit.heuristicComponentCount : 0,
      meanValue: audit.heuristicComponentCount > 0 ? audit.heuristicValueSum / audit.heuristicComponentCount : 0,
    },
  };
}

export function reflectBalanceAction(action: BalanceAction): BalanceAction {
  if (action.kind === "swap") return { ...action };
  return {
    kind: "move",
    move: {
      ...action.move,
      pit: reflectDanPitId(action.move.pit),
      dir: reflectDirection(action.move.dir),
    },
  };
}

export function reflectBalanceStateForSearch(state: BalanceState): BalanceState {
  const byId = new Map(state.game.pits.map((pit) => [pit.id, pit] as const));
  const pits = state.game.pits.map((targetPit) => {
    const source = byId.get(reflectPitId(targetPit.id));
    if (!source) throw new Error(`Reflection source missing for pit ${targetPit.id}`);
    return { ...source, id: targetPit.id };
  });
  const recentMoves = state.game.recentMoves.map((move) => ({
    ...move,
    pit: reflectDanPitId(move.pit),
    dir: reflectDirection(move.dir),
  }));
  return {
    ...state,
    game: {
      ...state.game,
      pits,
      recentMoves,
    },
    positionalHistory: reflectPositionalHistory(state.positionalHistory),
  };
}

export function canonicalizeBalanceStateForSearch(state: BalanceState): { state: BalanceState; reflected: boolean } {
  const reflected = reflectBalanceStateForSearch(state);
  const directKey = strategicBalanceStateKey(state);
  const reflectedKey = strategicBalanceStateKey(reflected);
  return reflectedKey < directKey
    ? { state: reflected, reflected: true }
    : { state, reflected: false };
}

function reflectPitId(id: PitId): PitId {
  return REFLECT_PIT[id];
}

function reflectDanPitId(id: DanPitId): DanPitId {
  return REFLECT_PIT[id] as DanPitId;
}

function reflectDirection(direction: Direction): Direction {
  return direction === "CW" ? "CCW" : "CW";
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
  const positionalRepeat = positionalHistoryContextKey(state.positionalHistory);
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
    `posrepeat=${positionalRepeat}`,
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
    // Keep policy priors frozen to incumbent V3A. leafScoreWeight is a
    // value-estimation experiment only and must not alter action priors.
    const score = result.ok
      ? sign * normalizedAgentHeuristic(result.state, engineAgent, DEFAULT_LEAF_SCORE_WEIGHT)
      : -1;
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

function agentHeuristicBreakdown(
  state: BalanceState,
  agent: ResearchAgentId,
  scoreWeight = DEFAULT_LEAF_SCORE_WEIGHT,
): {
  scoreDelta: number;
  sideDelta: number;
  mobilityDelta: number;
  refillDelta: number;
  material: number;
  value: number;
} {
  if (state.game.status === "finished") {
    const value = terminalAgentOutcome(state, agent);
    return {
      scoreDelta: 0,
      sideDelta: 0,
      mobilityDelta: 0,
      refillDelta: 0,
      material: value === 0 ? 0 : value * Number.POSITIVE_INFINITY,
      value,
    };
  }
  const seat = seatForAgent(state, agent);
  const opponentSeat = otherPlayer(seat);
  const scoreDelta = state.game.scores[seat] - state.game.scores[opponentSeat];
  const sideDelta = sideStones(state.game, seat) - sideStones(state.game, opponentSeat);
  const mobilityDelta = playablePits(state.game, seat) - playablePits(state.game, opponentSeat);
  const refillDelta = refillSafety(state.game, seat) - refillSafety(state.game, opponentSeat);
  const material = scoreDelta * scoreWeight + sideDelta * 0.45 + mobilityDelta * 0.8 + refillDelta * 2.5;
  return {
    scoreDelta,
    sideDelta,
    mobilityDelta,
    refillDelta,
    material,
    value: Math.tanh(material / 18),
  };
}

function normalizedAgentHeuristic(
  state: BalanceState,
  agent: ResearchAgentId,
  scoreWeight = DEFAULT_LEAF_SCORE_WEIGHT,
): number {
  return agentHeuristicBreakdown(state, agent, scoreWeight).value;
}

function effectiveLeafScoreWeight(
  state: BalanceState,
  baseWeight: number,
  scoreMaterialMax: number,
): number {
  if (!Number.isFinite(scoreMaterialMax)) return baseWeight;
  return rawBoardMaterial(state.game) <= scoreMaterialMax ? baseWeight : 0;
}

function rawBoardMaterial(state: GameState): number {
  return state.pits.reduce((sum, pit) => sum + pit.stones + pit.quanStones, 0);
}

function heuristicLeafReward(
  node: Node,
  engineAgent: ResearchAgentId,
  scoreWeight: number,
  scoreMaterialMax: number,
  bootstrap: "static" | "one_ply" | "unstable_one_ply" | "unstable_refutation_only" | "unstable_opponent_refutation_only",
  quiescenceScoreSwing: number,
): number {
  const staticWeight = effectiveLeafScoreWeight(node.state, scoreWeight, scoreMaterialMax);
  const staticValue = normalizedAgentHeuristic(node.state, engineAgent, staticWeight);
  if (bootstrap === "static" || node.children.length === 0) return staticValue;
  if (
    (
      bootstrap === "unstable_one_ply"
      || bootstrap === "unstable_refutation_only"
      || bootstrap === "unstable_opponent_refutation_only"
    )
    && !isTacticallyUnstableLeaf(node, engineAgent, quiescenceScoreSwing)
  ) {
    return staticValue;
  }
  if (
    bootstrap === "unstable_opponent_refutation_only"
    && currentAgent(node.state) === engineAgent
  ) {
    return staticValue;
  }

  const maximizing = currentAgent(node.state) === engineAgent;
  let best = maximizing ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  for (const child of node.children) {
    const childWeight = effectiveLeafScoreWeight(child.state, scoreWeight, scoreMaterialMax);
    const value = child.solvedOutcome
      ?? normalizedAgentHeuristic(child.state, engineAgent, childWeight);
    best = maximizing ? Math.max(best, value) : Math.min(best, value);
  }
  if (!Number.isFinite(best)) return staticValue;
  return (
    bootstrap === "unstable_refutation_only"
    || bootstrap === "unstable_opponent_refutation_only"
  )
    ? Math.min(staticValue, best)
    : best;
}

function isTacticallyUnstableLeaf(
  node: Node,
  engineAgent: ResearchAgentId,
  minScoreSwing: number,
): boolean {
  const baseScoreDelta = agentScoreDelta(node.state, engineAgent);
  for (const child of node.children) {
    if (child.solvedOutcome !== null || child.state.game.status === "finished") return true;
    const childScoreDelta = agentScoreDelta(child.state, engineAgent);
    if (Math.abs(childScoreDelta - baseScoreDelta) >= minScoreSwing) return true;
  }
  return false;
}

function agentScoreDelta(state: BalanceState, agent: ResearchAgentId): number {
  const seat = seatForAgent(state, agent);
  const opponentSeat = otherPlayer(seat);
  return state.game.scores[seat] - state.game.scores[opponentSeat];
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
