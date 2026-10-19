import test from "node:test";
import assert from "node:assert/strict";
import { makeRng } from "../shared/rng.js";
import { DIRS, GEN, LEVELS, LIVES, STORE_KEY, blocked, buildOcc, generatePuzzle, isSolved, removable, solveOrder } from "../games/arrows/domain.js";

/* ---------- níveis e constantes ---------- */
test("níveis: quatro níveis crescentes, sem formatos e com limite de tamanho/dobras", () => {
  assert.deepEqual(LEVELS.map(l => l.name), ["Fácil", "Médio", "Difícil", "Genius"]);
  assert.deepEqual(LEVELS.map(l => l.n), [6, 8, 10, 12]);
  assert.ok(LEVELS.every(l => l.maxLen >= 1 && l.maxBends >= 0 && l.maxBends < l.maxLen));
  assert.ok(LEVELS.every(l => l.shape === undefined), "o formato fixo foi removido: a grade é sempre cheia");
  assert.equal(STORE_KEY, "arrows.wins");
  assert.equal(LIVES, 3);
  assert.ok(Number.isInteger(GEN) && GEN >= 1);
});

test("DIRS aponta em sentido horário N, L, S, O", () => {
  assert.deepEqual(DIRS, [[-1, 0], [0, 1], [1, 0], [0, -1]]);
});

/* ---------- helpers de teste ---------- */
const CELLS = 3;
const cellOf = (r, c) => r * CELLS + c;
const occAll = (pieces) => buildOcc(pieces, pieces.map((_, i) => i));
const dirOf = (n, a, b) => {
  const ar = (a / n) | 0, ac = a % n, br = (b / n) | 0, bc = b % n;
  return DIRS.findIndex(([dr, dc]) => ar + dr === br && ac + dc === bc);
};

/* ---------- regras ---------- */
test("blocked/removable: peça travada quando OUTRA peça está no caminho de saída de qualquer casa", () => {
  /* Duas peças de 1 casa na coluna 0 de um 3x3: a de cima aponta para baixo (S) e bate na de baixo. */
  const pieces = [{ cells: [cellOf(0, 0)], dir: 2 }, { cells: [cellOf(1, 0)], dir: 2 }];
  const occ = occAll(pieces);
  assert.equal(blocked(CELLS, pieces, occ, 0), true, "a de cima bate na de baixo");
  assert.equal(removable(CELLS, pieces, occ, 1), true, "a de baixo tem caminho livre até a borda");
  /* A mesma peça apontando para cima fica livre. */
  const up = [{ cells: [cellOf(2, 2)], dir: 0 }];
  assert.equal(removable(CELLS, up, occAll(up), 0), true);
});

test("blocked: a própria peça não bloqueia (as casas dela movem junto)", () => {
  /* Peça de duas casas na horizontal (ponta em (1,2), corpo em (1,1)) apontando para a direita. */
  const pieces = [{ cells: [cellOf(1, 2), cellOf(1, 1)], dir: 1 }];
  assert.equal(removable(CELLS, pieces, occAll(pieces), 0), true);
  /* Peça em L: ponta em (0,0) apontando para cima; o corpo não deve barrar a própria saída. */
  const bend = [{ cells: [cellOf(0, 0), cellOf(0, 1), cellOf(1, 1)], dir: 0 }];
  assert.equal(removable(CELLS, bend, occAll(bend), 0), true);
});

test("solveOrder: limpa o tabuleiro quando há solução e devolve null quando não há", () => {
  /* 2x2 em anel: cada peça aponta para a vizinha → todas travadas para sempre. */
  const stuck = [{ cells: [0], dir: 2 }, { cells: [1], dir: 3 }, { cells: [2], dir: 0 }, { cells: [3], dir: 1 }];
  assert.equal(solveOrder(2, stuck), null);
  /* 2x2 em cadeia: a de baixo sai, libera a de cima, etc. */
  const ok = [{ cells: [0], dir: 0 }, { cells: [2], dir: 0 }, { cells: [1], dir: 0 }, { cells: [3], dir: 0 }];
  const order = solveOrder(2, ok);
  assert.ok(order && order.length === 4);
  assert.equal(isSolved(2, ok, order), true);
  assert.deepEqual(new Set(order), new Set([0, 1, 2, 3]));
});

test("isSolved: aceita a ordem válida e recusa peça travada, repetida, faltando ou ordem inválida", () => {
  const pieces = [{ cells: [0], dir: 0 }, { cells: [1], dir: 0 }, { cells: [2], dir: 0 }, { cells: [3], dir: 0 }];
  assert.equal(isSolved(2, pieces, [0, 1, 2, 3]), true);
  /* [1,...] começa pela peça 1, que aponta para fora e também está livre; para travar, use uma peça que aponte para outra. */
  const locked = [{ cells: [0], dir: 2 }, { cells: [2], dir: 0 }];
  assert.equal(isSolved(2, locked, [0, 1]), false, "a peça 0 está travada pela 1");
  assert.equal(isSolved(2, pieces, [0, 0, 1, 2, 3]), false, "peça repetida");
  assert.equal(isSolved(2, pieces, [0, 1, 2]), false, "faltou uma peça");
  assert.equal(isSolved(2, pieces, "abc"), false, "ordem não é lista");
  assert.equal(isSolved(2, pieces, [99, 0, 1, 2, 3]), false, "índice inexistente");
});

/* ---------- gerador ---------- */
const contiguity = (n, cells) => cells.every((c, i) => i === 0 || dirOf(n, cells[i - 1], c) >= 0);
const bendsOf = (n, cells) => {
  let bends = 0, last = -1;
  for (let i = 1; i < cells.length; i++) {
    const d = dirOf(n, cells[i - 1], cells[i]);
    if (last >= 0 && d !== last) bends++;
    last = d;
  }
  return bends;
};
const freeCount = (n, pieces) => { const occ = occAll(pieces); return pieces.filter((_, i) => removable(n, pieces, occ, i)).length; };

for (const [i, level] of LEVELS.entries()) {
  test(`gera fase válida, cheia e solucionável no nível ${level.name} (${level.n}x${level.n})`, () => {
    for (let seed = 1; seed <= 40; seed++) {
      const p = generatePuzzle(makeRng(seed * 977 + i), level);
      assert.equal(p.n, level.n);
      assert.ok(p.pieces.length >= 5, `seed ${seed}: poucas peças`);
      assert.equal(p.solution.length, p.pieces.length);

      const all = new Set();
      for (const [k, piece] of p.pieces.entries()) {
        assert.ok(piece.cells.length >= 1 && piece.cells.length <= level.maxLen, `seed ${seed}: tamanho da peça ${k}`);
        assert.ok(piece.dir >= 0 && piece.dir <= 3, `seed ${seed}: direção inválida`);
        assert.ok(piece.cells.every(c => Number.isInteger(c) && c >= 0 && c < level.n * level.n), `seed ${seed}: casa fora do tabuleiro`);
        assert.equal(new Set(piece.cells).size, piece.cells.length, `seed ${seed}: casa repetida na peça`);
        assert.ok(contiguity(level.n, piece.cells), `seed ${seed}: peça ${k} não é contígua`);
        assert.ok(bendsOf(level.n, piece.cells) <= level.maxBends, `seed ${seed}: peça ${k} dobra demais`);
        if (piece.cells.length > 1) assert.equal(piece.dir, dirOf(level.n, piece.cells[1], piece.cells[0]), `seed ${seed}: ponta da peça ${k} diverge`);
        for (const c of piece.cells) {
          assert.ok(!all.has(c), `seed ${seed}: casa ${c} em duas peças`);
          all.add(c);
        }
      }

      assert.equal(isSolved(level.n, p.pieces, p.solution), true, `seed ${seed}: a solução não limpa o tabuleiro`);
      const free = freeCount(level.n, p.pieces);
      assert.ok(free >= 1, `seed ${seed}: fase impossível de começar`);
      assert.ok(free < p.pieces.length, `seed ${seed}: a fase já começa resolvida`);
      assert.ok(free <= Math.max(8, Math.ceil(p.pieces.length * 0.4)), `seed ${seed}: fácil demais (${free}/${p.pieces.length} livres)`);
    }
  });
}

test("o gerador é determinístico na seed e varia entre seeds", () => {
  const a = generatePuzzle(makeRng(42), LEVELS[2]);
  const b = generatePuzzle(makeRng(42), LEVELS[2]);
  const c = generatePuzzle(makeRng(43), LEVELS[2]);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.pieces, c.pieces);
});
