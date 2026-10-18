/* Regras, simulação da água e gerador do jogo de canos: código puro, sem DOM (testável no Node). */

/* ===================== DOMÍNIO ===================== */
/* n: lado da grade. seconds: tempo da contagem regressiva (começa no primeiro giro). minLen/maxLen: tamanho do caminho plantado
   (quantas casas a água percorre da entrada à saída). waypoints: quantos pontos de passagem o gerador sorteia para o caminho
   serpentear (mais pontos, mais curvas). Os tamanhos de caminho foram calibrados para sobrar uns 2,5 a 4,5 segundos por giro necessário. */
export const LEVELS = [
  { name: "Fácil", n: 5, seconds: 60, minLen: 7, maxLen: 11, waypoints: [0, 1] },
  { name: "Médio", n: 10, seconds: 90, minLen: 18, maxLen: 28, waypoints: [1, 3] },
  { name: "Difícil", n: 15, seconds: 120, minLen: 32, maxLen: 46, waypoints: [2, 4] },
  { name: "Genius", n: 20, seconds: 180, minLen: 48, maxLen: 68, waypoints: [3, 6] },
];
export const STORE_KEY = "canos.wins";
/** Versão do gerador: gravada na fase salva. Mudar o sorteio muda as fases de uma mesma seed, então aumente ao mexer nele. */
export const GEN = 1;

/* Lados de uma casa, no sentido horário: 0 = Norte (cima), 1 = Leste, 2 = Sul, 3 = Oeste. Cada cano é uma máscara de bits dos lados abertos. */
export const N = 0, E = 1, S = 2, W = 3;
export const BIT = [1, 2, 4, 8];
export const DELTA = [[-1, 0], [0, 1], [1, 0], [0, -1]];
export const opposite = side => (side + 2) % 4;
/** Formato de cada tipo de cano com rotação 0: I = reto (N-S), L = curva (N-L), T = três saídas (N-L-O), X = cruz (as quatro). */
export const BASE = { I: BIT[N] | BIT[S], L: BIT[N] | BIT[E], T: BIT[N] | BIT[E] | BIT[W], X: 15 };
/** Gira uma máscara r quartos de volta no sentido horário (um clique = 1). */
export function rotateMask(mask, r) {
  let m = mask;
  for (let k = ((r % 4) + 4) % 4; k > 0; k--) m = ((m << 1) | (m >> 3)) & 15;
  return m;
}
/** Lados abertos de um cano de tipo `type` girado `rot` quartos de volta. */
export const maskOf = (type, rot) => rotateMask(BASE[type], rot);

/* Fase: { n, tiles: [{ type, rot }] (rot = giro inicial, já embaralhado), inlet: { cell, side }, outlet: { cell, side },
           path: number[] (casas do caminho plantado, da entrada à saída), solution: number[] (giro certo das casas do caminho; -1 nas outras) }
   inlet.side / outlet.side: lado da casa voltado para fora da grade, onde fica o cano de entrada / de saída. */

/* ----- Giro ----- */
/** Nova lista de giros depois de girar a casa i (dir = 1 horário, -1 anti-horário). */
export function rotateTile(rots, i, dir = 1) {
  const next = [...rots];
  next[i] = (((rots[i] + dir) % 4) + 4) % 4;
  return next;
}
export const initialRots = puzzle => puzzle.tiles.map(t => t.rot);

/* ----- A água ----- */
/** Simula a água correndo com os giros `rots`. A água entra pela entrada e se espalha, uma casa por "onda" (profundidade), por todas as
    aberturas conectadas. Ponta aberta que não encontra cano que a receba (ou que dá para a borda fora da saída) é um VAZAMENTO.
    Vence quem chega à saída ANTES de qualquer vazamento (empate: vazamento). Devolve:
      status: "win" | "leak" (vazou antes de chegar à saída) | "blocked" (o cano da entrada não está virado para a água) |
              "stuck" (a água encheu um circuito fechado e não chegou à saída)
      fills: [{ cell, depth }] em ordem de chegada; leaks: [{ cell, side, depth }]; outletDepth (-1 se não chegou); endDepth: onda em que o jogo acaba. */
export function simulate(puzzle, rots) {
  const { n, inlet, outlet } = puzzle, mask = i => maskOf(puzzle.tiles[i].type, rots[i]);
  if (!(mask(inlet.cell) & BIT[inlet.side])) {
    return { status: "blocked", fills: [], leaks: [{ cell: inlet.cell, side: inlet.side, depth: 0 }], outletDepth: -1, endDepth: 0 };
  }
  const depth = new Array(n * n).fill(-1), fills = [], leaks = [], queue = [inlet.cell];
  let outletDepth = -1;
  depth[inlet.cell] = 0;
  for (let q = 0; q < queue.length; q++) {
    const cell = queue[q], m = mask(cell), r = Math.floor(cell / n), c = cell % n;
    fills.push({ cell, depth: depth[cell] });
    for (let side = 0; side < 4; side++) {
      if (!(m & BIT[side])) continue;
      if (cell === inlet.cell && side === inlet.side) continue;                       // por aqui a água entrou
      if (cell === outlet.cell && side === outlet.side) { if (outletDepth < 0) outletDepth = depth[cell]; continue; }   // a saída
      const nr = r + DELTA[side][0], nc = c + DELTA[side][1];
      if (nr < 0 || nc < 0 || nr >= n || nc >= n) { leaks.push({ cell, side, depth: depth[cell] }); continue; }          // borda: vaza
      const next = nr * n + nc;
      if (!(mask(next) & BIT[opposite(side)])) { leaks.push({ cell, side, depth: depth[cell] }); continue; }            // vizinho sem abertura: vaza
      if (depth[next] < 0) { depth[next] = depth[cell] + 1; queue.push(next); }
    }
  }
  const firstLeak = leaks.length ? Math.min(...leaks.map(l => l.depth)) : Infinity;
  if (outletDepth >= 0 && outletDepth < firstLeak) return { status: "win", fills, leaks, outletDepth, endDepth: outletDepth };
  if (firstLeak < Infinity) return { status: "leak", fills, leaks, outletDepth, endDepth: firstLeak };
  return { status: "stuck", fills, leaks, outletDepth, endDepth: fills.length ? fills[fills.length - 1].depth : 0 };
}
/** Os vazamentos da onda em que o jogo acaba (os que aparecem na tela). */
export const firstLeaks = sim => sim.leaks.filter(l => l.depth === sim.endDepth);

/** Quantos cliques (horários) ainda faltam, no mínimo, para acertar o caminho plantado com os giros `rots`. */
export function clicksNeeded(puzzle, rots) {
  let total = 0;
  for (const i of puzzle.path) {
    const want = maskOf(puzzle.tiles[i].type, puzzle.solution[i]);
    let k = 0;
    while (maskOf(puzzle.tiles[i].type, rots[i] + k) !== want) k++;
    total += k;
  }
  return total;
}
/** Os giros que resolvem a fase (o caminho plantado certo; as outras casas ficam como estão). */
export const solutionRots = puzzle => puzzle.tiles.map((t, i) => (puzzle.solution[i] >= 0 ? puzzle.solution[i] : t.rot));

/* ===================== GERADOR ===================== */
const shuffle = (arr, rng) => {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
};
const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

/** Casas encostadas num lado da grade. */
function cellsOnSide(n, side) {
  const out = [];
  for (let k = 0; k < n; k++) out.push(side === N ? k : side === S ? (n - 1) * n + k : side === W ? k * n : k * n + n - 1);
  return out;
}
/** Caminho de custo aleatório de `from` até `to` sem passar pelas casas em `blocked` (Dijkstra com custo sorteado por casa: dá caminhos
    cheios de curvas, e não só em "L"). Devolve as casas depois de `from`, até `to`; null se não há caminho. */
function route(n, from, to, blocked, rng) {
  const cost = new Float64Array(n * n).map(() => 1 + rng() * 2.2), dist = new Float64Array(n * n).fill(Infinity), prev = new Int32Array(n * n).fill(-1);
  const heap = [[0, from]];
  dist[from] = 0;
  const push = item => { heap.push(item); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; }
    }
    return top;
  };
  while (heap.length) {
    const [d, cell] = pop();
    if (d > dist[cell]) continue;
    if (cell === to) break;
    const r = Math.floor(cell / n), c = cell % n;
    for (const [dr, dc] of DELTA) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= n || nc >= n) continue;
      const next = nr * n + nc;
      if (blocked.has(next) && next !== to) continue;
      if (d + cost[next] < dist[next]) { dist[next] = d + cost[next]; prev[next] = cell; push([dist[next], next]); }
    }
  }
  if (prev[to] < 0) return null;
  const out = [];
  for (let c = to; c !== from; c = prev[c]) out.push(c);
  return out.reverse();
}
/** Lado de `a` voltado para a casa vizinha `b`. */
const sideToward = (n, a, b) => DELTA.findIndex(([dr, dc]) => Math.floor(a / n) + dr === Math.floor(b / n) && (a % n) + dc === b % n);

/** Caminho da entrada à saída, serpenteando por pontos de passagem sorteados, com tamanho entre minLen e maxLen (ou null). */
function planPath(n, start, end, level, rng) {
  for (let attempt = 0; attempt < 600; attempt++) {
    const k = randInt(rng, level.waypoints[0], level.waypoints[1]), used = new Set([start]), path = [start], way = new Set();
    while (way.size < k) { const w = randInt(rng, 0, n * n - 1); if (w !== start && w !== end) way.add(w); }
    let ok = true, last = start;
    for (const target of [...way, end]) {
      if (target !== end && used.has(target)) continue;           // um trecho anterior já passou por este ponto: sem repetir casa
      const blocked = new Set(used);
      if (target !== end) blocked.add(end);                      // a saída só pode ser a última casa
      const leg = route(n, last, target, blocked, rng);
      if (!leg) { ok = false; break; }
      for (const c of leg) { used.add(c); path.push(c); }
      last = target;
    }
    if (ok && path.length >= level.minLen && path.length <= level.maxLen) return path;
  }
  return null;
}

/** Sorteia o tipo de uma casa que não é do caminho: parte curvas e retos, com "T" e cruz como armadilhas. */
const decoyType = rng => { const x = rng(); return x < 0.34 ? "I" : x < 0.76 ? "L" : x < 0.95 ? "T" : "X"; };

/** Fase a partir de uma seed (via rng) e de um nível. Planta um caminho da entrada à saída (só retos e curvas), sorteia o resto da grade
    e embaralha os giros, garantindo que a fase não começa resolvida e que, resolvida, a água vence. */
export function generatePuzzle(rng, level) {
  const n = level.n;
  for (let attempt = 0; attempt < 200; attempt++) {
    const inSide = randInt(rng, 0, 3), outSide = (inSide + randInt(rng, 1, 3)) % 4;
    const start = shuffle(cellsOnSide(n, inSide), rng)[0], end = shuffle(cellsOnSide(n, outSide), rng)[0];
    if (start === end) continue;
    const path = planPath(n, start, end, level, rng);
    if (!path) continue;
    const tiles = Array.from({ length: n * n }, () => ({ type: decoyType(rng), rot: randInt(rng, 0, 3) })), solution = new Array(n * n).fill(-1);
    path.forEach((cell, i) => {
      const from = i === 0 ? inSide : sideToward(n, cell, path[i - 1]), to = i === path.length - 1 ? outSide : sideToward(n, cell, path[i + 1]);
      const mask = BIT[from] | BIT[to], type = mask === 5 || mask === 10 ? "I" : "L";
      const rot = [0, 1, 2, 3].find(r => maskOf(type, r) === mask);
      tiles[cell] = { type, rot }; solution[cell] = rot;
    });
    const puzzle = { n, tiles, inlet: { cell: start, side: inSide }, outlet: { cell: end, side: outSide }, path, solution };
    /* Embaralha os giros do caminho: pelo menos 55% das casas começam erradas, e a fase nunca começa vencedora (por caminho alternativo). */
    const need = Math.max(2, Math.ceil(path.length * 0.55)), wrong = () => path.filter(i => maskOf(tiles[i].type, tiles[i].rot) !== maskOf(tiles[i].type, solution[i])).length;
    for (let tries = 0; tries < 80; tries++) {
      for (const i of path) tiles[i].rot = randInt(rng, 0, 3);
      for (const i of shuffle([...path], rng)) { if (wrong() >= need) break; if (maskOf(tiles[i].type, tiles[i].rot) === maskOf(tiles[i].type, solution[i])) tiles[i].rot = (solution[i] + 1) % 4; }
      if (wrong() >= need && simulate(puzzle, initialRots(puzzle)).status !== "win") return puzzle;
    }
  }
  throw new Error("Não foi possível gerar a fase.");
}
