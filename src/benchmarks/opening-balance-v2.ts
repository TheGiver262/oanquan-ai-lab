import { applyMove, createInitialState, getLegalMoves } from "../engine.js";
import { searchNegamaxPvs } from "../research/negamax-pvs.js";
import type { PlayerMove } from "../types.js";

const DEFAULT_CANDIDATES = [
  "B1:CCW",
  "B2:CCW",
  "B3:CW",
  "B3:CCW",
  "B4:CW",
  "B5:CW",
];

const openingArg = stringArg("--opening");
const openingKeys = openingArg ? [openingArg.toUpperCase()] : DEFAULT_CANDIDATES;
const budgets = csvInts("--budgets", [100_000, 500_000, 2_000_000]);
const maxDepth = intArg("--depth", 20);
const timeBudgetMs = intArg("--time", 30_000);
const aspirationWindow = intArg("--aspiration", 250);

const rows = openingKeys.map((openingKey) => {
  const opening = parseOpening(openingKey);
  const afterOpening = forceOpening(opening);
  const samples = budgets.map((nodeBudget) => {
    const result = searchNegamaxPvs(afterOpening, {
      maxDepth,
      nodeBudget,
      timeBudgetMs,
      aspirationWindow,
    });
    return {
      nodeBudget,
      openerScore: -result.score,
      bestReply: result.move ? `${result.move.pit}:${result.move.dir}` : null,
      completedDepth: result.diagnostics.completedDepth,
      nodes: result.diagnostics.nodeCount,
      ttHits: result.diagnostics.ttHits,
      cutoffs: result.diagnostics.cutoffs,
      aspirationResearches: result.diagnostics.aspirationResearches,
      budgetReason: result.diagnostics.budgetReason,
      principalVariation: result.principalVariation.map((move) => `${move.pit}:${move.dir}`),
    };
  });

  const scores = samples.map((sample) => sample.openerScore);
  const signs = scores.map(scoreSign);
  const replies = samples.map((sample) => sample.bestReply);
  const final = samples.at(-1)!;
  return {
    opening: openingKey,
    samples,
    convergence: {
      stableSign: new Set(signs).size === 1,
      signSequence: signs,
      stableBestReply: new Set(replies).size === 1,
      scoreRange: Math.max(...scores) - Math.min(...scores),
      finalAbsScore: Math.abs(final.openerScore),
      finalDepth: final.completedDepth,
      signal: classifySignal(signs),
    },
  };
});

rows.sort((left, right) => {
  if (left.convergence.finalAbsScore !== right.convergence.finalAbsScore) {
    return left.convergence.finalAbsScore - right.convergence.finalAbsScore;
  }
  return left.opening.localeCompare(right.opening);
});

console.log(JSON.stringify({
  methodology: {
    solver: "independent iterative-deepening Negamax + alpha-beta + PVS + aspiration + TT",
    evaluation: "independent material/refill heuristic; not production Trạng Nguyên tuning",
    perspective: "opening is forced for P0; search starts from P1; reported openerScore is negated P1 root score",
    claimLimit: "bounded heuristic convergence probe, not a solved game-theoretic value",
  },
  config: {
    openings: openingKeys,
    budgets,
    maxDepth,
    timeBudgetMs,
    aspirationWindow,
  },
  rows,
}, null, 2));

function parseOpening(value: string): PlayerMove {
  const [pit, dir] = value.toUpperCase().split(":");
  const move = getLegalMoves(createInitialState()).find((candidate) => candidate.pit === pit && candidate.dir === dir);
  if (!move) throw new Error(`Invalid opening ${value}`);
  return move;
}

function forceOpening(opening: PlayerMove) {
  const applied = applyMove(createInitialState(), opening);
  if (!applied.ok) throw new Error(`Cannot force ${opening.pit}:${opening.dir}: ${applied.error}`);
  return applied.state;
}

function scoreSign(score: number): "P0" | "P1" | "neutral" {
  if (score > 0) return "P0";
  if (score < 0) return "P1";
  return "neutral";
}

function classifySignal(signs: Array<"P0" | "P1" | "neutral">): "stable-P0" | "stable-P1" | "unstable" | "neutral" {
  const unique = new Set(signs);
  if (unique.size !== 1) return "unstable";
  const only = signs[0];
  if (only === "P0") return "stable-P0";
  if (only === "P1") return "stable-P1";
  return "neutral";
}

function stringArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function intArg(name: string, fallback: number): number {
  const raw = stringArg(name);
  if (raw === null) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function csvInts(name: string, fallback: number[]): number[] {
  const raw = stringArg(name);
  if (raw === null) return fallback;
  const values = raw.split(",").map((item) => Number.parseInt(item.trim(), 10));
  if (values.length === 0 || values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error(`${name} must be a comma-separated list of positive integers`);
  }
  return values;
}
