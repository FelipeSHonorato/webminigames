/* Testes do UNO: baralho, distribuição, carta inicial, regras de lance, efeitos, compra, descarte
   reaproveitado, sigilo da visão, classificação e imutabilidade. O domínio é puro e roda no Node e na Edge. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  COLORS, COLOR_FILES, PARTY, VALUES, buildDeck, canPlayCard, cardColor, cardImage, cardName, cardOf,
  isPlayable, isViewPlayable, isWild, partyMove, partyStart, partyView, placements, playableCards,
  timeoutTurn, topCard,
} from "../games/uno/domain.js";
import { makeRng } from "../shared/rng.js";

const stateOf = (over = {}) => ({
  hands: [["r-5-1"], ["b-2-1"], ["g-3-1"], ["y-4-1"]],
  deck: [],
  discard: ["r-9-1"],
  color: "r",
  dir: 1,
  turn: 1,
  seed: 12345,
  drawn: null,
  last: null,
  plays: [],
  winner: null,
  ranking: null,
  ...over,
});

const allCards = state => [
  ...state.hands.flat(),
  ...state.deck,
  ...state.discard,
];

/* ---------- baralho e imagens ---------- */

test("uno: baralho de 108 cartas únicas, com as quantidades do jogo físico", () => {
  const deck = buildDeck();
  assert.equal(deck.length, 108);
  assert.equal(new Set(deck).size, 108, "ids repetidos no baralho");
  for (const color of COLORS) {
    assert.equal(deck.filter(id => cardColor(id) === color && cardOf(id).value === "0").length, 1, `${color}: um único 0`);
    for (const value of VALUES) {
      if (value === "0") continue;
      assert.equal(deck.filter(id => cardColor(id) === color && cardOf(id).value === value).length, 2, `${color} ${value}: duas cópias`);
    }
  }
  assert.equal(deck.filter(id => cardOf(id).value === "wild").length, 4);
  assert.equal(deck.filter(id => cardOf(id).value === "draw4").length, 4);
  assert.ok(deck.every(id => cardOf(id)), "todo id precisa ser válido");
});

test("uno: id inválido é recusado e a imagem segue o baralho fornecido", () => {
  for (const id of [null, "", "x-1-1", "r-10-1", "r-0-2", "w-wild-5", "w-draw4-0", "r-skip-3"]) {
    assert.equal(cardOf(id), null, `${id} deveria ser inválido`);
  }
  assert.equal(cardImage("r-7-1"), "vermelho_7.png");
  assert.equal(cardImage("r-7-2"), "vermelho_7_2.png");
  assert.equal(cardImage("g-skip-1"), "verde_bloqueio.png");
  assert.equal(cardImage("b-draw2-2"), "azul_mais2_2.png");
  assert.equal(cardImage("y-reverse-1"), "amarelo_inverter.png");
  assert.equal(cardImage("w-wild-1"), "coringa_vermelho.png");
  assert.equal(cardImage("w-wild-4"), "coringa_azul.png");
  assert.equal(cardImage("w-draw4-3"), "coringa_mais4_3.png");
  assert.equal(cardImage("nao-existe"), "costa_cartas.png");
  assert.equal(cardName("w-draw4-1"), "Curinga +4");
  assert.equal(cardName("g-skip-2"), "Verde Bloqueio");
  assert.ok(isWild("w-wild-1") && !isWild("r-1-1"));
  assert.equal(COLOR_FILES.r, "vermelho");
});

/* ---------- distribuição e carta inicial ---------- */

test("uno: 2 a 4 jogadores recebem 7 cartas; a mesa nunca começa com curinga", () => {
  for (const seats of [[1, 2], [1, 2, 3], [1, 2, 3, 4]]) {
    for (let seed = 1; seed <= 40; seed++) {
      const { state, turn } = partyStart({ seats, rng: makeRng(seed) });
      assert.equal(state.hands.length, seats.length);
      assert.ok(state.hands.every(hand => hand.length >= 7), "todos recebem ao menos 7");
      assert.equal(allCards(state).length, 108, "nenhuma carta some");
      assert.equal(new Set(allCards(state)).size, 108, "nenhuma carta duplica");
      assert.equal(isWild(topCard(state)), false, "a primeira carta não pode ser curinga");
      assert.equal(turn, state.turn);

      const top = cardOf(topCard(state));
      if (top.value === "skip") assert.equal(state.turn, 2);
      else if (top.value === "reverse") {
        if (seats.length === 2) {
          assert.equal(state.turn, 2);
          assert.equal(state.dir, 1);
        } else {
          assert.equal(state.turn, seats.length, "o último assento começa no sentido invertido");
          assert.equal(state.dir, -1);
        }
      } else if (top.value === "draw2") {
        assert.equal(state.hands[0].length, 9, "o primeiro compra 2");
        assert.equal(state.turn, 2);
      } else {
        assert.equal(state.turn, 1);
        assert.equal(state.dir, 1);
      }
    }
  }
});

test("uno: partyStart recusa mesas fora de 2..4 e sem rng", () => {
  assert.throws(() => partyStart({ seats: [1], rng: makeRng(1) }), /bad_players/);
  assert.throws(() => partyStart({ seats: [1, 2, 3, 4, 5], rng: makeRng(1) }), /bad_players/);
  assert.throws(() => partyStart({ seats: [1, 2] }), /rng/);
});

/* ---------- regras de lance ---------- */

test("uno: carta jogável combina cor, valor ou é curinga; +4 exige não ter a cor atual", () => {
  const hand = ["r-1-1", "b-5-1", "g-9-1", "w-wild-1", "w-draw4-1"];
  assert.equal(canPlayCard(hand, "r-1-1", "r", "r-9-1"), true);
  assert.equal(canPlayCard(hand, "g-9-1", "r", "r-9-1"), true, "mesmo valor, outra cor");
  assert.equal(canPlayCard(hand, "b-5-1", "r", "r-9-1"), false);
  assert.equal(canPlayCard(hand, "w-wild-1", "r", "r-9-1"), true);
  assert.equal(canPlayCard(hand, "w-draw4-1", "r", "r-9-1"), false, "tem vermelho na mão");
  assert.equal(canPlayCard(["b-5-1", "w-draw4-1"], "w-draw4-1", "r", "r-9-1"), true, "sem carta da cor atual");
  assert.equal(canPlayCard([], "w-draw4-1", "r", "r-9-1"), true);
  assert.equal(canPlayCard(hand, "r-1-1", null, "r-9-1"), false, "cor atual sempre existe na mesa");
});

test("uno: isPlayable usa a mão do assento e playableCards filtra os ids", () => {
  const state = stateOf({ hands: [["r-1-1", "b-5-1", "g-9-1", "w-wild-1"], ["b-2-1"]] });
  assert.equal(isPlayable(state, "r-1-1", 1), true);
  assert.equal(isPlayable(state, "g-9-1", 1), true);
  assert.equal(isPlayable(state, "b-5-1", 1), false);
  assert.deepEqual(playableCards(state, 1), ["r-1-1", "g-9-1", "w-wild-1"]);
});

/* ---------- compra, passar e efeitos ---------- */

test("uno: compra sem carta jogável passa a vez automaticamente", () => {
  const state = stateOf({ hands: [["b-2-1"], ["g-3-1"]], deck: ["b-7-1"], discard: ["r-9-1"] });
  const result = partyMove(state, 1, { action: "draw" });
  assert.ok(result);
  assert.equal(result.turn, 2);
  assert.equal(result.state.hands[0].length, 2);
  assert.equal(result.state.hands[0][1], "b-7-1");
  assert.equal(result.state.drawn, null);
  assert.equal(result.reason, null);
});

test("uno: compra jogável mantém a vez; pode jogar a comprada, outra carta ou passar", () => {
  const state = stateOf({ hands: [["b-2-1"], ["g-3-1"]], deck: ["r-7-1"], discard: ["r-9-1"], turn: 1 });
  const draw = partyMove(state, 1, { action: "draw" });
  assert.equal(draw.turn, 1, "a vez continua com quem comprou");
  assert.deepEqual(draw.state.drawn, { seat: 1, card: "r-7-1" });
  assert.equal(partyMove(draw.state, 1, { action: "draw" }), null, "não compra duas vezes");

  const pass = partyMove(draw.state, 1, { action: "pass" });
  assert.equal(pass.turn, 2);
  assert.equal(pass.state.drawn, null);

  const play = partyMove(draw.state, 1, { action: "play", card: "r-7-1" });
  assert.ok(play);
  assert.equal(play.state.discard.at(-1), "r-7-1");
  assert.equal(play.turn, 2);
});

test("uno: bloqueio pula o próximo e +2 faz o próximo comprar e perder a vez", () => {
  const skip = partyMove(stateOf({ hands: [["r-skip-1", "b-1-1"], ["b-2-1"], ["g-3-1"]] }), 1, { action: "play", card: "r-skip-1" });
  assert.equal(skip.turn, 3, "o assento 2 é pulado");

  const plus2State = stateOf({
    hands: [["r-draw2-1", "b-1-1"], ["b-2-1"], ["g-3-1"]],
    deck: ["y-1-1", "y-2-1", "r-4-1"],
  });
  const plus2 = partyMove(plus2State, 1, { action: "play", card: "r-draw2-1" });
  assert.equal(plus2.state.hands[1].length, 3, "o próximo compra 2");
  assert.equal(plus2.turn, 3, "quem comprou perde a vez");
  assert.equal(plus2.move.target, 2);
  assert.equal(plus2.move.amount, 2);
});

test("uno: inverter muda o sentido; com 2 jogadores vale como bloqueio", () => {
  const three = partyMove(stateOf({ hands: [["r-reverse-1", "b-1-1"], ["b-2-1"], ["g-3-1"]], dir: 1 }), 1, { action: "play", card: "r-reverse-1" });
  assert.equal(three.state.dir, -1);
  assert.equal(three.turn, 3, "no sentido invertido o assento anterior joga");

  const two = partyMove(stateOf({ hands: [["r-reverse-1", "b-1-1"], ["b-2-1"]], dir: 1 }), 1, { action: "play", card: "r-reverse-1" });
  assert.equal(two.state.dir, -1);
  assert.equal(two.turn, 1, "o adversário é pulado e quem jogou joga de novo");
});

test("uno: +4 faz o próximo comprar 4 e só é aceito sem carta da cor atual", () => {
  const hand = ["b-1-1", "w-draw4-1"];
  const state = stateOf({ hands: [hand, ["g-3-1"]], deck: ["y-1-1", "y-2-1", "y-3-1", "y-4-1", "r-1-1"] });
  const play = partyMove(state, 1, { action: "play", card: "w-draw4-1", color: "b" });
  assert.ok(play);
  assert.equal(play.state.color, "b");
  assert.equal(play.state.hands[1].length, 5);
  assert.equal(play.move.amount, 4);

  const illegal = partyMove(stateOf({ hands: [["r-1-1", "w-draw4-1"], ["g-3-1"]] }), 1, { action: "play", card: "w-draw4-1", color: "b" });
  assert.equal(illegal, null, "com vermelho na mão o +4 é ilegal");
});

test("uno: curinga exige cor válida e fica na mesa com a cor escolhida", () => {
  const state = stateOf({ hands: [["w-wild-1", "b-1-1"], ["g-3-1"]] });
  assert.equal(partyMove(state, 1, { action: "play", card: "w-wild-1" }), null, "sem cor escolhida");
  assert.equal(partyMove(state, 1, { action: "play", card: "w-wild-1", color: "x" }), null);
  const play = partyMove(state, 1, { action: "play", card: "w-wild-1", color: "g" });
  assert.equal(play.state.color, "g");
  assert.equal(play.state.discard.at(-1), "w-wild-1");
});

test("uno: lance ilegal não altera o estado", () => {
  const state = stateOf();
  const before = JSON.stringify(state);
  assert.equal(partyMove(state, 2, { action: "play", card: "b-2-1" }), null, "fora da vez");
  assert.equal(partyMove(state, 1, { action: "play", card: "b-2-1" }), null, "carta que não está na mão");
  assert.equal(partyMove(state, 1, { action: "play", card: "g-9-1" }), null, "carta não jogável");
  assert.equal(partyMove(state, 1, { action: "pass" }), null, "passar sem ter comprado");
  assert.equal(partyMove(state, 1, { action: "nada" }), null);
  assert.equal(JSON.stringify(state), before, "o estado original muda?");
});

test("uno: jogar a última carta encerra a partida e classifica por tamanho da mão", () => {
  const state = stateOf({
    hands: [["r-5-1"], ["b-1-1", "b-2-1"], ["g-3-1"], ["y-1-1", "y-2-1", "y-3-1"]],
  });
  const result = partyMove(state, 1, { action: "play", card: "r-5-1" });
  assert.equal(result.reason, "uno");
  assert.equal(result.state.winner, 1);
  assert.equal(result.turn, null);
  assert.deepEqual(result.ranking, [[1], [3], [2], [4]]);
  assert.deepEqual(placements(result.ranking), { 1: 1, 3: 2, 2: 3, 4: 4 });
  assert.equal(partyMove(result.state, 3, { action: "draw" }), null, "a partida acabou");
});

test("uno: caso extremo sem monte nem descarte encerra pela menor mão", () => {
  const deck = buildDeck();
  const state = stateOf({
    hands: [deck.slice(0, 54), deck.slice(54, 107)],
    deck: [],
    discard: [deck[107]],
    color: cardColor(deck[107]),
    turn: 1,
  });
  const result = partyMove(state, 1, { action: "draw" });
  assert.equal(result.reason, "stalled");
  assert.equal(result.turn, null);
  assert.equal(result.state.winner, null);
  assert.deepEqual(result.ranking, [[2], [1]], "quem tem menos cartas fica à frente");
});

test("uno: descarte reaproveitado é determinístico pela seed e preserva as 108 cartas", () => {
  const deck = buildDeck();
  const state = stateOf({
    hands: [deck.slice(0, 7), deck.slice(7, 14)],
    deck: [],
    discard: deck.slice(14),
    seed: 987654321,
    turn: 1,
  });
  const a = partyMove(state, 1, { action: "draw" });
  const b = partyMove(state, 1, { action: "draw" });
  assert.deepEqual(a.state, b.state, "a mesma seed precisa dar o mesmo resultado");
  assert.equal(a.state.seed, b.state.seed);
  assert.equal(a.state.discard.at(-1), deck.at(-1), "o topo não volta para o monte");
  assert.equal(allCards(a.state).length, 108, "reembaralhar não perde nem cria cartas");
  assert.equal(new Set(allCards(a.state)).size, 108, "reembaralhar não duplica cartas");
});

test("uno: estouro de tempo passa a vez só de quem estava jogando", () => {
  const state = stateOf();
  const before = JSON.stringify(state);
  assert.equal(timeoutTurn(state, 2), null);
  const next = timeoutTurn(state, 1);
  assert.equal(next.turn, 2);
  assert.equal(next.last.action, "timeout");
  assert.equal(JSON.stringify(state), before, "timeoutTurn não altera o estado original");
});

/* ---------- visão do assento ---------- */

test("uno: a visão entrega a própria mão e as contagens, sem seed nem cartas escondidas", () => {
  const state = stateOf({
    hands: [["r-5-1", "b-1-1"], ["g-7-1"], ["y-9-1"]],
    deck: ["g-8-1", "b-9-1"],
    discard: ["r-9-1", "b-2-1"],
    color: "b",
    turn: 1,
    drawn: { seat: 1, card: "b-1-1" },
    plays: [{ seat: 1, action: "draw" }],
  });
  const view = partyView(state, 1);
  assert.deepEqual(view.hand, ["r-5-1", "b-1-1"]);
  assert.equal(view.top, "b-2-1");
  assert.equal(view.color, "b");
  assert.equal(view.turn, 1);
  assert.equal(view.deck, 2, "só a quantidade do monte");
  assert.equal(view.discard, 2);
  assert.deepEqual(view.counts, [
    { seat: 1, cards: 2, uno: false, out: false },
    { seat: 2, cards: 1, uno: true, out: false },
    { seat: 3, cards: 1, uno: true, out: false },
  ]);
  assert.equal(view.drawn, "b-1-1");
  assert.equal(view.canDraw, false, "já comprou neste turno");
  assert.equal(view.canPass, true);
  assert.equal(view.winner, null);
  const json = JSON.stringify(view);
  assert.ok(!json.includes("seed"), "a seed nunca vai para a view");
  assert.ok(!json.includes("g-7-1") && !json.includes("y-9-1"), "mãos alheias não vazam");
  assert.ok(!json.includes("g-8-1") && !json.includes("b-9-1"), "o monte não vaza");
});

test("uno: isViewPlayable aplica a mesma regra usando só a view", () => {
  const view = { hand: ["r-1-1", "b-5-1", "w-draw4-1"], color: "r", top: "r-9-1" };
  assert.equal(isViewPlayable(view, "r-1-1"), true);
  assert.equal(isViewPlayable(view, "b-5-1"), false);
  assert.equal(isViewPlayable(view, "w-draw4-1"), false, "tem vermelho na mão");
  assert.equal(isViewPlayable({ ...view, hand: ["b-5-1", "w-draw4-1"] }, "w-draw4-1"), true);
});

/* ---------- contrato PARTY ---------- */

test("uno: contrato PARTY declara 2 a 4 jogadores, por turnos, com tempo e skip", () => {
  assert.equal(PARTY.minPlayers, 2);
  assert.equal(PARTY.maxPlayers, 4);
  assert.equal(PARTY.order, "turns");
  assert.equal(PARTY.onTimeout, "skip");
  assert.ok(PARTY.turnOptions.includes(PARTY.turnSeconds));
  assert.ok(PARTY.maxSeconds >= 30);
});
