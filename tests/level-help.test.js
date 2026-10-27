/* Testes da ajuda de dificuldades e níveis: conteúdo gerado e montagem sem DOM. */
import test from "node:test";
import assert from "node:assert/strict";
import { levelHelpRows, mountLevelHelp } from "../shared/level-help.js";
import { LEVEL_NAMES, WINS_PER_LEVEL } from "../shared/progress.js";

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
