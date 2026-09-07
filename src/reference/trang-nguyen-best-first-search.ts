export type TrangNguyenWdl = "loss" | "draw" | "win";
export type TrangNguyenBoundedOutcome = TrangNguyenWdl | "unresolved";
export type TrangNguyenBudgetReason = "node" | "time";

export class SearchBudgetExhausted extends Error {
  constructor(readonly reason: TrangNguyenBudgetReason) {
    super(`Trang Nguyen search ${reason} budget exhausted`);
  }
}

export type TrangNguyenSearchBudget = {
  consumeNode: () => void;
  shouldStop: () => TrangNguyenBudgetReason | null;
};

export type TrangNguyenSearchAdapter<TState, TMove, TPlayer> = {
  currentPlayer: (state: TState) => TPlayer;
  legalMoves: (state: TState) => readonly TMove[];
  applyMove: (state: TState, move: TMove) => TState;
  terminalOutcome: (state: TState, perspective: TPlayer) => TrangNguyenWdl | null;
  solvedOutcome?: (state: TState, perspective: TPlayer) => TrangNguyenWdl | null;
  heuristic: (state: TState, perspective: TPlayer) => number;
  moveKey: (move: TMove) => string;
  onEvaluate?: (rootMove: TMove, depth: number) => void;
};

export type TrangNguyenRootBranch<TMove> = {
  move: TMove;
  outcome: TrangNguyenBoundedOutcome;
  lowerBound: TrangNguyenWdl;
  upperBound: TrangNguyenWdl;
  score: number;
  completedDepth: number;
  visits: number;
};

type NodeResult<TMove> = Omit<
  TrangNguyenRootBranch<TMove>,
  "move" | "completedDepth" | "visits"
> & {
  bestMove: TMove | null;
};

type SearchOptions<TState, TMove, TPlayer> = {
  rootState: TState;
  perspective: TPlayer;
  adapter: TrangNguyenSearchAdapter<TState, TMove, TPlayer>;
  maxDepth: number;
  maxQuanta?: number;
  budget?: TrangNguyenSearchBudget;
};

export type TrangNguyenBestFirstResult<TMove> = {
  move: TMove | null;
  branches: TrangNguyenRootBranch<TMove>[];
  budgetReason: TrangNguyenBudgetReason | null;
};

const WDL_RANK: Record<TrangNguyenWdl, number> = { loss: 0, draw: 1, win: 2 };

export function searchTrangNguyenBestFirst<TState, TMove, TPlayer>(
  options: SearchOptions<TState, TMove, TPlayer>,
): TrangNguyenBestFirstResult<TMove> {
  const rootMoves = options.adapter.legalMoves(options.rootState);
  const states = new Map<string, TState>();
  const ages = new Map<string, number>();
  const branches = rootMoves.map((move) => {
    const state = options.adapter.applyMove(options.rootState, move);
    states.set(options.adapter.moveKey(move), state);
    ages.set(options.adapter.moveKey(move), 0);
    options.adapter.onEvaluate?.(move, 1);
    return {
      move,
      ...evaluateNode(state, 0, options.perspective, options.adapter),
      completedDepth: 1,
      visits: 1,
    };
  });

  const maxQuanta = options.maxQuanta ?? Number.POSITIVE_INFINITY;
  let quanta = 0;
  let budgetReason: TrangNguyenBudgetReason | null = null;
  while (quanta < maxQuanta) {
    budgetReason = options.budget?.shouldStop() ?? null;
    if (budgetReason) break;
    const queue = new MaxPriorityQueue<TrangNguyenRootBranch<TMove>>();
    const bestLower = branches.reduce<TrangNguyenWdl>(
      (best, branch) => (WDL_RANK[branch.lowerBound] > WDL_RANK[best] ? branch.lowerBound : best),
      "loss",
    );
    for (const branch of branches) {
      if (branch.completedDepth >= options.maxDepth) continue;
      if (WDL_RANK[branch.upperBound] < WDL_RANK[bestLower]) continue;
      const key = options.adapter.moveKey(branch.move);
      queue.push(branch, branchPriority(branch, ages.get(key) ?? 0));
    }
    const next = queue.pop();
    if (!next) break;
    const key = options.adapter.moveKey(next.move);
    const state = states.get(key);
    if (!state) throw new Error(`Missing root state for ${key}`);
    const targetDepth = next.completedDepth + 1;
    options.adapter.onEvaluate?.(next.move, targetDepth);
    let evaluated: NodeResult<TMove>;
    try {
      evaluated = evaluateNode(
        state,
        targetDepth - 1,
        options.perspective,
        options.adapter,
        options.budget,
      );
    } catch (error) {
      if (!(error instanceof SearchBudgetExhausted)) throw error;
      budgetReason = error.reason;
      break;
    }
    Object.assign(next, evaluated, {
      completedDepth: targetDepth,
      visits: next.visits + 1,
    });
    for (const branch of branches) {
      const branchKey = options.adapter.moveKey(branch.move);
      ages.set(branchKey, branchKey === key ? 0 : (ages.get(branchKey) ?? 0) + 1);
    }
    quanta += 1;
  }

  const ranked = [...branches].sort(compareRootBranches);
  return { move: ranked[0]?.move ?? null, branches, budgetReason };
}

function evaluateNode<TState, TMove, TPlayer>(
  state: TState,
  remainingDepth: number,
  perspective: TPlayer,
  adapter: TrangNguyenSearchAdapter<TState, TMove, TPlayer>,
  budget?: TrangNguyenSearchBudget,
): NodeResult<TMove> {
  budget?.consumeNode();
  const solved = adapter.solvedOutcome?.(state, perspective) ?? null;
  if (solved) {
    return {
      outcome: solved,
      lowerBound: solved,
      upperBound: solved,
      score: terminalScore(solved),
      bestMove: null,
    };
  }
  const terminal = adapter.terminalOutcome(state, perspective);
  if (terminal) {
    return {
      outcome: terminal,
      lowerBound: terminal,
      upperBound: terminal,
      score: terminalScore(terminal),
      bestMove: null,
    };
  }
  if (remainingDepth <= 0) {
    return {
      outcome: "unresolved",
      lowerBound: "loss",
      upperBound: "win",
      score: adapter.heuristic(state, perspective),
      bestMove: null,
    };
  }

  const moves = adapter.legalMoves(state);
  if (moves.length === 0) {
    return {
      outcome: "unresolved",
      lowerBound: "loss",
      upperBound: "win",
      score: adapter.heuristic(state, perspective),
      bestMove: null,
    };
  }
  const maximizing = Object.is(adapter.currentPlayer(state), perspective);
  const children = moves.map((move) => ({
    move,
    result: evaluateNode(
      adapter.applyMove(state, move),
      remainingDepth - 1,
      perspective,
      adapter,
      budget,
    ),
  }));
  const selected = [...children].sort((left, right) =>
    maximizing
      ? compareNodeResults(right.result, left.result)
      : compareNodeResults(left.result, right.result),
  )[0];
  const lowerBound = children.reduce<TrangNguyenWdl>(
    (bound, child) => selectBound(bound, child.result.lowerBound, maximizing),
    maximizing ? "loss" : "win",
  );
  const upperBound = children.reduce<TrangNguyenWdl>(
    (bound, child) => selectBound(bound, child.result.upperBound, maximizing),
    maximizing ? "loss" : "win",
  );
  return {
    outcome: lowerBound === upperBound ? lowerBound : "unresolved",
    lowerBound,
    upperBound,
    score: selected?.result.score ?? adapter.heuristic(state, perspective),
    bestMove: selected?.move ?? null,
  };
}

function selectBound(
  current: TrangNguyenWdl,
  candidate: TrangNguyenWdl,
  maximizing: boolean,
): TrangNguyenWdl {
  const better = WDL_RANK[candidate] > WDL_RANK[current];
  return maximizing === better ? candidate : current;
}

function compareNodeResults<TMove>(left: NodeResult<TMove>, right: NodeResult<TMove>): number {
  const lower = WDL_RANK[left.lowerBound] - WDL_RANK[right.lowerBound];
  if (lower !== 0) return lower;
  const upper = WDL_RANK[left.upperBound] - WDL_RANK[right.upperBound];
  if (upper !== 0) return upper;
  return left.score - right.score;
}

function compareRootBranches<TMove>(
  left: TrangNguyenRootBranch<TMove>,
  right: TrangNguyenRootBranch<TMove>,
): number {
  const lower = WDL_RANK[right.lowerBound] - WDL_RANK[left.lowerBound];
  if (lower !== 0) return lower;
  const upper = WDL_RANK[right.upperBound] - WDL_RANK[left.upperBound];
  if (upper !== 0) return upper;
  return right.score - left.score;
}

function branchPriority<TMove>(branch: TrangNguyenRootBranch<TMove>, age: number): number {
  const revisitBoost = age >= 2 ? 500_000_000 : age * 1_000;
  return (
    WDL_RANK[branch.upperBound] * 1_000_000_000 +
    WDL_RANK[branch.lowerBound] * 100_000_000 +
    revisitBoost +
    branch.score -
    branch.completedDepth * 100
  );
}

function terminalScore(outcome: TrangNguyenWdl): number {
  if (outcome === "win") return 1_000_000;
  if (outcome === "loss") return -1_000_000;
  return 0;
}

class MaxPriorityQueue<T> {
  private readonly items: Array<{ value: T; priority: number }> = [];

  push(value: T, priority: number): void {
    this.items.push({ value, priority });
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if ((this.items[parent]?.priority ?? -Infinity) >= priority) break;
      const currentItem = this.items[index];
      const parentItem = this.items[parent];
      if (!currentItem || !parentItem) break;
      this.items[parent] = currentItem;
      this.items[index] = parentItem;
      index = parent;
    }
  }

  pop(): T | null {
    const root = this.items[0];
    const tail = this.items.pop();
    if (!root) return null;
    if (tail && this.items.length > 0) {
      this.items[0] = tail;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let largest = index;
        if (
          (this.items[left]?.priority ?? -Infinity) > (this.items[largest]?.priority ?? -Infinity)
        ) {
          largest = left;
        }
        if (
          (this.items[right]?.priority ?? -Infinity) > (this.items[largest]?.priority ?? -Infinity)
        ) {
          largest = right;
        }
        if (largest === index) break;
        const currentItem = this.items[index];
        const largestItem = this.items[largest];
        if (!currentItem || !largestItem) break;
        this.items[index] = largestItem;
        this.items[largest] = currentItem;
        index = largest;
      }
    }
    return root.value;
  }
}
