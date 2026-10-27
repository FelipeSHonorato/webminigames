/* Testes da ajuda de dificuldades e níveis: conteúdo gerado e montagem sem DOM. */
import test from "node:test";
import assert from "node:assert/strict";
import { levelHelpRows, mountLevelHelp } from "../shared/level-help.js";
import { LEVEL_NAMES, WINS_PER_LEVEL } from "../shared/progress.js";

test("ajuda de níveis: lista os quatro níveis com 1 ponto por vitória e a meta", () => {
  const rows = levelHelpRows();
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map(row => row.name), LEVEL_NAMES);
  assert.ok(rows.every(row => row.points === 1));
  assert.ok(rows.every(row => row.wins === WINS_PER_LEVEL));
});

test("ajuda de níveis: sem DOM, montar devolve null em vez de quebrar", () => {
  assert.equal(mountLevelHelp({ trigger: "levelHelp" }), null);
});
