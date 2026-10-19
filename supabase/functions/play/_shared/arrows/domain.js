/* Regras, solver e gerador do jogo de setas ("Fuga das Setas"): código puro, sem DOM (testável no Node).

   Mecânica: cada SETA é uma peça (polilinha) de uma ou mais casas ligadas, com curvas. A ponta aponta numa
   direção (0 = cima, 1 = direita, 2 = baixo, 3 = esquerda). Ao tocar, o corpo escoa pelo próprio caminho até a
   ponta e a seta sai do tabuleiro na direção apontada — mas só se o caminho da PONTA (o corredor reto da
   cabeça até fora do tabuleiro) estiver livre. Outra peça encostada no corpo não trava (o corpo escoa por
   dentro da própria peça). Travada, a seta balança e "bate" na outra (perde-se uma vida). Objetivo: tirar todas.

   OBSTÁCULOS: algumas casas são FIXAS (paredes/blocos). Nenhuma seta ocupa essas casas e elas também travam a
   seta que aponta para elas (entram no corredor da ponta como qualquer outra peça).

   Como sortear peças e direções ao acaso quase nunca dá um tabuleiro solucionável, o gerador CONSTRÓI a fase:
   monta as peças da última removida para a primeira (de dentro para fora) e só aceita uma peça cujo caminho de
   saída esteja livre das peças já colocadas — que são as removidas depois dela. Assim a ordem inversa da
   montagem é sempre uma solução. Depois uma busca local vira a ponta de algumas peças para deixar poucas setas
   livres no começo (o tabuleiro fica desafiador), sem nunca perder a solução. O tamanho da peça é escolhido para
   caber o DOBRO de setas de antes em um tabuleiro maior. */

/* ===================== DOMÍNIO ===================== */
/* n: lado da grade. maxLen: tamanho máximo de uma seta (casas). maxBends: dobras máximas de uma seta.
   targetFree: quantas setas podem sair no começo (menos = mais difícil; a busca local para de reduzir aqui).
   walls: quantas casas fixas (obstáculos) o tabuleiro tem. target: quantidade desejada de setas.
   Mais peças, mais dobras, mais obstáculos e menos setas livres conforme o nível. */
export const LEVELS = [
  { name: "Fácil", n: 8, maxLen: 2, maxBends: 0, targetFree: 6, walls: 4, target: 40 },
  { name: "Médio", n: 10, maxLen: 3, maxBends: 1, targetFree: 7, walls: 6, target: 56 },
  { name: "Difícil", n: 12, maxLen: 4, maxBends: 2, targetFree: 10, walls: 8, target: 64 },
  { name: "Genius", n: 14, maxLen: 5, maxBends: 3, targetFree: 13, walls: 12, target: 80 },
];
/** Vidas por cenário: cada toque numa seta travada custa uma. Ao zerar, o tabuleiro volta ao início. */
export const LIVES = 3;
export const STORE_KEY = "arrows.wins";
/** Versão do gerador: gravada na fase salva. Mudar o sorteio muda as fases de uma mesma seed, então aumente ao mexer nele. */
export const GEN = 3;

/* Setas no sentido horário: 0 = Norte (cima), 1 = Leste, 2 = Sul, 3 = Oeste. DIRS dá o passo [linha, coluna]. */
export const DIRS = [[-1, 0], [0, 1], [1, 0], [0, -1]];

/* Fase: { n, pieces, walls } — cada peça é { cells: [casas...], dir }, com a PONTA em cells[0] apontando dir.
   `walls` é um Set de casas fixas. A direção do primeiro trecho (cells[1]→cells[0]) é a própria dir, então a
   seta desenha reta na ponta. */

const dirBetween = (n, from, to) => {
  const fr = (from / n) | 0, fc = from % n, tr = (to / n) | 0, tc = to % n;
  for (let d = 0; d < 4; d++) if (fr + DIRS[d][0] === tr && fc + DIRS[d][1] === tc) return d;
  return -1;
};
const distToBorder = (n, cell) => { const r = (cell / n) | 0, c = cell % n; return Math.min(r, n - 1 - r, c, n - 1 - c); };

/** Ocupação (casa -> índice da peça) para as peças presentes, para consultar a travagem em O(1).
    Os obstáculos entram com índice -1: nunca são a própria peça, então travam como qualquer outra peça. */
export function buildOcc(pieces, present, walls) {
  const occ = new Map();
  for (const i of present) for (const cell of pieces[i].cells) occ.set(cell, i);
  if (walls) for (const cell of walls) occ.set(cell, -1);
  return occ;
}
/** O caminho da casa `cell` na direção `d` está livre de OUTRA peça? (as casas da própria peça movem junto) */
function rayClear(n, cell, d, used) {
  const [dr, dc] = DIRS[d];
  let r = (cell / n) | 0, c = cell % n;
  for (r += dr, c += dc; r >= 0 && c >= 0 && r < n && c < n; r += dr, c += dc) if (used.has(r * n + c)) return false;
  return true;
}
/** A peça `i` está travada agora? Só conta o corredor da PONTA: o corpo escoa pelo próprio caminho até a
    ponta (como a água no cano), então outras peças encostadas no corpo não impedem a saída — só barra quem
    está no caminho reto da seta, da cabeça até fora do tabuleiro. Casas da própria peça não contam. */
export function blocked(n, pieces, occ, i) {
  const p = pieces[i], [dr, dc] = DIRS[p.dir], head = p.cells[0];
  let r = (head / n) | 0, c = head % n;
  for (r += dr, c += dc; r >= 0 && c >= 0 && r < n && c < n; r += dr, c += dc) {
    const o = occ.get(r * n + c);
    if (o !== undefined && o !== i) return true;   // outra peça ou obstáculo no caminho da ponta: travada
  }
  return false;
}
export const removable = (n, pieces, occ, i) => !blocked(n, pieces, occ, i);

/* ===================== SOLVER ===================== */
/** Ordem de remoção que limpa o tabuleiro, ou null se não há solução. Remover uma peça só abre caminho
    para as outras, então tirar sempre que possível nunca atrapalha e decide a solubilidade. */
export function solveOrder(n, pieces, walls) {
  const present = new Set(pieces.map((_, i) => i));
  const occ = buildOcc(pieces, present, walls), order = [];
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
const countFree = (n, pieces, walls) => {
  const present = pieces.map((_, i) => i), occ = buildOcc(pieces, present, walls);
  let free = 0;
  for (const i of present) if (removable(n, pieces, occ, i)) free++;
  return free;
};

/** Valida uma jogada enviada pelo cliente: a ordem de peças precisa esvaziar o tabuleiro, cada uma presente e livre. */
export function isSolved(n, pieces, order, walls) {
  if (!Array.isArray(order) || order.length !== pieces.length) return false;
  const present = new Set(pieces.map((_, i) => i));
  const occ = buildOcc(pieces, present, walls);
  for (const i of order) {
    if (!Number.isInteger(i) || !present.has(i) || blocked(n, pieces, occ, i)) return false;
    present.delete(i);
    for (const c of pieces[i].cells) occ.delete(c);
  }
  return present.size === 0;
}

/* ===================== GERADOR ===================== */
/** Sorteia as casas fixas (obstáculos) do nível, espalhadas pelo tabuleiro. */
function placeWalls(n, rng, count) {
  const cells = Array.from({ length: n * n }, (_, i) => i);
  for (let i = cells.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [cells[i], cells[j]] = [cells[j], cells[i]]; }
  return new Set(cells.slice(0, Math.min(count, n * n)));
}

/** Cresce uma polilinha aleatória a partir de `start` (casas livres de `used`), com o primeiro trecho no lado
    oposto à ponta. Só a saída da PONTA importa para a travagem, então o corpo só precisa não ocupar casas já
    usadas (o miolo pode ficar encostado). */
function growTail(n, used, rng, start, first, maxLen, maxBends) {
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

/** Uma peça válida da construção: ponta `h` apontando `d` (saída livre das peças já colocadas), corpo atrás,
    com no máximo `maxThis` casas (o gerador encolhe as peças para caber o dobro de setas). */
function makePiece(n, used, rng, level, maxThis) {
  const cap = Math.max(1, Math.min(maxThis, level.maxLen));
  let best = null, bestScore = Infinity;
  for (let cell = 0; cell < n * n; cell++) {
    if (used.has(cell)) continue;
    for (let d = 0; d < 4; d++) {
      if (!rayClear(n, cell, d, used)) continue;
      const [dr, dc] = DIRS[d], br = ((cell / n) | 0) - dr, bc = (cell % n) - dc;
      const inBoard = br >= 0 && bc >= 0 && br < n && bc < n;
      const first = inBoard ? br * n + bc : -1;
      const growable = cap > 1 && first >= 0 && !used.has(first);
      const score = (cap > 1 && !growable ? 40 : 0) - distToBorder(n, cell) + rng() * 0.9;
      if (score < bestScore) { bestScore = score; best = { h: cell, d, first, growable }; }
    }
  }
  if (!best) return null;
  const cells = [best.h];
  if (best.growable) cells.push(...growTail(n, used, rng, best.h, best.first, cap, level.maxBends).slice(1));
  return { cells, dir: best.d };
}

/** Vira a ponta de algumas peças (mantendo as casas) para reduzir o número de setas livres, sem perder a
    solução. Assim o começo fica desafiador: poucas setas podem sair a cada toque. */
function reduceFree(n, pieces, rng, target, walls) {
  let best = pieces.map(p => ({ cells: p.cells.slice(), dir: p.dir }));
  let bestFree = countFree(n, best, walls), iters = n * n * 12;
  for (let k = 0; k < iters && bestFree > target; k++) {
    const cand = best.map(p => ({ cells: p.cells, dir: p.dir }));
    const q = cand[(rng() * cand.length) | 0];
    if (q.cells.length === 1) q.dir = (q.dir + 1 + ((rng() * 3) | 0)) % 4;
    else { q.cells = q.cells.slice().reverse(); q.dir = dirBetween(n, q.cells[1], q.cells[0]); }
    if (!solveOrder(n, cand, walls)) continue;
    const f = countFree(n, cand, walls);
    if (f <= bestFree) { best = cand; bestFree = f; }
  }
  return best;
}

/** Fase a partir de uma seed (via rng) e de um nível: solucionável, com obstáculos e com o dobro de setas. */
export function generatePuzzle(rng, level) {
  const n = level.n, total = n * n, target = level.target;
  for (let attempt = 0; attempt < 80; attempt++) {
    const walls = placeWalls(n, rng, level.walls);
    const used = new Set(walls), pieces = [];
    for (let guard = 0; guard < total * 4 && pieces.length < target && used.size < total; guard++) {
      const free = total - used.size, left = Math.max(1, target - pieces.length);
      const want = Math.max(1, Math.min(level.maxLen, Math.round(free / left) + (rng() < 0.25 ? 1 : 0)));
      const p = makePiece(n, used, rng, level, want);
      if (!p) break;
      for (const c of p.cells) used.add(c);
      pieces.push(p);
    }
    if (pieces.length < Math.round(target * 0.9)) continue;   // não coube o bastante: tenta outra disposição
    const reduced = reduceFree(n, pieces, rng, level.targetFree, walls);
    const solution = solveOrder(n, reduced, walls);
    if (!solution || solution.length !== reduced.length) continue;
    return { n, pieces: reduced, walls, solution };
  }
  throw new Error("Não foi possível gerar a fase.");
}
