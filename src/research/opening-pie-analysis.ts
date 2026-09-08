import { applyMove, createInitialState, getLegalMoves } from "../engine.js";
import {
  PRODUCTION_TOP_PROFILES,
  enumerateProductionMoves,
  evaluateProductionState,
  type ProductionAiMove,
} from "../reference/production-ai.js";
import {
  chooseServerProductionMoveWithDiagnostics,
  PRODUCTION_SOURCE_COMMIT,
} from "../reference/server-production-ai.js";
import {
  SearchBudgetExhausted,
  searchTrangNguyenBestFirst,
  type TrangNguyenWdl,
} from "../reference/trang-nguyen-best-first-search.js";
import type { GameState, PlayerId, PlayerMove } from "../types.js";

export type ResearchAgentId = "A" | "B";
export type PieBranch = "keep" | "swap";

export type PieSeatMapping = Readonly<Record<PlayerId, ResearchAgentId>>;

export type OpeningProbeOptions = {
  maxDepth?: number;
  nodeBudget?: number;
  timeBudgetMs?: number;
};

export type OpeningProbeResult = {
  opening: PlayerMove;
  bestReply: ProductionAiMove | null;
  openerScore: number;
  openerLowerBound: TrangNguyenWdl;
  openerUpperBound: TrangNguyenWdl;
  completedDepth: number;
  visits: number;
  nodes: number;
  budgetReason: "node" | "time" | null;
};

export type StrongSelfPlayOptions = {
  seed?: number;
  maxMoves?: number;
  timeBudgetMs?: number;
  nodeBudget?: number;
};

export type PieBranchGame = {
  branch: PieBranch;
  opening: PlayerMove;
  seatToAgent: PieSeatMapping;
  moverAfterDecision: ResearchAgentId;
  winnerSeat: PlayerId | null;
  winnerAgent: ResearchAgentId | null;
  openerAgentValue: -1 | 0 | 1 | null;
  unresolved: boolean;
  moves: number;
  productionSourceCommit: string;
};

export type EvSummary = {
  games: number;
  resolved: number;
  unresolved: number;
  openerWins: number;
  draws: number;
  openerLosses: number;
  resolvedMean: number | null;
  lower: number;
  upper: number;
};

export type PieOpeningSummary = {
  opening: PlayerMove;
  keep: EvSummary;
  swap: EvSummary;
  guaranteedResolvedEv: number | null;
  guaranteedLower: number;
  guaranteedUpper: number;
  classification: "opener-guaranteed-positive" | "responder-can-neutralize" | "inconclusive";
  games: PieBranchGame[];
};

export function getClassicOpenings(): PlayerMove[] {
  return getLegalMoves(createInitialState());
}

export function parseClassicOpening(value: string): PlayerMove {
  const [pitRaw, dirRaw] = value.toUpperCase().split(":");
  const opening = getClassicOpenings().find((move) => move.pit === pitRaw && move.dir === dirRaw);
  if (!opening) throw new Error(`Unknown classic opening ${value}. Expected B1..B5:CW|CCW.`);
  return opening;
}

/**
 * Pie Rule semantics used by this research lab:
 * - A is the original opener and makes move 1 as logical seat P0.
 * - KEEP: B remains P1, so B makes move 2.
 * - SWAP: B takes P0 and A takes P1. SWAP consumes B's decision, therefore
 *   the board remains exactly after move 1 and A immediately makes move 2 as P1.
 * - The board is never mirrored or rewritten; only agent-to-seat ownership changes.
 */
export function pieSeatMapping(branch: PieBranch): PieSeatMapping {
  return branch === "keep"
    ? { P0: "A", P1: "B" }
    : { P0: "B", P1: "A" };
}

export function moverAfterPieDecision(branch: PieBranch): ResearchAgentId {
  return pieSeatMapping(branch).P1;
}

export function valueForOpenerAgent(
  winnerSeat: PlayerId | null,
  seatToAgent: PieSeatMapping,
): -1 | 0 | 1 {
  if (winnerSeat === null) return 0;
  return seatToAgent[winnerSeat] === "A" ? 1 : -1;
}

export function probeOpeningWithTrangNguyen(
  opening: PlayerMove,
  options: OpeningProbeOptions = {},
): OpeningProbeResult {
  const afterOpening = forceOpening(opening);
  const profile = PRODUCTION_TOP_PROFILES["trang-nguyen"];
  const maxDepth = options.maxDepth ?? profile.searchDepth;
  const nodeBudget = options.nodeBudget ?? profile.nodeBudget;
  const timeBudgetMs = options.timeBudgetMs ?? profile.timeBudgetMs;
  const startedAt = performance.now();
  const deadline = startedAt + timeBudgetMs;
  let nodes = 0;

  // After the forced P0 opener, P1 is the responder. Search from P1's
  // perspective so root branch selection is adversarial to the opener.
  const result = searchTrangNguyenBestFirst<GameState, ProductionAiMove, PlayerId>({
    rootState: afterOpening,
    perspective: "P1",
    maxDepth,
    adapter: {
      currentPlayer: (state) => state.currentPlayer,
      legalMoves: (state) => enumerateProductionMoves(state, state.currentPlayer).map((candidate) => candidate.move),
      applyMove: (state, move) => {
        const applied = applyMove(state, { player: state.currentPlayer, ...move });
        if (!applied.ok) throw new Error(`Illegal probe move ${move.pit}:${move.dir}: ${applied.error}`);
        return applied.state;
      },
      terminalOutcome: (state, perspective) => {
        if (state.status !== "finished") return null;
        if (state.winner === null) return "draw";
        return state.winner === perspective ? "win" : "loss";
      },
      heuristic: (state, perspective) => evaluateProductionState(state, perspective, profile),
      moveKey: (move) => `${move.pit}:${move.dir}`,
    },
    budget: {
      shouldStop: () => {
        if (performance.now() >= deadline) return "time";
        if (nodes >= nodeBudget) return "node";
        return null;
      },
      consumeNode: () => {
        if (performance.now() >= deadline) throw new SearchBudgetExhausted("time");
        if (nodes >= nodeBudget) throw new SearchBudgetExhausted("node");
        nodes += 1;
      },
    },
  });

  const best = result.move
    ? result.branches.find((branch) => branch.move.pit === result.move?.pit && branch.move.dir === result.move?.dir)
    : undefined;

  const responderLower = best?.lowerBound ?? "loss";
  const responderUpper = best?.upperBound ?? "win";

  return {
    opening,
    bestReply: result.move,
    openerScore: -(best?.score ?? evaluateProductionState(afterOpening, "P1", profile)),
    openerLowerBound: invertWdl(responderUpper),
    openerUpperBound: invertWdl(responderLower),
    completedDepth: best?.completedDepth ?? 0,
    visits: best?.visits ?? 0,
    nodes,
    budgetReason: result.budgetReason,
  };
}

export function playTrangNguyenPieBranch(
  opening: PlayerMove,
  branch: PieBranch,
  options: StrongSelfPlayOptions = {},
): PieBranchGame {
  let state = forceOpening(opening);
  const seatToAgent = pieSeatMapping(branch);
  const maxMoves = options.maxMoves ?? 160;
  const profile = PRODUCTION_TOP_PROFILES["trang-nguyen"];
  const timeBudgetMs = options.timeBudgetMs ?? profile.timeBudgetMs;
  const nodeBudget = options.nodeBudget ?? profile.nodeBudget;
  const seed = options.seed ?? 20260908;
  const randomByAgent: Record<ResearchAgentId, () => number> = {
    A: mulberry32(seed ^ 0x9e3779b9),
    B: mulberry32(seed ^ 0x85ebca6b),
  };

  while (state.status === "playing" && state.moveNumber < maxMoves) {
    const seat = state.currentPlayer;
    const agent = seatToAgent[seat];
    const decision = chooseServerProductionMoveWithDiagnostics(state, "trang-nguyen", seat, {
      mode: "production-max",
      timeBudgetMs,
      nodeBudget,
      random: randomByAgent[agent],
    });
    if (!decision.move) {
      return {
        branch,
        opening,
        seatToAgent,
        moverAfterDecision: seatToAgent.P1,
        winnerSeat: null,
        winnerAgent: null,
        openerAgentValue: null,
        unresolved: true,
        moves: state.moveNumber,
        productionSourceCommit: PRODUCTION_SOURCE_COMMIT,
      };
    }
    const applied = applyMove(state, { player: seat, ...decision.move });
    if (!applied.ok) {
      throw new Error(`Illegal Trạng Nguyên move ${decision.move.pit}:${decision.move.dir}: ${applied.error}`);
    }
    state = applied.state;
  }

  if (state.status !== "finished") {
    return {
      branch,
      opening,
      seatToAgent,
      moverAfterDecision: seatToAgent.P1,
      winnerSeat: null,
      winnerAgent: null,
      openerAgentValue: null,
      unresolved: true,
      moves: state.moveNumber,
      productionSourceCommit: PRODUCTION_SOURCE_COMMIT,
    };
  }

  const winnerAgent = state.winner === null ? null : seatToAgent[state.winner];
  return {
    branch,
    opening,
    seatToAgent,
    moverAfterDecision: seatToAgent.P1,
    winnerSeat: state.winner,
    winnerAgent,
    openerAgentValue: valueForOpenerAgent(state.winner, seatToAgent),
    unresolved: false,
    moves: state.moveNumber,
    productionSourceCommit: PRODUCTION_SOURCE_COMMIT,
  };
}

export function summarizePieOpening(
  opening: PlayerMove,
  games: PieBranchGame[],
): PieOpeningSummary {
  const keep = summarizeEv(games.filter((game) => game.branch === "keep"));
  const swap = summarizeEv(games.filter((game) => game.branch === "swap"));
  const guaranteedResolvedEv = keep.resolvedMean === null || swap.resolvedMean === null
    ? null
    : Math.min(keep.resolvedMean, swap.resolvedMean);
  const guaranteedLower = Math.min(keep.lower, swap.lower);
  const guaranteedUpper = Math.min(keep.upper, swap.upper);
  const classification = guaranteedLower > 0
    ? "opener-guaranteed-positive"
    : guaranteedUpper <= 0
      ? "responder-can-neutralize"
      : "inconclusive";

  return {
    opening,
    keep,
    swap,
    guaranteedResolvedEv,
    guaranteedLower,
    guaranteedUpper,
    classification,
    games,
  };
}

function summarizeEv(games: PieBranchGame[]): EvSummary {
  let openerWins = 0;
  let draws = 0;
  let openerLosses = 0;
  let unresolved = 0;
  let sum = 0;

  for (const game of games) {
    if (game.openerAgentValue === null) {
      unresolved += 1;
      continue;
    }
    sum += game.openerAgentValue;
    if (game.openerAgentValue > 0) openerWins += 1;
    else if (game.openerAgentValue < 0) openerLosses += 1;
    else draws += 1;
  }

  const resolved = games.length - unresolved;
  const denominator = Math.max(1, games.length);
  return {
    games: games.length,
    resolved,
    unresolved,
    openerWins,
    draws,
    openerLosses,
    resolvedMean: resolved > 0 ? sum / resolved : null,
    lower: (sum - unresolved) / denominator,
    upper: (sum + unresolved) / denominator,
  };
}

function forceOpening(opening: PlayerMove): GameState {
  const initial = createInitialState();
  const legal = getLegalMoves(initial).find(
    (move) => move.pit === opening.pit && move.dir === opening.dir && move.player === "P0",
  );
  if (!legal) throw new Error(`Opening ${opening.pit}:${opening.dir} is not legal from the initial state.`);
  const applied = applyMove(initial, legal);
  if (!applied.ok) throw new Error(`Failed to force opening ${opening.pit}:${opening.dir}: ${applied.error}`);
  return applied.state;
}

function invertWdl(value: TrangNguyenWdl): TrangNguyenWdl {
  if (value === "win") return "loss";
  if (value === "loss") return "win";
  return "draw";
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
