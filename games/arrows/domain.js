/* Regras, solver e gerador do jogo de setas ("Fuga das Setas"): código puro, sem DOM (testável no Node).

   Mecânica: cada SETA é uma peça (polilinha) de uma ou mais casas ligadas, com curvas. A ponta aponta numa
   direção (0 = cima, 1 = direita, 2 = baixo, 3 = esquerda). Ao tocar, o corpo escoa pelo próprio caminho até a
   ponta e a seta sai do tabuleiro na direção apontada — mas só se o caminho da PONTA estiver livre. Outra peça
   encostada no corpo não trava (o corpo escoa por dentro da própria peça). Travada, a seta balança e "bate";
   perde-se uma vida. Objetivo: tirar todas.

   DESVIADORES: algumas casas são FIXAS (blocos com uma seta dentro). Nenhuma seta ocupa essas casas. Quando o
   caminho da ponta entra num desviador, ele CONTINUA na direção indicada por ele — podendo atravessar vários
   desviadores em corrente. Se o caminho desviado bater em outra seta (ou entrar em ciclo), a seta fica travada.
   A cada seta que sai do tabuleiro, TODOS os desviadores giram 90° no sentido horário (N→L→S→O); o estado é
   `(dir inicial + nº de setas já removidas) % 4`.

   Como sortear peças e direções ao acaso quase nunca dá um tabuleiro solucionável, o gerador CONSTRÓI a fase:
   monta as peças da última removida para a primeira (de dentro para fora) e só aceita uma peça cujo caminho de
   saída esteja livre das peças já colocadas — que são as removidas depois dela. Como os desviadores giram a cada
   remoção, a construção anda para TRÁS no giro: começa no estado final sorteado e gira todos -90° antes de cada
   peça seguinte; o estado ao fim é o inicial. Assim a ordem inversa da montagem é sempre uma solução. Depois uma
   busca exata por peça ajusta a ponta de cada uma para deixar poucas setas livres no começo, sem nunca perder a
   solução. O tamanho da peça é escolhido para caber o DOBRO de setas de antes em um tabuleiro maior. */

/* ===================== DOMÍNIO ===================== */
/* n: lado da grade. maxLen: tamanho máximo de uma seta (casas). maxBends: dobras máximas de uma seta.
   redirectors: quantos desviadores o tabuleiro tem. target: quantidade desejada de setas.
   Mais peças, mais dobras e mais desviadores conforme o nível; a busca exata deixa poucas setas livres no começo. */
export const LEVELS = [
  { name: "Fácil", n: 8, maxLen: 2, maxBends: 0, redirectors: 4, target: 40 },
  { name: "Médio", n: 10, maxLen: 3, maxBends: 1, redirectors: 6, target: 56 },
  { name: "Difícil", n: 12, maxLen: 4, maxBends: 2, redirectors: 8, target: 64 },
  { name: "Genius", n: 14, maxLen: 5, maxBends: 3, redirectors: 12, target: 80 },
];
/** Vidas por cenário: cada toque numa seta travada custa uma. Ao zerar, o tabuleiro volta ao início. */
export const LIVES = 3;
export const STORE_KEY = "arrows.wins";
/** Versão do gerador: gravada na fase salva. Mudar o sorteio muda as fases de uma mesma seed, então aumente ao mexer nele. */
export const GEN = 4;

/* Setas no sentido horário: 0 = Norte (cima), 1 = Leste, 2 = Sul, 3 = Oeste. DIRS dá o passo [linha, coluna]. */
export const DIRS = [[-1, 0], [0, 1], [1, 0], [0, -1]];
const EMPTY = new Map();

/* Fase: { n, pieces, redirectors, solution } — cada peça é { cells: [casas...], dir }, com a PONTA em cells[0]
   apontando dir. `redirectors` é um Map casa -> direção INICIAL (0..3); a direção em jogo é essa + nº de
   remoções. A direção do primeiro trecho (cells[1]→cells[0]) é a própria dir, então a seta desenha reta na ponta. */

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

/** Anda com a PONTA a partir de `head` na direção `dir`: uma casa por passo, virando nos desviadores.
    `occ` tem só as peças (a própria é `own` e não trava); `redirectors` é Map casa -> direção inicial e `turn`
    é o nº de setas já removidas. Devolve true se sair do tabuleiro, false se bater em outra peça ou entrar em
    ciclo. wantPath devolve também as casas e as direções de cada trecho (para a animação e os testes). */
function walk(n, head, dir, occ, own, redirectors, turn, wantPath) {
  const seen = new Set();
  const path = wantPath ? [head] : null, segs = wantPath ? [] : null;
  let r = (head / n) | 0, c = head % n, d = dir;
  for (;;) {
    const key = (r * n + c) * 4 + d;
    if (seen.has(key)) return null;                 // ciclo: nunca sai
    seen.add(key);
    if (wantPath) segs.push(d);
    const nr = r + DIRS[d][0], nc = c + DIRS[d][1];
    if (nr < 0 || nc < 0 || nr >= n || nc >= n) return wantPath ? { path, segs } : true;
    const cell = nr * n + nc;
    const o = occ.get(cell);
    if (o !== undefined && o !== own) return null;  // outra peça no caminho
    if (wantPath) path.push(cell);
    const rd = redirectors.get(cell);
    if (rd !== undefined) d = (rd + turn) & 3;      // desviador: continua na direção dele
    r = nr; c = nc;
  }
}

/** Caminho da ponta até fora do tabuleiro: { path: [casas], segs: [direção de cada trecho] } ou null se travada.
    `segs` tem o mesmo tamanho de `path`: segs[j] é a direção com que a ponta sai de path[j] (o último sai fora). */
export const beam = (n, head, dir, occ, own, redirectors = EMPTY, turn = 0) => walk(n, head, dir, occ, own, redirectors, turn, true);

/** A peça `i` está travada? Só conta o caminho da PONTA (com os desvios dos blocos); o corpo escoa pelo próprio
    caminho, então casas da própria peça não travam. */
export function blocked(n, pieces, occ, i, redirectors = EMPTY, turn = 0) {
  return walk(n, pieces[i].cells[0], pieces[i].dir, occ, i, redirectors, turn, false) === null;
}
export const removable = (n, pieces, occ, i, redirectors = EMPTY, turn = 0) => !blocked(n, pieces, occ, i, redirectors, turn);

/** Uma remoção válida: a ordem de peças precisa esvaziar o tabuleiro, cada uma presente e livre NO ESTADO dela
    (os desviadores giram 90° depois de cada seta que sai). */
export function isSolved(n, pieces, order, redirectors = EMPTY) {
  if (!Array.isArray(order) || order.length !== pieces.length) return false;
  const present = new Set(pieces.map((_, i) => i));
  const occ = buildOcc(pieces, present);
  let turn = 0;
  for (const i of order) {
    if (!Number.isInteger(i) || !present.has(i) || blocked(n, pieces, occ, i, redirectors, turn)) return false;
    present.delete(i);
    for (const c of pieces[i].cells) occ.delete(c);
    turn++;
  }
  return present.size === 0;
}

/* ===================== GERADOR ===================== */
/** Sorteia as casas dos desviadores, espalhadas pelo tabuleiro, no estado FINAL da construção. */
function placeRedirectors(n, rng, count) {
  const cells = Array.from({ length: n * n }, (_, i) => i);
  for (let i = cells.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [cells[i], cells[j]] = [cells[j], cells[i]]; }
  const map = new Map();
  for (const cell of cells.slice(0, Math.min(count, n * n))) map.set(cell, (rng() * 4) | 0);
  return map;
}
/** Cópia dos desviadores girada `delta` passos (3 = -90°, para andar da última remoção para a primeira). */
const rotated = (redirectors, delta) => {
  const map = new Map();
  for (const [cell, dir] of redirectors) map.set(cell, (dir + delta) & 3);
  return map;
};

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

/** Uma peça válida da construção: ponta `h` apontando `d` (saída livre das peças já colocadas, considerando os
    desviadores NO ESTADO da remoção dela), corpo atrás, com no máximo `maxThis` casas. */
function makePiece(n, used, rng, level, maxThis, redirectors, occ) {
  const cap = Math.max(1, Math.min(maxThis, level.maxLen));
  let best = null, bestScore = Infinity;
  for (let cell = 0; cell < n * n; cell++) {
    if (used.has(cell)) continue;
    for (let d = 0; d < 4; d++) {
      if (walk(n, cell, d, occ, -1, redirectors, 0, false) === null) continue;
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

/** Ajusta a ponta de cada peça (mantendo as casas) para ela ficar TRAVADA no começo (turn 0) e continuar
    livre na hora em que é removida. As casas da peça não mudam, então a escolha de uma peça não altera a saída
    das outras: a ocupação é a mesma e só a direção da própria ponta muda. Cada peça é otimizada de forma
    independente (mínimo global de setas livres para a ordem escolhida). */
function reduceFree(n, pieces, redirectors, order) {
  const present = new Set(pieces.map((_, i) => i));
  const occ = buildOcc(pieces, present), steps = new Map();
  let turn = 0;
  for (const i of order) {
    steps.set(i, { occ: new Map(occ), turn });
    present.delete(i);
    for (const c of pieces[i].cells) occ.delete(c);
    turn++;
  }
  const occ0 = buildOcc(pieces, pieces.map((_, i) => i));
  return pieces.map((p, i) => {
    const at = steps.get(i);
    const cur = { cells: p.cells.slice(), dir: p.dir };
    let best = cur, bestFree = blocked(n, pieces, occ0, i, redirectors, 0) ? 0 : 1;
    const rev = p.cells.length > 1 ? p.cells.slice().reverse() : null;
    const alts = p.cells.length === 1
      ? [0, 1, 2, 3].map(dir => ({ cells: p.cells, dir })).filter(a => a.dir !== p.dir)
      : [{ cells: rev, dir: dirBetween(n, rev[1], rev[0]) }];
    for (const alt of alts) {
      const cand = pieces.slice();
      cand[i] = alt;
      if (blocked(n, cand, at.occ, i, redirectors, at.turn)) continue;   // precisa sair na vez dela
      const free = blocked(n, cand, occ0, i, redirectors, 0) ? 0 : 1;
      if (free < bestFree) { best = alt; bestFree = free; }
    }
    return best;
  });
}

/** A solução pretendida usa ao menos um desviador? (garante que os blocos não sejam só decoração) */
function usesRedirector(n, pieces, solution, redirectors) {
  const present = new Set(pieces.map((_, i) => i));
  const occ = buildOcc(pieces, present);
  let turn = 0;
  for (const i of solution) {
    const b = beam(n, pieces[i].cells[0], pieces[i].dir, occ, i, redirectors, turn);
    if (b && b.path.some(cell => cell !== pieces[i].cells[0] && redirectors.has(cell))) return true;
    present.delete(i);
    for (const c of pieces[i].cells) occ.delete(c);
    turn++;
  }
  return false;
}

/** Fase a partir de uma seed (via rng) e de um nível: solucionável, com desviadores e com o dobro de setas. */
export function generatePuzzle(rng, level) {
  const n = level.n, total = n * n, target = level.target;
  for (let attempt = 0; attempt < 80; attempt++) {
    /* A construção anda da ÚLTIMA remoção para a primeira: começa no estado final sorteado e gira -90° antes
       de cada peça. Ao terminar, `state` é o estado inicial que vai para o jogador. */
    let state = placeRedirectors(n, rng, level.redirectors);
    const used = new Set(state.keys()), pieces = [], occ = new Map();
    for (let guard = 0; guard < total * 4 && pieces.length < target && used.size < total; guard++) {
      const st = pieces.length ? rotated(state, 3) : state;
      const free = total - used.size, left = Math.max(1, target - pieces.length);
      const want = Math.max(1, Math.min(level.maxLen, Math.round(free / left) + (rng() < 0.25 ? 1 : 0)));
      const p = makePiece(n, used, rng, level, want, st, occ);
      if (!p) break;
      state = st;
      const idx = pieces.length;
      for (const c of p.cells) { used.add(c); occ.set(c, idx); }
      pieces.push(p);
    }
    if (pieces.length < Math.round(target * 0.9)) continue;   // não coube o bastante: tenta outra disposição
    const solution = pieces.map((_, i) => i).reverse();        // a primeira removida é a última colocada
    const reduced = reduceFree(n, pieces, state, solution);
    if (!isSolved(n, reduced, solution, state)) continue;
    if (!usesRedirector(n, reduced, solution, state)) continue;
    return { n, pieces: reduced, redirectors: state, solution };
  }
  throw new Error("Não foi possível gerar a fase.");
}
