import test from "node:test";
import assert from "node:assert/strict";
import { makeRng } from "../shared/rng.js";
import {
  LEVELS, TOTAL, PEERS, candidates, conflicts, countSolutions, digitCounts, generatePuzzle, generateSolution,
  isSolved, newState, noteDigits, setDigit, solve, toggleNote,
} from "../games/sudoku/domain.js";

/* Grade válida conhecida (padrão clássico): cada linha é a anterior deslocada. */
const VALID = Array.from({ length: TOTAL }, (_, i) => { const r = (i / 9) | 0, c = i % 9; return ((r * 3 + ((r / 3) | 0) + c) % 9) + 1; });

test("cada célula enxerga 20 outras (linha, coluna e bloco)", () => {
  assert.ok(PEERS.every(p => p.length === 20));
});

test("conflicts acha repetições em linha, coluna e bloco; isSolved exige grade cheia e sem conflito", () => {
  assert.equal(conflicts(VALID).size, 0);
  assert.equal(isSolved(VALID), true);

  const row = new Array(TOTAL).fill(0); row[0] = 5; row[8] = 5;          // mesma linha
  assert.deepEqual([...conflicts(row)].sort((a, b) => a - b), [0, 8]);
  const col = new Array(TOTAL).fill(0); col[1] = 3; col[73] = 3;         // mesma coluna
  assert.deepEqual([...conflicts(col)].sort((a, b) => a - b), [1, 73]);
  const box = new Array(TOTAL).fill(0); box[0] = 7; box[20] = 7;         // mesmo bloco, linha e coluna diferentes
  assert.deepEqual([...conflicts(box)].sort((a, b) => a - b), [0, 20]);

  const incomplete = [...VALID]; incomplete[40] = 0;
  assert.equal(isSolved(incomplete), false);
  const wrong = [...VALID]; wrong[0] = wrong[1];
  assert.equal(isSolved(wrong), false);
});

test("candidates e digitCounts", () => {
  const grid = new Array(TOTAL).fill(0);
  grid[1] = 1; grid[9] = 2; grid[10] = 3;      // 1 na linha, 2 e 3 no bloco/coluna de 0 e vizinhos
  assert.deepEqual(candidates(grid, 0), [4, 5, 6, 7, 8, 9]);
  assert.equal(digitCounts(VALID).slice(1).every(n => n === 9), true);
});

test("setDigit: pistas não mudam, mesmo dígito apaga e anotações dos vizinhos são limpas", () => {
  const cells = new Array(TOTAL).fill(0); cells[0] = 4;
  const puzzle = { cells };
  let s = newState(puzzle);
  assert.equal(setDigit(puzzle, s, 0, 9), s);                  // pista: intacta
  s = toggleNote(puzzle, s, 1, 5); s = toggleNote(puzzle, s, 1, 6);   // anotações 5 e 6 na célula 1
  s = toggleNote(puzzle, s, 80, 5);                            // célula 80 não enxerga a 2: anotação fica
  s = setDigit(puzzle, s, 2, 5);                               // 5 na célula 2 (mesma linha da 1)
  assert.equal(s.grid[2], 5);
  assert.deepEqual(noteDigits(s.notes[1]), [6]);               // o 5 saiu da anotação da vizinha
  assert.deepEqual(noteDigits(s.notes[80]), [5]);
  const before = s;
  s = setDigit(puzzle, s, 2, 5);                               // repetir apaga
  assert.equal(s.grid[2], 0);
  assert.equal(before.grid[2], 5);                             // o estado anterior não foi alterado (imutável)
  s = setDigit(puzzle, s, 2, 7); s = setDigit(puzzle, s, 2, 0);
  assert.equal(s.grid[2], 0);
});

test("toggleNote só vale em células vazias e não-pistas", () => {
  const cells = new Array(TOTAL).fill(0); cells[0] = 4;
  const puzzle = { cells };
  let s = newState(puzzle);
  assert.equal(toggleNote(puzzle, s, 0, 1), s);                // pista
  s = setDigit(puzzle, s, 5, 3);
  assert.equal(toggleNote(puzzle, s, 5, 1), s);                // célula preenchida
  s = toggleNote(puzzle, s, 6, 2);
  assert.deepEqual(noteDigits(s.notes[6]), [2]);
  s = toggleNote(puzzle, s, 6, 2);
  assert.deepEqual(noteDigits(s.notes[6]), []);
});

test("countSolutions: 0, 1 ou várias soluções; solve resolve", () => {
  const one = [...VALID]; one[0] = 0;
  assert.equal(countSolutions(one), 1);
  assert.deepEqual(solve(one), VALID);
  assert.equal(countSolutions(new Array(TOTAL).fill(0)), 2);   // grade vazia: o limite é atingido
  const clash = new Array(TOTAL).fill(0); clash[0] = 1; clash[1] = 1;
  assert.equal(countSolutions(clash), 0);                      // pistas contraditórias
  const dead = new Array(TOTAL).fill(0);                       // célula 0 sem candidatos: 1..8 na linha e 9 na coluna
  for (let d = 1; d <= 8; d++) dead[d] = d;
  dead[9] = 9;
  assert.equal(countSolutions(dead), 0);
  assert.equal(solve(dead), null);
});

test("orçamento de nós estourado conta como unicidade não provada", () => {
  assert.equal(countSolutions(new Array(TOTAL).fill(0), 2, 5), 2);
});

test("generateSolution gera grades válidas e a seed é determinística", () => {
  const a = generateSolution(makeRng(7)), b = generateSolution(makeRng(7)), c = generateSolution(makeRng(8));
  assert.equal(isSolved(a), true);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

for (const [i, level] of LEVELS.entries()) {
  test(`gera fase de solução única no nível ${level.name}`, () => {
    const p = generatePuzzle(makeRng(3000 + i), level);
    assert.equal(countSolutions(p.cells), 1);                              // solução única
    assert.deepEqual(solve(p.cells), p.solution);                          // e é a guardada na fase
    assert.equal(isSolved(p.solution), true);
    assert.ok(p.cells.every((v, k) => v === 0 || v === p.solution[k]));   // pistas batem com a solução
    assert.equal(p.cells.filter(Boolean).length, p.givens);
    assert.ok(p.givens <= level.givens + 2, `${level.name}: ${p.givens} pistas, alvo ${level.givens}`);
    assert.ok(p.givens >= 17, "nenhum Sudoku de solução única tem menos de 17 pistas");
    assert.deepEqual(generatePuzzle(makeRng(3000 + i), level), p);        // mesma seed, mesma fase (recarregar devolve a fase)
  });
}

test("os níveis ficam mais difíceis (menos pistas)", () => {
  const givens = LEVELS.map((l, i) => generatePuzzle(makeRng(4000 + i), l).givens);
  for (let i = 1; i < givens.length; i++) assert.ok(givens[i] < givens[i - 1], givens.join(" > "));
});
