import { writeFileSync } from "node:fs";
import {
  applyBalanceAction,
  balanceActionKey,
  createBalanceInitialState,
  getBalanceActions,
  type BalanceAction,
  type BalanceState,
} from "../research/balance-modes.js";
import { ModeAwarePuctV3A } from "../research/mode-aware-puct-v3a.js";

type CaseId = "move2" | "move34";

const caseId = readCase("--case", "move2");
const fixedSimulations = intArg(
  "--fixed-simulations",
  caseId === "move2" ? 99_066 : 90_000,
);
const leafScoreWeight = numberArg("--leaf-score-weight", 1.8);
const leafBootstrap = readBootstrap("--leaf-bootstrap", "static");
const leafQuiescenceScoreSwing = numberArg("--leaf-quiescence-score-swing", 10);
const leafScoreMaterialMax = numberArg("--leaf-score-material-max", Number.POSITIVE_INFINITY);
const outPath = stringArg("--out");

const definition = buildCase(caseId);
const decision = new ModeAwarePuctV3A().chooseAction(definition.state, {
  simulations: fixedSimulations,
  puctExploration: 1.5,
  policyTemperature: 0.6,
  leafScoreWeight,
  leafBootstrap,
  leafQuiescenceScoreSwing,
  leafScoreMaterialMax,
  auditRootLeaves: true,
});
if (!decision.action || !decision.rootLeafAudit) {
  throw new Error("Leaf-score ablation root decision incomplete");
}

const stats = new Map(
  decision.rootStats.map((entry, index) => [
    balanceActionKey(entry.action),
    {
      rank: index + 1,
      visits: entry.visits,
      meanValue: entry.meanValue,
      prior: entry.prior,
      solvedOutcome: entry.solvedOutcome,
    },
  ] as const),
);
const audits = new Map(
  decision.rootLeafAudit.map((entry) => [balanceActionKey(entry.action), entry] as const),
);

const result = {
  experiment: "v3a1-leaf-score-root-ablation-v1",
  methodology: {
    caseId,
    fixedSimulations,
    leafScoreWeight,
    leafBootstrap,
    leafQuiescenceScoreSwing,
    leafScoreMaterialMax,
    puctExploration: 1.5,
    policyTemperature: 0.6,
    policyPriorScoreWeight: 1.8,
    onlyLeafValueScoreWeightChanges: true,
    freshRoot: true,
    reflectionCanonicalization: true,
  },
  prefix: definition.prefix,
  targetBoardMove: definition.state.game.moveNumber,
  selectedAction: balanceActionKey(decision.action),
  diagnostics: decision.diagnostics,
  focus: definition.focus.map((action) => ({
    action,
    stats: stats.get(action) ?? null,
    audit: audits.get(action) ?? null,
  })),
  rootStats: decision.rootStats.map((entry, index) => ({
    rank: index + 1,
    action: balanceActionKey(entry.action),
    visits: entry.visits,
    meanValue: entry.meanValue,
    prior: entry.prior,
    solvedOutcome: entry.solvedOutcome,
  })),
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json, "utf8");
console.log(json);

function buildCase(id: CaseId): {
  state: BalanceState;
  prefix: string[];
  focus: [string, string];
} {
  if (id === "move2") {
    const prefix = ["B3:CW", "T2:CW"];
    return {
      state: replay(prefix),
      prefix,
      focus: ["B4:CW", "B5:CCW"],
    };
  }

  const prefix = [
    "B3:CW",
    "T2:CW",
    "B5:CCW",
    "T3:CW",
    "B1:CW",
    "T2:CCW",
    "B5:CW",
    "T1:CCW",
    "B1:CW",
    "T2:CCW",
    "B5:CCW",
    "T5:CW",
    "B3:CCW",
    "T5:CW",
    "B4:CCW",
    "T2:CCW",
    "B1:CW",
    "T2:CCW",
    "B5:CCW",
    "T3:CW",
    "B5:CCW",
    "T4:CW",
    "B2:CW",
    "T1:CCW",
    "B2:CW",
    "T5:CW",
    "B3:CCW",
    "T5:CW",
    "B4:CCW",
    "T2:CCW",
    "B1:CW",
    "T2:CCW",
    "B5:CCW",
    "T3:CW",
  ];
  return {
    state: replay(prefix),
    prefix,
    focus: ["B2:CW", "B5:CCW"],
  };
}

function replay(prefix: string[]): BalanceState {
  let state = createBalanceInitialState("quan-gia-threefold", "A");
  for (const key of prefix) {
    if (state.game.status !== "playing") {
      throw new Error(`Unexpected finish before ${key}`);
    }
    const action = findMove(state, key);
    if (!action) {
      throw new Error(`Illegal replay action ${key} at move ${state.game.moveNumber}`);
    }
    const next = applyBalanceAction(state, action);
    if (!next.ok) throw new Error(next.error);
    state = next.state;
  }
  return state;
}

function findMove(target: BalanceState, key: string): BalanceAction | undefined {
  return getBalanceActions(target).find(
    (action) =>
      action.kind === "move"
      && balanceActionKey(action).toUpperCase() === key.toUpperCase(),
  );
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

function numberArg(name: string, fallback: number): number {
  const raw = stringArg(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative number`);
  }
  return value;
}

function readCase(name: string, fallback: CaseId): CaseId {
  const value = stringArg(name) ?? fallback;
  if (value === "move2" || value === "move34") return value;
  throw new Error(`${name} must be move2 or move34`);
}


function readBootstrap(
  name: string,
  fallback: "static" | "one_ply" | "unstable_one_ply" | "unstable_refutation_only" | "unstable_opponent_refutation_only",
): "static" | "one_ply" | "unstable_one_ply" | "unstable_refutation_only" | "unstable_opponent_refutation_only" {
  const value = stringArg(name) ?? fallback;
  if (
    value === "static"
    || value === "one_ply"
    || value === "unstable_one_ply"
    || value === "unstable_refutation_only"
    || value === "unstable_opponent_refutation_only"
  ) return value;
  throw new Error(`${name} must be static, one_ply, unstable_one_ply, unstable_refutation_only, or unstable_opponent_refutation_only`);
}
