/* Testes do domínio do Queens: geração (solução única e regiões conectadas), regras de vitória e conflitos. */
import test from "node:test";
import assert from "node:assert/strict";
import { LEVELS, generatePuzzle, isSolved, isUnique, conflicts, neighborsOf, solutionCells, GEN, STORE_KEY } from "../games/queens/domain.js";
import { adjacencyOf, assignColors, inkFor, luminance, PALETTE, regionShades } from "../games/queens/colors.js";
import { makeRng } from "../shared/rng.js";

const SEEDS = [1234, 98765, 4242, 777];

function regionSizes(puzzle) {
  const sizes = new Array(puzzle.n).fill(0);
  for (const g of puzzle.regions) sizes[g]++;
  return sizes;
}

function connected(puzzle, g) {
  const n = puzzle.n, cells = [];
  for (let i = 0; i < n * n; i++) if (puzzle.regions[i] === g) cells.push(i);
  const seen = new Set([cells[0]]), stack = [cells[0]];
  while (stack.length) {
    const cell = stack.pop(), r = (cell / n) | 0, c = cell % n;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
      const nb = rr * n + cc;
      if (seen.has(nb) || puzzle.regions[nb] !== g) continue;
      seen.add(nb); stack.push(nb);
    }
  }
  return seen.size === cells.length;
}

test("metadados: chave de vitórias e versão do gerador", () => {
  assert.equal(STORE_KEY, "queens.wins");
  assert.ok(GEN >= 1);
  assert.equal(LEVELS.length, 4, "quatro níveis");
  assert.deepEqual(LEVELS.map(l => l.n), [8, 10, 12, 14]);
});

test("cada nível gera fase solucionável, de solução única, com N regiões conectadas", () => {
  for (const [i, level] of LEVELS.entries()) {
    const p = generatePuzzle(makeRng(SEEDS[i]), level);
    assert.equal(p.n, level.n);
    assert.equal(p.regions.length, p.n * p.n, "uma região por casa");
    assert.ok(p.regions.every(g => Number.isInteger(g) && g >= 0 && g < p.n), "ids de região válidos");
    assert.equal(new Set(p.regions).size, p.n, "exatamente N regiões");
    const sizes = regionSizes(p);
    assert.ok(sizes.every(s => s >= 1), "nenhuma região vazia");
    assert.equal(sizes.reduce((a, b) => a + b, 0), p.n * p.n, "as regiões cobrem a grade");

    const cells = solutionCells(p);
    assert.equal(cells.length, p.n);
    assert.equal(new Set(cells).size, p.n, "uma rainha por linha");
    assert.ok(isSolved(p, cells), "a solução pretendida vale");
    assert.ok(isUnique(p), `${level.name}: a solução tem de ser única`);
    for (let g = 0; g < p.n; g++) assert.ok(connected(p, g), `${level.name}: região ${g} desconectada`);
  }
});

test("cores das regiões: nenhuma vizinha repete a cor (e até 12 regiões todas são diferentes)", () => {
  for (const [i, level] of LEVELS.entries()) {
    const p = generatePuzzle(makeRng(31 + i * 7), level);
    const adj = adjacencyOf(p.regions, p.n);
    const colors = assignColors(p.n, adj);
    assert.equal(colors.length, p.n, "uma cor por região");
    for (let g = 0; g < p.n; g++) {
      for (const v of adj[g]) assert.notEqual(colors[g], colors[v], `${level.name}: regiões ${g} e ${v} com a mesma cor`);
    }
    if (p.n <= PALETTE.length) assert.equal(new Set(colors).size, p.n, `${level.name}: cores repetidas sem precisar`);
  }
  assert.equal(new Set(PALETTE.map(c => c.hex)).size, PALETTE.length, "paleta sem cores repetidas");
});

test("o relevo de cada casa clareia no topo e escurece na base", () => {
  for (const { hex } of PALETTE) {
    const { hi, base, lo } = regionShades(hex);
    assert.equal(base, hex, "a cor base é a da paleta");
    assert.ok(luminance(hi) > luminance(hex) + 0.005, `${hex}: o topo não clareou`);
    assert.ok(luminance(lo) < luminance(hex) - 0.005, `${hex}: a base não escureceu`);
    assert.ok(luminance(hi) - luminance(lo) > 0.03, `${hex}: relevo fraco demais`);
  }
});

test("a cor da coroa/X contrasta com a casa em toda a paleta", () => {
  for (const { hex } of PALETTE) {
    const ink = inkFor(hex);
    const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    assert.ok(["#ffffff", "#14213d"].includes(ink), `${hex}: tinta inesperada`);
    assert.ok(ratio(ink, hex) >= 3, `${hex}: contraste ${ratio(ink, hex).toFixed(1)}:1 abaixo do mínimo`);
  }
});

test("a mesma seed devolve a mesma fase (determinismo)", () => {
  const a = generatePuzzle(makeRng(2024), LEVELS[0]);
  const b = generatePuzzle(makeRng(2024), LEVELS[0]);
  assert.deepEqual(a, b);
});

test("isSolved recusa colocações inválidas", () => {
  const p = generatePuzzle(makeRng(99), LEVELS[0]);
  const good = solutionCells(p);
  assert.ok(isSolved(p, good));
  assert.ok(!isSolved(p, good.slice(1)), "faltando uma rainha");
  assert.ok(!isSolved(p, [...good, good[0]]), "rainha repetida");
  assert.ok(!isSolved(p, good.map((c, i) => (i === 0 ? (c + 1) % p.n : c))), "coluna trocada");

  /* Duas rainhas vizinhas na diagonal (0,0) e (1,1), com as linhas 0 e 1 trocadas pelo par. */
  const adj = good.filter((_, i) => i !== 0 && i !== 1).concat([0, p.n + 1]);
  assert.ok(!isSolved(p, adj), "rainhas vizinhas reprovam");
});

test("conflicts aponta as rainhas que se atacam e neighborsOf as casas interditadas", () => {
  const p = generatePuzzle(makeRng(7), LEVELS[0]);
  const cells = solutionCells(p);
  assert.equal(conflicts(p, cells).size, 0, "solução sem conflito");
  assert.equal(neighborsOf(p, []).size, 0);

  const sameRow = [0, 1];                               // duas rainhas na mesma linha, vizinhas
  assert.deepEqual([...conflicts(p, sameRow)].sort(), sameRow);
  const diagonal = [0, p.n + 1];                        // (0,0) e (1,1)
  assert.deepEqual([...conflicts(p, diagonal)].sort(), diagonal);
  const neigh = neighborsOf(p, [0]);
  assert.ok(neigh.has(1) && neigh.has(p.n + 1) && !neigh.has(0));
});
