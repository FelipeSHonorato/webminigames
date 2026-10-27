/* Testes da ajuda de dificuldades e níveis: conteúdo gerado e montagem sem DOM. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { levelHelpRows, mountLevelHelp } from "../shared/level-help.js";
import { LEVEL_NAMES, WINS_PER_LEVEL } from "../shared/progress.js";

const GAMES = ["arrows", "canos", "cruzadas", "patches", "queens", "sopa", "sudoku", "tango", "texttwist", "zip"];
const gameFile = (game, name) => readFileSync(new URL(`../games/${game}/${name}`, import.meta.url), "utf8");

test("ajuda de níveis: lista os quatro níveis com o que muda em cada um", () => {
  const details = ["Grade 5×5", "Grade 6×6", "Grade 7×7", "Grade 8×8"];
  const rows = levelHelpRows(details);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map(row => row.name), LEVEL_NAMES);
  assert.deepEqual(rows.map(row => row.detail), details);
  assert.ok(rows.every(row => row.wins === WINS_PER_LEVEL));
});

test("ajuda de níveis: sem descrição, a linha fica vazia em vez de quebrar", () => {
  assert.ok(levelHelpRows().every(row => row.detail === ""));
});

test("ajuda de níveis: sem DOM, montar devolve null em vez de quebrar", () => {
  assert.equal(mountLevelHelp({ trigger: "levelHelp" }), null);
});

test("ajuda de níveis: todos os jogos têm o ? e não usam mais o parágrafo .help", () => {
  for (const game of GAMES) {
    const html = gameFile(game, "index.html");
    assert.match(html, /id="levelHelp"/, `${game}: falta #levelHelp`);
    assert.match(html, /class="level-title"/, `${game}: falta .level-title`);
    assert.doesNotMatch(html, /class="help"/, `${game}: ainda tem .help`);

    const ui = gameFile(game, "ui.js");
    assert.match(ui, /mountLevelHelp\(\{ trigger: "levelHelp"/, `${game}: falta mountLevelHelp`);
    assert.doesNotMatch(ui, /pointsLegend/, `${game}: ainda usa pointsLegend`);
  }
});
