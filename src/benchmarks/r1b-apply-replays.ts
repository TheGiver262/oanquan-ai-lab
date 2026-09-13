import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import {
  summarizeR1bOpening,
  type R1bGameResult,
  type R1bRuleCase,
} from "../research/r1b-rules-fairness.js";

type Usage = {
  decisions: number;
  simulations: number;
  expandedNodes: number;
  nodes: number;
  elapsedMs: number;
  nodeBudgetStops: number;
  timeBudgetStops: number;
};

type Run = {
  experiment: string;
  promotional: boolean;
  methodology: Record<string, unknown>;
  config: {
    seedBase: number;
    simulations: number;
    rolloutDepth: number;
    trangNguyenNodeBudget: number;
    hardTimeCeilingMs: number;
    maxMoves: number;
    [key: string]: unknown;
  };
  corpora: Record<R1bRuleCase, string[]>;
  reports: Record<string, unknown>;
  rawGames: Array<R1bGameResult & {
    searchUsageByAgent?: Record<"A" | "B", Usage>;
  }>;
  elapsedMs: number;
};

const baseDir = requiredArg("--base-dir");
const replayDir = requiredArg("--replay-dir");
const outDir = requiredArg("--out-dir");
const targetMaxMoves = intArg("--target-max-moves", 320);

mkdirSync(outDir, { recursive: true });

const baseRuns = loadRuns(baseDir);
const replayRuns = loadRuns(replayDir);
if (baseRuns.length === 0) throw new Error(`No base R1b runs found under ${baseDir}`);
if (replayRuns.length === 0) throw new Error(`No replay R1b runs found under ${replayDir}`);

const replayByGame = new Map<string, { run: Run; game: Run["rawGames"][number] }>();
for (const run of replayRuns) {
  validateReplayConfig(run, targetMaxMoves);
  for (const game of run.rawGames) {
    replayByGame.set(gameKey(run.config.seedBase, game), { run, game });
  }
}

const manifest: Array<Record<string, unknown>> = [];
for (const base of baseRuns) {
  if (base.config.maxMoves > targetMaxMoves) {
    throw new Error(`Base seed ${base.config.seedBase} already has maxMoves > target cap`);
  }

  const patched = structuredClone(base);
  const originalUnresolved = patched.rawGames.filter((game) => game.unresolved).length;
  let matched = 0;
  let resolvedByReplay = 0;

  patched.rawGames = patched.rawGames.map((game) => {
    if (!game.unresolved) return game;
    const replay = replayByGame.get(gameKey(patched.config.seedBase, game));
    if (!replay) return game;
    assertCompatible(base, replay.run);
    matched += 1;
    if (!replay.game.unresolved) resolvedByReplay += 1;
    return structuredClone(replay.game);
  });

  patched.config.maxMoves = targetMaxMoves;
  patched.reports = {
    "cam-quan": summarizeRule("cam-quan", patched),
    "standard-pie": summarizeRule("standard-pie", patched),
  };
  const remainingUnresolved = patched.rawGames.filter((game) => game.unresolved).length;
  patched.methodology = {
    ...patched.methodology,
    replayPatch: {
      sourceMaxMoves: base.config.maxMoves,
      targetMaxMoves,
      policy:
        "Only originally unresolved games are replaced by exact rule/opening/branch/assignment/seed replays. Originally resolved games are preserved because increasing only the move cap cannot affect a game that already terminated before the old cap.",
      originalUnresolved,
      matched,
      resolvedByReplay,
      remainingUnresolved,
    },
  };

  const output = join(outDir, `run-${patched.config.seedBase}.json`);
  writeFileSync(output, `${JSON.stringify(patched, null, 2)}\n`, "utf8");
  manifest.push({
    seedBase: patched.config.seedBase,
    originalUnresolved,
    matched,
    resolvedByReplay,
    remainingUnresolved,
    output,
  });
}

writeFileSync(
  join(outDir, "replay-patch-manifest.json"),
  `${JSON.stringify({ targetMaxMoves, runs: manifest }, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify({ targetMaxMoves, runs: manifest }, null, 2));

function summarizeRule(ruleCase: R1bRuleCase, run: Run) {
  const games = run.rawGames.filter((game) => game.ruleCase === ruleCase);
  const openings = run.corpora[ruleCase] ?? [];
  const perOpening = Object.fromEntries(
    openings.map((opening) => [
      opening,
      summarizeR1bOpening(ruleCase, opening, games),
    ]),
  );
  const summaries = Object.values(perOpening);
  const resolvedValues = summaries.flatMap((summary) =>
    summary.pairedResolvedValue === null ? [] : [summary.pairedResolvedValue],
  );
  const fullyResolved = summaries.length > 0 && resolvedValues.length === summaries.length;
  const absoluteBiases = fullyResolved
    ? resolvedValues.map((value) => Math.abs(value))
    : [];

  return {
    rawBranchGames: rawSummary(games),
    byBranch: Object.fromEntries(
      [...new Set(games.map((game) => game.branch))].map((branch) => [
        branch,
        rawSummary(games.filter((game) => game.branch === branch)),
      ]),
    ),
    searchUsage: summarizeUsage(games),
    openingCount: summaries.length,
    fullyResolvedOpeningCount: resolvedValues.length,
    equilibriumInterval: summaries.length === 0
      ? { lower: null, upper: null, resolvedValue: null }
      : {
          lower: Math.max(...summaries.map((summary) => summary.pairedLower)),
          upper: Math.max(...summaries.map((summary) => summary.pairedUpper)),
          resolvedValue: fullyResolved ? Math.max(...resolvedValues) : null,
        },
    medianAbsoluteOpeningBias: fullyResolved ? median(absoluteBiases) : null,
    worstAbsoluteOpeningBias: fullyResolved ? Math.max(...absoluteBiases) : null,
    perOpening,
  };
}

function rawSummary(games: Run["rawGames"]) {
  let openerWins = 0;
  let responderWins = 0;
  let draws = 0;
  let unresolved = 0;
  let sum = 0;
  const lengths: number[] = [];

  for (const game of games) {
    lengths.push(game.moves);
    if (game.openerValue === null) {
      unresolved += 1;
      continue;
    }
    sum += game.openerValue;
    if (game.openerValue > 0) openerWins += 1;
    else if (game.openerValue < 0) responderWins += 1;
    else draws += 1;
  }

  const resolved = games.length - unresolved;
  return {
    games: games.length,
    resolved,
    openerWins,
    responderWins,
    draws,
    unresolved,
    unresolvedRate: games.length > 0 ? unresolved / games.length : 0,
    resolvedMeanOpenerValue: resolved > 0 ? sum / resolved : null,
    medianMoves: lengths.length > 0 ? median(lengths) : null,
    p95Moves: lengths.length > 0 ? percentile(lengths, 0.95) : null,
  };
}

function summarizeUsage(games: Run["rawGames"]) {
  const totals: Record<string, Usage> = {};
  for (const game of games) {
    for (const agent of ["A", "B"] as const) {
      const engine = game.engineByAgent[agent];
      const usage = game.searchUsageByAgent?.[agent];
      if (!usage) continue;
      const total = totals[engine] ?? (totals[engine] = emptyUsage());
      total.decisions += usage.decisions;
      total.simulations += usage.simulations;
      total.expandedNodes += usage.expandedNodes;
      total.nodes += usage.nodes;
      total.elapsedMs += usage.elapsedMs;
      total.nodeBudgetStops += usage.nodeBudgetStops;
      total.timeBudgetStops += usage.timeBudgetStops;
    }
  }

  return Object.fromEntries(Object.entries(totals).map(([engine, usage]) => [
    engine,
    {
      ...usage,
      averageSimulationsPerDecision:
        usage.decisions > 0 ? usage.simulations / usage.decisions : 0,
      averageNodesPerDecision:
        usage.decisions > 0 ? usage.nodes / usage.decisions : 0,
      averageMsPerDecision:
        usage.decisions > 0 ? usage.elapsedMs / usage.decisions : 0,
    },
  ]));
}

function emptyUsage(): Usage {
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

function assertCompatible(base: Run, replay: Run): void {
  for (const field of [
    "simulations",
    "rolloutDepth",
    "trangNguyenNodeBudget",
    "hardTimeCeilingMs",
  ] as const) {
    if (base.config[field] !== replay.config[field]) {
      throw new Error(
        `Replay config mismatch ${field}: base=${base.config[field]} replay=${replay.config[field]}`,
      );
    }
  }
  if (base.config.seedBase !== replay.config.seedBase) {
    throw new Error("Replay seedBase mismatch");
  }
}

function validateReplayConfig(run: Run, target: number): void {
  if (run.config.maxMoves !== target) {
    throw new Error(
      `Replay seed ${run.config.seedBase} maxMoves=${run.config.maxMoves}; expected ${target}`,
    );
  }
}

function gameKey(seedBase: number, game: R1bGameResult): string {
  return [
    seedBase,
    game.ruleCase,
    game.opening,
    game.branch,
    game.assignment,
    game.seed,
  ].join("|");
}

function loadRuns(dir: string): Run[] {
  return findJsonFiles(dir)
    .map((file) => JSON.parse(readFileSync(file, "utf8")) as Run)
    .filter((run) => run.experiment === "R1b-1-intrinsic-opening-fairness");
}

function findJsonFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) found.push(...findJsonFiles(path));
    else if (stat.isFile() && entry.endsWith(".json")) found.push(path);
  }
  return found.sort((a, b) => basename(a).localeCompare(basename(b)));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function percentile(values: number[], quantile: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

function requiredArg(name: string): string {
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
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
