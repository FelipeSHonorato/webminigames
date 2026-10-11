/* Regras e gerador da Sopa de Letras: código puro, sem DOM (testável no Node). */
import { WORDS, normalize } from "./words.js";
export { normalize };

/* ===================== DOMÍNIO ===================== */
/* n: lado da grade. words: [mín, máx] de palavras da fase. minLen/maxLen: tamanho das palavras (nunca maior que a grade).
   minDiag: quantas palavras, no mínimo, ficam na diagonal em toda fase (garantido na geração). pDiag: chance de cada uma das
   outras palavras tentar a diagonal primeiro. Sem isso as diagonais saíam raras: uma palavra longa tem muito menos posições
   na diagonal do que na horizontal ou vertical, e sortear entre todas as posições favorecia as retas.
   Dicas: cada uma custa 1 ponto, então com N−1 dicas (Fácil 4, Médio 9, Difícil 14, Genius 19) sobra sempre 1 ponto. */
export const LEVELS = [
  { name: "Fácil", n: 5, words: [4, 5], minLen: 3, maxLen: 5, minDiag: 1, pDiag: 0.05 },
  { name: "Médio", n: 10, words: [6, 8], minLen: 4, maxLen: 10, minDiag: 2, pDiag: 0.1 },
  { name: "Difícil", n: 15, words: [9, 12], minLen: 5, maxLen: 12, minDiag: 3, pDiag: 0.12 },
  { name: "Genius", n: 20, words: [13, 16], minLen: 6, maxLen: 14, minDiag: 4, pDiag: 0.15 },
];
/** Versão do gerador. Mudar o sorteio muda as fases geradas por uma mesma seed; as fases salvas guardam esta versão
    para que o andamento (palavras achadas, dicas) de uma versão antiga não seja aplicado a uma fase diferente. */
export const GEN = 2;
export const STORE_KEY = "sopa.wins";

/** As 8 direções: horizontal, vertical e diagonais, nos dois sentidos (inclusive de trás para frente). */
export const DIRS = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]];

/* Fase: { n, grid: string[n*n] (uma letra por célula), words: [{ text, norm, cells: number[], dir: [dr, dc] }] }
   cells = índices em ordem de leitura (da primeira à última letra da palavra). */

const rowOf = (n, i) => Math.floor(i / n), colOf = (n, i) => i % n;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const reverse = s => [...s].reverse().join("");
const shuffle = (arr, rng) => {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
};

/* ----- Seleção (geometria) ----- */
/** Células de `from` até `to` em linha reta (horizontal, vertical ou diagonal); null se não for reta. */
export function lineCells(n, from, to) {
  const dr = rowOf(n, to) - rowOf(n, from), dc = colOf(n, to) - colOf(n, from);
  if (dr !== 0 && dc !== 0 && Math.abs(dr) !== Math.abs(dc)) return null;
  const len = Math.max(Math.abs(dr), Math.abs(dc)), sr = Math.sign(dr), sc = Math.sign(dc);
  return Array.from({ length: len + 1 }, (_, k) => (rowOf(n, from) + sr * k) * n + colOf(n, from) + sc * k);
}
/** Seleção arrastada: do início até a célula (linha, coluna) sob o dedo/mouse, "imantada" à direção de 45° mais próxima.
    O fim é limitado pela borda da grade. Sempre devolve uma linha reta, começando em `from`. */
export function snapLine(n, from, pointerRow, pointerCol) {
  const r0 = rowOf(n, from), c0 = colOf(n, from);
  const dr = clamp(pointerRow, 0, n - 1) - r0, dc = clamp(pointerCol, 0, n - 1) - c0;
  if (!dr && !dc) return [from];
  const k = Math.round(Math.atan2(dr, dc) / (Math.PI / 4));
  const sr = Math.round(Math.sin(k * Math.PI / 4)), sc = Math.round(Math.cos(k * Math.PI / 4));
  const along = Math.max(0, Math.round((dr * sr + dc * sc) / (sr * sr + sc * sc)));            // projeção na direção escolhida
  const room = Math.min(sr > 0 ? n - 1 - r0 : sr < 0 ? r0 : Infinity, sc > 0 ? n - 1 - c0 : sc < 0 ? c0 : Infinity);
  const len = Math.min(along, room);
  return Array.from({ length: len + 1 }, (_, i) => (r0 + sr * i) * n + c0 + sc * i);
}
/** Palavra na diagonal (as duas direções de cada diagonal contam). */
export const isDiagonal = word => word.dir[0] !== 0 && word.dir[1] !== 0;
export const readCells = (puzzle, cells) => cells.map(i => puzzle.grid[i]).join("");

/** Confere uma seleção com a lista: { index } da palavra ainda não achada que ela forma (de frente ou de trás
    para frente), { already: true } se forma uma já achada, ou { index: -1 }. Qualquer ocorrência vale. */
export function matchSelection(puzzle, cells, found) {
  const text = readCells(puzzle, cells), back = reverse(text);
  const isFound = i => found.has(i);
  const hit = puzzle.words.findIndex((w, i) => !isFound(i) && (w.norm === text || w.norm === back));
  if (hit >= 0) return { index: hit };
  const again = puzzle.words.findIndex((w, i) => isFound(i) && (w.norm === text || w.norm === back));
  return again >= 0 ? { index: -1, already: true } : { index: -1 };
}
export const isSolved = (puzzle, found) => found.size === puzzle.words.length;

/** Todas as ocorrências de uma palavra na grade, em qualquer direção (cada uma é a lista de células). */
export function findOccurrences(puzzle, norm) {
  const { n, grid } = puzzle, out = [];
  for (let i = 0; i < n * n; i++) {
    for (const [dr, dc] of DIRS) {
      const r1 = rowOf(n, i) + dr * (norm.length - 1), c1 = colOf(n, i) + dc * (norm.length - 1);
      if (r1 < 0 || r1 >= n || c1 < 0 || c1 >= n) continue;
      const cells = Array.from({ length: norm.length }, (_, k) => (rowOf(n, i) + dr * k) * n + colOf(n, i) + dc * k);
      if (cells.every((c, k) => grid[c] === norm[k])) out.push(cells);
    }
  }
  return out;
}

/* ----- Dicas e pontos ----- */
/** Máximo de dicas por fase: lado da grade menos 1 (Fácil 4, Médio 9, Difícil 14, Genius 19). */
export const maxHints = level => level.n - 1;
/** Quantas letras da palavra aparecem com `hints` dicas: uma por dica, mas nunca a palavra inteira. */
export const revealCount = (word, hints) => Math.min(hints, word.norm.length - 1);
/** Há dica a pedir? Ainda não passou do limite e alguma palavra não achada tem letra a revelar. */
export const canHint = (puzzle, level, found, hints) =>
  hints < maxHints(level) && puzzle.words.some((w, i) => !found.has(i) && revealCount(w, hints) < w.norm.length - 1);
/** Como a palavra aparece na lista: letras reveladas (ou todas, se achada) e null nas ocultas. */
export const maskWord = (word, isFound, hints) =>
  [...word.text].map((ch, i) => (isFound || i < revealCount(word, hints) ? ch : null));
/** Pontos da fase: base do nível menos 1 por dica, com piso de 1. */
export const pointsAfterHints = (base, hints) => Math.max(1, base - hints);

/* ===================== GERADOR ===================== */
/** Duas palavras não podem ser iguais nem uma estar dentro da outra (nem ao contrário), senão a grade fica ambígua. */
const clash = (a, b) => a.includes(b) || b.includes(a) || a.includes(reverse(b)) || b.includes(reverse(a));

/** Coloca as palavras na grade por backtracking: para cada uma, testa posições e direções em ordem aleatória;
    cruzar outra palavra só é permitido onde a letra coincide. Devolve as palavras posicionadas ou null.
    As palavras marcadas com `diag` só aceitam a diagonal; as demais tentam a diagonal primeiro com chance pDiag
    (e, se não couber, a outra opção). */
function place(words, n, rng, pDiag, budget = 40) {
  const grid = new Array(n * n).fill(""), placed = [];
  let nodes = 0;
  const go = k => {
    if (k === words.length) return true;
    if (++nodes > budget) return false;
    const w = words[k], straight = [], diagonal = [];
    for (const dir of DIRS) for (let i = 0; i < n * n; i++) {
      const r1 = rowOf(n, i) + dir[0] * (w.norm.length - 1), c1 = colOf(n, i) + dir[1] * (w.norm.length - 1);
      if (r1 < 0 || r1 >= n || c1 < 0 || c1 >= n) continue;
      const cells = Array.from({ length: w.norm.length }, (_, j) => (rowOf(n, i) + dir[0] * j) * n + colOf(n, i) + dir[1] * j);
      if (cells.every((c, j) => grid[c] === "" || grid[c] === w.norm[j])) (dir[0] && dir[1] ? diagonal : straight).push({ cells, dir });
    }
    shuffle(straight, rng); shuffle(diagonal, rng);
    const opts = w.diag ? diagonal : rng() < pDiag ? [...diagonal, ...straight] : [...straight, ...diagonal];
    for (const o of opts) {
      const set = o.cells.filter(c => grid[c] === "");
      o.cells.forEach((c, j) => (grid[c] = w.norm[j]));
      placed.push({ text: w.text, norm: w.norm, cells: o.cells, dir: o.dir });
      if (go(k + 1)) return true;
      placed.pop();
      set.forEach(c => (grid[c] = ""));
      if (nodes > budget) return false;
    }
    return false;
  };
  return go(0) ? { grid, placed } : null;
}

/* Letras de enchimento, com a frequência aproximada do português (A e E mais comuns, K, W e Y raras). */
const FILL = "AAAAAAAAAAAEEEEEEEEEOOOOOOOSSSSSSRRRRRIIIIIINNNNDDDDMMMMUUUUTTTTCCCCLLLPPPVVGGHQBFZJX" + "KWY";

/** Fase a partir de uma seed (via rng) e de um nível. Sempre devolve uma fase com pelo menos uma palavra. */
export function generatePuzzle(rng, level) {
  const { n } = level, pool = WORDS.filter(w => w.norm.length >= level.minLen && w.norm.length <= Math.min(level.maxLen, n));
  const target = level.words[0] + Math.floor(rng() * (level.words[1] - level.words[0] + 1));
  for (let count = target; count >= 1; count--) {        // se (muito raramente) não couber, tenta com uma palavra a menos
    for (let attempt = 0; attempt < 200; attempt++) {
      const chosen = [];
      for (const w of shuffle([...pool], rng)) {
        if (chosen.length === count) break;
        if (chosen.every(c => !clash(c.norm, w.norm))) chosen.push(w);
      }
      if (chosen.length < count) continue;
      const ordered = [...chosen].sort((a, b) => b.norm.length - a.norm.length).map(w => ({ ...w, diag: false }));
      /* As que ficam na diagonal: de preferência palavras que não ocupam a grade quase toda, porque numa diagonal comprida
         sobram pouquíssimas posições (e forçar uma delas faz o backtracking gastar tempo à toa). */
      const short = ordered.map((w, i) => i).filter(i => ordered[i].norm.length <= Math.ceil(n * 0.7)), rest = ordered.map((w, i) => i).filter(i => !short.includes(i));
      for (const k of [...shuffle(short, rng), ...shuffle(rest, rng)].slice(0, Math.min(level.minDiag ?? 0, count))) ordered[k].diag = true;
      const res = place(ordered, n, rng, level.pDiag ?? 0);
      if (!res) continue;
      const grid = res.grid.map(ch => ch || FILL[Math.floor(rng() * FILL.length)]);
      return { n, grid, words: shuffle(res.placed, rng) };
    }
  }
  throw new Error("Não foi possível gerar a fase.");
}
