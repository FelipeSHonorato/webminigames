/* Prévias dos templates, como strings de SVG/HTML (sem DOM: testável no Node).

   Cada prévia usa as variáveis CSS da própria página do jogo, com um valor de reserva ao lado
   (`var(--light, #f0d9b5)`), então acompanha o tema claro/escuro. Cores e formas espelham o jogo;
   por isso as prévias da Default são desenhadas à mão e não importam o `ui.js` de ninguém.

   Regras do desenho (as mesmas do `preview` do catálogo): nada de <defs>/url(#id), nada de recursos
   externos, e todo SVG leva `role="img"` + `aria-label`. As únicas imagens são as cartas do UNO
   (`cards/*.png`), pedidas relativas à página do jogo (`base`).

   API: renderPreview(jogo, tipo, idDoTemplate, { base }) → string HTML. */

const SYMBOL_FONT = "'Segoe UI Symbol','Noto Sans Symbols 2','DejaVu Sans',serif";
const v = (name, fallback) => `var(${name},${fallback})`;
const fillOf = (name, fallback) => `style="fill:${v(name, fallback)}"`;

const svg = (w, h, label, body) =>
  `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}" preserveAspectRatio="xMidYMid meet">${body}</svg>`;

/** Disco com brilho (substitui o radial-gradient do CSS sem precisar de <defs>). */
const disc = (cx, cy, r, { fill, stroke, strokeWidth = 1.4, shine = "#fff", shineOpacity = 0.28 }) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>` +
  `<circle cx="${cx - r * 0.3}" cy="${cy - r * 0.35}" r="${r * 0.42}" fill="${shine}" opacity="${shineOpacity}"/>`;

/* ===================== cores das peças (as mesmas do CSS de cada jogo) ===================== */

const CHECKER = {
  w: { fill: "#e8dcc7", stroke: "#8a6f4d", shine: "#fff", shineOpacity: 0.5 },
  b: { fill: "#1b1b1b", stroke: "#d9cdb8", shine: "#fff", shineOpacity: 0.16 },
};
const STONE = {
  b: { fill: "#1b1b1b", stroke: "#000", shine: "#fff", shineOpacity: 0.2 },
  w: { fill: "#f4efe2", stroke: "#a89a80", shine: "#fff", shineOpacity: 0.6 },
};
const ONITAMA = {
  b: { fill: v("--blue", "#2f6db5"), stroke: v("--blue-edge", "#10325a"), shine: "#fff", shineOpacity: 0.3 },
  r: { fill: v("--red", "#c4412f"), stroke: v("--red-edge", "#5e1710"), shine: "#fff", shineOpacity: 0.3 },
};

/* ===================== Xadrez ===================== */

const CHESS_GLYPH = { K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞", P: "♟" };
const CHESS_BACK = ["R", "N", "B", "Q", "K", "B", "N", "R"];

const chessGlyph = (cx, cy, type, color, size) => {
  const paint = color === "w"
    ? `fill="#fff" stroke="#2a2a2a" stroke-width="0.9"`
    : `fill="#1b1b1b" stroke="rgba(255,255,255,.7)" stroke-width="0.5"`;
  return `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-family="${SYMBOL_FONT}" font-size="${size}" ${paint} paint-order="stroke">${CHESS_GLYPH[type]}</text>`;
};

function chessBoard() {
  const S = 20;
  let out = "";
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    out += `<rect x="${c * S}" y="${r * S}" width="${S}" height="${S}" ${fillOf((r + c) % 2 === 0 ? "--light" : "--dark", (r + c) % 2 === 0 ? "#f0d9b5" : "#b58863")}/>`;
  }
  for (let c = 0; c < 8; c++) {
    const x = c * S + S / 2;
    out += chessGlyph(x, S / 2 + 1, CHESS_BACK[c], "b", 16);
    out += chessGlyph(x, S * 1.5 + 1, "P", "b", 16);
    out += chessGlyph(x, S * 6.5 + 1, "P", "w", 16);
    out += chessGlyph(x, S * 7.5 + 1, CHESS_BACK[c], "w", 16);
  }
  return svg(160, 160, "Prévia do tabuleiro de xadrez", out);
}

function chessPieces() {
  const S = 40, types = ["K", "Q", "R", "B", "N", "P"];
  let out = "";
  for (let r = 0; r < 2; r++) for (let c = 0; c < 6; c++) {
    out += `<rect x="${c * S}" y="${r * S}" width="${S}" height="${S}" ${fillOf((r + c) % 2 === 0 ? "--light" : "--dark", (r + c) % 2 === 0 ? "#f0d9b5" : "#b58863")}/>`;
    out += chessGlyph(c * S + S / 2, r * S + S / 2 + 2, types[c], r === 0 ? "w" : "b", 32);
  }
  return svg(240, 80, "Prévia das peças de xadrez: brancas e pretas", out);
}

/* ===================== Dama ===================== */

function damaBoard() {
  const S = 20;
  let out = "";
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const dark = (r + c) % 2 === 1;
    out += `<rect x="${c * S}" y="${r * S}" width="${S}" height="${S}" ${fillOf(dark ? "--dark" : "--light", dark ? "#b58863" : "#f0d9b5")}/>`;
    if (!dark) continue;
    const color = r < 3 ? "b" : r > 4 ? "w" : null;
    if (color) out += disc(c * S + S / 2, r * S + S / 2, 7.4, CHECKER[color]);
  }
  return svg(160, 160, "Prévia do tabuleiro de dama", out);
}

function damaPieces() {
  const S = 40;
  const crown = color => color === "w" ? "#3a2b19" : "#f4e6d2";
  let out = `<rect width="160" height="80" ${fillOf("--dark", "#b58863")}/>`;
  const items = [["w", false], ["w", true], ["b", false], ["b", true]];
  items.forEach(([color, king], i) => {
    const cx = i * S + S / 2, cy = 40;
    out += disc(cx, cy, 15, CHECKER[color]);
    if (king) out += `<text x="${cx}" y="${cy + 1}" text-anchor="middle" dominant-baseline="central" font-family="${SYMBOL_FONT}" font-size="17" fill="${crown(color)}">♛</text>`;
  });
  return svg(160, 80, "Prévia das peças de dama: peões e damas, brancas e pretas", out);
}

/* ===================== Gamão ===================== */

function gammonBoard() {
  const W = 200, H = 100, EDGE = 5, BAR = 10, PW = 15, TRI = 40;
  let out = `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="7" ${fillOf("--board", "#7a5230")} stroke="${v("--board-edge", "#2a1b0f")}" stroke-width="1.5"/>`;
  const px = i => i < 6 ? EDGE + i * PW : EDGE + 6 * PW + BAR + (i - 6) * PW;
  for (let i = 0; i < 12; i++) {
    const x = px(i), light = i % 2 === 0;
    out += `<polygon points="${x},${EDGE} ${x + PW},${EDGE} ${x + PW / 2},${EDGE + TRI}" ${fillOf(light ? "--point-light" : "--point-dark", light ? "#f0d9b5" : "#b58863")} opacity=".92"/>`;
    out += `<polygon points="${x},${H - EDGE} ${x + PW},${H - EDGE} ${x + PW / 2},${H - EDGE - TRI}" ${fillOf(light ? "--point-dark" : "--point-light", light ? "#b58863" : "#f0d9b5")} opacity=".92"/>`;
  }
  out += `<rect x="${EDGE + 6 * PW}" y="${EDGE}" width="${BAR}" height="${H - EDGE * 2}" fill="${v("--board-deep", "#3f2a19")}"/>`;
  const stack = (i, count, top, color) => {
    for (let k = 0; k < count; k++) {
      const cy = top ? EDGE + 6.5 + k * 12 : H - EDGE - 6.5 - k * 12;
      out += disc(px(i) + PW / 2, cy, 6, CHECKER[color]);
    }
  };
  stack(0, 3, true, "b"); stack(4, 2, true, "w"); stack(7, 3, true, "w"); stack(11, 2, true, "b");
  stack(0, 3, false, "w"); stack(4, 2, false, "b"); stack(7, 3, false, "b"); stack(11, 2, false, "w");
  return svg(W, H, "Prévia do tabuleiro de gamão", out);
}

function gammonPieces() {
  let out = `<rect width="160" height="80" ${fillOf("--point-light", "#f0d9b5")}/>`;
  out += disc(30, 40, 15, CHECKER.w) + disc(70, 40, 15, CHECKER.b);
  for (let k = 0; k < 3; k++) out += disc(112, 62 - k * 18, 13, CHECKER.w);
  for (let k = 0; k < 3; k++) out += disc(142, 62 - k * 18, 13, CHECKER.b);
  return svg(160, 80, "Prévia das peças de gamão: brancas e pretas, avulsas e empilhadas", out);
}

/* ===================== Go ===================== */

function goBoard() {
  const N = 9, M = 16, STEP = 16, size = M * 2 + STEP * (N - 1);
  let out = `<rect x="1" y="1" width="${size - 2}" height="${size - 2}" rx="6" fill="#d9a85f" stroke="${v("--board-edge", "#8a6234")}" stroke-width="2"/>`;
  const line = v("--board-line", "#6b4a25");
  for (let i = 0; i < N; i++) {
    const p = M + i * STEP;
    out += `<line x1="${M}" y1="${p}" x2="${size - M}" y2="${p}" stroke="${line}" stroke-width="1"/>`;
    out += `<line x1="${p}" y1="${M}" x2="${p}" y2="${size - M}" stroke="${line}" stroke-width="1"/>`;
  }
  for (const [c, r] of [[2, 2], [2, 6], [6, 2], [6, 6], [4, 4]]) {
    out += `<circle cx="${M + c * STEP}" cy="${M + r * STEP}" r="2.3" fill="${v("--star", "#4a3218")}"/>`;
  }
  const stones = [["b", 2, 2], ["b", 3, 4], ["b", 4, 3], ["w", 4, 4], ["w", 3, 3], ["w", 5, 4], ["b", 5, 5], ["w", 6, 6], ["b", 6, 2]];
  for (const [color, c, r] of stones) out += disc(M + c * STEP, M + r * STEP, 7.2, STONE[color]);
  return svg(size, size, "Prévia do tabuleiro de Go", out);
}

function goStones() {
  let out = `<rect width="160" height="80" fill="#d9a85f"/>`;
  out += disc(38, 40, 22, STONE.b) + disc(94, 40, 22, STONE.w);
  return svg(160, 80, "Prévia das pedras de Go: preta e branca", out);
}

/* ===================== Onitama ===================== */

const onitamaMaster = (cx, cy, r, color) =>
  disc(cx, cy, r, { ...ONITAMA[color], stroke: v("--gold", "#f2c94c"), strokeWidth: 2.6 }) +
  `<circle cx="${cx}" cy="${cy}" r="${r * 0.34}" fill="${v("--gold", "#f2c94c")}" stroke="rgba(0,0,0,.25)" stroke-width="1.5"/>`;

function onitamaBoard() {
  const S = 30;
  let out = "";
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
    out += `<rect x="${c * S}" y="${r * S}" width="${S}" height="${S}" ${fillOf((r + c) % 2 === 0 ? "--dark" : "--light", (r + c) % 2 === 0 ? "#cdb994" : "#eadfc8")}/>`;
  }
  for (const r of [0, 4]) {
    out += `<rect x="${2 * S + 3}" y="${r * S + 3}" width="${S - 6}" height="${S - 6}" rx="2" fill="none" stroke="${v("--gold", "#f2c94c")}" stroke-width="2"/>`;
  }
  for (let c = 0; c < 5; c++) {
    const x = c * S + S / 2;
    out += c === 2 ? onitamaMaster(x, S / 2, 10, "r") : disc(x, S / 2, 10, ONITAMA.r);
    out += c === 2 ? onitamaMaster(x, S * 4.5, 10, "b") : disc(x, S * 4.5, 10, ONITAMA.b);
  }
  return svg(150, 150, "Prévia do tabuleiro de Onitama", out);
}

function onitamaPieces() {
  let out = `<rect width="200" height="100" ${fillOf("--light", "#eadfc8")}/>`;
  out += disc(25, 50, 20, ONITAMA.b) + onitamaMaster(75, 50, 20, "b");
  out += disc(125, 50, 20, ONITAMA.r) + onitamaMaster(175, 50, 20, "r");
  return svg(200, 100, "Prévia das peças de Onitama: alunos e mestres, azuis e vermelhos", out);
}

/* Cartas de exemplo: iguais a CARDS.tiger/dragon/rabbit de games/onitama/domain.js
   (tests/templates.test.js confere). dy > 0 = para a frente. */
export const ONITAMA_SAMPLE_CARDS = Object.freeze([
  { name: "Tigre", stamp: "r", moves: [[0, 2], [0, -1]] },
  { name: "Dragão", stamp: "r", moves: [[-2, 1], [2, 1], [-1, -1], [1, -1]] },
  { name: "Coelho", stamp: "b", moves: [[2, 0], [1, 1], [-1, -1]] },
]);

function onitamaCards() {
  const C = 10, W = C * 5 + 8, H = W + 16;
  let out = "";
  ONITAMA_SAMPLE_CARDS.forEach((card, i) => {
    const x0 = 6 + i * (W + 8), edge = ONITAMA[card.stamp].fill;
    out += `<rect x="${x0}" y="4" width="${W}" height="${H}" rx="6" ${fillOf("--card", "#fff")} stroke="${edge}" stroke-width="2.4"/>`;
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
      out += `<rect x="${x0 + 4 + c * C}" y="${8 + r * C}" width="${C - 0.8}" height="${C - 0.8}" ${fillOf("--light", "#eadfc8")}/>`;
    }
    out += `<circle cx="${x0 + 4 + 2.5 * C - 0.4}" cy="${8 + 2.5 * C - 0.4}" r="3" fill="${v("--fg", "#14213d")}" opacity=".75"/>`;
    for (const [dx, dy] of card.moves) {
      out += `<rect x="${x0 + 4 + (2 + dx) * C}" y="${8 + (2 - dy) * C}" width="${C - 0.8}" height="${C - 0.8}" fill="${edge}"/>`;
    }
    out += `<text x="${x0 + W / 2}" y="${H - 3}" text-anchor="middle" font-size="8.5" font-weight="700" fill="${v("--fg", "#14213d")}">${card.name}</text>`;
  });
  return svg(6 + ONITAMA_SAMPLE_CARDS.length * (W + 8), H + 8, "Prévia das cartas de movimento do Onitama", out);
}

/* ===================== Truco ===================== */

const SUIT = { clubs: "♣", hearts: "♥", spades: "♠", diamonds: "♦" };
const RED_SUIT = new Set(["hearts", "diamonds"]);

/** Carta de Truco desenhada como no jogo: índice no canto, naipe grande no centro, borda cinza. */
const trucoCard = (cx, cy, rotate, rank, suit) => {
  const ink = RED_SUIT.has(suit) ? "#b32727" : "#18212b";
  return `<g transform="translate(${cx} ${cy}) rotate(${rotate})">` +
    `<rect x="-26" y="-39" width="52" height="78" rx="6" fill="#fff" stroke="${v("--card-line", "#c3ced9")}" stroke-width="1.6"/>` +
    `<text x="-20" y="-24" font-size="13" font-weight="800" fill="${ink}">${rank}</text>` +
    `<text x="-20" y="-11" font-size="12" font-family="${SYMBOL_FONT}" fill="${ink}">${SUIT[suit]}</text>` +
    `<text x="0" y="14" text-anchor="middle" font-size="30" font-family="${SYMBOL_FONT}" fill="${ink}">${SUIT[suit]}</text>` +
    `</g>`;
};

/** As quatro manilhas, na ordem: zap, copeta, espadilha, pica-fumo. */
function trucoCards() {
  const fan = [[56, -12, "4", "clubs"], [102, -4, "7", "hearts"], [148, 4, "A", "spades"], [194, 12, "7", "diamonds"]];
  return svg(250, 110, "Prévia das cartas do Truco: as quatro manilhas",
    fan.map(([x, rot, rank, suit]) => trucoCard(x, 58, rot, rank, suit)).join(""));
}

const FELT = "background:radial-gradient(ellipse at 50% 0%,rgba(255,255,255,.14),transparent 58%),linear-gradient(160deg,var(--felt-1,#246d4d),var(--felt-2,#14442f))";

function trucoTable() {
  const slot = x => `<rect x="${x}" y="48" width="44" height="66" rx="7" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="2" stroke-dasharray="5 4"/>`;
  const inner = svg(240, 150, "Prévia da mesa do Truco: feltro verde com as cartas da rodada",
    `<rect x="6" y="6" width="228" height="138" rx="12" fill="none" stroke="rgba(255,255,255,.16)" stroke-dasharray="4 4"/>` +
    slot(34) + slot(98) + slot(162) + trucoCard(120, 81, 0, "3", "spades"));
  return `<div class="tpl-felt" style="${FELT}">${inner}</div>`;
}

/* ===================== UNO ===================== */

const unoImg = (base, file, extra = "") =>
  `<img src="${base}cards/${file}" alt="" loading="lazy" decoding="async" draggable="false"${extra}>`;

function unoCards(base) {
  const files = ["vermelho_7.png", "azul_mais2.png", "coringa_mais4_1.png", "verde_inverter.png"];
  return `<div class="tpl-uno-fan" role="img" aria-label="Prévia das cartas do UNO">${files.map(f => unoImg(base, f)).join("")}</div>`;
}

function unoTable(base) {
  return `<div class="tpl-felt tpl-uno-table" style="${FELT}" role="img" aria-label="Prévia da mesa do UNO: feltro verde com o monte de compra e a carta do descarte">` +
    `<span class="tpl-uno-ring">${unoImg(base, "costa_cartas.png")}${unoImg(base, "amarelo_5.png")}</span></div>`;
}

/* ===================== API ===================== */

const PREVIEWS = {
  chess: { board: chessBoard, pieces: chessPieces },
  dama: { board: damaBoard, pieces: damaPieces },
  gamao: { board: gammonBoard, pieces: gammonPieces },
  go: { board: goBoard, pieces: goStones },
  onitama: { board: onitamaBoard, pieces: onitamaPieces, cards: onitamaCards },
  truco: { board: trucoTable, cards: trucoCards },
  uno: { board: unoTable, cards: unoCards },
};

/**
 * Prévia de um template. `kind` é o `kind` do espaço em `TEMPLATE_GAMES` (board/pieces/cards).
 * Hoje só existe a Default: um id desconhecido cai nela. Devolve "" para jogo/tipo sem prévia.
 */
export function renderPreview(game, kind, templateId = "default", { base = "./" } = {}) {
  const draw = PREVIEWS[game]?.[kind];
  return draw ? draw(base) : "";
}

export const previewKindsOf = game => Object.keys(PREVIEWS[game] ?? {});
