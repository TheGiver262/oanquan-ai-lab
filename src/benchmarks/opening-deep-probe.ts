import {
  getClassicOpenings,
  parseClassicOpening,
  probeOpeningWithTrangNguyen,
} from "../research/opening-pie-analysis.js";

const openingArgs = multiStringArg("--opening");
const openings = openingArgs.length > 0
  ? openingArgs.map(parseClassicOpening)
  : getClassicOpenings();
const maxDepth = intArg("--depth", 11);
const nodeBudget = intArg("--nodes", 500_000);
const timeBudgetMs = intArg("--time", 5_000);

const rows = openings.map((opening) => {
  const probe = probeOpeningWithTrangNguyen(opening, {
    maxDepth,
    nodeBudget,
    timeBudgetMs,
  });
  return {
    opening: `${opening.pit}:${opening.dir}`,
    bestReply: probe.bestReply ? `${probe.bestReply.pit}:${probe.bestReply.dir}` : null,
    openerScore: probe.openerScore,
    absoluteScore: Math.abs(probe.openerScore),
    openerLowerBound: probe.openerLowerBound,
    openerUpperBound: probe.openerUpperBound,
    completedDepth: probe.completedDepth,
    visits: probe.visits,
    nodes: probe.nodes,
    budgetReason: probe.budgetReason,
  };
});

rows.sort((left, right) => left.absoluteScore - right.absoluteScore);

console.log(JSON.stringify({
  methodology: "bounded Trạng Nguyên best-first probe after a forced P0 opening; smaller |openerScore| is treated as closer to seat-neutral, not as a solved game value",
  config: { maxDepth, nodeBudget, timeBudgetMs },
  rows,
}, null, 2));

function multiStringArg(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) values.push(process.argv[index + 1]!);
  }
  return values;
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
