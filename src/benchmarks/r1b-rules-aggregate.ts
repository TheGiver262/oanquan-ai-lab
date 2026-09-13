import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type RuleCase = "cam-quan" | "standard-pie";

type OpeningSummary = {
  pairedResolvedValue: number | null;
  pairedLower: number;
  pairedUpper: number;
};

type SearchUsage = {
  decisions: number;
  simulations: number;
  expandedNodes: number;
  nodes: number;
  elapsedMs: number;
  nodeBudgetStops: number;
  timeBudgetStops: number;
};

type RawSummary = {
  games: number;
  openerWins: number;
  responderWins: number;
  draws: number;
  unresolved: number;
};

type RuleReport = {
  rawBranchGames: RawSummary;
  byBranch: Record<string, RawSummary>;
  searchUsage: Record<string, SearchUsage & Record<string, number>>;
  openingCount: number;
  fullyResolvedOpeningCount: number;
  equilibriumInterval: { lower: number; upper: number; resolvedValue: number | null };
  medianAbsoluteOpeningBias: number | null;
  worstAbsoluteOpeningBias: number | null;
  perOpening: Record<string, OpeningSummary>;
};

type RunArtifact = {
  experiment: string;
  promotional: boolean;
  config: {
    engineX: string;
    engineY: string;
    assignmentMode?: string;
    seedBase: number;
    simulations: number;
    rolloutDepth: number;
    trangNguyenNodeBudget: number;
    hardTimeCeilingMs: number;
    maxMoves: number;
  };
  corpora: Record<RuleCase, string[]>;
  reports: Record<RuleCase, RuleReport>;
};

const inputDir = stringArg("--input-dir");
if (!inputDir) throw new Error("--input-dir is required");
const outPath = stringArg("--out");
const stochastic = boolArg("--stochastic", true);
const bootstrapSamples = intArg("--bootstrap-samples", 10_000);
const bootstrapSeed = intArg("--bootstrap-seed", 20260914);

const files = findJsonFiles(inputDir);
const runs = files
  .map((file) => ({ file, run: JSON.parse(readFileSync(file, "utf8")) as RunArtifact }))
  .filter(({ run }) => run.experiment === "R1b-1-intrinsic-opening-fairness");

if (runs.length === 0) throw new Error(`No R1b run artifacts found under ${inputDir}`);
validateRuns(runs.map(({ run }) => run));

const orderedRuns = [...runs].sort((a, b) => a.run.config.seedBase - b.run.config.seedBase);
const byRule = {
  "cam-quan": aggregateRule("cam-quan", orderedRuns.map(({ run }) => run)),
  "standard-pie": aggregateRule("standard-pie", orderedRuns.map(({ run }) => run)),
};

const seedLevel = orderedRuns.map(({ file, run }) => ({
  file,
  seedBase: run.config.seedBase,
  camQuan: seedMetrics(run.reports["cam-quan"]),
  standardPie: seedMetrics(run.reports["standard-pie"]),
}));

const pairedMetrics = seedLevel.flatMap((entry) => {
  const cam = entry.camQuan;
  const pie = entry.standardPie;
  if (
    cam.equilibrium === null
    || pie.equilibrium === null
    || cam.medianAbs === null
    || pie.medianAbs === null
    || cam.worstAbs === null
    || pie.worstAbs === null
  ) return [];
  return [{
    seedBase: entry.seedBase,
    camEquilibrium: cam.equilibrium,
    pieEquilibrium: pie.equilibrium,
    deltaAbsoluteEquilibriumBias: Math.abs(pie.equilibrium) - Math.abs(cam.equilibrium),
    deltaMedianAbsoluteBias: pie.medianAbs - cam.medianAbs,
    deltaWorstAbsoluteBias: pie.worstAbs - cam.worstAbs,
  }];
});

const ci = stochastic && pairedMetrics.length >= 2
  ? {
      pieEquilibriumMean: bootstrapMeanCi(
        pairedMetrics.map((entry) => entry.pieEquilibrium),
        bootstrapSamples,
        bootstrapSeed ^ 0x13579bdf,
      ),
      deltaAbsoluteEquilibriumBiasMean: bootstrapMeanCi(
        pairedMetrics.map((entry) => entry.deltaAbsoluteEquilibriumBias),
        bootstrapSamples,
        bootstrapSeed ^ 0x2468ace0,
      ),
      deltaMedianAbsoluteBiasMean: bootstrapMeanCi(
        pairedMetrics.map((entry) => entry.deltaMedianAbsoluteBias),
        bootstrapSamples,
        bootstrapSeed ^ 0x10203040,
      ),
      deltaWorstAbsoluteBiasMean: bootstrapMeanCi(
        pairedMetrics.map((entry) => entry.deltaWorstAbsoluteBias),
        bootstrapSamples,
        bootstrapSeed ^ 0x55667788,
      ),
    }
  : null;

const camMedian = byRule["cam-quan"].medianAbsoluteOpeningBias;
const pieMedian = byRule["standard-pie"].medianAbsoluteOpeningBias;
const camWorst = byRule["cam-quan"].worstAbsoluteOpeningBias;
const pieWorst = byRule["standard-pie"].worstAbsoluteOpeningBias;
const camEq = byRule["cam-quan"].equilibriumResolvedValue;
const pieEq = byRule["standard-pie"].equilibriumResolvedValue;

const medianRelativeImprovement = relativeImprovement(camMedian, pieMedian);
const worstRelativeImprovement = relativeImprovement(camWorst, pieWorst);
const equilibriumAbsoluteRegression = camEq === null || pieEq === null
  ? null
  : Math.abs(pieEq) - Math.abs(camEq);
const combinedGames = byRule["cam-quan"].raw.games + byRule["standard-pie"].raw.games;
const combinedUnresolved = byRule["cam-quan"].raw.unresolved + byRule["standard-pie"].raw.unresolved;
const unresolvedRate = combinedGames > 0 ? combinedUnresolved / combinedGames : 0;

const gatePrecheck = {
  fullyResolved:
    byRule["cam-quan"].fullyResolved
    && byRule["standard-pie"].fullyResolved,
  unresolvedRate,
  unresolvedPass: unresolvedRate <= 0.01,
  medianRelativeImprovement,
  medianImprovementPass:
    medianRelativeImprovement !== null && medianRelativeImprovement >= 0.25,
  worstRelativeImprovement,
  worstImprovementPass:
    worstRelativeImprovement !== null && worstRelativeImprovement >= 0.20,
  equilibriumAbsoluteRegression,
  equilibriumRegressionPass:
    equilibriumAbsoluteRegression !== null && equilibriumAbsoluteRegression <= 0.05,
  pieEquilibriumCiInsidePracticalNeutralBand:
    ci !== null
    && ci.pieEquilibriumMean.lower >= -0.10
    && ci.pieEquilibriumMean.upper <= 0.10,
};

const result = {
  experiment: "R1b-1-fixed-resource-aggregate",
  evidenceClass: "research-only",
  promotional: false,
  inputFiles: orderedRuns.map(({ file }) => file),
  config: {
    engineX: orderedRuns[0]?.run.config.engineX,
    engineY: orderedRuns[0]?.run.config.engineY,
    assignmentMode: orderedRuns[0]?.run.config.assignmentMode,
    simulations: orderedRuns[0]?.run.config.simulations,
    rolloutDepth: orderedRuns[0]?.run.config.rolloutDepth,
    trangNguyenNodeBudget: orderedRuns[0]?.run.config.trangNguyenNodeBudget,
    hardTimeCeilingMs: orderedRuns[0]?.run.config.hardTimeCeilingMs,
    maxMoves: orderedRuns[0]?.run.config.maxMoves,
    stochastic,
    seedBases: orderedRuns.map(({ run }) => run.config.seedBase),
    bootstrapSamples: stochastic ? bootstrapSamples : 0,
    bootstrapSeed: stochastic ? bootstrapSeed : null,
  },
  methodology: {
    samplingUnit: stochastic
      ? "complete-corpus true RNG seed; A/B rules remain paired within each seed"
      : "deterministic fixed-resource corpus; repeated labels do not create independent samples",
    bootstrap: stochastic
      ? "paired seed-level nonparametric bootstrap of mean metrics"
      : "disabled for deterministic evidence",
    unresolved: "conservative opening intervals retained; unresolved games are not scored as draws",
  },
  byRule,
  seedLevel,
  pairedMetrics,
  confidenceIntervals95: ci,
  gatePrecheck,
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function aggregateRule(ruleCase: RuleCase, runs: RunArtifact[]) {
  const corpus = runs[0]?.corpora[ruleCase] ?? [];
  const perOpening = Object.fromEntries(corpus.map((opening) => {
    const observations = runs.map((run) => run.reports[ruleCase].perOpening[opening]);
    if (observations.some((entry) => !entry)) {
      throw new Error(`Missing ${ruleCase} opening ${opening} in one or more runs`);
    }
    const typed = observations as OpeningSummary[];
    const allResolved = typed.every((entry) => entry.pairedResolvedValue !== null);
    return [opening, {
      runs: typed.length,
      meanLower: mean(typed.map((entry) => entry.pairedLower)),
      meanUpper: mean(typed.map((entry) => entry.pairedUpper)),
      meanResolvedValue: allResolved
        ? mean(typed.map((entry) => entry.pairedResolvedValue as number))
        : null,
    }];
  }));

  const openingRows = Object.values(perOpening);
  const allOpeningsResolved = openingRows.length > 0
    && openingRows.every((entry) => entry.meanResolvedValue !== null);
  const resolvedValues = allOpeningsResolved
    ? openingRows.map((entry) => entry.meanResolvedValue as number)
    : [];
  const raw = sumRaw(runs.map((run) => run.reports[ruleCase].rawBranchGames));
  const byBranch = sumBranches(runs.map((run) => run.reports[ruleCase].byBranch));
  const searchUsage = sumSearchUsage(runs.map((run) => run.reports[ruleCase].searchUsage));

  return {
    corpus,
    runCount: runs.length,
    fullyResolved: allOpeningsResolved,
    raw,
    byBranch,
    searchUsage,
    equilibriumInterval: openingRows.length > 0
      ? {
          lower: Math.max(...openingRows.map((entry) => entry.meanLower)),
          upper: Math.max(...openingRows.map((entry) => entry.meanUpper)),
        }
      : { lower: null, upper: null },
    equilibriumResolvedValue: allOpeningsResolved ? Math.max(...resolvedValues) : null,
    medianAbsoluteOpeningBias:
      allOpeningsResolved ? median(resolvedValues.map((value) => Math.abs(value))) : null,
    worstAbsoluteOpeningBias:
      allOpeningsResolved ? Math.max(...resolvedValues.map((value) => Math.abs(value))) : null,
    perOpening,
  };
}

function seedMetrics(report: RuleReport) {
  return {
    equilibrium: report.equilibriumInterval.resolvedValue,
    medianAbs: report.medianAbsoluteOpeningBias,
    worstAbs: report.worstAbsoluteOpeningBias,
    unresolved: report.rawBranchGames.unresolved,
    games: report.rawBranchGames.games,
  };
}

function sumRaw(values: RawSummary[]): RawSummary & { unresolvedRate: number } {
  const sum = values.reduce(
    (acc, value) => ({
      games: acc.games + value.games,
      openerWins: acc.openerWins + value.openerWins,
      responderWins: acc.responderWins + value.responderWins,
      draws: acc.draws + value.draws,
      unresolved: acc.unresolved + value.unresolved,
    }),
    { games: 0, openerWins: 0, responderWins: 0, draws: 0, unresolved: 0 },
  );
  return { ...sum, unresolvedRate: sum.games > 0 ? sum.unresolved / sum.games : 0 };
}

function sumBranches(values: Array<Record<string, RawSummary>>) {
  const branchNames = [...new Set(values.flatMap((value) => Object.keys(value)))];
  return Object.fromEntries(
    branchNames.map((branch) => [
      branch,
      sumRaw(values.flatMap((value) => value[branch] ? [value[branch]] : [])),
    ]),
  );
}

function sumSearchUsage(values: Array<Record<string, SearchUsage & Record<string, number>>>) {
  const engines = [...new Set(values.flatMap((value) => Object.keys(value)))];
  return Object.fromEntries(engines.map((engine) => {
    const summed = values.reduce((acc, value) => {
      const source = value[engine];
      if (!source) return acc;
      acc.decisions += source.decisions;
      acc.simulations += source.simulations;
      acc.expandedNodes += source.expandedNodes;
      acc.nodes += source.nodes;
      acc.elapsedMs += source.elapsedMs;
      acc.nodeBudgetStops += source.nodeBudgetStops;
      acc.timeBudgetStops += source.timeBudgetStops;
      return acc;
    }, emptyUsage());
    return [engine, {
      ...summed,
      averageSimulationsPerDecision:
        summed.decisions > 0 ? summed.simulations / summed.decisions : 0,
      averageNodesPerDecision: summed.decisions > 0 ? summed.nodes / summed.decisions : 0,
      averageMsPerDecision: summed.decisions > 0 ? summed.elapsedMs / summed.decisions : 0,
    }];
  }));
}

function emptyUsage(): SearchUsage {
  return {
    decisions: 0,
    simulations: 0,
    expandedNodes: 0,
    nodes: 0,
    elapsedMs: 0,
    nodeBudgetStops: 0,
    timeBudgetStops: 0,
  };
}

function validateRuns(runs: RunArtifact[]): void {
  const first = runs[0];
  if (!first) throw new Error("No runs");
  for (const run of runs) {
    if (run.promotional !== false) throw new Error("R1b source artifact must be research-only");
    if (run.config.engineX !== first.config.engineX || run.config.engineY !== first.config.engineY) {
      throw new Error("Cannot aggregate different engine configurations");
    }
    if ((run.config.assignmentMode ?? "paired") !== (first.config.assignmentMode ?? "paired")) {
      throw new Error("Cannot aggregate different assignment modes");
    }
    for (const field of [
      "simulations",
      "rolloutDepth",
      "trangNguyenNodeBudget",
      "hardTimeCeilingMs",
      "maxMoves",
    ] as const) {
      if (run.config[field] !== first.config[field]) {
        throw new Error(`Cannot aggregate runs with different ${field}`);
      }
    }
    for (const ruleCase of ["cam-quan", "standard-pie"] as const) {
      if (JSON.stringify(run.corpora[ruleCase]) !== JSON.stringify(first.corpora[ruleCase])) {
        throw new Error(`Corpus mismatch for ${ruleCase}`);
      }
    }
  }
  const seeds = runs.map((run) => run.config.seedBase);
  if (new Set(seeds).size !== seeds.length) throw new Error("Duplicate seedBase input detected");
}

function relativeImprovement(
  baseline: number | null,
  candidate: number | null,
): number | null {
  if (baseline === null || candidate === null) return null;
  if (baseline === 0) return candidate === 0 ? 0 : Number.NEGATIVE_INFINITY;
  return (baseline - candidate) / baseline;
}

function bootstrapMeanCi(values: number[], samples: number, seed: number) {
  const random = mulberry32(seed);
  const estimates: number[] = [];
  for (let sample = 0; sample < samples; sample += 1) {
    let sum = 0;
    for (let index = 0; index < values.length; index += 1) {
      const picked = values[Math.floor(random() * values.length)] ?? 0;
      sum += picked;
    }
    estimates.push(sum / values.length);
  }
  estimates.sort((a, b) => a - b);
  return {
    estimate: mean(values),
    lower: quantileSorted(estimates, 0.025),
    upper: quantileSorted(estimates, 0.975),
  };
}

function findJsonFiles(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) found.push(...findJsonFiles(path));
    else if (entry.endsWith(".json")) found.push(path);
  }
  return found;
}

function quantileSorted(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.floor(q * (values.length - 1))));
  return values[index] ?? 0;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
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

function stringArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function intArg(name: string, fallback: number): number {
  const raw = stringArg(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function boolArg(name: string, fallback: boolean): boolean {
  const raw = stringArg(name);
  if (raw === null) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be true or false`);
}
