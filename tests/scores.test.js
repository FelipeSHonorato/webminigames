import test from "node:test";
import assert from "node:assert/strict";
import { store } from "../shared/storage.js";
import { Scores } from "../shared/scores.js";
import { pointsFor } from "../shared/progress.js";

const login = (id, name, region, provider = "password") => store.set("wmg.session", JSON.stringify({ id, name, region, provider }));
const reset = () => { store.set("wmg.scores", "{}"); store.set("wmg.session", "null"); };

test("pontos por nível: Fácil 5, Médio 10, Difícil 15, Genius 20", () => {
  assert.deepEqual([0, 1, 2, 3].map(pointsFor), [5, 10, 15, 20]);
});
test("anônimo não pontua nem entra no ranking", async () => {
  reset(); login("a1", "Anônimo", null, "anonymous");
  assert.equal(Scores.canRank(), false);
  assert.equal(await Scores.submit("zip", 5), null);
  assert.equal((await Scores.leaderboard("zip")).total, 0);
});
test("pontos acumulam por jogo e cada jogo tem o seu ranking", async () => {
  reset(); login("u1", "Ana", "sudeste");
  await Scores.submit("zip", 5); await Scores.submit("zip", 20); await Scores.submit("patches", 10);
  assert.equal((await Scores.leaderboard("zip")).top[0].points, 25);
  assert.equal((await Scores.leaderboard("patches")).top[0].points, 10);
});
test("ordena por pontos, desempata por quem chegou primeiro e filtra por região", async () => {
  reset();
  login("u1", "Ana", "sudeste"); await Scores.submit("zip", 10);
  await new Promise(r => setTimeout(r, 5));
  login("u2", "Bia", "sul"); await Scores.submit("zip", 10);
  login("u3", "Caio", "sudeste"); await Scores.submit("zip", 30);
  login("u2", "Bia", "sul");
  const all = await Scores.leaderboard("zip");
  assert.deepEqual(all.top.map(r => r.name), ["Caio", "Ana", "Bia"]);          // empate Ana x Bia: Ana primeiro
  assert.equal(all.me.rank, 3);
  const regional = await Scores.leaderboard("zip", { scope: "region" });
  assert.deepEqual(regional.top.map(r => r.name), ["Bia"]);                    // só a região "sul"
});

test("ranking geral soma os pontos de todos os jogos e traz a foto de cada jogador", async () => {
  reset();
  login("u1", "Ana", "sul"); await Scores.submit("zip", 20); await Scores.submit("patches", 15);
  login("u2", "Bia", "sudeste"); await Scores.submit("zip", 30);
  store.set("wmg.profiles", JSON.stringify({ u1: { avatar: "data:image/png;base64,AAA", nickname: "Aninha" } }));
  const o = await Scores.overall();
  assert.deepEqual(o.top.map(r => [r.name, r.points]), [["Aninha", 35], ["Bia", 30]]);
  assert.ok(o.top[0].avatar.startsWith("data:image/") && o.top[1].avatar === null);
  assert.equal(o.me.rank, 2);                                                      // usuário atual: Bia
  assert.deepEqual((await Scores.overall({ scope: "region" })).top.map(r => r.name), ["Bia"]);
  assert.equal((await Scores.leaderboard("zip")).top[0].avatar, null);             // a foto também vai no ranking de cada jogo (Bia, sem foto)
});
