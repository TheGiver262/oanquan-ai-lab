import {
  applyBalanceAction,
  balanceActionKey,
  currentAgent,
  getBalanceActions,
  seatForAgent,
  winnerAgent,
  type BalanceAction,
  type BalanceState,
  type ResearchAgentId,
} from "./balance-modes.js";
import {
  ModeAwarePuctV3A,
  type ModeAwarePuctV3AActionStat,
  type ModeAwarePuctV3ADecision,
} from "./mode-aware-puct-v3a.js";

export type ResourceAwarePuctV3AOptions = {
  primarySimulations?: number;
  forecastSimulations?: number;
  probeSimulations?: number;
  validationSimulations?: number;
  candidateLimit?: number;
  validateTop?: number;
  rescueUntilBoardMove?: number;
  rescueDepth?: number;
  maxBoardMoves?: number;
  puctExploration?: number;
  policyTemperature?: number;
};

export type ResourceOutcome = {
  unresolved: boolean;
  value: -1 | 0 | 1 | null;
  margin: number | null;
  boardMoves: number;
  finishReason: string | null;
  trace: string[];
  rescueChanges: Array<{
    boardMove: number;
    primaryAction: string | null;
    selectedAction: string | null;
  }>;
};

export type ResourceCandidateDiagnostic = {
  action: string;
  rootRank: number;
  rootVisits: number;
  rootMean: number;
  probe: ResourceOutcome;
  validation: ResourceOutcome | null;
};

export type ResourceAwarePuctV3ADecision = ModeAwarePuctV3ADecision & {
  rescueDiagnostics: {
    triggered: boolean;
    primaryAction: string | null;
    primaryForecast: ResourceOutcome | null;
    selectedAction: string | null;
    changedAction: boolean;
    candidates: ResourceCandidateDiagnostic[];
    rescueDepth: number;
  };
};

const DEFAULT_PRIMARY_SIMULATIONS = 20_000;
const DEFAULT_FORECAST_SIMULATIONS = 50_000;
const DEFAULT_PROBE_SIMULATIONS = 2_000;
const DEFAULT_VALIDATION_SIMULATIONS = 20_000;
const DEFAULT_CANDIDATE_LIMIT = 10;
const DEFAULT_VALIDATE_TOP = 4;
const DEFAULT_RESCUE_UNTIL_BOARD_MOVE = 12;
const DEFAULT_RESCUE_DEPTH = 2;
const DEFAULT_MAX_BOARD_MOVES = 240;
const DEFAULT_PUCT_EXPLORATION = 1.5;
const DEFAULT_POLICY_TEMPERATURE = 0.6;

/**
 * Research-only wrapper around the frozen ModeAwarePuctV3A incumbent.
 *
 * The incumbent search itself is untouched. This wrapper adds a deterministic
 * "rescue verification" layer:
 * 1. ask V3A for its normal move;
 * 2. forecast that move with a stronger fresh-V3A continuation;
 * 3. only if that continuation loses, probe the other root actions;
 * 4. revalidate the best probes at a higher budget;
 * 5. replace the incumbent move only when a candidate improves the terminal
 *    result class (loss -> draw/win, draw -> win).
 *
 * No opening/action names are hard-coded. A later real decision can trigger the
 * same mechanism again, allowing multi-stage resources to be discovered
 * naturally across the trajectory.
 */
export class ResourceAwarePuctV3A {
  private readonly primary = new ModeAwarePuctV3A();

  reset(): void {
    this.primary.reset();
  }

  chooseAction(
    state: BalanceState,
    options: ResourceAwarePuctV3AOptions = {},
  ): ResourceAwarePuctV3ADecision {
    const primarySimulations = options.primarySimulations ?? DEFAULT_PRIMARY_SIMULATIONS;
    const forecastSimulations = options.forecastSimulations ?? DEFAULT_FORECAST_SIMULATIONS;
    const probeSimulations = options.probeSimulations ?? DEFAULT_PROBE_SIMULATIONS;
    const validationSimulations = options.validationSimulations ?? DEFAULT_VALIDATION_SIMULATIONS;
    const candidateLimit = options.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT;
    const validateTop = options.validateTop ?? DEFAULT_VALIDATE_TOP;
    const rescueUntilBoardMove = options.rescueUntilBoardMove ?? DEFAULT_RESCUE_UNTIL_BOARD_MOVE;
    const rescueDepth = options.rescueDepth ?? DEFAULT_RESCUE_DEPTH;
    const maxBoardMoves = options.maxBoardMoves ?? DEFAULT_MAX_BOARD_MOVES;
    const puctExploration = options.puctExploration ?? DEFAULT_PUCT_EXPLORATION;
    const policyTemperature = options.policyTemperature ?? DEFAULT_POLICY_TEMPERATURE;

    if (!Number.isSafeInteger(rescueDepth) || rescueDepth < 1 || rescueDepth > 2) {
      throw new Error("rescueDepth must be 1 or 2");
    }

    const recursiveOptions: ResourceAwarePuctV3AOptions = {
      primarySimulations,
      forecastSimulations,
      probeSimulations,
      validationSimulations,
      candidateLimit,
      validateTop,
      rescueUntilBoardMove,
      maxBoardMoves,
      puctExploration,
      policyTemperature,
    };

    const primaryDecision = this.primary.chooseAction(state, {
      simulations: primarySimulations,
      puctExploration,
      policyTemperature,
    });

    const primaryAction = primaryDecision.action;
    const seeker = currentAgent(state);
    const emptyDiagnostics = {
      triggered: false,
      primaryAction: primaryAction ? balanceActionKey(primaryAction) : null,
      primaryForecast: null as ResourceOutcome | null,
      selectedAction: primaryAction ? balanceActionKey(primaryAction) : null,
      changedAction: false,
      candidates: [] as ResourceCandidateDiagnostic[],
      rescueDepth,
    };

    if (
      !primaryAction
      || state.game.status !== "playing"
      || state.game.moveNumber > rescueUntilBoardMove
      || primaryDecision.rootStats.length <= 1
    ) {
      return { ...primaryDecision, rescueDiagnostics: emptyDiagnostics };
    }

    const primaryForecast = rolloutAfterAction(
      state,
      primaryAction,
      seeker,
      forecastSimulations,
      maxBoardMoves,
      puctExploration,
      policyTemperature,
      0,
      recursiveOptions,
    );

    if ((primaryForecast.value ?? -2) >= 0) {
      return {
        ...primaryDecision,
        rescueDiagnostics: {
          ...emptyDiagnostics,
          primaryForecast,
        },
      };
    }

    const rootRank = new Map(
      primaryDecision.rootStats.map((entry, index) => [balanceActionKey(entry.action), index + 1]),
    );

    const candidates = primaryDecision.rootStats
      .filter((entry) => balanceActionKey(entry.action) !== balanceActionKey(primaryAction))
      .slice(0, Math.max(0, candidateLimit))
      .map((entry) => {
        const probe = rolloutAfterAction(
          state,
          entry.action,
          seeker,
          probeSimulations,
          maxBoardMoves,
          puctExploration,
          policyTemperature,
          Math.max(0, rescueDepth - 1),
          recursiveOptions,
        );
        return {
          stat: entry,
          diagnostic: {
            action: balanceActionKey(entry.action),
            rootRank: rootRank.get(balanceActionKey(entry.action)) ?? Number.MAX_SAFE_INTEGER,
            rootVisits: entry.visits,
            rootMean: entry.meanValue,
            probe,
            validation: null as ResourceOutcome | null,
          } satisfies ResourceCandidateDiagnostic,
        };
      });

    candidates.sort((left, right) => compareOutcomes(right.diagnostic.probe, left.diagnostic.probe));

    let selectedAction = primaryAction;
    const top = candidates.slice(0, Math.max(0, validateTop));
    for (const candidate of top) {
      const validation = rolloutAfterAction(
        state,
        candidate.stat.action,
        seeker,
        validationSimulations,
        maxBoardMoves,
        puctExploration,
        policyTemperature,
        Math.max(0, rescueDepth - 1),
        recursiveOptions,
      );
      candidate.diagnostic.validation = validation;
    }

    const validated = top
      .filter((entry) => entry.diagnostic.validation !== null)
      .sort((left, right) =>
        compareOutcomes(
          right.diagnostic.validation as ResourceOutcome,
          left.diagnostic.validation as ResourceOutcome,
        ),
      );

    const best = validated[0];
    if (
      best?.diagnostic.validation
      && strictlyImprovesOutcome(best.diagnostic.validation, primaryForecast)
    ) {
      selectedAction = best.stat.action;
    }

    const selectedKey = balanceActionKey(selectedAction);
    return {
      ...primaryDecision,
      action: selectedAction,
      rescueDiagnostics: {
        triggered: true,
        primaryAction: balanceActionKey(primaryAction),
        primaryForecast,
        selectedAction: selectedKey,
        changedAction: selectedKey !== balanceActionKey(primaryAction),
        candidates: candidates.map((entry) => entry.diagnostic),
        rescueDepth,
      },
    };
  }
}

function rolloutAfterAction(
  state: BalanceState,
  action: BalanceAction,
  seeker: ResearchAgentId,
  simulations: number,
  maxBoardMoves: number,
  puctExploration: number,
  policyTemperature: number,
  futureRescues: number,
  nestedOptions: ResourceAwarePuctV3AOptions,
): ResourceOutcome {
  const applied = applyBalanceAction(state, action);
  if (!applied.ok) {
    return illegalOutcome(state.game.moveNumber, action);
  }

  let cursor = applied.state;
  const engines: Record<ResearchAgentId, ModeAwarePuctV3A> = {
    A: new ModeAwarePuctV3A(),
    B: new ModeAwarePuctV3A(),
  };
  const rescueChanges: ResourceOutcome["rescueChanges"] = [];
  const trace = [balanceActionKey(action)];
  let finishReason = finishReasonFromEvents(applied.events);

  while (cursor.game.status === "playing" && cursor.game.moveNumber < maxBoardMoves) {
    const agent = currentAgent(cursor);
    const decision = engines[agent].chooseAction(cursor, {
      simulations,
      puctExploration,
      policyTemperature,
    });
    if (!decision.action) break;

    if (
      agent === seeker
      && futureRescues > 0
      && cursor.game.moveNumber <= (nestedOptions.rescueUntilBoardMove ?? DEFAULT_RESCUE_UNTIL_BOARD_MOVE)
      && decision.rootStats.length > 1
    ) {
      const primaryKey = balanceActionKey(decision.action);
      const candidateLimit = nestedOptions.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT;
      const validateTop = nestedOptions.validateTop ?? DEFAULT_VALIDATE_TOP;
      const probeBudget = Math.max(
        1,
        Math.min(nestedOptions.probeSimulations ?? simulations, simulations),
      );
      const validationBudget = Math.max(
        1,
        Math.min(nestedOptions.validationSimulations ?? simulations, simulations),
      );

      const probes = decision.rootStats
        .filter((entry) => balanceActionKey(entry.action) !== primaryKey)
        .slice(0, Math.max(0, candidateLimit))
        .map((entry) => ({
          action: entry.action,
          outcome: rolloutVanillaAfterAction(
            cursor,
            entry.action,
            seeker,
            probeBudget,
            maxBoardMoves,
            puctExploration,
            policyTemperature,
          ),
        }))
        .sort((left, right) => compareOutcomes(right.outcome, left.outcome));

      const validated = probes
        .slice(0, Math.max(0, validateTop))
        .map((entry) => ({
          action: entry.action,
          outcome: rolloutVanillaAfterAction(
            cursor,
            entry.action,
            seeker,
            validationBudget,
            maxBoardMoves,
            puctExploration,
            policyTemperature,
          ),
        }))
        .sort((left, right) => compareOutcomes(right.outcome, left.outcome));

      const rescue = validated.find((entry) => (entry.outcome.value ?? -2) >= 0);
      if (rescue) {
        return {
          ...rescue.outcome,
          trace: [...trace, ...rescue.outcome.trace].slice(0, 24),
          rescueChanges: [
            ...rescueChanges,
            {
              boardMove: cursor.game.moveNumber,
              primaryAction: primaryKey,
              selectedAction: balanceActionKey(rescue.action),
            },
          ],
        };
      }
    }

    if (trace.length < 24) trace.push(balanceActionKey(decision.action));
    const next = applyBalanceAction(cursor, decision.action);
    if (!next.ok) {
      return {
        unresolved: true,
        value: null,
        margin: null,
        boardMoves: cursor.game.moveNumber,
        finishReason: null,
        trace: [...trace, `ILLEGAL:${balanceActionKey(decision.action)}`],
        rescueChanges,
      };
    }
    finishReason = finishReasonFromEvents(next.events) ?? finishReason;
    cursor = next.state;
  }

  return outcomeFromTerminal(cursor, seeker, finishReason, trace, rescueChanges);
}

function rolloutVanillaAfterAction(
  state: BalanceState,
  action: BalanceAction,
  seeker: ResearchAgentId,
  simulations: number,
  maxBoardMoves: number,
  puctExploration: number,
  policyTemperature: number,
): ResourceOutcome {
  const applied = applyBalanceAction(state, action);
  if (!applied.ok) return illegalOutcome(state.game.moveNumber, action);

  let cursor = applied.state;
  const engines: Record<ResearchAgentId, ModeAwarePuctV3A> = {
    A: new ModeAwarePuctV3A(),
    B: new ModeAwarePuctV3A(),
  };
  const trace = [balanceActionKey(action)];
  let finishReason = finishReasonFromEvents(applied.events);

  while (cursor.game.status === "playing" && cursor.game.moveNumber < maxBoardMoves) {
    const agent = currentAgent(cursor);
    const decision = engines[agent].chooseAction(cursor, {
      simulations,
      puctExploration,
      policyTemperature,
    });
    if (!decision.action) break;
    if (trace.length < 24) trace.push(balanceActionKey(decision.action));
    const next = applyBalanceAction(cursor, decision.action);
    if (!next.ok) {
      return {
        unresolved: true,
        value: null,
        margin: null,
        boardMoves: cursor.game.moveNumber,
        finishReason: null,
        trace: [...trace, `ILLEGAL:${balanceActionKey(decision.action)}`],
        rescueChanges: [],
      };
    }
    finishReason = finishReasonFromEvents(next.events) ?? finishReason;
    cursor = next.state;
  }

  return outcomeFromTerminal(cursor, seeker, finishReason, trace, []);
}

function illegalOutcome(boardMoves: number, action: BalanceAction): ResourceOutcome {
  return {
    unresolved: true,
    value: null,
    margin: null,
    boardMoves,
    finishReason: null,
    trace: [`ILLEGAL:${balanceActionKey(action)}`],
    rescueChanges: [],
  };
}

function finishReasonFromEvents(
  events: readonly { type: string; reason?: string }[],
): string | null {
  for (const event of events) {
    if (event.type === "match_finished" && typeof event.reason === "string") return event.reason;
  }
  return null;
}

function outcomeFromTerminal(
  state: BalanceState,
  seeker: ResearchAgentId,
  finishReason: string | null,
  trace: string[],
  rescueChanges: ResourceOutcome["rescueChanges"],
): ResourceOutcome {
  if (state.game.status !== "finished") {
    return {
      unresolved: true,
      value: null,
      margin: null,
      boardMoves: state.game.moveNumber,
      finishReason,
      trace,
      rescueChanges,
    };
  }

  const winner = winnerAgent(state);
  const value: -1 | 0 | 1 = winner === null ? 0 : winner === seeker ? 1 : -1;
  const seat = seatForAgent(state, seeker);
  const opponentSeat = seat === "P0" ? "P1" : "P0";
  return {
    unresolved: false,
    value,
    margin: state.game.scores[seat] - state.game.scores[opponentSeat],
    boardMoves: state.game.moveNumber,
    finishReason,
    trace,
    rescueChanges,
  };
}

function strictlyImprovesOutcome(candidate: ResourceOutcome, baseline: ResourceOutcome): boolean {
  const candidateValue = candidate.value ?? -2;
  const baselineValue = baseline.value ?? -2;
  return candidateValue > baselineValue;
}

function compareOutcomes(left: ResourceOutcome, right: ResourceOutcome): number {
  const leftValue = left.value ?? -2;
  const rightValue = right.value ?? -2;
  if (leftValue !== rightValue) return leftValue - rightValue;
  const leftMargin = left.margin ?? Number.NEGATIVE_INFINITY;
  const rightMargin = right.margin ?? Number.NEGATIVE_INFINITY;
  if (leftMargin !== rightMargin) return leftMargin - rightMargin;
  if (left.unresolved !== right.unresolved) return left.unresolved ? -1 : 1;
  return right.boardMoves - left.boardMoves;
}

export function summarizeResourceCandidate(
  stat: ModeAwarePuctV3AActionStat,
  outcome: ResourceOutcome,
): ResourceCandidateDiagnostic {
  return {
    action: balanceActionKey(stat.action),
    rootRank: 0,
    rootVisits: stat.visits,
    rootMean: stat.meanValue,
    probe: outcome,
    validation: null,
  };
}
