/* Onitama — regras completas. Código puro (sem DOM, sem rede, sem Math.random/Date.now):
   roda igual no navegador, na Edge Function (Deno) e nos testes do Node.

   Tabuleiro 5×5: array de 25 posições, índice = rank * 5 + file, rank 0 = 1ª fileira (a1 = canto
   inferior esquerdo). Azul ("b") começa embaixo e avança para rank 4; Vermelho ("r") começa em cima.
   Peças: maiúsculas = azuis (M = mestre, S = aluno), minúsculas = vermelhas (m, s), null = vazio.
   O TEMPLO de cada lado é a casa central da própria fileira de trás (c1 para o azul, c5 para o vermelho).

   Estado: { board, turn: "b"|"r", cards: { b: [id, id], r: [id, id], side: id } }

   Partida: { state, keys, moves, last, result } — `keys` guarda a chave de cada posição
   (repetição tripla) e `moves` o histórico.

   Regras:
   • 5 cartas sorteadas entre as 16 do jogo base: 2 para cada jogador e 1 ao lado;
   • no seu turno o jogador usa UMA das suas 2 cartas para mover UMA peça; o padrão da carta é
     visto de frente por quem joga (para o vermelho ele vem espelhado);
   • pode capturar caindo em peça adversária; não pode cair em peça própria nem sair do tabuleiro;
   • a carta usada vai para o lado e o jogador pega a que estava lá (no mesmo lugar da mão);
   • vence quem captura o mestre adversário ("stone", Caminho da Pedra) ou leva o próprio mestre
     ao templo adversário ("stream", Caminho do Rio);
   • sem nenhum lance legal o jogador é obrigado a passar: troca uma das cartas com a do lado;
   • quem começa é definido pela cor da carta do lado;
   • empate por repetição tripla (regra do site; o jogo de mesa não tem empate). */

export const BLUE = "b", RED = "r";

/* Contrato do duelo 1×1: o Onitama é um jogo de TURNOS. `times` são os ritmos aceitos,
   em minutos POR JOGADOR; quem cria a sala escolhe um deles. */
export const DUEL = { kind: "turn", times: [2, 5, 10, 15] };

export const SIZE = 5;
export const FILES = "abcde";
export const START_POSITION = "ssmss/...../...../...../SSMSS";

/* Cartas do jogo base. `moves` = [dx, dy] do ponto de vista de quem joga: dx > 0 é a direita
   e dy > 0 é para a frente. `stamp` é a cor do selo (quem começa quando a carta fica ao lado). */
export const CARDS = {
  tiger:    { name: "Tigre",         stamp: "r", moves: [[0, 2], [0, -1]] },
  dragon:   { name: "Dragão",        stamp: "r", moves: [[-2, 1], [2, 1], [-1, -1], [1, -1]] },
  frog:     { name: "Sapo",          stamp: "r", moves: [[-2, 0], [-1, 1], [1, -1]] },
  rabbit:   { name: "Coelho",        stamp: "b", moves: [[2, 0], [1, 1], [-1, -1]] },
  crab:     { name: "Caranguejo",    stamp: "r", moves: [[-2, 0], [0, 1], [2, 0]] },
  elephant: { name: "Elefante",      stamp: "r", moves: [[-1, 0], [-1, 1], [1, 0], [1, 1]] },
  goose:    { name: "Ganso",         stamp: "b", moves: [[-1, 1], [-1, 0], [1, 0], [1, -1]] },
  rooster:  { name: "Galo",          stamp: "r", moves: [[1, 1], [1, 0], [-1, 0], [-1, -1]] },
  monkey:   { name: "Macaco",        stamp: "b", moves: [[-1, 1], [1, 1], [-1, -1], [1, -1]] },
  mantis:   { name: "Louva-a-deus",  stamp: "r", moves: [[-1, 1], [1, 1], [0, -1]] },
  horse:    { name: "Cavalo",        stamp: "r", moves: [[0, 1], [-1, 0], [0, -1]] },
  ox:       { name: "Boi",           stamp: "b", moves: [[0, 1], [1, 0], [0, -1]] },
  crane:    { name: "Garça",         stamp: "b", moves: [[0, 1], [-1, -1], [1, -1]] },
  boar:     { name: "Javali",        stamp: "b", moves: [[0, 1], [-1, 0], [1, 0]] },
  eel:      { name: "Enguia",        stamp: "b", moves: [[-1, 1], [-1, -1], [1, 0]] },
  cobra:    { name: "Cobra",         stamp: "b", moves: [[-1, 0], [1, 1], [1, -1]] },
};
export const CARD_IDS = Object.keys(CARDS);

const fileOf = sq => sq % SIZE;
const rankOf = sq => Math.floor(sq / SIZE);
const other = c => (c === BLUE ? RED : BLUE);
export const opposite = other;
const inBoard = (f, r) => f >= 0 && f < SIZE && r >= 0 && r < SIZE;

export const square = (file, rank) => rank * SIZE + file;
export const squareName = sq => FILES[fileOf(sq)] + (rankOf(sq) + 1);
export function parseSquare(name) {
  if (typeof name !== "string" || name.length !== 2) return -1;
  const f = FILES.indexOf(name[0].toLowerCase());
  const r = Number(name[1]) - 1;
  return f < 0 || !(r >= 0 && r < SIZE) ? -1 : square(f, r);
}

const isBluePiece = p => p === "M" || p === "S";
const isRedPiece = p => p === "m" || p === "s";
export const isPiece = p => isBluePiece(p) || isRedPiece(p);
export const colorOf = p => (isBluePiece(p) ? BLUE : isRedPiece(p) ? RED : null);
export const isMaster = p => p === "M" || p === "m";

/** Casa do templo de cada lado (onde o mestre ADVERSÁRIO precisa chegar). */
export const TEMPLE = { b: square(2, 0), r: square(2, SIZE - 1) };

/** Deslocamentos de uma carta no tabuleiro para o jogador `color` (vermelho = espelhado). */
export function offsets(cardId, color) {
  const card = CARDS[cardId];
  if (!card) throw new Error("carta inválida");
  const sign = color === BLUE ? 1 : -1;
  return card.moves.map(([dx, dy]) => [dx * sign + 0, dy * sign + 0]); // + 0 evita o -0
}

/* ===================== SORTEIO ===================== */

/** Sorteia as 5 cartas da partida com o `rng` recebido (determinístico para a mesma seed). */
export function dealCards(rng) {
  if (typeof rng !== "function") throw new Error("rng obrigatório");
  const deck = CARD_IDS.slice();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const [a, b, c, d, side] = deck;
  return { b: [a, b], r: [c, d], side };
}

/* ===================== POSIÇÃO ===================== */

const parseHand = text => {
  const ids = String(text).split(",");
  if (ids.length !== 2 || !ids.every(id => CARDS[id])) throw new Error("posição inválida: cartas");
  return ids;
};

/**
 * Texto da posição: `<tabuleiro> <vez> <mão azul> <mão vermelha> <carta do lado>`,
 * ex.: `ssmss/...../...../...../SSMSS b tiger,dragon frog,rabbit crab`.
 */
export function toPosition(state) {
  const rows = [];
  for (let r = SIZE - 1; r >= 0; r--) {
    let row = "";
    for (let f = 0; f < SIZE; f++) row += state.board[square(f, r)] ?? ".";
    rows.push(row);
  }
  const { b, r, side } = state.cards;
  return `${rows.join("/")} ${state.turn} ${b.join(",")} ${r.join(",")} ${side}`;
}

/** Lê o texto da posição e valida tudo (peças, vez e as 5 cartas distintas). */
export function fromPosition(text) {
  const parts = String(text).trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("posição inválida: campos");
  const [rowsText, turn, blue, red, side] = parts;
  if (turn !== BLUE && turn !== RED) throw new Error("posição inválida: vez");

  const rows = rowsText.split("/");
  if (rows.length !== SIZE) throw new Error("posição inválida: fileiras");
  const board = new Array(SIZE * SIZE).fill(null);
  rows.forEach((row, i) => {
    if (row.length !== SIZE) throw new Error("posição inválida: fileira incompleta");
    for (let f = 0; f < SIZE; f++) {
      const ch = row[f];
      if (ch === ".") continue;
      if (!isPiece(ch)) throw new Error("posição inválida: peça");
      board[square(f, SIZE - 1 - i)] = ch;
    }
  });
  const count = p => board.filter(x => x === p).length;
  if (count("M") > 1 || count("m") > 1) throw new Error("posição inválida: mestre");

  const cards = { b: parseHand(blue), r: parseHand(red), side };
  if (!CARDS[side]) throw new Error("posição inválida: carta do lado");
  if (new Set([...cards.b, ...cards.r, side]).size !== 5) throw new Error("posição inválida: cartas repetidas");
  return { board, turn, cards };
}

/** Posição inicial a partir das cartas sorteadas; começa quem tem o selo da carta do lado. */
export function initial(cards) {
  const state = fromPosition(`${START_POSITION} ${CARDS[cards.side]?.stamp ?? "b"} ${cards.b.join(",")} ${cards.r.join(",")} ${cards.side}`);
  return state;
}

/** Chave da posição para repetição tripla: tabuleiro, vez, cartas (a ordem na mão não conta). */
export const positionKey = state => {
  const hand = h => [...h].sort().join(",");
  const rows = toPosition(state).split(" ")[0];
  return `${rows} ${state.turn} ${hand(state.cards.b)} ${hand(state.cards.r)} ${state.cards.side}`;
};

/* ===================== LANCES ===================== */

/** Todos os lances legais da vez. Sem nenhum lance de peça, só restam as passadas (troca de carta). */
export function legalMoves(state) {
  const color = state.turn;
  const hand = state.cards[color];
  const out = [];
  for (let from = 0; from < SIZE * SIZE; from++) {
    const piece = state.board[from];
    if (!piece || colorOf(piece) !== color) continue;
    const f = fileOf(from), r = rankOf(from);
    hand.forEach((card, slot) => {
      for (const [dx, dy] of offsets(card, color)) {
        const nf = f + dx, nr = r + dy;
        if (!inBoard(nf, nr)) continue;
        const to = square(nf, nr);
        const target = state.board[to];
        if (target && colorOf(target) === color) continue;
        out.push({ from, to, card, slot, piece, captured: target ?? null, pass: false });
      }
    });
  }
  if (out.length) return out;
  return hand.map((card, slot) => ({ from: null, to: null, card, slot, piece: null, captured: null, pass: true }));
}

export const movesFrom = (state, sq) => legalMoves(state).filter(m => m.from === sq);
export const movesWith = (state, card) => legalMoves(state).filter(m => m.card === card);

/** Aplica um lance já validado e devolve o novo estado (imutável). */
export function applyMove(state, move) {
  const color = state.turn;
  const hand = state.cards[color];
  const slot = hand.indexOf(move.card);
  if (slot < 0) throw new Error("carta fora da mão");

  const board = state.board.slice();
  if (!move.pass) {
    const piece = board[move.from];
    if (!piece || colorOf(piece) !== color) throw new Error("lance sem peça");
    board[move.from] = null;
    board[move.to] = piece;
  }

  const newHand = hand.slice();
  newHand[slot] = state.cards.side;
  const cards = { ...state.cards, [color]: newHand, side: move.card };
  return { board, turn: other(color), cards };
}

/* ===================== NOTAÇÃO ===================== */

/** Registro curto do lance, do jeito que o servidor e o histórico guardam. */
export const moveRecord = move => ({
  from: move.pass ? null : squareName(move.from),
  to: move.pass ? null : squareName(move.to),
  card: move.card,
  captured: !!move.captured,
  pass: !!move.pass,
});

/** Texto legível: "c1–c3 Tigre", "c1×c3 Tigre" ou "passa (Tigre)". */
export function moveText(move) {
  const r = move.from !== undefined && typeof move.from === "number" ? moveRecord(move) : move;
  const name = CARDS[r.card]?.name ?? r.card;
  return r.pass ? `passa (${name})` : `${r.from}${r.captured ? "×" : "–"}${r.to} ${name}`;
}

const sq = v => (typeof v === "string" ? parseSquare(v) : v);

/** Encontra o lance legal correspondente a `{ from, to, card }` ou `{ pass: true, card }`. */
export function findMove(state, input) {
  if (!input || typeof input !== "object" || typeof input.card !== "string") return null;
  const moves = legalMoves(state);
  if (input.pass) return moves.find(m => m.pass && m.card === input.card) || null;
  const from = sq(input.from), to = sq(input.to);
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
  return moves.find(m => !m.pass && m.from === from && m.to === to && m.card === input.card) || null;
}

/* ===================== FIM DE JOGO ===================== */

/** Quantas vezes a posição atual apareceu (a chave atual deve estar em `keys`). */
export function repetitions(state, keys = []) {
  const key = positionKey(state);
  return keys.filter(k => k === key).length || 1;
}

/**
 * Resultado da partida. `keys` = chaves de TODAS as posições já jogadas, incluindo a atual.
 * Retorna { over, winner: "b"|"r"|null, reason: "stone"|"stream"|"repetition"|null }.
 */
export function outcome(state, keys = []) {
  const blueMaster = state.board.indexOf("M");
  const redMaster = state.board.indexOf("m");
  if (redMaster < 0) return { over: true, winner: BLUE, reason: "stone" };
  if (blueMaster < 0) return { over: true, winner: RED, reason: "stone" };
  if (blueMaster === TEMPLE.r) return { over: true, winner: BLUE, reason: "stream" };
  if (redMaster === TEMPLE.b) return { over: true, winner: RED, reason: "stream" };
  if (repetitions(state, keys) >= 3) return { over: true, winner: null, reason: "repetition" };
  return { over: false, winner: null, reason: null };
}

/* ===================== PARTIDA ===================== */

/** Partida nova. `cards` vem de `dealCards(rng)` — no servidor, de uma seed. */
export function newGame(cards) {
  const state = initial(cards);
  const key = positionKey(state);
  return { state, keys: [key], moves: [], last: null, result: outcome(state, [key]) };
}

/** Joga um lance (objeto legal ou `{ from, to, card }`) e devolve a partida nova. */
export function playMove(game, input) {
  const move = findMove(game.state, input);
  if (!move) throw new Error("lance ilegal");
  const state = applyMove(game.state, move);
  const key = positionKey(state);
  const keys = [...game.keys, key];
  const record = moveRecord(move);
  return {
    state,
    keys,
    moves: [...game.moves, record],
    last: record,
    result: outcome(state, keys),
  };
}

export const RESULT_LABELS = {
  stone: "Caminho da Pedra",
  stream: "Caminho do Rio",
  repetition: "Repetição tripla",
  resign: "Desistência",
  timeout: "Tempo esgotado",
};
