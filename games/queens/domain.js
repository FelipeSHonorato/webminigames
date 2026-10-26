/* Regras e gerador do Queens: código puro, sem DOM (testável no Node e reutilizado pela Edge Function).
   Regras: numa grade N×N dividida em N regiões, coloque N rainhas — uma por linha, uma por coluna e uma por
   região — sem que duas se toquem, nem na diagonal (as 8 vizinhas). A fase é gerada com solução ÚNICA.

   Geração (sempre a partir do `rng` recebido, para a mesma seed dar a mesma fase):
     1. sorteia uma colocação válida (uma coluna por linha, sem rainhas vizinhas);
     2. cresce N regiões conectadas a partir das rainhas (BFS multi-fonte, vizinhos em ordem sorteada);
     3. procura uma SEGUNDA solução; se existir, move uma célula da solução intrusa para outra região
        vizinha (sem quebrar a conectividade) e repete — até sobrar só a solução pretendida.

   O estado do jogador é `{ queens: células }` (índices 0..N²-1). `isSolved` é a única regra de vitória:
   a mesma função vale na tela e no servidor. */

export const LEVELS = [
  { name: "Fácil",   n: 8,  tryLimit: 40, cutLimit: 40, nodeLimit: 200000 },
  { name: "Médio",   n: 10, tryLimit: 40, cutLimit: 45, nodeLimit: 250000 },
  { name: "Difícil", n: 12, tryLimit: 40, cutLimit: 40, nodeLimit: 300000 },
  { name: "Genius",  n: 14, tryLimit: 40, cutLimit: 30, nodeLimit: 350000 },
];

/** Versão do gerador: gravada na fase salva. AUMENTE ao mudar o sorteio (as fases antigas são descartadas). */
export const GEN = 1;
export const STORE_KEY = "queens.wins";

const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const shuffle = (rng, arr) => {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
};
const range = n => Array.from({ length: n }, (_, i) => i);
const sameCols = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/* ============================== regras ============================== */

/** Células que participam de algum conflito (duas rainhas na mesma linha, coluna, região ou se tocando). */
export function conflicts(puzzle, queens) {
  const n = puzzle.n, list = [...new Set(queens)], bad = new Set();
  for (let i = 0; i < list.length; i++) {
    const a = list[i], ra = (a / n) | 0, ca = a % n;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j], dr = Math.abs(ra - ((b / n) | 0)), dc = Math.abs(ca - (b % n));
      if (dr === 0 || dc === 0 || puzzle.regions[a] === puzzle.regions[b] || (dr <= 1 && dc <= 1)) { bad.add(a); bad.add(b); }
    }
  }
  return bad;
}

/** Casas vizinhas (8 direções) a alguma rainha: nenhuma outra rainha pode entrar nelas. */
export function neighborsOf(puzzle, queens) {
  const n = puzzle.n, out = new Set();
  for (const cell of queens) {
    const r = (cell / n) | 0, c = cell % n;
    for (const [dr, dc] of DIRS) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && cc >= 0 && rr < n && cc < n) out.add(rr * n + cc);
    }
  }
  return out;
}

/** Vitória: N rainhas, uma por linha, coluna e região, e nenhuma tocando outra. */
export function isSolved(puzzle, queens) {
  const n = puzzle.n;
  if (!Array.isArray(queens) || queens.length !== n) return false;
  const seen = new Set(), rows = new Uint8Array(n), cols = new Uint8Array(n), regs = new Uint8Array(n);
  for (const cell of queens) {
    if (!Number.isInteger(cell) || cell < 0 || cell >= n * n || seen.has(cell)) return false;
    seen.add(cell);
    const r = (cell / n) | 0, c = cell % n;
    if (rows[r]++ || cols[c]++ || regs[puzzle.regions[cell]]++) return false;
  }
  for (const cell of seen) {
    const r = (cell / n) | 0, c = cell % n;
    for (const [dr, dc] of DIRS) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && cc >= 0 && rr < n && cc < n && seen.has(rr * n + cc)) return false;
    }
  }
  return true;
}

/* ============================== gerador ============================== */

/** Colocação válida: uma coluna por linha, sem rainhas vizinhas (linhas consecutivas com colunas a 1 de distância). */
function randomPlacement(rng, n) {
  const cols = new Array(n).fill(-1), used = new Uint8Array(n);
  const step = r => {
    if (r === n) return true;
    for (const c of shuffle(rng, range(n))) {
      if (used[c] || (r > 0 && Math.abs(c - cols[r - 1]) === 1)) continue;
      cols[r] = c; used[c] = 1;
      if (step(r + 1)) return true;
      used[c] = 0; cols[r] = -1;
    }
    return false;
  };
  return step(0) ? cols : null;
}

/** N regiões conectadas, cada uma com a sua rainha: BFS multi-fonte (a primeira a chegar fica com a casa). */
function growRegions(rng, placement, n) {
  const regions = new Array(n * n).fill(-1), queue = new Array(n * n);
  let head = 0, tail = 0;
  for (const r of shuffle(rng, range(n))) {
    const cell = r * n + placement[r];
    regions[cell] = r; queue[tail++] = cell;
  }
  while (head < tail) {
    const cell = queue[head++], r = (cell / n) | 0, c = cell % n, g = regions[cell];
    for (const [dr, dc] of shuffle(rng, DIRS.slice())) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
      const nb = rr * n + cc;
      if (regions[nb] !== -1) continue;
      regions[nb] = g; queue[tail++] = nb;
    }
  }
  return regions;
}

/** A região `g`, sem as casas de `removed`, continua conectada (e não vazia)? */
function stillConnected(regions, n, g, removed) {
  const seen = new Uint8Array(n * n);
  let start = -1, size = 0;
  for (let i = 0; i < n * n; i++) if (regions[i] === g && !removed.has(i)) { if (start < 0) start = i; size++; }
  if (size === 0) return false;
  const stack = [start];
  seen[start] = 1;
  let count = 0;
  while (stack.length) {
    const cell = stack.pop(); count++;
    const r = (cell / n) | 0, c = cell % n;
    for (const [dr, dc] of DIRS) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
      const nb = rr * n + cc;
      if (seen[nb] || regions[nb] !== g || removed.has(nb)) continue;
      seen[nb] = 1; stack.push(nb);
    }
  }
  return count === size;
}

/** O caminho pode virar `target`? Nenhuma região pode perder a conectividade (nem ficar vazia). */
function pathFits(regions, n, path, target) {
  const removed = new Map();
  for (const cell of path) {
    const g = regions[cell];
    if (!removed.has(g)) removed.set(g, new Set());
    removed.get(g).add(cell);
  }
  for (const [g, cells] of removed) if (!stillConnected(regions, n, g, cells)) return false;
  return true;
}

/** Menor caminho dentro da região `from`, a partir de `x`, até encostar em outra região que possa absorvê-lo.
    Prefere a região `prefer` (a da rainha certa). Devolve `{ target, path }` ou `null`. */
function pullCell(regions, n, x, from, prefer, blocked) {
  const prev = new Int32Array(n * n).fill(-1), queue = [x];
  prev[x] = x;
  let fallback = null;
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head], r = (cell / n) | 0, c = cell % n;
    for (const [dr, dc] of DIRS) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
      const nb = rr * n + cc, g = regions[nb];
      if (g === from) {                                        // continua dentro da região
        if (prev[nb] === -1 && !blocked.has(nb)) { prev[nb] = cell; queue.push(nb); }
        continue;
      }
      const path = [];
      for (let p = cell; ; p = prev[p]) { path.push(p); if (p === x) break; }   // caminho dentro de `from`, com x
      if (!pathFits(regions, n, path, g)) continue;
      if (g === prefer) return { target: g, path };
      if (!fallback) fallback = { target: g, path };
    }
  }
  return fallback;
}

/** Ataque à solução intrusa: leva a rainha intrusa (por um caminho) para outra região, matando a intrusa
    (ela perde a rainha da origem e ganha uma segunda no destino). Devolve quantas jogadas fez. */
function killIntruder(rng, n, regions, intended, intruder, maxMoves) {
  const intendedQueens = new Set(intended.map((c, r) => r * n + c));
  let moved = 0;
  for (const r of shuffle(rng, range(n))) {
    if (moved >= maxMoves) break;
    if (intruder[r] === intended[r]) continue;                 // casa da solução certa: nunca mexer
    const x = r * n + intruder[r], from = regions[x];
    const move = pullCell(regions, n, x, from, regions[r * n + intended[r]], intendedQueens);
    if (!move) continue;
    for (const cell of move.path) regions[cell] = move.target;
    moved++;
  }
  return moved;
}

/** Procura uma solução DIFERENTE de `intended`. Devolve `{ found, exhausted, nodes }` (`exhausted` = estourou o orçamento).
    Usa MRV (a linha com menos casas possíveis primeiro) e poda as regiões que ficaram sem nenhuma casa alcançável. */
function findOther(n, regions, intended, nodeLimit) {
  const cols = new Array(n).fill(-1);
  const usedCol = new Uint8Array(n), usedReg = new Uint8Array(n);
  let nodes = 0, found = null, exhausted = false;

  const ok = (r, c) => {
    if (usedCol[c] || usedReg[regions[r * n + c]]) return false;
    if (r > 0 && cols[r - 1] >= 0 && Math.abs(cols[r - 1] - c) === 1) return false;
    if (r + 1 < n && cols[r + 1] >= 0 && Math.abs(cols[r + 1] - c) === 1) return false;
    return true;
  };

  const step = placed => {
    if (found) return true;
    if (++nodes > nodeLimit) { exhausted = true; return false; }
    if (placed === n) {
      if (!sameCols(cols, intended)) found = cols.slice();
      return Boolean(found);
    }

    let row = -1, best = n + 1;
    const reach = new Uint8Array(n);
    for (let r = 0; r < n; r++) {
      if (cols[r] >= 0) continue;
      let k = 0;
      for (let c = 0; c < n; c++) if (ok(r, c)) { k++; reach[regions[r * n + c]] = 1; }
      if (!k) return false;                                   // linha sem opção: poda
      if (k < best) { best = k; row = r; }
    }
    for (let g = 0; g < n; g++) if (!usedReg[g] && !reach[g]) return false;   // região inalcançável: poda

    for (let c = 0; c < n; c++) {
      if (!ok(row, c)) continue;
      const g = regions[row * n + c];
      cols[row] = c; usedCol[c] = 1; usedReg[g] = 1;
      if (step(placed + 1)) return true;
      cols[row] = -1; usedCol[c] = 0; usedReg[g] = 0;
      if (exhausted) return false;
    }
    return false;
  };

  step(0);
  return { found, exhausted };
}

/** Deixa só a solução pretendida: a cada intrusa encontrada, ajusta a fronteira. `null` = desistiu. */
function makeUnique(rng, n, regions, intended, level) {
  for (let cut = 0; cut < level.cutLimit; cut++) {
    const { found, exhausted } = findOther(n, regions, intended, level.nodeLimit);
    if (exhausted) return null;
    if (!found) return regions;
    if (!killIntruder(rng, n, regions, intended, found, level.moves ?? n)) return null;
  }
  return null;
}

/** Fase nova: `{ n, regions, solution }` (`solution` = coluna da rainha em cada linha). */
export function generatePuzzle(rng, level) {
  const n = level.n;
  for (let attempt = 0; attempt < level.tryLimit; attempt++) {
    const solution = randomPlacement(rng, n);
    if (!solution) continue;
    const regions = makeUnique(rng, n, growRegions(rng, solution, n), solution, level);
    if (regions) return { n, regions, solution };
  }
  /* Sem achar partição única no orçamento: devolve a última colocação com as regiões que existirem. */
  const solution = randomPlacement(rng, n);
  return { n, regions: growRegions(rng, solution, n), solution };
}

/** Células da solução (o que a tela mostra numa fase já concluída). */
export const solutionCells = puzzle => puzzle.solution.map((c, r) => r * puzzle.n + c);

/** Inspeção/teste: a fase admite exatamente a solução pretendida? (`exhausted` desconfia e devolve `false`.) */
export function isUnique(puzzle, nodeLimit = 900000) {
  const { found, exhausted } = findOther(puzzle.n, puzzle.regions, puzzle.solution, nodeLimit);
  return !found && !exhausted;
}
