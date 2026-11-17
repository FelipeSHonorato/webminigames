/* Templates visuais dos jogos de duelo e multijogador: registro, seleção, prévias e ligação nas páginas. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  DEFAULT_ID, STORAGE_KEY, CHANGE_EVENT, TEMPLATE_GAMES, TEMPLATES,
  listTemplates, getSelected, setSelected, selectionOf, slotsOf, templateGameIds,
} from "../shared/templates.js";
import { renderPreview, previewKindsOf, ONITAMA_SAMPLE_CARDS } from "../shared/template-previews.js";
import { store } from "../shared/storage.js";
import { GAMES as CATALOG } from "../js/games.js";
import { CARDS } from "../games/onitama/domain.js";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const reset = () => store.remove(STORAGE_KEY);

test("templates: todo jogo de duelo e multijogador do catálogo tem seletor, e só eles", () => {
  const wanted = Object.entries(CATALOG).filter(([, g]) => g.duel || g.party).map(([id]) => id).sort();
  assert.deepEqual(templateGameIds().sort(), wanted);
});

test("templates: cada espaço tem só a opção Default, por enquanto", () => {
  for (const game of templateGameIds()) {
    assert.ok(slotsOf(game).length >= 2, `${game}: tabuleiro/mesa + peças/cartas`);
    for (const slot of slotsOf(game)) {
      assert.deepEqual(listTemplates(game, slot.id).map(o => o.id), [DEFAULT_ID], `${game}/${slot.id}`);
      assert.equal(listTemplates(game, slot.id)[0].name, "Default");
    }
  }
  assert.deepEqual(listTemplates("jogo-inexistente", "board"), []);
});

test("templates: jogos de cartas têm mesa + cartas; jogos de tabuleiro têm tabuleiro + peças", () => {
  const ids = game => slotsOf(game).map(s => s.id);
  assert.deepEqual(ids("truco"), ["board", "cards"]);
  assert.deepEqual(ids("uno"), ["board", "cards"]);
  for (const game of ["chess", "dama", "gamao", "go"]) assert.deepEqual(ids(game), ["board", "pieces"]);
  assert.deepEqual(ids("onitama"), ["board", "pieces", "cards"]);
});

test("templates: o registro é imutável", () => {
  assert.throws(() => { "use strict"; TEMPLATES.chess.board.push({ id: "x" }); });
  assert.throws(() => { "use strict"; listTemplates("uno", "cards")[0].name = "outro"; });
});

test("seleção: começa na Default e grava/recupera a escolha", () => {
  reset();
  assert.deepEqual(selectionOf("chess"), { board: DEFAULT_ID, pieces: DEFAULT_ID });
  assert.equal(setSelected("chess", "board", DEFAULT_ID), true);
  assert.equal(getSelected("chess", "board"), DEFAULT_ID);
  assert.ok(JSON.parse(store.get(STORAGE_KEY)).chess);
  reset();
});

test("seleção: template, espaço ou jogo inexistente é recusado e nada é gravado", () => {
  reset();
  assert.equal(setSelected("chess", "board", "gatinhos"), false);
  assert.equal(setSelected("chess", "cards", DEFAULT_ID), false);
  assert.equal(setSelected("nao-existe", "board", DEFAULT_ID), false);
  assert.equal(store.get(STORAGE_KEY), null);
});

test("seleção: id salvo que não existe mais (template removido) volta para a Default", () => {
  store.set(STORAGE_KEY, JSON.stringify({ uno: { cards: "removido" } }));
  assert.equal(getSelected("uno", "cards"), DEFAULT_ID);
  store.set(STORAGE_KEY, "lixo{{");
  assert.equal(getSelected("uno", "cards"), DEFAULT_ID);
  store.set(STORAGE_KEY, "[1,2]");
  assert.equal(getSelected("uno", "cards"), DEFAULT_ID);
  reset();
});

test("seleção: um jogo não afeta o outro", () => {
  reset();
  setSelected("chess", "board", DEFAULT_ID);
  setSelected("dama", "pieces", DEFAULT_ID);
  const saved = JSON.parse(store.get(STORAGE_KEY));
  assert.deepEqual(Object.keys(saved).sort(), ["chess", "dama"]);
  assert.deepEqual(saved.chess, { board: DEFAULT_ID });
  reset();
});

test("templates: setSelected avisa a página com wmg:template-change", () => {
  const events = [];
  globalThis.window = { dispatchEvent: e => events.push(e) };
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init.detail; } };
  try {
    reset();
    setSelected("go", "pieces", DEFAULT_ID);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, CHANGE_EVENT);
    assert.deepEqual(events[0].detail, { game: "go", slot: "pieces", id: DEFAULT_ID });
    setSelected("go", "pieces", "inexistente");
    assert.equal(events.length, 1, "escolha recusada não dispara evento");
  } finally { delete globalThis.window; delete globalThis.CustomEvent; reset(); }
});

/* ---------- Prévias ---------- */

test("prévias: todo espaço de todo jogo tem uma prévia da Default", () => {
  for (const game of templateGameIds()) {
    assert.deepEqual(previewKindsOf(game).sort(), [...new Set(slotsOf(game).map(s => s.kind))].sort(), game);
    for (const slot of slotsOf(game)) {
      const html = renderPreview(game, slot.kind, DEFAULT_ID, { base: "./" });
      assert.ok(html.length > 200, `${game}/${slot.id} sem prévia`);
    }
  }
  assert.equal(renderPreview("chess", "cards"), "");
  assert.equal(renderPreview("nao-existe", "board"), "");
});

test("prévias: SVG acessível, sem <defs>/url(#), sem script e sem recurso externo", () => {
  for (const game of templateGameIds()) for (const slot of slotsOf(game)) {
    const html = renderPreview(game, slot.kind);
    for (const svg of html.match(/<svg[\s\S]*?<\/svg>/g) ?? []) {
      assert.match(svg, /role="img"/, `${game}/${slot.id}`);
      assert.match(svg, /aria-label="[^"]+"/, `${game}/${slot.id}`);
    }
    const semNamespace = html.replaceAll('xmlns="http://www.w3.org/2000/svg"', "");   // o namespace não é recurso externo
    assert.doesNotMatch(semNamespace, /<defs|url\(#|<script|javascript:|https?:\/\//i, `${game}/${slot.id}`);
  }
});

test("prévias: usam as variáveis de tema do jogo, com valor de reserva", () => {
  assert.match(renderPreview("chess", "board"), /var\(--light,#f0d9b5\)/);
  assert.match(renderPreview("dama", "board"), /var\(--dark,#b58863\)/);
  assert.match(renderPreview("onitama", "board"), /var\(--gold,#f2c94c\)/);
  assert.match(renderPreview("truco", "board"), /var\(--felt-1,#246d4d\)/);
});

test("prévias: as cartas do UNO apontam para arquivos que existem e respeitam o `base`", () => {
  for (const kind of ["board", "cards"]) {
    const html = renderPreview("uno", kind, DEFAULT_ID, { base: "./" });
    const files = [...html.matchAll(/src="\.\/cards\/([^"]+)"/g)].map(m => m[1]);
    assert.ok(files.length >= 2, kind);
    for (const file of files) assert.ok(existsSync(new URL(`../games/uno/cards/${file}`, import.meta.url)), file);
  }
  assert.match(renderPreview("uno", "cards", DEFAULT_ID, { base: "../uno/" }), /src="\.\.\/uno\/cards\//);
});

test("prévias: as cartas de exemplo do Onitama são as do domínio", () => {
  const byName = Object.values(CARDS);
  for (const sample of ONITAMA_SAMPLE_CARDS) {
    const real = byName.find(c => c.name === sample.name);
    assert.ok(real, sample.name);
    assert.deepEqual(sample.moves, real.moves, sample.name);
    assert.equal(sample.stamp, real.stamp, sample.name);
  }
});

test("prévias: o Truco mostra as quatro manilhas (4♣ 7♥ A♠ 7♦)", () => {
  const html = renderPreview("truco", "cards");
  for (const suit of ["♣", "♥", "♠", "♦"]) assert.ok(html.includes(suit), suit);
});

/* ---------- Ligação nas páginas ---------- */

test("páginas: o botão Template fica ao lado de Criar sala online e o seletor é montado", () => {
  for (const game of templateGameIds()) {
    const html = read(`games/${game}/index.html`);
    assert.match(html, /id="createRoom"[^>]*>Criar sala online<\/button>\s*<button id="templateBtn" class="secondary" type="button" aria-haspopup="dialog">Template<\/button>/, game);
    assert.match(html, /css\/template-picker\.css/, game);
    assert.equal((html.match(/id="templateBtn"/g) ?? []).length, 1, game);
    const ui = read(`games/${game}/ui.js`);
    assert.match(ui, /import \{ mountTemplatePicker \} from "\.\.\/\.\.\/shared\/template-picker\.js";/, game);
    assert.match(ui, /mountTemplatePicker\(\{ game: GAME_ID \}\);/, game);
  }
});

test("páginas: o id do jogo no seletor é o mesmo GAME_ID de cada ui.js", () => {
  for (const game of templateGameIds()) {
    assert.match(read(`games/${game}/ui.js`), new RegExp(`const GAME_ID = "${game}";`), game);
  }
});

test("páginas: jogos solo não ganham o botão Template", () => {
  for (const [id, g] of Object.entries(CATALOG)) {
    if (g.duel || g.party) continue;
    assert.doesNotMatch(read(`${g.path}index.html`), /templateBtn/, id);
  }
});

test("css: o pop-up só usa tokens que os jogos de duelo e multijogador definem", () => {
  const css = read("css/template-picker.css");
  const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map(m => m[1]));
  for (const game of templateGameIds()) {
    const style = read(`games/${game}/style.css`);
    for (const token of used) assert.match(style, new RegExp(`${token}:`), `${game} não define ${token}`);
  }
});
