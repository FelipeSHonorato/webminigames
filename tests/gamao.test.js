/* Gamão — regras puras (sem DOM, sem rede). Cobre abertura, barra, bloqueio, captura, máxima de
   dados, regra do dado maior, saída de peças e uma partida inteira dirigida por lances legais. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  BLACK, CHECKERS, DUEL, GAME_ID, WHITE, applyMove, autoRoll, canBearOff, findMove, initial, legalMoves,
  maxMoves, moveText, newGame, openingRoll, outcome, playMove, positionKey, revive, rollDice, rollOpening,
  serialize, START_POSITION,
} from "../games/gamao/domain.js";

const state = overrides => ({
  ...initial(),
  points: initial().points.slice(),
  bar: { w: 0, b: 0 },
  off: { w: 0, b: 0 },
  dice: [],
  roll: [],
  awaitingRoll: false,
  turn: WHITE,
  ...overrides,
});

const total = (s, color) =>
  s.points.reduce((n, v) => n + (color === WHITE ? Math.max(0, v) : Math.max(0, -v)), 0) +
  s.bar[color] + s.off[color];

const rngFrom = values => {
  let i = 0;
  return () => values[i++ % values.length];
};

/** PRNG determinístico para a partida completa. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("gamão: contrato do duelo e posição inicial oficial", () => {
  assert.equal(GAME_ID, "gamao");
  assert.deepEqual(DUEL, { kind: "turn", times: [3, 10, 30, 60] });
  assert.equal(START_POSITION.split(",").length, 25);
  assert.equal(initial().points[0], 0, "índice 0 não é usado");
  assert.equal(total(initial(), WHITE), CHECKERS);
  assert.equal(total(initial(), BLACK), CHECKERS);

  // 24/18/13/8/6 das claras e 1/12/17/19 das escuras.
  assert.equal(initial().points[24], 2);
  assert.equal(initial().points[13], 5);
  assert.equal(initial().points[8], 3);
  assert.equal(initial().points[6], 5);
  assert.equal(initial().points[1], -2);
  assert.equal(initial().points[12], -5);
  assert.equal(initial().points[17], -3);
  assert.equal(initial().points[19], -5);
});

test("gamão: abertura sorteia o maior dado e empate repete", () => {
  assert.deepEqual(openingRoll(6, 5), { tie: false, turn: WHITE, dice: [6, 5] });
  assert.deepEqual(openingRoll(2, 4), { tie: false, turn: BLACK, dice: [4, 2] });
  assert.deepEqual(openingRoll(3, 3), { tie: true, turn: null, dice: [] });
  assert.throws(() => openingRoll(0, 4), /dado inválido/);

  // 0.99 vira 6; 0.7 vira 5; a sequência inclui um empate (4,4) antes da decisão.
  const opening = rollOpening(rngFrom([0.6, 0.6, 0.99, 0.7]));
  assert.equal(opening.tie, false);
  assert.equal(opening.turn, WHITE);
  assert.deepEqual(opening.dice, [6, 5]);
});

test("gamão: newGame começa com os dados da abertura e todos os 15 checkers", () => {
  const game = newGame({ w: 6, b: 5 });
  assert.equal(game.state.turn, WHITE);
  assert.deepEqual(game.state.dice, [6, 5]);
  assert.equal(game.state.awaitingRoll, false);
  assert.equal(total(game.state, WHITE), CHECKERS);
  assert.equal(total(game.state, BLACK), CHECKERS);
  assert.equal(game.keys[0], positionKey(game.state));
  assert.deepEqual(game.result, { over: false, winner: null, reason: null });
  assert.throws(() => newGame({ w: 4, b: 4 }), /empatada/);
});

test("gamão: lance simples, notação e troca de vez quando os dados acabam", () => {
  const game = newGame({ w: 6, b: 5 });
  const move = findMove(game.state, { from: 13, to: 7, die: 6 });
  assert.ok(move, "13 → 7 com 6 é legal");
  assert.equal(move.hit, false);
  assert.equal(moveText(move), "13/7 (6)");

  const next = playMove(game, move);
  assert.equal(next.state.points[13], 4);
  assert.equal(next.state.points[7], 1);
  assert.deepEqual(next.state.dice, [5], "só o outro dado fica disponível");
  assert.equal(next.state.turn, WHITE, "a vez continua até usar os dados");
  assert.equal(next.moves.length, 1);
  assert.equal(next.moves[0].text, "13/7 (6)");

  const last = playMove(next, { from: 8, to: 3, die: 5 });
  assert.equal(last.state.turn, BLACK);
  assert.deepEqual(last.state.dice, []);
  assert.equal(last.state.awaitingRoll, true);
  assert.equal(last.state.turnNo, 2);
});

test("gamão: dados dobres valem quatro jogadas", () => {
  const rolled = rollDice(state({ turn: WHITE }), 4, 4);
  assert.deepEqual(rolled.dice, [4, 4, 4, 4]);
  assert.deepEqual(rolled.roll, [4, 4]);
  assert.equal(maxMoves(rolled) <= 4, true);
});

test("gamão: barra só deixa entrar, e ponto com duas peças bloqueia", () => {
  const s = state({
    points: Array(25).fill(0),
    bar: { w: 1, b: 1 },
    dice: [3],
  });
  s.points[13] = 1;
  s.points[22] = -2;          // barra das claras entraria em 22
  s.points[3] = 2;            // barra das escuras entraria em 3
  const moves = legalMoves(s);
  assert.equal(moves.length, 0, "as duas entradas estão bloqueadas");
  assert.equal(findMove(s, { from: 25, to: 22, die: 3 }), null);
  assert.equal(findMove(s, { from: 0, to: 3, die: 3 }), null);

  const open = state({ points: Array(25).fill(0), bar: { w: 1, b: 1 }, dice: [3] });
  open.points[22] = -1;       // uma peça: entra e captura
  open.points[3] = 1;         // uma peça: entra e captura
  const whiteEntry = findMove(open, { from: 25, to: 22, die: 3 });
  assert.ok(whiteEntry?.fromBar && whiteEntry.hit);
  const afterWhite = applyMove(open, whiteEntry);
  assert.equal(afterWhite.bar.w, 0);
  assert.equal(afterWhite.bar.b, 2);
  assert.equal(afterWhite.points[22], 1);

  // Depois de bater, a vez ainda é das claras; a barra das escuras agora tem duas peças.
  const blackState = { ...afterWhite, turn: BLACK, dice: [3] };
  const blackEntry = findMove(blackState, { from: 0, to: 3, die: 3 });
  assert.ok(blackEntry?.fromBar && blackEntry.hit);
});

test("gamão: a barra prende as peças — nenhuma outra sai do tabuleiro antes", () => {
  const s = state({
    points: Array(25).fill(0),
    bar: { w: 1, b: 0 },
    dice: [1, 2],
  });
  s.points[6] = 5;
  s.points[13] = 9;
  const moves = legalMoves(s);
  assert.ok(moves.length > 0);
  assert.ok(moves.every(move => move.fromBar), "com peça na barra só se joga a entrada");
});

test("gamão: bater peça isolada manda ela para a barra", () => {
  const s = state({
    points: Array(25).fill(0),
    turn: WHITE,
    dice: [4],
  });
  s.points[13] = 1;
  s.points[9] = -1;
  const move = findMove(s, { from: 13, to: 9, die: 4 });
  assert.ok(move?.hit);
  const after = applyMove(s, move);
  assert.equal(after.points[9], 1, "a peça clara ocupa o ponto");
  assert.equal(after.bar.b, 1, "a peça escura foi para a barra");
  assert.equal(after.points[13], 0);
});

test("gamão: só tira peça com as 15 na casa e a barra vazia", () => {
  const notHome = state({ dice: [6] });
  assert.equal(canBearOff(notHome, WHITE), false);
  assert.equal(findMove(notHome, { from: 6, to: 0, die: 6 }), null);

  const home = state({
    points: Array(25).fill(0),
    turn: WHITE,
    dice: [6],
  });
  home.points[6] = 15;
  assert.equal(canBearOff(home, WHITE), true);
  const off = findMove(home, "6/fora/6");
  assert.ok(off?.toOff);
  const after = applyMove(home, off);
  assert.equal(after.off.w, 1);
  assert.equal(after.points[6], 14);
});

test("gamão: com dado maior que a distância, só sai do ponto mais alto (claras) / mais baixo (escuras)", () => {
  const white = state({ points: Array(25).fill(0), turn: WHITE, dice: [6] });
  white.points[5] = 1;
  white.points[6] = 1;
  assert.equal(findMove(white, { from: 5, to: 0, die: 6 }), null, "a peça do ponto 6 está mais alta");
  assert.ok(findMove(white, { from: 6, to: 0, die: 6 }), "a peça do ponto 6 pode sair com 6");

  const black = state({ points: Array(25).fill(0), turn: BLACK, dice: [6] });
  black.points[19] = -1;
  black.points[20] = -1;
  assert.equal(findMove(black, { from: 20, to: 25, die: 6 }), null, "a peça do ponto 19 está mais baixa");
  assert.ok(findMove(black, { from: 19, to: 25, die: 6 }), "a peça do ponto 19 pode sair com 6");
});

test("gamão: é obrigatório usar o máximo de dados; com dois números e um só jogável, vale o maior", () => {
  /* Só a peça do ponto 13 existe. Com 6 e 2, o 6 leva a 7, mas dali o 2 ainda joga (7 → 5).
     Já o 2 leva a 11 e o 6 não joga (11 → 5? joga). Precisamos de uma posição em que o dado menor
     deixe o maior sem destino. Montamos um corredor: 13 com uma peça e uma parede inimiga em 7. */
  const s = state({ points: Array(25).fill(0), turn: WHITE, dice: [6, 2] });
  s.points[13] = 1;
  s.points[7] = -2;            // 13 - 6 = 7 bloqueado
  s.points[11] = -2;           // 13 - 2 = 11 bloqueado
  assert.equal(maxMoves(s), 0, "sem nenhum lance disponível");

  // Agora só o dado 6 tem destino: 13 → 7 livre, e depois 7 não tem destino com 2 porque 5 está bloqueado.
  const oneDie = state({ points: Array(25).fill(0), turn: WHITE, dice: [6, 2] });
  oneDie.points[13] = 1;
  oneDie.points[5] = -2;       // depois de 13 → 7, o 2 cairia em 5 bloqueado
  oneDie.points[11] = -2;      // e 13 → 11 está bloqueado
  assert.equal(maxMoves(oneDie), 1);
  const legal = legalMoves(oneDie);
  assert.ok(legal.length > 0);
  assert.ok(legal.every(move => move.die === 6), "o dado maior é obrigatório quando só ele completa a sequência máxima");
});

test("gamão: serialização ida e volta e recusa de tabuleiro de outro jogo", () => {
  const game = newGame({ w: 5, b: 2 });
  const copy = revive(serialize(game.state));
  assert.deepEqual(copy, game.state);
  assert.throws(() => revive({ ...serialize(game.state), game: "dama" }), /outro jogo/);
  assert.throws(() => revive({ ...serialize(game.state), points: [0, 1] }), /pontos inválidos/);
  assert.equal(revive(JSON.stringify(serialize(game.state))).turn, game.state.turn);
});

test("gamão: autoRoll rola e passa a vez de quem não tem lance", () => {
  // Uma peça clara no ponto 13, atrás de um muro escuro em 7..12: nenhum dado de 1 a 6 a solta.
  const s = state({ points: Array(25).fill(0), turn: WHITE, dice: [], awaitingRoll: true });
  s.points[13] = 1;
  for (let p = 7; p <= 12; p++) s.points[p] = -2;
  s.points[1] = -3; // fecha as 15 peças escuras (12 no muro + 3 no ponto 1)

  const rolled = autoRoll(s, mulberry32(7));
  assert.equal(outcome(rolled).over, false);
  assert.equal(rolled.turn, BLACK, "quem não tem lance passa a vez");
  assert.ok(rolled.dice.length > 0, "o próximo jogador já recebe os dados");
});

test("gamão: partida inteira com lances legais termina com 15 peças fora", () => {
  const rng = mulberry32(20261103);
  let game = newGame(rollOpening(rng));
  let plies = 0;

  while (!game.result.over && plies < 1200) {
    const moves = legalMoves(game.state);
    assert.ok(moves.length > 0, `sem lances na posição ${plies}: ${JSON.stringify(game.state)}`);
    const move = moves[Math.floor(rng() * moves.length) % moves.length];
    game = playMove(game, move);
    plies++;
    if (!game.result.over) game = { ...game, state: autoRoll(game.state, rng) };
  }

  assert.equal(game.result.over, true, `a partida não terminou em ${plies} lances`);
  assert.ok(game.result.winner === WHITE || game.result.winner === BLACK);
  const winner = game.result.winner;
  assert.equal(game.state.off[winner], CHECKERS, "quem venceu tirou as 15 peças");
  assert.equal(game.result.reason, "off");
  assert.ok(plies > 10 && plies < 1200);
});
