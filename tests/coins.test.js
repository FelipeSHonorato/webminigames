import test from "node:test";
import assert from "node:assert/strict";
import { store } from "../shared/storage.js";
import { Coins, DAY_MS } from "../shared/coins.js";
import { Run } from "../shared/run.js";

const T0 = Date.UTC(2026, 9, 7, 12, 0, 0);
const reset = () => { store.set("wmg.coins", "{}"); store.set("wmg.run", "{}"); };

test("primeiro acesso: 2 coins por jogo, cada jogo com o seu saldo", () => {
  reset();
  assert.equal(Coins.get("u1", "zip", T0).coins, 2);
  assert.equal(Coins.spend("u1", "zip", T0), true);
  assert.equal(Coins.get("u1", "zip", T0).coins, 1);
  assert.equal(Coins.get("u1", "patches", T0).coins, 2);      // outro jogo, saldo intacto
  assert.equal(Coins.get("u2", "zip", T0).coins, 2);          // outro usuário, saldo intacto
});
test("sem coin não gasta (nunca fica negativo)", () => {
  reset();
  assert.ok(Coins.spend("u1", "zip", T0) && Coins.spend("u1", "zip", T0));
  assert.equal(Coins.spend("u1", "zip", T0), false);
  assert.equal(Coins.get("u1", "zip", T0).coins, 0);
});
test("recarga só depois de 24 h e volta ao máximo de 2 (sem acumular)", () => {
  reset();
  Coins.get("u1", "zip", T0); Coins.spend("u1", "zip", T0); Coins.spend("u1", "zip", T0);
  assert.equal(Coins.get("u1", "zip", T0 + DAY_MS - 1).coins, 0);                // faltando 1 ms
  const after = Coins.get("u1", "zip", T0 + DAY_MS);
  assert.equal(after.coins, 2);
  assert.equal(after.nextRefillAt, T0 + 2 * DAY_MS);                              // cadência fixa de 24 h
  assert.equal(Coins.get("u1", "zip", T0 + 5 * DAY_MS + 3600e3).coins, 2);        // dias sem jogar não acumulam
  Coins.spend("u1", "zip", T0 + 5 * DAY_MS + 3600e3);
  assert.equal(Coins.get("u1", "zip", T0 + 5 * DAY_MS + 7200e3).coins, 1);
});
test("próxima recarga informada ao jogador", () => {
  reset();
  assert.equal(Coins.get("u1", "zip", T0).nextRefillAt, T0 + DAY_MS);
});
test("a fase atual fica salva por seed", () => {
  reset();
  assert.equal(Run.get("u1", "zip"), null);
  Run.set("u1", "zip", { seed: 123, level: 0, solved: false });
  Run.set("u1", "zip", { seed: 123, level: 0, solved: true });
  assert.deepEqual(Run.get("u1", "zip"), { seed: 123, level: 0, solved: true });
  assert.equal(Run.get("u1", "patches"), null);
});
