/* Regras, solver e gerador do jogo de setas ("Fuga das Setas"): código puro, sem DOM (testável no Node).

   Mecânica: cada SETA é uma peça (polilinha) de uma ou mais casas ligadas, com curvas. A ponta aponta numa
   direção (0 = cima, 1 = direita, 2 = baixo, 3 = esquerda). Ao tocar, a peça inteira DESLIZA na direção da
   ponta e sai do tabuleiro — mas só se NENHUMA outra peça estiver no caminho de saída de nenhuma das suas
   casas. Travada, a seta avança um pouco e "bate" na outra (perde-se uma vida). Objetivo: tirar todas.

   Como sortear peças e direções ao acaso quase nunca dá um tabuleiro solucionável, o gerador CONSTRÓI a fase:
   monta as peças da última removida para a primeira (de dentro para fora) e só aceita uma peça cujo caminho de
   saída esteja livre das peças já colocadas — que são as removidas depois dela. Assim a ordem inversa da
   montagem é sempre uma solução. Depois uma busca local vira a ponta de algumas peças para deixar poucas setas
   livres no começo (o tabuleiro fica desafiador), sem nunca perder a solução. */

/* ===================== DOMÍNIO ===================== */
/* n: lado da grade. maxLen: tamanho máximo de uma seta (casas). maxBends: dobras máximas de uma seta.
   targetFree: quantas setas podem sair no começo (menos = mais difícil; a busca local para de reduzir aqui).
   Mais peças, mais dobras e menos setas livres conforme o nível. */
export const LEVELS = [
  { name: "Fácil", n: 6, maxLen: 2, maxBends: 0, targetFree: 6 },
  { name: "Médio", n: 8, maxLen: 3, maxBends: 1, targetFree: 5 },
  { name: "Difícil", n: 10, maxLen: 4, maxBends: 2, targetFree: 4 },
  { name: "Genius", n: 12, maxLen: 5, maxBends: 3, targetFree: 3 },
];
/** Vidas por cenário: cada toque numa seta travada custa uma. Ao zerar, o tabuleiro volta ao início. */
export const LIVES = 3;
export const STORE_KEY = "arrows.wins";
/** Versão do gerador: gravada na fase salva. Mudar o sorteio muda as fases de uma mesma seed, então aumente ao mexer nele. */
export const GEN = 2;

/* Setas no sentido horário: 0 = Norte (cima), 1 = Leste, 2 = Sul, 3 = Oeste. DIRS dá o passo [linha, coluna]. */
export const DIRS = [[-1, 0], [0, 1], [1, 0], [0, -1]];

/* Fase: { n, pieces } — cada peça é { cells: [casas...], dir }, com a PONTA em cells[0] apontando dir.
   A direção do primeiro trecho (cells[1]→cells[0]) é a própria dir, então a seta desenha reta na ponta. */

const dirBetween = (n, from, to) => {
  const fr = (from / n) | 0, fc = from % n, tr = (to / n) | 0, tc = to % n;
  for (let d = 0; d < 4; d++) if (fr + DIRS[d][0] === tr && fc + DIRS[d][1] === tc) return d;
  return -1;
};
const distToBorder = (n, cell) => { const r = (cell / n) | 0, c = cell % n; return Math.min(r, n - 1 - r, c, n - 1 - c); };

/** Ocupação (casa -> índice da peça) para as peças presentes, para consultar a travagem em O(1). */
export function buildOcc(pieces, present) {
  const occ = new Map();
  for (const i of present) for (const cell of pieces[i].cells) occ.set(cell, i);
  return occ;
}
/** O caminho da casa `cell` na direção `d` está livre de OUTRA peça? (as casas da própria peça movem junto) */
function rayClear(n, cell, d, used) {
  const [dr, dc] = DIRS[d];
  let r = (cell / n) | 0, c = cell % n;
  for (r += dr, c += dc; r >= 0 && c >= 0 && r < n && c < n; r += dr, c += dc) if (used.has(r * n + c)) return false;
  return true;
}
/** A peça `i` está travada agora? (alguma casa tem OUTRA peça presente no caminho de saída) */
export function blocked(n, pieces, occ, i) {
  const p = pieces[i], [dr, dc] = DIRS[p.dir];
  for (const cell of p.cells) {
    let r = (cell / n) | 0, c = cell % n;
    for (r += dr, c += dc; r >= 0 && c >= 0 && r < n && c < n; r += dr, c += dc) {
      const o = occ.get(r * n + c);
      if (o === undefined) continue;   // casa vazia: segue
      if (o !== i) return true;        // outra peça: travada (colisão)
      break;                           // casa da própria peça: a ponta desta casa cobre o resto do caminho
    }
  }
  return false;
}
export const removable = (n, pieces, occ, i) => !blocked(n, pieces, occ, i);

/* ===================== SOLVER ===================== */
/** Ordem de remoção que limpa o tabuleiro, ou null se não há solução. Remover uma peça só abre caminho
    para as outras, então tirar sempre que possível nunca atrapalha e decide a solubilidade. */
export function solveOrder(n, pieces) {
  const present = new Set(pieces.map((_, i) => i));
  const occ = buildOcc(pieces, present), order = [];
  while (present.size) {
    let moved = false;
    for (const i of [...present]) if (removable(n, pieces, occ, i)) {
      present.delete(i);
      for (const c of pieces[i].cells) occ.delete(c);
      order.push(i);
      moved = true;
    }
    if (!moved) return null;
  }
  return order;
}
const countFree = (n, pieces) => {
  const present = pieces.map((_, i) => i), occ = buildOcc(pieces, present);
  let free = 0;
  for (const i of present) if (removable(n, pieces, occ, i)) free++;
  return free;
};

/** Valida uma jogada enviada pelo cliente: a ordem de peças precisa esvaziar o tabuleiro, cada uma presente e livre. */
export function isSolved(n, pieces, order) {
  if (!Array.isArray(order) || order.length !== pieces.length) return false;
  const present = new Set(pieces.map((_, i) => i));
  const occ = buildOcc(pieces, present);
  for (const i of order) {
    if (!Number.isInteger(i) || !present.has(i) || blocked(n, pieces, occ, i)) return false;
    present.delete(i);
    for (const c of pieces[i].cells) occ.delete(c);
  }
  return present.size === 0;
}

/* ===================== GERADOR ===================== */
/** Cresce uma polilinha aleatória a partir de `start` (casas livres de `used`), com o primeiro trecho no lado
    oposto à ponta, para a dobra da ponta continuar a direção da seta. Toda casa precisa ter saída livre. */
function growTail(n, used, rng, start, first, headDir, maxLen, maxBends) {
  const cells = [start], has = new Set([start]);
  let lastDir = -1, bends = 0;
  if (first >= 0) { cells.push(first); has.add(first); lastDir = dirBetween(n, start, first); }
  while (cells.length < maxLen) {
    const cur = cells[cells.length - 1], r = (cur / n) | 0, c = cur % n, opts = [];
    for (let d = 0; d < 4; d++) {
      const nr = r + DIRS[d][0], nc = c + DIRS[d][1];
      if (nr < 0 || nc < 0 || nr >= n || nc >= n) continue;
      const nb = nr * n + nc;
      if (used.has(nb) || has.has(nb)) continue;
      if (!rayClear(n, nb, headDir, used)) continue;   // o corpo também precisa de saída livre na direção da ponta
      opts.push([d, nb]);
    }
    if (!opts.length) break;
    const straight = opts.filter(o => o[0] === lastDir), turns = opts.filter(o => o[0] !== lastDir);
    let pick;
    if (straight.length && (bends >= maxBends || !turns.length || rng() < 0.5)) pick = straight[(rng() * straight.length) | 0];
    else if (turns.length) pick = turns[(rng() * turns.length) | 0];
    else pick = straight[(rng() * straight.length) | 0];
    if (lastDir >= 0 && pick[0] !== lastDir) bends++;
    lastDir = pick[0];
    cells.push(pick[1]);
    has.add(pick[1]);
  }
  return cells;
}

/** Uma peça válida da construção: ponta `h` apontando `d` (saída livre das peças já colocadas), corpo atrás.
    Preferir crescer (não deixar seta de 1 casa) e ficar no miolo (tabuleiro mais cheio). */
function makePiece(n, used, rng, level) {
  let best = null, bestScore = Infinity;
  for (let cell = 0; cell < n * n; cell++) {
    if (used.has(cell)) continue;
    for (let d = 0; d < 4; d++) {
      if (!rayClear(n, cell, d, used)) continue;
      const [dr, dc] = DIRS[d], br = ((cell / n) | 0) - dr, bc = (cell % n) - dc;
      const inBoard = br >= 0 && bc >= 0 && br < n && bc < n;
      const first = inBoard ? br * n + bc : -1;
      const growable = first >= 0 && !used.has(first) && rayClear(n, first, d, used);
      const score = (growable ? 0 : 40) - distToBorder(n, cell) + rng() * 0.9;
      if (score < bestScore) { bestScore = score; best = { h: cell, d, first, growable }; }
    }
  }
  if (!best) return null;
  const cells = [best.h];
  if (best.growable) cells.push(...growTail(n, used, rng, best.h, best.first, best.d, level.maxLen, level.maxBends).slice(1));
  return { cells, dir: best.d };
}

/** Vira a ponta de algumas peças (mantendo as casas) para reduzir o número de setas livres, sem perder a
    solução. Assim o começo fica desafiador: poucas setas podem sair a cada toque. */
function reduceFree(n, pieces, rng, target) {
  let best = pieces.map(p => ({ cells: p.cells.slice(), dir: p.dir }));
  let bestFree = countFree(n, best), iters = n * n * 12;
  for (let k = 0; k < iters && bestFree > target; k++) {
    const cand = best.map(p => ({ cells: p.cells, dir: p.dir }));
    const q = cand[(rng() * cand.length) | 0];
    if (q.cells.length === 1) q.dir = (q.dir + 1 + ((rng() * 3) | 0)) % 4;
    else { q.cells = q.cells.slice().reverse(); q.dir = dirBetween(n, q.cells[1], q.cells[0]); }
    if (!solveOrder(n, cand)) continue;
    const f = countFree(n, cand);
    if (f <= bestFree) { best = cand; bestFree = f; }
  }
  return best;
}

/** Fase a partir de uma seed (via rng) e de um nível: solucionável e com poucas setas livres no começo. */
export function generatePuzzle(rng, level) {
  const n = level.n;
  for (let attempt = 0; attempt < 40; attempt++) {
    const used = new Set(), pieces = [];
    for (let guard = 0; guard < n * n * 3 && used.size < n * n; guard++) {
      const p = makePiece(n, used, rng, level);
      if (!p) break;
      for (const c of p.cells) used.add(c);
      pieces.push(p);
    }
    if (pieces.length < 5) continue;              // esparso demais: tenta de novo
    const reduced = reduceFree(n, pieces, rng, level.targetFree);
    const solution = solveOrder(n, reduced);
    if (!solution || solution.length !== reduced.length) continue;
    return { n, pieces: reduced, solution };
  }
  throw new Error("Não foi possível gerar a fase.");
}
