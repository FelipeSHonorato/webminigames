/* Visão pública do puzzle (SEM a solução), validação do tabuleiro e dica — por jogo.
   Código puro (sem DOM, sem rede): roda igual na Edge Function (Deno) e nos testes do Node.
   Usa as CÓPIAS dos domínios em _shared/<jogo>/domain.js, que precisam ficar idênticas às de games/<jogo>
   (o teste tests/edge.test.js compara as duas e falha se divergirem). */
import { makeRng } from "./rng.js";
import * as arrows from "./arrows/domain.js";
import * as canos from "./canos/domain.js";
import * as cruzadas from "./cruzadas/domain.js";
import * as patches from "./patches/domain.js";
import * as sopa from "./sopa/domain.js";
import * as sudoku from "./sudoku/domain.js";
import * as zip from "./zip/domain.js";

export const GAMES = { arrows, canos, cruzadas, patches, sopa, sudoku, zip };
export const hasHints = game => game === "cruzadas" || game === "sopa";

const build = (game, seed, level) => GAMES[game].generatePuzzle(makeRng(seed), GAMES[game].LEVELS[level]);

/** Puzzle sem a solução, em JSON (Map/Set viram arrays), pronto para o cliente renderizar. */
export function publicView(game, seed, level) {
  const p = build(game, seed, level);
  switch (game) {
    case "sudoku":   return { cells: p.cells, givens: p.givens };
    case "arrows":   return { n: p.n, dirs: p.dirs };
    case "canos":    return { n: p.n, tiles: p.tiles.map(t => ({ type: t.type, rot: t.rot })), inlet: p.inlet, outlet: p.outlet };
    case "patches":  return { n: patches.N, clues: p.clues };
    case "zip":      return { n: zip.N, total: zip.TOTAL, waypoints: [...p.waypoints], walls: [...p.walls], max: p.max };
    /* Sopa: sem cells/dir — a posição de cada palavra na grade É a solução. O jogador só recebe o texto (para ocultar as letras). */
    case "sopa":     return { n: p.n, grid: p.grid, words: p.words.map(w => ({ text: w.text, norm: w.norm })) };
    /* Cruzadas: a letra certa (ch) vira cap (quantas letras cabem) e a resposta (norm) vira len — sem solução para o navegador. */
    case "cruzadas": return {
      n: p.n,
      cells: p.cells.map(c => (c.t === "L" ? { t: "L", cap: c.ch.length, across: c.across, down: c.down } : c)),
      answers: p.answers.map(a => ({ id: a.id, len: a.len, clue: a.clue, dir: a.dir, variant: a.variant, start: a.start, cells: a.cells, clueCell: a.clueCell })),
    };
    default: throw new Error("unknown_game");
  }
}

const ints = (arr, n, lo, hi) => Array.isArray(arr) && arr.length === n && arr.every(v => Number.isInteger(v) && v >= lo && v <= hi);
const sameCells = (a, b) => Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

/** Valida de verdade: regenera a fase a partir da seed (secreta) e confere o tabuleiro enviado. */
export function validate(game, seed, level, data) {
  const p = build(game, seed, level);
  switch (game) {
    case "sudoku":
      return ints(data?.grid, sudoku.TOTAL, 1, 9) && sudoku.isSolved(data.grid);
    case "arrows":
      return arrows.isSolved(p.n, p.dirs, data?.order);
    case "canos":
      return ints(data?.rots, p.n * p.n, 0, 3) && canos.simulate(p, data.rots).status === "win";
    case "zip": {
      if (!ints(data?.path, zip.TOTAL, 0, zip.TOTAL - 1)) return false;
      let acc = [];
      for (const t of data.path) { const next = zip.applyMove(p, acc, t); if (next === acc) return false; acc = next; }
      return acc.length === data.path.length && zip.isSolved(p, acc);
    }
    case "patches": {
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

/** Quantas dicas o servidor já contou numa fase (para decidir/parar). */
export const maxHints = (game, level) => hasHints(game) ? (game === "sopa" ? sopa.maxHints(sopa.LEVELS[level]) : cruzadas.maxHints(level)) : 0;

/** Próxima dica (só cruzadas precisa da jogada atual para escolher a casa). Devolve null se não há dica. */
export function hint(game, seed, level, hints, state) {
  const p = build(game, seed, level);
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
