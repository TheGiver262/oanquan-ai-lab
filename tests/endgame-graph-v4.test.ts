import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/engine.js";
import {
  analyzeReachableEndgameGraph,
  tarjanStronglyConnectedComponents,
} from "../src/research/endgame-graph-v4.js";

describe("Opening Balance V4 SCC graph analysis", () => {
  it("finds a multi-node SCC and an acyclic sink", () => {
    const components = tarjanStronglyConnectedComponents([
      [1],
      [2],
      [0, 3],
      [],
    ]).map((component) => component.join(","));

    expect(components).toContain("0,1,2");
    expect(components).toContain("3");
    expect(components).toHaveLength(2);
  });

  it("treats a self-loop as an SCC but leaves cycle semantics to the caller", () => {
    const components = tarjanStronglyConnectedComponents([[0]]);
    expect(components).toEqual([[0]]);
  });

  it("fully analyzes a terminal root without inventing a cycle", () => {
    const state = createInitialState();
    state.status = "finished";
    state.winner = "P0";
    state.scores = { P0: 41, P1: 29 };

    const graph = analyzeReachableEndgameGraph(state, {
      nodeBudget: 100,
      timeBudgetMs: 5_000,
    });

    expect(graph.analysis.complete).toBe(true);
    expect(graph.analysis.nodeCount).toBe(1);
    expect(graph.analysis.expandedNodeCount).toBe(1);
    expect(graph.analysis.edgeCount).toBe(0);
    expect(graph.analysis.terminalNodeCount).toBe(1);
    expect(graph.analysis.cyclicComponentCount).toBe(0);
    expect(graph.analysis.closedCyclicComponentCount).toBe(0);
  });
});
