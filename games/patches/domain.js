/* Regras, solver e gerador: código puro, sem DOM (testável no Node). */

/* ===================== DOMÍNIO ===================== */
export let N = 6, TOTAL = 36;
export const setSize = n => { N = n; TOTAL = n * n; };
/* pAny / pNull: chance de uma pista vir com ícone "qualquer" ou sem número (menos informação = mais difícil). */
export const LEVELS = [
  { name: "Fácil", n: 5, pAny: 0, pNull: 0 },
  { name: "Médio", n: 6, pAny: 0.25, pNull: 0.08 },
  { name: "Difícil", n: 7, pAny: 0.45, pNull: 0.15 },
  { name: "Genius", n: 8, pAny: 0.65, pNull: 0.3 },
];
export const STORE_KEY = "patches.wins";

export const rectCells = (r0, c0, r1, c1) => {
  const out = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(r * N + c);
  return out;
};
export const shapeOk = (shape, w, h) =>
  shape === "any" || (shape === "square" ? w === h : shape === "wide" ? w > h : h > w);

/* Fase: { clues: [{ cell, area: number|null, shape: "square"|"wide"|"tall"|"any" }] }
   Patch: { rect: [r0, c0, r1, c1], clue: índice da pista } */

/** Valida um retângulo candidato contra as regras e os patches já colocados. */
export function validateRect(puzzle, patches, rect) {
  const [r0, c0, r1, c1] = rect, w = c1 - c0 + 1, h = r1 - r0 + 1;
  const cells = rectCells(r0, c0, r1, c1);
  const taken = new Set(patches.flatMap(p => rectCells(...p.rect)));
  if (cells.some(c => taken.has(c))) return { ok: false, reason: "O retângulo cobre células de outro patch." };
  const inside = puzzle.clues.map((_, i) => i).filter(i => cells.includes(puzzle.clues[i].cell));
  if (inside.length !== 1) return { ok: false, reason: inside.length ? "Cada patch deve ter só uma pista." : "Cada patch precisa de uma pista." };
  const k = puzzle.clues[inside[0]];
  if (k.area !== null && k.area !== w * h) return { ok: false, reason: `Essa pista pede área ${k.area}, mas o retângulo tem ${w * h}.` };
  if (!shapeOk(k.shape, w, h)) return { ok: false, reason: "O formato não bate com o ícone da pista." };
  return { ok: true, clue: inside[0] };
}
export const isSolved = patches => patches.reduce((sum, p) => sum + rectCells(...p.rect).length, 0) === TOTAL;

/* ===================== SOLVER ===================== */
/** Cobertura exata com backtracking: escolhe sempre a pista com menos retângulos possíveis. */
export function countSolutions(clues, limit = 2) {
  const clueCells = new Set(clues.map(k => k.cell));
  const cands = clues.map(k => {
    const out = [], r = (k.cell / N) | 0, c = k.cell % N;
    for (let h = 1; h <= N; h++) for (let w = 1; w <= N; w++) {
      if ((k.area !== null && w * h !== k.area) || !shapeOk(k.shape, w, h)) continue;
      for (let r0 = Math.max(0, r - h + 1); r0 <= Math.min(r, N - h); r0++)
        for (let c0 = Math.max(0, c - w + 1); c0 <= Math.min(c, N - w); c0++) {
          const cells = rectCells(r0, c0, r0 + h - 1, c0 + w - 1);
          if (cells.every(x => x === k.cell || !clueCells.has(x))) out.push(cells);
        }
    }
    return out;
  });
  const covered = new Array(TOTAL).fill(false), used = new Array(clues.length).fill(false);
  let count = 0, nodes = 0;
  const go = left => {
    if (count >= limit) return;
    if (++nodes > 200000) { count = limit; return; }   // orçamento: fase não provada como única é descartada
    if (left === 0) { count++; return; }
    let best = -1, list = null;
    for (let i = 0; i < clues.length; i++) {
      if (used[i]) continue;
      const fit = cands[i].filter(cells => cells.every(x => !covered[x]));
      if (!fit.length) return;                                    // poda: pista sem opção
      if (!list || fit.length < list.length) { best = i; list = fit; if (fit.length === 1) break; }
    }
    if (best < 0) return;
    used[best] = true;
    for (const cells of list) {
      cells.forEach(x => (covered[x] = true));
      go(left - cells.length);
      cells.forEach(x => (covered[x] = false));
    }
    used[best] = false;
  };
  go(TOTAL);
  return count;
}

/* ===================== GERADOR ===================== */
/** Particiona a grade em retângulos, sempre ancorando na primeira célula livre. */
export function randomPartition(rand) {
  const owned = new Array(TOTAL).fill(false), rects = [];
  for (let i = 0; i < TOTAL; i++) {
    if (owned[i]) continue;
    const r = (i / N) | 0, c = i % N, opts = [];
    for (let h = 1; h <= Math.min(4, N - r); h++) for (let w = 1; w <= Math.min(5, N - c); w++) {
      if (w * h > 8 || !rectCells(r, c, r + h - 1, c + w - 1).every(x => !owned[x])) continue;
      opts.push({ w, h, weight: w * h === 1 ? 0.4 : w * h <= 6 ? 3 : 1 });
    }
    let roll = rand() * opts.reduce((s, o) => s + o.weight, 0), pick = opts[0];
    for (const o of opts) { roll -= o.weight; if (roll <= 0) { pick = o; break; } }
    rects.push([r, c, r + pick.h - 1, c + pick.w - 1]);
    rectCells(...rects[rects.length - 1]).forEach(x => (owned[x] = true));
  }
  return rects;
}

/** Sorteia pistas para a partição; as primeiras tentativas usam dicas "soltas" (ícone qualquer, sem número). */
export function generatePuzzle(rand, level) {
  setSize(level.n);
  for (;;) {
    const rects = randomPartition(rand);
    for (let attempt = 0; attempt < 28; attempt++) {
      const f = 1 - attempt / 56;                   // a cada tentativa as dicas ficam um pouco mais completas
      const clues = rects.map(([r0, c0, r1, c1]) => {
        const w = c1 - c0 + 1, h = r1 - r0 + 1, big = w * h > 1;
        const cell = (r0 + Math.floor(rand() * h)) * N + c0 + Math.floor(rand() * w);
        let shape = w === h ? "square" : w > h ? "wide" : "tall";
        if (big && rand() < level.pAny * f) shape = "any";
        return { cell, area: big && rand() < level.pNull * f ? null : w * h, shape };
      });
      if (countSolutions(clues) === 1) return { clues };
    }
  }
}

