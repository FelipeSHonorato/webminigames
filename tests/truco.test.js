/* Testes do Truco Paulista: baralho, manilhas, distribuição, vazas, empates, truco, mão de onze,
   mão de ferro, fim de partida, sigilo da visão, tempo e contrato PARTY. O domínio é puro e roda no Node e na Edge. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  PARTY, TARGET, TEAM_NAMES, buildDeck, cardName, cardOf, cardShort, isManilha, manilhaName,
  nextTrucoValue, partyMove, partyStart, partyView, placements, strengthOf, teamOf, timeoutTurn,
} from "../games/truco/domain.js";
import { makeRng } from "../shared/rng.js";

const stateOf = (over = {}) => ({
  hands: [["3-clubs", "4-hearts", "5-clubs"], ["2-clubs", "6-hearts", "7-clubs"]],
  points: [0, 0],
  handNo: 1,
  handValue: 1,
  pending: null,
  phase: "playing",
  maoDeOnze: null,
  maoDeOnzeSeat: null,
  maoDeOnzeHand: false,
  maoDeFerro: false,
  trucoLocked: false,
  nextRaiser: null,
  raiseReady: true,
  leader: 1,
  turn: 1,
  round: 1,
  roundLeader: 1,
  roundWins: [0, 0],
  table: [],
  roundResults: [],
  last: null,
  lastHand: null,
  plays: [],
  winner: null,
  winnerTeam: null,
  ranking: null,
  seed: 123456789,
  ...over,
});

/** Mesa de 4 jogadores em duplas (1 & 3 contra 2 & 4). */
const stateOf4 = (over = {}) => stateOf({
  hands: [
    ["3-clubs", "2-hearts", "A-clubs"],
    ["2-clubs", "A-hearts", "K-clubs"],
    ["3-hearts", "2-spades", "K-hearts"],
    ["4-diamonds", "5-hearts", "6-clubs"],
  ],
  ...over,
});

/** Joga uma vaza com um lance por assento, na ordem dada. */
const playSeats = (state, plays, ctx = {}) => {
  let current = state;
  let result = null;
  for (const [seat, card] of plays) {
    result = partyMove(current, seat, { action: "play", card }, ctx);
    assert.ok(result, `carta inválida: assento ${seat}, ${card}`);
    current = result.state;
  }
  return result;
};

/** Joga uma vaza inteira (assento 1 e depois o assento 2, ou vice-versa). */
const playRound = (state, firstSeat, firstCard, secondSeat, secondCard) => {
  const first = partyMove(state, firstSeat, { action: "play", card: firstCard });
  assert.ok(first, `primeira carta inválida: ${firstCard}`);
  const second = partyMove(first.state, secondSeat, { action: "play", card: secondCard });
  assert.ok(second, `segunda carta inválida: ${secondCard}`);
  return second;
};

/* ---------- baralho, manilhas e força ---------- */

test("truco: baralho de 40 cartas únicas, sem 8, 9 e 10", () => {
  const deck = buildDeck();
  assert.equal(deck.length, 40);
  assert.equal(new Set(deck).size, 40);
  assert.ok(deck.every(id => cardOf(id)));
  for (const rank of ["8", "9", "10"]) assert.equal(deck.some(id => id.startsWith(`${rank}-`)), false, `${rank} não existe no baralho`);
  assert.equal(deck.filter(id => cardOf(id).rank === "3").length, 4, "quatro 3, um por naipe");
  assert.equal(deck.filter(id => cardOf(id).rank === "4").length, 4, "quatro 4, um por naipe");
});

test("truco: ids inválidos e nomes das cartas", () => {
  for (const id of [null, "", "8-clubs", "3-stars", "3-clubs-1", "10-hearts"]) assert.equal(cardOf(id), null, `${id} deveria ser inválido`);
  assert.equal(cardName("4-clubs"), "4 de paus (Zap)");
  assert.equal(cardName("7-hearts"), "7 de copas (Copeta)");
  assert.equal(cardName("A-spades"), "A de espadas (Espadilha)");
  assert.equal(cardName("7-diamonds"), "7 de ouros (Pica-fumo)");
  assert.equal(cardName("3-clubs"), "3 de paus");
  assert.equal(cardShort("7-hearts"), "7♥");
  assert.equal(cardShort("A-spades"), "A♠");
  assert.equal(cardShort("nao-existe"), "?");
});

test("truco: ordem das manilhas e das cartas comuns é a do Truco Paulista", () => {
  const order = [
    "4-clubs", "7-hearts", "A-spades", "7-diamonds",
    "3-clubs", "2-clubs", "A-clubs", "K-clubs", "J-clubs", "Q-clubs", "7-clubs", "6-clubs", "5-clubs", "4-hearts",
  ];
  for (let i = 1; i < order.length; i++) {
    assert.ok(strengthOf(order[i - 1]) > strengthOf(order[i]), `${order[i - 1]} deveria vencer ${order[i]}`);
  }
  assert.equal(isManilha("4-clubs"), true);
  assert.equal(manilhaName("4-clubs"), "Zap");
  assert.equal(manilhaName("7-hearts"), "Copeta");
  assert.equal(manilhaName("A-spades"), "Espadilha");
  assert.equal(manilhaName("7-diamonds"), "Pica-fumo");
  assert.equal(isManilha("3-clubs"), false);
  assert.equal(manilhaName("3-clubs"), null);
  assert.equal(strengthOf("3-clubs"), strengthOf("3-hearts"), "mesmo valor, mesma força (empate)");
});

/* ---------- distribuição ---------- */

test("truco: 1×1 recebe 3 cartas cada, sem repetir e com seed no estado", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { state, turn } = partyStart({ seats: [1, 2], rng: makeRng(seed) });
    assert.equal(state.hands.length, 2);
    assert.equal(state.hands[0].length, 3);
    assert.equal(state.hands[1].length, 3);
    assert.equal(new Set(state.hands.flat()).size, 6, "nenhuma carta repete na distribuição");
    assert.ok(state.hands.flat().every(id => cardOf(id)));
    assert.equal(state.points[0], 0);
    assert.equal(state.points[1], 0);
    assert.equal(state.handNo, 1);
    assert.equal(state.handValue, 1);
    assert.equal(state.turn, 1);
    assert.equal(turn, 1);
    assert.equal(state.phase, "playing");
    assert.ok(Number.isInteger(state.seed));
  }
});

test("truco: 2×2 recebe 3 cartas para cada um dos 4 assentos, sem repetir", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { state, turn } = partyStart({ seats: [1, 2, 3, 4], rng: makeRng(seed) });
    assert.equal(state.hands.length, 4);
    assert.ok(state.hands.every(hand => hand.length === 3), "cada jogador recebe 3 cartas");
    assert.equal(new Set(state.hands.flat()).size, 12, "nenhuma carta repete na distribuição de 4 jogadores");
    assert.ok(state.hands.flat().every(id => cardOf(id)));
    assert.deepEqual(state.points, [0, 0], "o placar é por dupla");
    assert.deepEqual(state.roundWins, [0, 0]);
    assert.equal(state.handNo, 1);
    assert.equal(state.handValue, 1);
    assert.equal(state.turn, 1);
    assert.equal(turn, 1);
    assert.equal(state.phase, "playing");
    assert.ok(Number.isInteger(state.seed));
  }
});

test("truco: partyStart aceita só mesas de 2 ou 4 jogadores e exige rng", () => {
  assert.throws(() => partyStart({ seats: [1], rng: makeRng(1) }), /bad_players/);
  assert.throws(() => partyStart({ seats: [1, 2, 3], rng: makeRng(1) }), /bad_players/);
  assert.throws(() => partyStart({ seats: [1, 2, 3, 4, 5], rng: makeRng(1) }), /bad_players/);
  assert.throws(() => partyStart({ seats: [2, 3], rng: makeRng(1) }), /bad_players/, "assentos precisam ser 1..n");
  assert.throws(() => partyStart({ seats: [1, 2] }), /rng/);
  assert.ok(partyStart({ seats: [1, 2], rng: makeRng(1) }).state);
  assert.ok(partyStart({ seats: [1, 2, 3, 4], rng: makeRng(1) }).state);
});

/* ---------- vazas, empates e pontos ---------- */

test("truco: melhor de 3 — 1ª e 2ª vazas decidem a mão", () => {
  const state = stateOf({
    hands: [["3-clubs", "3-hearts", "5-clubs"], ["2-clubs", "3-diamonds", "6-clubs"]],
  });
  const round1 = playRound(state, 1, "3-clubs", 2, "2-clubs");
  assert.equal(round1.state.round, 2);
  assert.equal(round1.turn, 1, "quem venceu a vaza abre a próxima");
  assert.deepEqual(round1.state.roundWins, [1, 0]);
  assert.equal(round1.state.roundResults[0].winner, 1);

  const round2 = playRound(round1.state, 1, "3-hearts", 2, "3-diamonds");
  assert.equal(round2.state.lastHand.rounds[1].tie, true, "mesmo valor empata a vaza");
  assert.equal(round2.state.points[0], 1, "com a 1ª vazas e a 2ª empatada, o assento 1 vence a mão");
  assert.equal(round2.state.handNo, 2);
  assert.equal(round2.state.phase, "playing");
  assert.equal(round2.state.lastHand.winner, 1);
  assert.equal(round2.state.lastHand.points, 1);
});

test("truco: empate na 1ª e vitória na 2ª encerram a mão", () => {
  const state = stateOf({
    hands: [["3-clubs", "2-hearts", "5-clubs"], ["3-hearts", "3-diamonds", "6-clubs"]],
  });
  const round1 = playRound(state, 1, "3-clubs", 2, "3-hearts");
  assert.equal(round1.state.roundResults[0].tie, true);
  assert.equal(round1.turn, 1, "quem abriu a vaza empatada abre a próxima");

  const round2 = playRound(round1.state, 1, "2-hearts", 2, "3-diamonds");
  assert.equal(round2.state.points[1], 1, "o assento 2 vence a mão");
  assert.equal(round2.state.lastHand.winner, 2);
});

test("truco: 1×1 nas vazas leva à terceira; empate na 3ª dá a mão a quem venceu a 1ª", () => {
  const state = stateOf({
    hands: [["3-clubs", "2-hearts", "3-spades"], ["4-hearts", "3-diamonds", "3-hearts"]],
  });
  const round1 = playRound(state, 1, "3-clubs", 2, "4-hearts");
  const round2 = playRound(round1.state, 1, "2-hearts", 2, "3-diamonds");
  assert.equal(round2.state.round, 3);
  assert.deepEqual(round2.state.roundWins, [1, 1]);

  const round3 = playRound(round2.state, 2, "3-hearts", 1, "3-spades");
  assert.equal(round3.state.lastHand.rounds[2].tie, true);
  assert.equal(round3.state.points[0], 1, "a 1ª vaza desempata a 3ª");
  assert.equal(round3.state.lastHand.winner, 1);
});

test("truco: as três vazas empatadas não dão ponto e a próxima mão é normal", () => {
  const state = stateOf({
    hands: [["3-clubs", "2-clubs", "A-clubs"], ["3-hearts", "2-hearts", "A-hearts"]],
  });
  const round1 = playRound(state, 1, "3-clubs", 2, "3-hearts");
  const round2 = playRound(round1.state, 1, "2-clubs", 2, "2-hearts");
  const round3 = playRound(round2.state, 1, "A-clubs", 2, "A-hearts");
  assert.equal(round3.state.points[0], 0);
  assert.equal(round3.state.points[1], 0);
  assert.equal(round3.state.lastHand.winner, null);
  assert.equal(round3.state.lastHand.reason, "tie");
  assert.equal(round3.state.handNo, 2);
  assert.equal(round3.state.phase, "playing");
  assert.equal(round3.state.handValue, 1);
});

test("truco: manilha vence 3 e carta igual de outro naipe empata", () => {
  const state = stateOf({
    hands: [["3-clubs", "4-clubs", "5-clubs"], ["3-hearts", "A-spades", "6-clubs"]],
  });
  const round1 = playRound(state, 1, "3-clubs", 2, "3-hearts");
  assert.equal(round1.state.roundResults[0].tie, true);
  const round2 = playRound(round1.state, 1, "4-clubs", 2, "A-spades");
  assert.equal(round2.state.lastHand.rounds[1].winner, 1, "4♣ (zap) vence A♠ (espadilha)");
  assert.equal(round2.state.points[0], 1);
});

/* ---------- truco, retruco e correr ---------- */

test("truco: pedido vai para o adversário e o aceite mantém a vez de quem pediu", () => {
  const state = stateOf();
  const ask = partyMove(state, 1, { action: "truco" });
  assert.ok(ask);
  assert.equal(ask.turn, 2);
  assert.equal(ask.state.handValue, 1, "o valor só sobe quando o adversário aceita");
  assert.deepEqual(ask.state.pending, { seat: 1, responder: 2, value: 3, stake: 1, resumeTurn: 1 });

  const accept = partyMove(ask.state, 2, { action: "accept" });
  assert.equal(accept.turn, 1);
  assert.equal(accept.state.handValue, 3);
  assert.equal(accept.state.pending, null);
  assert.equal(accept.state.nextRaiser, 2, "quem aceitou pode pedir o próximo aumento");
  assert.equal(partyMove(accept.state, 1, { action: "truco" }), null, "quem pediu não aumenta em seguida");
});

test("truco: correr entrega o valor que estava valendo e encerra a mão", () => {
  const state = stateOf({ handValue: 3 });
  const ask = partyMove(state, 1, { action: "truco" });
  assert.deepEqual(ask.state.pending, { seat: 1, responder: 2, value: 6, stake: 3, resumeTurn: 1 });
  const fold = partyMove(ask.state, 2, { action: "fold" });
  assert.equal(fold.state.points[0], 3, "quem pediu recebe os 3 que já valiam");
  assert.equal(fold.state.handNo, 2);
  assert.equal(fold.state.handValue, 1, "a próxima mão volta a valer 1");
  assert.equal(fold.state.lastHand.reason, "fold");
});

test("truco: retruco vira o pedido para o outro lado e correr entrega o valor intermediário", () => {
  const state = stateOf();
  const truco = partyMove(state, 1, { action: "truco" });
  const retruco = partyMove(truco.state, 2, { action: "raise" });
  assert.ok(retruco);
  assert.equal(retruco.turn, 1);
  assert.deepEqual(retruco.state.pending, { seat: 2, responder: 1, value: 6, stake: 3, resumeTurn: 1 });

  const fold = partyMove(retruco.state, 1, { action: "fold" });
  assert.equal(fold.state.points[1], 3, "o assento 2 recebe o valor que já valia antes do retruco");
  assert.equal(partyMove(fold.state, 1, { action: "truco" }), null, "a mão seguinte começa do zero");
});

test("truco: aceitar o retruco sobe para 6 e a mão pode seguir normalmente", () => {
  const state = stateOf();
  const truco = partyMove(state, 1, { action: "truco" });
  const retruco = partyMove(truco.state, 2, { action: "raise" });
  const accept = partyMove(retruco.state, 1, { action: "accept" });
  assert.equal(accept.state.handValue, 6);
  assert.equal(accept.turn, 1);
  assert.equal(accept.state.nextRaiser, 1);
  assert.equal(partyMove(accept.state, 1, { action: "truco" }), null, "precisa jogar uma carta antes de aumentar de novo");
  const play = partyMove(accept.state, 1, { action: "play", card: "3-clubs" });
  assert.equal(play.turn, 2, "o jogo continua");
});

test("truco: não se pede truco nas mãos especiais nem acima de 12", () => {
  assert.equal(partyMove(stateOf({ handValue: 12 }), 1, { action: "truco" }), null);
  assert.equal(partyMove(stateOf({ trucoLocked: true }), 1, { action: "truco" }), null);
  assert.equal(nextTrucoValue(1), 3);
  assert.equal(nextTrucoValue(3), 6);
  assert.equal(nextTrucoValue(6), 9);
  assert.equal(nextTrucoValue(9), 12);
  assert.equal(nextTrucoValue(12), null);
});

/* ---------- mão de onze, mão de ferro e fim de partida ---------- */

test("truco: chegar a 11 abre a mão de onze (vale 3, sem truco) e jogar pode vencer a partida", () => {
  const state = stateOf({
    points: [10, 5],
    hands: [["3-clubs", "3-hearts", "5-clubs"], ["2-clubs", "3-diamonds", "6-clubs"]],
  });
  const round1 = playRound(state, 1, "3-clubs", 2, "2-clubs");
  const round2 = playRound(round1.state, 1, "3-hearts", 2, "3-diamonds");
  assert.equal(round2.state.points[0], 11);
  assert.equal(round2.state.phase, "mao");
  assert.equal(round2.state.maoDeOnze, 1);
  assert.equal(round2.state.maoDeOnzeHand, true);
  assert.equal(round2.state.handValue, 3);
  assert.equal(round2.state.trucoLocked, true);
  assert.equal(round2.turn, 1);

  const view = partyView(round2.state, 1);
  assert.equal(view.canChooseMao, true);
  assert.equal(view.canTruco, false);

  const play = partyMove(round2.state, 1, { action: "mao", choice: "play" });
  assert.equal(play.state.phase, "playing");
  assert.equal(play.state.handValue, 3);
  assert.equal(play.turn, 1);

  const r1 = playRound(play.state, 1, play.state.hands[0][0], 2, play.state.hands[1][0]);
  const r2 = playRound(r1.state, 1, r1.state.hands[0][0], 2, r1.state.hands[1][0]);
  assert.equal(r2.state.winner, 1);
  assert.equal(r2.state.phase, "over");
  assert.deepEqual(r2.state.ranking, [[1], [2]]);
  assert.equal(r2.state.turn, null);
});

test("truco: correr da mão de onze entrega 1 ponto e não repete a mão especial", () => {
  const state = stateOf({ points: [10, 5], hands: [["3-clubs", "3-hearts", "5-clubs"], ["2-clubs", "3-diamonds", "6-clubs"]] });
  const round1 = playRound(state, 1, "3-clubs", 2, "2-clubs");
  const round2 = playRound(round1.state, 1, "3-hearts", 2, "3-diamonds");
  const fold = partyMove(round2.state, 1, { action: "mao", choice: "fold" });
  assert.equal(fold.state.points[0], 11);
  assert.equal(fold.state.points[1], 6);
  assert.equal(fold.state.phase, "playing");
  assert.equal(fold.state.maoDeOnze, null);
  assert.equal(fold.state.handValue, 1, "a próxima mão volta a valer 1");
  assert.equal(fold.state.lastHand.reason, "mao_fold");
});

test("truco: os dois em 11 jogam a mão de ferro visível valendo 3", () => {
  const state = stateOf({
    points: [11, 10],
    hands: [["2-clubs", "4-hearts", "6-clubs"], ["3-clubs", "3-hearts", "5-clubs"]],
  });
  const round1 = playRound(state, 1, "2-clubs", 2, "3-clubs");
  const round2 = playRound(round1.state, 2, "3-hearts", 1, "4-hearts");
  assert.equal(round2.state.points[0], 11);
  assert.equal(round2.state.points[1], 11);
  assert.equal(round2.state.maoDeFerro, true);
  assert.equal(round2.state.handValue, 3);
  assert.equal(round2.state.trucoLocked, true);
  assert.equal(round2.state.phase, "playing");
  assert.equal(partyView(round2.state, 1).canTruco, false);
});

test("truco: a partida termina ao alcançar 12 pontos", () => {
  const state = stateOf({
    points: [10, 0],
    handValue: 3,
    hands: [["3-clubs", "3-hearts", "5-clubs"], ["2-clubs", "3-diamonds", "6-clubs"]],
  });
  const round1 = playRound(state, 1, "3-clubs", 2, "2-clubs");
  const round2 = playRound(round1.state, 1, "3-hearts", 2, "3-diamonds");
  assert.equal(round2.state.points[0], 13);
  assert.equal(round2.state.winner, 1);
  assert.equal(round2.state.phase, "over");
  assert.deepEqual(round2.state.ranking, [[1], [2]]);
  assert.deepEqual(placements(round2.state.ranking), { 1: 1, 2: 2 });
  assert.equal(partyMove(round2.state, 1, { action: "play", card: "5-clubs" }), null);
});

/* ---------- visão e tempo ---------- */

test("truco: a visão entrega a própria mão e a mesa, sem seed nem mão alheia", () => {
  const state = stateOf({
    hands: [["3-clubs", "4-hearts", "5-clubs"], ["7-hearts", "A-spades", "2-diamonds"]],
    table: [{ seat: 2, card: "6-clubs" }],
    turn: 1,
    round: 1,
    plays: [{ seat: 2, action: "play", card: "6-clubs" }],
  });
  const view = partyView(state, 1);
  assert.deepEqual(view.hand, ["3-clubs", "4-hearts", "5-clubs"]);
  assert.deepEqual(view.points, [0, 0]);
  assert.deepEqual(view.counts, [
    { seat: 1, team: 0, cards: 3, out: false },
    { seat: 2, team: 1, cards: 3, out: false },
  ]);
  assert.deepEqual(view.table, [{ seat: 2, card: "6-clubs" }]);
  const json = JSON.stringify(view);
  assert.ok(!json.includes("seed"), "a seed nunca vai para a view");
  assert.ok(!json.includes("7-hearts") && !json.includes("A-spades") && !json.includes("2-diamonds"), "mãos alheias não vazam");
  assert.equal(view.canPlay, true);
  assert.equal(view.canTruco, true);
});

test("truco: estouro de tempo joga a carta mais fraca; em truco ou mão de onze, corre", () => {
  const state = stateOf({ hands: [["3-clubs", "4-hearts", "5-clubs"], ["2-clubs", "6-hearts", "7-clubs"]] });
  const timed = timeoutTurn(state, 1);
  assert.equal(timed.table[0].card, "4-hearts", "4 é a carta mais fraca da mão");
  assert.equal(timed.turn, 2);

  const ask = partyMove(state, 1, { action: "truco" });
  const folded = timeoutTurn(ask.state, 2);
  assert.equal(folded.points[0], 1, "quem estourou no truco corre e entrega o valor");
  assert.equal(folded.handNo, 2);

  const mao = stateOf({ phase: "mao", maoDeOnze: 1, turn: 1, handValue: 3, maoDeOnzeHand: true, trucoLocked: true, points: [11, 5] });
  const ran = timeoutTurn(mao, 1);
  assert.equal(ran.points[0], 11);
  assert.equal(ran.points[1], 6);
  assert.equal(ran.phase, "playing");
});

/* ---------- contrato PARTY ---------- */

test("truco: contrato PARTY declara 2 ou 4 jogadores, por turnos, tempo e eliminação no estouro", () => {
  assert.equal(PARTY.minPlayers, 2);
  assert.equal(PARTY.maxPlayers, 4);
  assert.deepEqual(PARTY.playerCounts, [2, 4], "a mesa só existe em 1×1 ou duplas 2×2");
  assert.equal(PARTY.order, "turns");
  assert.equal(PARTY.onTimeout, "out");
  assert.equal(TARGET, 12);
  assert.ok(PARTY.turnOptions.includes(PARTY.turnSeconds));
  assert.ok(PARTY.maxSeconds >= 30);
});

/* ---------- duplas 2×2 ---------- */

test("truco: duplas têm parceiros opostos e nomes próprios", () => {
  assert.equal(teamOf(1), 0);
  assert.equal(teamOf(2), 1);
  assert.equal(teamOf(3), 0);
  assert.equal(teamOf(4), 1);
  assert.equal(teamOf(null), null);
  assert.deepEqual(TEAM_NAMES, ["Dupla A", "Dupla B"]);
});

test("truco: no 2×2 a vaza é da dupla da carta mais alta e os pontos são compartilhados", () => {
  const state = stateOf4({
    hands: [
      ["3-clubs", "3-spades", "A-clubs"],
      ["2-clubs", "2-hearts", "K-clubs"],
      ["3-hearts", "2-diamonds", "K-hearts"],
      ["4-diamonds", "5-hearts", "6-clubs"],
    ],
  });
  const round1 = playSeats(state, [[1, "3-clubs"], [2, "2-clubs"], [3, "3-hearts"], [4, "4-diamonds"]]);
  assert.equal(round1.state.round, 2);
  assert.equal(round1.state.roundResults[0].team, 0, "assentos 1 e 3 formam a dupla vencedora");
  assert.equal(round1.state.roundResults[0].winner, 1);
  assert.deepEqual(round1.state.roundWins, [1, 0]);
  assert.equal(round1.turn, 1, "quem venceu a vaza abre a próxima");

  const round2 = playSeats(round1.state, [[1, "3-spades"], [2, "2-hearts"], [3, "2-diamonds"], [4, "5-hearts"]]);
  assert.equal(round2.state.lastHand.rounds[1].team, 0, "a segunda vaza também é da dupla A");
  assert.equal(round2.state.points[0], 1, "a dupla A soma 1 ponto da mão");
  assert.equal(round2.state.points[1], 0);
  assert.equal(round2.state.lastHand.team, 0);
  assert.equal(round2.state.lastHand.winner, 1);
  assert.equal(round2.state.handNo, 2);
});

test("truco: no 2×2 dois parceiros no topo da vaza ainda dão a vaza à dupla", () => {
  const state = stateOf4({
    hands: [
      ["3-clubs", "2-hearts", "A-clubs"],
      ["4-diamonds", "5-hearts", "6-clubs"],
      ["3-hearts", "2-spades", "K-hearts"],
      ["4-hearts", "5-clubs", "6-hearts"],
    ],
  });
  const round1 = playSeats(state, [[1, "3-clubs"], [2, "4-diamonds"], [3, "3-hearts"], [4, "4-hearts"]]);
  assert.equal(round1.state.roundResults[0].tie, false);
  assert.equal(round1.state.roundResults[0].team, 0);
  assert.equal(round1.state.roundResults[0].winner, 1, "o assento 1 é o representante da dupla na vaza");
  assert.deepEqual(round1.state.roundWins, [1, 0]);
});

test("truco: no 2×2 empate na 1ª vaza entre as duplas deixa a 2ª decidir a mão", () => {
  const state = stateOf4({
    hands: [
      ["3-clubs", "2-hearts", "A-clubs"],
      ["3-hearts", "3-diamonds", "2-diamonds"],
      ["2-spades", "K-hearts", "A-diamonds"],
      ["4-diamonds", "5-hearts", "6-clubs"],
    ],
    points: [0, 0],
  });
  const round1 = playSeats(state, [[1, "3-clubs"], [2, "3-hearts"], [3, "2-spades"], [4, "4-diamonds"]]);
  assert.equal(round1.state.roundResults[0].tie, true, "3♣ e 3♥ empatam entre as duplas");
  assert.equal(round1.turn, 1, "quem abriu a vaza empatada abre a próxima");

  const round2 = playSeats(round1.state, [[1, "2-hearts"], [2, "3-diamonds"], [3, "K-hearts"], [4, "5-hearts"]]);
  assert.equal(round2.state.lastHand.rounds[1].tie, false);
  assert.equal(round2.state.lastHand.rounds[1].team, 1, "a dupla B vence a segunda vaza");
  assert.equal(round2.state.points[1], 1, "1ª empatada, 2ª vencida: a dupla B leva a mão");
  assert.equal(round2.state.lastHand.team, 1);
});

test("truco: no 2×2 a terceira vaza decide a mão quando cada dupla venceu uma", () => {
  const state = stateOf4({
    hands: [
      ["3-clubs", "2-hearts", "A-clubs"],
      ["4-diamonds", "3-diamonds", "2-diamonds"],
      ["2-spades", "K-hearts", "3-spades"],
      ["5-clubs", "5-hearts", "6-clubs"],
    ],
  });
  const round1 = playSeats(state, [[1, "3-clubs"], [2, "4-diamonds"], [3, "2-spades"], [4, "5-clubs"]]);
  assert.equal(round1.state.roundResults[0].team, 0);
  const round2 = playSeats(round1.state, [[1, "2-hearts"], [2, "3-diamonds"], [3, "K-hearts"], [4, "5-hearts"]]);
  assert.equal(round2.state.roundResults[1].team, 1);
  assert.equal(round2.state.round, 3);
  const round3 = playSeats(round2.state, [[2, "2-diamonds"], [3, "3-spades"], [4, "6-clubs"], [1, "A-clubs"]]);
  assert.equal(round3.state.lastHand.rounds[2].team, 0);
  assert.equal(round3.state.points[0], 1);
  assert.equal(round3.state.lastHand.team, 0);
});

test("truco: no 2×2 o truco vai para o próximo adversário e o aceite mantém a vez", () => {
  const state = stateOf4();
  const ask = partyMove(state, 1, { action: "truco" });
  assert.ok(ask);
  assert.equal(ask.turn, 2, "o adversário do assento 1 é o assento 2");
  assert.deepEqual(ask.state.pending, { seat: 1, responder: 2, value: 3, stake: 1, resumeTurn: 1 });

  const accept = partyMove(ask.state, 2, { action: "accept" });
  assert.equal(accept.turn, 1);
  assert.equal(accept.state.handValue, 3);
  assert.equal(accept.state.nextRaiser, 2, "quem aceitou controla o próximo aumento");

  const play = partyMove(accept.state, 1, { action: "play", card: "3-clubs" });
  assert.equal(play.turn, 2);
  const raise = partyMove(play.state, 2, { action: "truco" });
  assert.ok(raise, "depois de jogar, o adversário pode pedir o próximo aumento");
  assert.equal(raise.turn, 3, "o pedido do assento 2 vai para o assento 3 (próximo adversário)");
  assert.deepEqual(raise.state.pending, { seat: 2, responder: 3, value: 6, stake: 3, resumeTurn: 2 });
});

test("truco: no 2×2 correr no retruco entrega o valor à dupla adversária", () => {
  const state = stateOf4({ handValue: 3 });
  const ask = partyMove(state, 1, { action: "truco" });
  const retruco = partyMove(ask.state, 2, { action: "raise" });
  assert.equal(retruco.turn, 3, "o retruco do assento 2 vai para o assento 3");
  const fold = partyMove(retruco.state, 3, { action: "fold" });
  assert.equal(fold.state.points[1], 6, "a dupla B recebe os 6 pontos que o retruco colocou em jogo");
  assert.equal(fold.state.lastHand.reason, "fold");
  assert.equal(fold.state.lastHand.team, 1);
});

test("truco: no 2×2 quem chega a 11 dá a mão de onze a um representante da dupla", () => {
  const state = stateOf4({
    points: [10, 5],
    hands: [
      ["3-clubs", "3-spades", "A-clubs"],
      ["2-clubs", "2-hearts", "K-clubs"],
      ["3-hearts", "2-diamonds", "K-hearts"],
      ["4-diamonds", "5-hearts", "6-clubs"],
    ],
  });
  const round1 = playSeats(state, [[1, "3-clubs"], [2, "2-clubs"], [3, "3-hearts"], [4, "4-diamonds"]]);
  const round2 = playSeats(round1.state, [[1, "3-spades"], [2, "2-hearts"], [3, "2-diamonds"], [4, "5-hearts"]]);
  assert.equal(round2.state.points[0], 11);
  assert.equal(round2.state.phase, "mao");
  assert.equal(round2.state.maoDeOnze, 1, "o assento 1 representa a dupla que cruzou 11");
  assert.equal(round2.state.maoDeOnzeSeat, 1);
  assert.equal(round2.state.handValue, 3);
  assert.equal(round2.state.trucoLocked, true);
  assert.equal(partyView(round2.state, 1).canChooseMao, true);
  assert.equal(partyView(round2.state, 3).canChooseMao, false, "só o representante decide");
});

test("truco: no 2×2 as duas duplas em 11 jogam a mão de ferro valendo 3", () => {
  const state = stateOf4({
    points: [11, 10],
    hands: [
      ["2-clubs", "2-hearts", "K-clubs"],
      ["3-clubs", "3-diamonds", "A-hearts"],
      ["4-diamonds", "5-hearts", "6-clubs"],
      ["5-clubs", "6-hearts", "4-hearts"],
    ],
  });
  const round1 = playSeats(state, [[1, "2-clubs"], [2, "3-clubs"], [3, "4-diamonds"], [4, "5-clubs"]]);
  const round2 = playSeats(round1.state, [[2, "3-diamonds"], [3, "5-hearts"], [4, "6-hearts"], [1, "2-hearts"]]);
  assert.deepEqual(round2.state.points, [11, 11]);
  assert.equal(round2.state.maoDeFerro, true);
  assert.equal(round2.state.handValue, 3);
  assert.equal(round2.state.trucoLocked, true);
  assert.equal(round2.state.phase, "playing");
});

test("truco: no 2×2 a partida termina em 12 e o ranking agrupa as duplas", () => {
  const state = stateOf4({
    points: [10, 0],
    handValue: 3,
    hands: [
      ["3-clubs", "3-spades", "A-clubs"],
      ["2-clubs", "2-hearts", "K-clubs"],
      ["3-hearts", "2-diamonds", "K-hearts"],
      ["4-diamonds", "5-hearts", "6-clubs"],
    ],
  });
  const round1 = playSeats(state, [[1, "3-clubs"], [2, "2-clubs"], [3, "3-hearts"], [4, "4-diamonds"]]);
  const round2 = playSeats(round1.state, [[1, "3-spades"], [2, "2-hearts"], [3, "2-diamonds"], [4, "5-hearts"]]);
  assert.equal(round2.state.points[0], 13);
  assert.equal(round2.state.winnerTeam, 0);
  assert.equal(round2.state.winner, 1);
  assert.equal(round2.state.phase, "over");
  assert.deepEqual(round2.state.ranking, [[1, 3], [2, 4]]);
  assert.deepEqual(placements(round2.state.ranking), { 1: 1, 3: 1, 2: 3, 4: 3 });
});

test("truco: no 2×2 a view mostra a dupla, o time dos assentos e nenhuma mão alheia", () => {
  const state = stateOf4();
  const view = partyView(state, 1);
  assert.equal(view.team, 0);
  assert.deepEqual(view.teams, [[1, 3], [2, 4]]);
  assert.deepEqual(view.points, [0, 0]);
  assert.deepEqual(view.counts.map(entry => entry.seat), [1, 2, 3, 4]);
  assert.deepEqual(view.counts.map(entry => entry.team), [0, 1, 0, 1]);
  assert.deepEqual(view.hand, state.hands[0]);
  assert.equal(view.canPlay, true);
  const json = JSON.stringify(view);
  assert.ok(!json.includes("seed"), "a seed nunca vai para a view");
  for (const hand of state.hands.slice(1)) {
    for (const card of hand) assert.ok(!json.includes(card), `carta alheia vazou: ${card}`);
  }
});

test("truco: no 2×2 quem sai faz a dupla perder a partida no lance seguinte", () => {
  const state = stateOf4();
  const view = partyView(state, 1, { out: [2] });
  assert.equal(view.phase, "playing", "o domínio ainda não fechou: o banco não conhece as duplas");
  assert.equal(view.counts.find(entry => entry.seat === 2).out, true);

  assert.equal(partyMove(state, 2, { action: "play", card: "2-clubs" }, { out: [2] }), null, "eliminado não joga");
  const finished = partyMove(state, 1, { action: "play", card: "3-clubs" }, { out: [2] });
  assert.ok(finished);
  assert.equal(finished.reason, "elimination");
  assert.equal(finished.state.phase, "over");
  assert.equal(finished.state.winnerTeam, 0, "a dupla A continua com dois jogadores e vence");
  assert.deepEqual(finished.state.ranking, [[1, 3], [4]]);
  assert.equal(finished.state.lastHand.reason, "elimination");
  assert.deepEqual(finished.state.lastHand.out, [2]);
});

test("truco: no 2×2 se as duas duplas perdem um jogador, a partida termina empatada", () => {
  const state = stateOf4();
  const finished = partyMove(state, 3, { action: "play", card: "3-hearts" }, { out: [1, 2] });
  assert.ok(finished);
  assert.equal(finished.reason, "elimination");
  assert.equal(finished.state.winnerTeam, null);
  assert.equal(finished.state.winner, null);
  assert.deepEqual(finished.state.ranking, [[3, 4]]);
});

test("truco: no 2×2 o estouro local joga a carta mais fraca de quem está na vez", () => {
  const state = stateOf4();
  const timed = timeoutTurn(state, 1);
  assert.equal(timed.table[0].card, "A-clubs", "A é a carta mais fraca da mão do assento 1");
  assert.equal(timed.turn, 2);
  assert.deepEqual(timed.table, [{ seat: 1, card: "A-clubs" }]);
});
