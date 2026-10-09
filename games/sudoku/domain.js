/* Regras, solver e gerador do Sudoku: código puro, sem DOM (testável no Node). */

/* ===================== DOMÍNIO ===================== */
export const SIZE = 9, BOX = 3, TOTAL = 81;

/* givens: quantas células já vêm preenchidas (menos pistas = mais difícil). O gerador só tira uma pista
   se a fase continuar com solução única; se não conseguir chegar ao alvo, devolve a mais enxuta que achou. */
export const LEVELS = [
  { name: "Fácil", givens: 40 },
  { name: "Médio", givens: 34 },
  { name: "Difícil", givens: 30 },
  { name: "Genius", givens: 26 },
];
export const STORE_KEY = "sudoku.wins";

export const rowOf = i => (i / SIZE) | 0;
export const colOf = i => i % SIZE;
export const boxOf = i => ((rowOf(i) / BOX) | 0) * BOX + ((colOf(i) / BOX) | 0);

/** As 27 unidades (9 linhas, 9 colunas, 9 blocos), cada uma com os índices das suas 9 células. */
const UNITS = (() => {
  const rows = [], cols = [], boxes = [];
  for (let u = 0; u < SIZE; u++) { rows.push([]); cols.push([]); boxes.push([]); }
  for (let i = 0; i < TOTAL; i++) { rows[rowOf(i)].push(i); cols[colOf(i)].push(i); boxes[boxOf(i)].push(i); }
  return [...rows, ...cols, ...boxes];
})();
/** Células que "enxergam" cada célula (mesma linha, coluna ou bloco): 20 por célula. */
export const PEERS = Array.from({ length: TOTAL }, (_, i) =>
  Array.from({ length: TOTAL }, (_, j) => j).filter(j => j !== i && (rowOf(j) === rowOf(i) || colOf(j) === colOf(i) || boxOf(j) === boxOf(i))));

/* Fase: { cells: number[81] (0 = vazia; os preenchidos são as pistas), solution: number[81], givens: number }
   Estado do jogador: { grid: number[81], notes: number[81] } (notes = máscara de bits; bit d ligado = anotação do dígito d).
   O estado é imutável: cada jogada devolve um novo (facilita o "Desfazer"). */

/** Células que repetem um dígito na sua linha, coluna ou bloco. */
export function conflicts(grid) {
  const bad = new Set();
  for (const unit of UNITS) {
    const seen = new Map();
    for (const i of unit) {
      const v = grid[i];
      if (!v) continue;
      if (seen.has(v)) { bad.add(i); bad.add(seen.get(v)); } else seen.set(v, i);
    }
  }
  return bad;
}
/** Resolvido = tudo preenchido e sem repetições. Como a solução da fase é única, isso é a solução. */
export const isSolved = grid => grid.every(v => v !== 0) && conflicts(grid).size === 0;

/** Dígitos ainda possíveis numa célula (ignora o que já está nela). */
export function candidates(grid, i) {
  const used = new Set(PEERS[i].map(j => grid[j]));
  return [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(d => !used.has(d));
}
/** Quantas vezes cada dígito aparece na grade (índice 1 a 9). */
export function digitCounts(grid) {
  const counts = new Array(SIZE + 1).fill(0);
  for (const v of grid) if (v) counts[v]++;
  return counts;
}

/* ----- Jogadas (puras) ----- */
export const newState = puzzle => ({ grid: [...puzzle.cells], notes: new Array(TOTAL).fill(0) });
export const isGiven = (puzzle, i) => puzzle.cells[i] !== 0;

/** Põe um dígito (1 a 9) na célula; 0 apaga. Repetir o mesmo dígito também apaga. Pistas não mudam.
    Ao preencher, as anotações da célula somem e o dígito sai das anotações da linha, coluna e bloco. */
export function setDigit(puzzle, state, i, d) {
  if (isGiven(puzzle, i)) return state;
  if (d === 0 || state.grid[i] === d) {
    if (state.grid[i] === 0 && state.notes[i] === 0) return state;
    const grid = [...state.grid], notes = [...state.notes];
    grid[i] = 0;
    if (d === 0) notes[i] = 0;
    return { grid, notes };
  }
  const grid = [...state.grid], notes = [...state.notes];
  grid[i] = d; notes[i] = 0;
  for (const p of PEERS[i]) notes[p] &= ~(1 << d);
  return { grid, notes };
}
/** Liga/desliga a anotação de um dígito numa célula vazia. */
export function toggleNote(puzzle, state, i, d) {
  if (isGiven(puzzle, i) || state.grid[i] !== 0) return state;
  const notes = [...state.notes];
  notes[i] ^= 1 << d;
  return { grid: state.grid, notes };
}
export const noteDigits = mask => [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(d => mask & (1 << d));

/* ===================== SOLVER ===================== */
const ALL = 0b1111111110;   // bits 1 a 9
const POP = Uint8Array.from({ length: 1024 }, (_, m) => { let n = 0; for (let x = m; x; x &= x - 1) n++; return n; });
const BOX_OF = Array.from({ length: TOTAL }, (_, i) => boxOf(i));

const shuffle = (arr, rng) => {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
};

/** Backtracking com bitmasks, sempre escolhendo a célula com menos candidatos. Para ao achar `limit` soluções
    ou ao estourar o orçamento de nós. Com `rng`, a ordem dos dígitos é sorteada (usado para gerar grades). */
function search(cells, { limit = 2, budget = Infinity, rng = null } = {}) {
  const g = Array.from(cells), rows = new Array(SIZE).fill(0), cols = new Array(SIZE).fill(0), boxes = new Array(SIZE).fill(0);
  for (let i = 0; i < TOTAL; i++) {
    if (!g[i]) continue;
    const bit = 1 << g[i], r = rowOf(i), c = colOf(i), b = BOX_OF[i];
    if ((rows[r] | cols[c] | boxes[b]) & bit) return { count: 0, exhausted: false, solution: null };   // pistas já se contradizem
    rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
  }
  let count = 0, nodes = 0, exhausted = false, solution = null;
  const go = () => {
    if (count >= limit || exhausted) return;
    if (++nodes > budget) { exhausted = true; return; }
    let best = -1, bestMask = 0, bestN = 10;
    for (let i = 0; i < TOTAL; i++) {
      if (g[i]) continue;
      const mask = ALL & ~(rows[rowOf(i)] | cols[colOf(i)] | boxes[BOX_OF[i]]), n = POP[mask];
      if (n < bestN) { best = i; bestMask = mask; bestN = n; if (n <= 1) break; }
    }
    if (best < 0) { count++; if (!solution) solution = Array.from(g); return; }
    if (bestN === 0) return;
    const digits = [];
    for (let d = 1; d <= SIZE; d++) if (bestMask & (1 << d)) digits.push(d);
    if (rng) shuffle(digits, rng);
    const r = rowOf(best), c = colOf(best), b = BOX_OF[best];
    for (const d of digits) {
      const bit = 1 << d;
      g[best] = d; rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
      go();
      g[best] = 0; rows[r] &= ~bit; cols[c] &= ~bit; boxes[b] &= ~bit;
      if (count >= limit || exhausted) return;
    }
  };
  go();
  return { count, exhausted, solution };
}

/** Conta soluções até `limit`. Se o orçamento de nós estourar, devolve `limit`: unicidade não provada
    conta como "não única" (a fase é descartada), como nos outros jogos. */
export function countSolutions(cells, limit = 2, budget = 200000) {
  const { count, exhausted } = search(cells, { limit, budget });
  return exhausted ? limit : count;
}
/** Uma solução da grade (ou null se não houver). */
export const solve = cells => search(cells, { limit: 1 }).solution;

/* ===================== GERADOR ===================== */
/** Grade completa e válida, sorteada com o rng. */
export const generateSolution = rng => search(new Array(TOTAL).fill(0), { limit: 1, rng }).solution;

/** Parte de uma grade completa e tira pistas em ordem aleatória, mantendo só as retiradas que preservam a
    solução única. Uma passada basta: se tirar uma pista cria uma segunda solução, tirar outras depois não conserta.
    Se não chegar ao alvo do nível, tenta de novo com outra grade (até `attempts`) e fica com a mais enxuta. */
export function generatePuzzle(rng, level, { attempts = 6, budget = 20000 } = {}) {
  let best = null;
  for (let a = 0; a < attempts; a++) {
    const solution = generateSolution(rng), cells = [...solution];
    let givens = TOTAL;
    for (const i of shuffle(Array.from({ length: TOTAL }, (_, k) => k), rng)) {
      if (givens <= level.givens) break;
      const keep = cells[i];
      cells[i] = 0;
      if (countSolutions(cells, 2, budget) === 1) givens--; else cells[i] = keep;
    }
    if (!best || givens < best.givens) best = { cells, solution, givens };
    if (givens <= level.givens) break;
  }
  return best;
}
