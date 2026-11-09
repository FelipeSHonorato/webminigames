/* Conteúdo das páginas "Como jogar" (Xadrez, Dama, Gamão, Go e Onitama). Módulo puro: sem DOM, roda no navegador e nos testes.

   Os EXEMPLOS (CHESS, DAMA, GAMMON, GO) ficam exportados porque `tests/como-jogar.test.js` confere cada um contra o
   domínio do jogo (ex.: o "mate do corredor" é mesmo xeque-mate; a captura dupla da Dama é mesmo a única válida; o
   grupo do Go tem mesmo aquelas liberdades). Assim a página nunca ensina uma regra diferente da que o jogo aplica.

   Texto: pode usar <b>, <em> e <kbd>; é conteúdo nosso (não vem do usuário), por isso entra como HTML. */

import { GAMES } from "./games.js";
import {
  chessBoard, damaBoard, gammonBoard, goBoard, onitamaBoard, onitamaCardSvg, diceSvg, damaPosition, parseFen, parseSquare, squareName, GAMMON_START,
} from "./como-jogar-art.js";
import { CARDS as ONITAMA_CARDS } from "../games/onitama/domain.js";

export { damaPosition };

/* ================================= exemplos ================================= */

export const CHESS = Object.freeze({
  start: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  mate: "R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1",                    // mate do corredor
  pawn: { fen: "7k/8/8/8/8/3p1p2/4P3/K7 w - - 0 1", from: "e2" },
  rook: { fen: "8/8/7k/8/3R4/8/8/K7 w - - 0 1", from: "d4" },
  bishop: { fen: "8/8/7k/8/3B4/8/8/K7 w - - 0 1", from: "d4" },
  queen: { fen: "8/8/7k/8/3Q4/8/8/K7 w - - 0 1", from: "d4" },
  knight: { fen: "8/8/7k/8/3N4/8/8/K7 w - - 0 1", from: "d4" },
  king: { fen: "8/8/7k/8/3K4/8/8/8 w - - 0 1", from: "d4" },
  capture: { fen: "7k/8/8/8/5n2/8/8/K1B5 w - - 0 1", from: "c1" },
  check: "4k3/8/8/8/8/8/8/4R1K1 b - - 0 1",
  castle: { fen: "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", after: "r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1" },
  enPassant: "7k/8/8/3pP3/8/8/8/K7 w - d6 0 1",
  promotion: "7k/P7/8/8/8/8/8/K7 w - - 0 1",
  stalemate: "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1",
});

const DAMA_START = ".p.p.p.p/p.p.p.p./.p.p.p.p/......../......../P.P.P.P./.P.P.P.P/P.P.P.P.";
export const DAMA = Object.freeze({
  start: DAMA_START,
  step: { pieces: { c3: "P", g7: "p" }, from: "c3" },
  capture: { pieces: { c3: "P", d4: "p" }, from: "c3" },
  chain: { pieces: { c3: "P", d4: "p", f6: "p" }, from: "c3" },
  majority: { pieces: { c3: "P", d4: "p", f6: "p", h2: "P", g3: "p" } },
  promo: { pieces: { c7: "P", h6: "p" }, from: "c7" },
  king: { pieces: { a1: "D", e5: "p" }, from: "a1" },
});

/* Onitama: `pieces` em { casa: peça } (maiúscula = azul, minúscula = vermelho; M/m = mestre, S/s = aluno). Os testes montam
   cada posição no domínio e conferem destinos, capturas e vitórias. */
export const ONITAMA = Object.freeze({
  start: "ssmss/...../...../...../SSMSS",
  deal: { b: ["tiger", "dragon"], r: ["frog", "rabbit"], side: "crab" },
  move: { pieces: { c3: "S", a1: "M", e5: "m" }, card: "dragon", from: "c3", dots: ["a4", "e4", "b2", "d2"] },
  capture: { pieces: { c3: "S", d4: "s", a1: "M", e5: "m" }, card: "elephant", from: "c3", rings: ["d4"], dots: ["b3", "b4", "d3"] },
  mirror: { pieces: { c4: "s", a1: "M", e5: "m" }, card: "tiger", from: "c4", dots: ["c2", "c5"] },
  stone: { pieces: { c3: "S", c5: "m", e1: "M" }, card: "tiger", from: "c3", to: "c5" },
  stream: { pieces: { c4: "M", a5: "m", e1: "s" }, card: "boar", from: "c4", to: "c5" },
});

export const GAMMON = Object.freeze({
  start: GAMMON_START,
  dice35: { dice: [3, 5], moves: [[24, 21, 3], [13, 8, 5]] },
  doubles: { dice: [4, 4], moves: [[13, 9, 4], [8, 4, 4]] },
  blocked: { dice: [5, 3], blocked: [24, 19, 5], ok: [24, 21, 3] },
  hitBefore: {
    state: { w: { 24: 2, 13: 5, 8: 3, 6: 5 }, b: { 7: 1, 12: 4, 17: 3, 19: 5, 1: 2 }, bar: { w: 0, b: 0 }, off: { w: 0, b: 0 } },
    dice: [6, 1], hit: [13, 7, 6],
  },
  hitAfter: { w: { 24: 2, 13: 4, 8: 3, 7: 1, 6: 5 }, b: { 12: 4, 17: 3, 19: 5, 1: 2 }, bar: { w: 0, b: 1 }, off: { w: 0, b: 0 } },
  entry: {
    state: { w: { 24: 2, 13: 5, 8: 3, 6: 5 }, b: { 1: 1, 12: 5, 17: 3, 19: 5 }, bar: { w: 0, b: 1 }, off: { w: 0, b: 0 } },
    dice: [6, 3], blockedDie: 6, okDie: 3,
  },
  bearOff: {
    state: { w: { 6: 3, 5: 3, 4: 3, 3: 2, 2: 2, 1: 2 }, b: { 24: 3, 23: 3, 22: 3, 21: 3, 20: 3 }, bar: { w: 0, b: 0 }, off: { w: 0, b: 0 } },
    dice: [5, 2], moves: [[5, "off", 5], [2, "off", 2]],
  },
  bearOffAfter: { w: { 6: 3, 5: 2, 4: 3, 3: 2, 2: 1, 1: 2 }, b: { 24: 3, 23: 3, 22: 3, 21: 3, 20: 3 }, bar: { w: 0, b: 0 }, off: { w: 2, b: 0 } },
});

/** {w:{ponto:qtd}, b:{…}} → vetor `points` do domínio do gamão (índice 1..24; + = claras, − = escuras). */
export function gammonPoints(state) {
  const points = new Array(25).fill(0);
  for (const [p, n] of Object.entries(state.w ?? {})) points[+p] += n;
  for (const [p, n] of Object.entries(state.b ?? {})) points[+p] -= n;
  return points;
}

/* ==================================== GO ==================================== */

/** Posições reais do guia (interseções no padrão do domínio: coluna A-T sem I, linha de baixo para cima). */
export const GO = Object.freeze({
  size: 9,
  objective: {
    stones: { A3: "b", B3: "b", C3: "b", C2: "b", C1: "b" },
    territory: ["A1", "A2", "B1", "B2"],
  },
  group: {
    stones: { E5: "b", E6: "b" },
    liberties: ["D5", "F5", "E4", "D6", "F6", "E7"],
  },
  capture: {
    stones: { E5: "w", D5: "b", F5: "b", E6: "b" },
    move: "E4",
    after: { D5: "b", F5: "b", E6: "b", E4: "b" },
  },
  ko: {
    stones: { E5: "w", D6: "w", F6: "w", E7: "w", D5: "b", F5: "b", E4: "b" },
    move: "E6",
    after: { D6: "w", F6: "w", E7: "w", D5: "b", F5: "b", E4: "b", E6: "b" },
    point: "E5",
  },
  suicide: {
    stones: { B9: "b", A8: "b" },
    move: "A9",
  },
  handicap: {
    stones: { C7: "b", G3: "b", C3: "b", G7: "b", E5: "b", C5: "b", G5: "b", E7: "b", E3: "b" },
  },
  count: {
    stones: {
      A3: "b", B3: "b", C3: "b", C2: "b", C1: "b",
      G7: "w", H7: "w", J7: "w", G8: "w", G9: "w",
    },
    black: ["A1", "A2", "B1", "B2"],
    white: ["H8", "J8", "H9", "J9"],
    komi: 6.5,
  },
});

/** Casas para onde a peça de `from` pode ir no xadrez (sem xeque/cravada: os exemplos foram escolhidos sem isso;
    o teste confere o resultado contra o domínio). */
export function chessReach(fen, from) {
  const pieces = parseFen(fen);
  const me = pieces[from];
  const white = me === me.toUpperCase();
  const kind = me.toLowerCase();
  const { file, rank } = parseSquare(from);
  const dots = [], rings = [];
  const visit = (f, r) => {
    if (f < 0 || f > 7 || r < 0 || r > 7) return false;
    const sq = squareName(f, r), other = pieces[sq];
    if (!other) { dots.push(sq); return true; }
    if ((other === other.toUpperCase()) !== white) rings.push(sq);
    return false;
  };
  const R = [[1, 0], [-1, 0], [0, 1], [0, -1]], B = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  if (kind === "p") {
    const dir = white ? 1 : -1, start = white ? 1 : 6;
    if (!pieces[squareName(file, rank + dir)]) {
      dots.push(squareName(file, rank + dir));
      if (rank === start && !pieces[squareName(file, rank + 2 * dir)]) dots.push(squareName(file, rank + 2 * dir));
    }
    for (const df of [-1, 1]) {
      const f = file + df, r = rank + dir;
      if (f < 0 || f > 7) continue;
      const other = pieces[squareName(f, r)];
      if (other && (other === other.toUpperCase()) !== white) rings.push(squareName(f, r));
    }
  } else if (kind === "n") {
    for (const [df, dr] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) visit(file + df, rank + dr);
  } else if (kind === "k") {
    for (const [df, dr] of [...R, ...B]) visit(file + df, rank + dr);
  } else {
    const dirs = kind === "r" ? R : kind === "b" ? B : [...R, ...B];
    for (const [df, dr] of dirs) for (let k = 1; k < 8; k++) if (!visit(file + df * k, rank + dr * k)) break;
  }
  return { dots, rings };
}

export function damaFromPosition(position) {
  const out = {};
  position.split("/").forEach((row, i) => [...row].forEach((ch, f) => { if (ch !== ".") out[squareName(f, 7 - i)] = ch; }));
  return out;
}

/* ================================= helpers ================================= */

const fig = (html, caption, cls = "") => ({ html, caption, cls });
const chips = list => list.map(t => `<span class="cj-chip">${t}</span>`).join("");

const LEGEND_BOARD = [
  ["dot", "Casa livre para onde a peça pode ir"],
  ["ring", "Peça adversária que pode ser capturada"],
  ["sel", "Peça escolhida por você"],
  ["bad", "Perigo ou lance proibido"],
];
const LEGEND_GAMMON = [
  ["dot", "Ponto onde a peça pode parar"],
  ["ring", "Lance que bate uma peça adversária"],
  ["sel", "Ponto escolhido"],
  ["bad", "Ponto bloqueado (proibido)"],
];
const LEGEND_GO = [
  ["dot", "Liberdade ou interseção legal"],
  ["ring", "Pedra ou grupo em destaque"],
  ["sel", "Jogada escolhida"],
  ["bad", "Lance proibido (✕)"],
];

const SCREEN_COMMON = [
  ["Escolha o ritmo e a cor", "Cada jogador tem o <b>próprio relógio</b>, que só corre no seu turno: 3, 10, 30 ou 60 minutos por jogador. Quem fica sem tempo perde."],
  ["Convide um amigo", "Toque em <b>Criar sala online</b>, envie o <b>código</b> ou o <b>link</b> e espere ele entrar. Quando os dois tocarem em <b>Estou pronto</b>, a partida começa."],
  ["Ou jogue no mesmo aparelho", "<b>Jogar no mesmo dispositivo</b> deixa os dois jogadores se revezarem na mesma tela."],
];
const SCREEN_END = [
  ["Desistir, revanche e nova partida", "<b>Desistir</b> entrega a partida. No fim, use <b>Revanche</b> (mesmo adversário), <b>Nova partida</b> ou <b>Trocar ritmo</b>."],
];

/* ================================== XADREZ ================================== */

function chessGuide() {
  // Os reis de apoio (necessários para a posição ser legal) ficam esmaecidos, exceto se for a peça do exemplo.
  const piece = (ex, label) => {
    const { dots, rings } = chessReach(ex.fen, ex.from);
    const faded = Object.entries(parseFen(ex.fen)).filter(([sq, ch]) => ch.toLowerCase() === "k" && sq !== ex.from).map(([sq]) => sq);
    return chessBoard({ fen: ex.fen, label, selects: [ex.from], dots, rings, faded });
  };
  const cap = CHESS.capture;
  const capReach = chessReach(cap.fen, cap.from);
  const chk = CHESS.check;

  return {
    id: "xadrez", name: "Xadrez", glyph: "♞",
    title: "Como jogar Xadrez",
    lead: "O jogo de estratégia mais famoso do mundo. Dois exércitos se enfrentam e vence quem prender o rei do adversário. Em 5 minutos você aprende o essencial.",
    chips: chips(["2 jogadores", "16 peças cada", "Brancas começam", "Vence quem dá xeque-mate"]),
    legend: LEGEND_BOARD,
    sections: [
      {
        id: "objetivo", title: "O objetivo: o xeque-mate",
        body: [
          "Cada jogador comanda um exército de 16 peças. O objetivo <b>não é capturar todas as peças</b>: é dar <b>xeque-mate</b> no rei adversário.",
          "<b>Xeque</b> é quando o rei está sendo atacado. <b>Xeque-mate</b> é quando ele está em xeque e <b>não há nenhuma saída</b>. Nesse momento o jogo acaba e quem deu o mate vence.",
        ],
        figures: [fig(chessBoard({ fen: CHESS.mate, label: "Xeque-mate: a torre branca ataca o rei preto, que não tem para onde fugir", checks: ["g8"], arrows: [["a8", "g8", "bad"]], faded: ["g1"] }),
          "<b>Exemplo de xeque-mate.</b> A torre branca ataca o rei preto (casa vermelha). Ele não escapa: os próprios peões tapam as casas de baixo e a torre cobre as laterais.")],
      },
      {
        id: "tabuleiro", title: "O tabuleiro e as peças",
        body: [
          "O tabuleiro tem 64 casas, 8 colunas (<b>a–h</b>) e 8 fileiras (<b>1–8</b>). Cada casa tem um nome, como <b>e4</b>: coluna e, fileira 4.",
          "Cada lado começa com <b>8 peões</b>, <b>2 torres</b>, <b>2 cavalos</b>, <b>2 bispos</b>, <b>1 dama</b> e <b>1 rei</b>. As <b>brancas jogam primeiro</b>, e depois os jogadores se revezam: um lance cada.",
        ],
        figures: [fig(chessBoard({ fen: CHESS.start, label: "Posição inicial do xadrez" }), "<b>Posição inicial.</b> Brancas embaixo, pretas em cima.")],
        tips: [
          "A casa do canto à <b>sua direita</b> é sempre <b>clara</b>.",
          "A dama começa na casa da <b>própria cor</b>: dama branca em casa clara, dama preta em casa escura.",
        ],
      },
      {
        id: "pecas", title: "Como cada peça se move", grid: true,
        body: ["Os pontos verdes mostram para onde cada peça (marcada em dourado) pode ir. Peças não podem pular outras, <b>exceto o cavalo</b>."],
        figures: [
          fig(piece(CHESS.pawn, "Peão em e2 pode ir para e3, e4 ou capturar em d3 e f3"), "<b>Peão ♙</b> Anda <b>1 casa para frente</b> (2 na primeira vez). Captura na <b>diagonal à frente</b>. Nunca anda para trás."),
          fig(piece(CHESS.rook, "Torre em d4 move em linha reta"), "<b>Torre ♖</b> Anda em <b>linha reta</b>, na coluna ou na fileira, quantas casas quiser."),
          fig(piece(CHESS.bishop, "Bispo em d4 move nas diagonais"), "<b>Bispo ♗</b> Anda nas <b>diagonais</b>, quantas casas quiser. Fica sempre na mesma cor de casa."),
          fig(piece(CHESS.queen, "Dama em d4 move em todas as direções"), "<b>Dama ♕</b> A peça mais forte: junta torre e bispo, em <b>qualquer direção reta</b>."),
          fig(piece(CHESS.knight, "Cavalo em d4 move em L"), "<b>Cavalo ♘</b> Anda em <b>“L”</b>: 2 casas numa direção e 1 de lado. É o <b>único que pula</b> outras peças."),
          fig(piece(CHESS.king, "Rei em d4 move uma casa"), "<b>Rei ♔</b> Anda <b>1 casa</b> em qualquer direção. Nunca pode ir para uma casa atacada."),
        ],
      },
      {
        id: "captura", title: "Capturar peças",
        body: [
          "Para capturar, mova sua peça para a <b>casa onde está a peça adversária</b>: ela sai do jogo e a sua ocupa o lugar. O anel verde marca o que pode ser capturado.",
          "A captura <b>não é obrigatória</b> no xadrez. Só o peão captura diferente: <b>na diagonal</b>, nunca para frente.",
        ],
        figures: [fig(chessBoard({ fen: cap.fen, label: "O bispo branco pode capturar o cavalo preto em f4", selects: [cap.from], dots: capReach.dots, rings: capReach.rings, arrows: [["c1", "f4"]], faded: ["a1", "h8"] }),
          "O bispo em <b>c1</b> captura o cavalo em <b>f4</b>. Repare que ele <b>não passa</b> por cima do cavalo: a diagonal termina nele.")],
      },
      {
        id: "xeque", title: "Xeque: defenda o seu rei",
        body: [
          "Quando o seu rei está em <b>xeque</b>, você <b>precisa</b> resolver isso no próximo lance. São três jeitos:",
          "<b>1. Mover o rei</b> para uma casa segura · <b>2. Bloquear</b> o ataque com outra peça · <b>3. Capturar</b> a peça que está atacando.",
          "Você nunca pode fazer um lance que deixe o seu próprio rei em xeque.",
        ],
        figures: [fig(chessBoard({ fen: chk, label: "Rei preto em xeque pela torre; ele pode ir para d8, d7, f7 ou f8", checks: ["e8"], dots: ["d8", "d7", "f7", "f8"], arrows: [["e1", "e8", "bad"]], faded: ["g1"] }),
          "O rei preto está em xeque pela torre. Aqui ele só tem uma saída: <b>mover o rei</b> para um ponto verde. A casa <b>e7</b> não serve, porque a torre também a ataca.")],
      },
      {
        id: "especiais", title: "Lances especiais", grid: true,
        body: ["Três lances têm regra própria. Todos são feitos no jogo do mesmo jeito: <b>toque na peça e depois na casa de destino</b>."],
        figures: [
          fig(chessBoard({ fen: CHESS.castle.fen, label: "Roque: o rei anda duas casas e a torre pula para o outro lado", selects: ["e1"], dots: ["g1", "c1"], arrows: [["e1", "g1", "good", -20], ["h1", "f1", "sel", -20]] }),
            "<b>Roque.</b> Move o rei <b>2 casas</b> em direção à torre; a torre salta para o outro lado dele. O roque para o outro lado (rei em c1) funciona igual. Só vale se nenhum dos dois se moveu antes, se não há peças no meio e se o rei não está em xeque nem passa por casa atacada."),
          fig(chessBoard({ fen: CHESS.castle.after, label: "Depois do roque curto: rei em g1, torre em f1" }), "<b>Depois do roque curto:</b> rei em g1 e torre em f1, bem protegidos."),
          fig(chessBoard({ fen: CHESS.enPassant, label: "En passant: o peão branco captura o peão preto de passagem, indo para d6", selects: ["e5"], rings: ["d5"], dots: ["d6"], arrows: [["e5", "d6"]], faded: ["a1", "h8"] }),
            "<b>En passant.</b> O peão preto acabou de andar 2 casas (d7→d5) e parou ao lado do seu. <b>No lance seguinte</b>, você pode capturá-lo “de passagem”, indo para <b>d6</b>, como se ele tivesse andado só 1 casa."),
          fig(chessBoard({ fen: CHESS.promotion, label: "Promoção: o peão em a7 chega à última fileira", selects: ["a7"], dots: ["a8"], arrows: [["a7", "a8"]], faded: ["a1", "h8"] }) +
            `<div class="cj-promo" aria-hidden="true"><span>♕</span><span>♖</span><span>♗</span><span>♘</span></div>`,
            "<b>Promoção.</b> Peão que chega à última fileira <b>vira outra peça</b>: dama, torre, bispo ou cavalo. O jogo abre uma janelinha para você escolher. A maioria escolhe a dama."),
        ],
      },
      {
        id: "empates", title: "Quando o jogo termina empatado",
        body: [
          "Nem toda partida tem vencedor. Ela termina em <b>empate</b> quando:",
          "<b>Afogamento:</b> o jogador da vez <b>não está em xeque</b>, mas não tem nenhum lance legal · <b>Regra dos 50 lances:</b> 50 lances de cada lado sem captura e sem mover peão · <b>Repetição tripla:</b> a mesma posição aparece 3 vezes · <b>Material insuficiente:</b> sobrou pouco para dar mate (por exemplo, só os dois reis).",
        ],
        figures: [fig(chessBoard({ fen: CHESS.stalemate, label: "Afogamento: o rei preto não está em xeque, mas não tem lance", crosses: ["g8", "g7", "h7"] }),
          "<b>Afogamento.</b> É a vez das pretas. O rei não está em xeque, mas todas as casas vizinhas estão atacadas (✕). Sem lance possível, <b>a partida empata</b>.")],
      },
    ],
    screen: {
      title: "Como jogar na tela",
      steps: [
        ...SCREEN_COMMON,
        ["Mova as peças com dois toques", "Toque na <b>peça</b>: ela fica dourada e os <b>pontos verdes</b> mostram para onde ela pode ir (anel = captura). Depois toque na <b>casa de destino</b>."],
        ["Promoção", "Ao levar um peão até o fim, aparece uma janela para escolher a nova peça."],
        ...SCREEN_END,
      ],
    },
    cta: { label: "Jogar Xadrez", href: GAMES.chess.path },
  };
}

/* =================================== DAMA =================================== */

function damaGuide() {
  const D = DAMA;
  return {
    id: "dama", name: "Dama", glyph: "⛀",
    title: "Como jogar Dama",
    lead: "O jogo de damas clássico (regras brasileiras). Mover é simples, mas cuidado: <b>capturar é obrigatório</b>. Veja como funciona.",
    chips: chips(["2 jogadores", "12 peças cada", "Só casas escuras", "Captura obrigatória"]),
    legend: LEGEND_BOARD,
    sections: [
      {
        id: "objetivo", title: "O objetivo",
        body: [
          "Vence quem <b>capturar todas as peças</b> do adversário ou deixá-lo <b>sem nenhum lance possível</b> (peças bloqueadas).",
          "O tabuleiro é o mesmo do xadrez, mas as peças <b>só andam nas casas escuras</b>. Cada jogador começa com <b>12 pedras</b> e as <b>brancas jogam primeiro</b>.",
        ],
        figures: [fig(damaBoard({ pieces: damaFromPosition(D.start), label: "Posição inicial da dama: 12 pedras de cada lado nas casas escuras" }), "<b>Posição inicial.</b> A casa escura fica no canto inferior esquerdo (a1).")],
      },
      {
        id: "mover", title: "Mover uma pedra",
        body: ["A pedra anda <b>1 casa na diagonal, sempre para frente</b>, para uma casa vazia. Ela <b>não anda para trás</b> (só quando captura)."],
        figures: [fig(damaBoard({ pieces: D.step.pieces, label: "Pedra em c3 pode ir para b4 ou d4", selects: ["c3"], dots: ["b4", "d4"] }), "A pedra branca em <b>c3</b> pode ir para <b>b4</b> ou <b>d4</b>.")],
      },
      {
        id: "captura", title: "Capturar",
        body: [
          "Para capturar, <b>pule por cima</b> de uma peça adversária que esteja colada na sua, caindo na casa logo atrás, que precisa estar <b>vazia</b>. A peça pulada é removida.",
          "Ao contrário do movimento, a pedra <b>pode capturar para trás</b> também.",
        ],
        figures: [fig(damaBoard({ pieces: D.capture.pieces, label: "Pedra em c3 captura a pedra em d4 e cai em e5", selects: ["c3"], rings: ["d4"], dots: ["e5"], arrows: [["c3", "e5"]] }),
          "A pedra em <b>c3</b> pula a pedra em <b>d4</b> e cai em <b>e5</b>. Como tem captura disponível, <b>este é o único lance</b> permitido.")],
      },
      {
        id: "sequencia", title: "Capturar várias peças de uma vez",
        body: ["Se, depois de capturar, a mesma pedra puder capturar de novo, ela <b>continua no mesmo lance</b>, pulando quantas peças conseguir. Cada peça só pode ser pulada uma vez."],
        figures: [fig(damaBoard({ pieces: D.chain.pieces, label: "Captura dupla: c3 pula d4, cai em e5, pula f6 e cai em g7", selects: ["c3"], rings: ["d4", "f6"], dots: ["g7"], arrows: [["c3", "e5"], ["e5", "g7"]] }),
          "Captura dupla: <b>c3 → e5 → g7</b>, levando as duas pedras pretas em um único lance.")],
      },
      {
        id: "obrigatoria", title: "A captura é obrigatória (e vale a maioria)",
        body: [
          "Esta é a regra que mais pega iniciantes: <b>se existe uma captura, você é obrigado a capturar</b>. Não pode escolher outro lance.",
          "E se houver mais de uma captura possível, é obrigatório fazer a que <b>leva mais peças</b> (a “lei da maioria”).",
        ],
        figures: [fig(damaBoard({ pieces: D.majority.pieces, label: "Duas capturas possíveis: só vale a que leva duas peças", selects: ["c3"], rings: ["d4", "f6"], dots: ["g7"], crosses: ["f4"], arrows: [["c3", "e5"], ["e5", "g7"], ["h2", "f4", "bad"]] }),
          "A pedra em <b>h2</b> poderia capturar uma peça, mas a de <b>c3</b> leva duas. Pela regra da maioria, <b>só a captura dupla é permitida</b> (✕ = lance proibido).")],
        tips: ["Dá para usar a regra a seu favor: oferecer uma peça de <b>isca</b> obriga o adversário a capturar e abre caminho para uma captura sua maior."],
      },
      {
        id: "dama", title: "A dama: a pedra que vira rainha", grid: true,
        body: ["A pedra que <b>termina o lance na última fileira</b> do adversário vira <b>dama</b> e ganha uma coroa dourada. A dama é muito mais forte."],
        figures: [
          fig(damaBoard({ pieces: D.promo.pieces, label: "Pedra em c7 chega à última fileira em b8 ou d8 e vira dama", selects: ["c7"], dots: ["b8", "d8"], arrows: [["c7", "d8"]] }),
            "Chegando a <b>b8</b> ou <b>d8</b>, a pedra vira dama. <em>Atenção:</em> se ela passar pela última fileira no meio de uma captura e ainda puder continuar, <b>não vira dama ainda</b>; só vira se o lance terminar ali."),
          fig(damaBoard({ pieces: D.king.pieces, label: "Dama em a1 captura a pedra em e5 e pode cair em f6, g7 ou h8", selects: ["a1"], rings: ["e5"], dots: ["f6", "g7", "h8"], arrows: [["a1", "e5"]] }),
            "A dama é <b>voadora</b>: anda <b>quantas casas quiser</b> na diagonal (para frente ou para trás). Ao capturar, ela pula de longe e pode <b>cair em qualquer casa livre</b> depois da peça capturada."),
        ],
      },
      {
        id: "fim", title: "Como a partida termina",
        body: [
          "<b>Vitória:</b> o adversário ficou sem peças ou sem lances possíveis.",
          "<b>Empate:</b> a mesma posição se repete 3 vezes.",
          "<b>Tempo:</b> quem estourar o relógio perde.",
        ],
      },
    ],
    screen: {
      title: "Como jogar na tela",
      steps: [
        ...SCREEN_COMMON,
        ["Mova as peças com dois toques", "Toque na <b>pedra</b>: ela fica dourada e os <b>pontos verdes</b> mostram os destinos (anel = peça que será capturada). Depois toque no <b>destino</b>."],
        ["Captura obrigatória", "Quando você tem uma captura, a tela mostra só os lances de captura permitidos: não precisa decorar a regra da maioria, o jogo aplica por você."],
        ...SCREEN_END,
      ],
    },
    cta: { label: "Jogar Dama", href: GAMES.dama.path },
  };
}

/* =================================== GAMÃO =================================== */

function gammonGuide() {
  const G = GAMMON;
  const diceBlock = (values, color = "w") => `<div class="cj-dice-row">${diceSvg(values, { color })}</div>`;
  return {
    id: "gamao", name: "Gamão", glyph: "⚀",
    title: "Como jogar Gamão",
    lead: "O backgammon clássico: uma corrida em que <b>os dados</b> decidem quanto você anda e <b>a estratégia</b> decide como. Fácil de aprender e difícil de largar.",
    chips: chips(["2 jogadores", "15 peças cada", "2 dados", "Vence quem tirar todas as peças primeiro"]),
    legend: LEGEND_GAMMON,
    sections: [
      {
        id: "objetivo", title: "O objetivo: a corrida",
        body: [
          "Cada jogador tem <b>15 peças</b> e precisa levá-las todas até a sua <b>casa</b> (os 6 últimos pontos do caminho) e depois <b>retirá-las do tabuleiro</b>. <b>Quem tirar as 15 primeiro vence.</b>",
          "As peças <b>claras</b> andam do ponto <b>24 até o 1</b>, e a casa delas são os pontos <b>1 a 6</b> (caixa verde). As <b>escuras</b> fazem o caminho contrário.",
        ],
        figures: [fig(gammonBoard({ state: G.start, label: "Posição inicial do gamão com setas mostrando o sentido das peças claras e a casa delas em verde", homes: ["w"], arrows: [[13, 10, "good", -26], [24, 21, "good", 26], [8, 4, "good", -26]] }),
          "<b>Sentido das peças claras:</b> sempre do 24 para o 1. A caixa tracejada é a casa delas.")],
      },
      {
        id: "tabuleiro", title: "O tabuleiro",
        body: [
          "O tabuleiro tem <b>24 triângulos</b>, chamados <b>pontos</b>, numerados de 1 a 24. No meio fica a <b>barra</b>, onde ficam as peças capturadas, e nas laterais a <b>bandeja</b>, onde vão as peças já retiradas.",
          "Cada jogador começa com as peças distribuídas assim (para as claras): <b>2</b> no ponto 24, <b>5</b> no 13, <b>3</b> no 8 e <b>5</b> no 6. As escuras ficam em espelho.",
        ],
        figures: [fig(gammonBoard({ state: G.start, label: "Tabuleiro de gamão na posição inicial com os pontos numerados" }), "<b>Posição inicial.</b> Na tela, cada ponto mostra o seu número.")],
        tips: ["Se você jogar com as peças escuras, o tabuleiro <b>gira</b> para as suas peças ficarem sempre embaixo."],
      },
      {
        id: "abertura", title: "Quem começa?",
        body: ["Na abertura, <b>cada jogador rola um dado</b>. Quem tirar o <b>maior</b> começa, jogando com <b>os dois números</b> (o dele e o do adversário). Dados iguais rolam de novo."],
        figures: [fig(`<div class="cj-dice-row">${diceSvg([6], { color: "w", label: "Dado das claras: 6" })}${diceSvg([5], { color: "b", label: "Dado das escuras: 5" })}</div>`, "Claras tiram <b>6</b>, escuras tiram <b>5</b>: as claras começam, jogando o 6 e o 5.", "cj-fig-small")],
      },
      {
        id: "dados", title: "Mover com os dados",
        body: [
          "No seu turno você rola <b>dois dados</b>. <b>Cada dado é um lance</b>: o número diz quantos pontos uma peça anda. Você pode mover <b>duas peças diferentes</b>, uma com cada dado, ou <b>a mesma peça duas vezes</b>.",
          "Na tela, os dados são lançados <b>automaticamente</b> no começo do seu turno.",
        ],
        figures: [fig(diceBlock(G.dice35.dice) + gammonBoard({ state: G.start, label: "Com os dados 3 e 5: uma peça anda de 24 para 21 e outra de 13 para 8", numbers: true, selects: [], arrows: [[24, 21, "good", 28], [13, 8, "good", -30]] }),
          "Dados <b>3</b> e <b>5</b>: uma peça anda 3 pontos (<b>24 → 21</b>) e outra anda 5 (<b>13 → 8</b>).")],
      },
      {
        id: "dobres", title: "Dados iguais valem em dobro",
        body: ["Se os dois dados forem <b>iguais</b>, você joga <b>quatro vezes</b> aquele número. Com <b>4-4</b>, por exemplo, são quatro lances de 4 pontos, com as peças que quiser."],
        figures: [fig(diceBlock(G.doubles.dice) + gammonBoard({ state: G.start, label: "Dados 4 e 4: quatro lances de quatro pontos, por exemplo duas peças de 13 para 9 e duas de 8 para 4", arrows: [[13, 9, "good", -26], [8, 4, "good", -26]] }),
          "Com <b>4-4</b>: duas peças de <b>13 → 9</b> e duas de <b>8 → 4</b>. São quatro lances no total.")],
      },
      {
        id: "bloqueio", title: "Pontos bloqueados",
        body: ["Você <b>não pode parar</b> em um ponto que tenha <b>2 ou mais peças adversárias</b>: ele está bloqueado. Pode parar em pontos vazios, nos seus e naqueles com apenas <b>1</b> peça adversária."],
        figures: [fig(diceBlock(G.blocked.dice) + gammonBoard({ state: G.start, label: "Com o dado 5, a peça do ponto 24 não pode ir ao 19, bloqueado; com o 3, pode ir ao 21", crosses: [19], dots: [21], arrows: [[24, 19, "bad", 34], [24, 21, "good", 22]] }),
          "Com o dado <b>5</b>, a peça do 24 cairia no <b>19</b>, mas ele tem 5 peças escuras: <b>bloqueado</b> (✕). Com o dado <b>3</b>, ela vai para o <b>21</b>, que está livre.")],
      },
      {
        id: "bater", title: "Bater uma peça sozinha", grid: true,
        body: ["Uma peça <b>sozinha</b> num ponto se chama <b>“blot”</b> e é vulnerável. Se você parar nela, ela é <b>batida</b>: vai para a <b>barra</b> e o adversário perde terreno."],
        figures: [
          fig(diceBlock(G.hitBefore.dice) + gammonBoard({ state: G.hitBefore.state, label: "Peça escura sozinha no ponto 7; com o dado 6, a peça clara do 13 pode bater nela", hits: [7], arrows: [[13, 7, "good", -34]] }),
            "<b>Antes.</b> Há uma peça escura sozinha no ponto <b>7</b>. Com o dado <b>6</b>, a peça do <b>13</b> pode bater nela (anel vermelho)."),
          fig(gammonBoard({ state: G.hitAfter, label: "Depois da batida: a peça escura está na barra", numbers: true }),
            "<b>Depois.</b> A peça escura foi para a <b>barra</b> (faixa do meio) e terá de recomeçar o caminho."),
        ],
      },
      {
        id: "barra", title: "Voltar para o jogo pela barra",
        body: [
          "Quem tem peça na barra <b>precisa colocá-la de volta antes de qualquer outro lance</b>. A entrada usa um dado: as <b>escuras</b> entram no ponto igual ao número do dado; as <b>claras</b> entram em <b>25 menos o dado</b>.",
          "Se o ponto de entrada estiver bloqueado, aquele dado não serve. Se nenhum dado servir, <b>a vez passa</b>.",
        ],
        figures: [fig(diceBlock(G.entry.dice, "b") + gammonBoard({ state: G.entry.state, label: "Peça escura na barra com dados 6 e 3: o ponto 6 está bloqueado e o 3 está livre", crosses: [6], dots: [3], arrows: [["bar", 6, "bad", -30, { color: "b" }], ["bar", 3, "good", -30, { color: "b" }]] }),
          "Peça escura na barra, dados <b>6</b> e <b>3</b>. O ponto <b>6</b> está bloqueado (✕), então ela entra no <b>3</b>.")],
      },
      {
        id: "retirar", title: "Retirar as peças (e vencer)", grid: true,
        body: [
          "Só é permitido retirar peças quando <b>todas as suas 15 estão na casa</b> e nenhuma está na barra.",
          "O dado diz de qual ponto sai uma peça: um <b>5</b> retira do ponto <b>5</b>, um <b>2</b> retira do <b>2</b>. Se não houver peça no ponto do dado e nenhuma mais distante, o dado serve para retirar a <b>mais alta</b>. Você também pode usar o dado para mover dentro da casa.",
          "<b>Quem retirar as 15 peças primeiro vence a partida.</b>",
        ],
        figures: [
          fig(diceBlock(G.bearOff.dice) + gammonBoard({ state: G.bearOff.state, label: "Todas as peças claras na casa; com os dados 5 e 2, as peças dos pontos 5 e 2 podem sair", homes: ["w"], rings: [5, 2] }),
            "<b>Antes.</b> Todas as claras estão na casa. Com os dados <b>5</b> e <b>2</b>, saem a peça do ponto <b>5</b> e a do ponto <b>2</b> (anéis verdes)."),
          fig(gammonBoard({ state: G.bearOffAfter, label: "Depois: duas peças claras estão na bandeja, fora do jogo", homes: ["w"] }),
            "<b>Depois.</b> As duas peças foram para a <b>bandeja</b> (à direita), fora da partida. Repita até a bandeja ter as 15."),
        ],
      },
      {
        id: "regras", title: "Regras que ajudam a não errar",
        body: [
          "<b>Use o máximo de dados possível.</b> Se só um dos dados puder ser jogado, é obrigatório jogar <b>o maior</b>.",
          "<b>Sem lance, a vez passa.</b> Se nenhum dado puder ser usado, o turno passa sozinho.",
          "<b>Nesta versão</b> vence quem retirar as 15 peças primeiro. Não há pontuação extra (gammon) nem cubo de dobra.",
        ],
        tips: ["Dica de estratégia: duas ou mais peças juntas formam um <b>ponto seguro</b> (ninguém pode parar nele). Peças sozinhas podem ser batidas, então tente andar em pares."],
      },
    ],
    screen: {
      title: "Como jogar na tela",
      steps: [
        ...SCREEN_COMMON,
        ["Escolha a peça", "Os dados são lançados sozinhos. Toque numa <b>peça sua</b>: o ponto fica dourado e aparecem <b>pontos verdes</b> nos destinos possíveis (<b>vermelho</b> quando o lance bate uma peça adversária)."],
        ["Escolha o destino", "Toque no <b>ponto de destino</b> ou toque no <b>dado</b> que quer usar. Se o mesmo destino aceitar mais de um dado, o jogo pergunta qual."],
        ["Barra e retirada", "Com peça na barra, toque nela para escolher a entrada. Para retirar uma peça, escolha-a e toque na <b>bandeja</b> do seu lado."],
        ["Turno automático", "Quando você usa todos os dados, ou não tem lance possível, a vez passa sozinha para o adversário."],
        ...SCREEN_END,
      ],
    },
    cta: { label: "Jogar Gamão", href: GAMES.gamao.path },
  };
}

/* ==================================== GO ==================================== */

function goGuide() {
  const N = GO.size;
  const board = options => goBoard({ size: N, ...options });
  return {
    id: "go", name: "Go", glyph: "●",
    title: "Como jogar Go",
    lead: "O jogo milenar de cerco. As pedras não se movem: cada lance ocupa uma interseção e amplia o seu território. Em poucos minutos você aprende o essencial.",
    chips: chips(["2 jogadores", "9×9, 13×13 ou 19×19", "Pretas começam", "Vence quem cercar mais território"]),
    legend: LEGEND_GO,
    sections: [
      {
        id: "objetivo", title: "O objetivo: cercar território",
        body: [
          "Cada jogador coloca pedras nas <b>interseções</b> do tabuleiro. O objetivo não é capturar todas as pedras: é <b>cercar a maior área vazia</b>, o território.",
          "No fim, cada pedra no tabuleiro e cada interseção cercada valem <b>1 ponto</b>. Quem somar mais pontos vence.",
        ],
        figures: [fig(board({ stones: GO.objective.stones, territory: { b: GO.objective.territory }, label: "Tabuleiro 9 por 9 com quatro interseções vazias cercadas por pedras pretas no canto inferior esquerdo" }),
          "<b>Território preto.</b> As cinco pedras da borda cercam quatro interseções vazias (marcadas): esse é o território das pretas.")],
        tips: ["Pedras não se movem depois de colocadas: elas só saem do tabuleiro quando são capturadas."],
      },
      {
        id: "tabuleiro", title: "O tabuleiro e as pedras",
        body: [
          "O Go é jogado nos <b>cruzamentos</b> (as interseções), não nos quadrados. Os tabuleiros têm <b>9×9</b> (iniciante), <b>13×13</b> (intermediário) ou <b>19×19</b> (clássico).",
          "As <b>pretas jogam primeiro</b> e as cores se alternam. As bolinhas maiores são os <b>pontos de referência</b> (hoshi), que ajudam a se orientar.",
        ],
        figures: [fig(board({ label: "Tabuleiro de Go 9 por 9 vazio, com as coordenadas A a J e os pontos de referência" }),
          "<b>Tabuleiro 9×9.</b> Cada cruzamento tem um nome, como <b>E5</b> no centro. A linha 1 fica embaixo e a coluna I não existe.")],
        tips: ["No online, o handicap pode começar com pedras já colocadas nesses pontos de referência."],
      },
      {
        id: "liberdades", title: "Colocar pedras e respirar",
        body: [
          "Uma pedra ocupa uma interseção vazia. As interseções livres em volta — em cima, embaixo e dos lados — são as <b>liberdades</b>. Sem nenhuma liberdade, a pedra sai do tabuleiro.",
          "Pedras da mesma cor ligadas lado a lado formam um <b>grupo</b> e <b>compartilham as liberdades</b>.",
        ],
        figures: [fig(board({ stones: GO.group.stones, rings: ["E5", "E6"], dots: GO.group.liberties, label: "Grupo de duas pedras pretas em E5 e E6 com as seis liberdades marcadas em verde" }),
          "<b>Grupo e liberdades.</b> As duas pedras pretas estão ligadas e têm seis liberdades (pontos verdes). Enquanto houver pelo menos uma, o grupo fica no tabuleiro.")],
      },
      {
        id: "capturar", title: "Capturar: tirar as liberdades",
        body: [
          "Quando um grupo fica <b>sem nenhuma liberdade</b>, ele é capturado e todas as pedras dele saem do tabuleiro.",
          "Com uma só liberdade restante, o grupo está em <b>atari</b>: a próxima pedra que fechar o cerco captura.",
        ],
        figures: [
          fig(board({ stones: GO.capture.stones, rings: ["E5"], dots: [GO.capture.move], label: "Pedra branca em E5 cercada por três pedras pretas, com a última liberdade em E4" }),
            "<b>Atari.</b> A pedra branca em <b>E5</b> só tem uma liberdade: <b>E4</b> (ponto verde). Se as pretas jogarem ali, ela é capturada."),
          fig(board({ stones: GO.capture.after, selects: [GO.capture.move], label: "Depois da captura: a pedra branca saiu e as pretas ocupam E4" }),
            "<b>Depois.</b> As pretas jogaram em <b>E4</b> (pedra destacada), fecharam a última liberdade e a pedra branca saiu do tabuleiro."),
        ],
      },
      {
        id: "proibidos", title: "Lances proibidos: suicídio e ko", grid: true,
        body: [
          "<b>Suicídio:</b> você não pode colocar uma pedra que fique <b>sem nenhuma liberdade</b> — a não ser que o lance capture alguma pedra adversária.",
          "<b>Ko:</b> se um lance captura exatamente uma pedra e deixa a sua sozinha com uma liberdade, a <b>recaptura imediata</b> no mesmo ponto é proibida. Jogue em outro lugar antes de voltar.",
        ],
        figures: [
          fig(board({ stones: GO.suicide.stones, crosses: [GO.suicide.move], label: "Canto A9 cercado por duas pedras pretas; uma pedra branca ali seria suicídio" }),
            "<b>Suicídio.</b> A interseção <b>A9</b> está cercada pelas pedras pretas. Uma pedra branca ali ficaria sem liberdades e não capturaria ninguém: lance proibido (✕)."),
          fig(board({ stones: GO.ko.after, selects: [GO.ko.move], crosses: [GO.ko.point], label: "Depois do ko: a pedra preta capturou em E6 e a recaptura imediata em E5 é proibida" }),
            "<b>Ko.</b> A pedra preta em <b>E6</b> (destacada) capturou a branca em <b>E5</b>. A recaptura imediata em E5 (✕) é proibida: as brancas precisam jogar em outro lugar primeiro."),
        ],
      },
      {
        id: "handicap", title: "Graus, handicap e komi",
        body: [
          "No online, o ranking é <b>Kyu/Dan</b>. A diferença de grau vira <b>pedras de handicap</b>: até 9 pedras para o lado mais fraco, colocadas nos pontos de referência.",
          "Quem recebe as pedras <b>começa jogando</b> e o <b>komi cai para 0,5</b>. Sem handicap, as brancas recebem <b>6,5 pontos de komi</b> para compensar a vantagem de as pretas começarem.",
        ],
        figures: [fig(board({ stones: GO.handicap.stones, label: "Tabuleiro 9 por 9 com as nove pedras de handicap nos pontos de referência" }),
          "<b>Handicap de 9 pedras.</b> O lado mais fraco começa com essas pedras já no tabuleiro e joga primeiro.")],
      },
      {
        id: "contagem", title: "Como a partida termina",
        body: [
          "A partida termina quando os dois <b>passam a vez em seguida</b> (ou quando alguém desiste ou fica sem tempo). Aí vem a <b>contagem chinesa</b>.",
          "Some <b>1 ponto por pedra</b> no tabuleiro + <b>1 por interseção cercada</b>. As brancas ainda somam o <b>komi</b> de 6,5 (ou 0,5 com handicap).",
        ],
        figures: [fig(board({ stones: GO.count.stones, territory: { b: GO.count.black, w: GO.count.white }, label: "Tabuleiro no fim da partida com o território preto no canto inferior esquerdo e o branco no canto superior direito" }),
          "<b>Contagem chinesa.</b> Cada lado tem 5 pedras e 4 pontos de território; as brancas somam ainda 6,5 de komi. Placar: <b>brancas 15,5 × 9 pretas</b>.")],
        tips: ["As interseções vazias tocadas pelas duas cores não são território de ninguém: valem 0."],
      },
    ],
    screen: {
      title: "Como jogar na tela",
      steps: [
        ...SCREEN_COMMON,
        ["Escolha o tabuleiro", "No modo local, escolha <b>9×9</b>, <b>13×13</b> ou <b>19×19</b>. Na sala online, vale o tamanho escolhido por quem criou a sala."],
        ["Toque na interseção", "Toque num <b>cruzamento vazio</b> para colocar a sua pedra. Os lances legais aparecem como <b>pedras fantasma</b> translúcidas, e a última pedra jogada fica destacada."],
        ["Passar e contar", "Use <b>Passar</b> quando não houver bom lance. Duas passadas seguidas encerram a partida e abrem a contagem. Você também pode <b>Desistir</b>."],
        ["Handicap e komi", "No online, o servidor calcula as pedras de handicap pela diferença de grau e mostra o <b>komi</b> no painel da partida."],
        ...SCREEN_END,
      ],
    },
    cta: { label: "Jogar Go", href: GAMES.go.path },
  };
}

/* ================================== ONITAMA ================================== */

const LEGEND_ONITAMA = [
  ["dot", "Casa para onde a peça pode ir com a carta"],
  ["ring", "Peça adversária que pode ser capturada"],
  ["sel", "Peça escolhida por você"],
  ["bad", "Perigo ou lance proibido"],
];

function onitamaGuide() {
  const O = ONITAMA;
  const card = (id, color = "b") => onitamaCardSvg(ONITAMA_CARDS[id].moves, { name: ONITAMA_CARDS[id].name, label: `Carta ${ONITAMA_CARDS[id].name}`, color });
  const row = html => `<div class="cj-card-row">${html}</div>`;
  const cardName = id => ONITAMA_CARDS[id].name;
  return {
    id: "onitama", name: "Onitama", glyph: "⛩",
    title: "Como jogar Onitama",
    lead: "Um duelo de estratégia em tabuleiro 5×5 em que <b>as cartas mandam em como suas peças andam</b>. Poucas regras, muita tática. Veja como funciona.",
    chips: chips(["2 jogadores", "5 peças cada", "Tabuleiro 5×5", "Cartas de movimento"]),
    legend: LEGEND_ONITAMA,
    sections: [
      {
        id: "objetivo", title: "O objetivo",
        body: [
          "Cada jogador tem <b>1 mestre</b> (a peça com o miolo dourado) e <b>4 alunos</b>. Há duas formas de vencer:",
          "<b>Caminho da Pedra:</b> capture o <b>mestre</b> do adversário. <b>Caminho do Rio:</b> leve o <b>seu mestre</b> até o <b>templo</b> do adversário, a casa dourada do centro da fileira dele.",
        ],
        figures: [fig(onitamaBoard({ pieces: Object.fromEntries(O.start.split("/").flatMap((rowText, i) => [...rowText].map((ch, f) => [`${"abcde"[f]}${5 - i}`, ch]).filter(([, ch]) => ch !== "."))), label: "Posição inicial do Onitama: cinco peças azuis embaixo e cinco vermelhas em cima, com o mestre no templo central" }),
          "<b>Posição inicial.</b> O mestre de cada lado começa em cima do <b>próprio templo</b> (<b>c1</b> para o azul, <b>c5</b> para o vermelho).")],
      },
      {
        id: "cartas", title: "As cartas de movimento",
        body: [
          "Em cada partida são sorteadas <b>5 cartas</b> entre 16: <b>duas para cada jogador</b> e <b>uma ao lado</b> do tabuleiro. Cada carta é um animal e mostra, numa grade, <b>para onde uma peça pode andar</b>.",
          "O quadrado do centro é a peça que se move; os quadrados coloridos são os destinos. <b>Qualquer peça sua</b>, mestre ou aluno, pode usar a carta.",
        ],
        figures: [fig(row(["tiger", "dragon", "frog", "rabbit"].map(id => card(id)).join("")),
          `Exemplos: <b>${cardName("tiger")}</b> (duas casas à frente e uma atrás), <b>${cardName("dragon")}</b>, <b>${cardName("frog")}</b> e <b>${cardName("rabbit")}</b>. Cada carta tem o seu jeito, e é isso que muda de partida para partida.`, "cj-fig-small")],
        tips: ["A frente da carta é <b>sempre a direção do adversário</b>: o jogo já espelha a carta para quem joga de cima, você não precisa inverter nada."],
      },
      {
        id: "mover", title: "Mover uma peça",
        body: ["No seu turno, escolha <b>uma das suas duas cartas</b> e <b>uma peça</b>: ela anda para uma das casas que a carta mostra, desde que a casa esteja dentro do tabuleiro e <b>sem peça sua</b>."],
        figures: [fig(onitamaBoard({ pieces: O.move.pieces, label: "Aluno em c3 com a carta Dragão pode ir para a4, e4, b2 ou d2", selects: [O.move.from], dots: O.move.dots, faded: ["a1", "e5"] }),
          `Com a carta <b>${cardName(O.move.card)}</b>, o aluno azul em <b>c3</b> pode ir para <b>a4</b>, <b>e4</b>, <b>b2</b> ou <b>d2</b>. Quem pula é só a peça: <b>não importa o que está no caminho</b>.`)],
      },
      {
        id: "capturar", title: "Capturar",
        body: ["Para capturar, <b>termine o lance sobre uma peça adversária</b>: ela sai do tabuleiro. Não existe captura obrigatória e não dá para capturar com salto passando por cima de outras peças: só importa a <b>casa de destino</b>."],
        figures: [fig(onitamaBoard({ pieces: O.capture.pieces, label: "Aluno em c3 com a carta Elefante captura o aluno vermelho em d4", selects: [O.capture.from], rings: O.capture.rings, dots: O.capture.dots, arrows: [["c3", "d4"]], faded: ["a1", "e5"] }),
          `Com <b>${cardName(O.capture.card)}</b>, o aluno em <b>c3</b> captura a peça vermelha em <b>d4</b> (anel). As casas com ponto são lances sem captura.`)],
      },
      {
        id: "espelho", title: "O vermelho joga espelhado",
        body: ["O jogador de cima enxerga o tabuleiro de cabeça para baixo, então a <b>frente dele é para baixo</b> e esquerda e direita também se invertem. Por isso as cartas dele aparecem <b>giradas</b> no jogo."],
        figures: [fig(onitamaBoard({ pieces: O.mirror.pieces, label: "Aluno vermelho em c4 com a carta Tigre pode ir para c2 ou c5", selects: [O.mirror.from], dots: O.mirror.dots, faded: ["a1", "e5"] }),
          `O aluno vermelho em <b>c4</b> com <b>${cardName(O.mirror.card)}</b> anda <b>duas casas para baixo</b> (c2) ou <b>uma para trás</b> (c5): é o mesmo desenho da carta, visto do lado dele.`)],
      },
      {
        id: "troca", title: "Trocar de carta",
        body: [
          "Depois do lance, a carta que você usou <b>vai para o lado</b> e você <b>pega a carta que estava ali</b>. Quem joga depois de você vai pegar a que você acabou de usar.",
          "Isso é o coração do jogo: <b>você nunca joga sempre com as mesmas cartas</b>, e a carta que sai da sua mão vai parar na mão do adversário.",
        ],
        figures: [fig(row(["tiger", "dragon"].map(id => card(id)).join("") + `<span class="cj-card-arrow" aria-hidden="true">→</span>` + ["crab", "dragon"].map(id => card(id)).join("")),
          `Antes: <b>${cardName("tiger")}</b> e <b>${cardName("dragon")}</b> na mão, <b>${cardName("crab")}</b> ao lado. Depois de jogar o ${cardName("tiger")}: a mão fica com <b>${cardName("crab")}</b> e <b>${cardName("dragon")}</b>, e o ${cardName("tiger")} vai para o lado.`, "cj-fig-small")],
        tips: ["Pense na carta que você <b>entrega</b>: usar uma carta forte agora pode dar ao adversário o lance que ele precisava."],
      },
      {
        id: "vencer", title: "Como vencer",
        body: [
          "<b>Caminho da Pedra:</b> capturou o <b>mestre</b> do adversário, venceu na hora.",
          "<b>Caminho do Rio:</b> o <b>seu mestre</b> terminou o lance no <b>templo</b> do adversário, venceu. Só vale com o <b>mestre</b>: um aluno no templo não conta.",
        ],
        figures: [
          fig(onitamaBoard({ pieces: O.stone.pieces, label: "Aluno azul em c3 com a carta Tigre captura o mestre vermelho em c5", selects: [O.stone.from], rings: [O.stone.to], arrows: [["c3", "c5"]], faded: ["e1"] }),
            `<b>Pedra.</b> Com <b>${cardName(O.stone.card)}</b>, o aluno em <b>c3</b> vai a <b>c5</b> e captura o mestre vermelho.`),
          fig(onitamaBoard({ pieces: O.stream.pieces, label: "Mestre azul em c4 com a carta Javali anda para o templo em c5", selects: [O.stream.from], dots: [O.stream.to], arrows: [["c4", "c5"]], faded: ["a5", "e1"] }),
            `<b>Rio.</b> Com <b>${cardName(O.stream.card)}</b>, o mestre em <b>c4</b> entra no templo em <b>c5</b> e vence.`),
        ],
      },
      {
        id: "fim", title: "Passar a vez, empate e tempo",
        body: [
          "<b>Sem lance:</b> se nenhuma das suas cartas permite mover nenhuma peça, você <b>passa</b>: escolhe uma carta para trocar com a do lado e a vez segue. É raro, mas acontece.",
          "<b>Empate:</b> a mesma posição, <b>com as mesmas cartas</b>, aparece 3 vezes. O jogo de mesa não tem empate; aqui ele evita partidas infinitas.",
          "<b>Tempo:</b> quem estourar o relógio perde. <b>Quem começa:</b> é definido pela cor da carta que ficou ao lado.",
        ],
      },
    ],
    screen: {
      title: "Como jogar na tela",
      steps: [
        ["Escolha o ritmo e o lado", "Cada jogador tem o <b>próprio relógio</b>, que só corre no seu turno: 2, 5, 10 ou 15 minutos por jogador. Escolha <b>Azul</b>, <b>Vermelho</b> ou <b>Sorteio</b>. Quem fica sem tempo perde."],
        SCREEN_COMMON[1],
        SCREEN_COMMON[2],
        ["Escolha a carta, a peça e o destino", "Toque numa das <b>suas cartas</b>: as peças que podem usá-la ficam realçadas. Toque na <b>peça</b> (os <b>pontos</b> mostram os destinos; anel = captura) e depois no <b>destino</b>. Dá para tocar na peça primeiro também."],
        ["Dois caminhos para o mesmo destino", "Se as duas cartas levam a peça ao mesmo lugar, o jogo realça as cartas e pergunta <b>qual usar</b>."],
        ["A carta do lado", "Fica ao lado do seu baralho, marcada <b>Do lado</b>. É a que você vai pegar quando jogar."],
        ["Sem lance possível", "Se nenhuma carta serve, toque numa carta para <b>trocá-la e passar a vez</b>."],
        ...SCREEN_END,
      ],
    },
    cta: { label: "Jogar Onitama", href: GAMES.onitama.path },
  };
}

export const GUIDES = [chessGuide(), damaGuide(), gammonGuide(), goGuide(), onitamaGuide()];
export const GUIDE_IDS = GUIDES.map(g => g.id);
