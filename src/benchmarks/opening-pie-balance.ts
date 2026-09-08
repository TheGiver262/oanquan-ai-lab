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
  const keepMean = summary.keep.resolvedMean;
  const swapMean = summary.swap.resolvedMean;
  const openerWorstCaseResolvedEv = keepMean === null || swapMean === null
    ? null
    : Math.min(keepMean, swapMean);
  const branchAntisymmetryError = keepMean === null || swapMean === null
    ? null
    : Math.abs(keepMean + swapMean);
  const seatValueEstimate = keepMean === null || swapMean === null
    ? null
    : (keepMean - swapMean) / 2;
  const seatAdvantageMagnitude = seatValueEstimate === null ? null : Math.abs(seatValueEstimate);

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
    openerWorstCaseResolvedEv,
    openerWorstCaseLower: summary.guaranteedLower,
    openerWorstCaseUpper: summary.guaranteedUpper,
    branchAntisymmetryError,
    seatValueEstimate,
    seatAdvantageMagnitude,
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
  const leftSeatMagnitude = left.seatAdvantageMagnitude ?? Infinity;
  const rightSeatMagnitude = right.seatAdvantageMagnitude ?? Infinity;
  if (leftSeatMagnitude !== rightSeatMagnitude) return leftSeatMagnitude - rightSeatMagnitude;
  return Math.abs(left.probe.openerScore) - Math.abs(right.probe.openerScore);
});

console.log(JSON.stringify({
  methodology: {
    openerAgent: "A",
    responderAgent: "B",
    keep: "A stays P0; B stays P1 and makes move 2",
    swap: "B takes P0; A takes P1; swap consumes B decision; A makes move 2 as P1",
    openerValue: "win=+1 draw=0 loss=-1; unresolved contributes [-1,+1] interval",
    pieTheory: "For symmetric play with logical-seat value V after opening X: KEEP=V, SWAP=-V, responder chooses min(V,-V)=-|V|. Pie protects against opener choosing a favorable seat but does not imply a 50/50 opening.",
    seatValueEstimate: "(KEEP_EV - SWAP_EV)/2 when both branches resolve; magnitude closer to 0 is more seat-neutral in this sample",
    branchAntisymmetryError: "abs(KEEP_EV + SWAP_EV); 0 is expected when KEEP/SWAP differ only by agent-seat ownership",
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
