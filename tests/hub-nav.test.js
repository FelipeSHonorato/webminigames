/* Menu lateral do hub: contadores, filtro e hash. Só a parte pura — o DOM fica em `js/hub.js`. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  MODES, DEFAULT_MODE, isDuel, normalizeMode,
  navItems, filterGames, modeFromHash, hashFor, modeText,
} from "../shared/hub-nav.js";
import { GAMES as CATALOG } from "../js/games.js";

const GAMES = {
  zip: { path: "games/zip/" },
  dueloA: { path: "games/dueloA/", duel: true },
  sudoku: { path: "games/sudoku/" },
  dueloB: { path: "games/dueloB/", duel: true },
};

test("hub: a lateral conta todos, solo e duelos", () => {
  assert.deepEqual(navItems(GAMES), [
    { mode: "all", label: "Todos", count: 4 },
    { mode: "solo", label: "Solo", count: 2 },
    { mode: "duel", label: "Duelos 1×1", count: 2 },
  ]);
  assert.deepEqual(navItems({}), [
    { mode: "all", label: "Todos", count: 0 },
    { mode: "solo", label: "Solo", count: 0 },
    { mode: "duel", label: "Duelos 1×1", count: 0 },
  ]);
});

test("hub: só `duel: true` conta como jogo de duelo", () => {
  assert.equal(isDuel({ duel: true }), true);
  assert.equal(isDuel({ duel: "true" }), false, "string não vale: o catálogo usa booleano");
  assert.equal(isDuel({}), false);
  assert.equal(isDuel(null), false);
});

test("hub: o filtro preserva a ordem do catálogo e não mexe no objeto", () => {
  const ids = mode => filterGames(GAMES, mode).map(([id]) => id);
  assert.deepEqual(ids("all"), ["zip", "dueloA", "sudoku", "dueloB"]);
  assert.deepEqual(ids("solo"), ["zip", "sudoku"]);
  assert.deepEqual(ids("duel"), ["dueloA", "dueloB"]);
  assert.deepEqual(ids("qualquer"), ["zip", "dueloA", "sudoku", "dueloB"], "modo inválido cai em Todos");
  assert.deepEqual(Object.keys(GAMES), ["zip", "dueloA", "sudoku", "dueloB"], "o catálogo fica intacto");
});

test("hub: #solo e #duelos levam e trazem o modo", () => {
  assert.equal(modeFromHash("#solo"), "solo");
  assert.equal(modeFromHash("solo"), "solo");
  assert.equal(modeFromHash("#duelos"), "duel");
  assert.equal(modeFromHash("#duel"), "duel");
  assert.equal(modeFromHash(""), "all");
  assert.equal(modeFromHash("#qualquer"), "all");
  assert.equal(modeFromHash("#DUELOS"), "duel", "o hash não diferencia maiúsculas");
  assert.equal(hashFor("solo"), "#solo");
  assert.equal(hashFor("duel"), "#duelos");
  assert.equal(hashFor("all"), "", "Todos não suja o endereço");
});

test("hub: modo inválido cai em Todos", () => {
  assert.equal(DEFAULT_MODE, "all");
  assert.deepEqual(MODES, ["all", "solo", "duel"]);
  for (const mode of MODES) assert.equal(normalizeMode(mode), mode);
  assert.equal(normalizeMode("multi"), "all");
  assert.equal(normalizeMode(undefined), "all");
});

test("hub: cada modo tem título e subtítulo próprios", () => {
  assert.equal(modeText("all").title, "Todos os jogos");
  assert.equal(modeText("solo").title, "Jogos solo");
  assert.equal(modeText("duel").title, "Duelos 1×1");
  for (const mode of MODES) assert.ok(modeText(mode).sub.length > 20, `${mode} sem subtítulo`);
});

test("hub: o catálogo atual não tem duelo — só jogos novos entram no 1×1", () => {
  const items = navItems(CATALOG);
  assert.equal(items[0].count, Object.keys(CATALOG).length);
  assert.equal(items[2].count, 0, "nenhum jogo atual declara duel: true");
  assert.deepEqual(filterGames(CATALOG, "duel"), []);
  assert.equal(filterGames(CATALOG, "solo").length, Object.keys(CATALOG).length);
});
