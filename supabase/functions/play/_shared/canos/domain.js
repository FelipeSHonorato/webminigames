/* Regras, simulação da água e gerador do jogo de canos: código puro, sem DOM (testável no Node). */

/* ===================== DOMÍNIO ===================== */
/* n: lado da grade. seconds: tempo da contagem regressiva (começa no primeiro giro). minLen/maxLen: tamanho da rede plantada
   (quantas casas a água percorre). waypoints: pontos de passagem do caminho simples. shapes: [entradas, saídas, chance] por nível. */
export const LEVELS = [
  { name: "Fácil", n: 5, seconds: 60, minLen: 7, maxLen: 14, waypoints: [0, 1], shapes: [[1, 1, 0.8], [1, 2, 0.2]] },
  { name: "Médio", n: 10, seconds: 90, minLen: 16, maxLen: 34, waypoints: [1, 3], shapes: [[1, 2, 0.8], [1, 3, 0.2]] },
  { name: "Difícil", n: 15, seconds: 120, minLen: 28, maxLen: 60, waypoints: [2, 4], shapes: [[1, 3, 0.8], [2, 3, 0.2]] },
  { name: "Genius", n: 20, seconds: 180, minLen: 42, maxLen: 84, waypoints: [3, 6], shapes: [[2, 3, 0.8], [3, 3, 0.2]] },
];
export const STORE_KEY = "canos.wins";
/** Versão do gerador: gravada na fase salva. Mudar o sorteio muda as fases de uma mesma seed, então aumente ao mexer nele. */
export const GEN = 2;

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

/* Fase: { n, tiles: [{ type, rot }] (rot = giro inicial, já embaralhado), inlets: [{ cell, side }], outlets: [{ cell, side }],
           path: number[] (todas as casas da rede plantada), solution: number[] (giro certo das casas da rede; -1 nas outras) }
   side: lado da casa voltado para fora da grade, onde fica o cano de entrada / de saída. */
export const inletsOf = p => Array.isArray(p.inlets) ? p.inlets : p.inlet ? [p.inlet] : [];
export const outletsOf = p => Array.isArray(p.outlets) ? p.outlets : p.outlet ? [p.outlet] : [];

/* ----- Giro ----- */
/** Nova lista de giros depois de girar a casa i (dir = 1 horário, -1 anti-horário). */
export function rotateTile(rots, i, dir = 1) {
  const next = [...rots];
  next[i] = (((rots[i] + dir) % 4) + 4) % 4;
  return next;
}
export const initialRots = puzzle => puzzle.tiles.map(t => t.rot);

/* ----- A água ----- */
/** Simula a água correndo com os giros `rots`. A água entra por TODAS as entradas e se espalha, uma casa por "onda" (profundidade),
    por todas as aberturas conectadas. Ponta aberta que não encontra cano que a receba (ou que dá para a borda fora de uma saída) é um
    VAZAMENTO. Vence quando todas as saídas são alcançadas ANTES de qualquer vazamento (empate: vazamento). Devolve:
      status: "win" | "leak" | "blocked" (um cano de entrada não está virado para a água) | "stuck" (não chegou a todas as saídas)
      fills: [{ cell, depth }] em ordem de chegada; leaks: [{ cell, side, depth }]; outletDepths (um por saída; -1 se não chegou);
      outletDepth (a maior profundidade alcançada, -1 se nenhuma); endDepth: onda em que o jogo acaba. */
export function simulate(puzzle, rots) {
  const { n } = puzzle, mask = i => maskOf(puzzle.tiles[i].type, rots[i]);
  const inlets = inletsOf(puzzle), outlets = outletsOf(puzzle);
  const missing = inlets.filter(t => !(mask(t.cell) & BIT[t.side]));
  if (missing.length) {
    return {
      status: "blocked", fills: [], leaks: missing.map(t => ({ cell: t.cell, side: t.side, depth: 0 })),
      outletDepth: -1, outletDepths: outlets.map(() => -1), endDepth: 0,
    };
  }
  const depth = new Array(n * n).fill(-1), fills = [], leaks = [], queue = [], outletDepths = outlets.map(() => -1);
  const inletAt = new Set(inlets.map(t => `${t.cell}:${t.side}`)), outletAt = new Map(outlets.map((t, i) => [`${t.cell}:${t.side}`, i]));
  for (const t of inlets) if (depth[t.cell] < 0) { depth[t.cell] = 0; queue.push(t.cell); }
  for (let q = 0; q < queue.length; q++) {
    const cell = queue[q], m = mask(cell), r = Math.floor(cell / n), c = cell % n;
    fills.push({ cell, depth: depth[cell] });
    for (let side = 0; side < 4; side++) {
      if (!(m & BIT[side])) continue;
      const key = `${cell}:${side}`;
      if (inletAt.has(key)) continue;                                                    // por aqui a água entrou
      const oi = outletAt.get(key);
      if (oi !== undefined) { if (outletDepths[oi] < 0) outletDepths[oi] = depth[cell]; continue; }   // uma das saídas
      const nr = r + DELTA[side][0], nc = c + DELTA[side][1];
      if (nr < 0 || nc < 0 || nr >= n || nc >= n) { leaks.push({ cell, side, depth: depth[cell] }); continue; }   // borda: vaza
      const next = nr * n + nc;
      if (!(mask(next) & BIT[opposite(side)])) { leaks.push({ cell, side, depth: depth[cell] }); continue; }       // vizinho sem abertura: vaza
      if (depth[next] < 0) { depth[next] = depth[cell] + 1; queue.push(next); }
    }
  }
  const reached = outletDepths.filter(d => d >= 0), outletDepth = reached.length ? Math.max(...reached) : -1;
  const allOutlets = outletDepths.every(d => d >= 0), firstLeak = leaks.length ? Math.min(...leaks.map(l => l.depth)) : Infinity;
  if (allOutlets && outletDepth < firstLeak) return { status: "win", fills, leaks, outletDepth, outletDepths, endDepth: outletDepth };
  if (firstLeak < Infinity) return { status: "leak", fills, leaks, outletDepth, outletDepths, endDepth: firstLeak };
  return { status: "stuck", fills, leaks, outletDepth, outletDepths, endDepth: fills.length ? fills[fills.length - 1].depth : 0 };
}
/** Os vazamentos da onda em que o jogo acaba (os que aparecem na tela). */
export const firstLeaks = sim => sim.leaks.filter(l => l.depth === sim.endDepth);

/** Quantos cliques (horários) ainda faltam, no mínimo, para acertar a rede plantada com os giros `rots`. */
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
/** Os giros que resolvem a fase (a rede plantada certa; as outras casas ficam como estão). */
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
function route(n, from, to, blocked, rng, wild = 2.2) {
  const cost = new Float64Array(n * n).map(() => 1 + rng() * wild), dist = new Float64Array(n * n).fill(Infinity), prev = new Int32Array(n * n).fill(-1);
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
const neighborOf = (n, cell, side) => {
  const r = Math.floor(cell / n) + DELTA[side][0], c = (cell % n) + DELTA[side][1];
  return r < 0 || c < 0 || r >= n || c >= n ? -1 : r * n + c;
};

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

/** Sorteia o tipo de uma casa que não é da rede: parte curvas e retos, com "T" e cruz como armadilhas. */
const decoyType = rng => { const x = rng(); return x < 0.34 ? "I" : x < 0.76 ? "L" : x < 0.95 ? "T" : "X"; };

function pickShape(level, rng) {
  let x = rng();
  for (const [ins, outs, chance] of level.shapes) { if (x < chance) return [ins, outs]; x -= chance; }
  const last = level.shapes[level.shapes.length - 1];
  return [last[0], last[1]];
}

function chooseTerminals(n, inCount, outCount, rng) {
  const kinds = shuffle([...Array(inCount).fill("in"), ...Array(outCount).fill("out")], rng), used = new Set(), out = [];
  for (const kind of kinds) {
    let spot = null;
    for (let tries = 0; tries < 300; tries++) {
      const side = randInt(rng, 0, 3), cells = cellsOnSide(n, side), cell = cells[randInt(rng, 0, cells.length - 1)];
      if (!used.has(cell)) { spot = { cell, side }; break; }
    }
    if (!spot) return null;
    used.add(spot.cell); out.push({ ...spot, kind });
  }
  return out;
}

function chooseHubs(n, terminals, rng) {
  const hubs = Math.max(1, Math.ceil((terminals.length - 2) / 2)), inner = [];
  for (let r = 1; r < n - 1; r++) for (let c = 1; c < n - 1; c++) inner.push(r * n + c);
  const center = list => list.reduce((acc, t) => [acc[0] + Math.floor(t.cell / n) / list.length, acc[1] + (t.cell % n) / list.length], [0, 0]);
  const manhattan = (a, b) => Math.abs(Math.floor(a / n) - Math.floor(b / n)) + Math.abs((a % n) - (b % n));
  const nearest = (list, avoid = []) => {
    const [cr, cc] = center(list);
    return inner.filter(cell => avoid.every(h => manhattan(cell, h) >= 4))
      .map(cell => ({ cell, score: Math.hypot(Math.floor(cell / n) - cr, (cell % n) - cc) + rng() * 2.5 }))
      .sort((a, b) => a.score - b.score)[0]?.cell;
  };
  if (hubs === 1) return [nearest(terminals)];
  const ins = terminals.filter(t => t.kind === "in"), outs = terminals.filter(t => t.kind === "out");
  const a = nearest(ins), b = nearest(outs, [a]);
  return a === undefined || b === undefined ? null : [a, b];
}

/** Monta uma rede em árvore com todos os terminais: um T/X central para 3/4 pontas, ou dois (um para juntar as entradas,
    outro para dividir nas saídas) quando há 5/6 pontas. Devolve { path, cells } ou null se não coube. */
function buildNetwork(n, terminals, rng) {
  const hubs = chooseHubs(n, terminals, rng);
  if (!hubs) return null;
  const ports = new Map(), used = new Set(hubs);
  const addPort = (cell, side) => {
    const set = ports.get(cell) ?? new Set();
    set.add(side); ports.set(cell, set);
  };
  const addStep = (a, b) => {
    const side = sideToward(n, a, b);
    if (side < 0) return false;
    addPort(a, side); addPort(b, opposite(side));
    return true;
  };
  const blockApproaches = (hub, blocked) => {
    for (const side of ports.get(hub) ?? []) { const nb = neighborOf(n, hub, side); if (nb >= 0) blocked.add(nb); }
  };
  const arms = terminals.map(term => ({ term, hub: hubs.length === 2 ? (term.kind === "in" ? hubs[0] : hubs[1]) : hubs[0] }));
  arms.sort((a, b) => Math.abs(Math.floor(b.term.cell / n) - Math.floor(b.hub / n)) + Math.abs((b.term.cell % n) - (b.hub % n))
    - Math.abs(Math.floor(a.term.cell / n) - Math.floor(a.hub / n)) - Math.abs((a.term.cell % n) - (a.hub % n)));
  for (const { term, hub } of arms) {
    const blocked = new Set(used);
    for (const t of terminals) if (t.cell !== term.cell) blocked.add(t.cell);
    for (const h of hubs) if (h !== hub) blocked.add(h);
    blockApproaches(hub, blocked);
    const leg = route(n, term.cell, hub, blocked, rng, 0.1);
    if (!leg) return null;
    const seq = [term.cell, ...leg], entry = sideToward(n, hub, seq[seq.length - 2]);
    if (entry < 0 || (ports.get(hub) ?? new Set()).has(entry)) return null;
    addPort(term.cell, term.side);
    for (let i = 1; i < seq.length; i++) if (!addStep(seq[i - 1], seq[i])) return null;
    for (const c of leg) used.add(c);
  }
  if (hubs.length === 2) {
    const blocked = new Set(used);
    blockApproaches(hubs[0], blocked); blockApproaches(hubs[1], blocked);
    const leg = route(n, hubs[0], hubs[1], blocked, rng, 0.1);
    if (!leg) return null;
    const seq = [hubs[0], ...leg], leave = sideToward(n, hubs[0], seq[1]), enter = sideToward(n, hubs[1], seq[seq.length - 2]);
    if (leave < 0 || enter < 0 || ports.get(hubs[0]).has(leave) || ports.get(hubs[1]).has(enter)) return null;
    for (let i = 1; i < seq.length; i++) if (!addStep(seq[i - 1], seq[i])) return null;
    for (const c of leg) used.add(c);
  }
  const cells = new Map(), path = [...ports.keys()].sort((a, b) => a - b);
  for (const [cell, sides] of ports) {
    const mask = [...sides].reduce((m, s) => m | BIT[s], 0), many = sides.size;
    const type = many === 2 ? (mask === (BIT[N] | BIT[S]) || mask === (BIT[E] | BIT[W]) ? "I" : "L")
      : many === 3 ? "T" : many === 4 ? "X" : null;
    if (!type) return null;
    const rot = [0, 1, 2, 3].find(r => maskOf(type, r) === mask);
    if (rot === undefined) return null;
    cells.set(cell, { type, rot });
  }
  return { path, cells };
}

function dress(puzzle, rng) {
  const { path, tiles, solution } = puzzle, need = Math.max(2, Math.ceil(path.length * 0.55));
  const wrong = () => path.filter(i => maskOf(tiles[i].type, tiles[i].rot) !== maskOf(tiles[i].type, solution[i])).length;
  for (let tries = 0; tries < 80; tries++) {
    for (const i of path) tiles[i].rot = randInt(rng, 0, 3);
    for (const i of shuffle([...path], rng)) { if (wrong() >= need) break; if (maskOf(tiles[i].type, tiles[i].rot) === maskOf(tiles[i].type, solution[i])) tiles[i].rot = (solution[i] + 1) % 4; }
    if (wrong() >= need && simulate(puzzle, initialRots(puzzle)).status !== "win") return true;
  }
  return false;
}

/** Fase a partir de uma seed (via rng) e de um nível. Sorteia a quantidade de entradas/saídas, planta a rede (retos e curvas nas
    pontas; T e cruz nos bifurcadores), sorteia o resto da grade e embaralha os giros, garantindo que a fase não começa resolvida e que,
    resolvida, a água vence. */
export function generatePuzzle(rng, level) {
  const n = level.n, [inCount, outCount] = pickShape(level, rng);
  for (let attempt = 0; attempt < 300; attempt++) {
    let inlets, outlets, path, cells, net = null;
    if (inCount === 1 && outCount === 1) {
      const inSide = randInt(rng, 0, 3), outSide = (inSide + randInt(rng, 1, 3)) % 4;
      const start = shuffle(cellsOnSide(n, inSide), rng)[0], end = shuffle(cellsOnSide(n, outSide), rng)[0];
      if (start === end) continue;
      path = planPath(n, start, end, level, rng);
      if (!path) continue;
      cells = new Map();
      path.forEach((cell, i) => {
        const from = i === 0 ? inSide : sideToward(n, cell, path[i - 1]), to = i === path.length - 1 ? outSide : sideToward(n, cell, path[i + 1]);
        const mask = BIT[from] | BIT[to], type = mask === (BIT[N] | BIT[S]) || mask === (BIT[E] | BIT[W]) ? "I" : "L";
        cells.set(cell, { type, rot: [0, 1, 2, 3].find(r => maskOf(type, r) === mask) });
      });
      inlets = [{ cell: start, side: inSide }]; outlets = [{ cell: end, side: outSide }];
    } else {
      const terminals = chooseTerminals(n, inCount, outCount, rng);
      if (!terminals) continue;
      net = buildNetwork(n, terminals, rng);
      if (!net || net.path.length < level.minLen || net.path.length > level.maxLen) continue;
      path = net.path; cells = net.cells;
      inlets = terminals.filter(t => t.kind === "in").map(({ cell, side }) => ({ cell, side })).sort((a, b) => a.cell - b.cell);
      outlets = terminals.filter(t => t.kind === "out").map(({ cell, side }) => ({ cell, side })).sort((a, b) => a.cell - b.cell);
    }
    const tiles = Array.from({ length: n * n }, () => ({ type: decoyType(rng), rot: randInt(rng, 0, 3) })), solution = new Array(n * n).fill(-1);
    for (const [cell, tile] of cells) { tiles[cell] = tile; solution[cell] = tile.rot; }
    const puzzle = { n, tiles, inlets, outlets, path, solution };
    const solved = simulate(puzzle, solutionRots(puzzle));
    if (solved.status !== "win" || solved.leaks.length) continue;
    if (!dress(puzzle, rng)) continue;
    return puzzle;
  }
  throw new Error("Não foi possível gerar a fase.");
}
