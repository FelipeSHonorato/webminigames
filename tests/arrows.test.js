import test from "node:test";
import assert from "node:assert/strict";
import { makeRng } from "../shared/rng.js";
import { DIRS, GEN, LEVELS, STORE_KEY, clearDir, generatePuzzle, isSolved, removable, shapeCells, solveOrder, tileCells } from "../games/arrows/domain.js";

/* ---------- formatos ---------- */
test("shapeCells: quadrado é cheio; losango e coração deixam cantos vazios", () => {
  const sq = shapeCells(6, "square"), di = shapeCells(6, "diamond"), he = shapeCells(7, "heart");
  assert.ok(sq.every(Boolean), "quadrado deveria ter todas as casas");
  assert.equal(sq.length, 36);
  assert.ok(di.filter(Boolean).length < 36 && he.filter(Boolean).length < 49);
  assert.equal(di[0], false, "canto do losango deveria ficar vazio");   // canto superior esquerdo
  assert.equal(he[0], false, "canto do coração deveria ficar vazio");
  assert.equal(di[2 * 6 + 3], true, "centro do losango deveria existir");
  assert.equal(he[3 * 7 + 3], true, "centro do coração deveria existir");
});

test("níveis: quatro níveis, formatos definidos, e GEN inteiro", () => {
  assert.deepEqual(LEVELS.map(l => l.name), ["Fácil", "Médio", "Difícil", "Genius"]);
  assert.ok(LEVELS.every(l => l.n >= 5 && typeof l.shape === "string"));
  assert.equal(STORE_KEY, "arrows.wins");
  assert.ok(Number.isInteger(GEN) && GEN >= 1);
});

/* ---------- regras ---------- */
test("clearDir: caminho livre até a borda, bloqueado por seta presente no meio", () => {
  const dirs = [0, -1, -1, -1, -1, -1, -1, -1, -1];      // só a casa 0, apontando para cima (N)
  assert.equal(clearDir(3, dirs, new Set([0]), 0, 0), true);   // N: borda logo acima
  assert.equal(clearDir(3, dirs, new Set([0]), 0, 2), true);   // S: nada na coluna abaixo
  assert.equal(clearDir(3, dirs, new Set([0, 6]), 0, 2), false);   // a casa 6 (mesma coluna) barra
  assert.equal(clearDir(3, dirs, new Set([0, 3]), 0, 2), false);   // a casa 3 (vizinha abaixo) barra
});

test("removable: seta ausente nunca sai; seta com caminho livre sai", () => {
  const dirs = [1, -1, -1, 2, -1, -1, -1, -1, -1];       // casa 0 aponta L (livre), casa 3 aponta S (livre)
  const present = new Set([0, 3]);
  assert.equal(removable(3, dirs, present, 0), true);
  assert.equal(removable(3, dirs, present, 1), false);    // casa vazia (dirs = -1)
  assert.equal(removable(3, dirs, present, 3), true);
});

test("solveOrder: limpa o tabuleiro quando há solução e devolve null quando não há", () => {
  /* 2x2 em anel: 0 aponta S, 1 aponta S, 2 aponta N, 3 aponta N → todos travados. */
  const stuck = [2, 2, 0, 0];
  assert.equal(solveOrder(2, stuck), null);
  /* 2x2 em Z: 0 e 3 saem de cara; depois 1 (atrás do 0) e 2 (atrás do 3). */
  const ok = [0, 3, 1, 2];
  const order = solveOrder(2, ok);
  assert.equal(order.length, 4);
  assert.equal(isSolved(2, ok, order), true);
  assert.deepEqual(new Set(order), new Set([0, 1, 2, 3]));
});

test("isSolved: aceita a ordem válida e recusa seta travada, repetida ou faltando", () => {
  const n = 2, dirs = [0, 3, 1, 2];
  assert.equal(isSolved(n, dirs, [0, 1, 3, 2]), true);
  assert.equal(isSolved(n, dirs, [1, 0, 3, 2]), false, "a seta 1 começa travada pela 0");
  assert.equal(isSolved(n, dirs, [0, 0, 1, 3, 2]), false, "casa repetida");
  assert.equal(isSolved(n, dirs, [0, 1, 3]), false, "faltou uma seta");
  assert.equal(isSolved(n, dirs, "abc"), false, "ordem não é lista");
});

/* ---------- gerador ---------- */
const startFree = (n, dirs) => { const present = new Set(tileCells(dirs)); return tileCells(dirs).filter(c => removable(n, dirs, present, c)).length; };

for (const [i, level] of LEVELS.entries()) {
  test(`gera fase válida e solucionável no nível ${level.name} (${level.n}x${level.n}, ${level.shape})`, () => {
    const mask = shapeCells(level.n, level.shape), total = mask.filter(Boolean).length;
    for (let seed = 1; seed <= 40; seed++) {
      const p = generatePuzzle(makeRng(seed * 977 + i), level);
      assert.equal(p.n, level.n);
      assert.equal(p.dirs.length, level.n * level.n);
      assert.ok(p.dirs.every(d => d === -1 || (d >= 0 && d <= 3)), `seed ${seed}: direção inválida`);
      assert.equal(tileCells(p.dirs).length, total, `seed ${seed}: as casas não batem com o formato`);
      assert.equal(p.solution.length, total);
      assert.equal(isSolved(level.n, p.dirs, p.solution), true, `seed ${seed}: a solução não limpa o tabuleiro`);
      const free = startFree(level.n, p.dirs);
      assert.ok(free < total, `seed ${seed}: a fase já começa resolvida`);
      assert.ok(free <= total * 0.5, `seed ${seed}: fase fácil demais (${free}/${total} livres)`);
    }
  });
}

test("o gerador é determinístico na seed e varia entre seeds", () => {
  const a = generatePuzzle(makeRng(42), LEVELS[2]);
  const b = generatePuzzle(makeRng(42), LEVELS[2]);
  const c = generatePuzzle(makeRng(43), LEVELS[2]);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.dirs, c.dirs);
});

test("toda seta do formato recebe uma direção (nenhuma casa do formato fica vazia)", () => {
  const p = generatePuzzle(makeRng(7), LEVELS[0]);
  const mask = shapeCells(p.n, LEVELS[0].shape);
  for (let i = 0; i < mask.length; i++) assert.equal(p.dirs[i] >= 0, mask[i], `casa ${i} divergiu do formato`);
});

test("DIRS aponta em sentido horário N, L, S, O", () => {
  assert.deepEqual(DIRS, [[-1, 0], [0, 1], [1, 0], [0, -1]]);
});
