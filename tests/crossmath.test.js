/* Testes do domínio do CrossMath: metadados, geração nos quatro níveis, operadores permitidos em cada nível
   (Fácil + −; Médio + × ÷; Difícil + %; Genius + ^), determinismo, banco, solução única e as regras de vitória
   (incluindo a leitura estritamente da esquerda para a direita). */
import test from "node:test";
import assert from "node:assert/strict";
import {
  LEVELS, GEN, STORE_KEY, MIN_BLANKS,
  generatePuzzle, isSolved, isUnique, countSolutions, wrongCells, stateOf, applyOp, isNice,
} from "../games/crossmath/domain.js";
import { makeRng } from "../shared/rng.js";

const SEEDS = [1234, 98765, 4242, 777];
const nums = p => p.nums.map(cell => p.cells[cell].v);

test("metadados: chave de vitórias, versão e quatro níveis", () => {
  assert.equal(STORE_KEY, "crossmath.wins");
  assert.ok(GEN >= 1);
  assert.equal(LEVELS.length, 4);
  assert.deepEqual(LEVELS.map(l => l.name), ["Fácil", "Médio", "Difícil", "Genius"]);
  assert.deepEqual(LEVELS.map(l => l.max), [9, 12, 50, 100]);
  assert.ok(LEVELS.every(l => l.pick <= l.max), "o sorteio de operandos cabe no teto das casas");
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

/* ============================ operadores por nível ============================ */

const OPS_BY_LEVEL = [
  ["+", "−"],
  ["+", "−", "×", "÷"],
  ["+", "−", "×", "÷", "%"],
  ["+", "−", "×", "÷", "%", "^"],
];
const opsIn = p => new Set(p.cells.filter(c => c?.t === "o").map(c => c.v));

test("níveis declaram os operadores certos: Fácil + −; Médio + × ÷; Difícil + %; Genius + ^", () => {
  assert.deepEqual(LEVELS.map(l => l.ops), OPS_BY_LEVEL);
});

test("cada nível só usa os seus operadores e traz todos os fortes em toda fase", () => {
  for (const [i, level] of LEVELS.entries()) {
    const allowed = new Set(OPS_BY_LEVEL[i]);
    for (let seed = 1; seed <= 40; seed++) {
      const p = generatePuzzle(makeRng(seed * 7919 + i), level);
      const used = opsIn(p);
      for (const op of used) assert.ok(allowed.has(op), `${level.name} (seed ${seed}): operador ${op} não é permitido`);
      for (const op of OPS_BY_LEVEL[i].slice(2)) assert.ok(used.has(op), `${level.name} (seed ${seed}): faltou ${op}`);
      assert.equal(p.eqs.length >= level.minEqs, true, `${level.name} (seed ${seed}): caiu no fallback`);
      assert.ok(p.solution.every(v => Number.isInteger(v) && v >= 1 && v <= level.max), `${level.name}: valor fora de 1..${level.max}`);
      assert.equal(isSolved(p, { nums: p.solution }), true, `${level.name} (seed ${seed}): solução não vence`);
      assert.equal(isUnique(p), true, `${level.name} (seed ${seed}): solução não é única`);
    }
  }
});

test("Fácil nunca usa × ÷ % ^ (só adição e subtração)", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const used = opsIn(generatePuzzle(makeRng(seed), LEVELS[0]));
    assert.ok(used.size > 0, `seed ${seed}: sem operadores`);
    for (const bad of ["×", "÷", "%", "^"]) assert.equal(used.has(bad), false, `seed ${seed}: ${bad} no Fácil`);
  }
});

test("applyOp: percentual é a × b ÷ 100 e só vale se der inteiro", () => {
  assert.equal(applyOp(50, "%", 20), 10);
  assert.equal(applyOp(20, "%", 50), 10, "simétrico: 20% de 50 = 50% de 20");
  assert.equal(applyOp(25, "%", 40), 10);
  assert.equal(applyOp(50, "%", 7), null, "3,5 não é inteiro");
  assert.equal(applyOp(3, "%", 3), null);
});

test("applyOp: potência inteira, sem estouro e sem expoente negativo", () => {
  assert.equal(applyOp(2, "^", 5), 32);
  assert.equal(applyOp(3, "^", 4), 81);
  assert.equal(applyOp(10, "^", 2), 100);
  assert.equal(applyOp(7, "^", 1), 7);
  assert.equal(applyOp(1, "^", 99), 1);
  assert.equal(applyOp(-2, "^", 3), -8);
  assert.equal(applyOp(99, "^", 99), null, "estouro não vira número impreciso");
  assert.equal(applyOp(2, "^", -1), null);
});

test("applyOp: as quatro contas de sempre continuam iguais", () => {
  assert.equal(applyOp(6, "+", 3), 9);
  assert.equal(applyOp(6, "−", 9), -3);
  assert.equal(applyOp(6, "×", 3), 18);
  assert.equal(applyOp(6, "÷", 3), 2);
  assert.equal(applyOp(7, "÷", 2), null);
  assert.equal(applyOp(7, "÷", 0), null);
  assert.equal(applyOp(7, "?", 2), null, "operador desconhecido é inválido");
});

test("isSolved com % e ^ (esquerda para a direita, sem precedência)", () => {
  const eq5 = (a, op, b, r) => ({
    w: 5, h: 1, max: 100, eqs: [[0, 1, 2, 3, 4]], nums: [0, 2, 4], bank: [],
    cells: [{ t: "n", v: a }, { t: "o", v: op }, { t: "n", v: b }, { t: "e" }, { t: "n", v: r }],
  });
  assert.equal(isSolved(eq5(50, "%", 20, 10), { nums: [50, 20, 10] }), true);
  assert.equal(isSolved(eq5(50, "%", 20, 10), { nums: [50, 20, 15] }), false);
  assert.equal(isSolved(eq5(50, "%", 7, 3), { nums: [50, 7, 3] }), false, "percentual inexato não vale");
  assert.equal(isSolved(eq5(2, "^", 5, 32), { nums: [2, 5, 32] }), true);
  assert.equal(isSolved(eq5(2, "^", 5, 10), { nums: [2, 5, 10] }), false, "2 ^ 5 não é 10");

  /* 2 + 1 ^ 3: da esquerda para a direita é (2 + 1) ^ 3 = 27; com precedência seria 3. */
  const cells = [
    { t: "n", v: 2 }, { t: "o", v: "+" }, { t: "n", v: 1 }, { t: "o", v: "^" }, { t: "n", v: 3 }, { t: "e" }, { t: "n", v: 27 },
  ];
  const p = { w: 7, h: 1, max: 100, cells, eqs: [[0, 1, 2, 3, 4, 5, 6]], nums: [0, 2, 4, 6], bank: [] };
  assert.equal(isSolved(p, { nums: [2, 1, 3, 27] }), true);
  assert.equal(isSolved(p, { nums: [2, 1, 3, 3] }), false, "o ^ não tem precedência sobre o +");
});

test("o percentual tem ao menos uma fase possível e a equação errada é destacada", () => {
  const cells = [{ t: "n", v: 40 }, { t: "o", v: "%" }, { t: "n", v: 25 }, { t: "e" }, { t: "n", v: null }];
  const p = { w: 5, h: 1, max: 50, cells, eqs: [[0, 1, 2, 3, 4]], nums: [0, 2, 4], bank: [10] };
  assert.equal(isSolved(p, { nums: [40, 25, 10] }), true);
  assert.equal(isSolved(p, { nums: [40, 25, 11] }), false);
  assert.equal(wrongCells(p, { nums: [40, 25, 11] }).size > 0, true);
});

test("a rede de segurança respeita o operador do nível e é única", () => {
  for (const [i, level] of LEVELS.entries()) {
    const p = generatePuzzle(makeRng(5 + i), { ...level, tryLimit: 0 });   // força o fallback
    assert.equal(p.eqs.length, 1, `${level.name}: fallback é uma equação`);
    assert.deepEqual(p.bank, [p.solution[2]], `${level.name}: banco = resultado`);
    assert.equal(isSolved(p, { nums: p.solution }), true, `${level.name}: fallback não vence`);
    assert.equal(isUnique(p), true, `${level.name}: fallback não é único`);
    assert.ok(p.solution.every(v => v >= 1 && v <= level.max), `${level.name}: fallback fora de 1..${level.max}`);
    for (const op of opsIn(p)) assert.ok(OPS_BY_LEVEL[i].includes(op), `${level.name}: fallback com ${op}`);
  }
  assert.equal(opsIn(generatePuzzle(makeRng(1), { ...LEVELS[2], tryLimit: 0 })).has("%"), true);
  assert.equal(opsIn(generatePuzzle(makeRng(1), { ...LEVELS[3], tryLimit: 0 })).has("^"), true);
});

test("isNice: recusa × e ÷ por 1, 1 ^ b, a ^ 1 e percentual de 100", () => {
  assert.equal(isNice("×", 6, 1), false);
  assert.equal(isNice("×", 1, 6), false);
  assert.equal(isNice("×", 3, 4), true);
  assert.equal(isNice("÷", 6, 1), false);
  assert.equal(isNice("÷", 6, 3), true);
  assert.equal(isNice("^", 1, 5), false, "1 ^ b é sempre 1");
  assert.equal(isNice("^", 7, 1), false, "a ^ 1 é o próprio a");
  assert.equal(isNice("^", 2, 7), false, "expoente grande demais");
  assert.equal(isNice("^", 2, 5), true);
  assert.equal(isNice("%", 12, 100), false, "100% de 12 é 12");
  assert.equal(isNice("%", 100, 12), false);
  assert.equal(isNice("%", 50, 20), true);
  assert.equal(isNice("+", 0, 0), true, "+ e − não têm restrição");
});

test("nenhuma equação gerada é degenerada (× ÷ por 1, 1 ^ b, a ^ 1, % com 100)", () => {
  for (const [i, level] of LEVELS.entries()) {
    for (let seed = 1; seed <= 60; seed++) {
      const p = generatePuzzle(makeRng(seed * 31 + i), level);
      const val = cell => p.solution[p.nums.indexOf(cell)];
      for (const eq of p.eqs) {
        const n = eq.filter((_, k) => k % 2 === 0).map(val);
        let acc = n[0];
        for (let k = 1; k < n.length - 1; k++) {
          const op = p.cells[eq[2 * k - 1]].v;
          assert.equal(isNice(op, acc, n[k]), true, `${level.name} (seed ${seed}): ${acc} ${op} ${n[k]} é uma conta sem graça`);
          acc = applyOp(acc, op, n[k]);
        }
        assert.equal(acc, n[n.length - 1], `${level.name} (seed ${seed}): equação não fecha`);
      }
    }
  }
});
