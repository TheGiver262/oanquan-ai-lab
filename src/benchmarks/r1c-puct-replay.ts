import { writeFileSync } from "node:fs";
import { applyMove, createInitialState, getLegalMoves } from "../engine.js";
import { chooseFrozenPuctV2 } from "../research/puct-v2.js";
import { ReusableScoreBoundedPuct } from "../research/puct-v3a.js";
import { parseClassicOpening } from "../research/opening-pie-analysis.js";
import type { PlayerId, PlayerMove } from "../types.js";

type EngineId = "puct-v2" | "puct-v3a";
type Score = 0 | 0.5 | 1;

type GameResult = {
  position: string;
  candidateSeat: PlayerId;
  winner: PlayerId | null;
  unresolved: boolean;
  moves: number;
  candidateScore: Score | null;
};

const candidate = readEngine("--candidate", "puct-v3a");
const baseline = readEngine("--baseline", "puct-v2");
const simulations = intArg("--simulations", 4_000);
const maxMoves = intArg("--max-moves", 512);
const positionLabels = requiredArg("--positions")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const outPath = stringArg("--out");

if (positionLabels.length === 0) throw new Error("--positions cannot be empty");

const details: GameResult[] = [];
const perPosition: Record<string, {
  games: number;
  candidatePoints: number;
  unresolved: number;
  pairDiff: number | null;
}> = {};

for (const label of positionLabels) {
  const prefix = parsePosition(label);
  const games = (["P0", "P1"] as const).map((candidateSeat) =>
    playPosition(label, prefix, candidateSeat)
  );
  details.push(...games);
  const unresolved = games.filter((game) => game.unresolved).length;
  const candidatePoints = games.reduce(
    (sum, game) => sum + (game.candidateScore ?? 0),
    0,
  );
  perPosition[label] = {
    games: 2,
    candidatePoints,
    unresolved,
    pairDiff: unresolved === 0 ? candidatePoints - (2 - candidatePoints) : null,
  };
}

const completedPairDiffs = Object.values(perPosition)
  .flatMap((entry) => entry.pairDiff === null ? [] : [entry.pairDiff]);
const result = {
  experiment: "R1c-targeted-puct-replay",
  evidenceClass: "deterministic-censor-resolution",
  ruleset: "oaq:classic_2p:standard:v1",
  methodology: {
    candidate,
    baseline,
    deterministic: true,
    randomSeeds: "none",
    resourceMode: "fixed simulations; no wall-clock search cap",
    replayPolicy:
      "Only prefixes that were censored in Stage 1 are replayed at a higher move cap. Both candidate seats are rerun so pairDiff remains inspectable.",
    unresolved: "Still-playing games at maxMoves remain censored.",
  },
  config: {
    simulations,
    maxMoves,
    positions: positionLabels,
    puctExploration: 1.5,
    policyTemperature: 0.6,
  },
  games: details.length,
  unresolved: details.filter((game) => game.unresolved).length,
  completedPairs: completedPairDiffs.length,
  meanPairDiff: mean(completedPairDiffs),
  favorablePairs: completedPairDiffs.filter((value) => value > 0).length,
  neutralPairs: completedPairDiffs.filter((value) => value === 0).length,
  unfavorablePairs: completedPairDiffs.filter((value) => value < 0).length,
  pairDiffs: completedPairDiffs,
  perPosition,
  details,
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function parsePosition(label: string): PlayerMove[] {
  const [openingRaw, replyRaw, extra] = label.split(">");
  if (!openingRaw || !replyRaw || extra) {
    throw new Error(`Expected two-ply position OPENING>REPLY, got ${label}`);
  }
  const opening = parseClassicOpening(openingRaw);
  const opened = applyMove(createInitialState(), opening);
  if (!opened.ok) throw new Error(`Failed opening ${openingRaw}: ${opened.error}`);
  const [pitRaw, dirRaw] = replyRaw.toUpperCase().split(":");
  const reply = getLegalMoves(opened.state).find(
    (move) => move.pit === pitRaw && move.dir === dirRaw,
  );
  if (!reply) throw new Error(`Reply ${replyRaw} is not legal after ${openingRaw}`);
  return [opening, reply];
}

function playPosition(
  label: string,
  prefix: PlayerMove[],
  candidateSeat: PlayerId,
): GameResult {
  let state = createInitialState();
  for (const move of prefix) {
    const applied = applyMove(state, move);
    if (!applied.ok) throw new Error(`Illegal prefix ${label}: ${applied.error}`);
    state = applied.state;
  }

  const candidateV3 = candidate === "puct-v3a" ? new ReusableScoreBoundedPuct() : null;
  const baselineV3 = baseline === "puct-v3a" ? new ReusableScoreBoundedPuct() : null;

  while (state.status === "playing" && state.moveNumber < maxMoves) {
    const isCandidate = state.currentPlayer === candidateSeat;
    const engine = isCandidate ? candidate : baseline;
    let move: PlayerMove | null;
    if (engine === "puct-v3a") {
      const session = isCandidate ? candidateV3 : baselineV3;
      if (!session) throw new Error("Missing V3A session");
      move = session.chooseMove(state, {
        simulations,
        puctExploration: 1.5,
        policyTemperature: 0.6,
      }).move;
    } else {
      move = chooseFrozenPuctV2(state, {
        simulations,
        puctExploration: 1.5,
        policyTemperature: 0.6,
      }).move;
    }

    if (!move) return unresolved(label, candidateSeat, state.moveNumber);
    const applied = applyMove(state, move);
    if (!applied.ok) throw new Error(`Illegal engine move: ${applied.error}`);
    state = applied.state;
  }

  if (state.status !== "finished") return unresolved(label, candidateSeat, state.moveNumber);
  return {
    position: label,
    candidateSeat,
    winner: state.winner,
    unresolved: false,
    moves: state.moveNumber,
    candidateScore: state.winner === null
      ? 0.5
      : state.winner === candidateSeat
        ? 1
        : 0,
  };
}

function unresolved(
  position: string,
  candidateSeat: PlayerId,
  moves: number,
): GameResult {
  return {
    position,
    candidateSeat,
    winner: null,
    unresolved: true,
    moves,
    candidateScore: null,
  };
}

function readEngine(name: string, fallback: EngineId): EngineId {
  const value = stringArg(name) ?? fallback;
  if (value === "puct-v2" || value === "puct-v3a") return value;
  throw new Error(`${name} must be puct-v2|puct-v3a`);
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

function mean(values: number[]): number | null {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}
