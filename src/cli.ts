#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeOpenings, analyzePieRule, perft, runMatchSeries, runTournament } from "./analysis.js";
import { createInitialState, getLegalMoves } from "./engine.js";
import { AI_DIFFICULTIES, AI_DIFFICULTY_PROFILES, type AiDifficulty } from "./profiles.js";
import { analyzePosition, type SearchAlgorithm, type SearchOptions } from "./search.js";
import type { Direction, GameState, PlayerMove } from "./types.js";

const [command = "help", ...args] = process.argv.slice(2);
const flags = parseFlags(args);

switch (command) {
  case "suggest": suggest(); break;
  case "evaluate": evaluateMove(); break;
  case "match": match(); break;
  case "tournament": tournament(); break;
  case "openings": openings(); break;
  case "pie": pie(); break;
  case "perft": perftCommand(); break;
  case "profiles": profiles(); break;
  default: help();
}

function suggest(): void {
  const state = loadState(flags.state);
  const level = levelFlag();
  const result = analyzePosition(state, level, searchFlags());
  const top = numberFlag("top", 10);
  console.log(`Player: ${state.currentPlayer} | AI: ${AI_DIFFICULTY_PROFILES[level].label}`);
  console.log("Rank  Move       Score        Gain  Threat");
  result.rankedMoves.slice(0, top).forEach((row, i) => console.log(`${pad(i + 1, 4)}  ${pad(formatMove(row.move), 9)}  ${pad(row.score.toFixed(2), 11)}  ${pad(row.immediateGain, 4)}  ${row.opponentImmediateThreat}`));
  console.log(`\nBest: ${result.bestMove ? formatMove(result.bestMove) : "none"}`);
  console.log(`depth=${result.diagnostics.completedDepth} nodes=${result.diagnostics.nodeCount} cutoffs=${result.diagnostics.cutoffs} cacheHits=${result.diagnostics.cacheHits} time=${result.diagnostics.elapsedMs.toFixed(1)}ms budget=${result.diagnostics.budgetReason ?? "ok"}`);
}

function evaluateMove(): void {
  const state = loadState(flags.state);
  const level = levelFlag();
  const raw = required("move");
  const target = parseMove(raw, state);
  const result = analyzePosition(state, level, searchFlags());
  const found = result.rankedMoves.find((row) => row.move.pit === target.pit && row.move.dir === target.dir);
  if (!found) throw new Error(`Move ${raw} is not legal in this state.`);
  const rank = result.rankedMoves.indexOf(found) + 1;
  console.log(`${formatMove(target)}: score=${found.score.toFixed(2)} rank=${rank}/${result.rankedMoves.length} gain=${found.immediateGain} threat=${found.opponentImmediateThreat}`);
}

function match(): void {
  const p0 = difficulty(required("p0"));
  const p1 = difficulty(required("p1"));
  const games = numberFlag("games", 10);
  const summary = runMatchSeries(p0, p1, games, { swapSides: boolFlag("swap-sides"), search: searchFlags(), seed: numberFlag("seed", 1) });
  console.log(JSON.stringify(summary, null, 2));
}

function tournament(): void {
  const rows = runTournament(numberFlag("games", 2), searchFlags());
  console.log("AI              Points  W  D  L");
  for (const row of rows) console.log(`${pad(AI_DIFFICULTY_PROFILES[row.ai].label, 15)} ${pad(row.points.toFixed(1), 6)} ${pad(row.wins, 2)} ${pad(row.draws, 2)} ${row.losses}`);
}

function openings(): void {
  const rows = analyzeOpenings(levelFlag(), searchFlags());
  rows.forEach((row, i) => console.log(`${pad(i + 1, 2)}. ${pad(formatMove(row.move), 9)} ${row.score.toFixed(3)}`));
}

function pie(): void {
  const rows = analyzePieRule(levelFlag(), searchFlags());
  console.log("Opening    KEEP         SWAP         guaranteed");
  rows.forEach((row) => console.log(`${pad(formatMove(row.opening), 10)} ${pad(row.keep.toFixed(2), 12)} ${pad(row.swap.toFixed(2), 12)} ${row.guaranteed.toFixed(2)}`));
  if (rows[0]) console.log(`\nBest guaranteed opening: ${formatMove(rows[0].opening)} (${rows[0].guaranteed.toFixed(2)})`);
}

function perftCommand(): void {
  const state = loadState(flags.state);
  const depth = numberFlag("depth", 1);
  console.log(perft(state, depth));
}

function profiles(): void {
  for (const id of AI_DIFFICULTIES) {
    const p = AI_DIFFICULTY_PROFILES[id];
    console.log(`${id.padEnd(13)} ${p.label.padEnd(12)} depth=${p.searchDepth} +P1:${p.secondPlayerDepthBonus} nodes=${p.nodeBudget} time=${p.timeBudgetMs}ms`);
  }
}

function loadState(value: string | boolean | undefined): GameState {
  if (!value || value === "initial" || value === true) return createInitialState();
  return JSON.parse(readFileSync(resolve(String(value)), "utf8")) as GameState;
}
function parseMove(raw: string, state: GameState): PlayerMove {
  const [pit, dir] = raw.toUpperCase().split(":");
  if (!pit || (dir !== "CW" && dir !== "CCW")) throw new Error("Move format: B3:CW");
  const legal = getLegalMoves(state).find((m) => m.pit === pit && m.dir === (dir as Direction));
  if (!legal) return { player: state.currentPlayer, pit: pit as PlayerMove["pit"], dir: dir as Direction };
  return legal;
}
function searchFlags(): SearchOptions {
  const options: SearchOptions = {};
  if (typeof flags.algorithm === "string") options.algorithm = flags.algorithm as SearchAlgorithm;
  const depth = optionalNumber("depth"); if (depth !== undefined) options.depth = depth;
  const nodes = optionalNumber("nodes"); if (nodes !== undefined) options.nodeBudget = nodes;
  const time = optionalNumber("time"); if (time !== undefined) options.timeBudgetMs = time;
  return options;
}
function levelFlag(): AiDifficulty { return difficulty(String(flags.level ?? "trang-nguyen")); }
function difficulty(value: string): AiDifficulty { if ((AI_DIFFICULTIES as readonly string[]).includes(value)) return value as AiDifficulty; throw new Error(`Unknown AI: ${value}`); }
function parseFlags(values: string[]): Record<string, string | boolean> { const out: Record<string, string | boolean> = {}; for (let i = 0; i < values.length; i += 1) { const v = values[i]!; if (!v.startsWith("--")) continue; const key = v.slice(2); const next = values[i + 1]; if (next && !next.startsWith("--")) { out[key] = next; i += 1; } else out[key] = true; } return out; }
function required(key: string): string { const v = flags[key]; if (typeof v !== "string") throw new Error(`Missing --${key}`); return v; }
function numberFlag(key: string, fallback: number): number { const v = optionalNumber(key); return v ?? fallback; }
function optionalNumber(key: string): number | undefined { const v = flags[key]; if (v === undefined || v === true) return undefined; const n = Number(v); if (!Number.isFinite(n)) throw new Error(`Invalid --${key}`); return n; }
function boolFlag(key: string): boolean { return flags[key] === true || flags[key] === "true"; }
function formatMove(move: PlayerMove): string { return `${move.pit}:${move.dir}`; }
function pad(value: string | number, width: number): string { return String(value).padEnd(width); }
function help(): void {
  console.log(`oaq-ai commands:\n  profiles\n  suggest --state initial --level trang-nguyen --top 10 [--depth N --nodes N --time MS --algorithm alpha-beta|minimax]\n  evaluate --move B3:CW --state initial --level trang-nguyen\n  match --p0 trang-nguyen --p1 bang-nhan --games 100 --swap-sides\n  tournament --games 4\n  openings --level trang-nguyen\n  pie --level trang-nguyen\n  perft --depth 4\n`);
}
