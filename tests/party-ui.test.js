/* Helpers puros do painel multijogador (shared/party-ui.js): bloco ativo, faixa da vez e rótulos dos jogadores. */
import test from "node:test";
import assert from "node:assert/strict";
import { partyView, turnBanner, playerTags } from "../shared/party-ui.js";

const fake = (over = {}) => ({
  status: "running", started: true,
  party: { order: "turns", turnSeat: 2 },
  me: () => ({ seat: 1, out: false }),
  turnPlayer: () => ({ nickname: "Bob" }),
  msToTurnEnd: () => 23000,
  ...over,
});

test("partyView escolhe o bloco certo do painel", () => {
  assert.equal(partyView({ status: "waiting" }), "lobby");
  assert.equal(partyView({ status: "idle" }), "lobby");
  assert.equal(partyView({ status: "running", started: false }), "countdown");
  assert.equal(partyView({ status: "running", started: true }), "running");
  assert.equal(partyView({ status: "finished" }), "result");
  assert.equal(partyView({ status: "cancelled" }), "result");
});

test("turnBanner: minha vez, vez de outro, modo livre, eliminado, sem limite de tempo", () => {
  assert.equal(turnBanner(fake()), "Vez de Bob · 00:23");
  assert.equal(turnBanner(fake({ party: { order: "turns", turnSeat: 1 } })), "Sua vez · 00:23");
  assert.equal(turnBanner(fake({ msToTurnEnd: () => null })), "Vez de Bob", "sem limite de tempo não mostra relógio");
  assert.equal(turnBanner(fake({ party: { order: "free" } })), "Todos jogam ao mesmo tempo");
  assert.equal(turnBanner(fake({ me: () => ({ seat: 1, out: true }) })), "Você saiu da partida");
  assert.equal(turnBanner(fake({ status: "waiting" })), "", "fora de jogo não há faixa");
  assert.equal(turnBanner(fake({ started: false })), "", "durante a contagem também não");
  assert.equal(turnBanner(fake({ turnPlayer: () => null })), "");
});

test("playerTags: criador, pronto, ausente, fora e colocação", () => {
  assert.deepEqual(playerTags({ host: true, ready: true }, "waiting"), ["Criador", "Pronto"]);
  assert.deepEqual(playerTags({ ready: false, away: true }, "waiting"), ["Ausente"]);
  assert.deepEqual(playerTags({ out: true }, "running"), ["Fora"]);
  assert.deepEqual(playerTags({ ready: true }, "running"), [], "em jogo 'pronto' não importa");
  assert.deepEqual(playerTags({ host: true, placement: 1 }, "finished"), ["1º", "Criador"]);
  assert.deepEqual(playerTags({ out: true, placement: 3 }, "finished"), ["3º", "Fora"]);
});
