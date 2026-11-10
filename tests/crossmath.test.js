/* Testes do domínio do CrossMath: metadados, geração nos quatro níveis, determinismo, banco, solução
   única e as regras de vitória (incluindo a leitura estritamente da esquerda para a direita). */
import test from "node:test";
import assert from "node:assert/strict";
import {
  LEVELS, GEN, STORE_KEY, MIN_BLANKS,
  generatePuzzle, isSolved, isUnique, countSolutions, wrongCells, stateOf,
} from "../games/crossmath/domain.js";
import { makeRng } from "../shared/rng.js";

const SEEDS = [1234, 98765, 4242, 777];
const nums = p => p.nums.map(cell => p.cells[cell].v);

test("metadados: chave de vitórias, versão e quatro níveis", () => {
  assert.equal(STORE_KEY, "crossmath.wins");
  assert.ok(GEN >= 1);
  assert.equal(LEVELS.length, 4);
  assert.deepEqual(LEVELS.map(l => l.name), ["Fácil", "Médio", "Difícil", "Genius"]);
  assert.deepEqual(LEVELS.map(l => l.max), [9, 12, 16, 20]);
});

test("cada nível gera fase coerente, com solução única e aceita", () => {
  for (const [i, level] of LEVELS.entries()) {
    const p = generatePuzzle(makeRng(SEEDS[i]), level);

    assert.ok(p.w >= 5 && p.h >= 3, `${level.name}: grade pequena demais`);
    assert.equal(p.cells.length, p.w * p.h);
    assert.equal(p.eqs.length >= level.minEqs, true, `${level.name}: poucas equações`);
    assert.equal(p.solution.length, p.nums.length, `${level.name}: solução fora de sincronia`);

    /* Equações no formato 5 ou 7 casas, números nas posições pares, = na penúltima. */
    for (const eq of p.eqs) {
      assert.ok(eq.length === 5 || eq.length === 7, `${level.name}: equação de ${eq.length} casas`);
      for (const [k, cell] of eq.entries()) {
        const c = p.cells[cell];
        assert.ok(c, `${level.name}: casa vazia dentro da equação`);
        if (k % 2 === 0) assert.equal(c.t, "n", `${level.name}: número fora de posição`);
        else if (k === eq.length - 2) assert.equal(c.t, "e", `${level.name}: sem sinal de igual`);
        else assert.equal(c.t, "o", `${level.name}: operador fora de posição`);
      }
    }

    /* Toda casa fora de equação é nula; todo número está em `p.nums`. */
    const inEq = new Set(p.eqs.flat());
    p.cells.forEach((c, cell) => {
      if (!inEq.has(cell)) assert.equal(c, null, `${level.name}: casa solta na grade`);
      else assert.ok(c, `${level.name}: casa de equação sem conteúdo`);
    });
    assert.deepEqual([...inEq].filter(cell => p.cells[cell].t === "n").sort((a, b) => a - b), p.nums);

    /* Dados: valor fixo entre 1 e max. Buracos: exatamente o banco. */
    const holes = p.nums.filter(cell => p.cells[cell].v == null);
    assert.ok(holes.length >= MIN_BLANKS, `${level.name}: poucos buracos`);
    assert.equal(p.bank.length, holes.length, `${level.name}: banco com tamanho errado`);
    assert.deepEqual(
      p.bank.slice().sort((a, b) => a - b),
      p.solution.filter((_, k) => p.cells[p.nums[k]].v == null).sort((a, b) => a - b),
      `${level.name}: banco diferente dos buracos`,
    );
    for (const cell of p.nums) {
      const v = p.cells[cell].v;
      if (v != null) assert.ok(Number.isInteger(v) && v >= 1 && v <= p.max, `${level.name}: dado fora da faixa`);
    }

    /* A solução pretendida vence e é a única. */
    const state = { nums: p.solution.slice() };
    assert.equal(isSolved(p, state), true, `${level.name}: a solução não vence`);
    assert.equal(isUnique(p), true, `${level.name}: a solução não é única`);
    assert.equal(countSolutions(p, 2).solutions, 1);
    assert.equal(wrongCells(p, state).size, 0, `${level.name}: acusou equação errada na solução`);
    assert.deepEqual(stateOf(p, new Map(p.nums.map((cell, k) => [cell, p.solution[k]]))), state, "stateOf monta o estado da UI");
  }
});

test("a mesma seed devolve a mesma fase (determinismo)", () => {
  const take = p => ({ w: p.w, h: p.h, cells: p.cells, nums: p.nums, eqs: p.eqs, bank: p.bank, solution: p.solution });
  for (const level of LEVELS) {
    const a = generatePuzzle(makeRng(2024), level);
    const b = generatePuzzle(makeRng(2024), level);
    assert.deepEqual(take(a), take(b), `${level.name}: gerador não determinístico`);
  }
});

test("isSolved recusa estado incompleto, valor trocado e dado desrespeitado", () => {
  const p = generatePuzzle(makeRng(99), LEVELS[0]);
  const good = p.solution.slice();
  assert.equal(isSolved(p, { nums: good }), true);

  assert.equal(isSolved(p, {}), false, "sem nums");
  assert.equal(isSolved(p, { nums: good.slice(1) }), false, "faltando uma casa");
  assert.equal(isSolved(p, { nums: good.map((v, k) => (k === 0 ? 0 : v)) }), false, "zero conta como vazio");
  assert.equal(isSolved(p, { nums: good.map((v, k) => (k === 0 ? v + 1 : v)) }), false, "valor trocado");

  /* Troca entre dois buracos de valores diferentes: o banco continua batendo, mas a equação não fecha. */
  const holes = p.nums.map((cell, k) => (p.cells[cell].v == null ? k : -1)).filter(k => k >= 0);
  const a = holes.find((k, i) => holes.some((other, j) => j > i && p.solution[other] !== p.solution[k]));
  const b = a == null ? null : holes.find(k => k !== a && p.solution[k] !== p.solution[a]);
  assert.ok(a != null && b != null, "o teste precisa de dois buracos com valores diferentes");
  const swapped = good.slice();
  [swapped[a], swapped[b]] = [swapped[b], swapped[a]];
  assert.equal(isSolved(p, { nums: swapped }), false, "troca entre buracos precisa ser recusada");

  /* Dado fixo alterado, mesmo com o banco correto. */
  const givenK = p.nums.findIndex(cell => p.cells[cell].v != null);
  assert.ok(givenK >= 0, "a fase precisa de pelo menos um dado");
  const altered = good.slice();
  altered[givenK] = altered[givenK] === 1 ? 2 : 1;
  assert.equal(isSolved(p, { nums: altered }), false, "dado fixo não pode ser trocado");
});

test("equações são lidas da esquerda para a direita (sem precedência de × e ÷)", () => {
  /* 10 − 2 × 3 = 24 da esquerda para a direita; com precedência daria 4. */
  const cells = [
    { t: "n", v: 10 }, { t: "o", v: "−" }, { t: "n", v: 2 }, { t: "o", v: "×" }, { t: "n", v: 3 }, { t: "e" }, { t: "n", v: 24 },
  ];
  const p = { w: 7, h: 1, max: 99, cells, eqs: [[0, 1, 2, 3, 4, 5, 6]], nums: [0, 2, 4, 6], bank: [] };
  assert.equal(isSolved(p, { nums: [10, 2, 3, 24] }), true);
  assert.equal(isSolved(p, { nums: [10, 2, 3, 4] }), false, "o resultado não pode seguir a precedência");
});

test("divisão precisa ser exata e resultados fora da faixa são recusados", () => {
  const cells = [
    { t: "n", v: 8 }, { t: "o", v: "÷" }, { t: "n", v: 2 }, { t: "e" }, { t: "n", v: 4 },
  ];
  const p = { w: 5, h: 1, max: 9, cells, eqs: [[0, 1, 2, 3, 4]], nums: [0, 2, 4], bank: [] };
  assert.equal(isSolved(p, { nums: [8, 2, 4] }), true);
  assert.equal(isSolved(p, { nums: [8, 3, 4] }), false, "8 ÷ 3 não é inteiro");
  assert.equal(isSolved(p, { nums: [8, 2, 10] }), false, "resultado acima do máximo");

  /* Equação com resultado em branco e banco de um número (o formato do fallback). */
  const holeCells = [
    { t: "n", v: 2 }, { t: "o", v: "+" }, { t: "n", v: 3 }, { t: "e" }, { t: "n", v: null },
  ];
  const q = { w: 5, h: 1, max: 9, cells: holeCells, eqs: [[0, 1, 2, 3, 4]], nums: [0, 2, 4], bank: [5] };
  assert.equal(isSolved(q, { nums: [2, 3, 5] }), true);
  assert.equal(isSolved(q, { nums: [2, 3, 6] }), false);
  assert.equal(wrongCells(q, { nums: [2, 3, 6] }).size > 0, true, "a equação errada é destacada");
});
