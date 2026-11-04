/* Go (weigi) — regras completas do jogo milenar. Código puro (sem DOM, sem rede):
   roda igual no navegador, na Edge Function (Deno) e nos testes do Node.

   Tabuleiro: array de `size * size` posições, índice = row * size + col, com row 0 no TOPO.
   Pedras: 0 = vazio, 1 = pretas, 2 = brancas.

   Estado: {
     size, board, turn: "b"|"w", captures: { b, w }, ko: number|null, passes,
     handicap, komi, handicapColor: "b"|"w"|null
   }
   • `captures.b`/`captures.w` são as pedras capturadas POR aquela cor.
   • `ko` é a interseção proibida no lance seguinte (ko simples).
   • duas passadas seguidas encerram a partida; a contagem é a chinesa (pedras + território).

   Partida: { state, keys, moves, last, result } — `keys` guarda a chave de cada posição.

   Contrato do duelo 1×1: o Go é um jogo de TURNOS. `times` são os ritmos aceitos, em
   minutos POR JOGADOR; quem cria a sala escolhe um deles. O handicap é calculado pelo
   ranking (Kyu/Dan): o jogador mais fraco recebe pedras iniciais. */
export const BLACK = "b", WHITE = "w";
export const GAME_ID = "go";
export const SIZES = [9, 13, 19];

export const DUEL = { kind: "turn", times: [3, 10, 30, 60] };

export const EVEN_KOMI = 6.5;          // partida equilibrada: brancas recebem 6,5 pontos
export const HANDICAP_KOMI = 0.5;      // com handicap, o komi cai para 0,5 (quem tem pedras começa)
export const MAX_HANDICAP = 9;

const COLUMNS = "ABCDEFGHJKLMNOPQRST";  // sem o "I", como no Go tradicional
const other = color => (color === BLACK ? WHITE : BLACK);
export const opposite = other;
const isColor = color => color === BLACK || color === WHITE;
const stoneOf = color => (color === BLACK ? 1 : 2);
export const colorOf = value => (value === 1 ? BLACK : value === 2 ? WHITE : null);
export const inBoard = (size, col, row) => col >= 0 && row >= 0 && col < size && row < size;
export const pointOf = (size, col, row) => row * size + col;
export const colOf = (size, point) => point % size;
export const rowOf = (size, point) => Math.floor(point / size);

/* ===================== RANKING KYU / DAN ===================== */

/** Rating inicial de todo jogador: 1500 = 15 kyu. Cada 100 pontos de Elo equivalem a 1 grau. */
export const BASE_RATING = 1500;
export const BASE_LEVEL = 15;          // 0 = 30 kyu · 29 = 1 kyu · 30 = 1 dan · 38 = 9 dan
export const MAX_LEVEL = 38;

/** Grau numérico do rating (0..38): 0 = 30k, 29 = 1k, 30 = 1d, 38 = 9d.
    O arredondamento é para longe do zero (0,5 sobe), o mesmo do `go_rank_level` no Postgres. */
export const rankLevelFromRating = rating => {
  const raw = rating === null || rating === undefined || rating === "" ? NaN : Number(rating);
  const value = Number.isFinite(raw) ? raw : BASE_RATING;
  const steps = (value - BASE_RATING) / 100;
  const rounded = (steps < 0 ? -1 : 1) * Math.round(Math.abs(steps));
  return Math.max(0, Math.min(MAX_LEVEL, BASE_LEVEL + rounded));
};

/** Rótulo tradicional: "15 kyu", "1 kyu", "1 dan", "9 dan". */
export function rankLabel(rating) {
  const level = rankLevelFromRating(rating);
  return level <= 29 ? `${30 - level} kyu` : `${level - 29} dan`;
}

/** Versão curta para espaços pequenos: "15k", "1k", "1d", "9d". */
export function rankShort(rating) {
  const level = rankLevelFromRating(rating);
  return level <= 29 ? `${30 - level}k` : `${level - 29}d`;
}

/** Pedras de handicap pela diferença de graus, limitada a 9.
    Um grau de diferença ainda é partida equilibrada (0 pedras), como no `go_handicap` do Postgres. */
export const handicapFor = (ratingA, ratingB) => {
  const difference = Math.abs(rankLevelFromRating(ratingA) - rankLevelFromRating(ratingB));
  return difference < 2 ? 0 : Math.min(MAX_HANDICAP, difference);
};

/** Komi da partida: 6,5 equilibrada; 0,5 quando há pedras de handicap. */
export const komiFor = handicap => (Number(handicap) >= 2 ? HANDICAP_KOMI : EVEN_KOMI);

/* ===================== TABULEIRO / HANDICAP ===================== */

/** Coordenadas dos pontos de handicap, na ordem em que são entregues (2 a 9 pedras). */
export function handicapPoints(size) {
  if (!SIZES.includes(size)) throw new Error("tabuleiro inválido");
  const low = size === 19 ? 3 : size === 13 ? 3 : 2;
  const high = size - 1 - low;
  const mid = Math.floor(size / 2);
  return [
    pointOf(size, low, low), pointOf(size, high, high),
    pointOf(size, low, high), pointOf(size, high, low),
    pointOf(size, mid, mid),
    pointOf(size, low, mid), pointOf(size, high, mid),
    pointOf(size, mid, low), pointOf(size, mid, high),
  ];
}

export function starPoints(size) {
  if (!SIZES.includes(size)) return [];
  const low = size === 19 ? 3 : size === 13 ? 3 : 2;
  const high = size - 1 - low;
  const mid = Math.floor(size / 2);
  return [...new Set([
    pointOf(size, low, low), pointOf(size, high, low),
    pointOf(size, low, high), pointOf(size, high, high),
    pointOf(size, mid, mid),
    pointOf(size, low, mid), pointOf(size, high, mid),
    pointOf(size, mid, low), pointOf(size, mid, high),
  ])];
}

/** Estado inicial (tabuleiro vazio, ou com as pedras de handicap do lado mais fraco). */
export function startState({ size = 9, handicap = 0, handicapColor = BLACK, komi = null } = {}) {
  if (!SIZES.includes(Number(size))) throw new Error("tabuleiro inválido");
  const n = Number(size);
  let stones = Math.max(0, Math.min(MAX_HANDICAP, Math.floor(Number(handicap) || 0)));
  if (stones < 2) stones = 0;                        // 1 pedra não é handicap: é partida equilibrada
  if (!isColor(handicapColor)) handicapColor = BLACK;

  const board = new Array(n * n).fill(0);
  if (stones > 0) {
    for (const point of handicapPoints(n).slice(0, stones)) board[point] = stoneOf(handicapColor);
  }

  return {
    size: n,
    board,
    turn: stones > 0 ? handicapColor : BLACK,
    captures: { b: 0, w: 0 },
    ko: null,
    passes: 0,
    handicap: stones,
    komi: komi == null ? komiFor(stones) : Number(komi),
    handicapColor: stones > 0 ? handicapColor : null,
  };
}

/** Valida/normaliza um estado vindo do servidor (jsonb) ou de um teste. */
export function revive(raw) {
  if (!raw || typeof raw !== "object") throw new Error("estado inválido");
  const size = Number(raw.size);
  if (!SIZES.includes(size)) throw new Error("estado inválido: tamanho");
  const board = Array.isArray(raw.board) ? raw.board.map(v => (v === 1 || v === 2 ? v : 0)) : null;
  if (!board || board.length !== size * size) throw new Error("estado inválido: tabuleiro");
  const turn = raw.turn === WHITE ? WHITE : BLACK;
  const ko = Number.isInteger(raw.ko) && raw.ko >= 0 && raw.ko < size * size ? raw.ko : null;
  return {
    size,
    board,
    turn,
    captures: {
      b: Math.max(0, Math.floor(Number(raw.captures?.b) || 0)),
      w: Math.max(0, Math.floor(Number(raw.captures?.w) || 0)),
    },
    ko,
    passes: Math.max(0, Math.floor(Number(raw.passes) || 0)),
    handicap: Math.max(0, Math.min(MAX_HANDICAP, Math.floor(Number(raw.handicap) || 0))),
    komi: Number.isFinite(Number(raw.komi)) ? Number(raw.komi) : EVEN_KOMI,
    handicapColor: raw.handicapColor === BLACK || raw.handicapColor === WHITE ? raw.handicapColor : null,
  };
}

export const serialize = state => ({
  size: state.size,
  board: [...state.board],
  turn: state.turn,
  captures: { ...state.captures },
  ko: state.ko,
  passes: state.passes,
  handicap: state.handicap,
  komi: state.komi,
  handicapColor: state.handicapColor,
});

export const deserialize = revive;

/** Chave da posição (tabuleiro + vez) para o histórico/repetições. */
export const positionKey = state => `${state.size}:${state.board.join("")}:${state.turn}`;

/* ===================== COORDENADAS ===================== */

/** Nome da interseção no padrão do Go: coluna A-T (sem I) e linha contada de baixo. */
export function coordOf(size, point) {
  if (!Number.isInteger(point) || point < 0 || point >= size * size) return "";
  const col = colOf(size, point), row = rowOf(size, point);
  return `${COLUMNS[Math.min(col, COLUMNS.length - 1)]}${size - row}`;
}

export function parseCoord(size, text) {
  const value = String(text ?? "").trim().toUpperCase();
  const match = value.match(/^([A-HJ-T])\s*(\d{1,2})$/);
  if (!match) return -1;
  const col = COLUMNS.indexOf(match[1]);
  const row = size - Number(match[2]);
  return inBoard(size, col, row) ? pointOf(size, col, row) : -1;
}

/* ===================== GRUPOS / LANCES ===================== */

const NEIGHBORS = (size, point) => {
  const col = colOf(size, point), row = rowOf(size, point);
  const out = [];
  if (col > 0) out.push(point - 1);
  if (col < size - 1) out.push(point + 1);
  if (row > 0) out.push(point - size);
  if (row < size - 1) out.push(point + size);
  return out;
};

/** Grupo de mesma cor que contém `point` e suas liberdades. */
export function groupAt(board, size, point) {
  const color = board[point];
  if (!color) return { stones: [], liberties: new Set() };
  const stones = [], liberties = new Set(), seen = new Set([point]), stack = [point];
  while (stack.length) {
    const current = stack.pop();
    stones.push(current);
    for (const next of NEIGHBORS(size, current)) {
      if (board[next] === 0) liberties.add(next);
      else if (board[next] === color && !seen.has(next)) { seen.add(next); stack.push(next); }
    }
  }
  return { stones, liberties };
}

/** O lance é legal? (vazio, fora do ko, sem suicídio) */
export function isLegal(state, point) {
  if (!Number.isInteger(point) || point < 0 || point >= state.board.length) return false;
  if (state.board[point] !== 0 || state.ko === point) return false;
  const board = state.board.slice();
  const me = stoneOf(state.turn);
  board[point] = me;
  let captured = 0;
  for (const next of NEIGHBORS(state.size, point)) {
    if (board[next] !== 0 && board[next] !== me) {
      const group = groupAt(board, state.size, next);
      if (!group.liberties.size) captured += group.stones.length;
    }
  }
  if (captured) {
    for (const next of NEIGHBORS(state.size, point)) {
      if (board[next] !== 0 && board[next] !== me) {
        const group = groupAt(board, state.size, next);
        if (!group.liberties.size) for (const stone of group.stones) board[stone] = 0;
      }
    }
  }
  return groupAt(board, state.size, point).liberties.size > 0;
}

/** Joga uma pedra. Devolve { state, captureCount } ou null se o lance for ilegal. */
export function playStone(state, point) {
  if (!isLegal(state, point)) return null;
  const size = state.size;
  const me = stoneOf(state.turn), enemy = stoneOf(other(state.turn));
  const board = state.board.slice();
  board[point] = me;

  const captured = [];
  for (const next of NEIGHBORS(size, point)) {
    if (board[next] !== enemy) continue;
    const group = groupAt(board, size, next);
    if (group.liberties.size) continue;
    for (const stone of group.stones) {
      if (board[stone] === enemy) { board[stone] = 0; captured.push(stone); }
    }
  }

  let ko = null;
  if (captured.length === 1) {
    const own = groupAt(board, size, point);
    if (own.stones.length === 1 && own.liberties.size === 1) ko = captured[0];
  }

  return {
    state: {
      ...state,
      board,
      turn: other(state.turn),
      captures: {
        ...state.captures,
        [state.turn]: state.captures[state.turn] + captured.length,
      },
      ko,
      passes: 0,
    },
    captureCount: captured.length,
    captured,
  };
}

/** Passa a vez. Duas passadas seguidas encerram a partida. */
export function pass(state) {
  return {
    ...state,
    turn: other(state.turn),
    ko: null,
    passes: state.passes + 1,
  };
}

/* ===================== CONTAGEM (AREA CHINESA) ===================== */

/** Pedras + territórios cercados + komi. */
export function score(state) {
  const size = state.size, board = state.board;
  let black = 0, white = 0;
  const seen = new Set();

  for (let point = 0; point < board.length; point++) {
    if (board[point] === 1) { black++; continue; }
    if (board[point] === 2) { white++; continue; }
    if (seen.has(point)) continue;

    const region = [], border = new Set(), stack = [point];
    seen.add(point);
    while (stack.length) {
      const current = stack.pop();
      region.push(current);
      for (const next of NEIGHBORS(size, current)) {
        if (board[next] === 0) {
          if (!seen.has(next)) { seen.add(next); stack.push(next); }
        } else {
          border.add(board[next]);
        }
      }
    }
    if (border.size === 1 && border.has(1)) black += region.length;
    else if (border.size === 1 && border.has(2)) white += region.length;
  }

  const komi = Number(state.komi) || 0;
  white += komi;
  return { black, white, komi, winner: black > white ? BLACK : WHITE };
}

/** Resultado da partida (só termina depois de duas passadas). */
export function outcome(state, keys = []) {
  void keys;
  if (state.passes < 2) return { over: false, winner: null, reason: null, score: null };
  const result = score(state);
  return { over: true, winner: result.winner, reason: "score", score: result };
}

/* ===================== PARTIDA ===================== */

export function newGame(options = {}) {
  const state = startState(options);
  return {
    state,
    keys: [positionKey(state)],
    moves: [],
    last: null,
    result: outcome(state),
  };
}

/** Registro do lance para o histórico e para o servidor. */
export function moveRecord(state, move, captureCount = 0) {
  if (move.type === "pass") {
    return { type: "pass", color: state.turn, point: null, coord: null, captures: 0, text: "pass" };
  }
  const coord = coordOf(state.size, move.point);
  return {
    type: "play",
    color: state.turn,
    point: move.point,
    coord,
    captures: captureCount,
    text: coord + (captureCount ? `×${captureCount}` : ""),
  };
}

/** Encontra o lance correspondente à entrada do cliente: { point } / { type: "pass" } / coordenada. */
export function findMove(state, input) {
  if (input == null) return null;
  if (typeof input === "string") {
    const text = input.trim().toLowerCase();
    if (text === "pass" || text === "passar") return { type: "pass" };
    const point = parseCoord(state.size, input);
    return point >= 0 && isLegal(state, point) ? { type: "play", point } : null;
  }
  if (typeof input === "number") {
    return Number.isInteger(input) && isLegal(state, input) ? { type: "play", point: input } : null;
  }
  if (typeof input === "object") {
    if (input.type === "pass" || input.pass === true) return { type: "pass" };
    const point = Number.isInteger(input.point) ? input.point
      : typeof input.coord === "string" ? parseCoord(state.size, input.coord)
        : Number.isInteger(input.from) && Number.isInteger(input.to) ? input.to
          : -1;
    return point >= 0 && isLegal(state, point) ? { type: "play", point } : null;
  }
  return null;
}

/** Joga um lance (objeto legal, número ou coordenada) e devolve a partida nova. */
export function playMove(game, input) {
  const move = input && (input.type === "pass" || input.type === "play") ? input : findMove(game.state, input);
  if (!move) throw new Error("lance ilegal");

  if (move.type === "pass") {
    const state = pass(game.state);
    const key = positionKey(state);
    const keys = [...game.keys, key];
    return {
      state,
      keys,
      moves: [...game.moves, moveRecord(game.state, move)],
      last: moveRecord(game.state, move),
      result: outcome(state, keys),
    };
  }

  const played = playStone(game.state, move.point);
  if (!played) throw new Error("lance ilegal");
  const key = positionKey(played.state);
  const keys = [...game.keys, key];
  const record = moveRecord(game.state, move, played.captureCount);
  return {
    state: played.state,
    keys,
    moves: [...game.moves, record],
    last: record,
    result: outcome(played.state, keys),
  };
}

export const RESULT_LABELS = {
  score: "Contagem de território",
  resign: "Desistência",
  timeout: "Tempo esgotado",
};
