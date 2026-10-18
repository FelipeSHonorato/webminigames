/* Testes da validação server-side (Edge Function): o servidor monta o puzzle a partir da seed secreta e
   confere o tabuleiro antes de pontuar. Aqui testamos a lógica PURA (supabase/functions/play/_shared/board.js),
   além de garantir que as cópias dos domínios dentro da função continuam idênticas às de games/. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeRng } from "../shared/rng.js";
import { publicView, validate, GAMES } from "../supabase/functions/play/_shared/board.js";
import * as canos from "../games/canos/domain.js";
import * as cruzadas from "../games/cruzadas/domain.js";
import * as patches from "../games/patches/domain.js";
import * as sopa from "../games/sopa/domain.js";
import * as sudoku from "../games/sudoku/domain.js";
import * as zip from "../games/zip/domain.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = p => readFileSync(join(root, p), "utf8");
const normPoints = s => s.replace(/"(?:\.\.\/)+(?:shared\/)?points\.js"/g, '"POINTS"');

/* ---------- paridade entre games/ e a cópia usada pela Edge Function ---------- */
test("cópias dos domínios na Edge Function batem com games/ (paridade)", () => {
  for (const g of ["canos", "cruzadas", "patches", "sopa", "sudoku", "zip"]) {
    assert.equal(normPoints(read(`supabase/functions/play/_shared/${g}/domain.js`)), normPoints(read(`games/${g}/domain.js`)), `domain de ${g} divergiu`);
  }
  for (const g of ["cruzadas", "sopa"]) {
    assert.equal(read(`supabase/functions/play/_shared/${g}/words.js`), read(`games/${g}/words.js`), `words de ${g} divergiu`);
  }
  assert.equal(normPoints(read("supabase/functions/play/_shared/points.js")), read("shared/points.js"));
  assert.equal(read("supabase/functions/play/_shared/rng.js"), read("shared/rng.js"));
});

/* ---------- o puzzle público NUNCA carrega a solução ---------- */
test("visão pública não vaza a solução (jogos fortes)", () => {
  for (const g of ["sudoku", "canos", "patches", "zip"]) {
    const view = JSON.stringify(publicView(g, 12345, 0));
    assert.ok(!view.includes("solution"), `${g} vazou a solução`);
    assert.ok(!view.includes("\"path\""), `${g} vazou o caminho`);
  }
});

test("visão pública de sopa e cruzadas não carrega a solução", () => {
  const sopaView = JSON.stringify(publicView("sopa", 555, 0));
  assert.ok(!sopaView.includes("\"cells\""), "sopa vazou as células das palavras");
  assert.ok(!sopaView.includes("\"dir\""), "sopa vazou a direção das palavras");
  const cruz = JSON.stringify(publicView("cruzadas", 666, 0));
  assert.ok(!cruz.includes("\"ch\""), "cruzadas vazou as letras certas");
  assert.ok(!cruz.includes("\"norm\""), "cruzadas vazou as respostas");
  assert.ok(cruz.includes("\"cap\""), "cruzadas deveria mandar a capacidade das casas (cap)");
  assert.ok(cruz.includes("\"len\""), "cruzadas deveria mandar o tamanho das respostas (len)");
});

/* ---------- aceita a solução correta ---------- */

test("solve() do sudoku é aceito e um tabuleiro inválido é recusado", () => {
  const seed = 111, lvl = 0;
  const p = sudoku.generatePuzzle(makeRng(seed), sudoku.LEVELS[lvl]);
  const grid = sudoku.solve(p.cells);
  assert.equal(validate("sudoku", seed, lvl, { grid }), true);
  assert.equal(validate("sudoku", seed, lvl, { grid: grid.map((v, i) => (i === 0 ? 0 : v)) }), false);
  assert.equal(validate("sudoku", seed, lvl, { grid: grid.map((v, i) => (i === 0 ? (v % 9) + 1 : v)) }), false);
});

test("canos: giros da solução são aceitos; giros iniciais embaralhados são recusados", () => {
  const seed = 222, lvl = 0;
  const p = canos.generatePuzzle(makeRng(seed), canos.LEVELS[lvl]);
  assert.equal(validate("canos", seed, lvl, { rots: canos.solutionRots(p) }), true);
  assert.equal(validate("canos", seed, lvl, { rots: canos.initialRots(p) }), false);
});

test("patches: a partição solução é aceita; um retângulo fora do lugar é recusado", () => {
  const seed = 333, lvl = 0;
  const p = patches.generatePuzzle(makeRng(seed), patches.LEVELS[lvl]);
  assert.equal(validate("patches", seed, lvl, { rects: p.solution }), true);
  const bad = p.solution.map((r, i) => (i === 0 ? [r[0], r[1], r[2], Math.min(r[3] + 1, patches.N - 1)] : r));
  assert.equal(validate("patches", seed, lvl, { rects: bad }), false);
});

test("zip: o caminho solução é aceito; caminho curto é recusado", () => {
  const seed = 444, lvl = 0;
  const p = zip.generatePuzzle(makeRng(seed), zip.LEVELS[lvl]);
  assert.equal(validate("zip", seed, lvl, { path: p.solution }), true);
  assert.equal(validate("zip", seed, lvl, { path: p.solution.slice(0, -1) }), false);
  const swapped = [...p.solution]; [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  assert.equal(validate("zip", seed, lvl, { path: swapped }), false);
});

test("sopa: todas as palavras aceitas; seleção vazia recusada", () => {
  const seed = 555, lvl = 0;
  const p = sopa.generatePuzzle(makeRng(seed), sopa.LEVELS[lvl]);
  const found = p.words.map((_, i) => i);
  assert.equal(validate("sopa", seed, lvl, { found }), true);
  assert.equal(validate("sopa", seed, lvl, { found: [] }), false);
  assert.equal(validate("sopa", seed, lvl, { found: [...found, 0] }), false);
});

test("sopa: quando o cliente manda as células, elas têm de ser uma ocorrência real", () => {
  const seed = 555, lvl = 0;
  const p = sopa.generatePuzzle(makeRng(seed), sopa.LEVELS[lvl]);
  const found = p.words.map((w, i) => ({ index: i, cells: w.cells }));   // o que a UI envia no modo nuvem
  assert.equal(validate("sopa", seed, lvl, { found }), true);
  const wrong = found.map((f, i) => (i === 0 ? { ...f, cells: f.cells.map(c => (c + 1) % (p.n * p.n)) } : f));
  assert.equal(validate("sopa", seed, lvl, { found: wrong }), false);
});

test("a visão pública do patches traz o lado da grade (a UI precisa dele para reconstruir)", () => {
  assert.equal(publicView("patches", 333, 2).n, patches.LEVELS[2].n);
});

test("cruzadas: grade completa é aceita; vazia é recusada", () => {
  const seed = 666, lvl = 0;
  const p = cruzadas.generatePuzzle(makeRng(seed), cruzadas.LEVELS[lvl]);
  const entries = p.cells.map(c => (c.t === "L" ? c.ch : ""));
  assert.equal(validate("cruzadas", seed, lvl, { entries: cruzadas.encodeEntries(entries) }), true);
  assert.equal(validate("cruzadas", seed, lvl, { entries: "" }), false);
});

test("puzzles diferentes têm a mesma seed mas níveis diferentes mudam a dificuldade do sudoku", () => {
  const a = sudoku.generatePuzzle(makeRng(9), sudoku.LEVELS[0]);
  const b = sudoku.generatePuzzle(makeRng(9), sudoku.LEVELS[3]);
  assert.ok(a.givens >= b.givens, "nível maior deveria ter menos pistas");
});

test("GAMES agrupa os seis domínios", () => {
  assert.deepEqual(Object.keys(GAMES).sort(), ["canos", "cruzadas", "patches", "sopa", "sudoku", "zip"]);
});
