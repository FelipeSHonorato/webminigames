import test from "node:test";
import assert from "node:assert/strict";
import { makeRng } from "../shared/rng.js";
import { LEVELS, countSolutions, generatePuzzle, isSolved, setSize, validateRect } from "../games/patches/domain.js";

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
