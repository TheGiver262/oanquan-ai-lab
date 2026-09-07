import { applyMove, createInitialState } from "../engine.js";
import { chooseMctsMove } from "../research/mcts.js";
import {
  chooseServerProductionMoveWithDiagnostics,
  type ServerProductionDecision,
} from "../reference/server-production-ai.js";
import {
  PRODUCTION_TOP_PROFILES,
  type ProductionProfile,
} from "../reference/production-ai.js";
import type { PlayerId, PlayerMove } from "../types.js";

type Scenario = {
  name: string;
  overrides: Partial<ProductionProfile>;
};

type GameSummary = {
  researchSeat: PlayerId;
  winner: PlayerId | null;
  unresolved: boolean;
  moves: number;
  bangNhanMoves: number;
  avgCompletedDepth: number;
  minCompletedDepth: number;
  avgNodes: number;
  budgetReasons: Record<string, number>;
  firstDecisions: Array<{
    moveNumber: number;
    player: PlayerId;
    move: string;
    completedDepth: number;
    nodeCount: number;
    budgetReason: string | null;
  }>;
};

const scenarios: Scenario[] = [
  { name: "baseline", overrides: {} },
  { name: "no-opening-book", overrides: { useOpeningBook: false } },
  { name: "branch-6", overrides: { maxBranchingMoves: 6 } },
  { name: "branch-8", overrides: { maxBranchingMoves: 8 } },
  { name: "branch-10", overrides: { maxBranchingMoves: 10, secondPlayerBranchingBonus: 0 } },
  { name: "budget-2x", overrides: { nodeBudget: 110_000, maxCacheEntries: 24_000 } },
  {
    name: "branch-10-budget-2x",
    overrides: {
      maxBranchingMoves: 10,
      secondPlayerBranchingBonus: 0,
      nodeBudget: 110_000,
      maxCacheEntries: 24_000,
    },
  },
];

const original = cloneProfile(PRODUCTION_TOP_PROFILES["bang-nhan"]);
const results: Array<{ scenario: string; games: GameSummary[] }> = [];

try {
  for (const scenario of scenarios) {
    Object.assign(PRODUCTION_TOP_PROFILES["bang-nhan"], cloneProfile(original), scenario.overrides);
    const games = [
      playGame("P0", 20260908),
      playGame("P1", 20260908 + 7919),
    ];
    results.push({ scenario: scenario.name, games });
    console.log(`\n=== ${scenario.name} ===`);
    for (const game of games) {
      console.log(JSON.stringify(game, null, 2));
    }
  }
} finally {
  Object.assign(PRODUCTION_TOP_PROFILES["bang-nhan"], original);
}

console.log("\n=== compact ===");
console.log(JSON.stringify(results.map(({ scenario, games }) => ({
  scenario,
  mctsWins: games.filter((g) => !g.unresolved && g.winner === g.researchSeat).length,
  bangNhanWins: games.filter((g) => !g.unresolved && g.winner && g.winner !== g.researchSeat).length,
  draws: games.filter((g) => !g.unresolved && g.winner === null).length,
  unresolved: games.filter((g) => g.unresolved).length,
  games: games.map((g) => ({
    researchSeat: g.researchSeat,
    winner: g.winner,
    moves: g.moves,
    avgCompletedDepth: g.avgCompletedDepth,
    minCompletedDepth: g.minCompletedDepth,
    avgNodes: g.avgNodes,
    budgetReasons: g.budgetReasons,
    firstDecisions: g.firstDecisions,
  })),
})), null, 2));

function playGame(researchSeat: PlayerId, seed: number): GameSummary {
  let state = createInitialState();
  const researchRandom = mulberry32(seed ^ 0x9e3779b9);
  const productionRandom = mulberry32(seed ^ 0x85ebca6b);
  const diagnostics: ServerProductionDecision[] = [];
  const firstDecisions: GameSummary["firstDecisions"] = [];
  const maxMoves = 160;

  while (state.status === "playing" && state.moveNumber < maxMoves) {
    const player = state.currentPlayer;
    let move: PlayerMove | null = null;

    if (player === researchSeat) {
      const decision = chooseMctsMove(state, {
        variant: "uct",
        simulations: 100_000,
        timeBudgetMs: 900,
        rolloutDepth: 20,
        random: researchRandom,
      });
      move = decision.move;
    } else {
      const decision = chooseServerProductionMoveWithDiagnostics(state, "bang-nhan", player, {
        mode: "production-max",
        timeBudgetMs: 900,
        random: productionRandom,
      });
      diagnostics.push(decision);
      if (firstDecisions.length < 10) {
        firstDecisions.push({
          moveNumber: state.moveNumber,
          player,
          move: decision.move ? `${decision.move.pit}:${decision.move.dir}` : "null",
          completedDepth: decision.completedDepth,
          nodeCount: decision.nodeCount,
          budgetReason: decision.budgetReason,
        });
      }
      move = decision.move ? { player, ...decision.move } : null;
    }

    if (!move) return summarize(researchSeat, null, true, state.moveNumber, diagnostics, firstDecisions);
    const applied = applyMove(state, move);
    if (!applied.ok) throw new Error(`Illegal ${player} move ${move.pit}:${move.dir}: ${applied.error}`);
    state = applied.state;
  }

  return summarize(
    researchSeat,
    state.status === "finished" ? state.winner : null,
    state.status !== "finished",
    state.moveNumber,
    diagnostics,
    firstDecisions,
  );
}

function summarize(
  researchSeat: PlayerId,
  winner: PlayerId | null,
  unresolved: boolean,
  moves: number,
  diagnostics: ServerProductionDecision[],
  firstDecisions: GameSummary["firstDecisions"],
): GameSummary {
  const depths = diagnostics.map((d) => d.completedDepth);
  const nodes = diagnostics.map((d) => d.nodeCount);
  const budgetReasons: Record<string, number> = {};
  for (const d of diagnostics) {
    const key = d.budgetReason ?? "none";
    budgetReasons[key] = (budgetReasons[key] ?? 0) + 1;
  }
  return {
    researchSeat,
    winner,
    unresolved,
    moves,
    bangNhanMoves: diagnostics.length,
    avgCompletedDepth: average(depths),
    minCompletedDepth: depths.length > 0 ? Math.min(...depths) : 0,
    avgNodes: average(nodes),
    budgetReasons,
    firstDecisions,
  };
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function cloneProfile(profile: ProductionProfile): ProductionProfile {
  return {
    ...profile,
    weights: { ...profile.weights },
    bossBuff: profile.bossBuff ? { ...profile.bossBuff } : null,
  };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
