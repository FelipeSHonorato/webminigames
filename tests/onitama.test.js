/* Testes do Onitama: cartas, sorteio, lances, vitória (Pedra e Rio), passada, repetição e serialização.
   O Onitama é um duelo por turnos; o domínio é puro e roda no Node e na Edge. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  BLUE, RED, CARDS, CARD_IDS, DUEL, RESULT_LABELS, START_POSITION, TEMPLE, applyMove, colorOf,
  dealCards, findMove, fromPosition, initial, legalMoves, moveRecord, moveText, movesFrom, newGame,
  offsets, outcome, parseSquare, playMove, positionKey, repetitions, square, squareName, toPosition,
} from "../games/onitama/domain.js";
import { makeRng } from "../shared/rng.js";

const CARDS5 = { b: ["tiger", "dragon"], r: ["frog", "rabbit"], side: "crab" };

/** Estado a partir de [casa, peça] + cartas. */
const stateOf = (pieces, turn = BLUE, cards = CARDS5) => {
  const board = new Array(25).fill(null);
  for (const [name, p] of pieces) board[parseSquare(name)] = p;
  return { board, turn, cards: { b: [...cards.b], r: [...cards.r], side: cards.side } };
};
const play = (state, from, to, card) => {
  const m = findMove(state, { from, to, card });
  assert.ok(m, `lance ${from}-${to} ${card} deveria ser legal`);
  return applyMove(state, m);
};

/* ---------- cartas ---------- */

test("onitama: 16 cartas, 8 de cada selo, com 2 a 4 movimentos", () => {
  assert.equal(CARD_IDS.length, 16);
  assert.equal(CARD_IDS.filter(id => CARDS[id].stamp === "b").length, 8);
  assert.equal(CARD_IDS.filter(id => CARDS[id].stamp === "r").length, 8);
  for (const id of CARD_IDS) {
    const { moves, name } = CARDS[id];
    assert.ok(name && moves.length >= 2 && moves.length <= 4, id);
    assert.ok(moves.every(([dx, dy]) => (dx || dy) && Math.abs(dx) <= 2 && Math.abs(dy) <= 2), id);
    assert.equal(new Set(moves.map(m => m.join(","))).size, moves.length, `${id}: movimento repetido`);
  }
  assert.equal(new Set(CARD_IDS.map(id => CARDS[id].name)).size, 16);
});

test("onitama: o vermelho vê o padrão da carta espelhado", () => {
  assert.deepEqual(offsets("tiger", BLUE), [[0, 2], [0, -1]]);
  assert.deepEqual(offsets("tiger", RED), [[0, -2], [0, 1]]);
  assert.deepEqual(offsets("frog", RED).map(([x, y]) => [x + 0, y + 0]), [[2, 0], [1, -1], [-1, 1]]);
  assert.throws(() => offsets("nope", BLUE), /carta/);
});

test("onitama: pares espelhados (Sapo/Coelho, Ganso/Galo, Enguia/Cobra, Cavalo/Boi)", () => {
  const flip = id => CARDS[id].moves.map(([x, y]) => `${-x},${y}`).sort().join("|");
  const same = id => CARDS[id].moves.map(([x, y]) => `${x},${y}`).sort().join("|");
  assert.equal(flip("frog"), same("rabbit")); // Sapo é o Coelho refletido
  assert.equal(flip("goose"), same("rooster"));
  assert.equal(flip("eel"), same("cobra"));
  assert.equal(flip("horse"), same("ox"));
  // cartas simétricas (iguais ao próprio reflexo)
  for (const id of ["tiger", "dragon", "crab", "elephant", "monkey", "mantis", "crane", "boar"]) {
    assert.equal(flip(id), same(id), id);
  }
});

/* ---------- sorteio ---------- */

test("onitama: dealCards é determinístico e dá 5 cartas distintas", () => {
  const a = dealCards(makeRng(123)), b = dealCards(makeRng(123));
  assert.deepEqual(a, b);
  const all = [...a.b, ...a.r, a.side];
  assert.equal(all.length, 5);
  assert.equal(new Set(all).size, 5);
  assert.ok(all.every(id => CARDS[id]));
  assert.notDeepEqual(dealCards(makeRng(1)), dealCards(makeRng(2)));
  assert.throws(() => dealCards(), /rng/);
});

test("onitama: o sorteio cobre todas as cartas ao longo de várias sementes", () => {
  const seen = new Set();
  for (let s = 0; s < 200; s++) { const d = dealCards(makeRng(s)); [...d.b, ...d.r, d.side].forEach(c => seen.add(c)); }
  assert.equal(seen.size, 16);
});

/* ---------- posição inicial ---------- */

test("onitama: posição inicial, vez pelo selo da carta do lado", () => {
  const game = newGame(CARDS5);
  assert.equal(toPosition(game.state), "ssmss/...../...../...../SSMSS r tiger,dragon frog,rabbit crab");
  assert.equal(game.state.turn, CARDS.crab.stamp); // caranguejo: selo vermelho
  assert.deepEqual(game.result, { over: false, winner: null, reason: null });
  assert.equal(game.keys.length, 1);

  const blue = [], red = [];
  game.state.board.forEach((p, i) => { if (p) (colorOf(p) === BLUE ? blue : red).push(squareName(i)); });
  assert.deepEqual(blue.sort(), ["a1", "b1", "c1", "d1", "e1"]);
  assert.deepEqual(red.sort(), ["a5", "b5", "c5", "d5", "e5"]);
  assert.equal(game.state.board[square(2, 0)], "M");
  assert.equal(game.state.board[square(2, 4)], "m");
  assert.deepEqual(TEMPLE, { b: square(2, 0), r: square(2, 4) });
  assert.equal(START_POSITION, "ssmss/...../...../...../SSMSS");
});

test("onitama: quem começa vem do selo da carta do lado (as duas cores acontecem)", () => {
  const turns = new Set();
  for (let s = 0; s < 40; s++) turns.add(newGame(dealCards(makeRng(s))).state.turn);
  assert.deepEqual([...turns].sort(), ["b", "r"]);
});

test("onitama: o duelo é por turnos com ritmos válidos", () => {
  assert.equal(DUEL.kind, "turn");
  assert.deepEqual(DUEL.times, [2, 5, 10, 15]);
});

/* ---------- lances ---------- */

test("onitama: lances iniciais do azul (Tigre e Dragão)", () => {
  const state = fromPosition("ssmss/...../...../...../SSMSS b tiger,dragon frog,rabbit crab");
  const texts = legalMoves(state).map(moveText).sort();
  // Tigre: 2 à frente (a/b/c/d/e1 → rank 3), 1 atrás sai do tabuleiro. Dragão: (±2,1),(±1,-1)
  assert.ok(texts.includes("c1–c3 Tigre"));
  assert.ok(texts.includes("a1–c2 Dragão"));
  assert.ok(texts.includes("e1–c2 Dragão"));
  assert.ok(!texts.some(t => t.startsWith("c1–c2")), "Dragão não anda reto");
  // casas próprias bloqueiam: b1→(d2) vale, mas c1+2=e1 está ocupada
  assert.equal(legalMoves(state).every(m => !m.pass), true);
  // Tigre: 5 peças, cada uma para frente 2 = 5 lances; Dragão: (-2,1) e (+2,1) por peça que cabem
  assert.equal(legalMoves(state).filter(m => m.card === "tiger").length, 5);
  assert.equal(legalMoves(state).filter(m => m.card === "dragon").length, 6);
});

test("onitama: não pode cair em peça própria nem sair do tabuleiro; pode capturar", () => {
  const state = stateOf([["c3", "S"], ["c5", "m"], ["c1", "M"], ["c4", "S"], ["b5", "s"]], BLUE, { b: ["tiger", "boar"], r: ["frog", "rabbit"], side: "crab" });
  const from3 = movesFrom(state, parseSquare("c3")).map(moveText);
  assert.ok(from3.includes("c3–c5 Tigre") === false, "Tigre c3→c5 captura o mestre: deve vir como ×");
  assert.ok(from3.includes("c3×c5 Tigre"));
  assert.ok(!from3.some(t => t.includes("c4")), "c4 é peça própria");
  assert.ok(from3.includes("c3–b3 Javali"));
  assert.ok(from3.includes("c3–d3 Javali"));
  // da casa a1 o Tigre (0,-1) cairia fora
  const edge = stateOf([["a1", "S"], ["e1", "M"], ["c5", "m"]]);
  assert.ok(!legalMoves(edge).some(m => m.piece === "S" && squareName(m.to) === "a0"));
  for (const m of legalMoves(edge)) { assert.ok(m.to >= 0 && m.to < 25); }
});

test("onitama: o lance rotaciona as cartas (usada vai ao lado, a do lado entra no mesmo lugar)", () => {
  const state = fromPosition("ssmss/...../...../...../SSMSS b tiger,dragon frog,rabbit crab");
  const next = play(state, "c1", "c3", "tiger");
  assert.equal(next.turn, RED);
  assert.deepEqual(next.cards.b, ["crab", "dragon"]);
  assert.equal(next.cards.side, "tiger");
  assert.deepEqual(next.cards.r, ["frog", "rabbit"]);
  assert.equal(next.board[square(2, 2)], "M");
  assert.equal(next.board[square(2, 0)], null);
  // o vermelho joga e o Tigre vai para a mão dele
  const reply = legalMoves(next).find(m => m.card === "rabbit");
  const after = applyMove(next, reply);
  assert.equal(after.turn, BLUE);
  assert.equal(after.cards.side, "rabbit");
  assert.deepEqual(after.cards.r, ["frog", "tiger"]); // o Tigre do lado entra no lugar do Coelho
  assert.deepEqual(after.cards.b, ["crab", "dragon"]);
});

test("onitama: lance ilegal é recusado (carta fora da mão, peça inexistente, destino errado)", () => {
  const state = fromPosition("ssmss/...../...../...../SSMSS b tiger,dragon frog,rabbit crab");
  assert.equal(findMove(state, { from: "c1", to: "c3", card: "frog" }), null);
  assert.equal(findMove(state, { from: "c3", to: "c4", card: "tiger" }), null);
  assert.equal(findMove(state, { from: "c1", to: "c2", card: "tiger" }), null);
  assert.equal(findMove(state, { from: "a5", to: "a3", card: "tiger" }), null); // peça do adversário
  assert.equal(findMove(state, null), null);
  assert.equal(findMove(state, { from: "zz", to: "c3", card: "tiger" }), null);
  assert.throws(() => playMove(newGame(CARDS5), { from: "c1", to: "c2", card: "tiger" }), /ilegal/);
});

test("onitama: os lances aceitam casa por nome ou por índice", () => {
  const state = fromPosition("ssmss/...../...../...../SSMSS b tiger,dragon frog,rabbit crab");
  const a = findMove(state, { from: "c1", to: "c3", card: "tiger" });
  const b = findMove(state, { from: square(2, 0), to: square(2, 2), card: "tiger" });
  assert.deepEqual(a, b);
});

test("onitama: applyMove é imutável", () => {
  const state = fromPosition("ssmss/...../...../...../SSMSS b tiger,dragon frog,rabbit crab");
  const snap = JSON.stringify(state);
  const m = legalMoves(state)[0];
  const next = applyMove(state, m);
  assert.equal(JSON.stringify(state), snap);
  assert.notEqual(next, state);
  assert.notEqual(next.cards, state.cards);
  assert.notEqual(next.board, state.board);
});

/* ---------- vitória ---------- */

test("onitama: Caminho da Pedra — capturar o mestre vence", () => {
  const state = stateOf([["c3", "S"], ["c5", "m"], ["a1", "M"], ["e5", "s"]], BLUE, { b: ["tiger", "boar"], r: ["frog", "rabbit"], side: "crab" });
  let game = { state, keys: [positionKey(state)], moves: [], last: null, result: outcome(state) };
  assert.equal(game.result.over, false);
  game = playMove(game, { from: "c3", to: "c5", card: "tiger" });
  assert.deepEqual(game.result, { over: true, winner: BLUE, reason: "stone" });
  assert.equal(game.last.captured, true);
});

test("onitama: Caminho da Pedra também vale para o vermelho", () => {
  const state = stateOf([["c3", "s"], ["c1", "M"], ["e5", "m"], ["a5", "S"]], RED, { b: ["frog", "rabbit"], r: ["tiger", "boar"], side: "crab" });
  const game = playMove({ state, keys: [positionKey(state)], moves: [], last: null, result: outcome(state) }, { from: "c3", to: "c1", card: "tiger" });
  assert.deepEqual(game.result, { over: true, winner: RED, reason: "stone" });
});

test("onitama: Caminho do Rio — mestre no templo adversário vence", () => {
  const state = stateOf([["c4", "M"], ["a5", "m"], ["e1", "s"], ["a1", "S"]], BLUE, { b: ["boar", "horse"], r: ["frog", "rabbit"], side: "crab" });
  const game = playMove({ state, keys: [positionKey(state)], moves: [], last: null, result: outcome(state) }, { from: "c4", to: "c5", card: "boar" });
  assert.deepEqual(game.result, { over: true, winner: BLUE, reason: "stream" });
});

test("onitama: aluno no templo adversário NÃO vence", () => {
  const state = stateOf([["c4", "S"], ["a5", "m"], ["e1", "M"]], BLUE, { b: ["boar", "horse"], r: ["frog", "rabbit"], side: "crab" });
  const game = playMove({ state, keys: [positionKey(state)], moves: [], last: null, result: outcome(state) }, { from: "c4", to: "c5", card: "boar" });
  assert.equal(game.result.over, false);
});

test("onitama: Caminho do Rio do vermelho (templo c1)", () => {
  const state = stateOf([["c2", "m"], ["a1", "S"], ["e5", "M"]], RED, { b: ["frog", "rabbit"], r: ["boar", "horse"], side: "crab" });
  const game = playMove({ state, keys: [positionKey(state)], moves: [], last: null, result: outcome(state) }, { from: "c2", to: "c1", card: "boar" });
  assert.deepEqual(game.result, { over: true, winner: RED, reason: "stream" });
});

/* ---------- passada ---------- */

test("onitama: sem nenhuma peça movível só restam as passadas (troca de carta)", () => {
  const empty = stateOf([["c5", "m"]], BLUE, { b: ["horse", "ox"], r: ["frog", "rabbit"], side: "crab" });
  const passes = legalMoves(empty);
  assert.equal(passes.length, 2);
  assert.ok(passes.every(m => m.pass && m.from === null && m.to === null));
  assert.equal(findMove(empty, { pass: true, card: "ox" }).card, "ox");
  assert.equal(findMove(empty, { pass: true, card: "tiger" }), null);

  const game = playMove({ state: empty, keys: [positionKey(empty)], moves: [], last: null, result: outcome(empty) }, { pass: true, card: "horse" });
  assert.deepEqual(game.state.board, empty.board);
  assert.equal(game.state.turn, RED);
  assert.equal(game.state.cards.side, "horse");
  assert.deepEqual(game.state.cards.b, ["crab", "ox"]);
  assert.equal(moveText(game.last), "passa (Cavalo)");
});

test("onitama: não pode passar havendo lance legal", () => {
  const state = stateOf([["a1", "S"], ["e1", "M"], ["c5", "m"]]);
  assert.ok(legalMoves(state).every(m => !m.pass));
  assert.equal(findMove(state, { pass: true, card: "tiger" }), null);
});

/* ---------- repetição ---------- */

/** Busca em largura por uma sequência de lances que volta à posição inicial (mesma chave). */
function findCycle(start, maxPlies) {
  const startKey = positionKey(start);
  const seen = new Map([[startKey, 0]]);
  let frontier = [{ state: start, path: [] }];
  for (let depth = 1; depth <= maxPlies; depth++) {
    const next = [];
    for (const node of frontier) {
      for (const m of legalMoves(node.state)) {
        const state = applyMove(node.state, m);
        if (outcome(state).over) continue;
        const path = [...node.path, { from: m.pass ? undefined : squareName(m.from), to: m.pass ? undefined : squareName(m.to), card: m.card, pass: m.pass }];
        const key = positionKey(state);
        if (key === startKey) return path;
        if (!seen.has(key)) { seen.set(key, depth); next.push({ state, path }); }
      }
    }
    frontier = next;
  }
  return null;
}

test("onitama: repetição tripla empata (posição + cartas)", () => {
  const start = stateOf([["b3", "M"], ["d3", "m"], ["a1", "S"], ["e5", "s"]], BLUE, { b: ["boar", "horse"], r: ["ox", "elephant"], side: "crab" });
  const cycle = findCycle(start, 8);
  assert.ok(cycle && cycle.length % 2 === 0, "deve existir um ciclo de lances que volta à mesma posição");

  let game = { state: start, keys: [positionKey(start)], moves: [], last: null, result: outcome(start) };
  for (let lap = 0; lap < 2; lap++) {
    for (const [i, m] of cycle.entries()) {
      assert.equal(game.result.over, false, `lap ${lap} lance ${i}`);
      game = playMove(game, m);
    }
    if (lap === 0) assert.equal(game.result.over, false, "2ª vez da posição ainda não empata");
  }
  assert.deepEqual(game.result, { over: true, winner: null, reason: "repetition" });
  assert.equal(repetitions(game.state, game.keys), 3);
});

test("onitama: repetições contam só a posição idêntica (mesmas cartas e mesma vez)", () => {
  const s0 = fromPosition("....m/...../..M../...../..... b boar,horse ox,elephant crab");
  const key = positionKey(s0);
  assert.equal(repetitions(s0, [key]), 1);
  assert.equal(repetitions(s0, [key, "x", key]), 2);
  assert.deepEqual(outcome(s0, [key, "x", key, "y", key]), { over: true, winner: null, reason: "repetition" });
  assert.equal(outcome(s0, [key, "x", key]).over, false);
  assert.equal(RESULT_LABELS.repetition, "Repetição tripla");
  assert.equal(RESULT_LABELS.stone, "Caminho da Pedra");
  assert.equal(RESULT_LABELS.stream, "Caminho do Rio");
});

test("onitama: a ordem das cartas na mão não muda a chave da posição", () => {
  const a = fromPosition("ssmss/...../...../...../SSMSS b tiger,dragon frog,rabbit crab");
  const b = fromPosition("ssmss/...../...../...../SSMSS b dragon,tiger rabbit,frog crab");
  assert.equal(positionKey(a), positionKey(b));
  const c = fromPosition("ssmss/...../...../...../SSMSS r tiger,dragon frog,rabbit crab");
  assert.notEqual(positionKey(a), positionKey(c));
  const d = fromPosition("ssmss/...../...../...../SSMSS b tiger,dragon frog,crab rabbit");
  assert.notEqual(positionKey(a), positionKey(d));
});

/* ---------- serialização ---------- */

test("onitama: toPosition/fromPosition fazem ida e volta durante uma partida inteira", () => {
  let game = newGame(dealCards(makeRng(7)));
  for (let i = 0; i < 40 && !game.result.over; i++) {
    const moves = legalMoves(game.state);
    game = playMove(game, moves[(i * 7) % moves.length]);
    const text = toPosition(game.state);
    assert.deepEqual(fromPosition(text), game.state);
    assert.equal(toPosition(fromPosition(text)), text);
  }
});

test("onitama: fromPosition recusa posição inválida", () => {
  const ok = "ssmss/...../...../...../SSMSS b tiger,dragon frog,rabbit crab";
  assert.doesNotThrow(() => fromPosition(ok));
  assert.throws(() => fromPosition("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"), /posição inválida/);
  assert.throws(() => fromPosition("ssmss/...../...../SSMSS b tiger,dragon frog,rabbit crab"), /campos|fileiras/);
  assert.throws(() => fromPosition("ssmss/...../...../...../SSMSS x tiger,dragon frog,rabbit crab"), /vez/);
  assert.throws(() => fromPosition("ssmsx/...../...../...../SSMSS b tiger,dragon frog,rabbit crab"), /peça/);
  assert.throws(() => fromPosition("ssmss/..../...../...../SSMSS b tiger,dragon frog,rabbit crab"), /incompleta/);
  assert.throws(() => fromPosition("ssmss/...../...../...../SSMSS b tiger,tiger frog,rabbit crab"), /repetidas/);
  assert.throws(() => fromPosition("ssmss/...../...../...../SSMSS b tiger,dragon frog,rabbit tiger"), /repetidas/);
  assert.throws(() => fromPosition("ssmss/...../...../...../SSMSS b tiger,dragon frog,rabbit nope"), /lado/);
  assert.throws(() => fromPosition("ssmss/...../...../...../SSMSS b tiger frog,rabbit crab"), /cartas/);
  assert.throws(() => fromPosition("ssmss/...../...../...../SMMSS b tiger,dragon frog,rabbit crab"), /mestre/);
});

test("onitama: moveRecord e moveText", () => {
  const state = fromPosition("ssmss/...../...../...../SSMSS b tiger,dragon frog,rabbit crab");
  const m = findMove(state, { from: "c1", to: "c3", card: "tiger" });
  assert.deepEqual(moveRecord(m), { from: "c1", to: "c3", card: "tiger", captured: false, pass: false });
  assert.equal(moveText(m), "c1–c3 Tigre");
  assert.equal(moveText(moveRecord(m)), "c1–c3 Tigre");
});

test("onitama: partidas aleatórias terminam e respeitam as invariantes", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rng = makeRng(seed * 977);
    let game = newGame(dealCards(rng));
    let plies = 0;
    while (!game.result.over && plies < 400) {
      const moves = legalMoves(game.state);
      assert.ok(moves.length > 0);
      const before = game.state;
      game = playMove(game, moves[Math.floor(rng() * moves.length)]);
      plies++;
      // 5 cartas distintas sempre
      const all = [...game.state.cards.b, ...game.state.cards.r, game.state.cards.side];
      assert.equal(new Set(all).size, 5);
      assert.equal(game.state.turn, before.turn === BLUE ? RED : BLUE);
      assert.ok(game.state.board.filter(p => p && colorOf(p) === BLUE).length <= 5);
    }
    assert.ok(game.result.over || plies === 400);
  }
});
