/* Regras, solver e gerador do jogo de setas ("tap away"): código puro, sem DOM (testável no Node).

   Mecânica: cada casa tem uma seta (N, L, S, O). Ao tocar, a seta SAI VOANDO na direção em que aponta —
   mas só se o caminho até fora do tabuleiro estiver LIVRE (nenhuma outra seta no meio). Tocar numa seta
   bloqueada não muda nada. Objetivo: tirar todas as setas.

   Como um tabuleiro assim precisa de solução, o gerador NÃO sorteia as direções ao acaso (puzzles aleatórios
   quase nunca têm solução). Ele parte de uma configuração garantidamente solucionável — cada seta apontando
   para a borda mais próxima, de modo que a remoção por camadas (de fora para dentro) sempre funciona — e
   depois embaralha direções SÓ quando isso preserva a solubilidade. O resultado é solucionável, variado e
   com boa parte do tabuleiro travada no começo. */

/* ===================== DOMÍNIO ===================== */
/* n: lado da grade. shape: formato das casas com seta (as demais ficam vazias). */
export const LEVELS = [
  { name: "Fácil", n: 7, shape: "heart" },
  { name: "Médio", n: 8, shape: "diamond" },
  { name: "Difícil", n: 8, shape: "square" },
  { name: "Genius", n: 9, shape: "square" },
];
export const STORE_KEY = "arrows.wins";
/** Versão do gerador: gravada na fase salva. Mudar o sorteio muda as fases de uma mesma seed, então aumente ao mexer nele. */
export const GEN = 1;

/* Setas no sentido horário: 0 = Norte (cima), 1 = Leste, 2 = Sul, 3 = Oeste. DIRS dá o passo [linha, coluna] de cada uma. */
export const DIRS = [[-1, 0], [0, 1], [1, 0], [0, -1]];

/* Fase: { n, dirs } — dirs tem n*n posições; -1 = casa vazia (sem seta), 0..3 = direção da seta. */

/** Casas que têm seta na fase, na ordem natural (útil para percorrer/validar). */
export function tileCells(dirs) {
  const out = [];
  for (let i = 0; i < dirs.length; i++) if (dirs[i] >= 0) out.push(i);
  return out;
}

/** O caminho da seta `cell` na direção `d` está livre (nenhuma seta PRESENTE entre ela e fora do tabuleiro)? */
export function clearDir(n, dirs, present, cell, d) {
  if (d < 0 || d > 3) return false;
  let r = (cell / n) | 0, c = cell % n;
  const [dr, dc] = DIRS[d];
  for (r += dr, c += dc; r >= 0 && c >= 0 && r < n && c < n; r += dr, c += dc) if (present.has(r * n + c)) return false;
  return true;
}
/** A seta em `cell` pode sair agora? (precisa estar presente e com o caminho livre) */
export const removable = (n, dirs, present, cell) => dirs[cell] >= 0 && present.has(cell) && clearDir(n, dirs, present, cell, dirs[cell]);

/* ===================== SOLVER ===================== */
/** Ordem de remoção que limpa o tabuleiro, ou null se não há solução. Remover sempre que possível nunca
    atrapalha (tirar uma seta só abre caminho para as outras), então esta "varredura" decide a solubilidade. */
export function solveOrder(n, dirs, cells = tileCells(dirs)) {
  const present = new Set(cells), order = [];
  while (present.size) {
    let moved = false;
    for (const cell of [...present]) if (removable(n, dirs, present, cell)) { present.delete(cell); order.push(cell); moved = true; }
    if (!moved) return null;
  }
  return order;
}

/** Valida uma jogada enviada pelo cliente: a ordem precisa esvaziar o tabuleiro, cada seta presente e com a saída livre. */
export function isSolved(n, dirs, order) {
  const cells = tileCells(dirs);
  if (!Array.isArray(order) || order.length !== cells.length) return false;
  const present = new Set(cells);
  for (const cell of order) {
    if (!Number.isInteger(cell) || !present.has(cell) || !removable(n, dirs, present, cell)) return false;
    present.delete(cell);
  }
  return present.size === 0;
}

/* ===================== GERADOR ===================== */
/** Casas do formato pedido, numa grade n x n. x,y vão de -1 a 1 (y para cima); o centro da casa decide. */
export function shapeCells(n, kind) {
  const mask = new Array(n * n).fill(false);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const x = ((c + 0.5) / n) * 2 - 1, y = 1 - ((r + 0.5) / n) * 2;
    let on = true;
    if (kind === "diamond") on = Math.abs(x) + Math.abs(y) <= 1.05;
    else if (kind === "plus") on = Math.abs(x) <= 0.42 || Math.abs(y) <= 0.42;
    else if (kind === "heart") {
      const X = x * 1.25, Y = (y - 0.1) * 1.25;
      on = (X * X + Y * Y - 1) ** 3 - X * X * Y ** 3 <= 0;
    }
    mask[r * n + c] = on;
  }
  return mask;
}

/** Configuração solucionável garantida: cada seta aponta para a borda mais próxima (empate sorteado).
    Removendo por camadas de distância à borda (de fora para dentro) o caminho está sempre livre. */
function baseline(n, mask, rng) {
  const dirs = new Array(n * n).fill(-1);
  for (let cell = 0; cell < n * n; cell++) {
    if (!mask[cell]) continue;
    const r = (cell / n) | 0, c = cell % n, dist = [r, n - 1 - c, n - 1 - r, c], m = Math.min(...dist);
    const choices = [0, 1, 2, 3].filter(d => dist[d] === m);
    dirs[cell] = choices[(rng() * choices.length) | 0];
  }
  return dirs;
}

/** Fase a partir de uma seed (via rng) e de um nível: sempre solucionável e nunca começa resolvida. */
export function generatePuzzle(rng, level) {
  const n = level.n, mask = shapeCells(n, level.shape);
  const cells = mask.map((v, i) => (v ? i : -1)).filter(i => i >= 0);
  for (let attempt = 0; attempt < 60; attempt++) {
    const dirs = baseline(n, mask, rng);
    /* Embaralha direções ao acaso, mas desfaz quando quebra a solubilidade — dá variedade sem perder a solução. */
    for (let k = 0; k < cells.length * 12; k++) {
      const cell = cells[(rng() * cells.length) | 0], d = (rng() * 4) | 0, old = dirs[cell];
      if (d === old) continue;
      dirs[cell] = d;
      if (!solveOrder(n, dirs, cells)) dirs[cell] = old;
    }
    const solution = solveOrder(n, dirs, cells);
    if (!solution) continue;
    /* Evita fase trivial (tudo já removível de imediato): exige boa parte das setas travadas no começo. */
    const present = new Set(cells), free = cells.filter(cell => removable(n, dirs, present, cell)).length;
    if (free > cells.length * 0.5) continue;
    return { n, dirs, solution };
  }
  throw new Error("Não foi possível gerar a fase.");
}
