import { applyMove, createInitialState, getLegalMoves } from "../engine.js";
import { searchNegamaxPvsV3, type V3EvaluationFamily } from "../research/negamax-pvs-v3.js";
import { parseClassicOpening } from "../research/opening-pie-analysis.js";

const opening = parseClassicOpening(requiredStringArg("--opening"));
const evaluationFamily = readEvaluationFamily();
const nodeBudget = intArg("--nodes", 10_000_000);
const maxDepth = intArg("--depth", 28);
const timeBudgetMs = intArg("--time", 900_000);
const aspirationWindow = intArg("--aspiration", 250);

if (!((opening.pit === "B3") && (opening.dir === "CW" || opening.dir === "CCW"))) {
  throw new Error("Opening Balance V3 deep probe is intentionally restricted to B3:CW and B3:CCW");
}

const initial = createInitialState();
const legalOpening = getLegalMoves(initial).find(
  (move) => move.player === "P0" && move.pit === opening.pit && move.dir === opening.dir,
);
if (!legalOpening) throw new Error(`Illegal forced opening ${opening.pit}:${opening.dir}`);
const opened = applyMove(initial, legalOpening);
if (!opened.ok) throw new Error(`Failed forced opening ${opening.pit}:${opening.dir}: ${opened.error}`);

const result = searchNegamaxPvsV3(opened.state, {
  evaluationFamily,
  maxDepth,
  nodeBudget,
  timeBudgetMs,
  aspirationWindow,
});

const openerScore = -result.score;
console.log(JSON.stringify({
  methodology: {
    phase: "Opening Balance V3",
    solver: "iterative-deepening Negamax + alpha-beta + PVS + aspiration + TT",
    evaluationFamily,
    perspective: "forced P0 opening, search from P1, reported openerScore is negated P1 root score",
    claimLimit: "bounded heuristic convergence probe; not exact game-theoretic value",
  },
  opening: `${opening.pit}:${opening.dir}`,
  config: { nodeBudget, maxDepth, timeBudgetMs, aspirationWindow },
  result: {
    openerScore,
    signal: openerScore > 0 ? "P0" : openerScore < 0 ? "P1" : "neutral",
    bestReply: result.move ? `${result.move.pit}:${result.move.dir}` : null,
    completedDepth: result.diagnostics.completedDepth,
    nodes: result.diagnostics.nodeCount,
    ttHits: result.diagnostics.ttHits,
    ttEntries: result.diagnostics.ttEntries,
    cutoffs: result.diagnostics.cutoffs,
    aspirationResearches: result.diagnostics.aspirationResearches,
    budgetReason: result.diagnostics.budgetReason,
    principalVariation: result.principalVariation.map((move) => `${move.pit}:${move.dir}`),
  },
}, null, 2));

function readEvaluationFamily(): V3EvaluationFamily {
  const value = stringArg("--evaluation") ?? "material";
  if (value === "material" || value === "strategic") return value;
  throw new Error(`Unknown evaluation family ${value}`);
}

function requiredStringArg(name: string): string {
  const value = stringArg(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
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
