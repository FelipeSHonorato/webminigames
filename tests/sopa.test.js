import test from "node:test";
import assert from "node:assert/strict";
import { makeRng } from "../shared/rng.js";
import { POINTS_PER_LEVEL } from "../shared/progress.js";
import { WORDS } from "../games/sopa/words.js";
import {
  DIRS, GEN, LEVELS, canHint, findOccurrences, generatePuzzle, isDiagonal, isSolved, lineCells, matchSelection, maskWord, maxHints, normalize,
  pointsAfterHints, readCells, revealCount, snapLine,
} from "../games/sopa/domain.js";

test("normalize tira acento e cedilha", () => {
  assert.equal(normalize("coração"), "CORACAO");
  assert.equal(normalize("ÁGUA"), "AGUA");
  assert.equal(normalize("pão"), "PAO");
});

test("vocabulário: só A-Z na grade, sem repetidas, acento não muda o tamanho e há palavras de sobra por nível", () => {
  assert.equal(new Set(WORDS.map(w => w.norm)).size, WORDS.length);
  for (const w of WORDS) {
    assert.match(w.norm, /^[A-Z]{3,}$/, w.text);
    assert.equal(w.text.length, w.norm.length, w.text);
  }
  for (const level of LEVELS) {
    const pool = WORDS.filter(w => w.norm.length >= level.minLen && w.norm.length <= Math.min(level.maxLen, level.n));
    assert.ok(pool.length >= level.words[1] * 5, `${level.name}: só ${pool.length} palavras candidatas`);
  }
});

test("níveis: grades 5, 10, 15 e 20; palavras nunca maiores que a grade; Fácil até 5 palavras", () => {
  assert.deepEqual(LEVELS.map(l => l.n), [5, 10, 15, 20]);
  assert.ok(LEVELS.every(l => l.maxLen <= l.n && l.minLen <= l.maxLen));
  assert.ok(LEVELS[0].words[1] <= 5 && LEVELS[0].maxLen === 5);
  assert.equal(DIRS.length, 8);
});

test("dicas: N-1 por nível e o piso de pontos é sempre 1", () => {
  assert.deepEqual(LEVELS.map(maxHints), [4, 9, 14, 19]);
  LEVELS.forEach((l, i) => assert.equal(pointsAfterHints(POINTS_PER_LEVEL[i], maxHints(l)), 1));
  assert.equal(pointsAfterHints(5, 0), 5);
  assert.equal(pointsAfterHints(5, 1), 4);
  assert.equal(pointsAfterHints(5, 99), 1);
});

test("dicas revelam uma letra a mais de cada palavra, nunca a palavra inteira", () => {
  const w = { text: "CAFÉ", norm: "CAFE" };
  assert.deepEqual(maskWord(w, false, 0), [null, null, null, null]);
  assert.deepEqual(maskWord(w, false, 1), ["C", null, null, null]);
  assert.deepEqual(maskWord(w, false, 3), ["C", "A", "F", null]);
  assert.deepEqual(maskWord(w, false, 9), ["C", "A", "F", null]);      // para na penúltima letra
  assert.deepEqual(maskWord(w, true, 0), ["C", "A", "F", "É"]);        // achada: aparece inteira, com acento
  assert.equal(revealCount(w, 2), 2);
  assert.equal(revealCount(w, 50), 3);
});

test("canHint: respeita o limite do nível e some quando não há mais letra a revelar", () => {
  const puzzle = { words: [{ text: "SOL", norm: "SOL" }, { text: "MAR", norm: "MAR" }] };
  const level = LEVELS[0];
  assert.equal(canHint(puzzle, level, new Set(), 0), true);
  assert.equal(canHint(puzzle, level, new Set(), 2), false);           // palavras de 3 letras: 2 dicas esgotam
  assert.equal(canHint(puzzle, level, new Set([0, 1]), 0), false);     // tudo achado
  const long = { words: [{ text: "ELEFANTE", norm: "ELEFANTE" }] };
  assert.equal(canHint(long, level, new Set(), 3), true);
  assert.equal(canHint(long, level, new Set(), 4), false);             // limite do Fácil
});

test("lineCells: horizontal, vertical, diagonal nos dois sentidos; fora de linha reta é null", () => {
  assert.deepEqual(lineCells(5, 0, 4), [0, 1, 2, 3, 4]);
  assert.deepEqual(lineCells(5, 4, 0), [4, 3, 2, 1, 0]);               // de trás para frente
  assert.deepEqual(lineCells(5, 2, 22), [2, 7, 12, 17, 22]);
  assert.deepEqual(lineCells(5, 0, 24), [0, 6, 12, 18, 24]);
  assert.deepEqual(lineCells(5, 4, 20), [4, 8, 12, 16, 20]);           // diagonal ↙
  assert.deepEqual(lineCells(5, 7, 7), [7]);
  assert.equal(lineCells(5, 0, 7), null);                              // (0,0) -> (1,2)
});

test("snapLine imanta o arrasto à direção de 45° mais próxima e respeita a borda", () => {
  const n = 10, at = (r, c) => r * n + c;
  assert.deepEqual(snapLine(n, at(2, 2), 2, 5), [22, 23, 24, 25]);                     // horizontal →
  assert.deepEqual(snapLine(n, at(2, 2), 2, 0), [22, 21, 20]);                         // horizontal ←
  assert.deepEqual(snapLine(n, at(2, 2), 5, 2), [22, 32, 42, 52]);                     // vertical ↓
  assert.deepEqual(snapLine(n, at(2, 2), 0, 2), [22, 12, 2]);                          // vertical ↑
  assert.deepEqual(snapLine(n, at(2, 2), 5, 5), [22, 33, 44, 55]);                     // diagonal ↘
  assert.deepEqual(snapLine(n, at(2, 2), 4, 6), [22, 33, 44, 55]);                     // 27° da horizontal, 18° da diagonal: vira diagonal
  assert.deepEqual(snapLine(n, at(2, 2), 3, 5), [22, 23, 24, 25]);                     // 18° da horizontal: segue horizontal
  assert.deepEqual(snapLine(n, at(2, 2), 2, 6).length, 5);
  assert.deepEqual(snapLine(n, at(2, 2), 2, 2), [22]);                                 // sem arrastar
  assert.deepEqual(snapLine(n, at(8, 8), 20, 20), [88, 99]);                           // ponteiro fora da grade: limita na borda
  assert.deepEqual(snapLine(n, at(0, 0), 0, 3), [0, 1, 2, 3]);
  for (let k = 0; k < 200; k++) {                                                      // sempre devolve linha reta dentro da grade
    const rng = makeRng(k), from = Math.floor(rng() * 100), cells = snapLine(n, from, Math.floor(rng() * 14) - 2, Math.floor(rng() * 14) - 2);
    assert.equal(cells[0], from);
    assert.ok(cells.every(c => c >= 0 && c < 100));
    assert.deepEqual(lineCells(n, cells[0], cells.at(-1)), cells);
  }
});

test("matchSelection: aceita de frente e de trás para frente, ignora já achadas e erradas", () => {
  const puzzle = { n: 3, grid: ["S", "O", "L", "X", "X", "X", "R", "A", "M"], words: [{ norm: "SOL" }, { norm: "MAR" }] };
  assert.deepEqual(matchSelection(puzzle, [0, 1, 2], new Set()), { index: 0 });
  assert.deepEqual(matchSelection(puzzle, [2, 1, 0], new Set()), { index: 0 });        // LOS = SOL ao contrário
  assert.deepEqual(matchSelection(puzzle, [8, 7, 6], new Set()), { index: 1 });        // MAR lido do fim
  assert.deepEqual(matchSelection(puzzle, [0, 1, 2], new Set([0])), { index: -1, already: true });
  assert.deepEqual(matchSelection(puzzle, [3, 4, 5], new Set()), { index: -1 });
  assert.equal(isSolved(puzzle, new Set([0])), false);
  assert.equal(isSolved(puzzle, new Set([0, 1])), true);
});

for (const [i, level] of LEVELS.entries()) {
  test(`gera fase válida no nível ${level.name} (${level.n}x${level.n})`, () => {
    for (let seed = 1; seed <= 25; seed++) {
      const p = generatePuzzle(makeRng(seed * 977 + i), level);
      assert.equal(p.n, level.n);
      assert.equal(p.grid.length, level.n * level.n);
      assert.ok(p.grid.every(ch => /^[A-Z]$/.test(ch)));
      assert.ok(p.words.length >= level.words[0] && p.words.length <= level.words[1], `${p.words.length} palavras`);
      for (const w of p.words) {
        assert.ok(w.norm.length >= level.minLen && w.norm.length <= level.maxLen && w.norm.length <= level.n);
        assert.equal(readCells(p, w.cells), w.norm);                                   // a palavra está onde diz estar
        assert.deepEqual(lineCells(level.n, w.cells[0], w.cells.at(-1)), w.cells);     // em linha reta
        assert.ok(DIRS.some(([dr, dc]) => dr === w.dir[0] && dc === w.dir[1]));
        assert.ok(findOccurrences(p, w.norm).length >= 1);
      }
      const norms = p.words.map(w => w.norm);                                          // sem repetidas nem uma dentro da outra
      for (const a of norms) for (const b of norms) if (a !== b) assert.ok(!a.includes(b), `${a} contém ${b}`);
      assert.equal(new Set(norms).size, norms.length);
    }
  });
}

test("a seed é determinística", () => {
  const a = generatePuzzle(makeRng(42), LEVELS[1]), b = generatePuzzle(makeRng(42), LEVELS[1]), c = generatePuzzle(makeRng(43), LEVELS[1]);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.grid, c.grid);
});

test("as 8 direções aparecem (inclusive de trás para frente) em todos os níveis", () => {
  for (const [i, level] of LEVELS.entries()) {
    const seen = new Set();
    for (let seed = 1; seed <= 150; seed++) for (const w of generatePuzzle(makeRng(seed * 31 + i), level).words) seen.add(w.dir.join(","));
    assert.equal(seen.size, 8, `${level.name}: só ${[...seen].join(" ")}`);
  }
});

/* Toda fase tem diagonal desde o Fácil (antes, 82% das fases do Fácil e 52% das do Médio não tinham nenhuma). */
for (const [i, level] of LEVELS.entries()) {
  test(`nível ${level.name}: toda fase tem pelo menos ${level.minDiag} palavra(s) na diagonal`, () => {
    assert.ok(level.minDiag >= 1);
    for (let seed = 1; seed <= 150; seed++) {
      const p = generatePuzzle(makeRng(seed * 977 + i), level), d = p.words.filter(isDiagonal).length;
      assert.ok(d >= level.minDiag, `seed ${seed}: só ${d} diagonal(is)`);
      assert.ok(p.words.filter(isDiagonal).every(w => lineCells(level.n, w.cells[0], w.cells.at(-1)) && w.dir[0] !== 0 && w.dir[1] !== 0));
    }
  });
}
test("a incidência de diagonais é menor no Fácil e fica em torno de 1/4 a 1/2 das palavras (as retas continuam a maioria)", () => {
  const share = level => {
    let diag = 0, total = 0;
    for (let seed = 1; seed <= 200; seed++) { const p = generatePuzzle(makeRng(seed * 7 + level.n), level); diag += p.words.filter(isDiagonal).length; total += p.words.length; }
    return diag / total;
  };
  const shares = LEVELS.map(share);
  assert.ok(shares[0] < shares[1], `Fácil ${shares[0].toFixed(2)} deveria ser menor que Médio ${shares[1].toFixed(2)}`);
  for (const [i, v] of shares.entries()) assert.ok(v >= 0.2 && v <= 0.5, `${LEVELS[i].name}: ${(v * 100).toFixed(0)}% de diagonais`);
});
test("as diagonais aparecem nos dois sentidos de cada diagonal (↘ ↖ ↙ ↗), inclusive de trás para frente", () => {
  const seen = new Set();
  for (let seed = 1; seed <= 200; seed++) for (const w of generatePuzzle(makeRng(seed), LEVELS[1]).words) if (isDiagonal(w)) seen.add(w.dir.join(","));
  assert.deepEqual([...seen].sort(), ["-1,-1", "-1,1", "1,-1", "1,1"]);
});
test("GEN é um número positivo (versão do gerador gravada nas fases salvas)", () => assert.ok(Number.isInteger(GEN) && GEN >= 2));
