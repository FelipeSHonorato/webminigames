import test from "node:test";
import assert from "node:assert/strict";
import { makeRng } from "../shared/rng.js";
import { LEVELS, countSolutions, generatePuzzle, isSolved, randomPartition, rectCells, setSize, validateRect } from "../games/patches/domain.js";

test("validateRect aplica área, formato, pista única e sobreposição", () => {
  setSize(3);
  const puzzle = { clues: [{ cell: 0, area: 4, shape: "square" }, { cell: 8, area: null, shape: "tall" }] };
  assert.equal(validateRect(puzzle, [], [0, 0, 1, 1]).ok, true);
  assert.match(validateRect(puzzle, [], [0, 0, 0, 2]).reason, /área/);
  assert.match(validateRect(puzzle, [], [1, 1, 1, 1]).reason, /pista/);          // sem pista
  assert.match(validateRect(puzzle, [], [2, 2, 2, 2]).reason, /formato/);        // 1x1 com ícone "alto" não é alto
});
test("sobreposição e vitória", () => {
  setSize(2);
  const puzzle = { clues: [{ cell: 0, area: 2, shape: "wide" }, { cell: 2, area: 2, shape: "wide" }] };
  const top = { rect: [0, 0, 0, 1], clue: 0 }, bottom = { rect: [1, 0, 1, 1], clue: 1 };
  assert.equal(validateRect(puzzle, [top], [0, 0, 1, 1]).ok, false);
  assert.equal(isSolved([top]), false);
  assert.equal(isSolved([top, bottom]), true);
});
for (const [i, level] of LEVELS.entries()) {
  test(`gera fase de solução única no nível ${level.name}`, () => {
    const p = generatePuzzle(makeRng(2000 + i), level);
    assert.equal(countSolutions(p.clues), 1);
  });
}

/* Pista "1" (patch de uma célula) só existe no Fácil; do Médio em diante a fase nunca tem. */
const singles = p => p.solution.filter(([r0, c0, r1, c1]) => rectCells(r0, c0, r1, c1).length === 1).length;
for (const [i, level] of LEVELS.entries()) {
  if (level.singles) continue;
  test(`nível ${level.name} não gera patch de 1 célula nem pista "1"`, () => {
    for (let seed = 1; seed <= 40; seed++) {
      const p = generatePuzzle(makeRng(seed * 101 + i), level);
      assert.equal(singles(p), 0, `seed ${seed}: patch de 1 célula na solução`);
      assert.ok(p.clues.every(k => k.area !== 1), `seed ${seed}: pista com área 1`);
      assert.equal(countSolutions(p.clues), 1);
    }
  });
}
test("o nível Fácil continua podendo ter patches de 1 célula", () => {
  assert.equal(LEVELS[0].singles, true);
  assert.ok(Array.from({ length: 40 }, (_, k) => singles(generatePuzzle(makeRng(k + 1), LEVELS[0]))).some(n => n > 0));
});
test("randomPartition sem singles nunca devolve retângulo de 1 célula (ou null em beco sem saída)", () => {
  setSize(6);
  let nulls = 0, ok = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const rects = randomPartition(makeRng(seed), false);
    if (!rects) { nulls++; continue; }
    ok++;
    assert.ok(rects.every(([r0, c0, r1, c1]) => rectCells(r0, c0, r1, c1).length > 1));
    assert.equal(rects.reduce((sum, [r0, c0, r1, c1]) => sum + rectCells(r0, c0, r1, c1).length, 0), 36);   // cobre a grade toda
  }
  assert.ok(ok > 0, `nenhuma partição válida em 200 tentativas (${nulls} nulas)`);
});
