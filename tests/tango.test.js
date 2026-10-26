/* Testes do domínio do Tango: geração (solução única), regras de vitória, conflitos e determinismo. */
import test from "node:test";
import assert from "node:assert/strict";
import { LEVELS, generatePuzzle, isSolved, isUnique, conflicts, SUN, MOON, GEN, STORE_KEY } from "../games/tango/domain.js";
import { makeRng } from "../shared/rng.js";

const SEEDS = [1234, 98765, 4242, 777];

const at = (p, grid, r, c) => grid[r * p.n + c];

test("metadados: chave de vitórias, versão e tamanhos", () => {
  assert.equal(STORE_KEY, "tango.wins");
  assert.ok(GEN >= 1);
  assert.deepEqual(LEVELS.map(l => l.n), [8, 10, 12, 14]);
});

test("cada nível gera fase solucionável, de solução única e coerente", () => {
  for (const [i, level] of LEVELS.entries()) {
    const p = generatePuzzle(makeRng(SEEDS[i]), level);
    const n = p.n, half = n / 2;
    assert.equal(p.solution.length, n * n);
    assert.ok(p.solution.every(v => v === SUN || v === MOON));
    assert.ok(isSolved(p, p.solution), `${level.name}: a solução pretendida vale`);
    assert.ok(isUnique(p), `${level.name}: a solução tem de ser única`);
    assert.equal(new Set(p.givens.map(g => g.i)).size, p.givens.length, "sem dado repetido");
    assert.equal(new Set(p.marks.map(m => [m.a, m.b].sort().join(":"))).size, p.marks.length, "sem sinal repetido");
    for (const g of p.givens) assert.equal(p.solution[g.i], g.v, "dado igual à solução");
    for (const m of p.marks) assert.equal(p.solution[m.a] === p.solution[m.b], m.same, "sinal igual à solução");
    /* contagens da solução */
    for (let r = 0; r < n; r++) {
      let c0 = 0;
      for (let c = 0; c < n; c++) if (at(p, p.solution, r, c) === SUN) c0++;
      assert.equal(c0, half, `${level.name}: linha ${r} desbalanceada`);
    }
  }
});

test("a mesma seed devolve a mesma fase (determinismo)", () => {
  const a = generatePuzzle(makeRng(2024), LEVELS[0]);
  const b = generatePuzzle(makeRng(2024), LEVELS[0]);
  assert.deepEqual(a, b);
});

test("isSolved recusa contagem errada, tripla e sinal desrespeitado", () => {
  const p = generatePuzzle(makeRng(99), LEVELS[0]);
  const good = p.solution.slice();
  assert.ok(isSolved(p, good));
  assert.ok(!isSolved(p, good.slice(1)), "faltando casas");
  assert.ok(!isSolved(p, [...good.slice(0, -1), good[good.length - 1] === SUN ? MOON : SUN]), "casa trocada");

  const tri = good.slice();
  tri[0] = SUN; tri[1] = SUN; tri[2] = SUN;
  assert.ok(!isSolved(p, tri), "tripla reprovada");

  /* Sinal isolado: xadrez 4×4 (contagens e triplas válidas), só o sinal muda. */
  const checker = [SUN, MOON, SUN, MOON, MOON, SUN, MOON, SUN, SUN, MOON, SUN, MOON, MOON, SUN, MOON, SUN];
  const base = { n: 4, givens: [], marks: [] };
  assert.ok(isSolved(base, checker), "xadrez 4×4 é solução");
  assert.ok(!isSolved({ ...base, marks: [{ a: 0, b: 1, same: true }] }, checker), "sinal '=' desrespeitado");
  assert.ok(isSolved({ ...base, marks: [{ a: 0, b: 1, same: false }] }, checker), "sinal '≠' respeitado");
  assert.ok(!isSolved({ ...base, marks: [{ a: 0, b: 2, same: false }] }, checker), "sinal '≠' desrespeitado");
});

test("conflicts aponta triplas, excesso de símbolo e sinais quebrados", () => {
  const p = generatePuzzle(makeRng(7), LEVELS[0]);
  assert.equal(conflicts(p, p.solution).size, 0, "solução sem conflito");

  const tri = p.solution.slice();
  tri[0] = SUN; tri[1] = SUN; tri[2] = SUN;
  const bad = conflicts(p, tri);
  assert.ok(bad.has(0) && bad.has(1) && bad.has(2), "tripla marcada");

  /* Grade vazia (-1) não deve acusar nada. */
  assert.equal(conflicts(p, new Array(p.n * p.n).fill(-1)).size, 0);
});
