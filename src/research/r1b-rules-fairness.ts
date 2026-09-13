import {
  applyMove,
  CLASSIC_STANDARD_RULESET,
  createInitialState,
  getLegalMoves,
  NO_FIRST_QUAN_RULESET,
} from "../engine.js";
import { chooseMctsMove } from "./mcts.js";
import {
  chooseServerProductionMoveWithDiagnostics,
  PRODUCTION_SOURCE_COMMIT,
} from "../reference/server-production-ai.js";
import type { GameState, PlayerId, PlayerMove } from "../types.js";

export type R1bAgentId = "A" | "B";
export type R1bRuleCase = "cam-quan" | "standard-pie";
export type R1bPieBranch = "keep" | "swap";
export type R1bBranch = "none" | R1bPieBranch;
export type R1bEngineId = "uct" | "uct-pb" | "trang-nguyen";

export type R1bSeatMapping = Readonly<Record<PlayerId, R1bAgentId>>;

export type R1bSearchConfig = {
  simulations: number;
  rolloutDepth: number;
  trangNguyenNodeBudget: number;
  hardTimeCeilingMs: number;
  maxMoves: number;
};

export type R1bGameSpec = {
  ruleCase: R1bRuleCase;
  branch: R1bBranch;
  opening: PlayerMove;
  engineByAgent: Readonly<Record<R1bAgentId, R1bEngineId>>;
  seed: number;
  config: R1bSearchConfig;
  assignment: "xy" | "yx";
};

export type R1bGameResult = {
  ruleCase: R1bRuleCase;
  branch: R1bBranch;
  opening: string;
  assignment: "xy" | "yx";
  engineByAgent: Readonly<Record<R1bAgentId, R1bEngineId>>;
  seatToAgent: R1bSeatMapping;
  moverAfterOpeningDecision: R1bAgentId;
  winnerSeat: PlayerId | null;
  winnerAgent: R1bAgentId | null;
  openerValue: -1 | 0 | 1 | null;
  unresolved: boolean;
  moves: number;
  seed: number;
  productionSourceCommit: string;
};

export type R1bValueInterval = {
  lower: number;
  upper: number;
  resolvedValue: number | null;
};

export type R1bOpeningSummary = {
  ruleCase: R1bRuleCase;
  opening: string;
  assignmentCount: number;
  pairedResolvedValue: number | null;
  pairedLower: number;
  pairedUpper: number;
  assignments: Array<{
    assignment: "xy" | "yx";
    lower: number;
    upper: number;
    resolvedValue: number | null;
  }>;
};

export const DEFAULT_R1B_SEARCH_CONFIG: R1bSearchConfig = Object.freeze({
  simulations: 2_000,
  rolloutDepth: 20,
  trangNguyenNodeBudget: 100_000,
  hardTimeCeilingMs: 5_000,
  maxMoves: 160,
});

export function enumerateR1bOpenings(ruleCase: R1bRuleCase): PlayerMove[] {
  const initial = createInitialState(
    ruleCase === "cam-quan" ? NO_FIRST_QUAN_RULESET : CLASSIC_STANDARD_RULESET,
  );
  return getLegalMoves(initial);
}

export function r1bSeatMapping(ruleCase: R1bRuleCase, branch: R1bBranch): R1bSeatMapping {
  if (ruleCase === "cam-quan") {
    if (branch !== "none") throw new Error("cam-quan has no Pie branch");
    return { P0: "A", P1: "B" };
  }

  if (branch === "none") throw new Error("standard-pie requires keep or swap");
  return branch === "keep"
    ? { P0: "A", P1: "B" }
    : { P0: "B", P1: "A" };
}

export function moverAfterR1bOpeningDecision(
  ruleCase: R1bRuleCase,
  branch: R1bBranch,
): R1bAgentId {
  return r1bSeatMapping(ruleCase, branch).P1;
}

export function playR1bGame(spec: R1bGameSpec): R1bGameResult {
  let state = forceOpening(spec.ruleCase, spec.opening);
  const seatToAgent = r1bSeatMapping(spec.ruleCase, spec.branch);
  const randomByAgent: Record<R1bAgentId, () => number> = {
    A: mulberry32(spec.seed ^ 0x9e3779b9),
    B: mulberry32(spec.seed ^ 0x85ebca6b),
  };

  while (state.status === "playing" && state.moveNumber < spec.config.maxMoves) {
    const seat = state.currentPlayer;
    const agent = seatToAgent[seat];
    const engine = spec.engineByAgent[agent];
    const move = chooseR1bMove(state, engine, randomByAgent[agent], spec.config);
    if (!move) return unresolvedResult(spec, seatToAgent, state.moveNumber);

    const applied = applyMove(state, move);
    if (!applied.ok) {
      throw new Error(
        `R1b engine ${engine} produced illegal move ${move.pit}:${move.dir}: ${applied.error}`,
      );
    }
    state = applied.state;
  }

  if (state.status !== "finished") {
    return unresolvedResult(spec, seatToAgent, state.moveNumber);
  }

  const winnerAgent = state.winner === null ? null : seatToAgent[state.winner];
  return {
    ruleCase: spec.ruleCase,
    branch: spec.branch,
    opening: moveKey(spec.opening),
    assignment: spec.assignment,
    engineByAgent: spec.engineByAgent,
    seatToAgent,
    moverAfterOpeningDecision: seatToAgent.P1,
    winnerSeat: state.winner,
    winnerAgent,
    openerValue: state.winner === null ? 0 : winnerAgent === "A" ? 1 : -1,
    unresolved: false,
    moves: state.moveNumber,
    seed: spec.seed,
    productionSourceCommit: PRODUCTION_SOURCE_COMMIT,
  };
}

export function summarizeR1bOpening(
  ruleCase: R1bRuleCase,
  opening: PlayerMove | string,
  games: R1bGameResult[],
): R1bOpeningSummary {
  const openingKey = typeof opening === "string" ? opening : moveKey(opening);
  const selected = games.filter(
    (game) => game.ruleCase === ruleCase && game.opening === openingKey,
  );
  const assignments = (["xy", "yx"] as const).flatMap((assignment) => {
    const assignmentGames = selected.filter((game) => game.assignment === assignment);
    if (assignmentGames.length === 0) return [];
    const interval = assignmentInterval(ruleCase, assignmentGames);
    return [{ assignment, ...interval }];
  });

  if (assignments.length === 0) {
    return {
      ruleCase,
      opening: openingKey,
      assignmentCount: 0,
      pairedResolvedValue: null,
      pairedLower: -1,
      pairedUpper: 1,
      assignments: [],
    };
  }

  const pairedLower = mean(assignments.map((entry) => entry.lower));
  const pairedUpper = mean(assignments.map((entry) => entry.upper));
  const allResolved = assignments.every((entry) => entry.resolvedValue !== null);
  const pairedResolvedValue = allResolved
    ? mean(assignments.map((entry) => entry.resolvedValue as number))
    : null;

  return {
    ruleCase,
    opening: openingKey,
    assignmentCount: assignments.length,
    pairedResolvedValue,
    pairedLower,
    pairedUpper,
    assignments,
  };
}

export function responderOptimalPieInterval(
  keep: R1bValueInterval,
  swap: R1bValueInterval,
): R1bValueInterval {
  return {
    lower: Math.min(keep.lower, swap.lower),
    upper: Math.min(keep.upper, swap.upper),
    resolvedValue:
      keep.resolvedValue !== null && swap.resolvedValue !== null
        ? Math.min(keep.resolvedValue, swap.resolvedValue)
        : null,
  };
}

export function gameValueInterval(game: R1bGameResult): R1bValueInterval {
  if (game.openerValue === null) return { lower: -1, upper: 1, resolvedValue: null };
  return {
    lower: game.openerValue,
    upper: game.openerValue,
    resolvedValue: game.openerValue,
  };
}

function assignmentInterval(
  ruleCase: R1bRuleCase,
  games: R1bGameResult[],
): R1bValueInterval {
  if (ruleCase === "cam-quan") {
    const game = games.find((entry) => entry.branch === "none");
    if (!game) throw new Error("Missing Cấm Quan no-Pie game for assignment");
    return gameValueInterval(game);
  }

  const keep = games.find((entry) => entry.branch === "keep");
  const swap = games.find((entry) => entry.branch === "swap");
  if (!keep || !swap) throw new Error("Pie assignment requires both KEEP and SWAP games");
  return responderOptimalPieInterval(gameValueInterval(keep), gameValueInterval(swap));
}

function forceOpening(ruleCase: R1bRuleCase, opening: PlayerMove): GameState {
  const initial = createInitialState(
    ruleCase === "cam-quan" ? NO_FIRST_QUAN_RULESET : CLASSIC_STANDARD_RULESET,
  );
  const legal = getLegalMoves(initial).find(
    (move) => move.player === "P0" && move.pit === opening.pit && move.dir === opening.dir,
  );
  if (!legal) {
    throw new Error(`Opening ${moveKey(opening)} is not legal for ${ruleCase}`);
  }
  const applied = applyMove(initial, legal);
  if (!applied.ok) throw new Error(`Failed to force ${ruleCase} opening: ${applied.error}`);
  return applied.state;
}

function chooseR1bMove(
  state: GameState,
  engine: R1bEngineId,
  random: () => number,
  config: R1bSearchConfig,
): PlayerMove | null {
  if (engine === "uct" || engine === "uct-pb") {
    return chooseMctsMove(state, {
      variant: engine,
      simulations: config.simulations,
      rolloutDepth: config.rolloutDepth,
      random,
    }).move;
  }

  const decision = chooseServerProductionMoveWithDiagnostics(
    state,
    "trang-nguyen",
    state.currentPlayer,
    {
      mode: "production-max",
      nodeBudget: config.trangNguyenNodeBudget,
      timeBudgetMs: config.hardTimeCeilingMs,
      random,
    },
  );
  return decision.move
    ? { player: state.currentPlayer, pit: decision.move.pit, dir: decision.move.dir }
    : null;
}

function unresolvedResult(
  spec: R1bGameSpec,
  seatToAgent: R1bSeatMapping,
  moves: number,
): R1bGameResult {
  return {
    ruleCase: spec.ruleCase,
    branch: spec.branch,
    opening: moveKey(spec.opening),
    assignment: spec.assignment,
    engineByAgent: spec.engineByAgent,
    seatToAgent,
    moverAfterOpeningDecision: seatToAgent.P1,
    winnerSeat: null,
    winnerAgent: null,
    openerValue: null,
    unresolved: true,
    moves,
    seed: spec.seed,
    productionSourceCommit: PRODUCTION_SOURCE_COMMIT,
  };
}

function moveKey(move: Pick<PlayerMove, "pit" | "dir">): string {
  return `${move.pit}:${move.dir}`;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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
