/* DOMINÓ CLÁSSICO — regras completas para 2, 3 ou 4 jogadores. Código puro (sem DOM, sem rede,
   sem Math.random/Date.now): roda igual no navegador, na Edge Function (Deno) e nos testes do Node.

   Material: 28 pedras, combinações de 0 a 6 (0-0 até 6-6). Cada jogador recebe 7 pedras.
   • 4 jogadores: todas as pedras são distribuídas (não sobra monte).
   • 2 ou 3 jogadores: o resto forma o monte de compra.

   Abertura: quem tem o maior carroção (a maior pedra dupla) abre a rodada jogando-o; se ninguém
   recebeu dupla, abre a maior pedra (maior número, depois maior soma). A abertura é automática,
   então a vez começa no jogador seguinte.

   Turno: jogue uma pedra que combine com uma das duas pontas da mesa. Sem pedra jogável, compre do
   monte até conseguir jogar; com o monte vazio, passe. A rodada fecha quando alguém bate (fica sem
   pedras) ou quando todos passam em sequência (jogo fechado).

   Pontuação: quem bate soma os pontos que ficaram nas mãos dos adversários. No jogo fechado, vence
   quem tem menos pontos na mão e leva a soma dos adversários menos os próprios pontos repetidos por
   adversário (a diferença); empate na menor mão não pontua. A partida vai até 100 pontos.

   Estado (JSON puro):
     hands       mãos; índice = assento - 1 (assento 1 ocupa hands[0])
     boneyard    pedras viradas para baixo (a próxima a comprar é a última); nunca vai para a view
     board       mesa em linha, da esquerda para a direita: [{ tile, left, right }]
                 left/right são os números EXPOSTOS de cada lado da pedra na linha
     ends        derivado da mesa: [ponta esquerda, ponta direita]
     turn        assento da vez
     passes      passes consecutivos sem jogada (zera a cada pedra jogada)
     roundNo     número da rodada (1, 2, 3…)
     points      pontos por assento
     seed        semente do próximo embaralhamento (nunca vai para a view)
     starter     assento que abriu a rodada
     last        último lance público (draw só diz se a pedra serviu, nunca qual foi)
     lastRound   resumo público da última rodada encerrada (vencedor, motivo e pontos por assento)
     plays       histórico público dos lances
     phase       "playing" | "over"
     winner / ranking  preenchidos só quando a partida acaba

   Pedras (ids únicos, strings): "<a>-<b>" com 0 <= a <= b <= 6, por exemplo "0-0", "2-5", "6-6". */

export const PARTY = {
  minPlayers: 2,
  maxPlayers: 4,
  /* A mesa existe com 2, 3 ou 4 jogadores; a interface usa esta lista para montar o setup. */
  playerCounts: [2, 3, 4],
  order: "turns",
  turnSeconds: 40,
  turnOptions: [30, 40, 60],
  /* Estourar o tempo elimina quem estourou (a partida continua entre os que ficaram). */
  onTimeout: "out",
  maxSeconds: 3600,
};

export const TARGET = 100;
export const HAND_SIZE = 7;
export const MAX_PIP = 6;

const isInt = value => Number.isInteger(value);

const seatsFromState = state => Array.from({ length: state.hands.length }, (_, i) => i + 1);
const handOf = (state, seat) => (isInt(seat) && seat >= 1 && seat <= state.hands.length ? state.hands[seat - 1] : []);

/** Pedra a partir do id canônico "<a>-<b>" (a <= b). Devolve null para id inválido. */
export function tileOf(id) {
  if (typeof id !== "string") return null;
  const parts = id.split("-");
  if (parts.length !== 2) return null;
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  if (!isInt(a) || !isInt(b) || a < 0 || b < 0 || a > MAX_PIP || b > MAX_PIP) return null;
  if (String(a) !== parts[0] || String(b) !== parts[1]) return null;   // sem "02" nem espaços
  if (a > b) return null;                                             // o id canônico tem a menor ponta primeiro
  return { id, a, b, sum: a + b, double: a === b };
}

export const isDouble = id => Boolean(tileOf(id)?.double);
export const pipsOf = id => tileOf(id)?.sum ?? 0;

/** Nome legível para aria-label e histórico. */
export function tileName(id) {
  const tile = tileOf(id);
  if (!tile) return "Pedra";
  return tile.double ? `Carroção ${tile.a} e ${tile.a}` : `Pedra ${tile.a} e ${tile.b}`;
}

/** Versão curta ("2–5", "6–6") para as pedras pequenas da mesa. */
export const tileShort = id => {
  const tile = tileOf(id);
  return tile ? `${tile.a}–${tile.b}` : "?";
};

/** As 28 pedras na ordem canônica (0-0, 0-1, … 6-6). */
export function buildDeck() {
  const deck = [];
  for (let a = 0; a <= MAX_PIP; a++) for (let b = a; b <= MAX_PIP; b++) deck.push(`${a}-${b}`);
  return deck;
}

/** Embaralha sem alterar a lista original. `rng` devolve 0..1. */
export function shuffle(list, rng) {
  if (typeof rng !== "function") throw new Error("rng obrigatório");
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const nextSeed = seed => (Math.imul(seed >>> 0, 1664525) + 1013904223) >>> 0;

/** Embaralha com a LCG guardada no estado: cada rodada é determinística pela seed. */
function seededShuffle(list, seed) {
  const out = list.slice();
  let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = nextSeed(s);
    const j = Math.floor((s / 0x100000000) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return { list: out, seed: s };
}

/** Mão ordenada do menor para o maior (0-0, 0-1, …). */
const sortHand = hand => hand.slice().sort((a, b) => {
  const A = tileOf(a), B = tileOf(b);
  return (A.a - B.a) || (A.b - B.b);
});

/* ------------------------------------------------------------------------------------------------
   Mesa, pontas e lances possíveis
   ------------------------------------------------------------------------------------------------ */

/** Pontas expostas: [esquerda, direita]. Mesa vazia devolve [null, null]. */
export function endsOf(board = []) {
  if (!board.length) return [null, null];
  return [board[0].left, board[board.length - 1].right];
}

/** Fins válidos ("left" e/ou "right") para a pedra. Mesa vazia aceita qualquer ponta. */
export function legalEnds(tile, ends) {
  const t = typeof tile === "string" ? tileOf(tile) : tile;
  if (!t) return [];
  const [left, right] = ends ?? [null, null];
  if (left == null && right == null) return ["right"];
  const out = [];
  if (left != null && (t.a === left || t.b === left)) out.push("left");
  if (right != null && (t.a === right || t.b === right)) out.push("right");
  return out;
}

/** Pedras da mão que combinam com alguma ponta. */
export function playableTiles(hand = [], ends = [null, null]) {
  return hand.filter(id => legalEnds(id, ends).length > 0);
}

/** Maior carroção da mesa; sem dupla, a maior pedra (maior número e depois maior soma). */
export function openingTile(hands = []) {
  const all = [];
  hands.forEach((hand, index) => {
    for (const tile of hand ?? []) if (tileOf(tile)) all.push({ seat: index + 1, tile });
  });
  if (!all.length) return null;
  const doubles = all.filter(entry => tileOf(entry.tile).double);
  const pool = doubles.length ? doubles : all;
  pool.sort((x, y) => {
    const A = tileOf(x.tile), B = tileOf(y.tile);
    return (B.b - A.b) || (B.sum - A.sum) || (x.seat - y.seat);
  });
  return pool[0];
}

/* ------------------------------------------------------------------------------------------------
   Assentos ativos e vez (ctx = { seats, out })
   ------------------------------------------------------------------------------------------------ */

function activeSeatsOf(state, ctx = {}) {
  const out = Array.isArray(ctx.out) ? ctx.out : [];
  return seatsFromState(state).filter(seat => !out.includes(seat));
}

function nextActiveSeat(state, from, ctx = {}) {
  const active = activeSeatsOf(state, ctx);
  if (!active.length) return null;
  return active.find(seat => seat > (from ?? 0)) ?? active[0];
}

/** Vez efetiva: se o assento da vez foi eliminado, a vez anda para o próximo ativo (o banco já fez isso). */
function effectiveTurn(state, ctx = {}) {
  const out = Array.isArray(ctx.out) ? ctx.out : [];
  if (state.turn == null) return null;
  if (!out.includes(state.turn)) return state.turn;
  return nextActiveSeat(state, state.turn, ctx);
}

const pushPlay = (plays, entry) => [...(plays ?? []), entry].slice(-80);

/* ------------------------------------------------------------------------------------------------
   Distribuição e rodadas
   ------------------------------------------------------------------------------------------------ */

/** Entrega 7 pedras aos assentos ativos e faz a abertura automática. */
function dealRound(state, ctx = {}, { roundNo }) {
  const active = activeSeatsOf(state, ctx);
  const shuffled = seededShuffle(buildDeck(), state.seed);
  const hands = state.hands.map(() => []);
  let index = 0;
  for (const seat of active) {
    hands[seat - 1] = sortHand(shuffled.list.slice(index, index + HAND_SIZE));
    index += HAND_SIZE;
  }
  const boneyard = shuffled.list.slice(index);
  const opening = openingTile(hands);
  const starter = opening?.seat ?? active[0] ?? 1;
  if (opening) {
    hands[starter - 1] = hands[starter - 1].filter(id => id !== opening.tile);
    const tile = tileOf(opening.tile);
    const board = [{ tile: opening.tile, left: tile.a, right: tile.b }];
    const turn = nextActiveSeat({ ...state, hands }, starter, ctx);
    return {
      ...state,
      hands,
      boneyard,
      board,
      seed: shuffled.seed,
      starter,
      turn,
      passes: 0,
      roundNo,
      phase: "playing",
      winner: null,
      ranking: null,
      last: { action: "open", seat: starter, tile: opening.tile, ends: [tile.a, tile.b], roundNo },
      plays: pushPlay(state.plays, { action: "open", seat: starter, tile: opening.tile, roundNo }),
    };
  }

  /* Caso extremo (mão vazia em teste): a mesa vazia espera a primeira pedra do assento da vez. */
  return {
    ...state, hands, boneyard, board: [], seed: shuffled.seed, starter, turn: starter,
    passes: 0, roundNo, phase: "playing", winner: null, ranking: null,
    last: { action: "deal", seat: starter, roundNo },
    plays: pushPlay(state.plays, { action: "deal", seat: starter, roundNo }),
  };
}

/** Partida nova. `seats` = [1,2], [1,2,3] ou [1,2,3,4]; `rng` = função 0..1 (no servidor, a seed secreta). */
export function partyStart({ seats, rng } = {}) {
  const n = Array.isArray(seats) ? seats.length : 0;
  if (n < PARTY.minPlayers || n > PARTY.maxPlayers) throw new Error("bad_players");
  if (!seats.every((seat, index) => seat === index + 1)) throw new Error("bad_players");
  if (typeof rng !== "function") throw new Error("rng obrigatório");
  const seed = Math.floor(rng() * 0x100000000) >>> 0;
  const base = {
    hands: seats.map(() => []),
    boneyard: [],
    board: [],
    turn: null,
    passes: 0,
    roundNo: 0,
    points: seats.map(() => 0),
    seed,
    starter: null,
    last: null,
    lastRound: null,
    plays: [],
    phase: "playing",
    winner: null,
    ranking: null,
  };
  const state = dealRound(base, { seats, out: [] }, { roundNo: 1 });
  return { state, turn: state.turn };
}

/* ------------------------------------------------------------------------------------------------
   Pontuação e fim
   ------------------------------------------------------------------------------------------------ */

const pipsInHand = (state, seat) => handOf(state, seat).reduce((sum, id) => sum + pipsOf(id), 0);

/** Ranking por pontos (maior primeiro), com empates no mesmo grupo. */
function rankingByPoints(state, ctx = {}) {
  const active = activeSeatsOf(state, ctx);
  const sorted = active.slice().sort((a, b) => (state.points[b - 1] - state.points[a - 1]) || (a - b));
  const ranking = [];
  for (const seat of sorted) {
    const group = ranking[ranking.length - 1];
    if (group && state.points[group[0] - 1] === state.points[seat - 1]) group.push(seat);
    else ranking.push([seat]);
  }
  return ranking;
}

function finishMatch(state, ctx = {}) {
  const ranking = rankingByPoints(state, ctx);
  const winner = ranking[0]?.length === 1 ? ranking[0][0] : null;
  const last = { action: "match", winner, points: state.points.slice(), roundNo: state.roundNo };
  return {
    ...state,
    phase: "over",
    winner,
    ranking,
    turn: null,
    passes: 0,
    last,
    plays: pushPlay(state.plays, last),
  };
}

/** A partida fechou por eliminação: classifica os ativos pela menor mão (menos pontos, melhor). */
function finishByElimination(state, ctx = {}) {
  const active = activeSeatsOf(state, ctx);
  if (!active.length) return null;
  const pips = active.map(seat => ({ seat, pips: pipsInHand(state, seat) }));
  pips.sort((a, b) => (a.pips - b.pips) || (a.seat - b.seat));
  const ranking = [];
  for (const entry of pips) {
    const group = ranking[ranking.length - 1];
    if (group && pipsInHand(state, group[0]) === entry.pips) group.push(entry.seat);
    else ranking.push([entry.seat]);
  }
  const winner = ranking[0]?.length === 1 ? ranking[0][0] : null;
  const last = { action: "match", winner, reason: "elimination", out: (ctx.out ?? []).slice(), roundNo: state.roundNo };
  const next = {
    ...state,
    phase: "over",
    winner,
    ranking,
    turn: null,
    passes: 0,
    last,
    plays: pushPlay(state.plays, last),
  };
  return { state: next, turn: null, ranking, move: last, reason: "elimination" };
}

/** Fecha a rodada, soma os pontos e prepara a próxima (ou encerra a partida no alvo). */
function finishRound(state, winnerSeat, reason, ctx = {}) {
  const active = activeSeatsOf(state, ctx);
  const counts = active.map(seat => ({ seat, pips: pipsInHand(state, seat), tiles: handOf(state, seat).length }));
  let winner = winnerSeat ?? null;
  let points = 0;
  let tie = false;

  if (reason === "batida") {
    points = counts.filter(entry => entry.seat !== winner).reduce((sum, entry) => sum + entry.pips, 0);
  } else {
    const min = Math.min(...counts.map(entry => entry.pips));
    const lows = counts.filter(entry => entry.pips === min);
    tie = lows.length > 1 || !lows.length;
    winner = tie ? null : lows[0].seat;
    if (winner != null) {
      const others = counts.filter(entry => entry.seat !== winner).reduce((sum, entry) => sum + entry.pips, 0);
      points = Math.max(0, others - min * Math.max(0, active.length - 1));
    }
  }

  const pointsTable = state.points.slice();
  if (winner != null) pointsTable[winner - 1] += points;
  const lastRound = { roundNo: state.roundNo, winner, reason, tie, points, counts };
  const last = { action: "round", ...lastRound };
  const resolved = {
    ...state,
    points: pointsTable,
    passes: 0,
    lastRound,
    last,
    plays: pushPlay(state.plays, last),
  };

  if (winner != null && pointsTable[winner - 1] >= TARGET) {
    const final = finishMatch(resolved, ctx);
    return { state: final, turn: null, ranking: final.ranking, move: final.last, reason: "match" };
  }
  const next = dealRound(resolved, ctx, { roundNo: state.roundNo + 1 });
  return { state: next, turn: next.turn, ranking: null, move: next.last, reason };
}

/* ------------------------------------------------------------------------------------------------
   Lances
   ------------------------------------------------------------------------------------------------ */

/** Executa um lance. Devolve null para lance ilegal. `ctx = { seats, out }`. */
export function partyMove(state, seat, input, ctx = {}) {
  const seats = Array.isArray(ctx.seats) && ctx.seats.length ? ctx.seats : seatsFromState(state);
  const out = Array.isArray(ctx.out) ? ctx.out : [];
  if (!seats.includes(seat) || out.includes(seat)) return null;
  if (state.winner != null || state.phase === "over") return null;

  const active = activeSeatsOf(state, ctx);
  if (active.length < 2) return finishByElimination(state, ctx);

  if (effectiveTurn(state, ctx) !== seat) return null;
  const action = input?.action;
  const ends = endsOf(state.board);

  if (action === "play") {
    const tile = tileOf(input?.tile);
    const hand = handOf(state, seat);
    if (!tile || !hand.includes(tile.id)) return null;
    const legal = legalEnds(tile, ends);
    if (!legal.length) return null;
    let end = input?.end === "left" || input?.end === "right" ? input.end : null;
    if (!end) {
      if (legal.length === 1) end = legal[0];
      else if (ends[0] != null && ends[0] === ends[1]) end = "right";   // pontas iguais: tanto faz
      else return null;                                                  // precisa escolher a ponta
    }
    if (!legal.includes(end)) return null;

    const emptyBoard = !state.board.length;
    const matchValue = emptyBoard ? null : end === "left" ? ends[0] : ends[1];
    const other = tile.a === matchValue ? tile.b : tile.a;
    const placement = emptyBoard
      ? { tile: tile.id, left: tile.a, right: tile.b }
      : end === "left"
        ? { tile: tile.id, left: other, right: matchValue }
        : { tile: tile.id, left: matchValue, right: other };

    const hands = state.hands.slice();
    hands[seat - 1] = hand.filter(id => id !== tile.id);
    const board = end === "left" ? [placement, ...state.board] : [...state.board, placement];
    const nextEnds = endsOf(board);
    const record = { action: "play", seat, tile: tile.id, end, ends: nextEnds, roundNo: state.roundNo };
    const next = {
      ...state,
      hands,
      board,
      passes: 0,
      last: record,
      plays: pushPlay(state.plays, record),
    };

    if (!hands[seat - 1].length) return finishRound(next, seat, "batida", ctx);
    next.turn = nextActiveSeat(state, seat, ctx);
    return { state: next, turn: next.turn, ranking: null, move: next.last, reason: null };
  }

  if (action === "draw") {
    if (playableTiles(handOf(state, seat), ends).length) return null;   // com pedra jogável, joga-se
    if (!state.boneyard.length) return null;                            // monte vazio: passe
    const boneyard = state.boneyard.slice();
    const drew = boneyard.pop();
    const hands = state.hands.slice();
    hands[seat - 1] = sortHand([...handOf(state, seat), drew]);
    const playable = playableTiles(hands[seat - 1], ends).length > 0;
    const record = { action: "draw", seat, playable, empty: boneyard.length === 0, roundNo: state.roundNo };
    const next = {
      ...state,
      hands,
      boneyard,
      last: record,
      plays: pushPlay(state.plays, record),
    };
    return { state: next, turn: seat, ranking: null, move: next.last, reason: null };
  }

  if (action === "pass") {
    if (playableTiles(handOf(state, seat), ends).length) return null;   // tem pedra: não pode passar
    if (state.boneyard.length) return null;                             // ainda pode comprar
    const passes = state.passes + 1;
    const record = { action: "pass", seat, passes, roundNo: state.roundNo };
    const next = { ...state, passes, last: record, plays: pushPlay(state.plays, record) };
    if (passes >= active.length) return finishRound(next, null, "fechado", ctx);
    next.turn = nextActiveSeat(state, seat, ctx);
    return { state: next, turn: next.turn, ranking: null, move: next.last, reason: null };
  }

  return null;
}

/** Estouro de tempo no modo local: compra enquanto precisa e joga a pedra jogável de menor valor; sem pedra
    jogável e sem monte, passa. No online (`onTimeout: "out"`) o servidor elimina quem estourou. */
export function timeoutTurn(state, seat, ctx = {}) {
  const seats = Array.isArray(ctx.seats) && ctx.seats.length ? ctx.seats : seatsFromState(state);
  const out = Array.isArray(ctx.out) ? ctx.out : [];
  if (state.winner != null || state.phase === "over" || !seats.includes(seat) || out.includes(seat)) return null;
  if (effectiveTurn(state, ctx) !== seat) return null;

  let current = state;
  for (let guard = 0; guard < 40; guard++) {
    const ends = endsOf(current.board);
    const playable = playableTiles(handOf(current, seat), ends);
    if (playable.length) {
      const tile = playable.slice().sort((a, b) => (pipsOf(a) - pipsOf(b)) || (a < b ? -1 : a > b ? 1 : 0))[0];
      const legal = legalEnds(tile, ends);
      const end = legal.includes("right") ? "right" : legal[0];
      return partyMove(current, seat, { action: "play", tile, end }, ctx)?.state ?? null;
    }
    if (current.boneyard.length) {
      const result = partyMove(current, seat, { action: "draw" }, ctx);
      if (!result) return null;
      current = result.state;
      continue;
    }
    return partyMove(current, seat, { action: "pass" }, ctx)?.state ?? null;
  }
  return current;
}

/* ------------------------------------------------------------------------------------------------
   Visão do assento (nunca devolve seed, monte ou mãos alheias)
   ------------------------------------------------------------------------------------------------ */

export function partyView(state, seat, ctx = {}) {
  const seats = Array.isArray(ctx.seats) && ctx.seats.length ? ctx.seats : seatsFromState(state);
  const out = Array.isArray(ctx.out) ? ctx.out : [];
  const hand = handOf(state, seat).slice();
  const ends = endsOf(state.board);
  const playable = playableTiles(hand, ends);
  const active = state.winner == null && state.phase !== "over" && !out.includes(seat);
  const turn = state.phase === "over" ? null : effectiveTurn(state, ctx);
  const isTurn = active && turn === seat;

  return {
    seat,
    turn,
    phase: state.phase,
    roundNo: state.roundNo,
    hand,
    playable,
    counts: seats.map(s => ({ seat: s, tiles: handOf(state, s).length, out: out.includes(s) })),
    boneyard: state.boneyard.length,
    board: state.board.map(entry => ({ ...entry })),
    ends,
    passes: state.passes,
    points: state.points.slice(),
    target: TARGET,
    starter: state.starter ?? null,
    canPlay: isTurn && playable.length > 0,
    canDraw: isTurn && playable.length === 0 && state.boneyard.length > 0,
    canPass: isTurn && playable.length === 0 && state.boneyard.length === 0,
    last: state.last ?? null,
    lastRound: state.lastRound ?? null,
    plays: (state.plays ?? []).slice(-12),
    winner: state.winner ?? null,
    ranking: state.ranking ?? null,
  };
}

/** Colocação de cada assento a partir do ranking (mesma regra do shared/party.js). */
export function placements(ranking = []) {
  const out = {};
  let place = 1;
  for (const group of ranking) {
    for (const seat of group) out[seat] = place;
    place += group.length;
  }
  return out;
}
