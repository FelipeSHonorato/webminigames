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
  await Auth.register({ name: "Ana", email: "ana@example.com", password: "Segredo1", region: "sul" });
  await assert.rejects(Auth.changePassword({ current: "errada", next: "Novasenha1" }), /atual está incorreta/);
  await assert.rejects(Auth.changePassword({ current: "Segredo1", next: "123" }), /pelo menos 8/);
  await assert.rejects(Auth.changePassword({ current: "Segredo1", next: "Segredo1" }), /diferente/);
  await Auth.changePassword({ current: "Segredo1", next: "Novasenha1" });
  await assert.rejects(Auth.login({ email: "ana@example.com", password: "Segredo1" }), /incorretos/);
  assert.equal((await Auth.login({ email: "ana@example.com", password: "Novasenha1" })).name, "Ana");
});

test("anônimo e Google (simulação) não trocam senha", async () => {
  reset(); Auth.loginAnonymous();
  await assert.rejects(Auth.changePassword({ current: "x", next: "123456" }), /não usa senha/);
});

test("anônimo sempre aparece como \"Anônimo\", mesmo em sessão antiga", () => {
  assert.equal(Profile.displayName({ id: "a1", name: "Visitante", provider: "anonymous" }), "Anônimo");
  assert.equal(Profile.displayName({ id: "u9", name: "Ana", provider: "password" }), "Ana");
});

test("região: pode ser trocada em qualquer conta e vale para a sessão, o cadastro e o ranking", async () => {
  reset();
  await Auth.register({ name: "Ana", email: "ana@example.com", password: "Segredo1", region: "sul" });
  const s = Auth.current();
  await Scores.submit("zip", 10);                    // cria a linha do ranking na região "sul"
  assert.equal(await Profile.setRegion(s.id, "nordeste"), "nordeste");
  assert.equal(JSON.parse(store.get("wmg.session")).region, "nordeste");                       // a sessão passa a ter a nova região
  assert.equal(JSON.parse(store.get("wmg.users"))["ana@example.com"].region, "nordeste");      // o cadastro local guarda a nova região
  assert.equal(JSON.parse(store.get("wmg.scores"))[s.id].region, "nordeste");                  // a linha do ranking muda de região
  assert.equal((await Scores.leaderboard("zip", { scope: "region" })).top.length, 1);
  await assert.rejects(async () => Profile.setRegion(s.id, "marte"), /região/);
});

test("excluir a conta local exige a senha e apaga os dados do jogador", async () => {
  reset();
  await Auth.register({ name: "Ana", email: "ana@example.com", password: "Segredo1", region: "sul" });
  const s = Auth.current();
  Profile.setNickname(s.id, "Aninha");
  await Scores.submit("zip", 10);
  Activity.played(s.id, "zip");
  store.set(`zip.wins:${s.id}`, "7");

  await assert.rejects(Auth.deleteAccount({ password: "errada" }), /Senha incorreta/);
  assert.ok(Auth.current(), "com a senha errada, a sessão continua");

  await Auth.deleteAccount({ password: "Segredo1" });
  assert.equal(Auth.current(), null, "a sessão foi encerrada");
  assert.equal(JSON.parse(store.get("wmg.users"))["ana@example.com"], undefined, "a conta saiu do cadastro");
  assert.equal(Profile.get(s.id).nickname, undefined, "o apelido foi apagado");
  assert.equal(JSON.parse(store.get("wmg.scores"))[s.id], undefined, "os pontos foram apagados");
  assert.equal(store.get(`zip.wins:${s.id}`), null, "as vitórias foram apagadas");
  await assert.rejects(Auth.login({ email: "ana@example.com", password: "Segredo1" }), /incorretos/);
});

test("excluir conta: anônimo não tem conta para excluir", async () => {
  reset(); await Auth.loginAnonymous();
  await assert.rejects(Auth.deleteAccount({ password: "x" }), /não tem conta/);
});

test("recuperar senha: no modo local avisa que só existe na nuvem", async () => {
  reset();
  await assert.rejects(Auth.resetPassword("ana@example.com"), /nuvem/);
  await assert.rejects(Auth.resetPassword("sem-arroba"), /e-mail válido/);
});
