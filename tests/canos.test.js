import test from "node:test";
import assert from "node:assert/strict";
import { makeRng } from "../shared/rng.js";
import {
  BASE, BIT, DELTA, E, GEN, LEVELS, N, S, W, clicksNeeded, firstLeaks, generatePuzzle, initialRots, maskOf, rotateMask, rotateTile, simulate, solutionRots,
} from "../games/canos/domain.js";

test("rotateMask gira no sentido horário: N→L→S→O→N; quatro giros voltam ao começo", () => {
  assert.equal(rotateMask(BIT[N], 1), BIT[E]);
  assert.equal(rotateMask(BIT[E], 1), BIT[S]);
  assert.equal(rotateMask(BIT[S], 1), BIT[W]);
  assert.equal(rotateMask(BIT[W], 1), BIT[N]);
  for (const m of Object.values(BASE)) { assert.equal(rotateMask(m, 4), m); assert.equal(rotateMask(m, 0), m); assert.equal(rotateMask(m, -1), rotateMask(m, 3)); }
});

test("tipos de cano: reto liga lados opostos, curva liga lados vizinhos, T tem 3 saídas, cruz tem 4", () => {
  const count = m => [0, 1, 2, 3].filter(s => m & BIT[s]).length;
  assert.deepEqual([count(BASE.I), count(BASE.L), count(BASE.T), count(BASE.X)], [2, 2, 3, 4]);
  assert.equal(maskOf("I", 0), BIT[N] | BIT[S]);
  assert.equal(maskOf("I", 1), BIT[E] | BIT[W]);
  assert.equal(maskOf("I", 2), maskOf("I", 0));                      // o reto tem só 2 posições distintas
  assert.equal(new Set([0, 1, 2, 3].map(r => maskOf("L", r))).size, 4);   // a curva tem 4
  assert.equal(new Set([0, 1, 2, 3].map(r => maskOf("T", r))).size, 4);
  assert.equal(new Set([0, 1, 2, 3].map(r => maskOf("X", r))).size, 1);   // a cruz não muda
});

test("rotateTile: um clique gira 90° (horário), o anti-horário volta, e não altera o original", () => {
  const r = [0, 1, 2, 3];
  assert.deepEqual(rotateTile(r, 0), [1, 1, 2, 3]);
  assert.deepEqual(rotateTile(r, 3), [0, 1, 2, 0]);                  // 3 → 0 (dá a volta)
  assert.deepEqual(rotateTile(r, 0, -1), [3, 1, 2, 3]);
  assert.deepEqual(r, [0, 1, 2, 3]);
});

test("níveis: grades 5, 10, 15 e 20, com 1, 1,5, 2 e 3 minutos", () => {
  assert.deepEqual(LEVELS.map(l => l.n), [5, 10, 15, 20]);
  assert.deepEqual(LEVELS.map(l => l.seconds), [60, 90, 120, 180]);
  assert.ok(LEVELS.every(l => l.minLen < l.maxLen && l.minLen >= l.n && l.maxLen < l.n * l.n));
  assert.ok(Number.isInteger(GEN) && GEN >= 1);
});

/* ----- A água, em cenários pequenos feitos à mão ----- */
/** Fase de n x n toda de curvas "L" (sem rotação), com a entrada e a saída dadas; `set` troca casas: { cell: [tipo, giro] }. */
const make = (n, inlet, outlet, set = {}) => {
  const tiles = Array.from({ length: n * n }, () => ({ type: "L", rot: 0 }));
  for (const [cell, [type, rot]] of Object.entries(set)) tiles[+cell] = { type, rot };
  return { n, tiles, inlet, outlet, path: [], solution: new Array(n * n).fill(-1) };
};

test("água: cano reto de ponta a ponta leva a água à saída, uma casa por onda", () => {
  const p = make(3, { cell: 3, side: W }, { cell: 5, side: E }, { 3: ["I", 1], 4: ["I", 1], 5: ["I", 1] });
  const sim = simulate(p, initialRots(p));
  assert.equal(sim.status, "win");
  assert.equal(sim.outletDepth, 2);
  assert.deepEqual(sim.fills.map(f => [f.cell, f.depth]), [[3, 0], [4, 1], [5, 2]]);
  assert.deepEqual(sim.leaks, []);
});

test("água: cano do meio fora de posição vaza na casa anterior, e o jogo acaba nessa onda", () => {
  const p = make(3, { cell: 3, side: W }, { cell: 5, side: E }, { 3: ["I", 1], 4: ["I", 0], 5: ["I", 1] });   // o do meio está em pé
  const sim = simulate(p, initialRots(p));
  assert.equal(sim.status, "leak");
  assert.deepEqual(sim.leaks, [{ cell: 3, side: E, depth: 0 }]);
  assert.equal(sim.endDepth, 0);
  assert.deepEqual(firstLeaks(sim), sim.leaks);
  assert.equal(sim.outletDepth, -1);
});

test("água: o cano da entrada precisa estar virado para a água, senão ela nem entra", () => {
  const p = make(3, { cell: 3, side: W }, { cell: 5, side: E }, { 3: ["I", 0], 4: ["I", 1], 5: ["I", 1] });   // em pé: sem abertura para a esquerda
  const sim = simulate(p, initialRots(p));
  assert.equal(sim.status, "blocked");
  assert.deepEqual(sim.fills, []);
  assert.deepEqual(sim.leaks, [{ cell: 3, side: W, depth: 0 }]);
});

test("água: abertura que dá para a borda (fora da saída) vaza", () => {
  const p = make(3, { cell: 3, side: W }, { cell: 5, side: E }, { 3: ["L", 3], 4: ["I", 1], 5: ["I", 1] });   // curva O+N: sobe e a casa de cima não a recebe
  const sim = simulate(p, initialRots(p));
  assert.equal(sim.status, "leak");
  assert.ok(sim.leaks.some(l => l.cell === 3 && l.side === N));
  const edge = make(3, { cell: 3, side: W }, { cell: 5, side: E }, { 3: ["I", 1], 4: ["L", 3], 5: ["I", 1] });   // curva O+N no meio: a de cima está virada
  assert.equal(simulate(edge, initialRots(edge)).status, "leak");
});

test("água: circuito fechado sem a saída não vaza, mas também não vence ('stuck')", () => {
  /* 2x2: a casa 0 é um T (N=entrada, L, S) e as outras três curvas fecham um anel em volta. */
  const p = make(2, { cell: 0, side: N }, { cell: 3, side: E }, { 0: ["T", 1], 1: ["L", 2], 3: ["L", 3], 2: ["L", 0] });
  const sim = simulate(p, initialRots(p));
  assert.equal(sim.status, "stuck");
  assert.deepEqual(sim.leaks, []);
  assert.equal(sim.fills.length, 4);                                  // a água enche o anel todo
});

test("água: ramo que vaza DEPOIS de a água chegar à saída não impede a vitória; vazar antes ou ao mesmo tempo, sim", () => {
  /* 4x4: a casa 0 é um T com entrada (O), saída (N) e uma saída para baixo, que desce mais 2 casas e vaza só na onda 1. */
  const set = { 0: ["T", 3], 4: ["I", 0], 8: ["I", 1] };
  const p = make(4, { cell: 0, side: W }, { cell: 0, side: N }, set);
  const win = simulate(p, initialRots(p));
  assert.equal(win.outletDepth, 0);
  assert.deepEqual(win.leaks.map(l => l.depth), [1]);
  assert.equal(win.status, "win", "a saída (onda 0) vem antes do vazamento (onda 1)");
  const tie = make(4, { cell: 0, side: W }, { cell: 0, side: N }, { 0: ["T", 3], 4: ["I", 1] });   // o ramo de baixo vaza já na onda 0
  assert.equal(simulate(tie, initialRots(tie)).status, "leak", "empate: vazamento vence");
  const early = make(3, { cell: 3, side: W }, { cell: 5, side: E }, { 3: ["T", 2], 4: ["I", 1], 5: ["I", 1], 6: ["I", 1] });   // T abre para baixo e vaza na onda 1; saída só na 2
  assert.equal(simulate(early, initialRots(early)).status, "leak");
});

test("água: a água se espalha por todos os ramos ligados (T e cruz dividem o fluxo)", () => {
  const p = make(3, { cell: 3, side: W }, { cell: 5, side: E }, { 3: ["X", 0], 0: ["I", 0], 6: ["I", 0], 4: ["I", 1], 5: ["I", 1] });
  const sim = simulate(p, initialRots(p));
  const reached = new Set(sim.fills.map(f => f.cell));
  assert.ok(reached.has(0) && reached.has(6) && reached.has(4), "a água passou pelos três ramos");
  assert.equal(sim.status, "leak");                                   // os ramos de cima e de baixo vazam na borda
});

/* ----- O gerador ----- */
const sidesTouch = (n, cell, side) => (side === N ? cell < n : side === S ? cell >= n * (n - 1) : side === W ? cell % n === 0 : cell % n === n - 1);

for (const [i, level] of LEVELS.entries()) {
  test(`gera cenário válido no nível ${level.name} (${level.n}x${level.n}, ${level.seconds}s)`, () => {
    for (let seed = 1; seed <= 40; seed++) {
      const p = generatePuzzle(makeRng(seed * 977 + i), level), n = level.n;
      assert.equal(p.n, n);
      assert.equal(p.tiles.length, n * n);
      assert.ok(p.tiles.every(t => ["I", "L", "T", "X"].includes(t.type) && t.rot >= 0 && t.rot <= 3));
      assert.ok(p.path.length >= level.minLen && p.path.length <= level.maxLen, `seed ${seed}: caminho de ${p.path.length}`);
      assert.equal(new Set(p.path).size, p.path.length, "caminho repete casa");
      for (let k = 1; k < p.path.length; k++) {
        const a = p.path[k - 1], b = p.path[k];
        assert.ok(DELTA.some(([dr, dc]) => Math.floor(a / n) + dr === Math.floor(b / n) && (a % n) + dc === b % n), "casas seguidas do caminho não são vizinhas");
      }
      assert.equal(p.path[0], p.inlet.cell); assert.equal(p.path.at(-1), p.outlet.cell);
      assert.notEqual(p.inlet.cell, p.outlet.cell);
      assert.ok(sidesTouch(n, p.inlet.cell, p.inlet.side) && sidesTouch(n, p.outlet.cell, p.outlet.side), "entrada/saída fora da borda");
      assert.notEqual(p.inlet.side, p.outlet.side);
      assert.ok(p.path.every(c => p.tiles[c].type === "I" || p.tiles[c].type === "L"), "o caminho plantado usa só retos e curvas");
      const win = simulate(p, solutionRots(p));
      assert.equal(win.status, "win", `seed ${seed}`);
      assert.equal(win.outletDepth, p.path.length - 1);
      assert.deepEqual(win.leaks, [], "resolvida, a fase não pode vazar");
      assert.notEqual(simulate(p, initialRots(p)).status, "win", "a fase não pode começar resolvida");
      assert.ok(clicksNeeded(p, initialRots(p)) >= Math.ceil(p.path.length * 0.55) , "poucas casas do caminho começam erradas");
      assert.equal(clicksNeeded(p, solutionRots(p)), 0);
    }
  });
}

test("o gerador varia: entradas e saídas em lados diferentes, T e cruz como armadilhas, e a seed é determinística", () => {
  const pairs = new Set(), types = new Set();
  for (let seed = 1; seed <= 80; seed++) {
    const p = generatePuzzle(makeRng(seed), LEVELS[1]);
    pairs.add(`${p.inlet.side}>${p.outlet.side}`);
    p.tiles.forEach((t, c) => { if (!p.path.includes(c)) types.add(t.type); });
  }
  assert.ok(pairs.size >= 10, `só ${pairs.size} combinações de entrada e saída`);
  assert.deepEqual([...types].sort(), ["I", "L", "T", "X"]);
  const a = generatePuzzle(makeRng(42), LEVELS[2]), b = generatePuzzle(makeRng(42), LEVELS[2]), c = generatePuzzle(makeRng(43), LEVELS[2]);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.tiles, c.tiles);
});

test("clicksNeeded conta os giros horários que faltam (o reto precisa no máximo de 1)", () => {
  const p = generatePuzzle(makeRng(5), LEVELS[0]), rots = initialRots(p);
  const total = clicksNeeded(p, rots);
  assert.ok(total > 0);
  let left = total;
  const cur = [...rots];
  while (left > 0) {                                                  // girar uma casa errada do caminho reduz a conta
    const i = p.path.find(c => maskOf(p.tiles[c].type, cur[c]) !== maskOf(p.tiles[c].type, p.solution[c]));
    cur[i] = (cur[i] + 1) % 4;
    const now = clicksNeeded(p, cur);
    assert.equal(now, left - 1);
    left = now;
  }
  assert.equal(simulate(p, cur).status, "win");
  for (const c of p.path) if (p.tiles[c].type === "I") assert.ok([0, 1].includes((() => { let k = 0; while (maskOf("I", rots[c] + k) !== maskOf("I", p.solution[c])) k++; return k; })()));
});
