import { applyMove, getLegalMoves } from "../engine.js";
import type { GameState, PlayerMove } from "../types.js";
import { exactStrategicStateKey } from "./exact-endgame-v4.js";

export type EndgameGraphOptions = {
  nodeBudget?: number;
  timeBudgetMs?: number;
};

export type EndgameGraphEdge = {
  move: PlayerMove;
  target: number;
};

export type EndgameGraphNode = {
  id: number;
  key: string;
  state: GameState;
  depth: number;
  expanded: boolean;
  terminal: boolean;
  edges: EndgameGraphEdge[];
};

export type StronglyConnectedComponent = {
  id: number;
  members: number[];
  cyclic: boolean;
  fullyExpanded: boolean;
  outgoingComponentIds: number[];
  closed: boolean;
};

export type CycleWitness = {
  componentId: number;
  stateIds: number[];
  moves: string[];
};

export type EndgameGraphAnalysis = {
  complete: boolean;
  budgetReason: "node" | "time" | null;
  nodeCount: number;
  expandedNodeCount: number;
  edgeCount: number;
  terminalNodeCount: number;
  componentCount: number;
  cyclicComponentCount: number;
  closedCyclicComponentCount: number;
  largestComponentSize: number;
  largestCyclicComponentSize: number;
  maxDiscoveredDepth: number;
  components: StronglyConnectedComponent[];
  cycleWitnesses: CycleWitness[];
};

export type BuiltEndgameGraph = {
  nodes: EndgameGraphNode[];
  analysis: EndgameGraphAnalysis;
};

/**
 * Builds the reachable strategic game graph and decomposes it into SCCs.
 *
 * This function deliberately performs graph analysis only. It does not assign
 * a draw value to cyclic SCCs because the current game rules do not specify a
 * repetition outcome. A fully expanded closed cyclic SCC is therefore evidence
 * that non-terminating play is reachable under the current transition rules,
 * not automatically evidence of a draw.
 */
export function analyzeReachableEndgameGraph(
  root: GameState,
  options: EndgameGraphOptions = {},
): BuiltEndgameGraph {
  const nodeBudget = options.nodeBudget ?? 100_000;
  const timeBudgetMs = options.timeBudgetMs ?? 10_000;
  const deadline = performance.now() + timeBudgetMs;

  const nodes: EndgameGraphNode[] = [];
  const byKey = new Map<string, number>();
  const queue: number[] = [];
  let queueIndex = 0;
  let budgetReason: "node" | "time" | null = null;

  const addNode = (state: GameState, depth: number): number | null => {
    const key = exactStrategicStateKey(state);
    const existing = byKey.get(key);
    if (existing !== undefined) {
      if (depth < nodes[existing]!.depth) nodes[existing]!.depth = depth;
      return existing;
    }
    if (nodes.length >= nodeBudget) {
      budgetReason = "node";
      return null;
    }
    const id = nodes.length;
    const node: EndgameGraphNode = {
      id,
      key,
      state: structuredClone(state),
      depth,
      expanded: false,
      terminal: state.status === "finished",
      edges: [],
    };
    nodes.push(node);
    byKey.set(key, id);
    queue.push(id);
    return id;
  };

  addNode(root, 0);

  while (queueIndex < queue.length && budgetReason === null) {
    if (performance.now() >= deadline) {
      budgetReason = "time";
      break;
    }

    const id = queue[queueIndex++]!;
    const node = nodes[id]!;
    if (node.terminal) {
      node.expanded = true;
      continue;
    }

    const legal = getLegalMoves(node.state);
    for (const move of legal) {
      if (performance.now() >= deadline) {
        budgetReason = "time";
        break;
      }
      const applied = applyMove(node.state, move);
      if (!applied.ok) continue;
      const target = addNode(applied.state, node.depth + 1);
      if (target === null) break;
      node.edges.push({ move, target });
    }

    if (budgetReason === null) node.expanded = true;
  }

  const componentsRaw = tarjan(nodes);
  const componentOf = new Array<number>(nodes.length).fill(-1);
  componentsRaw.forEach((members, componentId) => {
    for (const member of members) componentOf[member] = componentId;
  });

  const components: StronglyConnectedComponent[] = componentsRaw.map((members, componentId) => {
    const memberSet = new Set(members);
    const outgoing = new Set<number>();
    let selfLoop = false;
    let fullyExpanded = true;

    for (const member of members) {
      const node = nodes[member]!;
      if (!node.expanded) fullyExpanded = false;
      for (const edge of node.edges) {
        if (edge.target === member) selfLoop = true;
        if (!memberSet.has(edge.target)) outgoing.add(componentOf[edge.target]!);
      }
    }

    const cyclic = members.length > 1 || selfLoop;
    return {
      id: componentId,
      members,
      cyclic,
      fullyExpanded,
      outgoingComponentIds: [...outgoing].sort((a, b) => a - b),
      closed: fullyExpanded && outgoing.size === 0,
    };
  });

  const cyclic = components.filter((component) => component.cyclic);
  const witnesses = cyclic
    .slice()
    .sort((a, b) => a.members.length - b.members.length || a.id - b.id)
    .slice(0, 5)
    .map((component) => findCycleWitness(nodes, component));

  const expandedNodeCount = nodes.filter((node) => node.expanded).length;
  const edgeCount = nodes.reduce((sum, node) => sum + node.edges.length, 0);
  const terminalNodeCount = nodes.filter((node) => node.terminal).length;
  const complete = budgetReason === null && expandedNodeCount === nodes.length;

  return {
    nodes,
    analysis: {
      complete,
      budgetReason,
      nodeCount: nodes.length,
      expandedNodeCount,
      edgeCount,
      terminalNodeCount,
      componentCount: components.length,
      cyclicComponentCount: cyclic.length,
      closedCyclicComponentCount: cyclic.filter((component) => component.closed).length,
      largestComponentSize: components.reduce((max, component) => Math.max(max, component.members.length), 0),
      largestCyclicComponentSize: cyclic.reduce((max, component) => Math.max(max, component.members.length), 0),
      maxDiscoveredDepth: nodes.reduce((max, node) => Math.max(max, node.depth), 0),
      components,
      cycleWitnesses: witnesses,
    },
  };
}

export function tarjanStronglyConnectedComponents(adjacency: readonly (readonly number[])[]): number[][] {
  const indexByNode = new Array<number>(adjacency.length).fill(-1);
  const lowLink = new Array<number>(adjacency.length).fill(-1);
  const stack: number[] = [];
  const onStack = new Array<boolean>(adjacency.length).fill(false);
  const result: number[][] = [];
  let nextIndex = 0;

  const visit = (node: number): void => {
    indexByNode[node] = nextIndex;
    lowLink[node] = nextIndex;
    nextIndex += 1;
    stack.push(node);
    onStack[node] = true;

    for (const target of adjacency[node] ?? []) {
      if (indexByNode[target] === -1) {
        visit(target);
        lowLink[node] = Math.min(lowLink[node]!, lowLink[target]!);
      } else if (onStack[target]) {
        lowLink[node] = Math.min(lowLink[node]!, indexByNode[target]!);
      }
    }

    if (lowLink[node] === indexByNode[node]) {
      const component: number[] = [];
      while (true) {
        const member = stack.pop();
        if (member === undefined) throw new Error("Tarjan stack underflow");
        onStack[member] = false;
        component.push(member);
        if (member === node) break;
      }
      component.sort((a, b) => a - b);
      result.push(component);
    }
  };

  for (let node = 0; node < adjacency.length; node += 1) {
    if (indexByNode[node] === -1) visit(node);
  }

  return result;
}

function tarjan(nodes: readonly EndgameGraphNode[]): number[][] {
  return tarjanStronglyConnectedComponents(nodes.map((node) => node.edges.map((edge) => edge.target)));
}

function findCycleWitness(
  nodes: readonly EndgameGraphNode[],
  component: StronglyConnectedComponent,
): CycleWitness {
  const members = new Set(component.members);
  const start = component.members[0]!;

  for (const edge of nodes[start]!.edges) {
    if (edge.target === start) {
      return {
        componentId: component.id,
        stateIds: [start, start],
        moves: [moveKey(edge.move)],
      };
    }
  }

  type Path = { node: number; states: number[]; moves: string[] };
  const queue: Path[] = [{ node: start, states: [start], moves: [] }];
  const seen = new Set<number>([start]);
  let cursor = 0;

  while (cursor < queue.length) {
    const current = queue[cursor++]!;
    for (const edge of nodes[current.node]!.edges) {
      if (!members.has(edge.target)) continue;
      const states = [...current.states, edge.target];
      const moves = [...current.moves, moveKey(edge.move)];
      if (edge.target === start) {
        return { componentId: component.id, stateIds: states, moves };
      }
      if (!seen.has(edge.target)) {
        seen.add(edge.target);
        queue.push({ node: edge.target, states, moves });
      }
    }
  }

  // Tarjan guarantees a cycle for a cyclic SCC. This fallback protects the
  // artifact contract if a future graph representation violates that premise.
  return { componentId: component.id, stateIds: [start], moves: [] };
}

function moveKey(move: PlayerMove): string {
  return `${move.pit}:${move.dir}`;
}
