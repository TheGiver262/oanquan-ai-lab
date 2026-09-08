import {
  getClassicOpenings,
  parseClassicOpening,
  playTrangNguyenPieBranch,
  probeOpeningWithTrangNguyen,
  summarizePieOpening,
} from "../research/opening-pie-analysis.js";

const openingArg = stringArg("--opening");
const replicates = intArg("--replicates", 3);
const seedBase = intArg("--seed", 20260908);
const maxMoves = intArg("--max-moves", 160);
const timeBudgetMs = intArg("--time", 1_200);
const nodeBudget = intArg("--nodes", 100_000);
const probeDepth = intArg("--probe-depth", 11);
const probeTimeBudgetMs = intArg("--probe-time", 1_200);
const probeNodeBudget = intArg("--probe-nodes", 100_000);

const openings = openingArg ? [parseClassicOpening(openingArg)] : getClassicOpenings();
const rows = openings.map((opening, openingIndex) => {
  const probe = probeOpeningWithTrangNguyen(opening, {
    maxDepth: probeDepth,
    timeBudgetMs: probeTimeBudgetMs,
    nodeBudget: probeNodeBudget,
  });

  const games = [];
  for (let replicate = 0; replicate < replicates; replicate += 1) {
    const seed = seedBase + openingIndex * 100_003 + replicate * 7_919;
    games.push(playTrangNguyenPieBranch(opening, "keep", {
      seed,
      maxMoves,
      timeBudgetMs,
      nodeBudget,
    }));
    games.push(playTrangNguyenPieBranch(opening, "swap", {
      seed,
      maxMoves,
      timeBudgetMs,
      nodeBudget,
    }));
  }

  const summary = summarizePieOpening(opening, games);
  return {
    opening: `${opening.pit}:${opening.dir}`,
    probe: {
      bestReply: probe.bestReply ? `${probe.bestReply.pit}:${probe.bestReply.dir}` : null,
      openerScore: probe.openerScore,
      openerLowerBound: probe.openerLowerBound,
      openerUpperBound: probe.openerUpperBound,
      completedDepth: probe.completedDepth,
      visits: probe.visits,
      nodes: probe.nodes,
      budgetReason: probe.budgetReason,
    },
    keep: summary.keep,
    swap: summary.swap,
    guaranteedResolvedEv: summary.guaranteedResolvedEv,
    guaranteedLower: summary.guaranteedLower,
    guaranteedUpper: summary.guaranteedUpper,
    classification: summary.classification,
    games: summary.games.map((game) => ({
      branch: game.branch,
      moverAfterDecision: game.moverAfterDecision,
      winnerSeat: game.winnerSeat,
      winnerAgent: game.winnerAgent,
      openerAgentValue: game.openerAgentValue,
      unresolved: game.unresolved,
      moves: game.moves,
    })),
  };
});

rows.sort((left, right) => {
  if (right.guaranteedLower !== left.guaranteedLower) return right.guaranteedLower - left.guaranteedLower;
  if (right.guaranteedUpper !== left.guaranteedUpper) return right.guaranteedUpper - left.guaranteedUpper;
  return right.probe.openerScore - left.probe.openerScore;
});

console.log(JSON.stringify({
  methodology: {
    openerAgent: "A",
    responderAgent: "B",
    keep: "A stays P0; B stays P1 and makes move 2",
    swap: "B takes P0; A takes P1; swap consumes B decision; A makes move 2 as P1",
    openerValue: "win=+1 draw=0 loss=-1; unresolved contributes [-1,+1] interval",
    engine: "server production-reference Trang Nguyen production-max, no live learning snapshot",
  },
  config: {
    openings: openings.length,
    replicatesPerOpening: replicates,
    gamesPerOpening: replicates * 2,
    timeBudgetMs,
    nodeBudget,
    maxMoves,
    probeDepth,
    probeTimeBudgetMs,
    probeNodeBudget,
    seedBase,
  },
  rows,
}, null, 2));

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
