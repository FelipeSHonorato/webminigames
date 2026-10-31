/* Xadrez — regras completas de torneio. Código puro (sem DOM, sem rede):
   roda igual no navegador, na Edge Function (Deno) e nos testes do Node.

   Tabuleiro: array de 64 posições, índice = rank * 8 + file, com rank 0 = 1ª fileira.
   Peças: maiúsculas = brancas (PNBRQK), minúsculas = pretas (pnbrqk), null = vazio.

   Estado: { board, turn: "w"|"b", castling: "KQkq", ep: number|null,
             halfmove, fullmove }

   Partida: { state, keys, moves, last, result } — `keys` guarda a chave de cada posição
   (repetição tripla) e `moves` o histórico em UCI/SAN. */

export const WHITE = "w", BLACK = "b";
export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
export const PROMOTIONS = ["Q", "R", "B", "N"];

/* Contrato do duelo 1×1: o xadrez é um jogo de TURNOS (não uma corrida no mesmo puzzle).
   `times` são os ritmos aceitos, em minutos POR JOGADOR; quem cria a sala escolhe um deles. */
export const DUEL = { kind: "turn", times: [3, 10, 30, 60] };

export const FILES = "abcdefgh";
const fileOf = sq => sq & 7;
const rankOf = sq => sq >> 3;
const other = c => (c === WHITE ? BLACK : WHITE);
export const opposite = other;
const inBoard = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;
const isUpper = ch => ch >= "A" && ch <= "Z";

export const square = (file, rank) => rank * 8 + file;
export const squareName = sq => FILES[fileOf(sq)] + (rankOf(sq) + 1);
export const colorOf = piece => (isUpper(piece) ? WHITE : BLACK);
export const typeOf = piece => piece.toUpperCase();

export function parseSquare(name) {
  if (typeof name !== "string" || name.length !== 2) return -1;
  const f = FILES.indexOf(name[0]);
  const r = Number(name[1]) - 1;
  return f < 0 || r < 0 || r > 7 ? -1 : square(f, r);
}

const KNIGHT_STEPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING_STEPS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

/* ===================== FEN ===================== */

export function fromFen(fen = START_FEN) {
  const parts = String(fen).trim().split(/\s+/);
  if (parts.length < 4) throw new Error("FEN inválido");
  const [placement, turn, castling, epText, halfText, fullText] = parts;
  if (turn !== WHITE && turn !== BLACK) throw new Error("FEN inválido: vez");

  const board = new Array(64).fill(null);
  const rows = placement.split("/");
  if (rows.length !== 8) throw new Error("FEN inválido: fileiras");
  rows.forEach((row, i) => {
    let file = 0;
    for (const ch of row) {
      if (ch >= "1" && ch <= "8") file += Number(ch);
      else if ("pnbrqkPNBRQK".includes(ch)) {
        if (file > 7) throw new Error("FEN inválido: coluna");
        board[square(file, 7 - i)] = ch;
        file++;
      } else throw new Error("FEN inválido: peça");
    }
    if (file !== 8) throw new Error("FEN inválido: fileira incompleta");
  });

  const rights = ["K", "Q", "k", "q"].filter(c => castling.includes(c)).join("");
  const ep = epText && epText !== "-" ? parseSquare(epText) : null;
  return {
    board,
    turn,
    castling: rights,
    ep: ep !== null && ep >= 0 ? ep : null,
    halfmove: Number(halfText) || 0,
    fullmove: Number(fullText) || 1,
  };
}

export const initial = () => fromFen(START_FEN);

function boardFen(board) {
  const rows = [];
  for (let r = 7; r >= 0; r--) {
    let row = "", empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = board[square(f, r)];
      if (!p) empty++;
      else {
        if (empty) { row += empty; empty = 0; }
        row += p;
      }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return rows.join("/");
}

export function toFen(state) {
  return [
    boardFen(state.board),
    state.turn,
    state.castling || "-",
    state.ep === null ? "-" : squareName(state.ep),
    state.halfmove,
    state.fullmove,
  ].join(" ");
}

/* ===================== ATAQUES E XEQUE ===================== */

export function kingSquare(board, color) {
  const king = color === WHITE ? "K" : "k";
  for (let i = 0; i < 64; i++) if (board[i] === king) return i;
  return -1;
}

/** A casa `sq` está atacada por alguma peça da cor `by`? */
export function isAttacked(board, sq, by) {
  const f = fileOf(sq), r = rankOf(sq);

  /* peões: o atacante está uma fileira atrás, nas colunas vizinhas */
  const pawn = by === WHITE ? "P" : "p";
  const pawnRank = by === WHITE ? r - 1 : r + 1;
  if (pawnRank >= 0 && pawnRank < 8) {
    if (f > 0 && board[square(f - 1, pawnRank)] === pawn) return true;
    if (f < 7 && board[square(f + 1, pawnRank)] === pawn) return true;
  }

  const knight = by === WHITE ? "N" : "n";
  for (const [df, dr] of KNIGHT_STEPS) {
    const nf = f + df, nr = r + dr;
    if (inBoard(nf, nr) && board[square(nf, nr)] === knight) return true;
  }

  const king = by === WHITE ? "K" : "k";
  for (const [df, dr] of KING_STEPS) {
    const nf = f + df, nr = r + dr;
    if (inBoard(nf, nr) && board[square(nf, nr)] === king) return true;
  }

  const rook = by === WHITE ? "R" : "r";
  const bishop = by === WHITE ? "B" : "b";
  const queen = by === WHITE ? "Q" : "q";

  for (const [df, dr] of ORTHO) {
    let nf = f + df, nr = r + dr;
    while (inBoard(nf, nr)) {
      const p = board[square(nf, nr)];
      if (p) {
        if (p === rook || p === queen) return true;
        break;
      }
      nf += df; nr += dr;
    }
  }
  for (const [df, dr] of DIAG) {
    let nf = f + df, nr = r + dr;
    while (inBoard(nf, nr)) {
      const p = board[square(nf, nr)];
      if (p) {
        if (p === bishop || p === queen) return true;
        break;
      }
      nf += df; nr += dr;
    }
  }
  return false;
}

export function inCheck(state, color = state.turn) {
  const k = kingSquare(state.board, color);
  return k >= 0 && isAttacked(state.board, k, other(color));
}

/* ===================== GERAÇÃO DE LANCES ===================== */

function makeMove(board, from, to, extra = {}) {
  const piece = board[from];
  const color = colorOf(piece);
  const promotion = extra.promotion
    ? (color === WHITE ? extra.promotion.toUpperCase() : extra.promotion.toLowerCase())
    : null;
  return {
    from,
    to,
    piece,
    color,
    captured: extra.captured !== undefined ? extra.captured : board[to] || null,
    promotion,
    castle: extra.castle || null,
    enPassant: !!extra.enPassant,
    double: !!extra.double,
  };
}

/** Lances que respeitam o movimento das peças, mas ainda podem deixar o rei em xeque. */
export function pseudoMoves(state, color = state.turn) {
  const { board } = state;
  const out = [];

  for (let from = 0; from < 64; from++) {
    const piece = board[from];
    if (!piece || colorOf(piece) !== color) continue;
    const type = typeOf(piece);
    const f = fileOf(from), r = rankOf(from);

    if (type === "P") {
      const dir = color === WHITE ? 1 : -1;
      const startRank = color === WHITE ? 1 : 6;
      const promoRank = color === WHITE ? 7 : 0;

      const oneR = r + dir;
      if (inBoard(f, oneR) && !board[square(f, oneR)]) {
        const one = square(f, oneR);
        if (oneR === promoRank) {
          for (const p of PROMOTIONS) out.push(makeMove(board, from, one, { promotion: p }));
        } else {
          out.push(makeMove(board, from, one));
          const twoR = r + 2 * dir;
          if (r === startRank && !board[square(f, twoR)]) {
            out.push(makeMove(board, from, square(f, twoR), { double: true }));
          }
        }
      }

      for (const df of [-1, 1]) {
        const nf = f + df, nr = r + dir;
        if (!inBoard(nf, nr)) continue;
        const to = square(nf, nr);
        const target = board[to];
        if (target && colorOf(target) !== color) {
          if (nr === promoRank) {
            for (const p of PROMOTIONS) out.push(makeMove(board, from, to, { promotion: p }));
          } else out.push(makeMove(board, from, to));
        } else if (!target && to === state.ep) {
          const capturedSq = square(nf, r);
          out.push(makeMove(board, from, to, { enPassant: true, captured: board[capturedSq] }));
        }
      }
      continue;
    }

    if (type === "N") {
      for (const [df, dr] of KNIGHT_STEPS) {
        const nf = f + df, nr = r + dr;
        if (!inBoard(nf, nr)) continue;
        const to = square(nf, nr);
        if (!board[to] || colorOf(board[to]) !== color) out.push(makeMove(board, from, to));
      }
      continue;
    }

    if (type === "K") {
      for (const [df, dr] of KING_STEPS) {
        const nf = f + df, nr = r + dr;
        if (!inBoard(nf, nr)) continue;
        const to = square(nf, nr);
        if (!board[to] || colorOf(board[to]) !== color) out.push(makeMove(board, from, to));
      }

      /* roque: direitos + casas vazias + rei fora de xeque no caminho */
      const enemy = other(color);
      if (color === WHITE && from === 4) {
        if (state.castling.includes("K") && board[7] === "R" && !board[5] && !board[6]
          && !isAttacked(board, 4, enemy) && !isAttacked(board, 5, enemy) && !isAttacked(board, 6, enemy)) {
          out.push(makeMove(board, 4, 6, { castle: "K" }));
        }
        if (state.castling.includes("Q") && board[0] === "R" && !board[1] && !board[2] && !board[3]
          && !isAttacked(board, 4, enemy) && !isAttacked(board, 3, enemy) && !isAttacked(board, 2, enemy)) {
          out.push(makeMove(board, 4, 2, { castle: "Q" }));
        }
      } else if (color === BLACK && from === 60) {
        if (state.castling.includes("k") && board[63] === "r" && !board[61] && !board[62]
          && !isAttacked(board, 60, enemy) && !isAttacked(board, 61, enemy) && !isAttacked(board, 62, enemy)) {
          out.push(makeMove(board, 60, 62, { castle: "K" }));
        }
        if (state.castling.includes("q") && board[56] === "r" && !board[57] && !board[58] && !board[59]
          && !isAttacked(board, 60, enemy) && !isAttacked(board, 59, enemy) && !isAttacked(board, 58, enemy)) {
          out.push(makeMove(board, 60, 58, { castle: "Q" }));
        }
      }
      continue;
    }

    /* bispo, torre e rainha */
    const dirs = type === "B" ? DIAG : type === "R" ? ORTHO : [...ORTHO, ...DIAG];
    for (const [df, dr] of dirs) {
      let nf = f + df, nr = r + dr;
      while (inBoard(nf, nr)) {
        const to = square(nf, nr);
        const target = board[to];
        if (!target) out.push(makeMove(board, from, to));
        else {
          if (colorOf(target) !== color) out.push(makeMove(board, from, to));
          break;
        }
        nf += df; nr += dr;
      }
    }
  }
  return out;
}

/** Aplica um lance já validado e devolve o novo estado (imutável). */
export function applyMove(state, move) {
  const board = state.board.slice();
  const piece = board[move.from];
  if (!piece) throw new Error("lance sem peça");
  const color = colorOf(piece);
  const type = typeOf(piece);

  let captured = board[move.to];
  let enPassant = false;
  if (type === "P" && !board[move.to] && move.to === state.ep && fileOf(move.from) !== fileOf(move.to)) {
    const capturedSq = square(fileOf(move.to), rankOf(move.from));
    captured = board[capturedSq];
    board[capturedSq] = null;
    enPassant = true;
  }

  board[move.from] = null;
  board[move.to] = move.promotion
    ? (color === WHITE ? typeOf(move.promotion) : typeOf(move.promotion).toLowerCase())
    : piece;

  if (type === "K" && Math.abs(move.to - move.from) === 2) {
    if (move.to > move.from) {
      board[move.from + 1] = board[move.from + 3];
      board[move.from + 3] = null;
    } else {
      board[move.from - 1] = board[move.from - 4];
      board[move.from - 4] = null;
    }
  }

  let castling = state.castling;
  const drop = chars => {
    for (const ch of chars) castling = castling.split(ch).join("");
  };
  if (type === "K") drop(color === WHITE ? "KQ" : "kq");
  if (type === "R") {
    if (move.from === 0) drop("Q");
    if (move.from === 7) drop("K");
    if (move.from === 56) drop("q");
    if (move.from === 63) drop("k");
  }
  if (captured) {
    if (move.to === 0) drop("Q");
    if (move.to === 7) drop("K");
    if (move.to === 56) drop("q");
    if (move.to === 63) drop("k");
  }

  const ep = type === "P" && Math.abs(move.to - move.from) === 16 ? (move.from + move.to) / 2 : null;
  const halfmove = type === "P" || captured ? 0 : state.halfmove + 1;

  return {
    board,
    turn: other(color),
    castling,
    ep,
    halfmove,
    fullmove: state.fullmove + (color === BLACK ? 1 : 0),
  };
}

export function legalMoves(state) {
  const color = state.turn;
  const out = [];
  for (const move of pseudoMoves(state, color)) {
    const next = applyMove(state, move);
    const king = kingSquare(next.board, color);
    if (king >= 0 && !isAttacked(next.board, king, other(color))) out.push(move);
  }
  return out;
}

export const movesFrom = (state, sq) => legalMoves(state).filter(m => m.from === sq);

export function toUci(move) {
  return squareName(move.from) + squareName(move.to) + (move.promotion ? move.promotion.toLowerCase() : "");
}

/** Encontra o lance legal correspondente a UCI ("e2e4") ou { from, to, promotion } (casas ou nomes). */
export function findMove(state, input) {
  if (typeof input === "string") {
    const text = input.trim();
    if (!/^[a-h][1-8][a-h][1-8][qrbnQRBN]?$/.test(text)) return null;
    input = { from: text.slice(0, 2), to: text.slice(2, 4), promotion: text[4] || null };
  }
  if (!input) return null;
  const from = typeof input.from === "string" ? parseSquare(input.from) : input.from;
  const to = typeof input.to === "string" ? parseSquare(input.to) : input.to;
  if (from < 0 || to < 0) return null;
  const promo = input.promotion ? typeOf(String(input.promotion)) : null;
  return legalMoves(state).find(m =>
    m.from === from && m.to === to && (promo ? typeOf(m.promotion || "") === promo : !m.promotion)
  ) || null;
}

/* ===================== NOTAÇÃO SAN ===================== */

export function san(state, move) {
  const piece = state.board[move.from];
  const type = typeOf(piece);
  let text;

  if (type === "K" && Math.abs(move.to - move.from) === 2) {
    text = move.to > move.from ? "O-O" : "O-O-O";
  } else if (type === "P") {
    const capture = !!state.board[move.to] || fileOf(move.from) !== fileOf(move.to);
    text = (capture ? FILES[fileOf(move.from)] + "x" : "") + squareName(move.to);
    if (move.promotion) text += "=" + typeOf(move.promotion);
  } else {
    const rivals = legalMoves(state).filter(m =>
      m.from !== move.from && m.to === move.to && typeOf(state.board[m.from]) === type
    );
    let disambiguation = "";
    if (rivals.length) {
      const sameFile = rivals.some(m => fileOf(m.from) === fileOf(move.from));
      const sameRank = rivals.some(m => rankOf(m.from) === rankOf(move.from));
      if (!sameFile) disambiguation = FILES[fileOf(move.from)];
      else if (!sameRank) disambiguation = String(rankOf(move.from) + 1);
      else disambiguation = squareName(move.from);
    }
    const capture = !!state.board[move.to];
    text = type + disambiguation + (capture ? "x" : "") + squareName(move.to);
  }

  const next = applyMove(state, move);
  if (inCheck(next)) text += legalMoves(next).length ? "+" : "#";
  return text;
}

/* ===================== FIM DE JOGO ===================== */

/** Chave da posição para repetição tripla (peças, vez, roque e en passant realmente possível). */
export function positionKey(state) {
  let ep = "-";
  if (state.ep !== null && epCaptureAvailable(state)) ep = squareName(state.ep);
  return `${boardFen(state.board)} ${state.turn} ${state.castling || "-"} ${ep}`;
}

function epCaptureAvailable(state) {
  if (state.ep === null) return false;
  const color = state.turn;
  const ep = state.ep;
  const fromRank = rankOf(ep) + (color === WHITE ? -1 : 1);
  if (fromRank < 0 || fromRank > 7) return false;
  const pawn = color === WHITE ? "P" : "p";
  for (const df of [-1, 1]) {
    const f = fileOf(ep) + df;
    if (f < 0 || f > 7) continue;
    const from = square(f, fromRank);
    if (state.board[from] !== pawn) continue;
    const next = applyMove(state, makeMove(state.board, from, ep, { enPassant: true, captured: pawn === "P" ? "p" : "P" }));
    const king = kingSquare(next.board, color);
    if (king >= 0 && !isAttacked(next.board, king, other(color))) return true;
  }
  return false;
}

export function insufficientMaterial(board) {
  const pieces = [];
  for (let i = 0; i < 64; i++) if (board[i]) pieces.push({ piece: board[i], sq: i });
  const minors = pieces.filter(x => typeOf(x.piece) !== "K");
  if (minors.length === 0) return true;
  if (minors.length === 1) {
    const t = typeOf(minors[0].piece);
    return t === "B" || t === "N";
  }
  if (minors.length === 2) {
    const [a, b] = minors;
    if (typeOf(a.piece) !== "B" || typeOf(b.piece) !== "B") return false;
    if (colorOf(a.piece) === colorOf(b.piece)) return false;
    return (fileOf(a.sq) + rankOf(a.sq)) % 2 === (fileOf(b.sq) + rankOf(b.sq)) % 2;
  }
  return false;
}

/**
 * O lado `color` ainda consegue dar mate com alguma sequência legal? (FIDE 6.9 — tempo esgotado.)
 * Com qualquer peça além do rei, o mate é possível com a ajuda do adversário; sozinho, só com
 * peão/torre/rainha, dois bispos de cores opostas, bispo+cavalo ou dois cavalos.
 */
export function canMate(board, color) {
  if (insufficientMaterial(board)) return false;
  const mine = [];
  let enemyMaterial = false;
  for (let i = 0; i < 64; i++) {
    const piece = board[i];
    if (!piece) continue;
    if (colorOf(piece) === color) {
      if (typeOf(piece) !== "K") mine.push({ type: typeOf(piece), sq: i });
    } else if (typeOf(piece) !== "K") enemyMaterial = true;
  }
  if (!mine.length) return false;
  if (mine.some(x => x.type === "P" || x.type === "R" || x.type === "Q")) return true;

  const bishops = mine.filter(x => x.type === "B");
  const knights = mine.filter(x => x.type === "N");
  if (bishops.length >= 2) {
    const colors = new Set(bishops.map(b => (fileOf(b.sq) + rankOf(b.sq)) % 2));
    if (colors.size >= 2) return true;
  }
  if (bishops.length && knights.length) return true;
  if (knights.length >= 2) return true;
  return enemyMaterial;
}

/** Quantas vezes a posição atual apareceu (a chave atual deve estar em `keys`). */
export function repetitions(state, keys = []) {
  const key = positionKey(state);
  const count = keys.filter(k => k === key).length;
  return count || 1;
}

/**
 * Resultado da partida.
 * `keys` = chaves de TODAS as posições já jogadas, incluindo a atual.
 * Retorna { over, winner: "w"|"b"|null, reason: "checkmate"|"stalemate"|"fifty"|"repetition"|"material"|null }.
 */
export function outcome(state, keys = []) {
  const moves = legalMoves(state);
  if (!moves.length) {
    return inCheck(state)
      ? { over: true, winner: other(state.turn), reason: "checkmate" }
      : { over: true, winner: null, reason: "stalemate" };
  }
  if (state.halfmove >= 100) return { over: true, winner: null, reason: "fifty" };
  if (repetitions(state, keys) >= 3) return { over: true, winner: null, reason: "repetition" };
  if (insufficientMaterial(state.board)) return { over: true, winner: null, reason: "material" };
  return { over: false, winner: null, reason: null };
}

/* ===================== PARTIDA ===================== */

export function newGame(fen = START_FEN) {
  const state = fromFen(fen);
  return {
    state,
    keys: [positionKey(state)],
    moves: [],
    last: null,
    result: outcome(state, [positionKey(state)]),
  };
}

/** Joga um lance (objeto legal ou { from, to, promotion }) e devolve a partida nova. */
export function playMove(game, input) {
  const move = input && input.piece ? input : findMove(game.state, input);
  if (!move) throw new Error("lance ilegal");
  const notation = san(game.state, move);
  const state = applyMove(game.state, move);
  const keys = [...game.keys, positionKey(state)];
  return {
    state,
    keys,
    moves: [...game.moves, { uci: toUci(move), san: notation }],
    last: move,
    result: outcome(state, keys),
  };
}

/** Desfaz o último lance? Não: a partida é imutável — guarde a versão anterior. */
export const RESULT_LABELS = {
  checkmate: "Xeque-mate",
  stalemate: "Afogamento",
  fifty: "Regra dos 50 lances",
  repetition: "Repetição tripla",
  material: "Material insuficiente",
  resign: "Desistência",
  timeout: "Tempo esgotado",
};
