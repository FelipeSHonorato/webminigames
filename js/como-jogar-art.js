/* Ilustrações da página "Como jogar": tabuleiros de Xadrez, Dama e Gamão e dados, desenhados em SVG por código.
   Módulo puro (só devolve strings): roda no navegador e nos testes do Node.

   Por que SVG gerado e não imagem: as figuras usam as mesmas cores e a mesma geometria dos jogos, escalam em
   qualquer tela, não pesam e dão para validar nos testes (os exemplos vêm de posições reais).

   Regras de desenho:
   • sem <defs>/url(#id): o mesmo id em várias figuras da página se confunde;
   • cores fixas (iguais nos temas claro e escuro); só os rótulos usam `currentColor`;
   • quem usa precisa dar `label` (vira o aria-label da figura). */

export const COLORS = Object.freeze({
  light: "#f0d9b5", dark: "#b58863",              // casas (iguais às de xadrez e dama)
  good: "#1fa971", bad: "#e5484d", sel: "#f2b134", // destino, perigo/captura inimiga, peça escolhida
  ink: "#1b222c", paper: "#fbfdff",
  boardWood: "#7a5230", boardDeep: "#3f2a19",      // gamão
});

const FONT = "'Segoe UI Symbol','Noto Sans Symbols 2','DejaVu Sans',serif";
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const n1 = n => Math.round(n * 100) / 100;

/* ============================== setas ============================== */

const norm = v => { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; };

/** Seta de `a` até `b`. `curve` (px) arqueia o traço; `gap` encurta o começo e o fim para não cobrir as peças. */
export function arrow(a, b, { color = COLORS.good, width = 5, curve = 0, gapStart = 12, gapEnd = 10, head = 13, opacity = 0.92, dash = "" } = {}) {
  const u = norm({ x: b.x - a.x, y: b.y - a.y });
  const s = { x: a.x + u.x * gapStart, y: a.y + u.y * gapStart };
  const t = { x: b.x - u.x * gapEnd, y: b.y - u.y * gapEnd };
  const ctrl = curve ? { x: (s.x + t.x) / 2 - u.y * curve, y: (s.y + t.y) / 2 + u.x * curve } : null;
  const d = norm(ctrl ? { x: t.x - ctrl.x, y: t.y - ctrl.y } : { x: t.x - s.x, y: t.y - s.y });
  const base = { x: t.x - d.x * head * 0.9, y: t.y - d.y * head * 0.9 };
  const p = { x: -d.y, y: d.x };
  const l = { x: base.x + p.x * head * 0.55, y: base.y + p.y * head * 0.55 };
  const r = { x: base.x - p.x * head * 0.55, y: base.y - p.y * head * 0.55 };
  const path = ctrl
    ? `M${n1(s.x)} ${n1(s.y)} Q${n1(ctrl.x)} ${n1(ctrl.y)} ${n1(base.x)} ${n1(base.y)}`
    : `M${n1(s.x)} ${n1(s.y)} L${n1(base.x)} ${n1(base.y)}`;
  return `<g class="cj-arrow" opacity="${opacity}"><path d="${path}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ""}/>` +
    `<polygon points="${n1(t.x)},${n1(t.y)} ${n1(l.x)},${n1(l.y)} ${n1(r.x)},${n1(r.y)}" fill="${color}"/></g>`;
}

/** "✕" vermelho: lance proibido. */
export const crossMark = (x, y, r = 11) =>
  `<g class="cj-x"><circle cx="${n1(x)}" cy="${n1(y)}" r="${r}" fill="${COLORS.bad}" stroke="#fff" stroke-width="1.5"/>` +
  `<path d="M${n1(x - r * 0.42)} ${n1(y - r * 0.42)}L${n1(x + r * 0.42)} ${n1(y + r * 0.42)}M${n1(x + r * 0.42)} ${n1(y - r * 0.42)}L${n1(x - r * 0.42)} ${n1(y + r * 0.42)}" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></g>`;

/* ======================= tabuleiro 8×8 (xadrez e dama) ======================= */

const SQ = 40, MARGIN = 20, SIDE = SQ * 8 + MARGIN * 2;   // 360 × 360
export const BOARD_SIZE = SIDE;

export const squareName = (file, rank) => "abcdefgh"[file] + (rank + 1);
export function parseSquare(name) {
  const m = /^([a-h])([1-8])$/.exec(name);
  if (!m) throw new Error(`casa inválida: ${name}`);
  return { file: m[1].charCodeAt(0) - 97, rank: +m[2] - 1 };
}
export function squareCenter(name) {
  const { file, rank } = parseSquare(name);
  return { x: MARGIN + file * SQ + SQ / 2, y: MARGIN + (7 - rank) * SQ + SQ / 2 };
}
const isDarkSquare = (file, rank) => (file + rank) % 2 === 0;       // a1 é escura

function frame(overlay) {
  let squares = "", coords = "";
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    squares += `<rect x="${MARGIN + f * SQ}" y="${MARGIN + (7 - r) * SQ}" width="${SQ}" height="${SQ}" fill="${isDarkSquare(f, r) ? COLORS.dark : COLORS.light}"/>`;
  }
  for (let i = 0; i < 8; i++) {
    coords += `<text x="${MARGIN + i * SQ + SQ / 2}" y="${SIDE - 5}" text-anchor="middle" font-size="12" fill="currentColor" opacity=".7">${"abcdefgh"[i]}</text>`;
    coords += `<text x="9" y="${MARGIN + (7 - i) * SQ + SQ / 2 + 4}" text-anchor="middle" font-size="12" fill="currentColor" opacity=".7">${i + 1}</text>`;
  }
  return `<g>${squares}</g><rect x="${MARGIN - 1}" y="${MARGIN - 1}" width="${SQ * 8 + 2}" height="${SQ * 8 + 2}" fill="none" stroke="#0a0f15" stroke-opacity=".5" stroke-width="2.5" rx="3"/>${coords}${overlay}`;
}

/** Camadas de destaque comuns: peça escolhida, xeque, pontos de destino, anéis de captura. */
function marks({ selects = [], checks = [], dots = [], rings = [], crosses = [] }) {
  let out = "";
  for (const s of selects) { const { x, y } = squareCenter(s); out += `<rect x="${x - SQ / 2}" y="${y - SQ / 2}" width="${SQ}" height="${SQ}" fill="${COLORS.sel}" opacity=".6"/>`; }
  for (const s of checks) { const { x, y } = squareCenter(s); out += `<rect x="${x - SQ / 2}" y="${y - SQ / 2}" width="${SQ}" height="${SQ}" fill="${COLORS.bad}" opacity=".5"/><circle cx="${x}" cy="${y}" r="${SQ * 0.46}" fill="none" stroke="${COLORS.bad}" stroke-width="3"/>`; }
  for (const s of dots) { const { x, y } = squareCenter(s); out += `<circle class="cj-dot" cx="${x}" cy="${y}" r="${SQ * 0.17}" fill="${COLORS.good}" stroke="#fff" stroke-opacity=".85" stroke-width="1.6"/>`; }
  for (const s of rings) { const { x, y } = squareCenter(s); out += `<circle class="cj-ring" cx="${x}" cy="${y}" r="${SQ * 0.43}" fill="none" stroke="${COLORS.good}" stroke-width="4"/>`; }
  for (const s of crosses) { const { x, y } = squareCenter(s); out += crossMark(x, y, 11); }
  return out;
}

function arrowsLayer(arrows = []) {
  return arrows.map(([from, to, kind = "good", curve = 0]) =>
    arrow(squareCenter(from), squareCenter(to), { color: kind === "bad" ? COLORS.bad : kind === "sel" ? COLORS.sel : COLORS.good, curve })).join("");
}

const svgOpen = (cls, label, w, h) => `<svg class="${cls}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}" focusable="false">`;

/* ---------------------------------- xadrez ---------------------------------- */

const CHESS_GLYPH = {
  w: { p: "♙", r: "♖", n: "♘", b: "♗", q: "♕", k: "♔" },
  b: { p: "♟", r: "♜", n: "♞", b: "♝", q: "♛", k: "♚" },
};

/** Lê só a parte das peças de um FEN → { "e4": "P", ... } (maiúscula = branca). */
export function parseFen(fen) {
  const rows = String(fen).split(" ")[0].split("/");
  if (rows.length !== 8) throw new Error(`FEN inválido: ${fen}`);
  const out = {};
  rows.forEach((row, i) => {
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { file += +ch; continue; }
      out[squareName(file, 7 - i)] = ch;
      file++;
    }
    if (file !== 8) throw new Error(`FEN inválido (fileira ${8 - i}): ${fen}`);
  });
  return out;
}

/** Tabuleiro de xadrez. `fen` (só as peças importam); destaques por nome de casa; `arrows` = [de, para, "good"|"bad"|"sel", curva]. */
export function chessBoard({ fen, label, faded = [], arrows = [], ...rest }) {
  const pieces = parseFen(fen);
  let glyphs = "";
  for (const [sq, ch] of Object.entries(pieces)) {
    const { x, y } = squareCenter(sq);
    const white = ch === ch.toUpperCase();
    const g = CHESS_GLYPH[white ? "w" : "b"][ch.toLowerCase()] + "\uFE0E";
    glyphs += `<text x="${x}" y="${y + 1}" text-anchor="middle" dominant-baseline="central" font-family="${FONT}" font-size="31" ` +
      `fill="${white ? COLORS.paper : COLORS.ink}" stroke="${white ? COLORS.ink : "none"}" stroke-width=".9" paint-order="stroke"` +
      `${faded.includes(sq) ? ' opacity=".4"' : ""}>${g}</text>`;
  }
  return svgOpen("cj-board cj-chess", label, SIDE, SIDE) + frame(marks(rest)) + glyphs + arrowsLayer(arrows) + "</svg>";
}

/* ----------------------------------- dama ----------------------------------- */

/** Peça de dama (pedra ou dama) centrada em x,y. `code`: P/D = claras, p/d = escuras. */
function damaPiece(x, y, code, faded) {
  const white = code === "P" || code === "D";
  const king = code === "D" || code === "d";
  const r = SQ * 0.39;
  let out = `<g${faded ? ' opacity=".4"' : ""}>` +
    `<circle cx="${x}" cy="${y}" r="${r}" fill="${white ? "#efe3cc" : "#1b1b1b"}" stroke="${white ? "#8a6f4d" : "#d9cdb8"}" stroke-width="1.8"/>` +
    `<circle cx="${n1(x - r * 0.3)}" cy="${n1(y - r * 0.34)}" r="${n1(r * 0.3)}" fill="${white ? "#fff" : "#5a5a5a"}" opacity=".85"/>`;
  if (king) {
    const s = r / 14;   // coroa dourada
    out += `<path d="M${n1(x - 8 * s)} ${n1(y + 5 * s)} L${n1(x - 9 * s)} ${n1(y - 5 * s)} L${n1(x - 4 * s)} ${n1(y - 1 * s)} L${n1(x)} ${n1(y - 7 * s)} L${n1(x + 4 * s)} ${n1(y - 1 * s)} L${n1(x + 9 * s)} ${n1(y - 5 * s)} L${n1(x + 8 * s)} ${n1(y + 5 * s)} Z" ` +
      `fill="#e8b923" stroke="#7a5a00" stroke-width="1.2" stroke-linejoin="round"/>`;
  }
  return out + "</g>";
}

/** Tabuleiro de dama. `pieces`: { "c3": "P", "d4": "p", "a1": "D" … }. */
export function damaBoard({ pieces, label, faded = [], arrows = [], ...rest }) {
  let body = "";
  for (const [sq, code] of Object.entries(pieces)) {
    const { file, rank } = parseSquare(sq);
    if (!isDarkSquare(file, rank)) throw new Error(`dama: ${sq} é casa clara (as peças ficam nas escuras)`);
    const { x, y } = squareCenter(sq);
    body += damaPiece(x, y, code, faded.includes(sq));
  }
  return svgOpen("cj-board cj-dama", label, SIDE, SIDE) + frame(marks(rest)) + body + arrowsLayer(arrows) + "</svg>";
}

/** Posição de dama no formato do domínio (8 fileiras da 8 à 1, "." = vazio) a partir de { casa: peça }. */
export function damaPosition(pieces) {
  const rows = [];
  for (let r = 7; r >= 0; r--) {
    let row = "";
    for (let f = 0; f < 8; f++) row += pieces[squareName(f, r)] ?? ".";
    rows.push(row);
  }
  return rows.join("/");
}

/* ----------------------------------- gamão ----------------------------------- */

const G = { pw: 28, bar: 26, x0: 14, y0: 24, y1: 256, tri: 104, r: 9, step: 21.6, trayX: 392, trayW: 36 };
const HALF = 6 * G.pw;
const GW = G.trayX + G.trayW + 6, GH = 284;
export const GAMMON_SIZE = { w: GW, h: GH };
const BAR_X = G.x0 + HALF, BAR_CX = BAR_X + G.bar / 2, MID_Y = (G.y0 + G.y1) / 2;

/** Posição inicial (mesma do domínio): { brancas: {ponto: qtd}, pretas: {...} }. */
export const GAMMON_START = Object.freeze({
  w: { 24: 2, 13: 5, 8: 3, 6: 5 },
  b: { 1: 2, 12: 5, 17: 3, 19: 5 },
  bar: { w: 0, b: 0 }, off: { w: 0, b: 0 },
});

const gIndex = n => (n >= 13 ? n - 13 : 12 - n);
const gLeft = n => { const i = gIndex(n); return G.x0 + (i < 6 ? i * G.pw : HALF + G.bar + (i - 6) * G.pw); };
const gCx = n => gLeft(n) + G.pw / 2;
const gTop = n => n >= 13;
/** Altura do "degrau" `slot` (0 = junto da base) no ponto n. */
const gSlotY = (n, slot) => (gTop(n) ? G.y0 + G.r + 2 + slot * G.step : G.y1 - G.r - 2 - slot * G.step);

export function gammonAnchor(where, { slot = 0, color = "w" } = {}) {
  if (where === "bar") return { x: BAR_CX, y: color === "w" ? MID_Y + 26 : MID_Y - 26 };
  if (where === "off") return { x: G.trayX + G.trayW / 2, y: (color === "w" ? G.y1 - 44 - slot * 22 : G.y0 + 44 + slot * 22) };   // slot separa setas que chegam juntas
  return { x: gCx(where), y: gSlotY(where, Math.min(slot, 4)) };
}

function gChecker(x, y, color) {
  const white = color === "w", r = G.r;
  return `<circle cx="${n1(x)}" cy="${n1(y)}" r="${r}" fill="${white ? "#efe3cc" : "#1b1b1b"}" stroke="${white ? "#8a6f4d" : "#d9cdb8"}" stroke-width="1.8"/>` +
    `<circle cx="${n1(x - 3.4)}" cy="${n1(y - 3.8)}" r="3.4" fill="${white ? "#fff" : "#5a5a5a"}" opacity=".85"/>`;
}
const gBadge = (x, y, text) =>
  `<rect x="${n1(x - 13)}" y="${n1(y - 7)}" width="26" height="14" rx="7" fill="#000" opacity=".66"/><text x="${n1(x)}" y="${n1(y + 3.6)}" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">×${text}</text>`;

/**
 * Tabuleiro de gamão (claras embaixo, casa 1 no canto inferior direito — igual ao jogo).
 * `state`: { w: {ponto: qtd}, b: {...}, bar: {w,b}, off: {w,b} }.
 * Destaques: dots/hits (destino; hit = vai bater uma peça), rings (peça de cima do ponto), selects, crosses (bloqueado), homes (["w"|"b"]).
 * Setas: arrows = [de, para, "good"|"bad"|"sel", curva, opções] com de/para = ponto, "bar" ou "off".
 */
export function gammonBoard({ state = GAMMON_START, label, numbers = true, dots = [], hits = [], rings = [], selects = [], crosses = [], homes = [], arrows = [] }) {
  let tri = "", num = "", men = "", over = "", marksTop = "";
  for (let n = 1; n <= 24; n++) {
    const x = gLeft(n), cx = x + G.pw / 2, top = gTop(n);
    const pts = top ? `${x},${G.y0} ${x + G.pw},${G.y0} ${cx},${G.y0 + G.tri}` : `${x},${G.y1} ${x + G.pw},${G.y1} ${cx},${G.y1 - G.tri}`;
    tri += `<polygon points="${pts}" fill="${n % 2 === 0 ? COLORS.dark : COLORS.light}"/>`;
    if (numbers) num += `<text x="${cx}" y="${top ? 15 : GH - 6}" text-anchor="middle" font-size="10" fill="currentColor" opacity=".72">${n}</text>`;
    for (const color of ["w", "b"]) {
      const count = state[color]?.[n] ?? 0;
      for (let k = 0; k < Math.min(count, 5); k++) men += gChecker(cx, gSlotY(n, k), color);
      if (count > 5) men += gBadge(cx, gSlotY(n, 5) - (top ? -2 : 2), count);
    }
  }
  for (const color of homes) {
    const x = color === "w" ? G.x0 + HALF + G.bar : G.x0 + HALF + G.bar, top = color === "b";
    over += `<rect x="${x - 2}" y="${top ? G.y0 - 3 : G.y1 - G.tri - 4}" width="${HALF + 4}" height="${G.tri + 7}" rx="6" fill="#fff" opacity=".10"/>` +
      `<rect x="${x - 2}" y="${top ? G.y0 - 3 : G.y1 - G.tri - 4}" width="${HALF + 4}" height="${G.tri + 7}" rx="6" fill="none" stroke="${COLORS.good}" stroke-width="3" stroke-dasharray="7 5"/>`;
  }
  for (const n of selects) {
    const x = gLeft(n), cx = x + G.pw / 2;
    over += `<polygon points="${gTop(n) ? `${x},${G.y0} ${x + G.pw},${G.y0} ${cx},${G.y0 + G.tri}` : `${x},${G.y1} ${x + G.pw},${G.y1} ${cx},${G.y1 - G.tri}`}" fill="${COLORS.sel}" opacity=".45" stroke="${COLORS.sel}" stroke-width="2.5"/>`;
  }
  const dest = (n, color, ring) => {
    const own = (state.w?.[n] ?? 0) + (state.b?.[n] ?? 0);
    const a = { x: gCx(n), y: gSlotY(n, Math.min(own, 4)) };
    return ring
      ? `<circle class="cj-ring" cx="${a.x}" cy="${gSlotY(n, 0)}" r="${G.r + 4}" fill="none" stroke="${color}" stroke-width="3.4"/>`
      : `<circle class="cj-dot" cx="${a.x}" cy="${n1(a.y)}" r="8" fill="${color}" stroke="#fff" stroke-opacity=".9" stroke-width="1.8"/>`;
  };
  for (const n of dots) marksTop += dest(n, COLORS.good, false);
  for (const n of hits) marksTop += dest(n, COLORS.bad, true);
  for (const n of crosses) { const a = gammonAnchor(n, { slot: 1 }); marksTop += crossMark(a.x, a.y, 12); }
  // anel verde na peça de cima do ponto: "esta peça vai sair/mexer"
  for (const n of rings) {
    const count = (state.w?.[n] ?? 0) + (state.b?.[n] ?? 0);
    marksTop += `<circle class="cj-ring" cx="${gCx(n)}" cy="${n1(gSlotY(n, Math.min(Math.max(count - 1, 0), 4)))}" r="${G.r + 4}" fill="none" stroke="${COLORS.good}" stroke-width="3.4"/>`;
  }

  // barra
  const bar = `<rect x="${BAR_X}" y="${G.y0}" width="${G.bar}" height="${G.y1 - G.y0}" fill="${COLORS.boardDeep}"/>`;
  let barMen = "";
  for (const color of ["w", "b"]) {
    const count = state.bar?.[color] ?? 0;
    for (let k = 0; k < Math.min(count, 4); k++) barMen += gChecker(BAR_CX, color === "w" ? MID_Y + 26 + k * G.step : MID_Y - 26 - k * G.step, color);
    if (count > 4) barMen += gBadge(BAR_CX, color === "w" ? MID_Y + 26 + 4 * G.step : MID_Y - 26 - 4 * G.step, count);
  }
  // bandejas (peças já retiradas)
  let tray = `<rect x="${G.trayX}" y="${G.y0 - 6}" width="${G.trayW}" height="${G.y1 - G.y0 + 12}" rx="6" fill="${COLORS.boardDeep}"/><rect x="${G.trayX + 4}" y="${MID_Y - 1}" width="${G.trayW - 8}" height="2" fill="#000" opacity=".4"/>`;
  for (const color of ["w", "b"]) {
    const count = state.off?.[color] ?? 0;
    for (let k = 0; k < Math.min(count, 15); k++) {
      const y = color === "w" ? G.y1 - 8 - k * 7.4 : G.y0 + 1 + k * 7.4;
      tray += `<rect x="${G.trayX + 5}" y="${n1(y)}" width="${G.trayW - 10}" height="6.4" rx="2.4" fill="${color === "w" ? "#efe3cc" : "#1b1b1b"}" stroke="${color === "w" ? "#8a6f4d" : "#d9cdb8"}" stroke-width="1"/>`;
    }
  }

  const arr = arrows.map(([from, to, kind = "good", curve = 26, opts = {}]) =>
    arrow(gammonAnchor(from, { slot: opts.fromSlot ?? Math.max(0, (state[opts.color ?? "w"]?.[from] ?? 1) - 1), color: opts.color ?? "w" }),
      gammonAnchor(to, { slot: opts.toSlot ?? (state.w?.[to] ?? 0) + (state.b?.[to] ?? 0), color: opts.color ?? "w" }),
      { color: kind === "bad" ? COLORS.bad : kind === "sel" ? COLORS.sel : COLORS.good, curve, gapStart: 14, gapEnd: 12, width: 5 })).join("");

  return svgOpen("cj-board cj-gammon", label, GW, GH) +
    `<rect x="6" y="${G.y0 - 6}" width="${G.trayX - 14}" height="${G.y1 - G.y0 + 12}" rx="8" fill="${COLORS.boardWood}"/>` +
    tri + bar + num + over + men + barMen + tray + marksTop + arr + "</svg>";
}

/* ----------------------------------- dados ----------------------------------- */

const PIPS = {
  1: [[2, 2]], 2: [[1, 1], [3, 3]], 3: [[1, 1], [2, 2], [3, 3]], 4: [[1, 1], [3, 1], [1, 3], [3, 3]],
  5: [[1, 1], [3, 1], [2, 2], [1, 3], [3, 3]], 6: [[1, 1], [3, 1], [1, 2], [3, 2], [1, 3], [3, 3]],
};

/** Um ou mais dados lado a lado. `color`: "w" (dado claro) ou "b" (dado escuro), como no jogo. */
export function diceSvg(values, { color = "w", label = `Dados: ${values.join(" e ")}`, used = [] } = {}) {
  const S = 44, gap = 10, W = values.length * S + (values.length - 1) * gap + 4;
  const bg = color === "w" ? "#f7f3ea" : "#20242b", pip = color === "w" ? "#263243" : "#f4e6d2", edge = color === "w" ? "#b9aa93" : "#8492a3";
  let out = svgOpen("cj-dice", label, W, S + 4, 1);
  values.forEach((v, i) => {
    const x = 2 + i * (S + gap);
    out += `<g${used.includes(i) ? ' opacity=".38"' : ""}><rect x="${x}" y="2" width="${S}" height="${S}" rx="9" fill="${bg}" stroke="${edge}" stroke-width="2"/>`;
    for (const [px, py] of PIPS[v]) out += `<circle cx="${x + (px * S) / 4}" cy="${2 + (py * S) / 4}" r="4.2" fill="${pip}"/>`;
    out += "</g>";
  });
  return out + "</svg>";
}
