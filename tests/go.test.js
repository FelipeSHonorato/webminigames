/* Go: ranking Kyu/Dan, handicap/komi, regras (captura, suicídio, ko, duas passadas),
   contagem chinesa e coordenadas. Tudo no domínio puro — a Edge usa o mesmo arquivo. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  BLACK, WHITE, GAME_ID, SIZES, DUEL, BASE_RATING, MAX_HANDICAP,
  EVEN_KOMI, HANDICAP_KOMI,
  rankLevelFromRating, rankLabel, rankShort, handicapFor, komiFor,
  handicapPoints, starPoints, startState, revive, deserialize, serialize, positionKey,
  coordOf, parseCoord, groupAt, isLegal, playStone, pass, score, outcome,
  newGame, playMove, findMove, moveRecord, RESULT_LABELS,
} from "../games/go/domain.js";

const boardWith = (size, entries, extra = {}) => {
  const board = new Array(size * size).fill(0);
  for (const [point, value] of Object.entries(entries)) board[Number(point)] = value;
  return {
    size, board, turn: BLACK, captures: { b: 0, w: 0 }, ko: null, passes: 0,
    handicap: 0, komi: EVEN_KOMI, handicapColor: null, ...extra,
  };
};

test("go: contrato do duelo e tamanhos de tabuleiro", () => {
  assert.equal(GAME_ID, "go");
  assert.deepEqual(SIZES, [9, 13, 19]);
  assert.deepEqual(DUEL, { kind: "turn", times: [3, 10, 30, 60] });
  assert.deepEqual(RESULT_LABELS, {
    score: "Contagem de território",
    resign: "Desistência",
    timeout: "Tempo esgotado",
  });
});

test("go: rating vira grau Kyu/Dan — 1500 é 15 kyu, virando em 1 kyu/1 dan", () => {
  assert.equal(BASE_RATING, 1500);
  assert.equal(rankLevelFromRating(1500), 15);
  assert.equal(rankLabel(1500), "15 kyu");
  assert.equal(rankShort(1500), "15k");

  assert.equal(rankLabel(1000), "20 kyu");
  assert.equal(rankLevelFromRating(2900), 29);
  assert.equal(rankLabel(2900), "1 kyu", "o kyu conta de 30 para 1");
  assert.equal(rankShort(2900), "1k");

  assert.equal(rankLevelFromRating(3000), 30);
  assert.equal(rankLabel(3000), "1 dan");
  assert.equal(rankShort(3000), "1d");

  assert.equal(rankLabel(3800), "9 dan");
  assert.equal(rankShort(3800), "9d");
  assert.equal(rankLabel(9000), "9 dan", "o topo é 9 dan");
  assert.equal(rankLabel(-500), "30 kyu", "o piso é 30 kyu");

  assert.equal(rankLabel("1500"), "15 kyu", "string numérica vale");
  assert.equal(rankLabel("abc"), "15 kyu", "rating inválido cai no inicial");
  assert.equal(rankLabel(null), "15 kyu", "sem rating também cai no inicial");
  assert.equal(rankLabel(""), "15 kyu");
  assert.equal(rankLevelFromRating(1549), 15);
  assert.equal(rankLevelFromRating(1550), 16);
  assert.equal(rankLevelFromRating(1450), 14, "0,5 desce para longe do zero, como no Postgres");
  assert.equal(rankLabel(1450), "16 kyu");
});

test("go: handicap é a diferença de graus (até 9) e o komi cai com 2+ pedras", () => {
  assert.equal(handicapFor(1500, 1500), 0);
  assert.equal(handicapFor(1500, 1600), 0, "1 grau de diferença ainda é partida equilibrada");
  assert.equal(handicapFor(1500, 1700), 2);
  assert.equal(handicapFor(1500, 1900), 4);
  assert.equal(handicapFor(1900, 1500), 4, "a ordem não importa");
  assert.equal(handicapFor(1500, 4000), MAX_HANDICAP, "o handicap para em 9 pedras");

  assert.equal(komiFor(0), EVEN_KOMI);
  assert.equal(komiFor(1), EVEN_KOMI, "1 pedra ainda é partida equilibrada");
  assert.equal(komiFor(2), HANDICAP_KOMI);
  assert.equal(komiFor(9), HANDICAP_KOMI);
});

test("go: pontos de handicap/estrela seguem a ordem tradicional", () => {
  assert.deepEqual(handicapPoints(9), [20, 60, 56, 24, 40, 38, 42, 22, 58]);
  assert.deepEqual(handicapPoints(13), [42, 126, 120, 48, 84, 81, 87, 45, 123]);
  assert.deepEqual(handicapPoints(19), [60, 300, 288, 72, 180, 174, 186, 66, 294]);
  assert.equal(starPoints(9).length, 9);
  assert.equal(starPoints(19).length, 9);
  assert.ok(starPoints(9).includes(20), "o centro é estrela");
  assert.deepEqual(starPoints(10), [], "tamanho fora do contrato não tem estrelas");
  assert.throws(() => handicapPoints(10), /tabuleiro inválido/);
});

test("go: partida equilibrada começa vazia, komi 6,5 e pretas jogam", () => {
  const state = startState({ size: 9 });
  assert.equal(state.size, 9);
  assert.equal(state.board.length, 81);
  assert.ok(state.board.every(v => v === 0));
  assert.equal(state.turn, BLACK);
  assert.equal(state.handicap, 0);
  assert.equal(state.komi, EVEN_KOMI);
  assert.equal(state.handicapColor, null);
  assert.deepEqual(state.captures, { b: 0, w: 0 });

  const one = startState({ size: 13, handicap: 1 });
  assert.equal(one.handicap, 0, "1 pedra não vira handicap");
  assert.equal(one.komi, EVEN_KOMI);
  assert.equal(one.turn, BLACK);

  assert.throws(() => startState({ size: 10 }), /tabuleiro inválido/);
});

test("go: handicap coloca as pedras do lado mais fraco e ele começa", () => {
  const state = startState({ size: 9, handicap: 4, handicapColor: WHITE });
  const points = handicapPoints(9).slice(0, 4);
  for (const point of points) assert.equal(state.board[point], 2, `pedra branca em ${point}`);
  assert.equal(state.handicap, 4);
  assert.equal(state.komi, HANDICAP_KOMI);
  assert.equal(state.handicapColor, WHITE);
  assert.equal(state.turn, WHITE, "quem recebe as pedras começa");
  assert.equal(state.board.filter(Boolean).length, 4);
});

test("go: captura simples remove o grupo sem liberdades e conta para quem capturou", () => {
  const state = boardWith(9, { 0: 2, 1: 1 });   // branca no canto A9, preta em B9
  const played = playStone(state, 9);            // preta em A8 fecha o canto
  assert.equal(played.state.board[0], 0, "a pedra branca saiu");
  assert.equal(played.state.board[9], 1);
  assert.equal(played.state.captures.b, 1);
  assert.equal(played.state.captures.w, 0);
  assert.equal(played.state.turn, WHITE);
  assert.equal(played.captureCount, 1);
  assert.deepEqual(played.captured, [0]);
});

test("go: suicídio é ilegal, e jogar em pedra ocupada também", () => {
  const suicide = boardWith(9, { 1: 1, 9: 1 }, { turn: WHITE });
  assert.equal(isLegal(suicide, 0), false, "A9 sem liberdades seria suicídio");
  assert.equal(playStone(suicide, 0), null);

  const occupied = boardWith(9, { 40: 1 });
  assert.equal(isLegal(occupied, 40), false);
  assert.equal(isLegal(occupied, 41), true);
  assert.equal(isLegal(occupied, -1), false);
  assert.equal(isLegal(occupied, 81), false);
});

test("go: ko simples proíbe a recaptura imediata", () => {
  // Brancas: 40 (cercada), 30, 32, 22. Pretas: 39, 41, 49 e jogam 31.
  const state = boardWith(9, { 40: 2, 30: 2, 32: 2, 22: 2, 39: 1, 41: 1, 49: 1 });
  const played = playStone(state, 31);
  assert.ok(played, "a captura é legal");
  assert.equal(played.state.board[40], 0);
  assert.equal(played.state.captures.b, 1);
  assert.equal(played.state.ko, 40, "a interseção vazia vira ko");
  assert.equal(played.state.turn, WHITE);
  assert.equal(isLegal(played.state, 40), false, "brancas não recapturam na hora");
});

test("go: duas passadas seguidas encerram e contam pela área chinesa", () => {
  const game = newGame({ size: 9 });
  const first = playMove(game, { type: "pass" });
  assert.equal(first.state.passes, 1);
  assert.equal(first.result.over, false);
  assert.equal(first.moves.at(-1).type, "pass");
  assert.equal(first.last.text, "pass");

  const second = playMove(first, "passar");
  assert.equal(second.state.passes, 2);
  assert.equal(second.result.over, true);
  assert.equal(second.result.reason, "score");
  assert.equal(second.result.score.black, 0);
  assert.equal(second.result.score.white, EVEN_KOMI);
  assert.equal(second.result.winner, WHITE, "tabuleiro vazio: o komi dá a vitória às brancas");

  // Pedra preta no tabuleiro zera a passada anterior.
  const reset = playMove(first, 40);
  assert.equal(reset.state.passes, 0);
});

test("go: contagem soma pedras + território cercado + komi", () => {
  const state = boardWith(5, { 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 15: 2 }, { komi: 0.5 });
  const result = score(state);
  assert.equal(result.black, 10, "5 pedras + 5 pontos de território na primeira linha");
  assert.equal(result.white, 1.5, "1 pedra branca + komi");
  assert.equal(result.komi, 0.5);
  assert.equal(result.winner, BLACK);
});

test("go: coordenadas usam A-T sem I e a linha conta de baixo", () => {
  assert.equal(coordOf(9, 0), "A9");
  assert.equal(coordOf(9, 8), "J9");
  assert.equal(coordOf(9, 72), "A1");
  assert.equal(coordOf(9, 80), "J1");
  assert.equal(coordOf(9, -1), "");
  assert.equal(coordOf(9, 81), "");

  assert.equal(parseCoord(9, "A9"), 0);
  assert.equal(parseCoord(9, "j1"), 80);
  assert.equal(parseCoord(9, " I5 "), -1, "não existe coluna I");
  assert.equal(parseCoord(9, "T1"), -1, "fora do tabuleiro 9×9");
  assert.equal(parseCoord(9, "A10"), -1);
  assert.equal(parseCoord(9, "A0"), -1);
  assert.equal(parseCoord(9, ""), -1);
});

test("go: serialize/revive preservam a posição e normalizam lixo", () => {
  const game = playMove(playMove(newGame({ size: 13 }), 42), 43);
  const copy = revive(JSON.parse(JSON.stringify(serialize(game.state))));
  assert.deepEqual(copy, game.state);
  assert.equal(positionKey(copy), positionKey(game.state));
  assert.equal(deserialize, revive);

  const messy = revive({
    size: 9, board: new Array(81).fill(9), turn: "x", captures: { b: -3, w: 2.9 },
    ko: 999, passes: -1, handicap: 99, komi: "abc", handicapColor: "z",
  });
  assert.equal(messy.turn, BLACK);
  assert.ok(messy.board.every(v => v === 0));
  assert.deepEqual(messy.captures, { b: 0, w: 2 });
  assert.equal(messy.ko, null);
  assert.equal(messy.passes, 0);
  assert.equal(messy.handicap, MAX_HANDICAP);
  assert.equal(messy.komi, EVEN_KOMI);
  assert.equal(messy.handicapColor, null);
  assert.throws(() => revive(null), /estado inválido/);
  assert.throws(() => revive({ size: 10, board: [] }), /tamanho/);
  assert.throws(() => revive({ size: 9, board: [1] }), /tabuleiro/);
});

test("go: findMove aceita ponto, coordenada e pass; lance ilegal é recusado", () => {
  const game = newGame({ size: 9 });
  assert.deepEqual(findMove(game.state, { point: 40 }), { type: "play", point: 40 });
  assert.deepEqual(findMove(game.state, 40), { type: "play", point: 40 });
  assert.deepEqual(findMove(game.state, "E5"), { type: "play", point: 40 });
  assert.deepEqual(findMove(game.state, { coord: "e5" }), { type: "play", point: 40 });
  assert.deepEqual(findMove(game.state, "pass"), { type: "pass" });
  assert.deepEqual(findMove(game.state, "passar"), { type: "pass" });
  assert.deepEqual(findMove(game.state, { type: "pass" }), { type: "pass" });
  assert.deepEqual(findMove(game.state, { pass: true }), { type: "pass" });
  assert.equal(findMove(game.state, "I5"), null);
  assert.equal(findMove(game.state, { point: 999 }), null);
  assert.equal(findMove(game.state, null), null);

  const played = playMove(game, "E5");
  assert.deepEqual(played.last, {
    type: "play", color: BLACK, point: 40, coord: "E5", captures: 0, text: "E5",
  });
  assert.equal(played.state.turn, WHITE);
  assert.equal(played.keys.length, 2);
  assert.throws(() => playMove(played, 40), /lance ilegal/);
});

test("go: grupo e liberdades são calculados no tabuleiro", () => {
  const state = boardWith(9, {
    39: 1, 40: 1, 41: 1,
    30: 2, 31: 2, 32: 2, 48: 2, 49: 2, 50: 2,
  });
  const group = groupAt(state.board, 9, 40);
  assert.deepEqual(group.stones.sort((a, b) => a - b), [39, 40, 41]);
  assert.deepEqual([...group.liberties].sort((a, b) => a - b), [38, 42]);
  assert.deepEqual(groupAt(state.board, 9, 0), { stones: [], liberties: new Set() });
});

test("go: moveRecord guarda a captura no texto do histórico", () => {
  const record = moveRecord({ size: 9, turn: WHITE }, { type: "play", point: 40 }, 2);
  assert.equal(record.coord, "E5");
  assert.equal(record.captures, 2);
  assert.equal(record.text, "E5×2");
  const passRecord = moveRecord({ size: 9, turn: BLACK }, { type: "pass" }, 0);
  assert.equal(passRecord.point, null);
  assert.equal(passRecord.text, "pass");
});

test("go: outcome só fecha com duas passadas", () => {
  const state = startState({ size: 9 });
  assert.deepEqual(outcome(state), { over: false, winner: null, reason: null, score: null });
  assert.equal(outcome(pass(pass(state))).over, true);
});
