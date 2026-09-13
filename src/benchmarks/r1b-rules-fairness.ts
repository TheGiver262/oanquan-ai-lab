import { writeFileSync } from "node:fs";
import {
  DEFAULT_R1B_SEARCH_CONFIG,
  enumerateR1bOpenings,
  playR1bGame,
  summarizeR1bOpening,
  type R1bAgentId,
  type R1bBranch,
  type R1bEngineId,
  type R1bGameResult,
  type R1bRuleCase,
  type R1bSearchConfig,
  type R1bSearchUsage,
} from "../research/r1b-rules-fairness.js";
import { PRODUCTION_SOURCE_COMMIT } from "../reference/server-production-ai.js";
import type { PlayerMove } from "../types.js";

type AssignmentMode = "single" | "paired";

const ruleArg = stringArg("--rule") ?? "both";
const ruleCases = readRuleCases(ruleArg);
const engineX = readEngine("--engine-x", "uct");
const engineY = readEngine("--engine-y", "uct-pb");
const assignmentMode = readAssignmentMode(stringArg("--assignment-mode") ?? "paired");
const seedBase = intArg("--seed", 20260914);
const limitOpenings = intArg("--limit-openings", Number.MAX_SAFE_INTEGER);
const openingFilter = stringArg("--opening")?.toUpperCase() ?? null;
const outPath = stringArg("--out");
const config: R1bSearchConfig = {
  simulations: intArg("--simulations", DEFAULT_R1B_SEARCH_CONFIG.simulations),
  rolloutDepth: intArg("--rollout-depth", DEFAULT_R1B_SEARCH_CONFIG.rolloutDepth),
  trangNguyenNodeBudget: intArg(
    "--tn-nodes",
    DEFAULT_R1B_SEARCH_CONFIG.trangNguyenNodeBudget,
  ),
  hardTimeCeilingMs: intArg(
    "--time-ceiling-ms",
    DEFAULT_R1B_SEARCH_CONFIG.hardTimeCeilingMs,
  ),
  maxMoves: intArg("--max-moves", DEFAULT_R1B_SEARCH_CONFIG.maxMoves),
};

validateConfig(config, limitOpenings);

const startedAt = performance.now();
const games: R1bGameResult[] = [];
const corpora: Record<string, string[]> = {};
const assignments = assignmentMode === "single"
  ? (["xy"] as const)
  : (["xy", "yx"] as const);

for (const ruleCase of ruleCases) {
  const openings = selectOpenings(enumerateR1bOpenings(ruleCase));
  corpora[ruleCase] = openings.map(moveKey);

  for (const opening of openings) {
    for (const assignment of assignments) {
      const engineByAgent = assignment === "xy"
        ? { A: engineX, B: engineY } as const
        : { A: engineY, B: engineX } as const;
      const seed = seedBase
        + hashString(`${ruleCase}:${moveKey(opening)}:${assignment}`);
      const branches: R1bBranch[] = ruleCase === "cam-quan"
        ? ["none"]
        : ["keep", "swap"];

      for (const branch of branches) {
        games.push(
          playR1bGame({
            ruleCase,
            branch,
            opening,
            assignment,
            engineByAgent,
            seed,
            config,
          }),
        );
      }
    }
  }
}

const reports = Object.fromEntries(
  ruleCases.map((ruleCase) => [ruleCase, summarizeRule(ruleCase, games, corpora[ruleCase] ?? [])]),
);

const result = {
  experiment: "R1b-1-intrinsic-opening-fairness",
  evidenceClass: "research-only",
  promotional: false,
  methodology: {
    preRegistration: "docs/r1b-rules-benchmark-protocol.md",
    productionSourceCommit: PRODUCTION_SOURCE_COMMIT,
    rulesCompared: {
      "cam-quan": "oaq:classic_2p:no_first_quan:v1",
      "standard-pie": "oaq:classic_2p:standard:v1 + forced KEEP/SWAP ownership decision",
    },
    pieDecisionPolicy: "none; KEEP and SWAP are forced and reported separately",
    engineAssignmentPairing: assignmentMode === "paired"
      ? "For every opening/branch: xy means A=X,B=Y; yx means A=Y,B=X. Under SWAP engines follow agent identity, not logical seat."
      : "Single xy assignment only. Intended for same-policy runs where X=Y; deterministic policies must not be duplicated as fake independent assignments.",
    unresolvedPolicy:
      "Games still playing at maxMoves remain unresolved; no heuristic adjudication or repetition draw is invented.",
    seedPolicy:
      "Seed is consumed by UCT-family search. Deterministic engines do not gain independent samples from seed labels.",
    trangNguyenIntegrity:
      engineX === "trang-nguyen" || engineY === "trang-nguyen"
        ? "code-parity-no-live-learning-snapshot"
        : null,
    resultWarning:
      "Smoke/small samples are correctness evidence only. Do not infer rule superiority until the pre-registered full gate is run.",
  },
  config: {
    engineX,
    engineY,
    assignmentMode,
    seedBase,
    openingFilter,
    limitOpenings: Number.isSafeInteger(limitOpenings) ? limitOpenings : null,
    ...config,
  },
  corpora,
  reports,
  rawGames: games,
  elapsedMs: performance.now() - startedAt,
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function summarizeRule(
  ruleCase: R1bRuleCase,
  allGames: R1bGameResult[],
  openingKeys: string[],
) {
  const ruleGames = allGames.filter((game) => game.ruleCase === ruleCase);
  const perOpening = Object.fromEntries(
    openingKeys.map((opening) => [opening, summarizeR1bOpening(ruleCase, opening, ruleGames)]),
  );
  const summaries = Object.values(perOpening);
  const resolvedOpeningValues = summaries.flatMap((summary) =>
    summary.pairedResolvedValue === null ? [] : [summary.pairedResolvedValue],
  );
  const allOpeningValuesResolved = summaries.length > 0
    && resolvedOpeningValues.length === summaries.length;

  const equilibriumInterval = summaries.length === 0
    ? { lower: null, upper: null, resolvedValue: null }
    : {
        lower: Math.max(...summaries.map((summary) => summary.pairedLower)),
        upper: Math.max(...summaries.map((summary) => summary.pairedUpper)),
        resolvedValue: allOpeningValuesResolved
          ? Math.max(...resolvedOpeningValues)
          : null,
      };

  const absoluteBiases = resolvedOpeningValues.map((value) => Math.abs(value));
  return {
    rawBranchGames: summarizeRawGames(ruleGames),
    byBranch: Object.fromEntries(
      [...new Set(ruleGames.map((game) => game.branch))].map((branch) => [
        branch,
        summarizeRawGames(ruleGames.filter((game) => game.branch === branch)),
      ]),
    ),
    searchUsage: summarizeSearchUsage(ruleGames),
    openingCount: summaries.length,
    fullyResolvedOpeningCount: resolvedOpeningValues.length,
    equilibriumInterval,
    medianAbsoluteOpeningBias: absoluteBiases.length > 0 ? median(absoluteBiases) : null,
    worstAbsoluteOpeningBias: absoluteBiases.length > 0 ? Math.max(...absoluteBiases) : null,
    perOpening,
  };
}

function summarizeRawGames(games: R1bGameResult[]) {
  let openerWins = 0;
  let responderWins = 0;
  let draws = 0;
  let unresolved = 0;
  let resolvedValueSum = 0;
  const lengths: number[] = [];
  for (const game of games) {
    lengths.push(game.moves);
    if (game.openerValue === null) {
      unresolved += 1;
      continue;
    }
    resolvedValueSum += game.openerValue;
    if (game.openerValue > 0) openerWins += 1;
    else if (game.openerValue < 0) responderWins += 1;
    else draws += 1;
  }
  const resolved = games.length - unresolved;
  return {
    games: games.length,
    openerWins,
    responderWins,
    draws,
    unresolved,
    unresolvedRate: games.length > 0 ? unresolved / games.length : 0,
    resolvedMeanOpenerValue: resolved > 0 ? resolvedValueSum / resolved : null,
    medianMoves: lengths.length > 0 ? median(lengths) : null,
    p95Moves: lengths.length > 0 ? percentile(lengths, 0.95) : null,
  };
}

function summarizeSearchUsage(games: R1bGameResult[]) {
  const byEngine = new Map<R1bEngineId, R1bSearchUsage>();
  for (const game of games) {
    for (const agent of ["A", "B"] as const satisfies readonly R1bAgentId[]) {
      const engine = game.engineByAgent[agent];
      const source = game.searchUsageByAgent[agent];
      const target = byEngine.get(engine) ?? emptyUsage();
      addUsage(target, source);
      byEngine.set(engine, target);
    }
  }
  return Object.fromEntries(
    [...byEngine.entries()].map(([engine, usage]) => [
      engine,
      {
        ...usage,
        averageSimulationsPerDecision:
          usage.decisions > 0 ? usage.simulations / usage.decisions : 0,
        averageExpandedNodesPerDecision:
          usage.decisions > 0 ? usage.expandedNodes / usage.decisions : 0,
        averageNodesPerDecision: usage.decisions > 0 ? usage.nodes / usage.decisions : 0,
        averageMsPerDecision: usage.decisions > 0 ? usage.elapsedMs / usage.decisions : 0,
      },
    ]),
  );
}

function emptyUsage(): R1bSearchUsage {
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

function addUsage(target: R1bSearchUsage, source: R1bSearchUsage): void {
  target.decisions += source.decisions;
  target.simulations += source.simulations;
  target.expandedNodes += source.expandedNodes;
  target.nodes += source.nodes;
  target.elapsedMs += source.elapsedMs;
  target.nodeBudgetStops += source.nodeBudgetStops;
  target.timeBudgetStops += source.timeBudgetStops;
}

function selectOpenings(openings: PlayerMove[]): PlayerMove[] {
  let selected = openings;
  if (openingFilter) {
    selected = selected.filter((move) => moveKey(move) === openingFilter);
    if (selected.length === 0) {
      throw new Error(`Opening ${openingFilter} is not legal in one of the selected rulesets.`);
    }
  }
  return selected.slice(0, Math.min(limitOpenings, selected.length));
}

function readRuleCases(value: string): R1bRuleCase[] {
  if (value === "both") return ["cam-quan", "standard-pie"];
  if (value === "cam-quan" || value === "standard-pie") return [value];
  throw new Error(`Unknown --rule ${value}; expected cam-quan|standard-pie|both`);
}

function readEngine(flag: string, fallback: R1bEngineId): R1bEngineId {
  const value = stringArg(flag) ?? fallback;
  if (value === "uct" || value === "uct-pb" || value === "trang-nguyen") return value;
  throw new Error(`Unknown ${flag} ${value}; expected uct|uct-pb|trang-nguyen`);
}

function readAssignmentMode(value: string): AssignmentMode {
  if (value === "single" || value === "paired") return value;
  throw new Error(`Unknown --assignment-mode ${value}; expected single|paired`);
}

function validateConfig(config: R1bSearchConfig, openingLimit: number): void {
  for (const [name, value] of Object.entries(config)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive integer`);
    }
  }
  if (!Number.isSafeInteger(openingLimit) || openingLimit <= 0) {
    throw new Error("limit-openings must be a positive integer");
  }
}

function moveKey(move: Pick<PlayerMove, "pit" | "dir">): string {
  return `${move.pit}:${move.dir}`;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
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

function stringArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function intArg(name: string, fallback: number): number {
  const raw = stringArg(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be an integer`);
  return value;
}
