import test from "node:test";
import assert from "node:assert/strict";
import { makeRng } from "../shared/rng.js";
import { ENTRIES, WORDS, normalize } from "../games/cruzadas/words.js";
import {
  DIGRAPHS, GEN, LEVELS, VARIANTS, answerOrder, answersAt, neighborAnswer, canHint, cellForms, decodeEntries, encodeEntries, eraseAt, firstOpenCell, typeInCell, generatePuzzle, isAnswerCorrect, isComplete,
  isFilled, isSigla, jumpTarget, letterCells, maxHints, newEntries, nextHintCell, normalizeLetter, pickAnswerAt, pointsAfterHints, setLetter,
  stepInAnswer, toggleAnswerAt, validatePuzzle,
} from "../games/cruzadas/domain.js";

test("normalizeLetter aceita acento e cedilha e rejeita o resto", () => {
  assert.equal(normalizeLetter("a"), "A");
  assert.equal(normalizeLetter("ç"), "C");
  assert.equal(normalizeLetter("é"), "E");
  assert.equal(normalizeLetter("Ã"), "A");
  for (const k of ["ab", "1", " ", "", "Enter", "Backspace", "-", undefined]) assert.equal(normalizeLetter(k), null, String(k));
});

test("vocabulário: sem repetidas, só A-Z, toda dica preenchida e nenhuma dica entrega a resposta", () => {
  assert.equal(WORDS.length, ENTRIES.length, "há entradas repetidas ou incompletas");
  assert.equal(new Set(WORDS.map(w => w.norm)).size, WORDS.length);
  for (const w of WORDS) {
    assert.match(w.norm, /^[A-Z]{2,}$/, w.norm);
    assert.ok(w.clue.length >= 6, `${w.norm}: dica curta demais`);
    if (w.norm.length >= 3) assert.ok(!normalize(w.clue).split(/[^A-Z]+/).includes(w.norm), `${w.norm}: a dica contém a resposta`);
  }
});

test("vocabulário: respostas de sobra por nível, com bastante material curto e médio", () => {
  for (const level of LEVELS) {
    const pool = WORDS.filter(w => w.norm.length <= level.maxLen);
    assert.ok(pool.length >= 100, `${level.name}: só ${pool.length} respostas`);
    assert.ok(pool.filter(w => w.norm.length >= 4).length >= 40, `${level.name}: poucas respostas de 4+ letras`);
  }
  assert.ok(WORDS.some(w => w.norm.length >= 9), "faltam respostas longas para os níveis altos");
});

test("níveis: grades 7, 9, 11 e 13, crescentes; respostas cabem na grade com a casa da dica", () => {
  assert.deepEqual(LEVELS.map(l => l.n), [7, 9, 11, 13]);
  assert.ok(LEVELS.every(l => l.maxLen <= l.n - 2));
  assert.ok(LEVELS.every((l, i) => !i || (l.n > LEVELS[i - 1].n && l.maxLen > LEVELS[i - 1].maxLen)));
});

test("dicas: limite = pontos do nível − 1, e a fase nunca vale menos que 1", () => {
  assert.deepEqual(LEVELS.map((_, i) => maxHints(i)), [4, 9, 14, 19]);
  assert.equal(pointsAfterHints(5, 0), 5);
  assert.equal(pointsAfterHints(5, 4), 1);
  assert.equal(pointsAfterHints(5, 40), 1);
});

for (const [i, level] of LEVELS.entries()) {
  test(`gera fase válida no nível ${level.name} (${level.n}x${level.n})`, () => {
    for (let seed = 1; seed <= 30; seed++) {
      const p = generatePuzzle(makeRng(seed * 977 + i), level);
      assert.equal(p.n, level.n);
      assert.equal(p.cells.length, level.n * level.n);
      assert.deepEqual(validatePuzzle(p), [], `seed ${seed}`);
      const letters = p.cells.filter(c => c.t === "L").length;
      assert.ok(letters / p.cells.length >= 0.43, `seed ${seed}: só ${(100 * letters / p.cells.length).toFixed(0)}% de letras`);
      assert.ok(p.answers.length >= [6, 9, 14, 19][i], `seed ${seed}: só ${p.answers.length} respostas`);
      assert.equal(new Set(p.answers.map(a => a.norm)).size, p.answers.length, "resposta repetida");
      assert.ok(p.answers.every(a => a.norm.length >= 2 && a.norm.length <= level.maxLen));
      assert.ok(p.answers.filter(a => a.norm.length === 2).length <= level.maxTwo, `seed ${seed}: respostas de 2 letras demais`);
      assert.ok(p.answers.filter(isSigla).length <= level.maxSigla, `seed ${seed}: siglas demais`);
      for (const a of p.answers) assert.ok(a.clue.length > 0);
    }
  });
}

test("a seed é determinística", () => {
  const a = generatePuzzle(makeRng(42), LEVELS[1]), b = generatePuzzle(makeRng(42), LEVELS[1]), c = generatePuzzle(makeRng(43), LEVELS[1]);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.cells, c.cells);
  assert.ok(Number.isInteger(GEN) && GEN >= 1);
});

test("as quatro setas, as casas com duas dicas e as casas vazias aparecem nas fases", () => {
  const variants = new Set(); let doubles = 0, blocks = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const p = generatePuzzle(makeRng(seed), LEVELS[1]);
    p.answers.forEach(a => variants.add(a.variant));
    doubles += p.cells.filter(c => c.t === "C" && c.clues.length === 2).length;
    blocks += p.cells.filter(c => c.t === "B").length;
  }
  assert.deepEqual([...variants].sort(), Object.keys(VARIANTS).sort());
  assert.ok(doubles > 0 && blocks > 0);
});

test("o validador pega grades quebradas", () => {
  const good = () => generatePuzzle(makeRng(7), LEVELS[0]);
  assert.deepEqual(validatePuzzle(good()), []);
  const wrongLetter = good(); const li = wrongLetter.cells.findIndex(c => c.t === "L");
  wrongLetter.cells[li] = { ...wrongLetter.cells[li], ch: wrongLetter.cells[li].ch === "A" ? "B" : "A" };
  assert.ok(validatePuzzle(wrongLetter).length > 0, "letra trocada");
  const noClue = good(); const ci = noClue.cells.findIndex(c => c.t === "C");
  noClue.cells[ci] = { t: "B" };
  assert.ok(validatePuzzle(noClue).length > 0, "casa de dica sumiu");
  const stray = good(); const bi = stray.cells.findIndex(c => c.t === "B");
  stray.cells[bi] = { t: "L", ch: "X", across: -1, down: -1 };
  assert.ok(validatePuzzle(stray).length > 0, "letra solta");
  const lost = good(); lost.answers.pop();
  assert.ok(validatePuzzle(lost).length > 0, "resposta removida");
});

/* Uma fase fixa para os testes de jogada. */
const P = generatePuzzle(makeRng(11), LEVELS[1]);
const solved = () => P.cells.map(c => (c.t === "L" ? c.ch : ""));
const crossing = P.cells.findIndex(c => c.t === "L" && c.across >= 0 && c.down >= 0);

test("setLetter: põe, apaga, ignora casa travada e casa que não é de letra, e não altera o array original", () => {
  const e0 = newEntries(P), li = letterCells(P)[0], ci = P.cells.findIndex(c => c.t === "C");
  const e1 = setLetter(P, e0, new Set(), li, "Z");
  assert.equal(e1[li], "Z"); assert.equal(e0[li], "");
  assert.equal(setLetter(P, e1, new Set([li]), li, "A"), e1);       // travada por dica
  assert.equal(setLetter(P, e1, new Set(), ci, "A"), e1);           // casa de dica
  assert.equal(setLetter(P, e1, new Set(), li, "Z"), e1);           // nada mudou
  assert.equal(setLetter(P, e1, new Set(), li, "")[li], "");        // apagar
});

test("isComplete / isFilled / isAnswerCorrect", () => {
  const e = solved();
  assert.equal(isComplete(P, e), true); assert.equal(isFilled(P, e), true);
  assert.ok(P.answers.every(a => isAnswerCorrect(P, e, a.id)));
  const wrong = [...e], li = letterCells(P)[0]; wrong[li] = e[li] === "A" ? "B" : "A";
  assert.equal(isComplete(P, wrong), false); assert.equal(isFilled(P, wrong), true);
  const empty = [...e]; empty[li] = "";
  assert.equal(isFilled(P, empty), false);
  assert.equal(isComplete(P, newEntries(P)), false);
});

test("dica revela da primeira à última letra, pulando o que já está certo", () => {
  const a = P.answers.find(x => x.norm.length >= 5), e = newEntries(P), locked = new Set();
  let cur = e;
  for (let k = 0; k < a.cells.length; k++) {
    const idx = nextHintCell(P, cur, a.id);
    assert.equal(idx, a.cells[k], `dica ${k + 1} deveria revelar a letra ${k + 1}`);
    cur = setLetter(P, cur, locked, idx, P.cells[idx].ch); locked.add(idx);
  }
  assert.equal(nextHintCell(P, cur, a.id), -1);                     // resposta toda certa: sem dica
  const withMid = newEntries(P);                                    // o jogador já acertou a 1ª letra: a dica vai para a 2ª
  withMid[a.cells[0]] = P.cells[a.cells[0]].ch;
  assert.equal(nextHintCell(P, withMid, a.id), a.cells[1]);
  const wrongFirst = newEntries(P); wrongFirst[a.cells[0]] = P.cells[a.cells[0]].ch === "A" ? "B" : "A";
  assert.equal(nextHintCell(P, wrongFirst, a.id), a.cells[0]);      // letra errada é substituída
});

test("canHint: precisa de dica escolhida, respeita o limite do nível e some quando a resposta está certa", () => {
  const e = newEntries(P), id = P.answers[0].id;
  assert.equal(canHint(P, e, -1, 0, 1), false);                     // nada selecionado
  assert.equal(canHint(P, e, id, 0, 1), true);
  assert.equal(canHint(P, e, id, maxHints(1) - 1, 1), true);
  assert.equal(canHint(P, e, id, maxHints(1), 1), false);           // limite atingido
  const full = solved();
  assert.equal(canHint(P, full, id, 0, 1), false);                  // resposta já certa
});

test("seleção: manter o sentido, alternar no cruzamento e escolher a horizontal por padrão", () => {
  const { across, down } = answersAt(P, crossing);
  assert.ok(across >= 0 && down >= 0);
  assert.equal(pickAnswerAt(P, crossing, -1), across);
  assert.equal(pickAnswerAt(P, crossing, down), down);              // já estava na vertical: continua
  assert.equal(pickAnswerAt(P, crossing, 9999), across);            // resposta que não passa por ali
  assert.equal(toggleAnswerAt(P, crossing, across), down);
  assert.equal(toggleAnswerAt(P, crossing, down), across);
  const onlyDown = P.cells.findIndex(c => c.t === "L" && c.across < 0 && c.down >= 0);
  if (onlyDown >= 0) { assert.equal(pickAnswerAt(P, onlyDown, -1), P.cells[onlyDown].down); assert.equal(toggleAnswerAt(P, onlyDown, P.cells[onlyDown].down), P.cells[onlyDown].down); }
  assert.deepEqual(answersAt(P, P.cells.findIndex(c => c.t === "C")), { across: -1, down: -1 });
});

test("dica anterior/próxima: ordem de leitura, dando a volta, e começo sem seleção", () => {
  const order = answerOrder(P);
  assert.deepEqual([...order].sort((a, b) => a - b), P.answers.map(a => a.id));            // cada resposta aparece uma vez
  for (let i = 1; i < order.length; i++) assert.ok(P.answers[order[i]].clueCell >= P.answers[order[i - 1]].clueCell, "fora da ordem de leitura");
  assert.equal(neighborAnswer(P, -1, 1), order[0]);
  assert.equal(neighborAnswer(P, -1, -1), order.at(-1));
  assert.equal(neighborAnswer(P, order[0], 1), order[1]);
  assert.equal(neighborAnswer(P, order[1], -1), order[0]);
  assert.equal(neighborAnswer(P, order.at(-1), 1), order[0]);                               // volta ao começo
  assert.equal(neighborAnswer(P, order[0], -1), order.at(-1));
  let id = order[0];
  for (let i = 0; i < order.length; i++) id = neighborAnswer(P, id, 1);
  assert.equal(id, order[0]);                                                                // uma volta completa
});

test("cursor: primeira casa vazia da resposta e passo dentro dela", () => {
  const a = P.answers.find(x => x.norm.length >= 4), e = newEntries(P);
  assert.equal(firstOpenCell(P, e, a.id), a.cells[0]);
  e[a.cells[0]] = P.cells[a.cells[0]].ch; e[a.cells[1]] = P.cells[a.cells[1]].ch;
  assert.equal(firstOpenCell(P, e, a.id), a.cells[2]);
  const all = solved();
  assert.equal(firstOpenCell(P, all, a.id), a.cells[0]);            // toda preenchida: volta ao começo
  assert.equal(stepInAnswer(P, a.id, a.cells[1], 1), a.cells[2]);
  assert.equal(stepInAnswer(P, a.id, a.cells[1], -1), a.cells[0]);
  assert.equal(stepInAnswer(P, a.id, a.cells[0], -1), a.cells[0]);  // ponta
  assert.equal(stepInAnswer(P, a.id, a.cells.at(-1), 1), a.cells.at(-1));
});

test("setas do teclado pulam casas de dica e vazias e param na borda", () => {
  const n = P.n;
  for (const li of letterCells(P)) {
    for (const [dr, dc] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const t = jumpTarget(P, li, dr, dc);
      if (t < 0) continue;
      assert.equal(P.cells[t].t, "L");
      assert.ok(Math.sign(Math.floor(t / n) - Math.floor(li / n)) === dr && Math.sign((t % n) - (li % n)) === dc);
    }
  }
  const top = letterCells(P).find(i => Math.floor(i / n) === Math.min(...letterCells(P).map(x => Math.floor(x / n))));
  assert.equal(jumpTarget(P, top, -1, 0), -1);
});

test("salvar e restaurar as letras digitadas", () => {
  const e = newEntries(P); const [a, b] = letterCells(P);
  e[a] = "Q"; e[b] = "R";
  const text = encodeEntries(e);
  assert.equal(text.length, P.n * P.n * 2);                         // 2 caracteres por casa (cabem as casas de duas letras)
  assert.deepEqual(decodeEntries(P, text), e);
  assert.deepEqual(decodeEntries(P, "curto"), newEntries(P));       // tamanho errado: começa vazio
  assert.deepEqual(decodeEntries(P, undefined), newEntries(P));
  const ci = P.cells.findIndex(c => c.t === "C"), tampered = [...text]; tampered[2 * ci] = "Z";
  assert.equal(decodeEntries(P, tampered.join(""))[ci], "");        // letra em casa de dica é ignorada
});

/* ===================== casas de duas letras (diagonal \) ===================== */
const doublesOf = p => p.cells.map((c, i) => (c.t === "L" && c.ch.length === 2 ? i : -1)).filter(i => i >= 0);

test("cellForms: dígrafo numa casa só, sem juntar o que não é dígrafo nem transformar a resposta numa casa única", () => {
  assert.deepEqual(cellForms("CHAVE"), [[..."CHAVE"], ["CH", "A", "V", "E"]]);
  assert.deepEqual(cellForms("FOLHA"), [[..."FOLHA"], ["F", "O", "LH", "A"]]);
  assert.deepEqual(cellForms("BORRACHA"), [[..."BORRACHA"], ["B", "O", "RR", "A", "CH", "A"]]);   // dois dígrafos, os dois numa casa
  assert.deepEqual(cellForms("SOL"), [[..."SOL"]]);                                                 // sem dígrafo: só uma forma
  assert.deepEqual(cellForms("RR"), [["R", "R"]]);                                                  // virar uma casa só deixaria a resposta sem sentido
  for (const w of WORDS) for (const f of cellForms(w.norm)) {
    assert.equal(f.join(""), w.norm, w.norm);
    assert.ok(f.every(x => x.length === 1 || DIGRAPHS.includes(x)), w.norm);
  }
  assert.ok(WORDS.filter(w => cellForms(w.norm).length > 1).length >= 40, "poucas palavras com dígrafo");
});

for (const [i, level] of LEVELS.entries()) {
  test(`nível ${level.name}: toda fase tem de ${level.minDouble} a ${level.maxDouble} casa(s) de duas letras, bem formadas`, () => {
    let total = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const p = generatePuzzle(makeRng(seed * 541 + i), level), d = doublesOf(p);
      total += d.length;
      assert.ok(d.length >= level.minDouble && d.length <= level.maxDouble, `seed ${seed}: ${d.length} casas de duas letras`);
      for (const idx of d) {
        const c = p.cells[idx];
        assert.ok(DIGRAPHS.includes(c.ch), `${c.ch} não é dígrafo`);
        assert.ok((c.across >= 0) !== (c.down >= 0), "casa de duas letras pertence a uma só resposta (não é cruzamento)");
        const a = p.answers[c.across >= 0 ? c.across : c.down];
        assert.ok(a.cells.length < a.norm.length, "a resposta com casa dupla ocupa menos casas que letras");
        assert.equal(a.cells.map(k => p.cells[k].ch).join(""), a.norm);
      }
      assert.deepEqual(validatePuzzle(p), []);
    }
    assert.ok(total > 0);
  });
}

test("as casas de duas letras variam: aparecem nos dois sentidos e com dígrafos diferentes", () => {
  const dirs = new Set(), digraphs = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const p = generatePuzzle(makeRng(seed), LEVELS[2]);
    for (const idx of doublesOf(p)) { const c = p.cells[idx]; dirs.add(c.across >= 0 ? "across" : "down"); digraphs.add(c.ch); }
  }
  assert.deepEqual([...dirs].sort(), ["across", "down"]);
  assert.ok(digraphs.size >= 4, `só ${[...digraphs].join(" ")}`);
});

/* Regressão: numa casa com duas dicas, a seta de uma metade caía em cima da outra metade porque as dicas eram desenhadas na ordem em
   que foram criadas. A de cima (setas que saem pela direita: R, RD) tem de vir antes da de baixo (setas que saem por baixo: D, DR). */
test("casa com duas dicas: a de cima vem antes (R/RD) e a de baixo depois (D/DR)", () => {
  let doubles = 0;
  for (const [i, level] of LEVELS.entries()) for (let seed = 1; seed <= 40; seed++) {
    const p = generatePuzzle(makeRng(seed * 73 + i), level);
    for (const c of p.cells) {
      if (c.t !== "C") continue;
      if (c.clues.length === 1) { assert.equal(c.clues[0].slot, "full"); continue; }
      doubles++;
      assert.deepEqual(c.clues.map(k => k.slot), ["top", "bottom"]);
      assert.ok(["R", "RD"].includes(p.answers[c.clues[0].id].variant), "metade de cima só com seta que sai pela direita");
      assert.ok(["D", "DR"].includes(p.answers[c.clues[1].id].variant), "metade de baixo só com seta que sai por baixo");
    }
  }
  assert.ok(doubles > 20, "o teste precisa ver casas com duas dicas");
});

/* Uma fase com casa de duas letras para os testes de jogada. */
const PD = (() => { for (let seed = 1; seed < 200; seed++) { const p = generatePuzzle(makeRng(seed), LEVELS[1]); if (doublesOf(p).length) return p; } })();
const dbl = doublesOf(PD)[0], dblCh = PD.cells[dbl].ch;

test("digitar numa casa de duas letras: a 1ª abre, a 2ª fecha (e só então o cursor avança); casa cheia recomeça", () => {
  const e0 = newEntries(PD), lock = new Set();
  const r1 = typeInCell(PD, e0, lock, dbl, dblCh[0]);
  assert.equal(r1.entries[dbl], dblCh[0]); assert.equal(r1.advance, false);
  const r2 = typeInCell(PD, r1.entries, lock, dbl, dblCh[1]);
  assert.equal(r2.entries[dbl], dblCh); assert.equal(r2.advance, true);
  const r3 = typeInCell(PD, r2.entries, lock, dbl, "X");            // casa cheia: recomeça
  assert.equal(r3.entries[dbl], "X"); assert.equal(r3.advance, false);
  const single = letterCells(PD).find(i => PD.cells[i].ch.length === 1);
  const s1 = typeInCell(PD, e0, lock, single, "Q");
  assert.equal(s1.entries[single], "Q"); assert.equal(s1.advance, true);   // casa de uma letra: avança de imediato
  const locked1 = typeInCell(PD, e0, new Set([dbl]), dbl, "A");     // travada por dica: não muda, mas o cursor segue
  assert.equal(locked1.entries, e0); assert.equal(locked1.advance, true);
  assert.equal(typeInCell(PD, e0, lock, PD.cells.findIndex(c => c.t === "C"), "A").advance, false);   // casa de dica: nada
});

test("Backspace numa casa de duas letras tira uma letra de cada vez; casa vazia ou travada não muda", () => {
  const full = [...newEntries(PD)]; full[dbl] = dblCh;
  const a = eraseAt(PD, full, new Set(), dbl);
  assert.equal(a[dbl], dblCh[0]);
  const b = eraseAt(PD, a, new Set(), dbl);
  assert.equal(b[dbl], "");
  assert.equal(eraseAt(PD, b, new Set(), dbl), b);                  // vazia
  assert.equal(eraseAt(PD, full, new Set([dbl]), dbl), full);       // travada
  assert.equal(full[dbl], dblCh);                                   // o original não foi alterado
});

test("casa de duas letras só vale completa: isFilled, firstOpenCell e dica", () => {
  const a = PD.answers[PD.cells[dbl].across >= 0 ? PD.cells[dbl].across : PD.cells[dbl].down];
  const e = newEntries(PD);
  for (const i of a.cells) e[i] = PD.cells[i].ch;                   // resposta toda certa
  assert.equal(isAnswerCorrect(PD, e, a.id), true);
  e[dbl] = dblCh[0];                                                // só a 1ª letra da casa dupla
  assert.equal(isAnswerCorrect(PD, e, a.id), false);
  assert.equal(firstOpenCell(PD, e, a.id), dbl, "a casa meio preenchida continua aberta");
  assert.equal(nextHintCell(PD, e, a.id), dbl);
  const full = PD.cells.map(c => (c.t === "L" ? c.ch : "")), half = [...full]; half[dbl] = dblCh[0];
  assert.equal(isFilled(PD, full), true); assert.equal(isFilled(PD, half), false); assert.equal(isComplete(PD, half), false);
  const hinted = setLetter(PD, half, new Set(), dbl, dblCh);        // a dica revela a casa inteira (as duas letras) por 1 ponto
  assert.equal(hinted[dbl], dblCh); assert.equal(isComplete(PD, hinted), true);
  assert.equal(setLetter(PD, newEntries(PD), new Set(), dbl, "ABC")[dbl], "", "mais letras que a casa comporta é ignorado");
});

test("salvar e restaurar com casas de duas letras; formatos inválidos são descartados", () => {
  const e = newEntries(PD), single = letterCells(PD).find(i => PD.cells[i].ch.length === 1);
  e[dbl] = dblCh; e[single] = "K";
  assert.deepEqual(decodeEntries(PD, encodeEntries(e)), e);
  const half = [...e]; half[dbl] = dblCh[0];
  assert.deepEqual(decodeEntries(PD, encodeEntries(half)), half);   // meia casa também volta
  const bad = [...encodeEntries(newEntries(PD))];
  bad[2 * single] = "A"; bad[2 * single + 1] = "B";                 // duas letras numa casa de uma
  bad[2 * dbl] = "."; bad[2 * dbl + 1] = "Z";                       // ".Z": formato inválido
  const out = decodeEntries(PD, bad.join(""));
  assert.equal(out[single], ""); assert.equal(out[dbl], "");
});

test("o validador pega casa dupla que cruza, dígrafo falso, dicas fora de ordem e resposta que não fecha", () => {
  const fresh = () => structuredClone(PD);
  assert.deepEqual(validatePuzzle(fresh()), []);
  const cross = fresh(); cross.cells[dbl].across = 0; cross.cells[dbl].down = 1;
  assert.ok(validatePuzzle(cross).length > 0, "casa dupla como cruzamento");
  const fake = fresh(); fake.cells[dbl].ch = "XY";
  assert.ok(validatePuzzle(fake).length > 0, "duas letras que não são dígrafo");
  const swapped = fresh(); const ci = swapped.cells.findIndex(c => c.t === "C" && c.clues.length === 2);
  if (ci >= 0) { swapped.cells[ci].clues.reverse(); assert.ok(validatePuzzle(swapped).length > 0, "dicas na ordem trocada (o bug da seta sobre a outra casa)"); }
  const wrongSlot = fresh(); const c1 = wrongSlot.cells.findIndex(c => c.t === "C" && c.clues.length === 2);
  if (c1 >= 0) { wrongSlot.cells[c1].clues[0].slot = "bottom"; assert.ok(validatePuzzle(wrongSlot).length > 0, "dica na metade errada"); }
  const broken = fresh(); broken.cells[dbl].ch = DIGRAPHS.find(d => d !== dblCh);
  assert.ok(validatePuzzle(broken).length > 0, "letras da casa não formam a resposta");
});
