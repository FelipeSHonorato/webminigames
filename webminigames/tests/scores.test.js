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
  reset(); login("a1", "Visitante", null, "anonymous");
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
