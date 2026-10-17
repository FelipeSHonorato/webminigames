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
  await assert.rejects(Auth.register({ name: "Intruso", email: ADMIN_EMAIL, password: "Intruso123", region: "sul" }), /Já existe uma conta/);
});
test("contas comuns não são administradoras", async () => {
  reset();
  const s = await Auth.register({ name: "Ana", email: "ana@example.com", password: "Segredo1", region: "sul" });
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

/* ----- Nível por jogo, escolhido pelo administrador ----- */
import { AdminLevel } from "../shared/admin-level.js";
import { Run } from "../shared/run.js";
import { Progress, WINS_PER_LEVEL, LEVEL_NAMES, winsForLevel, winsKey } from "../shared/progress.js";
import { GAMES } from "../js/games.js";

const admin = { id: ADMIN_ID, name: "administrador" };
const resetLevels = () => { reset(); store.set("wmg.run", "{}"); for (const g of Object.values(GAMES)) for (const u of [ADMIN_ID, "u1"]) store.set(winsKey(g.key, u), "0"); };

test("winsForLevel: início de cada nível (0, 15, 30, 45), com limites e entrada estranha tratados", () => {
  assert.deepEqual([0, 1, 2, 3].map(i => winsForLevel(i)), [0, WINS_PER_LEVEL, 2 * WINS_PER_LEVEL, 3 * WINS_PER_LEVEL]);
  assert.equal(winsForLevel(-2), 0);
  assert.equal(winsForLevel(99), 3 * WINS_PER_LEVEL);
  assert.equal(winsForLevel(NaN), 0);
});

test("AdminLevel.set coloca o administrador no início do nível escolhido, em cada jogo", () => {
  resetLevels();
  for (const [id, g] of Object.entries(GAMES)) for (let lv = 0; lv < LEVEL_NAMES.length; lv++) {
    AdminLevel.set(admin, id, g.key, lv);
    assert.equal(AdminLevel.get(admin, g.key), lv, `${id} nível ${lv}`);
    assert.equal(Progress.wins(g.key, ADMIN_ID), lv * WINS_PER_LEVEL, `${id}: 0/${WINS_PER_LEVEL} no nível`);
  }
});

test("AdminLevel.set descarta só a fase salva do administrador naquele jogo (a próxima nasce no nível novo)", () => {
  resetLevels();
  Run.set(ADMIN_ID, "zip", { seed: 1, level: 0, solved: false });
  Run.set(ADMIN_ID, "sudoku", { seed: 2, level: 0, solved: true });
  Run.set("u1", "zip", { seed: 3, level: 0, solved: false });
  AdminLevel.set(admin, "zip", GAMES.zip.key, 3);
  assert.equal(Run.get(ADMIN_ID, "zip"), null);
  assert.deepEqual(Run.get(ADMIN_ID, "sudoku"), { seed: 2, level: 0, solved: true });   // outro jogo intacto
  assert.deepEqual(Run.get("u1", "zip"), { seed: 3, level: 0, solved: false });          // outro jogador intacto
  Run.clear(ADMIN_ID, "zip"); Run.clear("ninguem", "zip");                               // limpar o que não existe não quebra
});

test("AdminLevel.set não mexe em outros jogadores, em pontos nem em rankings", async () => {
  resetLevels();
  store.set("wmg.session", JSON.stringify({ id: "u1", name: "Ana", provider: "password", region: "sul" }));
  store.set(winsKey(GAMES.zip.key, "u1"), "20");
  await Scores.submit("zip", 10);
  const before = [await Scores.leaderboard("zip"), await Scores.overall()];
  AdminLevel.set(admin, "zip", GAMES.zip.key, 2);
  assert.equal(Progress.wins(GAMES.zip.key, "u1"), 20);
  assert.deepEqual([await Scores.leaderboard("zip"), await Scores.overall()], before);
});

test("só o administrador escolhe o nível; nível inválido é recusado e nada muda", () => {
  resetLevels();
  Run.set(ADMIN_ID, "zip", { seed: 1, level: 0, solved: false });
  for (const s of [{ id: "u1", name: "Ana" }, null, undefined]) assert.throws(() => AdminLevel.set(s, "zip", GAMES.zip.key, 3), /administrador/);
  for (const bad of [-1, 4, 1.5, "2", NaN, undefined]) assert.throws(() => AdminLevel.set(admin, "zip", GAMES.zip.key, bad), /inválido/);
  assert.equal(Progress.wins(GAMES.zip.key, ADMIN_ID), 0);
  assert.deepEqual(Run.get(ADMIN_ID, "zip"), { seed: 1, level: 0, solved: false });
});

test("depois de escolher o nível, vencer fases soma vitórias sem trocar de nível até completar o nível", () => {
  resetLevels();
  AdminLevel.set(admin, "sopa", GAMES.sopa.key, 1);
  store.set(winsKey(GAMES.sopa.key, ADMIN_ID), String(Progress.wins(GAMES.sopa.key, ADMIN_ID) + 14));
  assert.equal(AdminLevel.get(admin, GAMES.sopa.key), 1);
  store.set(winsKey(GAMES.sopa.key, ADMIN_ID), String(Progress.wins(GAMES.sopa.key, ADMIN_ID) + 1));
  assert.equal(AdminLevel.get(admin, GAMES.sopa.key), 2);          // 15 vitórias no nível sobem para o próximo, como para qualquer jogador
});

test("o catálogo (js/games.js) usa a mesma chave de vitórias e o mesmo nº de níveis de cada jogo", async () => {
  for (const [id, g] of Object.entries(GAMES)) {
    const d = await import(`../games/${id}/domain.js`);
    assert.equal(g.key, d.STORE_KEY, `${id}: chave de vitórias`);
    assert.equal(d.LEVELS.length, LEVEL_NAMES.length, `${id}: níveis`);
  }
});
