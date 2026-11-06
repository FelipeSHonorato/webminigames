/* Conteúdo das páginas "Como jogar" (Xadrez, Dama e Gamão). Módulo puro: sem DOM, roda no navegador e nos testes.

   Os EXEMPLOS (CHESS, DAMA, GAMMON) ficam exportados porque `tests/como-jogar.test.js` confere cada um contra o
   domínio do jogo (ex.: o "mate do corredor" é mesmo xeque-mate; a captura dupla da Dama é mesmo a única válida).
   Assim a página nunca ensina uma regra diferente da que o jogo aplica.

   Texto: pode usar <b>, <em> e <kbd>; é conteúdo nosso (não vem do usuário), por isso entra como HTML. */

import { GAMES } from "./games.js";
import {
  chessBoard, damaBoard, gammonBoard, diceSvg, damaPosition, parseFen, parseSquare, squareName, GAMMON_START,
} from "./como-jogar-art.js";

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

export const GUIDES = [chessGuide(), damaGuide(), gammonGuide()];
export const GUIDE_IDS = GUIDES.map(g => g.id);
