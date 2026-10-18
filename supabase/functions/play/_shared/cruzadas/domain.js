/* Regras e gerador das Palavras Cruzadas (cruzadinha brasileira): código puro, sem DOM (testável no Node).
   As dicas ficam dentro da grade, em casas próprias; a seta da dica diz onde a resposta começa e para onde segue. */
import { WORDS, normalize } from "./words.js";
import { POINTS_PER_LEVEL } from "../points.js";
export { normalize };

/* ===================== DOMÍNIO ===================== */
/* n: lado da grade (quadrada). maxLen: tamanho máximo das respostas (cabe na grade com a casa da dica).
   maxTwo / maxSigla: no máximo quantas respostas de 2 letras e quantas siglas (ex.: "Sigla do estado de...") uma fase pode ter.
   Sem esse limite, as respostas curtas fecham lacunas tão bem que passavam de 40% da grade e o jogo ficava repetitivo.
   minDouble / maxDouble: quantas casas de DUAS letras (marcadas com a diagonal \) uma fase tem, no mínimo e no máximo.
   attempts: quantas grades o gerador tenta até achar uma boa. A grade pequena gera em poucos ms, então o Fácil pode tentar mais vezes. */
export const LEVELS = [
  { name: "Fácil", n: 7, maxLen: 5, maxTwo: 2, maxSigla: 1, minDouble: 1, maxDouble: 2, attempts: 14 },
  { name: "Médio", n: 9, maxLen: 7, maxTwo: 3, maxSigla: 2, minDouble: 1, maxDouble: 3, attempts: 6 },
  { name: "Difícil", n: 11, maxLen: 9, maxTwo: 4, maxSigla: 2, minDouble: 2, maxDouble: 4, attempts: 5 },
  { name: "Genius", n: 13, maxLen: 11, maxTwo: 5, maxSigla: 3, minDouble: 3, maxDouble: 6, attempts: 5 },
];
/** Pares de letras que podem dividir uma casa (dígrafos do português). Uma casa de duas letras traz uma diagonal \ e pertence a uma só resposta. */
export const DIGRAPHS = ["CH", "LH", "NH", "RR", "SS", "QU", "GU"];
/** As formas de uma resposta na grade: [letra por casa] e, se tiver dígrafo, [com o dígrafo numa casa só]. Ex.: CHAVE → [C,H,A,V,E] e [CH,A,V,E]. */
export function cellForms(norm) {
  const forms = [[...norm]], packed = [];
  for (let i = 0; i < norm.length;) {
    const pair = norm.slice(i, i + 2);
    if (DIGRAPHS.includes(pair)) { packed.push(pair); i += 2; } else packed.push(norm[i++]);
  }
  if (packed.length < norm.length && packed.length >= 2) forms.push(packed);   // some a casa só se a resposta não virar uma única casa (ex.: a sigla RR)
  return forms;
}
/** Resposta que é uma sigla (estado, órgão...), para o limite por fase. */
export const isSigla = w => /^Sigla |\(sigla\)/.test(w.clue);
export const STORE_KEY = "cruzadas.wins";
/** Versão do gerador: gravada na fase salva. Mudar o sorteio muda as fases de uma mesma seed, então aumente ao mexer nele. */
export const GEN = 2;

/* As quatro setas. A casa da dica fica ao lado ou acima da primeira letra:
     R  →  dica à esquerda da 1ª letra, resposta na horizontal
     DR ↳  dica acima da 1ª letra, resposta na horizontal (seta desce e dobra para a direita)
     D  ↓  dica acima da 1ª letra, resposta na vertical
     RD ↴  dica à esquerda da 1ª letra, resposta na vertical (seta vai à direita e dobra para baixo)
   cr/cc: posição da casa da dica relativa à 1ª letra. fam: em casa com duas dicas, "top" usa a metade de cima (setas R e RD,
   que saem pela direita) e "bottom" a de baixo (setas D e DR, que saem por baixo). */
export const VARIANTS = {
  R: { dir: "across", cr: 0, cc: -1, fam: "top" },
  DR: { dir: "across", cr: -1, cc: 0, fam: "bottom" },
  D: { dir: "down", cr: -1, cc: 0, fam: "bottom" },
  RD: { dir: "down", cr: 0, cc: -1, fam: "top" },
};
const VARIANT_LIST = Object.entries(VARIANTS);

/* Fase: { n, cells: Cell[n*n], answers: Answer[] }
   Cell = { t: "L", ch, across: id|-1, down: id|-1 }  casa de letra; ch é a resposta certa: 1 letra, ou 2 numa casa com diagonal (aí só uma
                                                       das respostas, across ou down, passa por ela)
        | { t: "C", clues: [{ id, slot: "full"|"top"|"bottom" }] }  casa de dica (1 ou 2 dicas; com 2, a de cima vem primeiro)
        | { t: "B" }  casa sem uso (só cor)
   Answer = { id, norm, clue, dir: "across"|"down", variant, start, cells: number[], clueCell }
            norm é a palavra inteira; cells tem uma casa por letra, ou uma por dígrafo (então cells.length < norm.length). */

const rowOf = (n, i) => Math.floor(i / n), colOf = (n, i) => i % n;
const shuffle = (arr, rng) => {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
};

/* ----- Dicas e pontos ----- */
/** Máximo de dicas por fase: os pontos do nível menos 1 (Fácil 4, Médio 9, Difícil 14, Genius 19). Assim a fase vale sempre ao menos 1 ponto. */
export const maxHints = levelIdx => POINTS_PER_LEVEL[Math.max(0, Math.min(levelIdx, POINTS_PER_LEVEL.length - 1))] - 1;
/** Pontos da fase: base do nível menos 1 por dica, com piso de 1. */
export const pointsAfterHints = (base, hints) => Math.max(1, base - hints);

/* ===================== GERADOR ===================== */
const EMPTY = 0, LETTER = 1, CLUE = 2, WALL = 3;   // WALL: casa que não pode ter letra (fim/começo de uma resposta), mas pode virar casa de dica

/** Monta uma grade: começa por uma resposta no canto e vai acrescentando respostas que cruzam as já postas, até não caber mais nenhuma.
    Uma resposta só entra se (1) cruza ao menos uma letra existente, (2) tem casa de dica livre na posição da seta e
    (3) não cria sequência de letras sem dica (nenhuma letra nova encosta em letra de outra palavra, a não ser cruzando). */
function buildGrid(rng, level, pool) {
  const n = level.n, N = n * n;
  const kind = new Uint8Array(N), ch = new Array(N).fill(""), ownA = new Int16Array(N).fill(-1), ownD = new Int16Array(N).fill(-1);
  const clueAt = Array.from({ length: N }, () => []), answers = [], used = new Set();
  let twos = 0, siglas = 0, doubles = 0;
  const allowed = w => !(w.norm.length === 2 && twos >= level.maxTwo) && !(isSigla(w) && siglas >= level.maxSigla);

  /** Confere se `word`, na forma `form` (uma string por casa), cabe com a 1ª casa em (r, c) e a seta `vname`; devolve a jogada ou null. */
  const check = (word, form, r, c, vname, vt) => {
    const L = form.length, across = vt.dir === "across", dr = across ? 0 : 1, dc = across ? 1 : 0;
    const twoLetter = form.filter(x => x.length === 2).length;
    if (doubles + twoLetter > level.maxDouble) return null;
    if (r + dr * (L - 1) >= n || c + dc * (L - 1) >= n) return null;
    const cr = r + vt.cr, cc = c + vt.cc;
    if (cr < 0 || cc < 0) return null;                                        // a casa da dica precisa caber na grade
    const ci = cr * n + cc;
    if (kind[ci] === LETTER) return null;
    let shares = false;
    if (kind[ci] === CLUE) {                                                  // casa de dica já existente: aceita uma 2ª dica, de seta da outra metade
      if (clueAt[ci].length >= 2 || clueAt[ci][0].fam === vt.fam) return null;
      shares = true;
    }
    const br = r - dr, bc = c - dc;                                           // casa antes da 1ª letra: não pode ser letra
    if (br >= 0 && bc >= 0 && kind[br * n + bc] === LETTER) return null;
    const er = r + dr * L, ec = c + dc * L;                                   // casa depois da última letra: idem
    if (er < n && ec < n && kind[er * n + ec] === LETTER) return null;
    const cells = []; let overlaps = 0;
    for (let i = 0; i < L; i++) {
      const rr = r + dr * i, cc2 = c + dc * i, idx = rr * n + cc2, k = kind[idx];
      if (k === CLUE || k === WALL) return null;
      if (k === LETTER) {
        if (form[i].length === 2 || ch[idx].length === 2) return null;        // casa de duas letras não cruza com outra resposta
        if (ch[idx] !== form[i] || (across ? ownA[idx] : ownD[idx]) !== -1) return null;   // letra diferente, ou já é de outra resposta no mesmo sentido
        overlaps++;
      } else {                                                                // casa nova: não pode encostar de lado em outra letra (formaria palavra sem dica)
        const pr = dc, pc = dr;
        if (rr - pr >= 0 && cc2 - pc >= 0 && kind[(rr - pr) * n + cc2 - pc] === LETTER) return null;
        if (rr + pr < n && cc2 + pc < n && kind[(rr + pr) * n + cc2 + pc] === LETTER) return null;
      }
      cells.push(idx);
    }
    return { word, form, twoLetter, vname, vt, cells, overlaps, shares, ci, before: br >= 0 && bc >= 0 ? br * n + bc : -1, after: er < n && ec < n ? er * n + ec : -1 };
  };

  const commit = m => {
    const id = answers.length, across = m.vt.dir === "across";
    kind[m.ci] = CLUE; clueAt[m.ci].push({ id, fam: m.vt.fam });
    for (const b of [m.before, m.after]) if (b >= 0 && kind[b] === EMPTY) kind[b] = WALL;
    m.cells.forEach((idx, i) => { kind[idx] = LETTER; ch[idx] = m.form[i]; (across ? ownA : ownD)[idx] = id; });
    answers.push({ id, norm: m.word.norm, clue: m.word.clue, dir: m.vt.dir, variant: m.vname, start: m.cells[0], cells: m.cells, clueCell: m.ci });
    used.add(m.word.norm);
    if (m.word.norm.length === 2) twos++;
    if (isSigla(m.word)) siglas++;
    doubles += m.twoLetter;
  };

  /* A primeira resposta fica no miolo da grade (dica na coluna 0): numa borda nenhuma resposta vertical poderia cruzá-la,
     porque faltaria lugar para a casa da dica acima. */
  const first = pool.filter(w => w.norm.length >= Math.min(4, level.maxLen) && w.norm.length <= level.maxLen);
  const f0 = first[Math.floor(rng() * first.length)];
  commit(check(f0, f0.forms[0], 2 + Math.floor(rng() * (n - 4)), 1, "R", VARIANTS.R));

  const bestOf = words => {
    let best = null, bestScore = -1;
    for (const w of words) for (const form of w.forms) for (const [vname, vt] of VARIANT_LIST) {
      if (!allowed(w)) continue;
      const maxR = n - 1 - (vt.dir === "down" ? form.length - 1 : 0), maxC = n - 1 - (vt.dir === "across" ? form.length - 1 : 0);
      for (let r = 0; r <= maxR; r++) for (let c = 0; c <= maxC; c++) {
        const m = check(w, form, r, c, vname, vt);
        if (!m || m.overlaps < 1) continue;                                   // toda resposta cruza ao menos uma letra
        /* prefere cruzar mais, aproveitar casas de dica e palavras maiores; as formas com dígrafo só ganham bônus até a fase ter o mínimo de casas de duas letras */
        const score = m.overlaps * 4 + (m.shares ? 3 : 0) + w.norm.length * 0.5 + (m.twoLetter && doubles < level.minDouble ? 6 : 0) + rng() * 2;
        if (score > bestScore) { bestScore = score; best = m; }
      }
    }
    return best;
  };
  let full = false;
  for (let round = 0; round < 400; round++) {
    const avail = pool.filter(w => !used.has(w.norm) && allowed(w)), sample = full ? avail : shuffle([...avail], rng).slice(0, 40);
    const m = bestOf(sample);
    if (m) { commit(m); full = false; } else if (full || sample.length === avail.length) break; else full = true;   // sem sorteio que sirva: tenta o vocabulário inteiro uma vez
  }

  const cells = Array.from({ length: N }, (_, i) => {
    if (kind[i] === LETTER) return { t: "L", ch: ch[i], across: ownA[i], down: ownD[i] };
    if (kind[i] === CLUE) {
      const cl = clueAt[i];
      /* Numa casa com duas dicas, a de cima (setas que saem pela direita) vem ANTES da de baixo (setas que saem por baixo). Na ordem em
         que foram criadas, a seta de uma metade caía em cima da outra. */
      const clues = cl.map(c => ({ id: c.id, slot: cl.length === 1 ? "full" : c.fam })).sort((a, b) => (a.slot === "bottom") - (b.slot === "bottom"));
      return { t: "C", clues };
    }
    return { t: "B" };
  });
  return { n, cells, answers };
}

/** Fase a partir de uma seed (via rng) e de um nível. Tenta até `attempts` grades e para na primeira com densidade boa
    (`goodFill`, a fração de casas com letra) e com as casas de duas letras do nível; se nenhuma chegar lá, fica com a melhor. O caso comum é rápido, e as
    grades ralas, que existiam com um número fixo de tentativas, são descartadas. */
export function generatePuzzle(rng, level, attempts = level.attempts ?? 5, goodFill = 0.46) {
  const pool = WORDS.filter(w => w.norm.length <= level.maxLen).map(w => ({ ...w, forms: cellForms(w.norm) }));
  let best = null, bestFill = -1;
  for (let a = 0; a < attempts; a++) {
    const p = buildGrid(rng, level, pool), fill = p.cells.filter(c => c.t === "L").length / p.cells.length;
    const twoLetter = p.cells.filter(c => c.t === "L" && c.ch.length === 2).length;
    const quality = fill + (twoLetter >= level.minDouble ? 1 : 0);          // fase com as casas de duas letras que o nível pede vale mais que uma só densa
    if (quality > bestFill) { best = p; bestFill = quality; }
    if (bestFill >= goodFill + 1) break;
  }
  return best;
}

/* ===================== VALIDADOR ===================== */
/** Reanalisa uma fase pronta, do zero, e devolve a lista de problemas (vazia = fase válida). Usado nos testes. */
export function validatePuzzle(p) {
  const { n, cells, answers } = p, bad = [], at = (r, c) => (r >= 0 && c >= 0 && r < n && c < n ? cells[r * n + c] : null);
  const isL = (r, c) => at(r, c)?.t === "L";
  for (const a of answers) {
    const vt = VARIANTS[a.variant], across = a.dir === "across";
    if (!vt || vt.dir !== a.dir) { bad.push(`${a.norm}: seta/sentido inconsistentes`); continue; }
    if (a.cells.map(idx => cells[idx]?.ch ?? "?").join("") !== a.norm) bad.push(`${a.norm}: as letras das casas não formam a resposta`);
    a.cells.forEach((idx, i) => {
      const c = cells[idx];
      if (c.t !== "L") bad.push(`${a.norm}: casa ${i} não é de letra`);
      if (i && idx !== a.cells[i - 1] + (across ? 1 : n)) bad.push(`${a.norm}: células não consecutivas`);
      if ((across ? c.across : c.down) !== a.id) bad.push(`${a.norm}: célula sem a referência da resposta`);
    });
    const s = a.start, sr = rowOf(n, s), sc = colOf(n, s), cc = cells[a.clueCell];
    if (a.clueCell !== (sr + vt.cr) * n + sc + vt.cc) bad.push(`${a.norm}: casa da dica fora do lugar da seta`);
    if (cc.t !== "C" || !cc.clues.some(x => x.id === a.id)) bad.push(`${a.norm}: casa da dica não tem esta dica`);
    if (isL(sr - (across ? 0 : 1), sc - (across ? 1 : 0)) ) bad.push(`${a.norm}: letra antes do começo`);
    const last = a.cells.at(-1);
    if (isL(rowOf(n, last) + (across ? 0 : 1), colOf(n, last) + (across ? 1 : 0))) bad.push(`${a.norm}: letra depois do fim`);
  }
  for (const c of cells) if (c.t === "C") {
    if (c.clues.length < 1 || c.clues.length > 2) bad.push("casa de dica com quantidade inválida de dicas");
    if (c.clues.length === 2) {
      const fams = c.clues.map(x => VARIANTS[answers[x.id]?.variant]?.fam);
      if (fams[0] === fams[1]) bad.push("casa com duas dicas na mesma metade (ou de resposta inexistente)");
      if (c.clues[0].slot !== "top" || c.clues[1].slot !== "bottom") bad.push("casa com duas dicas fora de ordem: a de cima (seta pela direita) deve vir antes da de baixo");
    }
    for (const x of c.clues) if (x.slot !== (c.clues.length === 1 ? "full" : VARIANTS[answers[x.id]?.variant]?.fam)) bad.push("dica na metade errada da casa");
  }
  for (const [i, c] of cells.entries()) if (c.t === "L") {
    if (c.ch.length < 1 || c.ch.length > 2 || !/^[A-Z]+$/.test(c.ch)) bad.push(`casa ${i}: conteúdo inválido (${c.ch})`);
    if (c.ch.length === 2 && !DIGRAPHS.includes(c.ch)) bad.push(`casa ${i}: duas letras que não formam um dígrafo (${c.ch})`);
    if (c.ch.length === 2 && c.across >= 0 && c.down >= 0) bad.push(`casa ${i}: casa de duas letras não pode ser cruzamento`);
  }
  /* Toda sequência de 2+ letras (na linha ou na coluna) tem de ser exatamente uma resposta; toda letra pertence a alguma. */
  const runs = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!isL(r, c)) continue;
    if (!isL(r, c - 1) && isL(r, c + 1)) { const run = []; for (let k = c; isL(r, k); k++) run.push(r * n + k); runs.push(["across", run]); }
    if (!isL(r - 1, c) && isL(r + 1, c)) { const run = []; for (let k = r; isL(k, c); k++) run.push(k * n + c); runs.push(["down", run]); }
  }
  for (const [dir, run] of runs) {
    const m = answers.filter(a => a.dir === dir && a.cells.length === run.length && a.cells.every((x, i) => x === run[i]));
    if (m.length !== 1) bad.push(`sequência de letras sem resposta única (${run.map(i => cells[i].ch).join("")})`);
  }
  cells.forEach((c, i) => {
    if (c.t !== "L") return;
    if (c.across < 0 && c.down < 0) bad.push(`letra solta na casa ${i}`);
    for (const [id, dir] of [[c.across, "across"], [c.down, "down"]]) if (id >= 0 && !(answers[id]?.dir === dir && answers[id].cells.includes(i))) bad.push(`casa ${i} aponta para uma resposta que não existe ou não passa por ela`);
  });
  /* Conectada: toda resposta se liga às outras por cruzamentos. */
  if (answers.length) {
    const seen = new Set([0]), queue = [0];
    while (queue.length) {
      const a = answers[queue.pop()];
      for (const idx of a.cells) for (const o of [cells[idx].across, cells[idx].down]) if (o >= 0 && answers[o] && !seen.has(o)) { seen.add(o); queue.push(o); }
    }
    if (seen.size !== answers.length) bad.push("grade desconexa");
  }
  return bad;
}

/* ===================== JOGADAS (puras) ===================== */
/* Estado do jogador: entries (string[n*n]: a letra digitada, "" se vazia; só vale nas casas de letra) e locked (Set: casas reveladas por dica). */
export const newEntries = puzzle => new Array(puzzle.n * puzzle.n).fill("");
export const answerById = (puzzle, id) => puzzle.answers[id];
export const letterCells = puzzle => puzzle.cells.flatMap((c, i) => (c.t === "L" ? [i] : []));

/** A letra A-Z de uma tecla (aceita acento e cedilha, que viram a letra base); null se não for letra. */
export function normalizeLetter(key) {
  if (typeof key !== "string" || [...key].length !== 1) return null;
  const up = normalize(key);
  return /^[A-Z]$/.test(up) ? up : null;
}
/** Quantas letras cabem na casa: 1, ou 2 numa casa com diagonal. */
export const cellCapacity = (puzzle, idx) => (puzzle.cells[idx]?.t === "L" ? puzzle.cells[idx].ch.length : 0);
/** Define o conteúdo digitado de uma casa de letra ("", 1 letra, ou 2 numa casa de duas letras), se ela não estiver travada por dica.
    Devolve outro array, ou o mesmo se nada mudou. */
export function setLetter(puzzle, entries, locked, idx, value) {
  const c = puzzle.cells[idx];
  if (c?.t !== "L" || locked.has(idx) || entries[idx] === value || value.length > c.ch.length) return entries;
  const next = [...entries];
  next[idx] = value;
  return next;
}
/** Digita uma letra na casa. Numa casa de duas letras, a 1ª letra abre a casa e a 2ª fecha (digitar com a casa cheia recomeça).
    `advance`: o cursor deve ir para a próxima casa (a casa ficou completa, ou estava travada por dica). */
export function typeInCell(puzzle, entries, locked, idx, letter) {
  const c = puzzle.cells[idx];
  if (c?.t !== "L") return { entries, advance: false };
  if (locked.has(idx)) return { entries, advance: true };
  const value = c.ch.length === 2 && entries[idx].length === 1 ? entries[idx] + letter : letter;
  return { entries: setLetter(puzzle, entries, locked, idx, value), advance: value.length === c.ch.length };
}
/** Backspace: tira a última letra digitada na casa (numa casa de duas letras, uma de cada vez). Sem nada a tirar, devolve o mesmo array. */
export function eraseAt(puzzle, entries, locked, idx) {
  if (puzzle.cells[idx]?.t !== "L" || locked.has(idx) || !entries[idx]) return entries;
  return setLetter(puzzle, entries, locked, idx, entries[idx].slice(0, -1));
}
export const isAnswerCorrect = (puzzle, entries, id) => puzzle.answers[id].cells.every(i => entries[i] === puzzle.cells[i].ch);
/** Fase completa: toda casa de letra tem a letra certa. */
export const isComplete = (puzzle, entries) => puzzle.cells.every((c, i) => c.t !== "L" || entries[i] === c.ch);
/** Todas as casas de letra preenchidas por inteiro (certas ou não; numa casa de duas letras, as duas). */
export const isFilled = (puzzle, entries) => puzzle.cells.every((c, i) => c.t !== "L" || entries[i].length === c.ch.length);

/** Casa de duas letras (a diagonal `\\`: CH, LH, NH, QU, GU, RR, SS). */
export const isDouble = c => c?.t === "L" && c.ch.length === 2;
/** O que a dica escreve na casa: a letra, ou só a 1ª das duas numa casa de duas letras. A dica NUNCA preenche as duas letras de uma casa:
    a outra o jogador digita (qualquer que seja o par, igual como RR ou diferente como CH). */
export const hintValue = c => (isDouble(c) ? c.ch[0] : c.ch);
/** Casa que a próxima dica revela: a primeira da resposta que ainda não está certa (assim a dica não gasta ponto onde já está certo).
    Casa de duas letras que já tem a 1ª letra certa é pulada: a dica não revela a 2ª (o jogador digita). -1 se não há o que revelar. */
export const nextHintCell = (puzzle, entries, id) => puzzle.answers[id].cells.find(i => {
  const c = puzzle.cells[i];
  return entries[i] !== c.ch && !(isDouble(c) && entries[i] === c.ch[0]);
}) ?? -1;
/** Há dica a pedir: uma resposta escolhida com letra errada ou faltando que a dica possa revelar, e dentro do limite de dicas do nível. */
export const canHint = (puzzle, entries, id, hints, levelIdx) => id >= 0 && hints < maxHints(levelIdx) && nextHintCell(puzzle, entries, id) >= 0;

/* ----- Seleção ----- */
/** Respostas que passam por uma casa de letra: { across, down } (ids ou -1). */
export const answersAt = (puzzle, idx) => { const c = puzzle.cells[idx]; return c?.t === "L" ? { across: c.across, down: c.down } : { across: -1, down: -1 }; };
/** Ao tocar numa letra: mantém a resposta atual se ela passa por ali; senão escolhe a horizontal (ou a vertical, se só houver ela). */
export function pickAnswerAt(puzzle, idx, currentId) {
  const { across, down } = answersAt(puzzle, idx);
  if (currentId >= 0 && (currentId === across || currentId === down)) return currentId;
  return across >= 0 ? across : down;
}
/** Tocar de novo na mesma letra troca o sentido (horizontal ⇄ vertical) quando as duas existem. */
export function toggleAnswerAt(puzzle, idx, currentId) {
  const { across, down } = answersAt(puzzle, idx);
  if (across >= 0 && down >= 0) return currentId === across ? down : across;
  return across >= 0 ? across : down;
}
/** Ids das respostas na ordem de leitura da grade (pela casa da dica; na casa com duas dicas, a de cima antes). */
export function answerOrder(puzzle) {
  const rank = id => { const k = puzzle.cells[puzzle.answers[id].clueCell].clues.find(c => c.id === id); return k?.slot === "bottom" ? 1 : 0; };
  return puzzle.answers.map(a => a.id).sort((x, y) => puzzle.answers[x].clueCell - puzzle.answers[y].clueCell || rank(x) - rank(y));
}
/** Dica vizinha na ordem de leitura (step = 1 ou -1), dando a volta nas pontas. Sem dica escolhida (-1), começa pela primeira (ou última). */
export function neighborAnswer(puzzle, id, step) {
  const order = answerOrder(puzzle);
  if (!order.length) return -1;
  const k = order.indexOf(id);
  if (k < 0) return step > 0 ? order[0] : order.at(-1);
  return order[(k + step + order.length) % order.length];
}
/** Casa em que o cursor começa ao escolher uma dica: a primeira ainda não preenchida por inteiro (ou a primeira, se estiver toda preenchida). */
export const firstOpenCell = (puzzle, entries, id) => puzzle.answers[id].cells.find(i => entries[i].length < puzzle.cells[i].ch.length) ?? puzzle.answers[id].cells[0];
/** Casa vizinha dentro da resposta (step = 1 ou -1); fica onde está nas pontas. */
export function stepInAnswer(puzzle, id, idx, step) {
  const cells = puzzle.answers[id].cells, k = cells.indexOf(idx);
  return k < 0 ? idx : cells[Math.max(0, Math.min(cells.length - 1, k + step))];
}
/** Setas do teclado: a próxima casa de letra naquela direção (pula casas de dica e vazias); -1 se não houver. */
export function jumpTarget(puzzle, idx, dr, dc) {
  const n = puzzle.n;
  let r = rowOf(n, idx) + dr, c = colOf(n, idx) + dc;
  while (r >= 0 && c >= 0 && r < n && c < n) {
    if (puzzle.cells[r * n + c].t === "L") return r * n + c;
    r += dr; c += dc;
  }
  return -1;
}

/* ----- Salvar e restaurar o andamento ----- */
/** As letras digitadas em texto, 2 caracteres por casa ("." completa: ".." vazia, "A." uma letra, "LH" duas), para guardar na fase salva. */
export const encodeEntries = entries => entries.map(e => (e || "").padEnd(2, ".")).join("");
export function decodeEntries(puzzle, text) {
  const out = newEntries(puzzle);
  if (typeof text !== "string" || text.length !== out.length * 2) return out;
  puzzle.cells.forEach((c, i) => {
    const part = text.slice(2 * i, 2 * i + 2), value = part.replace(/\./g, "");
    if (c.t === "L" && /^([A-Z]{1,2}|[A-Z]\.|\.\.)$/.test(part) && value.length <= c.ch.length) out[i] = value;
  });
  return out;
}
