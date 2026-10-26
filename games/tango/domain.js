/* Regras, solver e gerador do Tango: código puro, sem DOM (testável no Node e reutilizado pela Edge).

   Regras: grade N×N (N par) preenchida com dois símbolos — SOL (0) e LUA (1).
     · cada linha e cada coluna tem exatamente N/2 de cada símbolo;
     · nunca três símbolos iguais seguidos na mesma linha ou coluna;
     · entre algumas casas vizinhas há um sinal: `=` (iguais) ou `≠` (diferentes);
     · algumas casas vêm preenchidas (dados).
   A fase é gerada com solução ÚNICA.

   Geração:
     1. sorteia uma grade válida (contagens + sem triplas) por backtracking;
     2. sorteia alguns dados e algumas relações entre vizinhas (sempre coerentes com a solução);
     3. conta as soluções e vai acrescentando a relação/dado que mata mais alternativas, até sobrar uma;
     4. tira o que for redundante (mantendo a unicidade), para a fase não vir cheia de pistas.

   `isSolved` é a única regra de vitória — a mesma na tela e no servidor. Como tudo o que ela precisa
   (dados, sinais e o tamanho) está na visão pública, o navegador sabe sozinho que venceu. */

export const LEVELS = [
  { name: "Fácil",   n: 8,  minGivens: 8, minMarks: 6,  minimize: true,  tryLimit: 40, stepLimit: 400, nodeLimit: 60000,  attemptNodes: 250000 },
  { name: "Médio",   n: 10, minGivens: 7, minMarks: 7,  minimize: true,  tryLimit: 40, stepLimit: 500, nodeLimit: 80000,  attemptNodes: 300000 },
  { name: "Difícil", n: 12, minGivens: 6, minMarks: 8,  minimize: true,  tryLimit: 40, stepLimit: 600, nodeLimit: 120000, attemptNodes: 400000 },
  { name: "Genius",  n: 14, minGivens: 8, minMarks: 18, minimize: false, tryLimit: 40, stepLimit: 700, nodeLimit: 150000, attemptNodes: 400000 },
];

/** Versão do gerador: gravada na fase salva. AUMENTE ao mudar o sorteio. */
export const GEN = 1;
export const STORE_KEY = "tango.wins";
export const SUN = 0, MOON = 1;

/** Nós de busca acumulados — usado para abandonar uma tentativa cara e sortear outra. */
let searchNodes = 0;

const shuffle = (rng, arr) => {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
};
const range = n => Array.from({ length: n }, (_, i) => i);
const sameGrid = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/* ============================== regras ============================== */

const triplesOf = (grid, n) => {
  const bad = new Set();
  for (let r = 0; r < n; r++) for (let c = 0; c + 2 < n; c++) {
    const a = r * n + c;
    if (grid[a] >= 0 && grid[a] === grid[a + 1] && grid[a] === grid[a + 2]) { bad.add(a); bad.add(a + 1); bad.add(a + 2); }
  }
  for (let c = 0; c < n; c++) for (let r = 0; r + 2 < n; r++) {
    const a = r * n + c;
    if (grid[a] >= 0 && grid[a] === grid[a + n] && grid[a] === grid[a + 2 * n]) { bad.add(a); bad.add(a + n); bad.add(a + 2 * n); }
  }
  return bad;
};

/** Casas em conflito: triplas, linha/coluna com símbolo sobrando e sinais desrespeitados. */
export function conflicts(puzzle, grid) {
  const n = puzzle.n, half = n / 2, bad = triplesOf(grid, n);
  for (let r = 0; r < n; r++) {
    let c0 = 0, c1 = 0;
    for (let c = 0; c < n; c++) { const v = grid[r * n + c]; if (v === SUN) c0++; else if (v === MOON) c1++; }
    if (c0 > half || c1 > half) {
      const over = c0 > half ? SUN : MOON;
      for (let c = 0; c < n; c++) if (grid[r * n + c] === over) bad.add(r * n + c);
    }
  }
  for (let c = 0; c < n; c++) {
    let c0 = 0, c1 = 0;
    for (let r = 0; r < n; r++) { const v = grid[r * n + c]; if (v === SUN) c0++; else if (v === MOON) c1++; }
    if (c0 > half || c1 > half) {
      const over = c0 > half ? SUN : MOON;
      for (let r = 0; r < n; r++) if (grid[r * n + c] === over) bad.add(r * n + c);
    }
  }
  for (const m of puzzle.marks) {
    if (grid[m.a] < 0 || grid[m.b] < 0) continue;
    if ((grid[m.a] === grid[m.b]) !== m.same) { bad.add(m.a); bad.add(m.b); }
  }
  return bad;
}

/** Vitória: N/2 de cada por linha e coluna, sem triplas, dados e sinais respeitados. */
export function isSolved(puzzle, grid) {
  const n = puzzle.n, half = n / 2, N = n * n;
  if (!Array.isArray(grid) || grid.length !== N) return false;
  for (const v of grid) if (v !== SUN && v !== MOON) return false;
  for (const g of puzzle.givens) if (grid[g.i] !== g.v) return false;
  for (const m of puzzle.marks) if ((grid[m.a] === grid[m.b]) !== m.same) return false;
  for (let r = 0; r < n; r++) {
    let c0 = 0;
    for (let c = 0; c < n; c++) if (grid[r * n + c] === SUN) c0++;
    if (c0 !== half) return false;
  }
  for (let c = 0; c < n; c++) {
    let c0 = 0;
    for (let r = 0; r < n; r++) if (grid[r * n + c] === SUN) c0++;
    if (c0 !== half) return false;
  }
  return triplesOf(grid, n).size === 0;
}

/* ============================== solver ============================== */

/** Conta soluções (até `limit`). `exhausted` = estourou o orçamento de nós (não dá para afirmar nada).
    Usa propagação de unidades (candidatas por casa até o ponto fixo) e, quando precisa chutar, MRV. */
function countSolutions(puzzle, limit, nodeLimit, rng = null) {
  const n = puzzle.n, half = n / 2, N = n * n;
  const grid = new Array(N).fill(-1);
  const rowCnt = Array.from({ length: n }, () => [0, 0]);
  const colCnt = Array.from({ length: n }, () => [0, 0]);
  const marksAt = Array.from({ length: N }, () => []);
  for (const m of puzzle.marks) { marksAt[m.a].push(m); marksAt[m.b].push(m); }

  const assign = (i, v, trail) => {
    grid[i] = v;
    rowCnt[(i / n) | 0][v]++;
    colCnt[i % n][v]++;
    trail.push(i);
  };
  const undo = trail => {
    for (let k = trail.length - 1; k >= 0; k--) {
      const i = trail[k], v = grid[i];
      rowCnt[(i / n) | 0][v]--;
      colCnt[i % n][v]--;
      grid[i] = -1;
    }
  };
  for (const g of puzzle.givens) assign(g.i, g.v, []);

  /* Candidatas de uma casa: 1 = sol, 2 = lua, 3 = as duas, 0 = contradição. */
  const candidates = i => {
    const r = (i / n) | 0, c = i % n, g = grid;
    let m = 3;
    if (rowCnt[r][SUN] >= half || colCnt[c][SUN] >= half) m &= ~1;
    if (rowCnt[r][MOON] >= half || colCnt[c][MOON] >= half) m &= ~2;
    const l1 = c >= 1 ? g[i - 1] : -1, l2 = c >= 2 ? g[i - 2] : -1;
    const r1 = c + 1 < n ? g[i + 1] : -1, r2 = c + 2 < n ? g[i + 2] : -1;
    const u1 = r >= 1 ? g[i - n] : -1, u2 = r >= 2 ? g[i - 2 * n] : -1;
    const d1 = r + 1 < n ? g[i + n] : -1, d2 = r + 2 < n ? g[i + 2 * n] : -1;
    if ((l1 === SUN && (l2 === SUN || r1 === SUN)) || (r1 === SUN && r2 === SUN)) m &= ~1;
    if ((l1 === MOON && (l2 === MOON || r1 === MOON)) || (r1 === MOON && r2 === MOON)) m &= ~2;
    if ((u1 === SUN && (u2 === SUN || d1 === SUN)) || (d1 === SUN && d2 === SUN)) m &= ~1;
    if ((u1 === MOON && (u2 === MOON || d1 === MOON)) || (d1 === MOON && d2 === MOON)) m &= ~2;
    for (const mk of marksAt[i]) {
      const o = g[mk.a === i ? mk.b : mk.a];
      if (o < 0) continue;
      if (mk.same) { if (o === SUN) m &= ~2; else m &= ~1; }
      else { if (o === SUN) m &= ~1; else m &= ~2; }
    }
    return m;
  };

  /* Ponto fixo: toda casa com uma única candidata é preenchida. */
  const propagate = trail => {
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < N; i++) {
        if (grid[i] >= 0) continue;
        const m = candidates(i);
        if (m === 0) return false;
        if (m === 3) continue;
        assign(i, m === 1 ? SUN : MOON, trail);
        changed = true;
      }
    }
    return true;
  };

  const solutions = [];
  let nodes = 0, exhausted = false;
  const step = () => {
    if (exhausted || solutions.length >= limit) return;
    if (++nodes > nodeLimit) { exhausted = true; return; }

    const trail = [];
    if (propagate(trail)) {
      /* Primeira casa vazia: a propagação já resolveu as forçadas, então não vale varrer tudo por MRV. */
      let cell = -1;
      for (let i = 0; i < N; i++) if (grid[i] < 0) { cell = i; break; }
      if (cell < 0) solutions.push(grid.slice());
      else {
        const m = candidates(cell), flip = rng && rng() < 0.5;
        for (const v of m === 3 ? (flip ? [MOON, SUN] : [SUN, MOON]) : m === 1 ? [SUN] : [MOON]) {
          const t2 = [];
          assign(cell, v, t2);
          step();
          undo(t2);
          if (exhausted || solutions.length >= limit) break;
        }
      }
    }
    undo(trail);
  };

  step();
  searchNodes += nodes;
  return { solutions, exhausted };
}

/** Inspeção/teste: a fase admite exatamente a solução pretendida? */
export function isUnique(puzzle, nodeLimit = 900000) {
  const { solutions, exhausted } = countSolutions(puzzle, 2, nodeLimit);
  return !exhausted && solutions.length === 1;
}

/* ============================== gerador ============================== */

/** Grade completa válida (`N/2` de cada por linha/coluna, sem triplas): o próprio solver, com a
    ramificação sorteada e parando na primeira solução. */
function randomGrid(rng, n) {
  const { solutions } = countSolutions({ n, givens: [], marks: [] }, 1, 400000, rng);
  return solutions[0] ?? null;
}

const pairKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

function allPairs(n) {
  const out = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const i = r * n + c;
    if (c + 1 < n) out.push([i, i + 1]);
    if (r + 1 < n) out.push([i, i + n]);
  }
  return out;
}

/** Acrescenta sinais/dados até a solução ficar única; depois tira o que for redundante. */
function refine(rng, puzzle, level, start) {
  const n = puzzle.n, solution = puzzle.solution;
  const pairs = allPairs(n);
  const used = new Set(puzzle.marks.map(m => pairKey(m.a, m.b)));
  let unique = false;

  for (let step = 0; step < level.stepLimit; step++) {
    const { solutions, exhausted } = countSolutions(puzzle, 16, level.nodeLimit);
    if (exhausted) return false;
    if (searchNodes - start > level.attemptNodes) return false;   // tentativa cara: outra grade
    if (solutions.length === 1) { unique = true; break; }         // única: pronto
    const others = solutions.filter(s => !sameGrid(s, solution));
    if (!others.length) return false;

    /* Sinal que mata mais alternativas amostradas (as que violarem a relação verdadeira). */
    let best = null;
    for (const [a, b] of pairs) {
      if (used.has(pairKey(a, b))) continue;
      const same = solution[a] === solution[b];
      let killed = 0;
      for (const alt of others) if ((alt[a] === alt[b]) !== same) killed++;
      if (killed && (!best || killed > best.killed)) best = { a, b, same, killed };
    }
    if (best) {
      puzzle.marks.push({ a: best.a, b: best.b, same: best.same });
      used.add(pairKey(best.a, best.b));
      continue;
    }

    /* Nenhum sinal separa as soluções: um dado numa casa onde elas divergem. */
    let cell = -1, hit = 0;
    for (let i = 0; i < n * n; i++) {
      const c = others.filter(alt => alt[i] !== solution[i]).length;
      if (c > hit) { hit = c; cell = i; }
    }
    if (cell < 0) return false;
    puzzle.givens.push({ i: cell, v: solution[cell] });
  }

  if (!unique) return false;
  /* Tira o que é redundante (mantendo a unicidade e os mínimos do nível). Em tabuleiros grandes a
     prova de unicidade é cara, então o nível pode pular esta etapa e ficar com as pistas que sobraram. */
  if (!level.minimize) return true;
  const stillUnique = () => {
    const { solutions, exhausted } = countSolutions(puzzle, 2, level.nodeLimit);
    return !exhausted && solutions.length === 1;
  };
  for (const m of shuffle(rng, puzzle.marks.slice())) {
    if (puzzle.marks.length <= level.minMarks) break;
    const at = puzzle.marks.indexOf(m);
    puzzle.marks.splice(at, 1);
    if (!stillUnique()) puzzle.marks.splice(at, 0, m);
  }
  for (const g of shuffle(rng, puzzle.givens.slice())) {
    if (puzzle.givens.length <= level.minGivens) break;
    const at = puzzle.givens.indexOf(g);
    puzzle.givens.splice(at, 1);
    if (!stillUnique()) puzzle.givens.splice(at, 0, g);
  }
  return true;
}

/** Fase nova: `{ n, givens: [{i,v}], marks: [{a,b,same}], solution }`. */
export function generatePuzzle(rng, level) {
  const n = level.n, all = allPairs(n);
  for (let attempt = 0; attempt < level.tryLimit; attempt++) {
    const start = searchNodes;
    const solution = randomGrid(rng, n);
    if (!solution) continue;

    /* Tentativas seguintes começam com mais pistas: garante que a geração termine mesmo num caso ruim. */
    const initial = Math.min(all.length, Math.round(n * (1.2 + Math.min(attempt, 6) * 0.45)));
    const cells = shuffle(rng, range(n * n)).slice(0, Math.min(n, n * n));
    const givens = cells.map(i => ({ i, v: solution[i] }));
    const marks = shuffle(rng, all).slice(0, initial).map(([a, b]) => ({ a, b, same: solution[a] === solution[b] }));

    const puzzle = { n, givens, marks, solution };
    if (!refine(rng, puzzle, level, start)) continue;            // refine só devolve true com unicidade provada
    return puzzle;
  }
  /* Fallback (não deve acontecer): grade completa com todos os dados — resolvida por construção. */
  const solution = randomGrid(rng, n) ?? Array.from({ length: n * n }, (_, i) => (((i / n) | 0) + (i % n)) % 2);
  return { n, givens: solution.map((v, i) => ({ i, v })), marks: [], solution };
}
