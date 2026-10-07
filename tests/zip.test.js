import test from "node:test";
import assert from "node:assert/strict";
import { makeRng } from "../shared/rng.js";
import { LEVELS, applyMove, countSolutions, generatePuzzle, isSolved, setSize } from "../games/zip/domain.js";

const puzzle2x2 = () => { setSize(2); return { waypoints: new Map([[0, 1], [2, 2]]), walls: new Set(), max: 2 }; };

test("movimentos: avança, recua e resolve", () => {
  const p = puzzle2x2();
  let path = applyMove(p, [], 0);
  for (const cell of [1, 3, 2]) path = applyMove(p, path, cell);
  assert.deepEqual(path, [0, 1, 3, 2]);
  assert.ok(isSolved(p, path));
  assert.deepEqual(applyMove(p, [0, 1], 0), [0]);          // voltar na penúltima célula recua
});
test("paredes e números fora de ordem bloqueiam o caminho", () => {
  const p = puzzle2x2(); p.walls.add("0|1");
  assert.deepEqual(applyMove(p, [0], 1), [0]);
  const q = { waypoints: new Map([[0, 1], [1, 3], [2, 2]]), walls: new Set(), max: 3 };
  assert.deepEqual(applyMove(q, [0], 1), [0]);              // 3 antes do 2
});
for (const [i, level] of LEVELS.entries()) {
  test(`gera fase de solução única no nível ${level.name}`, () => {
    const p = generatePuzzle(makeRng(1000 + i), level);
    assert.equal(countSolutions(p.waypoints, p.walls, p.max), 1);
    assert.equal(p.waypoints.size >= level.wp[0], true);
  });
}
