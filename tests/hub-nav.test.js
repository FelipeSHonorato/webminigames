/* Menu lateral do hub: contadores, filtro e hash. Só a parte pura — o DOM fica em `js/hub.js`. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  MODES, DEFAULT_MODE, isDuel, normalizeMode,
  navItems, filterGames, modeFromHash, hashFor, modeText, rankingPanels,
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
  assert.equal(modeText("duel").sub, "Jogos com duelos jogador x jogador. Jogue com um adversário valendo pontuação no ranking ou somente por diversão.");
  for (const mode of MODES) assert.ok(modeText(mode).sub.length > 20, `${mode} sem subtítulo`);
});

test("hub: xadrez, dama, gamão e Go são duelos — os jogos antigos continuam solo", () => {
  const items = navItems(CATALOG);
  assert.equal(items[0].count, Object.keys(CATALOG).length);
  assert.equal(items[2].count, 4, "xadrez, dama, gamão e Go declaram duel: true");
  assert.deepEqual(filterGames(CATALOG, "duel").map(([id]) => id), ["chess", "dama", "gamao", "go"]);
  assert.equal(filterGames(CATALOG, "solo").length, Object.keys(CATALOG).length - 4);
});

test("hub: painel lateral é Solo fora dos duelos e um por jogo no carrossel", () => {
  const panels = {
    chess: { title: "Xadrez", duel: true },
    dama: { title: "Dama", duel: true },
    gamao: { title: "Gamão", duel: true },
    go: { title: "Go", duel: true },
    zip: { title: "Zip" },
  };
  for (const mode of ["all", "solo"]) {
    const solo = rankingPanels(panels, mode);
    assert.equal(solo.length, 1);
    assert.equal(solo[0].gameId, null);
    assert.equal(solo[0].title, "Ranking Geral - Solo");
    assert.match(solo[0].sub, /pontuação/);
  }

  const duel = rankingPanels(panels, "duel");
  assert.deepEqual(duel.map(p => p.gameId), ["chess", "dama", "gamao", "go"]);
  assert.deepEqual(duel.map(p => p.title), ["Ranking Geral Xadrez", "Ranking Geral Dama", "Ranking Geral Gamão", "Ranking Geral Go"]);
  assert.match(duel[0].sub, /Elo/, "o xadrez usa Elo");
  assert.match(duel[1].sub, /Elo/, "a dama usa o mesmo Elo, com ranking próprio");
  assert.match(duel[2].sub, /Elo/, "o gamão usa o mesmo Elo, com ranking próprio");
  assert.match(duel[3].sub, /Kyu/, "o Go usa Kyu/Dan");
  assert.match(duel[3].sub, /Dan/);
  assert.match(duel[3].sub, /handicap/i);
  assert.equal(rankingPanels(panels, "duel")[0].gameId, "chess");
  assert.deepEqual(rankingPanels({}, "duel"), []);
  assert.equal(rankingPanels(CATALOG, "duel")[0].title, "Ranking Geral Xadrez");
});
