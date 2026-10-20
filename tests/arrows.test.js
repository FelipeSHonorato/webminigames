import test from "node:test";
import assert from "node:assert/strict";
import { makeRng } from "../shared/rng.js";
import { DIRS, GEN, LEVELS, LIVES, STORE_KEY, beam, blocked, buildOcc, generatePuzzle, isSolved, removable } from "../games/arrows/domain.js";

/* ---------- níveis e constantes ---------- */
test("níveis: quatro níveis crescentes, sem formatos e com limite de tamanho/dobras", () => {
  assert.deepEqual(LEVELS.map(l => l.name), ["Fácil", "Médio", "Difícil", "Genius"]);
  assert.deepEqual(LEVELS.map(l => l.n), [8, 10, 12, 14]);
  assert.deepEqual(LEVELS.map(l => l.target), [40, 56, 64, 80]);
  assert.deepEqual(LEVELS.map(l => l.redirectors), [4, 6, 8, 12]);
  assert.ok(LEVELS.every(l => l.maxLen >= 1 && l.maxBends >= 0 && l.maxBends < l.maxLen));
  assert.ok(LEVELS.every(l => l.shape === undefined), "o formato fixo foi removido: a grade é sempre cheia");
  assert.ok(LEVELS.every(l => l.walls === undefined), "os obstáculos viraram desviadores");
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
const EMPTY = new Map();
const dirOf = (n, a, b) => {
  const ar = (a / n) | 0, ac = a % n, br = (b / n) | 0, bc = b % n;
  return DIRS.findIndex(([dr, dc]) => ar + dr === br && ac + dc === bc);
};

/* ---------- regras ---------- */
test("blocked/removable: travada só quando OUTRA peça está no corredor da ponta", () => {
  /* Duas peças de 1 casa na coluna 0 de um 3x3: a de cima aponta para baixo (S) e bate na de baixo. */
  const pieces = [{ cells: [cellOf(0, 0)], dir: 2 }, { cells: [cellOf(1, 0)], dir: 2 }];
  const occ = occAll(pieces);
  assert.equal(blocked(CELLS, pieces, occ, 0), true, "a de cima bate na de baixo");
  assert.equal(removable(CELLS, pieces, occ, 1), true, "a de baixo tem corredor da ponta livre");
  /* A mesma peça apontando para cima fica livre. */
  const up = [{ cells: [cellOf(2, 2)], dir: 0 }];
  assert.equal(removable(CELLS, up, occAll(up), 0), true);
});

test("blocked: a própria peça não bloqueia o corredor da ponta", () => {
  /* Peça de duas casas na horizontal (ponta em (1,2), corpo em (1,1)) apontando para a direita. */
  const pieces = [{ cells: [cellOf(1, 2), cellOf(1, 1)], dir: 1 }];
  assert.equal(removable(CELLS, pieces, occAll(pieces), 0), true);
  /* Peça em L: ponta em (0,0) apontando para cima; o corpo não deve barrar a própria saída. */
  const bend = [{ cells: [cellOf(0, 0), cellOf(0, 1), cellOf(1, 1)], dir: 0 }];
  assert.equal(removable(CELLS, bend, occAll(bend), 0), true);
});

test("blocked: peça encostada no corpo não trava — só o corredor da ponta importa", () => {
  /* L azul com a ponta em (0,0) apontando para cima (corredor livre, já na borda) e o corpo descendo pela
     coluna 0 e virando para a direita na base. A peça verde fica logo ACIMA da base do corpo (coluna 1),
     fora do corredor da ponta — não pode travar a azul. */
  const blue = { cells: [cellOf(0, 0), cellOf(1, 0), cellOf(2, 0), cellOf(2, 1)], dir: 0 };
  const green = { cells: [cellOf(0, 1)], dir: 3 };
  const pieces = [blue, green];
  assert.equal(blocked(CELLS, pieces, occAll(pieces), 0), false, "a ponta da azul está livre; o corpo não conta");
  assert.equal(removable(CELLS, pieces, occAll(pieces), 0), true);
});

test("desviador: a seta entra nele e continua na direção indicada", () => {
  /* Seta em (0,0) apontando para baixo; o bloco em (1,0) aponta para a direita. */
  const pieces = [{ cells: [cellOf(0, 0)], dir: 2 }];
  const redirectors = new Map([[cellOf(1, 0), 1]]);
  assert.equal(blocked(CELLS, pieces, occAll(pieces), 0, redirectors, 0), false, "sem bloqueio no novo caminho, a seta sai");
  /* Uma peça em (1,1) fica exatamente no caminho desviado: trava. */
  const withBlocker = [{ cells: [cellOf(0, 0)], dir: 2 }, { cells: [cellOf(1, 1)], dir: 0 }];
  assert.equal(blocked(CELLS, withBlocker, occAll(withBlocker), 0, redirectors, 0), true, "a seta desviada bate na peça em (1,1)");
});

test("desviador: correntes de blocos (um manda para o outro)", () => {
  /* (0,0) desce, (1,0) manda para a direita e (1,1) manda para baixo. */
  const pieces = [{ cells: [cellOf(0, 0)], dir: 2 }];
  const redirectors = new Map([[cellOf(1, 0), 1], [cellOf(1, 1), 2]]);
  assert.equal(blocked(CELLS, pieces, occAll(pieces), 0, redirectors, 0), false, "a corrente termina em (2,1), livre");
  const withBlocker = [{ cells: [cellOf(0, 0)], dir: 2 }, { cells: [cellOf(2, 1)], dir: 0 }];
  assert.equal(blocked(CELLS, withBlocker, occAll(withBlocker), 0, redirectors, 0), true, "o fim da corrente tem uma peça");
});

test("desviador: o giro de 90° por remoção muda o caminho", () => {
  /* (1,0) começa apontando para a direita; na 1ª remoção (turn 1) ele já aponta para baixo. */
  const redirectors = new Map([[cellOf(1, 0), 1]]);
  const pieces = [{ cells: [cellOf(0, 0)], dir: 2 }, { cells: [cellOf(2, 0)], dir: 0 }];
  const occ = occAll(pieces);
  assert.equal(blocked(CELLS, pieces, occ, 0, redirectors, 0), false, "turn 0: desvia para a direita e sai");
  assert.equal(blocked(CELLS, pieces, occ, 0, redirectors, 1), true, "turn 1: desvia para baixo e bate na peça em (2,0)");
});

test("desviador: ciclo (a seta nunca sai) conta como travada", () => {
  /* 2x2: (0,0) vai para a direita; (0,1) desce; (1,1) vai para a esquerda; (1,0) vai para a direita. */
  const loop = new Map([[1, 2], [3, 3], [2, 1]]);
  const pieces = [{ cells: [0], dir: 1 }];
  assert.equal(blocked(2, pieces, occAll(pieces), 0, loop, 0), true);
  assert.equal(beam(2, 0, 1, occAll(pieces), 0, loop, 0), null);
});

test("desviador: o corpo da própria seta não trava o caminho desviado", () => {
  /* Peça com a ponta em (0,0) e o corpo em (0,1)/(1,1). Os blocos mandam a seta para a esquerda em (1,1),
     atravessando o próprio corpo, e ela sai pela esquerda. */
  const pieces = [{ cells: [cellOf(0, 0), cellOf(0, 1), cellOf(1, 1)], dir: 1 }];
  const redirectors = new Map([[cellOf(0, 2), 2], [cellOf(1, 2), 3]]);
  assert.equal(blocked(CELLS, pieces, occAll(pieces), 0, redirectors, 0), false);
  const route = beam(CELLS, cellOf(0, 0), 1, occAll(pieces), 0, redirectors, 0);
  assert.ok(route && route.path.includes(cellOf(1, 1)), "o caminho passa pelo próprio corpo");
});

test("isSolved: a ordem vale no estado de cada remoção (os desviadores giram)", () => {
  /* p0 em (0,0) desce; p1 em (1,1) sobe. O bloco em (1,0) começa indo para a direita.
     Tirar p1 primeiro libera o caminho; aí o bloco já girou para baixo e p0 sai. */
  const pieces = [{ cells: [cellOf(0, 0)], dir: 2 }, { cells: [cellOf(1, 1)], dir: 0 }];
  const redirectors = new Map([[cellOf(1, 0), 1]]);
  assert.equal(isSolved(CELLS, pieces, [1, 0], redirectors), true, "a ordem que usa o giro vale");
  assert.equal(isSolved(CELLS, pieces, [0, 1], redirectors), false, "começar por p0 esbarra em p1");
});

test("isSolved: aceita a ordem válida e recusa peça repetida, faltando ou índice inválido", () => {
  const pieces = [{ cells: [0], dir: 0 }, { cells: [1], dir: 0 }, { cells: [2], dir: 0 }, { cells: [3], dir: 0 }];
  assert.equal(isSolved(2, pieces, [0, 1, 2, 3], EMPTY), true);
  assert.equal(isSolved(2, pieces, [0, 0, 1, 2, 3], EMPTY), false, "peça repetida");
  assert.equal(isSolved(2, pieces, [0, 1, 2], EMPTY), false, "faltou uma peça");
  assert.equal(isSolved(2, pieces, [99, 0, 1, 2], EMPTY), false, "índice inexistente");
  assert.equal(isSolved(2, pieces, "abc", EMPTY), false, "ordem não é lista");
  const locked = [{ cells: [0], dir: 2 }, { cells: [2], dir: 0 }];
  assert.equal(isSolved(2, locked, [0, 1], EMPTY), false, "a peça 0 está travada pela 1");
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
const freeCount = (n, pieces, redirectors, turn = 0) => {
  const occ = buildOcc(pieces, pieces.map((_, i) => i));
  return pieces.filter((_, i) => removable(n, pieces, occ, i, redirectors, turn)).length;
};

for (const [i, level] of LEVELS.entries()) {
  test(`gera fase válida, com o dobro de setas, desviadores e solução no nível ${level.name} (${level.n}x${level.n})`, () => {
    for (let seed = 1; seed <= 40; seed++) {
      const p = generatePuzzle(makeRng(seed * 977 + i), level);
      assert.equal(p.n, level.n);
      assert.ok(p.pieces.length >= Math.round(level.target * 0.9), `seed ${seed}: poucas peças (${p.pieces.length})`);
      assert.ok(p.pieces.length <= level.target, `seed ${seed}: passou da meta de peças`);
      assert.equal(p.solution.length, p.pieces.length);

      assert.ok(p.redirectors instanceof Map, `seed ${seed}: desviadores deveriam ser um Map`);
      assert.equal(p.redirectors.size, level.redirectors, `seed ${seed}: quantidade de desviadores`);
      for (const [cell, dir] of p.redirectors) {
        assert.ok(Number.isInteger(cell) && cell >= 0 && cell < level.n * level.n, `seed ${seed}: desviador fora do tabuleiro`);
        assert.ok(dir >= 0 && dir <= 3, `seed ${seed}: direção inválida no desviador`);
      }

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
          assert.ok(!p.redirectors.has(c), `seed ${seed}: seta ocupou o desviador ${c}`);
          all.add(c);
        }
      }

      assert.equal(isSolved(level.n, p.pieces, p.solution, p.redirectors), true, `seed ${seed}: a solução não limpa o tabuleiro`);
      const free = freeCount(level.n, p.pieces, p.redirectors);
      assert.ok(free >= 1, `seed ${seed}: fase impossível de começar`);
      assert.ok(free < p.pieces.length, `seed ${seed}: a fase já começa resolvida`);
      assert.ok(free <= Math.max(8, Math.ceil(p.pieces.length * 0.45)), `seed ${seed}: fácil demais (${free}/${p.pieces.length} livres)`);

      /* A solução passa por pelo menos um desviador (o bloco não é só decoração). */
      const present = new Set(p.pieces.map((_, k) => k)), occ = buildOcc(p.pieces, present);
      let turn = 0, used = false;
      for (const k of p.solution) {
        const route = beam(level.n, p.pieces[k].cells[0], p.pieces[k].dir, occ, k, p.redirectors, turn);
        assert.ok(route, `seed ${seed}: a solução travou na peça ${k}`);
        if (route.path.some(c => c !== p.pieces[k].cells[0] && p.redirectors.has(c))) used = true;
        present.delete(k);
        for (const c of p.pieces[k].cells) occ.delete(c);
        turn++;
      }
      assert.ok(used, `seed ${seed}: nenhum desviador no caminho da solução`);
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
