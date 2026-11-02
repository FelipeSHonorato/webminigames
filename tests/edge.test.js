/* Testes da validação server-side (Edge Function): o servidor monta o puzzle a partir da seed secreta e
   confere o tabuleiro antes de pontuar. Aqui testamos a lógica PURA (supabase/functions/play/_shared/board.js),
   além de garantir que as cópias dos domínios dentro da função continuam idênticas às de games/. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeRng } from "../shared/rng.js";
import { publicView, validate, validateSnapshot, validatePartial, countWords, snapshot, GAMES, SOLO_GAMES, duelOf, duelContract, DUELS } from "../supabase/functions/play/_shared/board.js";
import { GAMES as CATALOG } from "../js/games.js";
import * as arrows from "../games/arrows/domain.js";
import * as canos from "../games/canos/domain.js";
import * as chess from "../games/chess/domain.js";
import * as cruzadas from "../games/cruzadas/domain.js";
import * as dama from "../games/dama/domain.js";
import * as patches from "../games/patches/domain.js";
import * as queens from "../games/queens/domain.js";
import * as sopa from "../games/sopa/domain.js";
import * as sudoku from "../games/sudoku/domain.js";
import * as tango from "../games/tango/domain.js";
import * as texttwist from "../games/texttwist/domain.js";
import * as zip from "../games/zip/domain.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = p => readFileSync(join(root, p), "utf8");
const normPoints = s => s.replace(/"(?:\.\.\/)+(?:shared\/)?points\.js"/g, '"POINTS"');

/* ---------- paridade entre games/ e a cópia usada pela Edge Function ---------- */
test("cópias dos domínios na Edge Function batem com games/ (paridade)", () => {
  for (const g of ["arrows", "canos", "chess", "cruzadas", "dama", "patches", "queens", "sopa", "sudoku", "tango", "texttwist", "zip"]) {
    assert.equal(normPoints(read(`supabase/functions/play/_shared/${g}/domain.js`)), normPoints(read(`games/${g}/domain.js`)), `domain de ${g} divergiu`);
  }
  for (const g of ["cruzadas", "sopa", "texttwist"]) {
    assert.equal(read(`supabase/functions/play/_shared/${g}/words.js`), read(`games/${g}/words.js`), `words de ${g} divergiu`);
  }
  assert.equal(normPoints(read("supabase/functions/play/_shared/points.js")), read("shared/points.js"));
  assert.equal(read("supabase/functions/play/_shared/rng.js"), read("shared/rng.js"));
});

/* ---------- o puzzle público NUNCA carrega a solução ---------- */
test("visão pública não vaza a solução (jogos fortes)", () => {
  for (const g of ["sudoku", "arrows", "canos", "patches", "queens", "tango", "texttwist", "zip"]) {
    const view = JSON.stringify(publicView(g, 12345, 0));
    assert.ok(!view.includes("solution"), `${g} vazou a solução`);
    assert.ok(!view.includes("\"path\""), `${g} vazou o caminho`);
  }
  const queensView = publicView("queens", 12345, 0);
  assert.ok(Array.isArray(queensView.regions) && queensView.regions.length === queensView.n * queensView.n, "queens manda o mapa de regiões");
  const tangoView = publicView("tango", 12345, 0);
  assert.ok(Array.isArray(tangoView.givens) && Array.isArray(tangoView.marks), "tango manda dados e sinais");
  const twistView = publicView("texttwist", 12345, 0);
  assert.ok(Array.isArray(twistView.letters) && twistView.letters.length === twistView.n, "texttwist manda as letras");
  assert.ok(!JSON.stringify(twistView).includes("\"words\""), "texttwist não manda a lista de palavras");
  const canosView = publicView("canos", 12345, 0);
  assert.ok(Array.isArray(canosView.inlets) && canosView.inlets.length >= 1);
  assert.ok(Array.isArray(canosView.outlets) && canosView.outlets.length >= 1);
  assert.ok(!("inlet" in canosView) && !("outlet" in canosView), "canos ainda manda terminais no singular");
});

test("visão pública de sopa e cruzadas não carrega a solução", () => {
  const sopaView = JSON.stringify(publicView("sopa", 555, 0));
  assert.ok(!sopaView.includes("\"cells\""), "sopa vazou as células das palavras");
  assert.ok(!sopaView.includes("\"dir\""), "sopa vazou a direção das palavras");
  const cruz = JSON.stringify(publicView("cruzadas", 666, 0));
  assert.ok(!cruz.includes("\"ch\""), "cruzadas vazou as letras certas");
  assert.ok(!cruz.includes("\"norm\""), "cruzadas vazou as respostas");
  assert.ok(cruz.includes("\"cap\""), "cruzadas deveria mandar a capacidade das casas (cap)");
  assert.ok(cruz.includes("\"len\""), "cruzadas deveria mandar o tamanho das respostas (len)");
});

/* ---------- aceita a solução correta ---------- */

test("solve() do sudoku é aceito e um tabuleiro inválido é recusado", () => {
  const seed = 111, lvl = 0;
  const p = sudoku.generatePuzzle(makeRng(seed), sudoku.LEVELS[lvl]);
  const grid = sudoku.solve(p.cells);
  assert.equal(validate("sudoku", seed, lvl, { grid }), true);
  assert.equal(validate("sudoku", seed, lvl, { grid: grid.map((v, i) => (i === 0 ? 0 : v)) }), false);
  assert.equal(validate("sudoku", seed, lvl, { grid: grid.map((v, i) => (i === 0 ? (v % 9) + 1 : v)) }), false);
});

test("canos: giros da solução são aceitos; giros iniciais embaralhados são recusados", () => {
  const seed = 222, lvl = 0;
  const p = canos.generatePuzzle(makeRng(seed), canos.LEVELS[lvl]);
  assert.equal(validate("canos", seed, lvl, { rots: canos.solutionRots(p) }), true);
  assert.equal(validate("canos", seed, lvl, { rots: canos.initialRots(p) }), false);
});

test("arrows: a ordem que limpa o tabuleiro é aceita; uma ordem travada é recusada", () => {
  const seed = 271, lvl = 0;
  const p = arrows.generatePuzzle(makeRng(seed), arrows.LEVELS[lvl]);
  assert.equal(validate("arrows", seed, lvl, { order: p.solution }), true);
  assert.equal(validate("arrows", seed, lvl, { order: p.solution.slice(0, -1) }), false);
  assert.equal(validate("arrows", seed, lvl, {}), false);
  const occ = arrows.buildOcc(p.pieces, p.pieces.map((_, i) => i));
  const blocked = p.pieces.findIndex((_, i) => arrows.blocked(p.n, p.pieces, occ, i, p.redirectors, 0));
  assert.notEqual(blocked, -1, "o teste precisa de uma seta travada no início");
  assert.equal(validate("arrows", seed, lvl, { order: [blocked, ...p.pieces.map((_, i) => i).filter(i => i !== blocked)] }), false, "começar por uma seta travada deveria ser recusado");
});

test("queens: as rainhas da solução são aceitas; uma casa trocada é recusada", () => {
  const seed = 909, lvl = 0;
  const p = queens.generatePuzzle(makeRng(seed), queens.LEVELS[lvl]);
  assert.equal(validate("queens", seed, lvl, { queens: queens.solutionCells(p) }), true);
  assert.equal(validate("queens", seed, lvl, { queens: queens.solutionCells(p).map((c, i) => (i === 0 ? (c + 1) % p.n : c)) }), false);
  assert.equal(validate("queens", seed, lvl, { queens: [] }), false);
  assert.equal(validate("queens", seed, lvl, {}), false);
});

test("tango: a grade da solução é aceita; uma casa trocada e uma vazia são recusadas", () => {
  const seed = 911, lvl = 0;
  const p = tango.generatePuzzle(makeRng(seed), tango.LEVELS[lvl]);
  const grid = p.solution.slice();
  assert.equal(validate("tango", seed, lvl, { grid }), true);
  assert.equal(validate("tango", seed, lvl, { grid: grid.map((v, i) => (i === 0 ? 1 - v : v)) }), false);
  assert.equal(validate("tango", seed, lvl, { grid: grid.map((v, i) => (i === 5 ? -1 : v)) }), false);
  assert.equal(validate("tango", seed, lvl, {}), false);
});

test("texttwist: a palavra de todas as letras é aceita; lista curta ou inválida é recusada", () => {
  const seed = 913, lvl = 0;
  const p = texttwist.generatePuzzle(makeRng(seed), texttwist.LEVELS[lvl]);
  const key = p.words.find(w => w.length === p.n);
  assert.ok(key, "a fase precisa de uma palavra-chave");
  assert.equal(validate("texttwist", seed, lvl, { words: [key] }), true);
  assert.equal(validate("texttwist", seed, lvl, { words: [key, "ZZZZZZ"] }), false);
  assert.equal(validate("texttwist", seed, lvl, { words: p.words.filter(w => w.length < p.n) }), false);
  assert.equal(validate("texttwist", seed, lvl, { words: [] }), false);
  assert.equal(validate("texttwist", seed, lvl, {}), false);
});

test("texttwist: fim de rodada sem a chave é aceito como parcial, mas não como vitória", () => {
  const seed = 915, lvl = 0;
  const p = texttwist.generatePuzzle(makeRng(seed), texttwist.LEVELS[lvl]);
  const short = p.words.filter(w => w.length < p.n).slice(0, 3);
  const snap = snapshot("texttwist", seed, lvl);
  assert.equal(validate("texttwist", seed, lvl, { words: short }), false, "sem a chave não vence");
  assert.equal(validatePartial("texttwist", snap.fullPuzzle, { words: short }), true, "fim de rodada parcial vale");
  assert.equal(validatePartial("texttwist", snap.fullPuzzle, { words: [] }), false, "lista vazia");
  assert.equal(validatePartial("texttwist", snap.fullPuzzle, { words: [], timeout: true }), true, "timeout sem palavras vale");
  assert.equal(validatePartial("texttwist", snap.fullPuzzle, { words: ["ZZZZZZ"] }), false, "palavra inválida");
  assert.equal(validatePartial("sudoku", snap.fullPuzzle, { words: short }), false, "parcial só existe no Text Twist");
});

test("texttwist: contagem do pódio ignora palavras repetidas", () => {
  const seed = 917, lvl = 0;
  const p = texttwist.generatePuzzle(makeRng(seed), texttwist.LEVELS[lvl]);
  const short = p.words.filter(w => w.length < p.n).slice(0, 2);
  assert.equal(countWords("texttwist", { words: [short[0], short[0], short[1]] }), 2);
  assert.equal(countWords("texttwist", { words: [short[0].toLowerCase(), short[0], short[1]] }), 2);
  assert.equal(countWords("sudoku", { words: short }), 0);
});

test("patches: a partição solução é aceita; um retângulo fora do lugar é recusado", () => {
  const seed = 333, lvl = 0;
  const p = patches.generatePuzzle(makeRng(seed), patches.LEVELS[lvl]);
  assert.equal(validate("patches", seed, lvl, { rects: p.solution }), true);
  const bad = p.solution.map((r, i) => (i === 0 ? [r[0], r[1], r[2], Math.min(r[3] + 1, patches.N - 1)] : r));
  assert.equal(validate("patches", seed, lvl, { rects: bad }), false);
});

test("zip: o caminho solução é aceito; caminho curto é recusado", () => {
  const seed = 444, lvl = 0;
  const p = zip.generatePuzzle(makeRng(seed), zip.LEVELS[lvl]);
  assert.equal(validate("zip", seed, lvl, { path: p.solution }), true);
  assert.equal(validate("zip", seed, lvl, { path: p.solution.slice(0, -1) }), false);
  const swapped = [...p.solution]; [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  assert.equal(validate("zip", seed, lvl, { path: swapped }), false);
});

test("sopa: todas as palavras aceitas; seleção vazia recusada", () => {
  const seed = 555, lvl = 0;
  const p = sopa.generatePuzzle(makeRng(seed), sopa.LEVELS[lvl]);
  const found = p.words.map((_, i) => i);
  assert.equal(validate("sopa", seed, lvl, { found }), true);
  assert.equal(validate("sopa", seed, lvl, { found: [] }), false);
  assert.equal(validate("sopa", seed, lvl, { found: [...found, 0] }), false);
});

test("sopa: quando o cliente manda as células, elas têm de ser uma ocorrência real", () => {
  const seed = 555, lvl = 0;
  const p = sopa.generatePuzzle(makeRng(seed), sopa.LEVELS[lvl]);
  const found = p.words.map((w, i) => ({ index: i, cells: w.cells }));   // o que a UI envia no modo nuvem
  assert.equal(validate("sopa", seed, lvl, { found }), true);
  const wrong = found.map((f, i) => (i === 0 ? { ...f, cells: f.cells.map(c => (c + 1) % (p.n * p.n)) } : f));
  assert.equal(validate("sopa", seed, lvl, { found: wrong }), false);
});

test("a visão pública do patches traz o lado da grade (a UI precisa dele para reconstruir)", () => {
  assert.equal(publicView("patches", 333, 2).n, patches.LEVELS[2].n);
});

test("cruzadas: grade completa é aceita; vazia é recusada", () => {
  const seed = 666, lvl = 0;
  const p = cruzadas.generatePuzzle(makeRng(seed), cruzadas.LEVELS[lvl]);
  const entries = p.cells.map(c => (c.t === "L" ? c.ch : ""));
  assert.equal(validate("cruzadas", seed, lvl, { entries: cruzadas.encodeEntries(entries) }), true);
  assert.equal(validate("cruzadas", seed, lvl, { entries: "" }), false);
});

test("puzzles diferentes têm a mesma seed mas níveis diferentes mudam a dificuldade do sudoku", () => {
  const a = sudoku.generatePuzzle(makeRng(9), sudoku.LEVELS[0]);
  const b = sudoku.generatePuzzle(makeRng(9), sudoku.LEVELS[3]);
  assert.ok(a.givens >= b.givens, "nível maior deveria ter menos pistas");
});

test("snapshot diário: o puzzle completo valida e a visão pública continua sem a solução", () => {
  const cases = [
    ["sudoku", 801], ["arrows", 802], ["canos", 803], ["patches", 804], ["zip", 805], ["sopa", 806], ["cruzadas", 807], ["queens", 808], ["tango", 809], ["texttwist", 810],
  ];
  for (const [game, seed] of cases) {
    const snap = snapshot(game, seed, 0);
    const view = JSON.stringify(snap.publicView);
    assert.ok(!view.includes('"solution"') && !view.includes('"path"'), `${game}: visão pública vazou a solução`);
    assert.ok(snap.fullPuzzle && snap.gen > 0, `${game}: snapshot incompleto`);
  }

  const sudokuSnap = snapshot("sudoku", 801, 0);
  const sudokuP = sudoku.generatePuzzle(makeRng(801), sudoku.LEVELS[0]);
  assert.equal(validateSnapshot("sudoku", sudokuSnap.fullPuzzle, { grid: sudoku.solve(sudokuP.cells) }), true);
  assert.equal(validateSnapshot("sudoku", sudokuSnap.fullPuzzle, { grid: [] }), false);

  const arrowsSnap = snapshot("arrows", 802, 0);
  const arrowsP = arrows.generatePuzzle(makeRng(802), arrows.LEVELS[0]);
  assert.equal(validateSnapshot("arrows", arrowsSnap.fullPuzzle, { order: arrowsP.solution }), true);
  assert.equal(validateSnapshot("arrows", arrowsSnap.fullPuzzle, { order: [] }), false);

  const canosSnap = snapshot("canos", 803, 0);
  const canosP = canos.generatePuzzle(makeRng(803), canos.LEVELS[0]);
  assert.equal(validateSnapshot("canos", canosSnap.fullPuzzle, { rots: canos.solutionRots(canosP) }), true);
  assert.equal(validateSnapshot("canos", canosSnap.fullPuzzle, { rots: [] }), false);

  const patchesSnap = snapshot("patches", 804, 0);
  const patchesP = patches.generatePuzzle(makeRng(804), patches.LEVELS[0]);
  assert.equal(validateSnapshot("patches", patchesSnap.fullPuzzle, { rects: patchesP.solution }), true);
  assert.equal(validateSnapshot("patches", patchesSnap.fullPuzzle, { rects: [] }), false);

  const zipSnap = snapshot("zip", 805, 0);
  const zipP = zip.generatePuzzle(makeRng(805), zip.LEVELS[0]);
  assert.equal(validateSnapshot("zip", zipSnap.fullPuzzle, { path: zipP.solution }), true);
  assert.equal(validateSnapshot("zip", zipSnap.fullPuzzle, { path: [] }), false);

  const sopaSnap = snapshot("sopa", 806, 0);
  const sopaP = sopa.generatePuzzle(makeRng(806), sopa.LEVELS[0]);
  assert.equal(validateSnapshot("sopa", sopaSnap.fullPuzzle, { found: sopaP.words.map((_, i) => i) }), true);
  assert.equal(validateSnapshot("sopa", sopaSnap.fullPuzzle, { found: [] }), false);

  const cruzSnap = snapshot("cruzadas", 807, 0);
  const cruzP = cruzadas.generatePuzzle(makeRng(807), cruzadas.LEVELS[0]);
  const entries = cruzP.cells.map(c => (c.t === "L" ? c.ch : ""));
  assert.equal(validateSnapshot("cruzadas", cruzSnap.fullPuzzle, { entries: cruzadas.encodeEntries(entries) }), true);
  assert.equal(validateSnapshot("cruzadas", cruzSnap.fullPuzzle, { entries: "" }), false);

  const queensSnap = snapshot("queens", 808, 0);
  const queensP = queens.generatePuzzle(makeRng(808), queens.LEVELS[0]);
  assert.equal(validateSnapshot("queens", queensSnap.fullPuzzle, { queens: queens.solutionCells(queensP) }), true);
  assert.equal(validateSnapshot("queens", queensSnap.fullPuzzle, { queens: [] }), false);

  const tangoSnap = snapshot("tango", 809, 0);
  const tangoP = tango.generatePuzzle(makeRng(809), tango.LEVELS[0]);
  assert.equal(validateSnapshot("tango", tangoSnap.fullPuzzle, { grid: tangoP.solution }), true);
  assert.equal(validateSnapshot("tango", tangoSnap.fullPuzzle, { grid: [] }), false);

  const twistSnap = snapshot("texttwist", 810, 0);
  const twistP = texttwist.generatePuzzle(makeRng(810), texttwist.LEVELS[0]);
  const twistKey = twistP.words.find(w => w.length === twistP.n);
  assert.equal(validateSnapshot("texttwist", twistSnap.fullPuzzle, { words: [twistKey] }), true);
  assert.equal(validateSnapshot("texttwist", twistSnap.fullPuzzle, { words: [] }), false);
});

test("GAMES agrupa os doze domínios e SOLO_GAMES deixa xadrez e dama de fora", () => {
  assert.deepEqual(Object.keys(GAMES).sort(), ["arrows", "canos", "chess", "cruzadas", "dama", "patches", "queens", "sopa", "sudoku", "tango", "texttwist", "zip"]);
  assert.deepEqual(Object.keys(SOLO_GAMES).sort(), ["arrows", "canos", "cruzadas", "patches", "queens", "sopa", "sudoku", "tango", "texttwist", "zip"]);
  assert.equal(typeof chess.generatePuzzle, "undefined", "xadrez não gera fase: só duelo");
  assert.equal(typeof dama.generatePuzzle, "undefined", "dama não gera fase: só duelo");
});

test("a Edge aceita todo jogo SOLO do catálogo (lista vem do board, não fixa)", () => {
  /* Regressão: a Edge tinha uma lista fixa de jogos e, depois de Queens/Tango/Text Twist entrarem no
     catálogo, respondia `unknown_game` para eles — o desafio diário nunca abria. */
  const entry = read("supabase/functions/play/index.ts");
  assert.match(entry, /const GAME_IDS = new Set\(Object\.keys\(SOLO_GAMES\)\)/,
    "GAME_IDS precisa ser derivado de SOLO_GAMES para acompanhar jogos novos (sem incluir o xadrez)");
  assert.doesNotMatch(entry, /const GAME_IDS = new Set\(\[/,
    "não fixe a lista de jogos na Edge Function: ela desatualiza e recusa jogos novos");
  assert.deepEqual(Object.keys(CATALOG).sort(), Object.keys(GAMES).sort(),
    "todo jogo do catálogo do hub precisa de domínio em _shared/board.js");
});

/* ---------- duelos 1×1: contrato DUEL declarado no domínio ---------- */
test("contrato DUEL: corrida e turnos aceitam só regras conhecidas; a lista sai do board", () => {
  assert.deepEqual(duelContract({ DUEL: { rule: "first", maxSeconds: 120 } }), { rule: "first", maxSeconds: 120 });
  assert.deepEqual(duelContract({ DUEL: { rule: "words", maxSeconds: 90 } }), { rule: "words", maxSeconds: 90 });
  assert.deepEqual(duelContract({ DUEL: { kind: "turn", times: [3, 10, 30, 60] } }), { kind: "turn", times: [3, 10, 30, 60] });
  assert.deepEqual(duelContract({ DUEL: { kind: "turn", times: [0, 90, 10.5, 5] } }), { kind: "turn", times: [5] }, "só minutos inteiros de 1 a 60");
  assert.equal(duelContract({ DUEL: { kind: "turn", times: [] } }), null, "sem ritmo válido não é duelo");
  assert.equal(duelContract({ DUEL: { rule: "elo", maxSeconds: 90 } }), null, "regra desconhecida é recusada");
  assert.equal(duelContract({}), null);
  assert.equal(duelContract(undefined), null);
  assert.equal(duelOf("nao_existe"), null);
});

test("só xadrez e dama declaram DUEL (jogos antigos não viram multiplayer)", () => {
  /* Decisão de produto: os jogos que já estão no site não viram multiplayer.
     Xadrez e dama foram criados PARA o duelo; por isso são os únicos com contrato e com `duel` no catálogo. */
  const turn = { kind: "turn", times: [3, 10, 30, 60] };
  for (const g of Object.keys(GAMES)) {
    if (g === "chess" || g === "dama") assert.deepEqual(duelOf(g), turn);
    else assert.equal(duelOf(g), null, `${g} não deveria ser jogo de duelo`);
  }
  assert.deepEqual(DUELS, { chess: turn, dama: turn });
});

test("catálogo e domínios concordam sobre quais jogos são de duelo", () => {
  /* O hub mostra a entrada de duelo pelo `duel` do catálogo; a Edge decide pelo `DUEL` do domínio.
     Se os dois divergirem, o hub oferece um duelo que a Edge recusa (ou esconde um que funciona). */
  for (const id of Object.keys(CATALOG)) {
    assert.equal(Boolean(CATALOG[id].duel), Boolean(duelOf(id)), `${id}: catálogo e domínio divergem sobre DUEL`);
  }
});

test("o roteador da Edge leva TODA ação de duelo (duel_* e chess_*) até o handleDuel", () => {
  /* Regressão: chess_create/chess_state/chess_move/... não começam com "duel_" e voltavam `unknown_game`. */
  const entry = read("supabase/functions/play/index.ts");
  const set = entry.match(/const DUEL_ACTIONS = new Set\(\[([\s\S]*?)\]\)/)?.[1];
  assert.ok(set, "DUEL_ACTIONS não encontrado");
  const actions = [...set.matchAll(/"([a-z_]+)"/g)].map(m => m[1]);
  assert.ok(actions.includes("chess_create") && actions.includes("duel_list"));

  const route = entry.match(/if \(typeof action === "string" && \(([^\n]*?)\)\) \{\s*return await handleDuel/)?.[1];
  assert.ok(route, "roteamento para handleDuel não encontrado");
  const prefixes = [...route.matchAll(/action\.startsWith\("([a-z_]+)"\)/g)].map(m => m[1]);
  for (const a of actions) {
    assert.ok(prefixes.some(p => a.startsWith(p)), `${a} nunca chegaria ao handleDuel (prefixos roteados: ${prefixes.join(", ")})`);
  }
});

test("a Edge atende o aviso de desafiante: convites, desistir, retomar a sala e presença", () => {
  const entry = read("supabase/functions/play/index.ts");
  const set = entry.match(/const DUEL_ACTIONS = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? "";
  for (const a of ["duel_invites", "duel_decline", "duel_mine"]) {
    assert.ok(set.includes(`"${a}"`), `${a} fora do DUEL_ACTIONS`);
  }

  // Convites e retomada vêm do uid autenticado: o cliente não escolhe de quem consulta.
  assert.match(entry, /rpc\("duel_invites", \{ p_uid: uid \}\)/);
  assert.match(entry, /rpc\("duel_mine", \{ p_uid: uid, p_game: game \}\)/);
  assert.match(entry, /\/\^\[a-z0-9_-\]\{1,32\}\$\/\.test\(game\)/, "o jogo da consulta é validado");
  assert.match(entry, /return json\(data \?\? \{ duel: null \}\)/, "sem duelo ativo a resposta é { duel: null }");

  // Desistir passa pelo mesmo caminho dos demais RPCs de sala (uid + duelo).
  assert.match(entry, /action === "duel_decline"/);

  // Presença: só a consulta de estado de uma sala em espera carimba, e falhar nunca derruba a resposta.
  assert.match(entry, /action === "chess_state" && data\?\.status === "waiting"\) await touchPresence/);
  assert.match(entry, /action === "dama_state" && data\?\.status === "waiting"\) await touchPresence/);
  assert.match(entry, /action === "duel_state" && data\?\.status === "waiting"\) await touchPresence/);
  assert.match(entry, /rpc\("duel_touch", \{ p_uid: uid, p_duel: duelId \}\)/);
  assert.match(entry, /try \{ await svc\.rpc\("duel_touch"[\s\S]*?\} catch \{/, "presença é só um aviso");

  // O erro da guarda do desafiante ausente é 409 (o cliente mostra a mensagem própria).
  assert.match(entry, /msg === "opponent_away" \? 409/);
});

test("a Edge expõe as ações de duelo e valida o tabuleiro antes de finalizar", () => {
  const entry = read("supabase/functions/play/index.ts");
  const board = read("supabase/functions/play/_shared/board.js");

  assert.match(board, /export const duelOf = game => duelContract\(GAMES\[game\]\)/,
    "o contrato de duelo precisa ser lido do domínio, não de uma lista fixa");
  assert.doesNotMatch(entry, /const DUEL_GAMES = new Set\(\[/, "não fixe a lista de jogos de duelo na Edge");

  for (const a of [
    "duel_create", "duel_join", "duel_join_open", "duel_ready", "duel_start", "duel_state", "duel_finish", "duel_leave", "duel_list",
    "chess_create", "chess_start", "chess_state", "chess_move", "chess_resign",
    "dama_create", "dama_start", "dama_state", "dama_move", "dama_resign",
  ]) {
    assert.match(entry, new RegExp(`action === "${a}"`), `${a} ausente na Edge`);
  }

  // Sala aberta/fechada: a visibilidade é escolha do cliente e chega às funções de criação.
  assert.match(entry, /const open = body\?\.open !== false/, "open é booleano, aberto por padrão");
  assert.match(entry, /p_open: open/, "a Edge manda p_open para o Postgres");
  assert.match(entry, /rpc\("duel_join_open", \{ p_uid: uid, p_duel: room \}\)/, "entrar pela lista usa o id da sala");

  // Só jogo com DUEL pode criar sala.
  assert.match(entry, /const duel = duelOf\(game\);\s*if \(!duel\) return json\(\{ error: "not_duel_game" \}, 400\)/,
    "duel_create precisa recusar jogo sem contrato DUEL");

  // O tabuleiro é validado contra o full_puzzle guardado, antes do RPC.
  assert.match(entry, /validateSnapshot\(row\.game_id, row\.full_puzzle, state\)/,
    "duel_finish precisa validar o tabuleiro");
  assert.match(entry, /validatePartial\(row\.game_id, row\.full_puzzle, state\)/,
    "regra words aceita fim de rodada por tempo");
  assert.match(entry, /rpc\("duel_finish", \{\s*p_uid: uid, p_duel: duelId, p_op: body\?\.op \?\? null,/,
    "a Edge precisa chamar duel_finish com a chave de idempotência");

  // O puzzle não pode ser entregue antes da largada: quem decide é o Postgres (duel_start).
  assert.doesNotMatch(entry, /p_public: body\?\./, "o cliente nunca manda o puzzle do duelo");

  // Xadrez: a Edge valida o lance com o domínio puro e manda o novo estado; vez/relógio/versão ficam no Postgres.
  assert.match(entry, /findMove\(state, body\?\.move\)/, "chess_move precisa validar o lance com o domínio");
  assert.match(entry, /rpc\("chess_move", \{/, "chess_move precisa chamar a função do Postgres");
  assert.match(entry, /p_version: row\.version/, "o lance leva a versão lida para o Postgres recusar corrida");
  assert.match(entry, /canMate\(next\.state\.board, "w"\)/, "a Edge grava se as brancas ainda podem dar mate (FIDE 6.9)");

  // Dama: mesmo fluxo, com a posição serializada; não existe "material insuficiente".
  assert.match(entry, /findDamaMove\(state, body\?\.move\)/, "dama_move precisa validar o lance com o domínio");
  assert.match(entry, /rpc\("dama_move", \{/, "dama_move precisa chamar a função do Postgres");
  assert.match(entry, /p_position: toPosition\(next\.state\)/, "dama_move manda a posição serializada");
  assert.match(entry, /if \(duel\.kind === "turn"\) return json\(\{ error: "use_chess_create" \}, 400\)/,
    "duel_create não pode criar sala de corrida para um jogo de turnos");
});
