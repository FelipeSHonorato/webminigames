/* Testes do Dominó clássico: 28 pedras, distribuição, abertura pelo maior carroção, jogadas nas duas
   pontas, compra no monte, passe, jogo fechado, pontuação, alvo de 100, sigilo da visão, eliminação e
   contrato PARTY. O domínio é puro e roda no Node e na Edge. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  HAND_SIZE, PARTY, TARGET, buildDeck, endsOf, legalEnds, openingTile, partyMove, partyStart, partyView,
  pipsOf, placements, playableTiles, shuffle, timeoutTurn, tileName, tileOf, tileShort,
} from "../games/domino/domain.js";
import { makeRng } from "../shared/rng.js";

const seatsOf = n => Array.from({ length: n }, (_, i) => i + 1);
const ctxOf = state => ({ seats: seatsOf(state.hands.length), out: [] });

/** Estado mínimo para um lance isolado. A mesa já começa com o 6-6 na maioria dos testes. */
const stateOf = (over = {}) => ({
  hands: [["5-6", "2-3"], ["4-6", "1-2"]],
  boneyard: [],
  board: [{ tile: "6-6", left: 6, right: 6 }],
  turn: 1,
  passes: 0,
  roundNo: 1,
  points: [0, 0],
  seed: 123456789,
  starter: 1,
  last: null,
  lastRound: null,
  plays: [],
  phase: "playing",
  winner: null,
  ranking: null,
  ...over,
});

/* ---------- pedras e baralho ---------- */

test("dominó: 28 pedras únicas de 0 a 6, sem repetir e sem id invertido", () => {
  const deck = buildDeck();
  assert.equal(deck.length, 28);
  assert.equal(new Set(deck).size, 28);
  assert.equal(deck[0], "0-0");
  assert.equal(deck[deck.length - 1], "6-6");
  assert.ok(deck.every(id => tileOf(id)), "todo id do baralho é válido");
  assert.equal(deck.filter(id => tileOf(id).double).length, 7, "sete carroções (0-0 a 6-6)");
  for (const id of deck) {
    const tile = tileOf(id);
    assert.ok(tile.a <= tile.b, `${id} não é canônico`);
    assert.equal(tile.sum, tile.a + tile.b);
    assert.equal(pipsOf(id), tile.sum);
  }
  assert.equal(deck.reduce((sum, id) => sum + pipsOf(id), 0), 168, "168 pontos no baralho inteiro");
});

test("dominó: ids inválidos e nomes", () => {
  for (const id of [null, "", "7-7", "-1-2", "2-5-1", "5-2", "02-3", "a-b", 2]) assert.equal(tileOf(id), null, `${id} deveria ser inválido`);
  assert.equal(tileName("2-5"), "Pedra 2 e 5");
  assert.equal(tileName("6-6"), "Carroção 6 e 6");
  assert.equal(tileShort("2-5"), "2–5");
  assert.equal(tileShort("6-6"), "6–6");
  assert.equal(tileShort("x"), "?");
});

test("dominó: embaralhar não altera a lista original e usa o rng", () => {
  const deck = buildDeck();
  const shuffled = shuffle(deck, makeRng(7));
  assert.deepEqual(deck, buildDeck());
  assert.equal(shuffled.length, 28);
  assert.deepEqual(shuffled.slice().sort(), deck.slice().sort());
  assert.notDeepEqual(shuffled, deck);
  assert.throws(() => shuffle(deck), /rng obrigatório/);
});

test("dominó: maior carroção abre; sem dupla, a maior pedra", () => {
  assert.deepEqual(openingTile([["0-1", "4-4"], ["5-6", "2-2"]]), { seat: 1, tile: "4-4" });
  assert.deepEqual(openingTile([["0-1"], ["6-6"], ["5-5"]]), { seat: 2, tile: "6-6" });
  assert.deepEqual(openingTile([["0-1", "2-6"], ["5-4", "3-3"]]), { seat: 2, tile: "3-3" });
  assert.deepEqual(openingTile([["5-6", "2-1"], ["5-4", "0-3"]]), { seat: 1, tile: "5-6" }, "sem duplas, vence 5-6");
  assert.equal(openingTile([]), null);
  assert.equal(openingTile([[], []]), null);
});

/* ---------- distribuição e abertura ---------- */

test("dominó: 2, 3 e 4 jogadores recebem 7 pedras, com monte apenas nas mesas menores", () => {
  for (const n of [2, 3, 4]) {
    for (let seed = 1; seed <= 40; seed++) {
      const { state, turn } = partyStart({ seats: seatsOf(n), rng: makeRng(seed) });
      assert.equal(state.hands.length, n);
      const sizes = state.hands.map(hand => hand.length).sort((a, b) => a - b);
      assert.deepEqual(sizes, [HAND_SIZE - 1, ...Array(n - 1).fill(HAND_SIZE)], "quem abre fica com 6; os outros, com 7");
      assert.equal(state.hands[state.starter - 1].length, HAND_SIZE - 1, "a pedra de abertura saiu da mão de quem abriu");
      assert.ok(state.hands.every((hand, index) => index === state.starter - 1 || hand.length === HAND_SIZE));
      assert.equal(state.board.length, 1, "a rodada já começa com a pedra de abertura na mesa");
      assert.equal(state.boneyard.length, 28 - HAND_SIZE * n);
      assert.equal(state.boneyard.length, n === 2 ? 14 : n === 3 ? 7 : 0);
      const all = [...state.hands.flat(), ...state.boneyard, ...state.board.map(entry => entry.tile)];
      assert.equal(all.length, 28, "todas as pedras estão em jogo ou no monte");
      assert.equal(new Set(all).size, 28, "nenhuma pedra aparece duas vezes");
      assert.ok(all.every(id => tileOf(id)));
      assert.ok(state.hands.every(hand => hand.every(id => !state.board.some(entry => entry.tile === id))), "a pedra da mesa saiu da mão");
      assert.deepEqual(state.points, seatsOf(n).map(() => 0));
      assert.equal(state.roundNo, 1);
      assert.equal(state.phase, "playing");
      assert.equal(state.passes, 0);
      assert.ok(Number.isInteger(state.seed));
      assert.ok(state.starter >= 1 && state.starter <= n);
      assert.equal(state.last.action, "open");
      assert.equal(state.last.seat, state.starter);
      assert.equal(state.last.tile, state.board[0].tile);
      assert.equal(turn, state.turn);
      assert.equal(state.turn, (state.starter % n) + 1, "a vez começa no assento seguinte a quem abriu");
    }
  }
});

test("dominó: a abertura é o maior carroção (ou a maior pedra) entre as mãos", () => {
  for (const n of [2, 3, 4]) {
    for (let seed = 1; seed <= 40; seed++) {
      const { state } = partyStart({ seats: seatsOf(n), rng: makeRng(seed) });
      const hands = state.hands.map(hand => hand.slice());
      hands[state.starter - 1] = [...hands[state.starter - 1], state.board[0].tile];
      assert.deepEqual(openingTile(hands), { seat: state.starter, tile: state.board[0].tile });
      const tile = tileOf(state.board[0].tile);
      assert.deepEqual(endsOf(state.board), [tile.a, tile.b]);
    }
  }
});

test("dominó: partyStart recusa mesas fora de 2..4, assentos com buraco e rng ausente", () => {
  for (const seats of [[], [1], [1, 2, 3, 4, 5], [1, 3], [2, 1], [1, 1]]) {
    assert.throws(() => partyStart({ seats, rng: makeRng(1) }), /bad_players/);
  }
  assert.throws(() => partyStart({ seats: [1, 2] }), /rng obrigatório/);
  assert.throws(() => partyStart({}), /bad_players/);
});

/* ---------- mesa, pontas e jogadas ---------- */

test("dominó: pontas expostas e fins válidos de cada pedra", () => {
  assert.deepEqual(endsOf([]), [null, null]);
  assert.deepEqual(endsOf([{ tile: "6-6", left: 6, right: 6 }]), [6, 6]);
  const board = [{ tile: "3-6", left: 3, right: 6 }, { tile: "6-6", left: 6, right: 6 }, { tile: "1-6", left: 1, right: 6 }];
  assert.deepEqual(endsOf(board), [3, 6]);
  assert.deepEqual(legalEnds("3-4", [3, 6]), ["left"]);
  assert.deepEqual(legalEnds("4-6", [3, 6]), ["right"]);
  assert.deepEqual(legalEnds("3-6", [3, 6]), ["left", "right"]);
  assert.deepEqual(legalEnds("0-0", [3, 6]), []);
  assert.deepEqual(legalEnds("6-6", [6, 6]), ["left", "right"], "pontas iguais aceitam os dois lados");
  assert.deepEqual(playableTiles(["0-0", "1-3", "2-6"], [3, 6]), ["1-3", "2-6"]);
});

test("dominó: joga-se nas duas pontas, com a pedra virada para encaixar", () => {
  const left = partyMove(stateOf({ hands: [["5-6", "0-1"], ["4-6", "1-2"]], turn: 1 }), 1, { action: "play", tile: "5-6", end: "left" });
  assert.ok(left);
  assert.deepEqual(left.state.board.map(entry => entry.tile), ["5-6", "6-6"]);
  assert.deepEqual(endsOf(left.state.board), [5, 6]);
  assert.deepEqual(left.state.hands[0], ["0-1"]);
  assert.equal(left.turn, 2);

  const right = partyMove(stateOf({ hands: [["4-6", "1-2"], ["5-6", "2-3"]] }), 1, { action: "play", tile: "4-6", end: "right" });
  assert.ok(right);
  assert.deepEqual(right.state.board.map(entry => entry.tile), ["6-6", "4-6"]);
  assert.deepEqual(endsOf(right.state.board), [6, 4]);
  assert.equal(right.turn, 2);
});

test("dominó: pedra que serve nas duas pontas exige a escolha da ponta", () => {
  const board = [{ tile: "3-6", left: 3, right: 6 }];
  const base = stateOf({ board, hands: [["3-6", "0-0"], ["1-1", "2-2"]] });
  assert.equal(partyMove(base, 1, { action: "play", tile: "3-6" }), null, "sem ponta escolhida quando as duas servem");
  assert.equal(partyMove(base, 1, { action: "play", tile: "3-6", end: "left" })?.state.board[0].tile, "3-6");
  assert.equal(partyMove(base, 1, { action: "play", tile: "3-6", end: "right" })?.state.board[1].tile, "3-6");
  assert.equal(partyMove(base, 1, { action: "play", tile: "0-0", end: "left" }), null, "pedra que não encaixa é recusada");
});

test("dominó: lance fora da vez, pedra da mão alheia e ação desconhecida são ilegais", () => {
  const state = stateOf({ hands: [["5-6", "2-3"], ["4-6", "1-2"]] });
  assert.equal(partyMove(state, 2, { action: "play", tile: "4-6", end: "right" }), null, "não é a vez do assento 2");
  assert.equal(partyMove(state, 1, { action: "play", tile: "4-6", end: "right" }), null, "a pedra é do assento 2");
  assert.equal(partyMove(state, 1, { action: "play", tile: "2-3", end: "left" }), null, "2-3 não encaixa no 6");
  assert.equal(partyMove(state, 1, { action: "truco" }), null);
  assert.equal(partyMove(state, 9, { action: "play", tile: "5-6", end: "left" }), null);
  assert.equal(partyMove({ ...state, phase: "over", winner: 1 }, 1, { action: "play", tile: "5-6", end: "left" }), null);
});

/* ---------- monte, passe e jogo fechado ---------- */

test("dominó: compra do monte mantém a vez e revela só se a pedra serviu", () => {
  const state = stateOf({ board: [{ tile: "6-6", left: 6, right: 6 }], hands: [["0-1", "1-2"], ["0-2", "2-3"]], boneyard: ["5-6"] });
  const drawn = partyMove(state, 1, { action: "draw" });
  assert.ok(drawn);
  assert.equal(drawn.turn, 1, "a vez continua com quem comprou");
  assert.equal(drawn.state.boneyard.length, 0);
  assert.deepEqual(drawn.state.hands[0], ["0-1", "1-2", "5-6"]);
  assert.deepEqual(drawn.move, { action: "draw", seat: 1, playable: true, empty: true, roundNo: 1 });
  assert.equal(JSON.stringify(drawn.move).includes("5-6"), false, "o lance público não revela a pedra comprada");

  const played = partyMove(drawn.state, 1, { action: "play", tile: "5-6", end: "left" });
  assert.ok(played);
  assert.equal(played.turn, 2);
});

test("dominó: com pedra jogável não se compra nem se passa", () => {
  const state = stateOf({ hands: [["5-6", "0-1"], ["0-2", "2-3"]], boneyard: ["1-1"] });
  assert.equal(partyMove(state, 1, { action: "draw" }), null);
  assert.equal(partyMove(state, 1, { action: "pass" }), null);
});

test("dominó: sem monte e sem pedra jogável, passa a vez", () => {
  const state = stateOf({ board: [{ tile: "6-6", left: 6, right: 6 }], hands: [["0-1"], ["0-2"]] });
  const passed = partyMove(state, 1, { action: "pass" });
  assert.ok(passed);
  assert.equal(passed.state.passes, 1);
  assert.equal(passed.turn, 2);
  assert.equal(passed.state.last.action, "pass");
});

test("dominó: jogo fechado pontua a diferença do menor número de pontos", () => {
  const state = stateOf({
    board: [{ tile: "6-6", left: 6, right: 6 }],
    hands: [["0-0"], ["1-1"]],
    turn: 1,
    points: [0, 0],
  });
  const first = partyMove(state, 1, { action: "pass" });
  assert.ok(first);
  assert.equal(first.turn, 2);
  const blocked = partyMove(first.state, 2, { action: "pass" });
  assert.ok(blocked);
  assert.equal(blocked.reason, "fechado");
  assert.equal(blocked.state.lastRound.reason, "fechado");
  assert.equal(blocked.state.lastRound.winner, 1);
  assert.equal(blocked.state.lastRound.points, 2, "1-1 (2 pontos) menos 0-0 (0 pontos)");
  assert.deepEqual(blocked.state.points, [2, 0]);
  assert.equal(blocked.state.roundNo, 2, "uma nova rodada é distribuída");
  const sizes = blocked.state.hands.map(hand => hand.length).sort((a, b) => a - b);
  assert.deepEqual(sizes, [HAND_SIZE - 1, HAND_SIZE], "quem abriu a nova rodada ficou com 6");
});

test("dominó: empate no jogo fechado não pontua e redistribui", () => {
  const state = stateOf({
    board: [{ tile: "6-6", left: 6, right: 6 }],
    hands: [["0-2"], ["1-1"]],
    turn: 1,
    points: [10, 20],
  });
  const first = partyMove(state, 1, { action: "pass" });
  const blocked = partyMove(first.state, 2, { action: "pass" });
  assert.ok(blocked);
  assert.equal(blocked.state.lastRound.tie, true);
  assert.equal(blocked.state.lastRound.winner, null);
  assert.equal(blocked.state.lastRound.points, 0);
  assert.deepEqual(blocked.state.points, [10, 20], "ninguém pontua no empate");
  assert.equal(blocked.state.roundNo, 2);
});

/* ---------- batida, pontuação e alvo ---------- */

test("dominó: quem bate soma os pontos que ficaram nas mãos dos outros", () => {
  const state = stateOf({
    hands: [["5-6"], ["2-6", "1-2"], ["0-3"]],
    board: [{ tile: "6-6", left: 6, right: 6 }],
    turn: 1,
    points: [0, 0, 0],
  });
  const result = partyMove(state, 1, { action: "play", tile: "5-6", end: "right" });
  assert.ok(result);
  assert.equal(result.reason, "batida");
  assert.equal(result.state.lastRound.reason, "batida");
  assert.equal(result.state.lastRound.winner, 1);
  assert.equal(result.state.lastRound.points, 8 + 3 + 3, "2-6 + 1-2 + 0-3 = 14");
  assert.deepEqual(result.state.points, [14, 0, 0]);
});

test("dominó: 100 pontos encerram a partida e o ranking é por pontos", () => {
  const state = stateOf({
    hands: [["5-6"], ["5-5", "4-2"]],
    board: [{ tile: "6-6", left: 6, right: 6 }],
    turn: 1,
    points: [98, 40],
  });
  const result = partyMove(state, 1, { action: "play", tile: "5-6", end: "right" });
  assert.ok(result);
  assert.equal(result.reason, "match");
  assert.equal(result.state.phase, "over");
  assert.equal(result.state.winner, 1);
  assert.deepEqual(result.state.ranking, [[1], [2]]);
  assert.equal(result.turn, null);
  assert.ok(result.state.points[0] >= TARGET);
  assert.deepEqual(placements(result.state.ranking), { 1: 1, 2: 2 });
  assert.equal(partyMove(result.state, 1, { action: "play", tile: "5-6", end: "right" }), null);
});

test("dominó: ranking agrupa empates de pontuação", () => {
  const state = stateOf({
    hands: [["5-6"], ["0-1"], ["0-2"]],
    board: [{ tile: "6-6", left: 6, right: 6 }],
    turn: 1,
    points: [98, 40, 40],
  });
  const result = partyMove(state, 1, { action: "play", tile: "5-6", end: "right" });
  assert.equal(result.reason, "match");
  assert.deepEqual(result.state.ranking, [[1], [2, 3]]);
  assert.deepEqual(placements(result.state.ranking), { 1: 1, 2: 2, 3: 2 });
});

/* ---------- visão do assento (sigilo) ---------- */

test("dominó: partyView entrega a mão própria, as pontas e o que dá para fazer", () => {
  const state = stateOf({
    board: [{ tile: "6-6", left: 6, right: 6 }],
    hands: [["5-6", "0-1"], ["4-6", "1-2"], ["2-3", "0-4"]],
    boneyard: ["1-1", "5-5"],
    turn: 1,
  });
  const view = partyView(state, 1, ctxOf(state));
  assert.deepEqual(view.hand, ["5-6", "0-1"]);
  assert.deepEqual(view.playable, ["5-6"]);
  assert.deepEqual(view.ends, [6, 6]);
  assert.equal(view.boneyard, 2);
  assert.equal(view.canPlay, true);
  assert.equal(view.canDraw, false);
  assert.equal(view.canPass, false);
  assert.equal(view.turn, 1);
  assert.deepEqual(view.counts, [
    { seat: 1, tiles: 2, out: false },
    { seat: 2, tiles: 2, out: false },
    { seat: 3, tiles: 2, out: false },
  ]);
  const text = JSON.stringify(view);
  assert.equal(text.includes("4-6"), false, "não vaza a mão do assento 2");
  assert.equal(text.includes("1-1"), false, "não vaza o monte");
  assert.equal(text.includes("123456789"), false, "não vaza a seed");
  assert.equal("seed" in view, false);
  assert.equal("boneyardTiles" in view, false);

  const other = partyView(state, 2, ctxOf(state));
  assert.deepEqual(other.hand, ["4-6", "1-2"]);
  assert.equal(other.canPlay, false);
});

test("dominó: partyView sabe quando comprar e quando passar", () => {
  const state = stateOf({
    board: [{ tile: "6-6", left: 6, right: 6 }],
    hands: [["0-1"], ["4-6"]],
    boneyard: ["2-2"],
    turn: 1,
  });
  const draw = partyView(state, 1, ctxOf(state));
  assert.equal(draw.canDraw, true);
  assert.equal(draw.canPass, false);
  assert.equal(draw.canPlay, false);
  const pass = partyView({ ...state, boneyard: [] }, 1, ctxOf(state));
  assert.equal(pass.canDraw, false);
  assert.equal(pass.canPass, true);
});

/* ---------- tempo e eliminação ---------- */

test("dominó: timeoutTurn compra até jogar, joga a menor pedra ou passa", () => {
  const drawAndPlay = stateOf({
    board: [{ tile: "6-6", left: 6, right: 6 }],
    hands: [["0-1", "0-2"], ["4-6", "1-2"]],
    boneyard: ["2-3", "5-6"],
    turn: 1,
  });
  const after = timeoutTurn(drawAndPlay, 1, ctxOf(drawAndPlay));
  assert.ok(after);
  assert.equal(after.hands[0].includes("5-6"), false, "a pedra comprada que servia foi jogada");
  assert.equal(after.turn, 2);
  assert.deepEqual(endsOf(after.board), [6, 5]);
  assert.equal(timeoutTurn(drawAndPlay, 2, ctxOf(drawAndPlay)), null, "não age fora da vez");

  const onlyDraw = stateOf({
    board: [{ tile: "6-6", left: 6, right: 6 }],
    hands: [["0-1"], ["4-6"]],
    boneyard: ["1-1"],
    turn: 1,
  });
  const still = timeoutTurn(onlyDraw, 1, ctxOf(onlyDraw));
  assert.ok(still);
  assert.equal(still.turn, 2, "comprou, continuou sem pedra jogável e passou");
  assert.equal(still.passes, 1);
  assert.equal(still.hands[0].length, 2);

  const blocked = stateOf({ board: [{ tile: "6-6", left: 6, right: 6 }], hands: [["0-1"], ["0-2"]], turn: 1 });
  const passed = timeoutTurn(blocked, 1, ctxOf(blocked));
  assert.ok(passed);
  assert.equal(passed.turn, 2);
  assert.equal(passed.passes, 1);
});

test("dominó: quem estoura o tempo no online sai da mesa e a vez anda para o próximo ativo", () => {
  const state = stateOf({
    hands: [["5-6", "0-1"], ["4-6", "1-2"], ["3-6", "2-2"]],
    board: [{ tile: "6-6", left: 6, right: 6 }],
    turn: 2,
  });
  const ctx = { seats: [1, 2, 3], out: [2] };
  const view = partyView(state, 3, ctx);
  assert.equal(view.turn, 3, "a vez pula o eliminado");
  assert.equal(view.counts[1].out, true);
  const moved = partyMove(state, 3, { action: "play", tile: "3-6", end: "left" }, ctx);
  assert.ok(moved, "o próximo ativo joga normalmente");
  assert.equal(moved.turn, 1);
  assert.equal(partyMove(state, 2, { action: "play", tile: "4-6", end: "left" }, ctx), null, "eliminado não joga");

  const twoOut = partyView(state, 3, { seats: [1, 2, 3], out: [1, 2] });
  assert.equal(twoOut.turn, 3);
  const final = partyMove(state, 3, { action: "pass" }, { seats: [1, 2, 3], out: [1, 2] });
  assert.ok(final);
  assert.equal(final.reason, "elimination");
  assert.deepEqual(final.ranking, [[3]], "sobrou um: ele é o primeiro");
});

/* ---------- contrato PARTY ---------- */

test("dominó: PARTY declara 2 a 4 jogadores por turnos, com tempo e eliminação", () => {
  assert.equal(PARTY.minPlayers, 2);
  assert.equal(PARTY.maxPlayers, 4);
  assert.deepEqual(PARTY.playerCounts, [2, 3, 4]);
  assert.equal(PARTY.order, "turns");
  assert.equal(PARTY.onTimeout, "out");
  assert.ok(PARTY.turnSeconds >= 5 && PARTY.turnSeconds <= 3600);
  assert.ok(PARTY.turnOptions.includes(PARTY.turnSeconds));
  assert.ok(PARTY.maxSeconds >= 30 && PARTY.maxSeconds <= 3600);
  assert.equal(TARGET, 100);
  assert.equal(HAND_SIZE, 7);
});
