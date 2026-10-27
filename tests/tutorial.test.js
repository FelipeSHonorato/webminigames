/* Testes do tutorial animado: navegação entre passos e sanidade do conteúdo dos jogos. */
import test from "node:test";
import assert from "node:assert/strict";
import { clampStep, isLastStep, mountTutorial, stepLabel } from "../shared/tutorial.js";
import { ZIP_TUTORIAL } from "../games/zip/tutorial.js";
import { TEXTTWIST_TUTORIAL } from "../games/texttwist/tutorial.js";

test("tutorial: índice do passo fica sempre dentro da lista", () => {
  assert.equal(clampStep(-5, 4), 0);
  assert.equal(clampStep(0, 4), 0);
  assert.equal(clampStep(2, 4), 2);
  assert.equal(clampStep(9, 4), 3);
  assert.equal(clampStep(0, 0), 0);
  assert.equal(clampStep(NaN, 4), 0);
});

test("tutorial: último passo e rótulo começam em 1", () => {
  assert.equal(isLastStep(3, 4), true);
  assert.equal(isLastStep(2, 4), false);
  assert.equal(isLastStep(0, 1), true);
  assert.equal(stepLabel(0, 4), "Passo 1 de 4");
  assert.equal(stepLabel(3, 4), "Passo 4 de 4");
  assert.equal(stepLabel(0, 0), "Passo 1 de 1");
});

test("tutorial: sem DOM, montar devolve null em vez de quebrar", () => {
  assert.equal(mountTutorial({ trigger: "howto", steps: [{ title: "a", text: "b", demo: "c" }] }), null);
});

for (const [name, tutorial] of [["Zip", ZIP_TUTORIAL], ["Text Twist", TEXTTWIST_TUTORIAL]]) {
  test(`tutorial de ${name}: passos completos, sem script e sem recurso externo`, () => {
    assert.equal(typeof tutorial.title, "string");
    assert.ok(tutorial.steps.length >= 3 && tutorial.steps.length <= 5, `${name}: ${tutorial.steps.length} passos`);
    for (const [i, step] of tutorial.steps.entries()) {
      assert.ok(step.title?.trim(), `${name} passo ${i + 1}: título vazio`);
      assert.ok(step.text?.trim(), `${name} passo ${i + 1}: texto vazio`);
      assert.ok(step.demo?.trim(), `${name} passo ${i + 1}: demo vazia`);
      assert.ok(!/<script/i.test(step.demo), `${name} passo ${i + 1}: demo com script`);
      assert.ok(!/https?:\/\//i.test(step.demo), `${name} passo ${i + 1}: demo com URL externa`);
    }
  });
}
