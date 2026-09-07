export type RulesetId = "classic_v1";
export type PlayerId = "P0" | "P1";
export type Direction = "CW" | "CCW";
export type DanPitId = "B1" | "B2" | "B3" | "B4" | "B5" | "T1" | "T2" | "T3" | "T4" | "T5";
export type QuanPitId = "L" | "R";
export type PitId = DanPitId | QuanPitId;
export type RuleProfileId = "standard_v1" | "no_first_quan_v1" | "mature_quan_v1";

export type ResolvedRuleset = Readonly<{
  canonicalRulesetId: string;
  ruleProfileId: RuleProfileId;
}>;

export type Pit = {
  id: PitId;
  owner: PlayerId | null;
  kind: "dan" | "quan";
  stones: number;
  quanStones: number;
};

export type MoveSignature = { player: PlayerId; pit: DanPitId; dir: Direction };

export type GameState = {
  rulesetId: RulesetId;
  ruleset: ResolvedRuleset;
  pits: Pit[];
  currentPlayer: PlayerId;
  scores: Record<PlayerId, number>;
  skipCounts: Record<PlayerId, { consecutive: number; total: number }>;
  status: "playing" | "finished";
  winner: PlayerId | null;
  moveNumber: number;
  recentMoves: MoveSignature[];
};

export type PlayerMove = MoveSignature;

export type MoveEvent =
  | { type: "stones_picked"; player: PlayerId; pit: DanPitId; count: number }
  | { type: "stone_sown"; pit: PitId; stones: number }
  | { type: "capture_resolved"; player: PlayerId; emptyPit?: PitId; pit: PitId; value: number }
  | { type: "side_refilled"; player: PlayerId }
  | { type: "move_accepted"; player: PlayerId; pit: DanPitId; dir: Direction }
  | { type: "turn_changed"; currentPlayer: PlayerId }
  | { type: "match_finished"; winner: PlayerId | null; reason: "both_quan_empty" | "no_refill" };

export type ApplyMoveResult =
  | { ok: true; state: GameState; events: MoveEvent[] }
  | { ok: false; error: "not_players_turn" | "pit_not_owned" | "empty_pit" | "match_finished" | "first_turn_quan_forbidden" };
