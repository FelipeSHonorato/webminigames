/* Visão pública do puzzle (SEM a solução), validação do tabuleiro e dica — por jogo.
   Código puro (sem DOM, sem rede): roda igual na Edge Function (Deno) e nos testes do Node.
   Usa as CÓPIAS dos domínios em _shared/<jogo>/domain.js, que precisam ficar idênticas às de games/<jogo>
   (o teste tests/edge.test.js compara as duas e falha se divergirem). */
import { makeRng } from "./rng.js";
import * as arrows from "./arrows/domain.js";
import * as canos from "./canos/domain.js";
import * as cruzadas from "./cruzadas/domain.js";
import * as patches from "./patches/domain.js";
import * as queens from "./queens/domain.js";
import * as sopa from "./sopa/domain.js";
import * as sudoku from "./sudoku/domain.js";
import * as zip from "./zip/domain.js";

export const GAMES = { arrows, canos, cruzadas, patches, queens, sopa, sudoku, zip };
export const hasHints = game => game === "cruzadas" || game === "sopa";
export const GENS = { arrows: arrows.GEN, canos: canos.GEN, cruzadas: cruzadas.GEN, queens: queens.GEN, sopa: sopa.GEN, patches: 1, sudoku: 1, zip: 1 };

const build = (game, seed, level) => GAMES[game].generatePuzzle(makeRng(seed), GAMES[game].LEVELS[level]);

/** Puzzle sem a solução, em JSON (Map/Set viram arrays), pronto para o cliente renderizar. */
const viewOf = (game, p) => {
  const n = p.n ?? (game === "patches" ? patches.N : game === "zip" ? zip.N : sudoku.SIZE);
  switch (game) {
    case "sudoku":   return { cells: p.cells, givens: p.givens };
    case "arrows":   return { n, pieces: p.pieces, redirectors: [...p.redirectors].map(([cell, dir]) => ({ cell, dir })) };
    case "canos":    return { n, tiles: p.tiles.map(t => ({ type: t.type, rot: t.rot })), inlets: canos.inletsOf(p), outlets: canos.outletsOf(p) };
    case "patches":  return { n, clues: p.clues };
    /* Queens: só o mapa de regiões — as rainhas são a solução. */
    case "queens":   return { n, regions: p.regions };
    case "zip":      return { n, total: n * n, waypoints: [...p.waypoints], walls: [...p.walls], max: p.max };
    /* Sopa: sem cells/dir — a posição de cada palavra na grade É a solução. O jogador só recebe o texto (para ocultar as letras). */
    case "sopa":     return { n, grid: p.grid, words: p.words.map(w => ({ text: w.text, norm: w.norm })) };
    /* Cruzadas: a letra certa (ch) vira cap (quantas letras cabem) e a resposta (norm) vira len — sem solução para o navegador. */
    case "cruzadas": return {
      n,
      cells: p.cells.map(c => (c.t === "L" ? { t: "L", cap: c.ch.length, across: c.across, down: c.down } : c)),
      answers: p.answers.map(a => ({ id: a.id, len: a.len, clue: a.clue, dir: a.dir, variant: a.variant, start: a.start, cells: a.cells, clueCell: a.clueCell })),
    };
    default: throw new Error("unknown_game");
  }
};
export const publicView = (game, seed, level) => viewOf(game, build(game, seed, level));

/** JSON do puzzle COMPLETO (com solução), para o snapshot imutável do cenário diário. */
function serialize(game, p) {
  switch (game) {
    case "arrows":   return { n: p.n, pieces: p.pieces, redirectors: [...p.redirectors], solution: p.solution };
    case "canos":    return { n: p.n, tiles: p.tiles, inlets: canos.inletsOf(p), outlets: canos.outletsOf(p), path: p.path, solution: p.solution };
    case "zip":      return { n: p.n ?? zip.N, waypoints: [...p.waypoints], walls: [...p.walls], max: p.max, solution: p.solution };
    case "patches":  return { n: p.n ?? patches.N, clues: p.clues, solution: p.solution };
    case "queens":   return { n: p.n, regions: p.regions, solution: p.solution };
    case "sudoku":   return { n: sudoku.SIZE, cells: p.cells, solution: p.solution, givens: p.givens };
    case "sopa":     return { n: p.n, grid: p.grid, words: p.words };
    case "cruzadas": return { n: p.n, cells: p.cells, answers: p.answers };
    default: throw new Error("unknown_game");
  }
}

/** Restaura o puzzle completo guardado em `daily_scenarios`. */
function revive(game, s) {
  switch (game) {
    case "arrows":   return { ...s, redirectors: new Map(s.redirectors) };
    case "zip":      return { ...s, waypoints: new Map(s.waypoints), walls: new Set(s.walls) };
    case "canos":
    case "patches":
    case "queens":
    case "sudoku":
    case "sopa":
    case "cruzadas": return s;
    default: throw new Error("unknown_game");
  }
}

/** Gera a visão pública e o puzzle completo para guardar em `daily_scenarios`. */
export function snapshot(game, seed, level) {
  const p = build(game, seed, level);
  return { gen: GENS[game] ?? 1, publicView: viewOf(game, p), fullPuzzle: serialize(game, p) };
}

const ints = (arr, n, lo, hi) => Array.isArray(arr) && arr.length === n && arr.every(v => Number.isInteger(v) && v >= lo && v <= hi);
const sameCells = (a, b) => Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

/** Valida um tabuleiro contra um puzzle completo já materializado (sem regenerar pela seed). */
export function validatePuzzle(game, p, data) {
  switch (game) {
    case "sudoku":
      return ints(data?.grid, sudoku.TOTAL, 1, 9) && sudoku.isSolved(data.grid);
    case "arrows":
      return arrows.isSolved(p.n, p.pieces, data?.order, p.redirectors);
    case "canos":
      return ints(data?.rots, p.n * p.n, 0, 3) && canos.simulate(p, data.rots).status === "win";
    case "queens":
      return ints(data?.queens, p.n, 0, p.n * p.n - 1) && queens.isSolved(p, data.queens);
    case "zip": {
      zip.setSize(p.n ?? zip.N);
      if (!ints(data?.path, zip.TOTAL, 0, zip.TOTAL - 1)) return false;
      let acc = [];
      for (const t of data.path) { const next = zip.applyMove(p, acc, t); if (next === acc) return false; acc = next; }
      return acc.length === data.path.length && zip.isSolved(p, acc);
    }
    case "patches": {
      patches.setSize(p.n ?? patches.N);
      const rects = data?.rects;
      if (!Array.isArray(rects) || rects.length !== p.clues.length) return false;
      const seen = new Array(patches.TOTAL).fill(false), hit = new Array(p.clues.length).fill(0), acc = [];
      for (const rect of rects) {
        if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isInteger)) return false;
        const [r0, c0, r1, c1] = rect;
        if (r0 < 0 || c0 < 0 || r0 > r1 || c0 > c1 || r1 >= patches.N || c1 >= patches.N) return false;
        const res = patches.validateRect(p, acc, rect);
        if (!res.ok) return false;
        acc.push({ rect, clue: res.clue }); hit[res.clue] += 1;
        for (const c of patches.rectCells(r0, c0, r1, c1)) { if (seen[c]) return false; seen[c] = true; }
      }
      return seen.every(Boolean) && hit.every(n => n === 1);
    }
    case "sopa": {
      const found = data?.found;
      if (!Array.isArray(found)) return false;
      const set = new Set();
      for (const f of found) {
        const idx = typeof f === "object" ? f?.index : f;
        if (!Number.isInteger(idx) || idx < 0 || idx >= p.words.length || set.has(idx)) return false;
        if (typeof f === "object") {   // quando o cliente manda as células, confere que a seleção é uma ocorrência real
          const occ = sopa.findOccurrences(p, p.words[idx].norm);
          if (!occ.some(o => sameCells(o, f.cells))) return false;
        }
        set.add(idx);
      }
      return sopa.isSolved(p, set);
    }
    case "cruzadas":
      return typeof data?.entries === "string" && cruzadas.isComplete(p, cruzadas.decodeEntries(p, data.entries));
    default:
      return false;
  }
}

/** Valida de verdade: regenera a fase a partir da seed (secreta) e confere o tabuleiro enviado. */
export const validate = (game, seed, level, data) => validatePuzzle(game, build(game, seed, level), data);

/** Valida contra o puzzle completo guardado no cenário diário. */
export const validateSnapshot = (game, fullPuzzle, data) => validatePuzzle(game, revive(game, fullPuzzle), data);

/** Quantas dicas o servidor já contou numa fase (para decidir/parar). */
export const maxHints = (game, level) => hasHints(game) ? (game === "sopa" ? sopa.maxHints(sopa.LEVELS[level]) : cruzadas.maxHints(level)) : 0;

function hintPuzzle(game, p, level, hints, state) {
  if (game === "sopa") return sopa.canHint(p, sopa.LEVELS[level], new Set(state?.found ?? []), hints) ? { hints } : null;
  if (game === "cruzadas") {
    const entries = cruzadas.decodeEntries(p, state?.entries ?? "");
    const id = Number.isInteger(state?.id) ? state.id : -1;
    if (!cruzadas.canHint(p, entries, id, hints, level)) return null;
    const cell = cruzadas.nextHintCell(p, entries, id);
    if (cell < 0) return null;
    return { hints, cell, value: cruzadas.hintValue(p.cells[cell]) };
  }
  return null;
}

/** Próxima dica (só cruzadas precisa da jogada atual para escolher a casa). Devolve null se não há dica. */
export const hint = (game, seed, level, hints, state) => hintPuzzle(game, build(game, seed, level), level, hints, state);

/** Próxima dica usando o puzzle completo guardado no cenário diário. */
export const hintSnapshot = (game, fullPuzzle, level, hints, state) => hintPuzzle(game, revive(game, fullPuzzle), level, hints, state);
