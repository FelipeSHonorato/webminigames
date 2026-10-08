import test from "node:test";
import assert from "node:assert/strict";
import { store } from "../shared/storage.js";
import { Profile, Activity } from "../shared/profile.js";
import { Scores } from "../shared/scores.js";
import { Auth } from "../js/auth.js";

const reset = () => ["wmg.users", "wmg.profiles", "wmg.activity", "wmg.scores"].forEach(k => store.set(k, "{}")) || store.set("wmg.session", "null");

test("apelido: valida formato, é único sem diferenciar maiúsculas e pode ser removido", () => {
  reset();
  assert.equal(Profile.setNickname("u1", "  Ana   Lima "), "Ana Lima");
  assert.throws(() => Profile.setNickname("u2", "ab"), /3 a 20/);
  assert.throws(() => Profile.setNickname("u2", "<b>x</b>"), /3 a 20/);
  assert.throws(() => Profile.setNickname("u2", "ANA LIMA"), /já está em uso/);
  assert.equal(Profile.setNickname("u1", "ana lima"), "ana lima");         // o próprio dono pode trocar a caixa
  assert.equal(Profile.setNickname("u1", ""), "");
  assert.equal(Profile.get("u1").nickname, undefined);
});

test("o ranking mostra o apelido no lugar do nome do cadastro", async () => {
  reset();
  store.set("wmg.session", JSON.stringify({ id: "u1", name: "Ana Souza", provider: "password", region: "sul" }));
  await Scores.submit("zip", 10);
  assert.equal((await Scores.leaderboard("zip")).top[0].name, "Ana Souza");
  Profile.setNickname("u1", "Aninha");
  assert.equal((await Scores.leaderboard("zip")).top[0].name, "Aninha");
  assert.equal(Scores.mine().zip.points, 10);
});

test("atividade guarda o último horário e a quantidade de partidas por jogo", () => {
  reset();
  Activity.played("u1", "zip"); Activity.played("u1", "zip"); Activity.played("u1", "patches");
  const a = Activity.all("u1");
  assert.equal(a.zip.plays, 2);
  assert.ok(a.zip.lastPlayedAt > 0 && a.patches.plays === 1);
  assert.deepEqual(Activity.all("outro"), {});
});

test("troca de senha exige a atual e a nova passa a valer", async () => {
  reset();
  await Auth.register({ name: "Ana", email: "ana@example.com", password: "segredo1", region: "sul" });
  await assert.rejects(Auth.changePassword({ current: "errada", next: "novasenha" }), /atual está incorreta/);
  await assert.rejects(Auth.changePassword({ current: "segredo1", next: "123" }), /pelo menos 6/);
  await assert.rejects(Auth.changePassword({ current: "segredo1", next: "segredo1" }), /diferente/);
  await Auth.changePassword({ current: "segredo1", next: "novasenha" });
  await assert.rejects(Auth.login({ email: "ana@example.com", password: "segredo1" }), /incorretos/);
  assert.equal((await Auth.login({ email: "ana@example.com", password: "novasenha" })).name, "Ana");
});

test("anônimo e Google (simulação) não trocam senha", async () => {
  reset(); Auth.loginAnonymous();
  await assert.rejects(Auth.changePassword({ current: "x", next: "123456" }), /não usa senha/);
});
