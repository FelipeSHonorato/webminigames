/* Testes do xadrez: perft (prova objetiva das regras), notação, fim de jogo e casos de torneio. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  BLACK, PROMOTIONS, START_FEN, WHITE, applyMove, findMove, fromFen, inCheck, initial,
  insufficientMaterial, isAttacked, legalMoves, newGame, outcome, parseSquare, playMove,
  positionKey, pseudoMoves, repetitions, san, squareName, toFen, toUci, movesFrom, canMate,
} from "../games/chess/domain.js";

/* ---------- perft ---------- */

function perft(state, depth) {
  if (depth === 0) return 1;
  const moves = legalMoves(state);
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const move of moves) nodes += perft(applyMove(state, move), depth - 1);
  return nodes;
}

/* Valores de referência publicados (chessprogramming.org / CPW). */
const PERFT = [
  {
    name: "posição inicial",
    fen: START_FEN,
    counts: [20, 400, 8902, 197281],
  },
  {
    name: "Kiwipete",
    fen: "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    counts: [48, 2039, 97862],
  },
  {
    name: "posição 3 (finais de peões)",
    fen: "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
    counts: [14, 191, 2812, 43238],
  },
  {
    name: "posição 4 (promoções)",
    fen: "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",
    counts: [6, 264, 9467],
  },
  {
    name: "posição 5 (roque e cravadas)",
    fen: "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8",
    counts: [44, 1486, 62379],
  },
  {
    name: "posição 6",
    fen: "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10",
    counts: [46, 2079, 89890],
  },
];

for (const { name, fen, counts } of PERFT) {
  test(`perft: ${name}`, () => {
    const state = fromFen(fen);
    counts.forEach((expected, i) => {
      assert.equal(perft(state, i + 1), expected, `${name} · profundidade ${i + 1}`);
    });
  });
}

/* ---------- FEN e casas ---------- */

test("FEN: ida e volta preserva posição, vez, roque, en passant e contadores", () => {
  const fens = [
    START_FEN,
    "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 7 42",
    "rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3",
  ];
  for (const fen of fens) assert.equal(toFen(fromFen(fen)), fen);
});

test("casas: a1=0, h1=7, a8=56, h8=63", () => {
  assert.equal(parseSquare("a1"), 0);
  assert.equal(parseSquare("h1"), 7);
  assert.equal(parseSquare("a8"), 56);
  assert.equal(parseSquare("h8"), 63);
  assert.equal(squareName(0), "a1");
  assert.equal(squareName(63), "h8");
  assert.equal(parseSquare("z9"), -1);
  assert.equal(parseSquare("a0"), -1);
});

test("estado inicial: 20 lances legais e brancas na vez", () => {
  const game = newGame();
  assert.equal(game.state.turn, WHITE);
  assert.equal(legalMoves(game.state).length, 20);
  assert.equal(game.result.over, false);
  assert.equal(game.moves.length, 0);
});

/* ---------- lances especiais ---------- */

test("roque curto e longo geram SAN e movem a torre", () => {
  const state = fromFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  const short = findMove(state, "e1g1");
  const long = findMove(state, "e1c1");
  assert.ok(short && long);
  assert.equal(san(state, short), "O-O");
  assert.equal(san(state, long), "O-O-O");

  const afterShort = applyMove(state, short);
  assert.equal(afterShort.board[6], "K");
  assert.equal(afterShort.board[5], "R");
  assert.equal(afterShort.board[4], null);
  assert.equal(afterShort.board[7], null);
  assert.equal(afterShort.castling, "kq", "brancas perdem os dois direitos");

  const afterLong = applyMove(state, long);
  assert.equal(afterLong.board[2], "K");
  assert.equal(afterLong.board[3], "R");
});

test("não há roque através de casa atacada nem com casa ocupada", () => {
  const attacked = fromFen("r3kr2/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  const ucis = legalMoves(attacked).map(toUci);
  assert.ok(!ucis.includes("e1g1"), "f1 está atacada pela torre");
  assert.ok(ucis.includes("e1c1"), "o roque longo continua possível");

  const blocked = fromFen("r3k2r/8/8/8/8/8/8/R2QK2R w KQkq - 0 1");
  assert.ok(!legalMoves(blocked).map(toUci).includes("e1c1"), "d1 ocupada");
});

test("direitos de roque caem quando rei ou torre se movem", () => {
  const state = fromFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  assert.equal(applyMove(state, findMove(state, "a1a2")).castling, "Kkq");
  assert.equal(applyMove(state, findMove(state, "h1h2")).castling, "Qkq");
  assert.equal(applyMove(state, findMove(state, "e1e2")).castling, "kq");

  const black = fromFen("r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1");
  assert.equal(applyMove(black, findMove(black, "a8a7")).castling, "KQk", "torre de a8: cai o roque longo preto");
  assert.equal(applyMove(black, findMove(black, "h8h7")).castling, "KQq", "torre de h8: cai o roque curto preto");
});

test("direito de roque cai quando a torre é capturada na esquina", () => {
  const state = fromFen("r3k2r/8/8/8/8/8/6B1/R3K2R b KQkq - 0 1");
  const capture = findMove(state, "h8h2");
  assert.ok(capture);
  const next = applyMove(state, capture);
  assert.equal(next.castling, "KQq");
});

test("en passant: captura o peão vizinho, só no lance imediato", () => {
  const state = fromFen("rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3");
  const ep = findMove(state, "e5f6");
  assert.ok(ep && ep.enPassant);
  assert.equal(san(state, ep), "exf6");

  const next = applyMove(state, ep);
  assert.equal(next.board[parseSquare("f5")], null, "peão capturado saiu do tabuleiro");
  assert.equal(next.board[parseSquare("f6")], "P");
  assert.equal(next.halfmove, 0);

  const game = playMove(playMove(newGame(), "e2e4"), "a7a6");
  assert.equal(game.state.ep, null, "en passant expira no lance seguinte");
  const noEp = fromFen("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1");
  assert.ok(!legalMoves(noEp).some(m => m.enPassant), "sem peão preto ao lado, não há captura");
});

test("promoção oferece quatro peças e promove com a cor certa", () => {
  const state = fromFen("8/P7/8/8/8/8/8/K6k w - - 0 1");
  const promos = legalMoves(state).filter(m => m.from === parseSquare("a7"));
  assert.equal(promos.length, 4);
  assert.deepEqual(promos.map(m => m.promotion).sort(), ["B", "N", "Q", "R"]);

  const knight = findMove(state, "a7a8n");
  const next = applyMove(state, knight);
  assert.equal(next.board[parseSquare("a8")], "N");
  assert.equal(san(state, knight), "a8=N");

  const blackState = fromFen("k6K/8/8/8/8/8/7p/8 b - - 0 1");
  const blackQueen = findMove(blackState, "h2h1q");
  assert.ok(blackQueen);
  assert.equal(applyMove(blackState, blackQueen).board[parseSquare("h1")], "q");
});

/* ---------- xeque, cravadas e legalidade ---------- */

test("peça cravada não pode sair da coluna do rei", () => {
  const state = fromFen("4r1k1/8/8/8/8/8/4N3/4K3 w - - 0 1");
  const knightMoves = movesFrom(state, parseSquare("e2"));
  assert.equal(knightMoves.length, 0, "cavalo cravado na coluna e");
  assert.ok(inCheck(fromFen("4r1k1/8/8/8/8/8/8/4K3 w - - 0 1")));
});

test("rei não pode andar para casa atacada", () => {
  const state = fromFen("8/8/8/8/8/5k2/8/4K3 w - - 0 1");
  const kingMoves = movesFrom(state, parseSquare("e1"));
  assert.ok(!kingMoves.map(toUci).includes("e1e2"), "e2 é atacada pelo rei preto");
  assert.ok(kingMoves.map(toUci).includes("e1d1"));
});

test("isAttacked reconhece peão, cavalo, rei e deslizantes", () => {
  const board = fromFen("8/8/8/8/8/8/4P3/4K3 w - - 0 1").board;
  assert.ok(isAttacked(board, parseSquare("d3"), WHITE), "peão branco ataca d3");
  assert.ok(isAttacked(board, parseSquare("f3"), WHITE), "peão branco ataca f3");
  assert.ok(!isAttacked(board, parseSquare("e3"), WHITE), "peão não ataca em frente");
  const knight = fromFen("8/8/8/8/8/8/8/1N2K3 w - - 0 1").board;
  assert.ok(isAttacked(knight, parseSquare("c3"), WHITE));
  assert.ok(isAttacked(knight, parseSquare("d2"), WHITE));
  const rook = fromFen("8/8/8/8/8/8/8/R3K3 w - - 0 1").board;
  assert.ok(isAttacked(rook, parseSquare("a8"), WHITE));
  assert.ok(!isAttacked(rook, parseSquare("b8"), WHITE), "torre não ataca diagonal");
});

/* ---------- SAN ---------- */

test("SAN: peão, peça, captura, desambiguação, xeque e mate", () => {
  assert.equal(san(initial(), findMove(initial(), "e2e4")), "e4");
  assert.equal(san(initial(), findMove(initial(), "g1f3")), "Nf3");

  const dis = fromFen("7k/8/8/8/8/8/8/N1N1K3 w - - 0 1");
  assert.equal(san(dis, findMove(dis, "c1b3")), "Ncb3");
  assert.equal(san(dis, findMove(dis, "a1b3")), "Nab3");

  const check = fromFen("k7/8/8/8/8/8/8/6KR w - - 0 1");
  assert.equal(san(check, findMove(check, "h1h8")), "Rh8+");

  const quiet = fromFen("7k/8/8/8/8/8/5PPP/6K1 w - - 0 1");
  assert.equal(san(quiet, findMove(quiet, "h2h4")), "h4");
});

/* ---------- fim de jogo ---------- */

test("xeque-mate do pastor: pretas vencem em 4 lances", () => {
  let game = newGame();
  for (const uci of ["f2f3", "e7e5", "g2g4", "d8h4"]) game = playMove(game, uci);
  assert.equal(game.result.over, true);
  assert.equal(game.result.winner, BLACK);
  assert.equal(game.result.reason, "checkmate");
  assert.equal(game.moves.at(-1).san, "Qh4#");
});

test("mate do estudante: brancas vencem com Qxf7#", () => {
  let game = newGame();
  for (const uci of ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"]) game = playMove(game, uci);
  assert.equal(game.result.reason, "checkmate");
  assert.equal(game.result.winner, WHITE);
  assert.equal(game.moves.at(-1).san, "Qxf7#");
});

test("afogamento é empate (rei sem lances e sem xeque)", () => {
  const state = fromFen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
  assert.equal(legalMoves(state).length, 0);
  assert.equal(inCheck(state), false);
  assert.deepEqual(outcome(state, [positionKey(state)]), { over: true, winner: null, reason: "stalemate" });
});

test("xeque-mate tem prioridade sobre empates por contagem", () => {
  const state = fromFen("7k/6Q1/6K1/8/8/8/8/8 b - - 100 80");
  assert.deepEqual(outcome(state, [positionKey(state)]), { over: true, winner: WHITE, reason: "checkmate" });
});

test("regra dos 50 lances: 100 meios-lances sem peão nem captura", () => {
  const state = fromFen("8/8/8/8/8/8/8/K6k w - - 100 80");
  assert.deepEqual(outcome(state, [positionKey(state)]), { over: true, winner: null, reason: "fifty" });
  const before = fromFen("8/8/8/8/8/8/8/K6k w - - 99 80");
  assert.equal(outcome(before, [positionKey(before)]).over, true, "material insuficiente também encerra");
});

test("repetição tripla: a mesma posição três vezes encerra", () => {
  let game = newGame();
  for (const uci of ["g1f3", "g8f6", "f3g1", "f6g8"]) game = playMove(game, uci);
  assert.equal(repetitions(game.state, game.keys), 2);
  assert.equal(game.result.over, false, "duas ocorrências ainda não empatam");

  for (const uci of ["g1f3", "g8f6", "f3g1", "f6g8"]) game = playMove(game, uci);
  assert.equal(repetitions(game.state, game.keys), 3);
  assert.equal(game.result.over, true);
  assert.equal(game.result.reason, "repetition");
  assert.equal(game.result.winner, null);
});

test("material insuficiente: só reis, rei+bispo, rei+cavalo e bispos da mesma cor", () => {
  const cases = [
    "8/8/8/8/8/8/8/K1k5 w - - 0 1",
    "8/8/8/8/8/8/8/K1k2B2 w - - 0 1",
    "8/8/8/8/8/8/8/K1k2N2 w - - 0 1",
    "5b2/8/8/8/8/8/8/2B1K1k1 w - - 0 1",
  ];
  for (const fen of cases) assert.equal(insufficientMaterial(fromFen(fen).board), true, fen);

  const notDraws = [
    "8/8/8/8/8/8/8/K1k2R2 w - - 0 1",
    "8/8/8/8/8/8/8/K1k2P2 w - - 0 1",
    "4b3/8/8/8/8/8/8/2B1K1k1 w - - 0 1",
    "8/8/8/8/8/8/8/K1k1NN2 w - - 0 1",
  ];
  for (const fen of notDraws) assert.equal(insufficientMaterial(fromFen(fen).board), false, fen);
});

test("tempo esgotado: só vence quem ainda pode dar mate", () => {
  const cases = [
    ["8/8/8/8/8/8/8/K1k5 w - - 0 1", WHITE, false],
    ["8/8/8/8/8/8/8/K1k2B2 w - - 0 1", WHITE, false],
    ["8/8/8/8/8/8/8/K1k2N2 w - - 0 1", WHITE, false],
    ["8/8/8/8/8/8/8/K1k2R2 w - - 0 1", WHITE, true],
    ["8/8/8/8/8/8/8/K1k2P2 w - - 0 1", WHITE, true],
    ["8/8/8/8/8/8/8/K1k1NN2 w - - 0 1", WHITE, true],
    ["5b2/8/8/8/8/8/8/2B1K1k1 w - - 0 1", WHITE, false],
    ["4b3/8/8/8/8/8/8/2B1K1k1 w - - 0 1", WHITE, true],
    ["8/8/8/8/8/8/8/K1k2B2 w - - 0 1", BLACK, false],
    ["8/8/8/8/8/8/8/K1k2R2 w - - 0 1", BLACK, false],
  ];
  for (const [fen, color, expected] of cases) {
    assert.equal(canMate(fromFen(fen).board, color), expected, `${fen} · ${color}`);
  }
});

test("posição inicial não está encerrada e não tem xeque", () => {
  const state = initial();
  assert.equal(inCheck(state), false);
  const result = outcome(state, [positionKey(state)]);
  assert.deepEqual(result, { over: false, winner: null, reason: null });
});

/* ---------- chave de posição e partida ---------- */

test("positionKey ignora en passant que ninguém pode capturar", () => {
  const state = fromFen("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1");
  assert.ok(!positionKey(state).includes("e3"), "sem peão preto em d4/f4, a casa não conta");

  const capturable = fromFen("rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3");
  assert.ok(positionKey(capturable).includes("f6"));
});

test("playMove registra UCI/SAN, avança a vez e rejeita lance ilegal", () => {
  const game = playMove(newGame(), "e2e4");
  assert.equal(game.state.turn, BLACK);
  assert.deepEqual(game.moves, [{ uci: "e2e4", san: "e4" }]);
  assert.equal(game.last.from, parseSquare("e2"));
  assert.throws(() => playMove(game, "e7e5e"), /ilegal/);
  assert.throws(() => playMove(game, "e2e4"), /ilegal/, "peão branco não joga de novo");
  assert.equal(findMove(game.state, "e7e5")?.to, parseSquare("e5"));
});

test("lances gerados são objetos estáveis (from/to/piece/captured)", () => {
  const state = fromFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  const moves = legalMoves(state);
  for (const m of moves) {
    assert.ok(Number.isInteger(m.from) && m.from >= 0 && m.from < 64);
    assert.ok(Number.isInteger(m.to) && m.to >= 0 && m.to < 64);
    assert.equal(m.piece, state.board[m.from]);
    assert.equal(m.color, WHITE);
  }
  assert.equal(pseudoMoves(state).length, 20);
  assert.deepEqual(PROMOTIONS, ["Q", "R", "B", "N"]);
});
