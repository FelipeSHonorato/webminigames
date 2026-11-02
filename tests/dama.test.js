/* Testes da dama: movimento, captura obrigatória (máxima), dama voadora, promoção, fim de jogo
   e serialização. A dama é um jogo de duelo por turnos; o domínio é puro e roda no Node e na Edge. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  BLACK, DUEL, RESULT_LABELS, START_POSITION, WHITE, applyMove, colorOf, findMove, fromPosition,
  initial, isKing, legalMoves, moveRecord, moveText, movesFrom, newGame, outcome, parseSquare,
  playMove, positionKey, repetitions, square, squareName, toPath, toPosition, typeOf,
} from "../games/dama/domain.js";

/** Monta um estado a partir de [file, rank, peça]. */
const stateOf = (pieces, turn = WHITE) => {
  const board = new Array(64).fill(null);
  for (const [f, r, piece] of pieces) board[square(f, r)] = piece;
  return { board, turn };
};

const legalText = state => legalMoves(state).map(moveText);

/* ---------- posição inicial ---------- */

test("dama: posição inicial com 12 peças de cada lado nas casas escuras", () => {
  const game = newGame();
  assert.equal(toPosition(game.state), START_POSITION);
  assert.equal(game.state.turn, WHITE);
  assert.deepEqual(game.result, { over: false, winner: null, reason: null });
  assert.equal(game.keys.length, 1);
  assert.equal(game.moves.length, 0);

  const whites = [], blacks = [];
  for (let sq = 0; sq < 64; sq++) {
    const piece = game.state.board[sq];
    if (!piece) continue;
    assert.equal((sq & 7) + (sq >> 3) & 1, 0, `${squareName(sq)} deveria ser escura`);
    if (colorOf(piece) === WHITE) whites.push(piece);
    else blacks.push(piece);
  }
  assert.equal(whites.length, 12);
  assert.equal(blacks.length, 12);
  assert.ok(whites.every(p => p === "P"));
  assert.ok(blacks.every(p => p === "p"));

  // As brancas começam e só os peões da terceira fileira têm para onde ir.
  assert.deepEqual(legalText(game.state), [
    "a3–b4", "c3–b4", "c3–d4", "e3–d4", "e3–f4", "g3–f4", "g3–h4",
  ]);
});

test("dama: serialização ida e volta preserva tabuleiro e vez", () => {
  const state = stateOf([[2, 2, "P"], [3, 3, "p"], [6, 6, "D"], [1, 7, "d"]], BLACK);
  assert.deepEqual(fromPosition(toPosition(state), BLACK), state);
  assert.equal(positionKey(state), `${toPosition(state)} b`);
  assert.deepEqual(initial(), fromPosition(START_POSITION, WHITE));
});

test("dama: nomes de casa, peças e tipos", () => {
  assert.equal(parseSquare("a1"), 0);
  assert.equal(parseSquare("h8"), 63);
  assert.equal(parseSquare("A1"), 0);
  assert.equal(parseSquare("i9"), -1);
  assert.equal(squareName(parseSquare("c3")), "c3");
  assert.equal(colorOf("P"), WHITE);
  assert.equal(colorOf("d"), BLACK);
  assert.equal(colorOf(null), null);
  assert.equal(isKing("D"), true);
  assert.equal(isKing("d"), true);
  assert.equal(isKing("P"), false);
  assert.equal(typeOf("d"), "D");
  assert.equal(typeOf(null), null);
});

/* ---------- peões ---------- */

test("dama: o peão anda uma casa na diagonal, só para frente", () => {
  const white = stateOf([[2, 2, "P"]]);
  assert.deepEqual(legalText(white), ["c3–b4", "c3–d4"]);

  const black = stateOf([[3, 5, "p"]], BLACK);
  assert.deepEqual(legalText(black), ["d6–c5", "d6–e5"]);

  // Casa ocupada bloqueia; captura só existe se houver peça adversária.
  const blocked = stateOf([[2, 2, "P"], [3, 3, "P"], [1, 3, "P"]]);
  assert.deepEqual(movesFrom(blocked, parseSquare("c3")).map(moveText), []);
});

test("dama: o peão captura em qualquer diagonal, inclusive para trás", () => {
  assert.deepEqual(legalText(stateOf([[2, 2, "P"], [3, 3, "p"]])), ["c3×e5"]);
  assert.deepEqual(legalText(stateOf([[2, 2, "P"], [1, 1, "p"]])), ["c3×a1"]);
  assert.deepEqual(legalText(stateOf([[1, 5, "p"], [2, 4, "P"]], BLACK)), ["b6×d4"]);
});

test("dama: não pode saltar peça própria, casa ocupada ou a mesma peça duas vezes", () => {
  const own = stateOf([[2, 2, "P"], [3, 3, "P"]]);
  assert.deepEqual(movesFrom(own, parseSquare("c3")).map(moveText), ["c3–b4"]);

  const occupied = stateOf([[2, 2, "P"], [3, 3, "p"], [4, 4, "P"]]);
  assert.deepEqual(movesFrom(occupied, parseSquare("c3")).map(moveText), ["c3–b4"]);
});

/* ---------- dama voadora ---------- */

test("dama: anda qualquer distância na diagonal e para na primeira peça", () => {
  const state = stateOf([[0, 0, "D"], [4, 4, "P"]]);
  assert.deepEqual(movesFrom(state, parseSquare("a1")).map(moveText), ["a1–b2", "a1–c3", "a1–d4"]);
});

test("dama: captura à distância e escolhe qualquer casa vazia depois da peça", () => {
  const state = stateOf([[0, 0, "D"], [3, 3, "p"]]);
  assert.deepEqual(legalText(state), ["a1×e5", "a1×f6", "a1×g7", "a1×h8"]);
});

test("dama: captura voadora não passa por peça própria e não come a mesma peça duas vezes", () => {
  const blocked = stateOf([[0, 0, "D"], [2, 2, "P"], [5, 5, "p"]]);
  assert.deepEqual(movesFrom(blocked, parseSquare("a1")).map(moveText), ["a1–b2"]);

  const once = stateOf([[0, 0, "D"], [2, 2, "p"]]);
  const moves = legalMoves(once);
  assert.ok(moves.length > 0);
  assert.deepEqual(moves.map(m => m.captureCount), [1, 1, 1, 1, 1]);
});

/* ---------- captura obrigatória e máxima ---------- */

test("dama: captura é obrigatória — se existe captura, os lances simples somem", () => {
  const state = stateOf([[2, 2, "P"], [3, 3, "p"]]);
  assert.deepEqual(legalText(state), ["c3×e5"]);
  assert.equal(legalMoves(state).every(m => m.captureCount === 1), true);
});

test("dama: vale a MÁXIMA captura, não a primeira que aparece", () => {
  // c3 pode comer b2 (1 peça) para trás ou d4 e depois f6 (2 peças) para frente.
  const state = stateOf([[2, 2, "P"], [3, 3, "p"], [5, 5, "p"], [1, 1, "p"]]);
  const moves = legalMoves(state);
  assert.deepEqual(moves.map(moveText), ["c3×e5×g7"]);
  assert.equal(moves[0].captureCount, 2);
  assert.equal(moves[0].captures.length, 2);
  assert.deepEqual(moves[0].captures.map(squareName), ["d4", "f6"]);
});

test("dama: captura em ciclo pode terminar na casa de origem (a origem fica livre durante o lance)", () => {
  /* Peão branco em e3 com peças pretas em d4, d6, f6 e f4: dá a volta e fecha o losango em e3 (4 capturas). */
  const state = stateOf([[4, 2, "P"], [3, 3, "p"], [3, 5, "p"], [5, 5, "p"], [5, 3, "p"]]);
  const moves = legalMoves(state);
  assert.deepEqual(moves.map(toPath).sort(), ["e3c5e7g5e3", "e3g5e7c5e3"]);
  assert.ok(moves.every(m => m.captureCount === 4 && m.to === m.from));

  const next = applyMove(state, findMove(state, "e3g5e7c5e3"));
  assert.equal(next.board[square(4, 2)], "P", "o peão termina na própria casa de origem");
  assert.equal(next.board.filter(Boolean).length, 1, "as quatro peças pretas saíram");
  assert.equal(moveText(moves[0]).split("×").length, 5);
});

test("dama: a dama voadora também fecha o ciclo na origem e escolhe onde parar depois", () => {
  const state = stateOf([[4, 2, "D"], [3, 3, "p"], [3, 5, "p"], [5, 5, "p"], [5, 3, "p"]]);
  const moves = legalMoves(state);
  assert.ok(moves.every(m => m.captureCount === 4), "vale a máxima: as 4 peças");
  assert.ok(moves.some(m => toPath(m) === "e3g5e7c5e3"), "pode terminar exatamente na origem");
  assert.ok(moves.some(m => toPath(m) === "e3g5e7c5g1"), "ou seguir adiante na diagonal livre");
});

test("dama: o ciclo não deixa a peça capturada ser saltada duas vezes", () => {
  /* Só três peças em volta: o ciclo não fecha, então o lance para em 3 capturas. */
  const state = stateOf([[4, 2, "P"], [3, 3, "p"], [3, 5, "p"], [5, 5, "p"]]);
  assert.ok(legalMoves(state).every(m => m.captureCount === 3));
});

test("dama: a sequência continua enquanto houver captura (não pode parar no meio)", () => {
  const state = stateOf([[2, 2, "P"], [3, 3, "p"], [5, 5, "p"]]);
  assert.deepEqual(legalText(state), ["c3×e5×g7"]);
  const one = stateOf([[2, 2, "P"], [3, 3, "p"]]);
  assert.deepEqual(legalText(one), ["c3×e5"]);
});

/* ---------- promoção ---------- */

test("dama: peão que termina na última fileira vira dama", () => {
  const state = stateOf([[0, 6, "P"]]);                       // a7
  const moves = legalMoves(state);
  assert.deepEqual(moves.map(moveText), ["a7–b8"]);
  assert.ok(moves.every(m => m.promotion));
  const next = applyMove(state, moves[0]);
  assert.equal(next.board[parseSquare("b8")], "D");
  assert.equal(next.turn, BLACK);
  assert.deepEqual(outcome(next), { over: true, winner: WHITE, reason: "no_moves" });
});

test("dama: promoção por captura e continuidade no meio da sequência (não promove antes do fim)", () => {
  // b6 come c7 e cai em d8 (última fileira); sem mais captura, promove.
  const promo = stateOf([[1, 5, "P"], [2, 6, "p"]]);
  assert.deepEqual(legalText(promo), ["b6×d8"]);
  const [move] = legalMoves(promo);
  assert.equal(move.promotion, true);
  const afterPromo = applyMove(promo, move);
  assert.equal(afterPromo.board[parseSquare("d8")], "D");

  // b6 come c7, cai em d8, e continua comendo e7 para f6: termina peão (não promoveu no meio).
  const crossing = stateOf([[1, 5, "P"], [2, 6, "p"], [4, 6, "p"]]);
  assert.deepEqual(legalText(crossing), ["b6×d8×f6"]);
  const [long] = legalMoves(crossing);
  assert.equal(long.captureCount, 2);
  assert.equal(long.promotion, false);
  const afterLong = applyMove(crossing, long);
  assert.equal(afterLong.board[parseSquare("f6")], "P");
  assert.equal(afterLong.board[parseSquare("d8")], null);
});

/* ---------- lance, histórico e fim ---------- */

test("dama: findMove aceita caminho em texto, array e objeto", () => {
  const state = stateOf([[2, 2, "P"], [3, 3, "p"], [5, 5, "p"]]);
  for (const input of ["c3e5g7", ["c3", "e5", "g7"], { path: "c3e5g7" }, { path: ["c3", "e5", "g7"] }]) {
    const move = findMove(state, input);
    assert.ok(move, `não achou ${JSON.stringify(input)}`);
    assert.deepEqual(move.path.map(squareName), ["c3", "e5", "g7"]);
  }
  assert.equal(findMove(state, "c3e5"), null, "parar no meio da captura não é lance legal");
  assert.equal(findMove(state, "c3d4"), null, "lance simples some quando há captura");
  assert.equal(findMove(state, "x9"), null);
});

test("dama: playMove guarda caminho, capturas e promoção no histórico", () => {
  const state = stateOf([[2, 2, "P"], [3, 3, "p"], [5, 5, "p"]]);
  const game = { state, keys: [positionKey(state)], moves: [], last: null, result: { over: false } };
  const next = playMove(game, "c3e5g7");
  assert.equal(next.moves.length, 1);
  assert.deepEqual(next.moves[0], {
    path: "c3e5g7", captures: ["d4", "f6"], captureCount: 2, promotion: false,
  });
  assert.deepEqual(next.last, next.moves[0]);
  assert.equal(next.state.turn, BLACK);
  assert.equal(next.keys.length, 2);
  assert.equal(next.state.board[parseSquare("d4")], null);
  assert.equal(next.state.board[parseSquare("f6")], null);
  assert.equal(next.state.board[parseSquare("g7")], "P");
  assert.equal(toPath(legalMoves(state)[0]), "c3e5g7");
  assert.deepEqual(moveRecord(legalMoves(state)[0]), next.moves[0]);
});

test("dama: perde quem fica sem lances (não é empate como no xadrez)", () => {
  const stuck = stateOf([[0, 0, "P"], [1, 1, "p"], [2, 2, "p"]]);
  assert.equal(legalMoves(stuck).length, 0);
  assert.deepEqual(outcome(stuck), { over: true, winner: BLACK, reason: "no_moves" });
});

test("dama: repetição tripla empata", () => {
  const state = initial();
  const key = positionKey(state);
  assert.equal(repetitions(state, [key]), 1);
  assert.equal(repetitions(state, [key, key, key]), 3);
  assert.deepEqual(outcome(state, [key, key, key]), { over: true, winner: null, reason: "repetition" });
  assert.equal(outcome(state, [key, key]).over, false);
});

test("dama: contrato do duelo e rótulos", () => {
  assert.deepEqual(DUEL, { kind: "turn", times: [3, 10, 30, 60] });
  assert.equal(RESULT_LABELS.no_moves, "Sem lances");
  assert.equal(RESULT_LABELS.repetition, "Repetição tripla");
  assert.equal(RESULT_LABELS.resign, "Desistência");
  assert.equal(RESULT_LABELS.timeout, "Tempo esgotado");
});

test("dama: lances de uma casa e cor inválida", () => {
  const state = stateOf([[2, 2, "P"], [3, 3, "p"], [5, 5, "p"]]);
  assert.deepEqual(movesFrom(state, parseSquare("c3")).map(moveText), ["c3×e5×g7"]);
  assert.deepEqual(movesFrom(state, parseSquare("d4")), [], "peça do adversário não tem lances");
});
