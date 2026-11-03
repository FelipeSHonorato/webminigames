/* Gamão (backgammon) — regras completas. Código puro (sem DOM, sem rede): roda igual no
   navegador, na Edge Function (Deno) e nos testes do Node.

   Tabuleiro: 24 pontos. `points[p]` (1..24) guarda o número COM SINAL de peças:
   positivo = claras (brancas), negativo = escuras (pretas), 0 = vazio.
   As brancas andam 24 → 1 e têm a casa em 1..6; as pretas andam 1 → 24 e têm a casa em 19..24.
   A barra é representada por `bar.w`/`bar.b` e as peças fora do tabuleiro por `off.w`/`off.b`.

   Estado: { game, points, bar, off, turn, dice, roll, awaitingRoll, turnNo }
   • `dice` são os dados AINDA disponíveis (dobres viram quatro dados);
   • `roll` guarda os dois dados originais do turno (só para exibir);
   • `awaitingRoll` é true quando o turno trocou e o próximo jogador precisa rolar.

   Partida: { state, keys, moves, last, result }.

   Regras implementadas:
   • abertura: cada jogador rola um dado; quem tira o maior começa usando os dois dados;
   • dados dobres valem quatro jogadas;
   • é obrigatório usar o máximo de dados possível; com dois números diferentes e só um jogável,
     vale o maior; dobres usam o máximo de quarteto possível;
   • quem tem peça na barra só pode entrar (brancas em 25 − dado, pretas no dado);
   • um ponto com duas ou mais peças adversárias está bloqueado;
   • bater uma peça adversária isolada manda ela para a barra;
   • só se tira peça quando todas as 15 estão na casa e a barra está vazia;
   • um dado maior que a distância só tira peça do ponto mais alto (brancas) / mais baixo (pretas);
   • vence quem tirar as 15 peças primeiro. */

export const WHITE = "w", BLACK = "b";
export const CHECKERS = 15;
export const GAME_ID = "gamao";

/* Contrato do duelo 1×1: gamão é um jogo de TURNOS. `times` são os ritmos aceitos, em minutos
   POR JOGADOR; quem cria a sala escolhe um deles. */
export const DUEL = { kind: "turn", times: [3, 10, 30, 60] };

/* Pontos 1..24 na posição inicial. Índice 0 não é usado. */
export const START_POINTS = Object.freeze([
  0,
  -2, 0, 0, 0, 0, 5, 0, 3, 0, 0, 0, -5,
  5, 0, 0, 0, -3, 0, -5, 0, 0, 0, 0, 2,
]);

export const START_POSITION = START_POINTS.join(",");

export const opposite = color => (color === WHITE ? BLACK : WHITE);
const other = opposite;

const isColor = color => color === WHITE || color === BLACK;
const isDie = n => Number.isInteger(n) && n >= 1 && n <= 6;

export const colorOf = n => (n > 0 ? WHITE : n < 0 ? BLACK : null);
const countAt = (state, color, point) => {
  const n = state.points[point] ?? 0;
  return color === WHITE ? Math.max(0, n) : Math.max(0, -n);
};
const isBlocked = (state, color, point) => {
  const n = state.points[point] ?? 0;
  return color === WHITE ? n <= -2 : n >= 2;
};
const inPoint = point => Number.isInteger(point) && point >= 1 && point <= 24;

/* ===================== POSIÇÃO / SERIALIZAÇÃO ===================== */

const freshPoints = () => START_POINTS.slice();

export function initial() {
  return {
    game: GAME_ID,
    points: freshPoints(),
    bar: { [WHITE]: 0, [BLACK]: 0 },
    off: { [WHITE]: 0, [BLACK]: 0 },
    turn: WHITE,
    dice: [],
    roll: [],
    awaitingRoll: true,
    turnNo: 1,
  };
}

/** Estado pronto para JSON (é o que a Edge grava em `gamao_games.state`). */
export function serialize(state) {
  return {
    game: GAME_ID,
    points: state.points.slice(),
    bar: { [WHITE]: state.bar[WHITE], [BLACK]: state.bar[BLACK] },
    off: { [WHITE]: state.off[WHITE], [BLACK]: state.off[BLACK] },
    turn: state.turn,
    dice: state.dice.slice(),
    roll: state.roll.slice(),
    awaitingRoll: Boolean(state.awaitingRoll),
    turnNo: state.turnNo,
  };
}

/** Reconstrói e valida o estado vindo do banco. */
export function revive(data) {
  const src = typeof data === "string" ? JSON.parse(data) : data;
  if (!src || typeof src !== "object") throw new Error("estado inválido");
  if (src.game !== undefined && src.game !== GAME_ID) throw new Error("estado de outro jogo");
  if (!Array.isArray(src.points) || src.points.length !== 25) throw new Error("pontos inválidos");
  const points = src.points.map((n, i) => {
    if (i === 0) return 0;
    if (!Number.isInteger(n) || Math.abs(n) > CHECKERS) throw new Error("ponto inválido");
    return n;
  });
  const pair = obj => {
    const v = obj && typeof obj === "object" ? obj : {};
    const w = v[WHITE] ?? 0, b = v[BLACK] ?? 0;
    if (!Number.isInteger(w) || !Number.isInteger(b) || w < 0 || b < 0 || w > CHECKERS || b > CHECKERS) {
      throw new Error("contagem inválida");
    }
    return { [WHITE]: w, [BLACK]: b };
  };
  const bar = pair(src.bar);
  const off = pair(src.off);
  if (!isColor(src.turn)) throw new Error("vez inválida");
  const dice = Array.isArray(src.dice) ? src.dice.slice() : [];
  if (!dice.every(isDie) || dice.length > 4) throw new Error("dados inválidos");
  const roll = Array.isArray(src.roll) ? src.roll.slice() : [];
  if (!roll.every(isDie) || (roll.length !== 0 && roll.length !== 2)) throw new Error("dados inválidos");
  const turnNo = Number.isInteger(src.turnNo) && src.turnNo >= 1 ? src.turnNo : 1;

  const whiteOnBoard = points.reduce((n, v) => n + Math.max(0, v), 0);
  const blackOnBoard = points.reduce((n, v) => n + Math.max(0, -v), 0);
  if (whiteOnBoard + bar[WHITE] + off[WHITE] > CHECKERS) throw new Error("peças claras demais");
  if (blackOnBoard + bar[BLACK] + off[BLACK] > CHECKERS) throw new Error("peças escuras demais");

  return {
    game: GAME_ID, points, bar, off, turn: src.turn, dice, roll,
    awaitingRoll: Boolean(src.awaitingRoll), turnNo,
  };
}

export const deserialize = revive;

/** Chave da posição (útil para histórico/depuração; o gamão não empata por repetição tripla). */
export const positionKey = state => JSON.stringify({
  p: state.points,
  bar: state.bar,
  off: state.off,
  turn: state.turn,
  dice: state.dice,
  awaitingRoll: Boolean(state.awaitingRoll),
});

/* ===================== ABERTURA ===================== */

/** Resultado da rolagem de abertura: dado de cada lado. Empate pede nova rolagem. */
export function openingRoll(whiteDie, blackDie) {
  if (!isDie(whiteDie) || !isDie(blackDie)) throw new Error("dado inválido");
  if (whiteDie === blackDie) return { tie: true, turn: null, dice: [] };
  return {
    tie: false,
    turn: whiteDie > blackDie ? WHITE : BLACK,
    dice: [Math.max(whiteDie, blackDie), Math.min(whiteDie, blackDie)],
  };
}

const dieFrom = rng => 1 + Math.min(5, Math.floor(rng() * 6));

/** Sorteia a abertura (repete enquanto empatar). `rng` é injetado: nada de Math.random aqui. */
export function rollOpening(rng) {
  if (typeof rng !== "function") throw new Error("rng inválido");
  for (let i = 0; i < 100; i++) {
    const w = dieFrom(rng), b = dieFrom(rng);
    if (w !== b) return { w, b, ...openingRoll(w, b) };
  }
  return { w: 6, b: 5, ...openingRoll(6, 5) };
}

/** Partida nova, já com a abertura resolvida. `open` = { w, b } (dado de cada lado). */
export function newGame(open = { w: 6, b: 5 }) {
  const w = Number(open?.w), b = Number(open?.b);
  if (!isDie(w) || !isDie(b)) throw new Error("abertura inválida");
  if (w === b) throw new Error("abertura empatada");
  const result = openingRoll(w, b);
  const state = {
    game: GAME_ID,
    points: freshPoints(),
    bar: { [WHITE]: 0, [BLACK]: 0 },
    off: { [WHITE]: 0, [BLACK]: 0 },
    turn: result.turn,
    dice: result.dice.slice(),
    roll: result.dice.slice(),
    awaitingRoll: false,
    turnNo: 1,
  };
  const key = positionKey(state);
  return { state, keys: [key], moves: [], last: null, result: outcome(state) };
}

/* ===================== LANCES ===================== */

const makeMove = (state, color, from, to, die, fromBar, toOff) => ({
  from,
  to,
  die,
  color,
  fromBar: Boolean(fromBar),
  toOff: Boolean(toOff),
  hit: !toOff && countAt(state, other(color), to) === 1,
});

/** Todas as jogadas de UM dado, sem exigir o máximo do turno. */
function rawMovesForDie(state, color, die) {
  const out = [];
  const bar = state.bar[color];

  if (bar > 0) {
    const to = color === WHITE ? 25 - die : die;
    if (inPoint(to) && !isBlocked(state, color, to)) {
      out.push(makeMove(state, color, color === WHITE ? 25 : 0, to, die, true, false));
    }
    return out;
  }

  for (let from = 1; from <= 24; from++) {
    if (countAt(state, color, from) === 0) continue;
    const to = color === WHITE ? from - die : from + die;

    if (inPoint(to)) {
      if (isBlocked(state, color, to)) continue;
      out.push(makeMove(state, color, from, to, die, false, false));
      continue;
    }

    /* Fora do tabuleiro: só pode ser tirada com todas as peças na casa. */
    if (!canBearOff(state, color)) continue;
    if (color === WHITE && to > 0) continue;              // brancas só saem em 0 ou abaixo
    if (color === BLACK && to < 25) continue;             // pretas só saem em 25 ou acima
    if (color === WHITE && to < 0 && hasCheckerAbove(state, WHITE, from)) continue;
    if (color === BLACK && to > 25 && hasCheckerBelow(state, BLACK, from)) continue;
    out.push(makeMove(state, color, from, color === WHITE ? 0 : 25, die, false, true));
  }
  return out;
}

const hasCheckerAbove = (state, color, point) => {
  for (let p = point + 1; p <= 24; p++) if (countAt(state, color, p) > 0) return true;
  return false;
};
const hasCheckerBelow = (state, color, point) => {
  for (let p = 1; p < point; p++) if (countAt(state, color, p) > 0) return true;
  return false;
};

/** Todas as 15 peças estão na casa e a barra está vazia? */
export function canBearOff(state, color) {
  if (state.bar[color] !== 0) return false;
  if (color === WHITE) {
    for (let p = 7; p <= 24; p++) if (countAt(state, WHITE, p) > 0) return false;
    return true;
  }
  for (let p = 1; p <= 18; p++) if (countAt(state, BLACK, p) > 0) return false;
  return true;
}

/** Aplica UMA jogada (um dado), sem trocar a vez. Estado imutável. */
export function applyMove(state, move) {
  if (!move || !isColor(move.color) || move.color !== state.turn) throw new Error("lance fora da vez");
  if (!isDie(move.die)) throw new Error("dado inválido");
  if (!state.dice.includes(move.die)) throw new Error("dado indisponível");

  const color = move.color;
  const points = state.points.slice();
  const bar = { ...state.bar };
  const off = { ...state.off };

  if (move.fromBar) {
    if (bar[color] <= 0) throw new Error("barra vazia");
    bar[color]--;
  } else {
    if (!inPoint(move.from) || countAt(state, color, move.from) === 0) throw new Error("lance sem peça");
    points[move.from] += color === WHITE ? -1 : 1;
  }

  if (move.toOff) {
    if (!canBearOff(state, color)) throw new Error("ainda não pode tirar peça");
    off[color]++;
  } else {
    if (!inPoint(move.to)) throw new Error("destino inválido");
    if (move.hit) {
      if (countAt(state, other(color), move.to) !== 1) throw new Error("não há peça para bater");
      points[move.to] = 0;
      bar[other(color)]++;
    }
    points[move.to] += color === WHITE ? 1 : -1;
  }

  const dice = state.dice.slice();
  dice.splice(dice.indexOf(move.die), 1);

  return { ...state, points, bar, off, dice };
}

/** Quantos dados ainda dá para jogar (0..dice.length), respeitando barra e bloqueios. */
export function maxMoves(state) {
  const memo = new Map();
  const walk = current => {
    if (!current.dice.length) return 0;
    const key = positionKey(current);
    if (memo.has(key)) return memo.get(key);
    let best = 0;
    const values = [...new Set(current.dice)];
    for (const die of values) {
      for (const move of rawMovesForDie(current, current.turn, die)) {
        const next = applyMove(current, move);
        best = Math.max(best, 1 + walk(next));
        if (best === current.dice.length) break;
      }
      if (best === current.dice.length) break;
    }
    memo.set(key, best);
    return best;
  };
  return walk(state);
}

/**
 * Jogadas legais agora: só as que fazem parte de uma sequência máxima.
 * Com dois números diferentes e apenas um jogável, o maior é obrigatório.
 */
export function legalMoves(state) {
  const maximum = maxMoves(state);
  if (maximum === 0) return [];
  const values = [...new Set(state.dice)];
  const candidates = [];

  for (const die of values) {
    for (const move of rawMovesForDie(state, state.turn, die)) {
      const after = applyMove(state, move);
      if (maxMoves(after) === maximum - 1) candidates.push(move);
    }
  }

  if (maximum === 1 && values.length > 1) {
    const highest = Math.max(...values);
    const highMoves = candidates.filter(move => move.die === highest);
    if (highMoves.length) return highMoves;
  }
  return candidates;
}

export const movesFrom = (state, from) => legalMoves(state).filter(move => move.from === from);

/* ===================== NOTAÇÃO ===================== */

export function moveText(move) {
  const from = move.fromBar ? "barra" : String(move.from);
  const to = move.toOff ? "fora" : String(move.to);
  return `${from}/${to}${move.hit ? "×" : ""} (${move.die})`;
}

export const moveRecord = move => ({
  from: move.from,
  to: move.to,
  die: move.die,
  hit: Boolean(move.hit),
  fromBar: Boolean(move.fromBar),
  toOff: Boolean(move.toOff),
  color: move.color,
  text: moveText(move),
});

const NUM_TOKEN = /^\d+$/;

function parseToken(value, state) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  if (text === "bar" || text === "barra") return state.turn === WHITE ? 25 : 0;
  if (text === "off" || text === "fora") return state.turn === WHITE ? 0 : 25;
  if (!NUM_TOKEN.test(text)) return null;
  return Number(text);
}

/** Normaliza { from, to, die }, [from, to, die] ou "barra/20/3" para números + sentidos. */
function normalizeInput(state, input) {
  let from, to, die;

  if (Array.isArray(input)) {
    [from, to, die] = input;
  } else if (typeof input === "string") {
    const tokens = input.trim().toLowerCase().split(/[-/>;,\s]+/).filter(Boolean);
    if (tokens.length < 2 || tokens.length > 3) return null;
    [from, to, die] = tokens;
  } else if (input && typeof input === "object") {
    ({ from, to, die } = input);
    if (from === undefined && input.fromBar) from = "bar";
    if (to === undefined && input.toOff) to = "off";
  } else {
    return null;
  }

  const color = state.turn;
  const fromValue = parseToken(from, state);
  const toValue = parseToken(to, state);
  if (fromValue === null || toValue === null) return null;

  let dieValue = null;
  if (die !== undefined && die !== null) {
    dieValue = parseToken(die, state);
    if (!isDie(dieValue)) return null;
  }

  const fromBar = color === WHITE ? fromValue === 25 : fromValue === 0;
  const toOff = color === WHITE ? toValue === 0 : toValue === 25;
  if (!fromBar && !inPoint(fromValue)) return null;
  if (!toOff && !inPoint(toValue)) return null;

  return { from: fromValue, to: toValue, die: dieValue, fromBar, toOff, color };
}

/** Encontra a jogada legal correspondente ao input (objeto, array ou texto). */
export function findMove(state, input) {
  const want = normalizeInput(state, input);
  if (!want) return null;
  return legalMoves(state).find(move =>
    move.from === want.from &&
    move.to === want.to &&
    (want.die == null || move.die === want.die)
  ) || null;
}

/* ===================== FIM DE TURNO / DADOS ===================== */

/** Troca a vez e limpa os dados: o próximo jogador precisa rolar. */
export function endTurn(state) {
  return {
    ...state,
    turn: other(state.turn),
    dice: [],
    roll: [],
    awaitingRoll: true,
    turnNo: state.turnNo + 1,
  };
}

/** Rola dois dados. Só vale quando o turno está esperando a rolagem. */
export function rollDice(state, d1, d2) {
  if (!isDie(d1) || !isDie(d2)) throw new Error("dado inválido");
  if (state.dice.length) throw new Error("ainda há dados para jogar");
  const dice = d1 === d2 ? [d1, d1, d1, d1] : [d1, d2];
  return { ...state, dice, roll: [d1, d2], awaitingRoll: false };
}

/** Rola, e se o jogador não tiver nenhuma jogada, passa a vez (réplica da regra oficial). */
export function autoRoll(state, rng) {
  if (typeof rng !== "function") throw new Error("rng inválido");
  let current = state;
  for (let i = 0; i < 100; i++) {
    if (outcome(current).over) return current;
    if (!current.dice.length) current = rollDice(current, dieFrom(rng), dieFrom(rng));
    if (legalMoves(current).length > 0) return current;
    current = endTurn(current);
  }
  return current;
}

/* ===================== PARTIDA ===================== */

export function outcome(state) {
  if (state.off[WHITE] >= CHECKERS) return { over: true, winner: WHITE, reason: "off" };
  if (state.off[BLACK] >= CHECKERS) return { over: true, winner: BLACK, reason: "off" };
  return { over: false, winner: null, reason: null };
}

/** Joga UMA jogada de um dado e devolve a partida nova (imutável). */
export function playMove(game, input) {
  const move = findMove(game.state, input);
  if (!move) throw new Error("lance ilegal");

  let state = applyMove(game.state, move);
  const result = outcome(state);

  if (result.over) {
    state = { ...state, dice: [], roll: [], awaitingRoll: false };
  } else if (state.dice.length === 0 || maxMoves(state) === 0) {
    state = endTurn(state);
  }

  const key = positionKey(state);
  const record = moveRecord(move);
  return {
    state,
    keys: [...game.keys, key],
    moves: [...game.moves, record],
    last: record,
    result,
  };
}

/** Joga uma sequência inteira (uma jogada por dado) — útil nos testes e no hot-seat. */
export function playMoves(game, inputs) {
  let current = game;
  for (const input of inputs) current = playMove(current, input);
  return current;
}

export const RESULT_LABELS = {
  off: "Todas as peças fora",
  resign: "Desistência",
  timeout: "Tempo esgotado",
};
