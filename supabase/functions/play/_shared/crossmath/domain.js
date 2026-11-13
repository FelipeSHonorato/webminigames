/* Regras, solver e gerador do CrossMath: código puro, sem DOM (testável no Node e reutilizado pela Edge).

   Regras: uma grade de equações cruzadas. Cada equação é lida DA ESQUERDA PARA A DIREITA (e de cima para
   baixo, nas verticais), no formato `a op b = r` (5 casas) ou `a op b op c = r` (7 casas). Algumas casas de
   número já vêm preenchidas; as demais são buracos, preenchidos com os números do banco (cada número do banco
   é usado uma vez).

   Operadores (cada nível herda os do anterior e ganha um novo):
     Fácil   + −
     Médio   + − × ÷   (a divisão precisa ser exata)
     Difícil + − × ÷ % (a % b = a × b ÷ 100, só se der inteiro: 50 % 20 = 10, "20% de 50" ou "50% de 20")
     Genius  + − × ÷ % ^ (a ^ b = a elevado a b: 2 ^ 5 = 32)
   Como as demais, % e ^ são lidas da esquerda para a direita, sem precedência.

   Geração:
     1. sorteia um cruzamento de equações (uma primeira na horizontal/vertical e outras perpendiculares a
        casas de número já existentes), escolhendo os valores na hora em que cada equação é colocada;
     2. recorta as margens vazias;
     3. tira números das casas (no máximo 2 por equação) mantendo a solução ÚNICA, provada pelo solver;
     4. embaralha os números tirados para formar o banco.

   `isSolved` é a única regra de vitória — a mesma na tela e no servidor. Ela só precisa das casas, das
   equações e do banco, que estão na visão pública; o navegador sabe sozinho que venceu. */

/* `max` é o teto de qualquer casa; `pick` é até onde o sorteio vai buscar operandos novos (a aritmética comum
   continua leve). `ops` são os operadores permitidos no nível (só esses aparecem) e toda fase traz pelo menos
   uma conta de cada um dos "fortes" (× ÷ % ^). `intro` são os que o nível estreia: pesam o dobro no sorteio.
   `strong` é a chance de uma equação trazer uma conta além de + e −. */
export const LEVELS = [
  { name: "Fácil",   w: 6,  h: 6,  max: 9,   pick: 9,  lengths: [5],    ops: ["+", "−"],                     intro: [], strong: 0,           eqs: 6,  minEqs: 5, blanks: 6,  maxBlanksPerEq: 2, tryLimit: 80, nodeLimit: 60000,  layoutTries: 80 },
  { name: "Médio",   w: 7,  h: 7,  max: 12,  pick: 12, lengths: [5],    ops: ["+", "−", "×", "÷"],           intro: ["×", "÷"], strong: 0.35,   eqs: 7,  minEqs: 6, blanks: 8,  maxBlanksPerEq: 2, tryLimit: 80, nodeLimit: 80000,  layoutTries: 100 },
  { name: "Difícil", w: 8,  h: 8,  max: 50,  pick: 16, lengths: [5, 7], ops: ["+", "−", "×", "÷", "%"],      intro: ["%"], strong: 0.55,        eqs: 8,  minEqs: 7, blanks: 9,  maxBlanksPerEq: 2, tryLimit: 70, nodeLimit: 100000, layoutTries: 140 },
  { name: "Genius",  w: 10, h: 10, max: 100, pick: 20, lengths: [5, 7], ops: ["+", "−", "×", "÷", "%", "^"], intro: ["^"], strong: 0.65,        eqs: 10, minEqs: 9, blanks: 12, maxBlanksPerEq: 2, tryLimit: 70, nodeLimit: 140000, layoutTries: 220 },
];

/** Versão do gerador: gravada na fase salva. AUMENTE ao mudar o sorteio. */
export const GEN = 2;
export const STORE_KEY = "crossmath.wins";
export const MIN_BLANKS = 4;

const shuffle = (rng, arr) => {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
};
const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

export const isNumber = c => !!c && c.t === "n";
const numberCellsOf = eq => eq.filter((_, k) => k % 2 === 0); // posições pares da equação são números

/* ============================== regras ============================== */

/** Potência inteira exata; `null` se não for um inteiro seguro (evita estouro e perda de precisão). */
function ipow(base, exp) {
  if (!Number.isInteger(exp) || exp < 0) return null;
  if (base === 0 || base === 1) return exp === 0 ? 1 : base;
  if (base === -1) return exp % 2 === 0 ? 1 : -1;
  let r = 1;
  for (let i = 0; i < exp; i++) {            // |base| ≥ 2: estoura (e sai) em até ~53 voltas
    r *= base;
    if (!Number.isSafeInteger(r)) return null;
  }
  return r;
}

/** Aplica `acc op b`. Devolve `null` quando a conta não dá um inteiro (divisão/percentual inexatos, estouro). */
export function applyOp(acc, op, b) {
  if (!Number.isInteger(acc) || !Number.isInteger(b)) return null;
  switch (op) {
    case "+": return acc + b;
    case "−": return acc - b;
    case "×": return acc * b;
    case "÷": return !b || acc % b !== 0 ? null : acc / b;
    case "%": return (acc * b) % 100 !== 0 ? null : (acc * b) / 100;   // a % b = a × b ÷ 100 (simétrico)
    case "^": return ipow(acc, b);
    default: return null;
  }
}

/** Avalia a equação (números e operadores em ordem, da esquerda para a direita). Devolve `null` se inválida. */
function evaluate(cells, eq, valueOf) {
  const nums = numberCellsOf(eq);
  const operands = nums.slice(0, -1);
  let acc = valueOf(operands[0]);
  if (!Number.isInteger(acc)) return null;
  for (let k = 1; k < operands.length; k++) {
    const op = cells[eq[2 * k - 1]]?.v;
    const b = valueOf(operands[k]);
    if (!Number.isInteger(b)) return null;
    acc = applyOp(acc, op, b);
    if (acc == null) return null;
  }
  return acc;
}

/** Multiconjunto dos valores dos buracos é exatamente o do banco? */
function bankMatches(p, valueOf) {
  const have = new Map();
  for (const cell of p.nums) {
    if (p.cells[cell].v != null) continue;
    const v = valueOf(cell);
    if (!Number.isInteger(v)) return false;
    have.set(v, (have.get(v) ?? 0) + 1);
  }
  const want = new Map();
  for (const v of p.bank) want.set(v, (want.get(v) ?? 0) + 1);
  if (have.size !== want.size) return false;
  for (const [v, n] of want) if (have.get(v) !== n) return false;
  return true;
}

/** Vitória: todas as casas preenchidas com o banco, dadas respeitadas e todas as equações verdadeiras. */
export function isSolved(p, data) {
  const values = data?.nums;
  if (!Array.isArray(values) || values.length !== p.nums.length) return false;
  const byCell = new Map();
  for (let i = 0; i < p.nums.length; i++) {
    const v = values[i];
    if (!Number.isInteger(v) || v < 1 || v > p.max) return false;
    byCell.set(p.nums[i], v);
  }
  for (const cell of p.nums) {
    const given = p.cells[cell].v;
    if (given != null && byCell.get(cell) !== given) return false;
  }
  const valueOf = cell => byCell.get(cell);
  if (!bankMatches(p, valueOf)) return false;
  for (const eq of p.eqs) {
    const nums = numberCellsOf(eq);
    if (evaluate(p.cells, eq, valueOf) !== byCell.get(nums[nums.length - 1])) return false;
  }
  return true;
}

/** Casas de equações já completas que não fecham (destaque da UI). Não decide vitória. */
export function wrongCells(p, data) {
  const values = Array.isArray(data?.nums) ? data.nums : [];
  const byCell = new Map();
  p.nums.forEach((cell, i) => {
    const v = values[i];
    if (Number.isInteger(v) && v >= 1 && v <= p.max) byCell.set(cell, v);
  });
  const valueOf = cell => (byCell.has(cell) ? byCell.get(cell) : p.cells[cell]?.v);
  const out = new Set();
  for (const eq of p.eqs) {
    const nums = numberCellsOf(eq);
    const filled = nums.every(cell => Number.isInteger(valueOf(cell)));
    if (!filled) continue;
    if (evaluate(p.cells, eq, valueOf) !== valueOf(nums[nums.length - 1])) {
      for (const cell of eq) out.add(cell);
    }
  }
  return out;
}

/** Estado do tabuleiro a partir do que a UI tem na tela (casa de número → valor ou null). */
export function stateOf(p, valuesByCell) {
  return { nums: p.nums.map(cell => valuesByCell.get(cell) ?? 0) };
}

/* ============================== solver ============================== */

/** Conta soluções (até `limit`) para a fase com os buracos atuais. `exhausted` = estourou o orçamento. */
export function countSolutions(p, limit = 2, nodeLimit = 200000) {
  const blanks = p.nums.filter(cell => p.cells[cell].v == null);
  const solByCell = new Map();
  for (let i = 0; i < p.nums.length; i++) solByCell.set(p.nums[i], p.solution[i]);

  const eqNumbers = p.eqs.map(numberCellsOf);
  const cellEqs = new Map(blanks.map(cell => [cell, []]));
  p.eqs.forEach((eq, ei) => {
    for (const cell of eqNumbers[ei]) if (cellEqs.has(cell)) cellEqs.get(cell).push(ei);
  });

  const remaining = new Map();
  for (const v of p.bank) remaining.set(v, (remaining.get(v) ?? 0) + 1);
  const assign = new Map();
  let solutions = 0, nodes = 0, exhausted = false;

  const valueOf = cell => (assign.has(cell) ? assign.get(cell) : p.cells[cell].v);
  const distinct = () => [...remaining.keys()].filter(v => remaining.get(v) > 0).sort((a, b) => a - b);

  /** A equação ainda pode ser completada com os valores que restam? */
  const feasible = ei => {
    const eq = p.eqs[ei];
    const nums = eqNumbers[ei];
    const unknown = nums.filter(cell => cellEqs.has(cell) && !assign.has(cell));
    const vals = distinct();
    if (unknown.length === 0) {
      return evaluate(p.cells, eq, valueOf) === valueOf(nums[nums.length - 1]);
    }
    if (unknown.length === 1) {
      const cell = unknown[0];
      for (const v of vals) {
        if (remaining.get(v) <= 0) continue;
        assign.set(cell, v); remaining.set(v, remaining.get(v) - 1);
        const ok = evaluate(p.cells, eq, valueOf) === valueOf(nums[nums.length - 1]);
        assign.delete(cell); remaining.set(v, remaining.get(v) + 1);
        if (ok) return true;
      }
      return false;
    }
    if (unknown.length === 2) {
      const [a, b] = unknown;
      for (const va of vals) {
        if (remaining.get(va) <= 0) continue;
        assign.set(a, va); remaining.set(va, remaining.get(va) - 1);
        for (const vb of distinct()) {
          if (remaining.get(vb) <= 0) continue;
          assign.set(b, vb); remaining.set(vb, remaining.get(vb) - 1);
          const ok = evaluate(p.cells, eq, valueOf) === valueOf(nums[nums.length - 1]);
          assign.delete(b); remaining.set(vb, remaining.get(vb) + 1);
          if (ok) { assign.delete(a); remaining.set(va, remaining.get(va) + 1); return true; }
        }
        assign.delete(a); remaining.set(va, remaining.get(va) + 1);
      }
      return false;
    }
    return true; // o gerador nunca deixa mais de 2 buracos numa equação; aqui é só uma poda extra
  };

  const allFeasible = () => {
    for (let ei = 0; ei < p.eqs.length; ei++) if (!feasible(ei)) return false;
    return true;
  };

  const search = () => {
    if (exhausted || solutions >= limit) return;
    if (++nodes > nodeLimit) { exhausted = true; return; }
    if (assign.size === blanks.length) {
      if (allFeasible()) solutions++;
      return;
    }
    /* Escolhe a casa com menos valores possíveis (forward checking). */
    let best = -1, bestVals = null;
    for (const cell of blanks) {
      if (assign.has(cell)) continue;
      const allowed = [];
      for (const v of distinct()) {
        if (remaining.get(v) <= 0) continue;
        assign.set(cell, v); remaining.set(v, remaining.get(v) - 1);
        let ok = true;
        for (const ei of cellEqs.get(cell)) if (!feasible(ei)) { ok = false; break; }
        assign.delete(cell); remaining.set(v, remaining.get(v) + 1);
        if (ok) allowed.push(v);
      }
      if (!allowed.length) return;
      if (!bestVals || allowed.length < bestVals.length) {
        best = cell; bestVals = allowed;
        if (allowed.length === 1) break;
      }
    }
    if (best < 0) return;
    for (const v of bestVals) {
      assign.set(best, v); remaining.set(v, remaining.get(v) - 1);
      search();
      assign.delete(best); remaining.set(v, remaining.get(v) + 1);
      if (exhausted || solutions >= limit) return;
    }
  };

  search();
  return { solutions, exhausted };
}

/** Inspeção/teste: a fase admite exatamente a solução pretendida? */
export function isUnique(p, nodeLimit = 300000) {
  const { solutions, exhausted } = countSolutions(p, 2, nodeLimit);
  return !exhausted && solutions === 1;
}

/* ============================== gerador ============================== */

/** Maior expoente sorteado (2 a 6): 2^6 = 64 e 3^4 = 81 cabem no teto do Genius. */
const EXP_MAX = 6;

/** Escolhe os operadores: base +/−, com no máximo uma conta "forte" (×, ÷, %, ^) por equação.
    Os operadores que o nível estreia (`level.intro`) pesam o dobro no sorteio. */
function chooseOps(rng, level, count) {
  const ops = [];
  for (let i = 0; i < count; i++) ops.push(level.ops[rng() < 0.5 ? 0 : 1] ?? "+");
  const fancy = level.ops.slice(2);
  if (fancy.length && rng() < level.strong) {
    const bag = fancy.flatMap(op => (level.intro.includes(op) ? [op, op] : [op]));
    ops[randInt(rng, 0, count - 1)] = bag[randInt(rng, 0, bag.length - 1)];
  }
  return ops;
}

/** Conta com graça: sem × ou ÷ por 1, sem 1 ^ b nem a ^ 1 e sem percentual de 100 (que devolve o próprio número).
    Vale para todo operando — inclusive os já fixados por cruzamentos —, só no gerador: o jogador pode, na
    solução dele, encaixar qualquer conta correta. */
export function isNice(op, a, b) {
  switch (op) {
    case "×": return a >= 2 && b >= 2;
    case "÷": return b >= 2;
    case "%": return a >= 1 && a <= 99 && b >= 1 && b <= 99;
    case "^": return a >= 2 && b >= 2 && b <= EXP_MAX;
    default: return true;
  }
}

/** Operandos que podem seguir `acc op _`: só o que a conta aceita (exata e com graça). Na última conta da
    equação o resultado também precisa caber em 1..max (e bater com `fixed`). */
function operandChoices(level, acc, op, last, fixed) {
  const hi = op === "^" ? Math.min(EXP_MAX, level.max) : op === "%" ? Math.min(99, level.max) : level.pick;
  const out = [];
  for (let v = 1; v <= hi; v++) {
    if (!isNice(op, acc, v)) continue;
    const r = applyOp(acc, op, v);
    if (r == null) continue;
    if (last && (r < 1 || r > level.max || (fixed != null && r !== fixed))) continue;
    out.push(v);
  }
  return out;
}

/** Valores de uma equação nova: sorteia as parcelas e calcula o resultado. `fixed` exige um resultado. */
function fillValues(rng, level, existing, ops, fixed = null) {
  const operands = existing.length; // operandos (o resultado vem depois)
  /* O sorteio já é guiado pela conta; sem nada a sortear (tudo fixo pelos cruzamentos) uma tentativa basta. */
  const attempts = existing.every(v => v != null) ? 1 : 60;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const values = [existing[0] ?? randInt(rng, 1, level.pick)];
    let acc = values[0];
    for (let k = 1; k < operands && acc != null; k++) {
      const op = ops[k - 1], last = k === operands - 1;
      let b = existing[k];
      if (b != null && !isNice(op, acc, b)) { acc = null; break; }   // operando fixo por cruzamento também vale
      if (b == null) {
        const choices = operandChoices(level, acc, op, last, fixed);
        if (!choices.length) { acc = null; break; }
        b = choices[randInt(rng, 0, choices.length - 1)];
      }
      values.push(b);
      acc = applyOp(acc, op, b);
    }
    if (acc == null || acc < 1 || acc > level.max) continue;
    if (fixed != null && acc !== fixed) continue;
    return [...values, acc];
  }
  return null;
}

/** Tenta colocar uma equação que atravessa `cross` numa direção, começando `offset` casas antes. */
function tryPlace(rng, level, cells, eqs, dirs, cross, dir, len, offset, first = false) {
  const w = level.w, h = level.h;
  const cr = Math.floor(cross / w), cc = cross % w;
  const startR = dir === "v" ? cr - offset : cr;
  const startC = dir === "h" ? cc - offset : cc;
  if (startR < 0 || startC < 0) return null;
  if (dir === "h" && startC + len > w) return null;
  if (dir === "v" && startR + len > h) return null;

  const eq = [];
  for (let k = 0; k < len; k++) eq.push(dir === "h" ? startR * w + startC + k : (startR + k) * w + startC);

  /* Papéis: pares são números; ímpares são operadores, menos a posição do "=" (len-2). */
  for (let k = 0; k < len; k++) {
    const cell = eq[k];
    const num = k % 2 === 0;
    if (num) {
      if (cells[cell] && !isNumber(cells[cell])) return null;
    } else if (k === len - 2) {
      if (cells[cell] && cells[cell].t !== "e") return null; // o "=" pode ser compartilhado
    } else if (cells[cell] && cells[cell].t !== "o") return null; // operador pode ser compartilhado
  }
  if (!first && !isNumber(cells[cross])) return null;
  if (first && eq[offset] !== cross) return null;

  const numCount = (len + 1) / 2;
  const existing = [];
  for (let k = 0; k < numCount - 1; k++) {
    const cell = eq[2 * k];
    existing.push(isNumber(cells[cell]) ? cells[cell].v : null);
  }
  const resultCell = eq[len - 1];
  const fixed = isNumber(cells[resultCell]) ? cells[resultCell].v : null;
  const ops = chooseOps(rng, level, numCount - 1);
  /* Cruzamentos com operadores já postos têm de repetir o mesmo símbolo. */
  for (let k = 0; k < ops.length; k++) {
    const cell = eq[2 * k + 1];
    if (cells[cell]?.t === "o") ops[k] = cells[cell].v;
  }
  const values = fillValues(rng, level, existing, ops, fixed);
  if (!values) return null;

  /* Monta a equação inteira antes de gravar: nada de deixar casas pela metade se houver conflito. */
  const pending = [];
  for (let k = 0; k < len; k++) {
    const cell = eq[k];
    let next;
    if (k % 2 === 0) next = { t: "n", v: values[k / 2] };
    else if (k === len - 2) next = { t: "e" };
    else next = { t: "o", v: ops[(k - 1) / 2] };
    const cur = cells[cell];
    if (cur && (cur.t !== next.t || cur.v !== next.v)) return null;
    pending.push([cell, next]);
  }

  /* Grava a equação (sem tocar no que já existia). */
  for (const [cell, next] of pending) if (!cells[cell]) cells[cell] = next;
  eqs.push(eq);
  for (const cell of eq) {
    if (!isNumber(cells[cell])) continue;
    if (!dirs.has(cell)) dirs.set(cell, new Set());
    dirs.get(cell).add(dir);
  }
  return eq;
}

function buildLayout(rng, level) {
  const w = level.w, h = level.h;
  const cells = new Array(w * h).fill(null);
  const eqs = [], dirs = new Map();
  const rowRanges = new Map(), colRanges = new Map();

  const rangesOf = (dir, line) => (dir === "h" ? rowRanges : colRanges).get(line) ?? [];
  const lineFree = (dir, line, start, len) => {
    const end = start + len - 1;
    return rangesOf(dir, line).every(([a, b]) => end < a - 1 || start > b + 1);
  };
  const addRange = (dir, line, start, len) => {
    const map = dir === "h" ? rowRanges : colRanges;
    if (!map.has(line)) map.set(line, []);
    map.get(line).push([start, start + len - 1]);
  };

  const placeAt = (cross, dir, len, offset, first = false) => {
    const cr = Math.floor(cross / w), cc = cross % w;
    const start = dir === "h" ? cc - offset : cr - offset;
    const line = dir === "h" ? cr : cc;
    if (start < 0) return null;
    if (start + len > (dir === "h" ? w : h)) return null;
    if (!lineFree(dir, line, start, len)) return null;
    const eq = tryPlace(rng, level, cells, eqs, dirs, cross, dir, len, offset, first);
    if (!eq) return null;
    addRange(dir, line, start, len);
    return eq;
  };

  /* 1ª equação: numa linha/coluna livre, inteira dentro da grade. */
  const lengths = level.lengths.slice();
  let first = null;
  for (let attempt = 0; attempt < 80 && !first; attempt++) {
    const dir = rng() < 0.5 ? "h" : "v";
    const len = lengths[randInt(rng, 0, lengths.length - 1)];
    const maxStart = (dir === "h" ? w : h) - len;
    if (maxStart < 0) continue;
    const start = randInt(rng, 0, maxStart);
    const line = randInt(rng, 0, (dir === "h" ? h : w) - 1);
    const cross = dir === "h" ? line * w + start : start * w + line;
    first = placeAt(cross, dir, len, 0, true);
  }
  if (!first) return null;

  /* Demais equações: perpendiculares a uma casa de número já existente. */
  for (let step = 0; step < level.layoutTries && eqs.length < level.eqs; step++) {
    const candidates = [];
    for (const [cell, set] of dirs) {
      if (set.size >= 2) continue;
      const dir = set.has("h") ? "v" : set.has("v") ? "h" : (rng() < 0.5 ? "h" : "v");
      const line = dir === "h" ? Math.floor(cell / w) : cell % w;
      const c = dir === "h" ? cell % w : Math.floor(cell / w);
      /* Cada linha só hospeda uma equação (duas não cabem com folga de 1 casa). */
      if (rangesOf(dir, line).length >= 1) continue;
      if (!lineFree(dir, line, c, 1)) continue;
      candidates.push([cell, dir]);
    }
    if (!candidates.length) break;
    const [cell, dir] = candidates[randInt(rng, 0, candidates.length - 1)];
    const c = dir === "h" ? cell % w : Math.floor(cell / w);
    const len = lengths[randInt(rng, 0, lengths.length - 1)];
    const offsets = [];
    for (let k = 0; k < len; k += 2) {
      const start = c - k;
      if (start >= 0 && start + len <= (dir === "h" ? w : h)) offsets.push(k);
    }
    if (!offsets.length) continue;
    placeAt(cell, dir, len, offsets[randInt(rng, 0, offsets.length - 1)]);
  }
  if (eqs.length < level.minEqs) return null;
  return { w, h, cells, eqs, max: level.max };
}

/** Recorta as margens vazias e remapeia equações/casas. */
function crop(p) {
  let minR = p.h, maxR = -1, minC = p.w, maxC = -1;
  for (let r = 0; r < p.h; r++) for (let c = 0; c < p.w; c++) {
    if (!p.cells[r * p.w + c]) continue;
    if (r < minR) minR = r; if (r > maxR) maxR = r;
    if (c < minC) minC = c; if (c > maxC) maxC = c;
  }
  if (maxR < 0) return false;
  const w = maxC - minC + 1, h = maxR - minR + 1;
  const cells = new Array(w * h).fill(null);
  const remap = new Map();
  for (let r = minR; r <= maxR; r++) for (let c = minC; c <= maxC; c++) {
    const old = r * p.w + c, next = (r - minR) * w + (c - minC);
    cells[next] = p.cells[old];
    if (p.cells[old]) remap.set(old, next);
  }
  p.w = w; p.h = h; p.cells = cells;
  p.eqs = p.eqs.map(eq => eq.map(cell => remap.get(cell)));
  return true;
}

/** Números do banco (multiconjunto dos buracos), na ordem em que o jogador os vê. */
function bankOf(p, rng) {
  const vals = p.nums.filter(cell => p.cells[cell].v == null).map(cell => p.solutionByCell.get(cell));
  return shuffle(rng, vals);
}

/** Tira números das casas mantendo a solução única (no máximo `maxBlanksPerEq` por equação). */
function selectBlanks(rng, p, level) {
  const blankCount = new Map();
  const order = shuffle(rng, p.nums.slice());
  const chosen = [];
  for (const cell of order) {
    if (chosen.length >= level.blanks) break;
    const containing = p.eqs.filter(eq => eq.includes(cell));
    if (containing.some(eq => (blankCount.get(eq) ?? 0) >= level.maxBlanksPerEq)) continue;
    const saved = p.cells[cell].v;
    p.cells[cell].v = null;
    for (const eq of containing) blankCount.set(eq, (blankCount.get(eq) ?? 0) + 1);
    p.bank = bankOf(p, rng);
    const { solutions, exhausted } = countSolutions(p, 2, level.nodeLimit);
    if (!exhausted && solutions === 1) chosen.push(cell);
    else {
      p.cells[cell].v = saved;
      for (const eq of containing) blankCount.set(eq, blankCount.get(eq) - 1);
    }
  }
  p.bank = bankOf(p, rng);
  return chosen.length;
}

/** Layout recortado que traz pelo menos uma conta de cada operador forte do nível. Sortear layouts é barato;
    o que custa é o solver, então a exigência é resolvida aqui, antes de tirar números. */
function layoutWithStrongOps(rng, level) {
  const strong = level.ops.slice(2);
  for (let i = 0; i < 60; i++) {
    const p = buildLayout(rng, level);
    if (!p || !crop(p)) continue;
    if (strong.every(op => p.cells.some(c => c?.t === "o" && c.v === op))) return p;
  }
  return null;
}

/** Fase nova: `{ w, h, max, cells, nums, eqs, bank, solution }`. */
export function generatePuzzle(rng, level) {
  for (let attempt = 0; attempt < level.tryLimit; attempt++) {
    const p = layoutWithStrongOps(rng, level);
    if (!p) continue;
    p.max = level.max;
    p.nums = [];
    for (let i = 0; i < p.cells.length; i++) if (isNumber(p.cells[i])) p.nums.push(i);
    if (p.nums.length < 8) continue;
    p.solutionByCell = new Map(p.nums.map(cell => [cell, p.cells[cell].v]));
    p.solution = p.nums.map(cell => p.solutionByCell.get(cell));
    const blanks = selectBlanks(rng, p, level);
    const needBlanks = Math.max(MIN_BLANKS, Math.ceil(level.blanks * 0.75));
    if (blanks < needBlanks) continue;
    /* Segurança: a fase devolvida tem de ser única. */
    if (!isUnique(p, level.nodeLimit * 2)) continue;
    return p;
  }
  return fallback(rng, level);
}

/** Equação de segurança com o resultado em branco (sempre única), no operador mais novo do nível:
    [a, b, r] de cada operador. Só roda se o gerador esgotar as tentativas. */
const FALLBACK = {
  "%": [[20, 50, 10], [40, 50, 20], [50, 10, 5], [20, 25, 5], [40, 25, 10]],
  "^": [[2, 3, 8], [2, 4, 16], [3, 2, 9], [2, 5, 32], [3, 3, 27], [4, 2, 16], [5, 2, 25]],
  "÷": [[6, 2, 3], [8, 2, 4], [9, 3, 3], [12, 4, 3], [10, 2, 5]],
};

/** Rede de segurança: uma equação simples com o resultado em branco (sempre única). */
function fallback(rng, level) {
  const w = 5, h = 3;
  const cells = new Array(w * h).fill(null);
  const op = level.intro.at(-1) ?? "+";
  let a, b, r;
  if (FALLBACK[op]) {
    const options = FALLBACK[op].filter(([, , res]) => res <= level.max);
    [a, b, r] = options[randInt(rng, 0, options.length - 1)];
  } else {
    a = randInt(rng, 1, Math.min(5, level.max - 1));
    b = randInt(rng, 1, Math.max(1, level.max - a));
    r = a + b;
  }
  const eq = [0, 1, 2, 3, 4].map(k => 1 * w + k); // linha do meio
  [a, op, b, "=", r].forEach((v, k) => {
    if (k === 1) cells[eq[k]] = { t: "o", v };
    else if (k === 3) cells[eq[k]] = { t: "e" };
    else cells[eq[k]] = { t: "n", v };
  });
  const p = { w, h, cells, eqs: [eq], max: level.max, level };
  p.nums = eq.filter((_, k) => k % 2 === 0);
  p.solutionByCell = new Map(p.nums.map(cell => [cell, cells[cell].v]));
  p.solution = p.nums.map(cell => cells[cell].v);
  p.cells[eq[4]].v = null;
  p.bank = [r];
  return p;
}
