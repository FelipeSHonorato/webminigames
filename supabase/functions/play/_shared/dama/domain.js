/* Dama — regras completas do jogo de damas. Código puro (sem DOM, sem rede):
   roda igual no navegador, na Edge Function (Deno) e nos testes do Node.

   Tabuleiro: array de 64 posições, índice = rank * 8 + file, com rank 0 = 1ª fileira.
   Peças: maiúsculas = brancas (P = peão, D = dama), minúsculas = pretas (p, d), null = vazio.
   As peças ocupam as casas escuras: (file + rank) % 2 === 0 (a1 é escura).

   Estado: { board, turn: "w"|"b" }

   Partida: { state, keys, moves, last, result } — `keys` guarda a chave de cada posição
   (repetição tripla) e `moves` o histórico com o caminho completo de cada lance.

   Regras:
   • o peão anda uma casa na diagonal, só para frente;
   • o peão captura pulando uma peça adversária em qualquer diagonal (para frente ou para trás),
     desde que a casa de destino esteja vazia;
   • a dama é voadora: anda qualquer distância na diagonal e captura à distância, podendo
     escolher qualquer casa vazia depois da peça capturada;
   • captura é obrigatória e vale a MÁXIMA captura (quem pode comer mais, come mais);
   • a peça capturada só sai do tabuleiro no fim do lance e não pode ser saltada duas vezes;
   • a casa de origem fica livre durante a sequência: uma captura em ciclo pode terminar nela;
   • o peão que termina o lance na última fileira vira dama (no meio de uma captura, não promove);
   • perde quem fica sem lance; empata por repetição tripla. */

export const WHITE = "w", BLACK = "b";

/* Contrato do duelo 1×1: a dama é um jogo de TURNOS (não uma corrida no mesmo puzzle).
   `times` são os ritmos aceitos, em minutos POR JOGADOR; quem cria a sala escolhe um deles. */
export const DUEL = { kind: "turn", times: [3, 10, 30, 60] };

export const FILES = "abcdefgh";

/* Fileiras de cima (rank 7) para baixo (rank 0), separadas por "/". */
export const START_POSITION =
  ".p.p.p.p/p.p.p.p./.p.p.p.p/......../......../P.P.P.P./.P.P.P.P/P.P.P.P.";

const fileOf = sq => sq & 7;
const rankOf = sq => sq >> 3;
const other = c => (c === WHITE ? BLACK : WHITE);
export const opposite = other;
const inBoard = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;

export const square = (file, rank) => rank * 8 + file;
export const squareName = sq => FILES[fileOf(sq)] + (rankOf(sq) + 1);

const isWhitePiece = p => p === "P" || p === "D";
const isBlackPiece = p => p === "p" || p === "d";
export const isPiece = p => isWhitePiece(p) || isBlackPiece(p);
export const colorOf = p => (isWhitePiece(p) ? WHITE : isBlackPiece(p) ? BLACK : null);
export const isKing = p => p === "D" || p === "d";
export const typeOf = p => (p ? p.toUpperCase() : null);

export function parseSquare(name) {
  if (typeof name !== "string" || name.length !== 2) return -1;
  const f = FILES.indexOf(name[0].toLowerCase());
  const r = Number(name[1]) - 1;
  return f < 0 || r < 0 || r > 7 ? -1 : square(f, r);
}

const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const promotionRank = color => (color === WHITE ? 7 : 0);

/* ===================== POSIÇÃO ===================== */

/** Lê a posição em linhas de 8 caracteres (rank 7 → rank 0) e devolve o estado. */
export function fromPosition(text = START_POSITION, turn = WHITE) {
  if (turn !== WHITE && turn !== BLACK) throw new Error("posição inválida: vez");
  const rows = String(text).trim().split(/[/\n]+/);
  if (rows.length !== 8) throw new Error("posição inválida: fileiras");

  const board = new Array(64).fill(null);
  rows.forEach((row, i) => {
    if (row.length !== 8) throw new Error("posição inválida: fileira incompleta");
    for (let f = 0; f < 8; f++) {
      const ch = row[f];
      if (ch === "." || ch === "-") continue;
      if (!isPiece(ch)) throw new Error("posição inválida: peça");
      board[square(f, 7 - i)] = ch;
    }
  });
  return { board, turn };
}

/** Serializa o tabuleiro (sem a vez) em 8 linhas separadas por "/". */
export function toPosition(state) {
  const rows = [];
  for (let r = 7; r >= 0; r--) {
    let row = "";
    for (let f = 0; f < 8; f++) row += state.board[square(f, r)] ?? ".";
    rows.push(row);
  }
  return rows.join("/");
}

export const initial = () => fromPosition(START_POSITION, WHITE);

/** Chave da posição para repetição tripla (tabuleiro + vez). */
export const positionKey = state => `${toPosition(state)} ${state.turn}`;

/* ===================== GERAÇÃO DE LANCES ===================== */

const makeMove = (state, from, path, captures, promotion = false) => {
  const piece = state.mover ?? state.board[from];
  const color = colorOf(piece);
  return {
    from,
    to: path[path.length - 1],
    piece,
    color,
    path,
    captures,
    captureCount: captures.length,
    promotion,
  };
};

/** Lances simples (sem captura) de uma peça. */
function simpleMoves(state, from) {
  const { board } = state;
  const piece = board[from];
  const color = colorOf(piece);
  const out = [];
  const f = fileOf(from), r = rankOf(from);

  if (isKing(piece)) {
    for (const [df, dr] of DIAG) {
      let nf = f + df, nr = r + dr;
      while (inBoard(nf, nr)) {
        const to = square(nf, nr);
        if (board[to]) break;
        out.push(makeMove(state, from, [from, to], []));
        nf += df; nr += dr;
      }
    }
    return out;
  }

  const dr = color === WHITE ? 1 : -1;
  for (const df of [-1, 1]) {
    const nf = f + df, nr = r + dr;
    if (!inBoard(nf, nr)) continue;
    const to = square(nf, nr);
    if (board[to]) continue;
    out.push(makeMove(state, from, [from, to], [], nr === promotionRank(color)));
  }
  return out;
}

/** Continua a sequência de capturas de um peão. */
function manCaptures(state, from, path, captures) {
  const { board } = state;
  const color = colorOf(state.mover);
  const f = fileOf(from), r = rankOf(from);
  const out = [];

  /* O peão captura nas quatro diagonais (para frente e para trás). */
  for (const [df, dr] of DIAG) {
    const mf = f + df, mr = r + dr;
    const lf = f + 2 * df, lr = r + 2 * dr;
    if (!inBoard(lf, lr)) continue;
    const mid = square(mf, mr), land = square(lf, lr);
    const target = board[mid];
    if (!target || colorOf(target) === color) continue;
    if (captures.includes(mid)) continue;     // a mesma peça não pode ser saltada duas vezes
    if (board[land]) continue;
    const nextPath = [...path, land];
    const nextCaptures = [...captures, mid];
    const deeper = manCaptures(state, land, nextPath, nextCaptures);
    if (deeper.length) out.push(...deeper);
    else out.push(makeMove(state, path[0], nextPath, nextCaptures, lr === promotionRank(color)));
  }
  return out;
}

/** Continua a sequência de capturas de uma dama (voadora). */
function kingCaptures(state, from, path, captures) {
  const { board } = state;
  const color = colorOf(state.mover);
  const f = fileOf(from), r = rankOf(from);
  const out = [];

  for (const [df, dr] of DIAG) {
    let nf = f + df, nr = r + dr;

    /* Anda pelas casas vazias até encontrar a primeira peça. */
    while (inBoard(nf, nr) && !board[square(nf, nr)]) { nf += df; nr += dr; }
    if (!inBoard(nf, nr)) continue;

    const mid = square(nf, nr);
    const target = board[mid];
    if (!target || colorOf(target) === color) continue;
    if (captures.includes(mid)) continue;

    /* Depois da peça capturada, qualquer casa vazia é uma parada possível. */
    let lf = nf + df, lr = nr + dr;
    while (inBoard(lf, lr) && !board[square(lf, lr)]) {
      const land = square(lf, lr);
      const nextPath = [...path, land];
      const nextCaptures = [...captures, mid];
      const deeper = kingCaptures(state, land, nextPath, nextCaptures);
      if (deeper.length) out.push(...deeper);
      else out.push(makeMove(state, path[0], nextPath, nextCaptures));
      lf += df; lr += dr;
    }
  }
  return out;
}

/** Todos os lances de captura de uma peça, já completos (sem parar no meio). */
const capturesFrom = (state, from) => {
  const piece = state.board[from];
  if (!piece) return [];
  /* A peça já saiu da casa de origem: durante a sequência essa casa está LIVRE e pode ser
     atravessada ou ser a casa final (captura em ciclo que volta ao ponto de partida). */
  const board = state.board.slice();
  board[from] = null;
  const lifted = { board, turn: state.turn, mover: piece };
  return isKing(piece)
    ? kingCaptures(lifted, from, [from], [])
    : manCaptures(lifted, from, [from], []);
};

/**
 * Lances legais do lado da vez. Captura é obrigatória: se houver qualquer sequência de
 * captura, só valem as de MÁXIMA captura; os lances simples desaparecem.
 */
export function legalMoves(state) {
  const color = state.turn;
  const captures = [];
  const simple = [];

  for (let from = 0; from < 64; from++) {
    const piece = state.board[from];
    if (!piece || colorOf(piece) !== color) continue;
    const caps = capturesFrom(state, from);
    if (caps.length) captures.push(...caps);
    else simple.push(...simpleMoves(state, from));
  }

  if (!captures.length) return simple;
  const max = Math.max(...captures.map(m => m.captureCount));
  return captures.filter(m => m.captureCount === max);
}

export const movesFrom = (state, sq) => legalMoves(state).filter(m => m.from === sq);

/** Aplica um lance já validado e devolve o novo estado (imutável). */
export function applyMove(state, move) {
  const board = state.board.slice();
  const piece = board[move.from];
  if (!piece) throw new Error("lance sem peça");

  for (const sq of move.captures) board[sq] = null;
  board[move.from] = null;

  const color = colorOf(piece);
  const lastRank = rankOf(move.to) === promotionRank(color);
  board[move.to] = !isKing(piece) && lastRank
    ? (color === WHITE ? "D" : "d")
    : piece;

  return { board, turn: other(color) };
}

/* ===================== NOTAÇÃO ===================== */

/** Caminho completo em texto, como "c3e5g7". */
export const toPath = move => move.path.map(squareName).join("");

/** Registro curto do lance, do jeito que o servidor e o histórico guardam. */
export const moveRecord = move => ({
  path: toPath(move),
  captures: move.captures.map(squareName),
  captureCount: move.captureCount,
  promotion: move.promotion,
});

/** Texto legível do lance: "c3–d4" ou "c3×e5×g7". */
export function moveText(move) {
  const names = move.path.map(squareName);
  return names[0] + (move.captureCount ? "×" : "–") + names.slice(1).join("×");
}

function pathOf(input) {
  if (typeof input === "string") {
    const text = input.trim().toLowerCase();
    if (!/^([a-h][1-8]){2,}$/.test(text)) return null;
    const out = [];
    for (let i = 0; i < text.length; i += 2) out.push(parseSquare(text.slice(i, i + 2)));
    return out.every(sq => sq >= 0) ? out : null;
  }
  if (Array.isArray(input)) {
    const out = input.map(v => (typeof v === "string" ? parseSquare(v) : v));
    return out.length >= 2 && out.every(v => Number.isInteger(v) && v >= 0 && v < 64) ? out : null;
  }
  if (input && typeof input === "object") {
    if (input.path !== undefined) return pathOf(input.path);
    if (input.from !== undefined && input.to !== undefined) {
      const from = typeof input.from === "string" ? parseSquare(input.from) : input.from;
      const to = typeof input.to === "string" ? parseSquare(input.to) : input.to;
      return Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to >= 0 ? [from, to] : null;
    }
  }
  return null;
}

/** Encontra o lance legal correspondente ao caminho completo ("c3e5g7", ["c3","e5","g7"] etc.). */
export function findMove(state, input) {
  const path = pathOf(input);
  if (!path) return null;
  return legalMoves(state).find(m =>
    m.path.length === path.length && m.path.every((sq, i) => sq === path[i])
  ) || null;
}

/* ===================== FIM DE JOGO ===================== */

/** Quantas vezes a posição atual apareceu (a chave atual deve estar em `keys`). */
export function repetitions(state, keys = []) {
  const key = positionKey(state);
  return keys.filter(k => k === key).length || 1;
}

/**
 * Resultado da partida.
 * `keys` = chaves de TODAS as posições já jogadas, incluindo a atual.
 * Retorna { over, winner: "w"|"b"|null, reason: "no_moves"|"repetition"|null }.
 */
export function outcome(state, keys = []) {
  if (!legalMoves(state).length) {
    return { over: true, winner: other(state.turn), reason: "no_moves" };
  }
  if (repetitions(state, keys) >= 3) {
    return { over: true, winner: null, reason: "repetition" };
  }
  return { over: false, winner: null, reason: null };
}

/* ===================== PARTIDA ===================== */

export function newGame(position = START_POSITION, turn = WHITE) {
  const state = fromPosition(position, turn);
  const key = positionKey(state);
  return {
    state,
    keys: [key],
    moves: [],
    last: null,
    result: outcome(state, [key]),
  };
}

/** Joga um lance (objeto legal ou caminho completo) e devolve a partida nova. */
export function playMove(game, input) {
  const move = input && input.path ? input : findMove(game.state, input);
  if (!move) throw new Error("lance ilegal");
  const state = applyMove(game.state, move);
  const key = positionKey(state);
  const keys = [...game.keys, key];
  return {
    state,
    keys,
    moves: [...game.moves, moveRecord(move)],
    last: moveRecord(move),
    result: outcome(state, keys),
  };
}

export const RESULT_LABELS = {
  no_moves: "Sem lances",
  repetition: "Repetição tripla",
  resign: "Desistência",
  timeout: "Tempo esgotado",
};
