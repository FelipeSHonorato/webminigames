/* TRUCO PAULISTA — regras completas para 1×1. Código puro (sem DOM, sem rede, sem Math.random/Date.now):
   roda igual no navegador, na Edge Function (Deno) e nos testes do Node.

   Baralho convencional de 40 cartas (sem 8, 9 e 10), 3 cartas para cada jogador e melhor de 3 vazas.
   Manilhas fixas (Paulista): 4♣ zap > 7♥ copeta > A♠ espadilha > 7♦ pica-fumo > 3 > 2 > A > K > J > Q > 7 > 6 > 5 > 4.
   A partida vai até 12 pontos. O truco sobe 1 → 3 → 6 → 9 → 12; quem corre entrega o valor que estava valendo.

   Estado (JSON puro):
     hands        mãos; índice = assento - 1 (assento 1 ocupa hands[0])
     points       pontos de cada assento
     handNo       número da mão (1, 2, 3…)
     handValue    quanto vale a mão agora (1, 3, 6, 9 ou 12)
     pending      null | { seat, responder, value, stake, resumeTurn } (pedido de truco aguardando resposta)
     phase        "playing" | "mao" (decisão da mão de onze) | "over"
     maoDeOnze    assento que precisa decidir jogar/correr na mão de onze (null fora dela)
     maoDeOnzeSeat assento dono da mão de onze (continua durante a mão)
     maoDeOnzeHand mão atual é a mão de onze (vale 3 e não aceita truco)
     maoDeFerro   mão atual é a mão de ferro (os dois em 11; vale 3 e não aceita truco)
     trucoLocked  true nas mãos especiais (sem novos pedidos de truco)
     nextRaiser   null | assento que pode pedir o próximo aumento (alterna para quem aceitou)
     raiseReady   false logo depois de aceitar; um carta jogada libera o próximo aumento
     leader       assento que começa a mão
     turn         assento da vez (inclui quem responde truco e quem decide a mão de onze)
     round        1..3
     roundLeader  assento que abriu a vaza atual
     roundWins    vazas ganhas por assento
     table        cartas da vaza atual (ou da última vaza resolvida, até o próximo lance)
     roundResults histórico público das vazas desta mão
     lastHand     resumo público da última mão encerrada
     last / plays último lance e histórico público
     winner / ranking preenchidos só quando a partida acaba
     seed         semente do embaralhamento determinístico das próximas mãos (nunca vai para a view)

   Cartas (ids únicos, strings): "<valor>-<naipe>", por exemplo "3-clubs", "7-hearts", "A-spades".
   Valores: 4, 5, 6, 7, Q, J, K, A, 2, 3. Naipes: clubs, hearts, spades, diamonds. */

export const PARTY = {
  minPlayers: 2,
  maxPlayers: 2,
  order: "turns",
  turnSeconds: 40,
  turnOptions: [30, 40, 60],
  /* Com 1×1, estourar o tempo elimina quem estourou (a partida termina na hora). O `skip` genérico
     só passaria a vez no banco sem atualizar o domínio e quebraria a mão em andamento. */
  onTimeout: "out",
  maxSeconds: 1800,
};

export const TARGET = 12;
export const RANKS = ["4", "5", "6", "7", "Q", "J", "K", "A", "2", "3"];
export const SUITS = ["clubs", "hearts", "spades", "diamonds"];
export const SUIT_NAMES = { clubs: "paus", hearts: "copas", spades: "espadas", diamonds: "ouros" };
export const SUIT_SYMBOLS = { clubs: "♣", hearts: "♥", spades: "♠", diamonds: "♦" };
export const RED_SUITS = ["hearts", "diamonds"];

/** Força base (sem manilha): 4 < 5 < 6 < 7 < Q < J < K < A < 2 < 3. */
const BASE_STRENGTH = { "4": 1, "5": 2, "6": 3, "7": 4, Q: 5, J: 6, K: 7, A: 8, "2": 9, "3": 10 };

/** Manilhas fixas do Truco Paulista, acima de qualquer 3. */
const MANILHAS = {
  "4-clubs": { strength: 14, name: "Zap" },
  "7-hearts": { strength: 13, name: "Copeta" },
  "A-spades": { strength: 12, name: "Espadilha" },
  "7-diamonds": { strength: 11, name: "Pica-fumo" },
};

/** Nome do aumento conforme o valor que a mão passa a valer. */
export const TRUCO_NAMES = { 3: "Truco", 6: "Retruco", 9: "Vale quatro", 12: "Vale cinco" };

const isInt = value => Number.isInteger(value);
const otherSeat = seat => (seat === 1 ? 2 : 1);
const seatsFromState = state => Array.from({ length: state.hands.length }, (_, i) => i + 1);
const handOf = (state, seat) => (isInt(seat) && seat >= 1 && seat <= state.hands.length ? state.hands[seat - 1] : []);

/** Carta a partir do id. Devolve null para id inválido. */
export function cardOf(id) {
  if (typeof id !== "string") return null;
  const parts = id.split("-");
  if (parts.length !== 2) return null;
  const [rank, suit] = parts;
  if (!RANKS.includes(rank) || !SUITS.includes(suit)) return null;
  return { id, rank, suit };
}

export const cardRank = id => cardOf(id)?.rank ?? null;
export const cardSuit = id => cardOf(id)?.suit ?? null;

/** Força da carta (maior vence). Carta inválida tem força 0. */
export function strengthOf(id) {
  const card = cardOf(id);
  if (!card) return 0;
  return MANILHAS[id]?.strength ?? BASE_STRENGTH[card.rank] ?? 0;
}

export const isManilha = id => Boolean(MANILHAS[id]);
export const manilhaName = id => MANILHAS[id]?.name ?? null;

/** Nome legível para aria-label e histórico. */
export function cardName(id) {
  const card = cardOf(id);
  if (!card) return "Carta";
  const base = `${card.rank} de ${SUIT_NAMES[card.suit]}`;
  return isManilha(id) ? `${base} (${manilhaName(id)})` : base;
}

/** Versão curta ("3♣", "7♥") para as cartas pequenas da mesa. */
export function cardShort(id) {
  const card = cardOf(id);
  return card ? `${card.rank}${SUIT_SYMBOLS[card.suit]}` : "?";
}

/** Baralho completo de 40 cartas, na ordem canônica (uma carta por valor/naipe). */
export function buildDeck() {
  const deck = [];
  for (const rank of RANKS) for (const suit of SUITS) deck.push(`${rank}-${suit}`);
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

/** Embaralha com a LCG guardada no estado: cada mão nova é determinística pela seed. */
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

const sortHand = hand => hand.slice().sort((a, b) => {
  const byStrength = strengthOf(b) - strengthOf(a);
  if (byStrength) return byStrength;
  return a < b ? -1 : a > b ? 1 : 0;
});

/** Próximo valor de truco: 1→3, 3→6, 6→9, 9→12. Devolve null no teto. */
export const nextTrucoValue = value => {
  if (value === 1) return 3;
  if (value === 3) return 6;
  if (value === 6) return 9;
  if (value === 9) return 12;
  return null;
};

const pushPlay = (plays, entry) => [...(plays ?? []), entry].slice(-80);

/** Entrega 3 cartas para cada jogador e prepara a mão com o valor/estado pedido. */
function dealHand(state, { value, leader, phase = "playing", maoDeOnze = null, maoDeOnzeSeat = null, maoDeOnzeHand = false, maoDeFerro = false }) {
  const shuffled = seededShuffle(buildDeck(), state.seed);
  const hands = [sortHand(shuffled.list.slice(0, 3)), sortHand(shuffled.list.slice(3, 6))];
  const handNo = state.handNo + 1;
  return {
    ...state,
    hands,
    seed: shuffled.seed,
    handNo,
    handValue: value,
    pending: null,
    phase,
    maoDeOnze,
    maoDeOnzeSeat,
    maoDeOnzeHand,
    maoDeFerro,
    trucoLocked: maoDeOnzeHand || maoDeFerro,
    nextRaiser: null,
    raiseReady: true,
    leader,
    turn: leader,
    round: 1,
    roundLeader: leader,
    roundWins: [0, 0],
    table: [],
    roundResults: [],
    last: { action: "deal", handNo, value, leader, maoDeOnze, maoDeFerro },
  };
}

/** Partida nova. `seats` = [1, 2]; `rng` = função 0..1 (no servidor, a seed secreta). */
export function partyStart({ seats, rng } = {}) {
  if (!Array.isArray(seats) || seats.length !== PARTY.minPlayers || seats.length !== PARTY.maxPlayers) throw new Error("bad_players");
  if (typeof rng !== "function") throw new Error("rng obrigatório");
  const seed = Math.floor(rng() * 0x100000000) >>> 0;
  const base = {
    hands: [[], []],
    points: [0, 0],
    handNo: 0,
    handValue: 1,
    pending: null,
    phase: "playing",
    maoDeOnze: null,
    maoDeOnzeSeat: null,
    maoDeOnzeHand: false,
    maoDeFerro: false,
    trucoLocked: false,
    nextRaiser: null,
    raiseReady: true,
    leader: 1,
    turn: 1,
    round: 1,
    roundLeader: 1,
    roundWins: [0, 0],
    table: [],
    roundResults: [],
    last: null,
    lastHand: null,
    plays: [],
    winner: null,
    ranking: null,
    seed,
  };
  const state = dealHand(base, { value: 1, leader: 1 });
  return { state, turn: state.turn };
}

/** Decide a mão a partir das vazas: assento vencedor, null quando ninguém pontua, undefined quando ainda não acabou.
    Regras de empate adotadas: 1ª empatada → vence a 2ª; 2ª empatada → vence a 1ª; 1ª e 2ª empatadas → vence a 3ª;
    3ª empatada → vence a 1ª; as três empatadas → ninguém pontua. */
function decidedHand(roundResults) {
  const w = roundResults.map(result => result.winner);
  if (w.length === 2) {
    if (w[0] && w[1]) return w[0] === w[1] ? w[0] : undefined;
    if (w[0] && w[1] === null) return w[0];
    if (w[0] === null && w[1]) return w[1];
    return undefined;
  }
  if (w.length >= 3) {
    if (w[2]) return w[2];
    if (w[0] && w[1] && w[0] !== w[1]) return w[0];
    return null;
  }
  return undefined;
}

/** Encerra a partida com ranking simples de 1×1. */
function finishMatch(state, winner, lastHand) {
  const loser = otherSeat(winner);
  return {
    ...state,
    phase: "over",
    winner,
    ranking: [[winner], [loser]],
    turn: null,
    pending: null,
    maoDeOnze: null,
    lastHand,
    last: { action: "match", winner, handNo: lastHand.handNo, points: state.points.slice() },
    plays: pushPlay(state.plays, { action: "match", winner, handNo: lastHand.handNo, points: state.points.slice() }),
  };
}

/** Fecha a mão, soma os pontos e prepara a próxima (mão de onze, mão de ferro ou mão normal). */
function finishHand(state, winner, awarded, reason, extra = {}) {
  const previous = state.points.slice();
  const points = state.points.slice();
  if (winner) points[winner - 1] += awarded;
  const handRecord = {
    handNo: state.handNo,
    winner: winner ?? null,
    points: awarded,
    reason,
    rounds: state.roundResults.map(result => ({ ...result, cards: result.cards.map(card => ({ ...card })) })),
    ...extra,
  };
  const next = {
    ...state,
    points,
    pending: null,
    lastHand: handRecord,
    plays: pushPlay(state.plays, { action: "hand", ...handRecord, pointsAfter: points.slice() }),
  };

  if (winner && points[winner - 1] >= TARGET) return finishMatch(next, winner, handRecord);

  if (points[0] >= 11 && points[1] >= 11) {
    return dealHand(next, { value: 3, leader: winner ?? otherSeat(state.leader), maoDeFerro: true });
  }

  const crossing = [0, 1].find(index => points[index] >= 11 && previous[index] < 11);
  if (crossing != null) {
    const seat = crossing + 1;
    return dealHand(next, {
      value: 3,
      leader: seat,
      phase: "mao",
      maoDeOnze: seat,
      maoDeOnzeSeat: seat,
      maoDeOnzeHand: true,
    });
  }

  return dealHand(next, { value: 1, leader: winner ?? otherSeat(state.leader) });
}

/** Corre da mão de onze: entrega 1 ponto ao adversário e prepara a próxima mão. */
function runMaoFold(state, seat) {
  const opponent = otherSeat(seat);
  const previous = state.points.slice();
  const points = state.points.slice();
  points[opponent - 1] += 1;
  const handRecord = {
    handNo: state.handNo,
    winner: opponent,
    points: 1,
    reason: "mao_fold",
    rounds: [],
    foldedBy: seat,
  };
  const withAction = {
    ...state,
    points,
    pending: null,
    maoDeOnze: null,
    lastHand: handRecord,
    plays: pushPlay(
      pushPlay(state.plays, { seat, action: "mao", choice: "fold", to: opponent, points: 1 }),
      { action: "hand", ...handRecord, pointsAfter: points.slice() },
    ),
  };

  if (points[opponent - 1] >= TARGET) return finishMatch(withAction, opponent, handRecord);
  if (points[0] >= 11 && points[1] >= 11) return dealHand(withAction, { value: 3, leader: opponent, maoDeFerro: true });

  /* A pessoa que correu continua em 11, mas a mão de onze não se repete: só o cruzamento de 10 para 11 a ativa. */
  return dealHand(withAction, { value: 1, leader: opponent });
}

/** Resolve a vaza quando as duas cartas estão na mesa. */
function resolveRound(state) {
  const [first, second] = state.table;
  const firstStrength = strengthOf(first.card);
  const secondStrength = strengthOf(second.card);
  const winner = firstStrength > secondStrength ? first.seat : secondStrength > firstStrength ? second.seat : null;
  const entry = { round: state.round, cards: state.table.slice(), winner, tie: winner === null };
  const roundResults = [...state.roundResults, entry];
  const roundWins = state.roundWins.slice();
  if (winner) roundWins[winner - 1] += 1;
  const nextLeader = winner ?? state.roundLeader;
  const resolved = {
    ...state,
    roundResults,
    roundWins,
    last: { action: "round", round: state.round, winner, tie: winner === null, seat: second.seat },
    plays: pushPlay(state.plays, { action: "round", round: state.round, winner, tie: winner === null, seat: second.seat }),
  };

  const decided = decidedHand(roundResults);
  if (decided !== undefined) {
    const finished = finishHand(resolved, decided, decided ? resolved.handValue : 0, decided ? "hand" : "tie");
    return {
      state: finished,
      turn: finished.turn,
      ranking: finished.ranking,
      move: resolved.last,
      reason: finished.ranking ? (decided ? "hand" : "tie") : null,
    };
  }

  return {
    state: { ...resolved, round: state.round + 1, roundLeader: nextLeader, turn: nextLeader },
    turn: nextLeader,
    ranking: null,
    move: resolved.last,
    reason: null,
  };
}

/** Executa um lance. Devolve null para lance ilegal. `ctx = { seats, out }`. */
export function partyMove(state, seat, input, ctx = {}) {
  const seats = Array.isArray(ctx.seats) && ctx.seats.length ? ctx.seats : seatsFromState(state);
  const out = Array.isArray(ctx.out) ? ctx.out : [];
  if (!seats.includes(seat) || out.includes(seat)) return null;
  if (state.winner != null || state.phase === "over") return null;
  if (state.turn !== seat) return null;

  const action = input?.action;

  if (state.phase === "mao") {
    if (action !== "mao" || state.maoDeOnze !== seat) return null;
    if (input?.choice === "play") {
      const next = {
        ...state,
        phase: "playing",
        maoDeOnze: null,
        turn: state.leader,
        raiseReady: false,
        last: { seat, action: "mao", choice: "play", value: state.handValue },
        plays: pushPlay(state.plays, { seat, action: "mao", choice: "play", value: state.handValue }),
      };
      return { state: next, turn: next.turn, ranking: null, move: next.last, reason: null };
    }
    if (input?.choice === "fold") {
      const next = runMaoFold(state, seat);
      return { state: next, turn: next.turn, ranking: next.ranking, move: { seat, action: "mao", choice: "fold" }, reason: next.ranking ? "mao_fold" : null };
    }
    return null;
  }

  if (state.pending) {
    const pending = state.pending;
    if (pending.responder !== seat) return null;

    if (action === "accept") {
      const next = {
        ...state,
        handValue: pending.value,
        pending: null,
        nextRaiser: seat,
        raiseReady: false,
        turn: pending.resumeTurn,
        last: { seat, action: "accept", value: pending.value },
        plays: pushPlay(state.plays, { seat, action: "accept", value: pending.value }),
      };
      return { state: next, turn: next.turn, ranking: null, move: next.last, reason: null };
    }

    if (action === "fold") {
      const challenger = pending.seat;
      const folded = { ...state, pending: null, handValue: pending.stake };
      const next = finishHand(folded, challenger, pending.stake, "fold", { foldedBy: seat });
      return {
        state: next,
        turn: next.turn,
        ranking: next.ranking,
        move: { seat, action: "fold", to: challenger, points: pending.stake },
        reason: next.ranking ? "fold" : null,
      };
    }

    if (action === "raise") {
      const value = nextTrucoValue(pending.value);
      if (!value) return null;
      const responder = otherSeat(seat);
      const next = {
        ...state,
        pending: { seat, responder, value, stake: pending.value, resumeTurn: pending.resumeTurn },
        turn: responder,
        last: { seat, action: "raise", value, stake: pending.value },
        plays: pushPlay(state.plays, { seat, action: "raise", value, stake: pending.value }),
      };
      return { state: next, turn: next.turn, ranking: null, move: next.last, reason: null };
    }

    return null;
  }

  if (action === "truco") {
    if (state.phase !== "playing" || state.trucoLocked || !state.raiseReady) return null;
    if (state.nextRaiser != null && state.nextRaiser !== seat) return null;
    const value = nextTrucoValue(state.handValue);
    if (!value) return null;
    const responder = otherSeat(seat);
    const next = {
      ...state,
      pending: { seat, responder, value, stake: state.handValue, resumeTurn: state.turn },
      turn: responder,
      last: { seat, action: "truco", value, stake: state.handValue },
      plays: pushPlay(state.plays, { seat, action: "truco", value, stake: state.handValue }),
    };
    return { state: next, turn: responder, ranking: null, move: next.last, reason: null };
  }

  if (action !== "play") return null;
  if (state.phase !== "playing") return null;
  const card = input?.card;
  const hand = handOf(state, seat);
  if (!hand.includes(card) || !cardOf(card)) return null;

  const hands = state.hands.slice();
  hands[seat - 1] = hand.filter(id => id !== card);
  let table = state.table.slice();
  let roundLeader = state.roundLeader;
  if (table.length >= 2) {       // a vaza anterior terminou: a mesa vira para a próxima
    table = [];
    roundLeader = seat;
  }
  if (!table.length) roundLeader = seat;
  table = [...table, { seat, card }];
  const playRecord = { seat, action: "play", card, round: state.round };
  const next = {
    ...state,
    hands,
    table,
    roundLeader,
    raiseReady: true,
    last: playRecord,
    plays: pushPlay(state.plays, playRecord),
  };

  if (table.length === 1) {
    next.turn = otherSeat(seat);
    return { state: next, turn: next.turn, ranking: null, move: next.last, reason: null };
  }

  return resolveRound(next);
}

/** Estouro de tempo no modo local: joga a carta mais fraca, aceita? não — corre de truco/mão de onze.
    A Edge/Postgres cuidam do tempo no online (onTimeout: "out" elimina quem estourou). */
export function timeoutTurn(state, seat, ctx = {}) {
  const seats = Array.isArray(ctx.seats) && ctx.seats.length ? ctx.seats : seatsFromState(state);
  const out = Array.isArray(ctx.out) ? ctx.out : [];
  if (state.winner != null || state.phase === "over" || state.turn !== seat || !seats.includes(seat) || out.includes(seat)) return null;
  if (state.phase === "mao") return partyMove(state, seat, { action: "mao", choice: "fold" }, ctx)?.state ?? null;
  if (state.pending) return partyMove(state, seat, { action: "fold" }, ctx)?.state ?? null;
  const weakest = handOf(state, seat).slice().sort((a, b) => strengthOf(a) - strengthOf(b))[0];
  if (!weakest) return null;
  return partyMove(state, seat, { action: "play", card: weakest }, ctx)?.state ?? null;
}

/** Visão do assento: mão própria, mesa, pontos e históricos públicos. NUNCA devolve seed nem mãos alheias. */
export function partyView(state, seat, ctx = {}) {
  const seats = Array.isArray(ctx.seats) && ctx.seats.length ? ctx.seats : seatsFromState(state);
  const out = Array.isArray(ctx.out) ? ctx.out : [];
  const hand = handOf(state, seat).slice();
  const active = state.winner == null && state.phase !== "over" && !out.includes(seat);
  const pending = state.pending ?? null;
  const canRespond = active && state.phase === "playing" && pending?.responder === seat;
  return {
    seat,
    turn: state.turn ?? null,
    phase: state.phase,
    hand,
    counts: seats.map(s => ({ seat: s, cards: handOf(state, s).length, out: out.includes(s) })),
    points: state.points.slice(),
    target: TARGET,
    handNo: state.handNo,
    handValue: state.handValue,
    nextTrucoValue: nextTrucoValue(state.handValue),
    pending: pending ? { seat: pending.seat, responder: pending.responder, value: pending.value, stake: pending.stake } : null,
    maoDeOnze: state.maoDeOnze ?? null,
    maoDeOnzeSeat: state.maoDeOnzeSeat ?? null,
    maoDeOnzeHand: Boolean(state.maoDeOnzeHand),
    maoDeFerro: Boolean(state.maoDeFerro),
    trucoLocked: Boolean(state.trucoLocked),
    leader: state.leader,
    round: state.round,
    roundLeader: state.roundLeader,
    roundWins: state.roundWins.slice(),
    table: state.table.map(card => ({ ...card })),
    roundResults: state.roundResults.map(result => ({ ...result, cards: result.cards.map(card => ({ ...card })) })),
    last: state.last ?? null,
    lastHand: state.lastHand ?? null,
    plays: (state.plays ?? []).slice(-12),
    winner: state.winner ?? null,
    ranking: state.ranking ?? null,
    canPlay: active && state.phase === "playing" && !pending && state.turn === seat,
    canTruco: active && state.phase === "playing" && !pending && !state.trucoLocked && state.turn === seat
      && state.handValue < 12 && state.raiseReady && (state.nextRaiser == null || state.nextRaiser === seat),
    canAccept: canRespond,
    canFold: canRespond,
    canRaise: canRespond && nextTrucoValue(pending.value) != null,
    canChooseMao: active && state.phase === "mao" && state.maoDeOnze === seat,
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
