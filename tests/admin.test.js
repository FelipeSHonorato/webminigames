import test from "node:test";
import assert from "node:assert/strict";
import { store } from "../shared/storage.js";
import { Auth } from "../js/auth.js";
import { Coins, DAY_MS } from "../shared/coins.js";
import { GameSwitch, gameAllowed } from "../shared/game-switch.js";
import { Scores } from "../shared/scores.js";
import { ADMIN_ID, ADMIN_EMAIL, isAdmin } from "../shared/roles.js";

const T0 = Date.UTC(2026, 9, 7, 12);
const reset = () => ["wmg.users", "wmg.coins", "wmg.scores", "wmg.games", "wmg.profiles"].forEach(k => store.set(k, "{}")) || store.set("wmg.session", "null");

test("o administrador entra com o e-mail e a senha definidos e tem o nome 'administrador'", async () => {
  reset();
  assert.equal(ADMIN_EMAIL, "administrador@administrador.com.br");
  const s = await Auth.login({ email: "administrador@administrador.com.br", password: "administrador" });
  assert.equal(s.name, "administrador");
  assert.equal(s.id, ADMIN_ID);
  assert.ok(isAdmin(s));
  await assert.rejects(Auth.login({ email: ADMIN_EMAIL, password: "outra-senha" }), /incorretos/);
});
test("ninguém consegue cadastrar o e-mail do administrador", async () => {
  reset();
  await assert.rejects(Auth.register({ name: "Intruso", email: ADMIN_EMAIL, password: "123456", region: "sul" }), /Já existe uma conta/);
});
test("contas comuns não são administradoras", async () => {
  reset();
  const s = await Auth.register({ name: "Ana", email: "ana@example.com", password: "segredo1", region: "sul" });
  assert.equal(isAdmin(s), false);
  assert.equal(gameAllowed("zip", s), true);
});
test("o administrador começa com 99999 coins por jogo, perde ao jogar e recarrega em 24 h", () => {
  reset();
  assert.equal(Coins.get(ADMIN_ID, "zip", T0).coins, 99999);
  assert.equal(Coins.get(ADMIN_ID, "patches", T0).coins, 99999);
  Coins.spend(ADMIN_ID, "zip", T0); Coins.spend(ADMIN_ID, "zip", T0);
  assert.equal(Coins.get(ADMIN_ID, "zip", T0).coins, 99997);
  assert.equal(Coins.get(ADMIN_ID, "patches", T0).coins, 99999);
  assert.equal(Coins.get(ADMIN_ID, "zip", T0 + DAY_MS).coins, 99999);
  assert.equal(Coins.get("u-comum", "zip", T0).coins, 2);                       // demais contas continuam com 2
});
test("desligar um jogo bloqueia jogadores, libera o administrador e NÃO remove pontos", async () => {
  reset();
  store.set("wmg.session", JSON.stringify({ id: "u1", name: "Ana", provider: "password", region: "sul" }));
  await Scores.submit("zip", 20); await Scores.submit("patches", 10);
  const before = [await Scores.leaderboard("zip"), await Scores.overall()];
  assert.equal(GameSwitch.isOn("zip"), true);
  GameSwitch.set("zip", false);
  assert.equal(GameSwitch.isOn("zip"), false);
  assert.equal(gameAllowed("zip", { id: "u1" }), false);
  assert.equal(gameAllowed("zip", { id: ADMIN_ID }), true);
  assert.equal(gameAllowed("patches", { id: "u1" }), true);                      // o outro jogo segue ligado
  assert.deepEqual([await Scores.leaderboard("zip"), await Scores.overall()], before);   // rankings intactos
  assert.equal(Scores.mine().zip.points, 20);                                    // pontos do usuário intactos
  GameSwitch.set("zip", true);
  assert.equal(GameSwitch.isOn("zip"), true);
});
