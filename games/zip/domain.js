/* Regras, solver e gerador: código puro, sem DOM (testável no Node). */

/* ===================== DOMÍNIO ===================== */
export let N = 6, TOTAL = 36;
export const setSize = n => { N = n; TOTAL = n * n; };
export const LEVELS = [
  { name: "Fácil", n: 5, wp: [8, 10], walls: 6 },
  { name: "Médio", n: 6, wp: [6, 8], walls: 10 },
  { name: "Difícil", n: 7, wp: [6, 8], walls: 12 },
  { name: "Genius", n: 8, wp: [10, 12], walls: 18 },
];
export const STORE_KEY = "zip.wins";

export const neighbors = i => {
  const r = (i / N) | 0, c = i % N, out = [];
  if (r > 0) out.push(i - N);
  if (r < N - 1) out.push(i + N);
  if (c > 0) out.push(i - 1);
  if (c < N - 1) out.push(i + 1);
  return out;
};
export const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/* Fase: { waypoints: Map<célula, número>, walls: Set<edgeKey>, max } */

/** Regras de um passo. Retorna o novo caminho ou o mesmo se a jogada for inválida. */
export function applyMove(puzzle, path, target) {
  if (path.length === 0) return puzzle.waypoints.get(target) === 1 ? [target] : path;
  const last = path[path.length - 1];
  if (!neighbors(last).includes(target)) return path;
  if (path.length > 1 && target === path[path.length - 2]) return path.slice(0, -1);
  if (puzzle.waypoints.get(last) === puzzle.max) return path;
  if (path.includes(target) || puzzle.walls.has(edgeKey(last, target))) return path;
  const reached = path.filter(c => puzzle.waypoints.has(c)).length;
  const w = puzzle.waypoints.get(target);
  if (w !== undefined && w !== reached + 1) return path;
  return [...path, target];
}
export const isSolved = (puzzle, path) =>
  path.length === TOTAL && puzzle.waypoints.get(path[path.length - 1]) === puzzle.max;

/* ===================== SOLVER ===================== */
/** Conta soluções (até `limit`) para validar a unicidade da fase. */
export function countSolutions(waypoints, walls, max, limit = 2) {
  const seen = new Array(TOTAL).fill(false);
  const start = [...waypoints].find(([, v]) => v === 1)[0];
  let count = 0, nodes = 0;

  const stillConnected = (from, remaining) => {   // poda: células livres alcançáveis
    const stack = [from], reached = new Set([from]);
    while (stack.length) {
      const x = stack.pop();
      for (const y of neighbors(x)) {
        if (!seen[y] && !reached.has(y) && !walls.has(edgeKey(x, y))) { reached.add(y); stack.push(y); }
      }
    }
    return reached.size - 1 === remaining;
  };

  const maxCell = [...waypoints].find(([, v]) => v === max)[0];
  /* Poda: toda célula livre com grau <= 1 só pode ser o fim do caminho (a célula do maior número). */
  const deadEndsOk = cur => {
    for (let u = 0; u < TOTAL; u++) {
      if (seen[u]) continue;
      let deg = 0;
      for (const v of neighbors(u)) if ((!seen[v] || v === cur) && !walls.has(edgeKey(u, v))) deg++;
      if (deg === 0 || (deg === 1 && u !== maxCell)) return false;
    }
    return true;
  };

  const go = (i, k, visited) => {
    if (count >= limit) return;
    if (++nodes > 60000) { count = limit; return; }   // orçamento: fase não provada como única é descartada
    if (visited === TOTAL) { if (k === max) count++; return; }
    if (k === max || !stillConnected(i, TOTAL - visited) || !deadEndsOk(i)) return;
    for (const j of neighbors(i)) {
      if (seen[j] || walls.has(edgeKey(i, j))) continue;
      const w = waypoints.get(j);
      if (w !== undefined && w !== k + 1) continue;
      seen[j] = true;
      go(j, w ?? k, visited + 1);
      seen[j] = false;
    }
  };
  seen[start] = true;
  go(start, 1, 1);
  return count;
}

/* ===================== GERADOR ===================== */
/** Caminho hamiltoniano aleatório (DFS + heurística de Warnsdorff, com limite de passos). */
export function randomHamiltonianPath(rand) {
  for (;;) {
    const seen = new Array(TOTAL).fill(false), path = [];
    let steps = 0;
    const free = i => neighbors(i).filter(j => !seen[j]);
    const dfs = i => {
      if (++steps > 20000) return false;
      seen[i] = true; path.push(i);
      if (path.length === TOTAL) return true;
      const options = free(i).map(j => [free(j).length + rand() * 0.5, j]).sort((a, b) => a[0] - b[0]);
      for (const [, j] of options) if (dfs(j)) return true;
      seen[i] = false; path.pop();
      return false;
    };
    if (dfs(Math.floor(rand() * TOTAL))) return path;
  }
}

export function generatePuzzle(rand, level) {
  setSize(level.n);
  for (;;) {
    const path = randomHamiltonianPath(rand);
    const count = level.wp[0] + Math.floor(rand() * (level.wp[1] - level.wp[0] + 1));
    const indexes = new Set([0, TOTAL - 1]);
    for (let n = 1; n < count - 1; n++) {            // números espaçados ao longo do caminho (com folga): a unicidade é provada bem mais rápido
      const at = Math.round((n * (TOTAL - 1)) / (count - 1) + (rand() - 0.5) * 2);
      indexes.add(Math.min(TOTAL - 2, Math.max(1, at)));
    }
    while (indexes.size < count) indexes.add(Math.floor(rand() * TOTAL));
    const waypoints = new Map([...indexes].sort((a, b) => a - b).map((idx, n) => [path[idx], n + 1]));

    const order = new Map(path.map((cell, n) => [cell, n]));
    const candidates = [];                          // arestas fora da solução: seguras para virar parede
    for (let a = 0; a < TOTAL; a++)
      for (const b of neighbors(a))
        if (a < b && Math.abs(order.get(a) - order.get(b)) !== 1) candidates.push(edgeKey(a, b));
    candidates.sort(() => rand() - 0.5);

    const walls = new Set();
    for (let w = 0; w < Math.ceil(level.walls / 3) && candidates.length; w++) walls.add(candidates.pop());
    let solutions = countSolutions(waypoints, walls, count);
    while (solutions > 1 && candidates.length && walls.size < level.walls) {
      walls.add(candidates.pop());
      if (candidates.length) walls.add(candidates.pop());
      solutions = countSolutions(waypoints, walls, count);
    }
    if (solutions === 1) return { waypoints, walls, max: count };
  }
}

