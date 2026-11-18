/* TRUCO PAULISTA — regras completas para 2 jogadores (1×1) ou 4 jogadores em duplas (2×2).
   Código puro (sem DOM, sem rede, sem Math.random/Date.now): roda igual no navegador, na Edge Function (Deno)
   e nos testes do Node.

   Baralho convencional de 40 cartas (sem 8, 9 e 10), 3 cartas para cada jogador e melhor de 3 vazas.
   Manilhas fixas (Paulista): 4♣ zap > 7♥ copeta > A♠ espadilha > 7♦ pica-fumo > 3 > 2 > A > K > J > Q > 7 > 6 > 5 > 4.
   A partida vai até 12 pontos. O truco sobe 1 → 3 → 6 → 9 → 12; quem corre entrega o valor que estava valendo.

   Mesas:
     • 2 jogadores: cada um por si (dupla = um assento).
     • 4 jogadores: duplas 2×2 com parceiros em assentos opostos (1 & 3 contra 2 & 4). Os pontos são da dupla:
       os dois membros compartilham o mesmo placar. A vaza é da dupla da carta mais alta; empate só quando as
       duas duplas têm a mesma maior força. Quem pede truco é respondido pelo próximo adversário (a vez alterna).

   Estado (JSON puro):
     hands        mãos; índice = assento - 1 (assento 1 ocupa hands[0])
     points       pontos de cada DUPLA (índice 0 = assentos 1 e 3; índice 1 = assentos 2 e 4)
     handNo       número da mão (1, 2, 3…)
     handValue    quanto vale a mão agora (1, 3, 6, 9 ou 12)
     pending      null | { seat, responder, value, stake, resumeTurn } (pedido de truco aguardando resposta)
     phase        "playing" | "mao" (decisão da mão de onze) | "over"
     maoDeOnze    assento que precisa decidir jogar/correr na mão de onze (null fora dela)
     maoDeOnzeSeat assento dono da mão de onze (continua durante a mão)
     maoDeOnzeHand mão atual é a mão de onze (vale 3 e não aceita truco)
     maoDeFerro   mão atual é a mão de ferro (as duas duplas em 11; vale 3 e não aceita truco)
     trucoLocked  true nas mãos especiais (sem novos pedidos de truco)
     nextRaiser   null | assento que pode pedir o próximo aumento (o parceiro desse assento também pode)
     raiseReady   false logo depois de aceitar; um carta jogada libera o próximo aumento
     leader       assento que começa a mão
     turn         assento da vez (inclui quem responde truco e quem decide a mão de onze)
     round        1..3
     roundLeader  assento que abriu a vaza atual
     roundWins    vazas ganhas por DUPLA (índice 0 = assentos 1 e 3; índice 1 = assentos 2 e 4)
     table        cartas da vaza atual (ou da última vaza resolvida, até o próximo lance)
     roundResults histórico público das vazas desta mão (cada vaza tem `team` vencedora ou null no empate)
     lastHand     resumo público da última mão encerrada
     last / plays último lance e histórico público
     winner / winnerTeam / ranking preenchidos só quando a partida acaba
     seed         semente do embaralhamento determinístico das próximas mãos (nunca vai para a view)

   Cartas (ids únicos, strings): "<valor>-<naipe>", por exemplo "3-clubs", "7-hearts", "A-spades".
   Valores: 4, 5, 6, 7, Q, J, K, A, 2, 3. Naipes: clubs, hearts, spades, diamonds. */

export const PARTY = {
  minPlayers: 2,
  maxPlayers: 4,
  /* A mesa só existe com 2 (1×1) ou 4 (duplas 2×2); a Edge usa esta lista ao criar a sala. */
  playerCounts: [2, 4],
  order: "turns",
  turnSeconds: 40,
  turnOptions: [30, 40, 60],
  /* Estourar o tempo elimina quem estourou. No 1×1 a partida termina na hora; no 2×2 a dupla do eliminado
     perde a partida (o domínio fecha no lance seguinte), porque o banco não conhece as duplas. */
  onTimeout: "out",
  maxSeconds: 1800,
};

export const TARGET = 12;
export const RANKS = ["4", "5", "6", "7", "Q", "J", "K", "A", "2", "3"];
export const SUITS = ["clubs", "hearts", "spades", "diamonds"];
export const SUIT_NAMES = { clubs: "paus", hearts: "copas", spades: "espadas", diamonds: "ouros" };
export const SUIT_SYMBOLS = { clubs: "♣", hearts: "♥", spades: "♠", diamonds: "♦" };
export const RED_SUITS = ["hearts", "diamonds"];

/** Nome da dupla na mesa de 4. No 1×1 a interface usa o nome do próprio jogador. */
export const TEAM_NAMES = ["Dupla A", "Dupla B"];

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
export const TRUCO_NAMES = { 3: "Truco", 6: "Retruco", 9: "Vale nove", 12: "Vale doze" };

const isInt = value => Number.isInteger(value);
const seatsFromState = state => Array.from({ length: state.hands.length }, (_, i) => i + 1);
const handOf = (state, seat) => (isInt(seat) && seat >= 1 && seat <= state.hands.length ? state.hands[seat - 1] : []);

/** Dupla do assento: 1 e 3 → 0 (Dupla A); 2 e 4 → 1 (Dupla B). No 1×1, 1 → 0 e 2 → 1. */
export const teamOf = seat => (isInt(seat) && seat >= 1 ? (seat - 1) % 2 : null);

/** Assentos ativos (fora = eliminados pelo servidor). */
function activeSeatsOf(state, ctx = {}) {
  const out = Array.isArray(ctx.out) ? ctx.out : [];
  return seatsFromState(state).filter(seat => !out.includes(seat));
}

/** Próximo assento ativo depois de `from` (circular). */
function nextActiveSeat(state, from, ctx = {}) {
  const active = activeSeatsOf(state, ctx);
  if (!active.length) return null;
  return active.find(seat => seat > (from ?? 0)) ?? active[0];
}

/** Próximo adversário ativo (a dupla contrária) depois de `from`. */
function nextOpponentSeat(state, from, ctx = {}) {
  const team = teamOf(from);
  const rivals = activeSeatsOf(state, ctx).filter(seat => teamOf(seat) !== team);
  if (!rivals.length) return null;
  return rivals.find(seat => seat > from) ?? rivals[0];
}

/** Assento ativo que representa a dupla (preferindo `prefer`, se ainda estiver em jogo). */
function teamRepresentative(state, team, ctx = {}, prefer = null) {
  const active = activeSeatsOf(state, ctx);
  if (isInt(prefer) && active.includes(prefer) && teamOf(prefer) === team) return prefer;
  return active.find(seat => teamOf(seat) === team) ?? null;
}

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

/** A vaza já tem a carta de todos os assentos ativos? */
function roundComplete(state, ctx = {}) {
  if (!state.table.length) return false;
  const active = activeSeatsOf(state, ctx);
  if (!active.length) return false;
  const played = new Set(state.table.map(card => card.seat));
  return active.every(seat => played.has(seat));
}

/** Entrega 3 cartas para cada jogador e prepara a mão com o valor/estado pedido. */
function dealHand(state, { value, leader, phase = "playing", maoDeOnze = null, maoDeOnzeSeat = null, maoDeOnzeHand = false, maoDeFerro = false }, ctx = {}) {
  const seats = seatsFromState(state);
  const active = activeSeatsOf(state, ctx);
  const safeLeader = active.includes(leader) ? leader : active[0] ?? seats[0];
  const shuffled = seededShuffle(buildDeck(), state.seed);
  const hands = seats.map((_, index) => sortHand(shuffled.list.slice(index * 3, index * 3 + 3)));
  const handNo = state.handNo + 1;
  const safeMao = isInt(maoDeOnze) && active.includes(maoDeOnze) ? maoDeOnze : null;
  return {
    ...state,
    hands,
    seed: shuffled.seed,
    handNo,
    handValue: value,
    pending: null,
    phase,
    maoDeOnze: safeMao,
    maoDeOnzeSeat: isInt(maoDeOnzeSeat) && active.includes(maoDeOnzeSeat) ? maoDeOnzeSeat : safeMao,
    maoDeOnzeHand,
    maoDeFerro,
    trucoLocked: maoDeOnzeHand || maoDeFerro,
    nextRaiser: null,
    raiseReady: true,
    leader: safeLeader,
    turn: phase === "mao" ? safeMao ?? safeLeader : safeLeader,
    round: 1,
    roundLeader: safeLeader,
    roundWins: [0, 0],
    table: [],
    roundResults: [],
    last: { action: "deal", handNo, value, leader: safeLeader, maoDeOnze: safeMao, maoDeFerro },
  };
}

/** Partida nova. `seats` = [1,2] (1×1) ou [1,2,3,4] (2×2); `rng` = função 0..1 (no servidor, a seed secreta). */
export function partyStart({ seats, rng } = {}) {
  const n = Array.isArray(seats) ? seats.length : 0;
  const valid = (n === 2 || n === 4) && seats.every((seat, index) => seat === index + 1);
  if (!valid) throw new Error("bad_players");
  if (typeof rng !== "function") throw new Error("rng obrigatório");
  const seed = Math.floor(rng() * 0x100000000) >>> 0;
  const base = {
    hands: seats.map(() => []),
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
    winnerTeam: null,
    ranking: null,
    seed,
  };
  const state = dealHand(base, { value: 1, leader: 1 });
  return { state, turn: state.turn };
}

/** Decide a mão a partir das vazas. Devolve a DUPLA vencedora, null quando ninguém pontua,
    undefined quando ainda não acabou.
    Regras de empate adotadas: 1ª empatada → vence a 2ª; 2ª empatada → vence a 1ª; 1ª e 2ª empatadas → vence a 3ª;
    3ª empatada → vence a 1ª; as três empatadas → ninguém pontua. */
function decidedHand(roundResults) {
  const t = roundResults.map(result => result.team ?? null);
  if (t.length === 2) {
    if (t[0] != null && t[1] != null) return t[0] === t[1] ? t[0] : undefined;
    if (t[0] != null && t[1] == null) return t[0];
    if (t[0] == null && t[1] != null) return t[1];
    return undefined;
  }
  if (t.length >= 3) {
    if (t[2] != null) return t[2];
    if (t[0] != null && t[1] != null && t[0] !== t[1]) return t[0];
    return null;
  }
  return undefined;
}

/** Encerra a partida com o ranking das duplas (assentos ativos, melhor primeiro). */
function finishMatch(state, winner, lastHand, ctx = {}) {
  const active = activeSeatsOf(state, ctx);
  const winnerTeam = winner == null ? null : teamOf(winner);
  const group = winnerTeam == null
    ? active
    : active.filter(seat => teamOf(seat) === winnerTeam);
  const losers = winnerTeam == null
    ? []
    : active.filter(seat => teamOf(seat) !== winnerTeam);
  const ranking = winnerTeam == null ? [group] : [group, losers].filter(list => list.length);
  const safeWinner = winnerTeam == null ? null : (group.includes(winner) ? winner : group[0] ?? null);
  return {
    ...state,
    phase: "over",
    winner: safeWinner,
    winnerTeam,
    ranking,
    turn: null,
    pending: null,
    maoDeOnze: null,
    lastHand,
    last: { action: "match", winner: safeWinner, winnerTeam, handNo: lastHand?.handNo ?? state.handNo, points: state.points.slice() },
    plays: pushPlay(state.plays, { action: "match", winner: safeWinner, winnerTeam, handNo: lastHand?.handNo ?? state.handNo, points: state.points.slice() }),
  };
}

/** Alguém saiu/estourou o tempo: a dupla que ficou com menos jogadores perde a partida.
    Em 2×2 o Postgres elimina só o jogador (não conhece as duplas); o domínio fecha no lance seguinte.
    Se as duas duplas perderem um jogador, a partida termina empatada. */
function finishByElimination(state, ctx = {}) {
  const active = activeSeatsOf(state, ctx);
  const byTeam = [0, 1].map(team => active.filter(seat => teamOf(seat) === team));
  const draw = byTeam[0].length === byTeam[1].length && byTeam[0].length > 0;
  const winnerTeam = draw ? null : (byTeam[0].length > byTeam[1].length ? 0 : 1);
  const winner = winnerTeam == null ? null : byTeam[winnerTeam][0] ?? null;
  const ranking = winnerTeam == null
    ? [active]
    : [byTeam[winnerTeam], byTeam[1 - winnerTeam]].filter(list => list.length);
  const handRecord = {
    handNo: state.handNo,
    winner,
    team: winnerTeam,
    points: 0,
    reason: "elimination",
    rounds: [],
    out: Array.isArray(ctx.out) ? ctx.out.slice() : [],
  };
  return {
    ...state,
    phase: "over",
    winner,
    winnerTeam,
    ranking,
    turn: null,
    pending: null,
    maoDeOnze: null,
    lastHand: handRecord,
    last: { action: "match", winner, winnerTeam, handNo: state.handNo, points: state.points.slice(), reason: "elimination" },
    plays: pushPlay(state.plays, { action: "match", winner, winnerTeam, handNo: state.handNo, points: state.points.slice(), reason: "elimination" }),
  };
}

/** Fecha a mão, soma os pontos e prepara a próxima (mão de onze, mão de ferro ou mão normal). */
function finishHand(state, winner, awarded, reason, extra = {}, ctx = {}) {
  const previous = state.points.slice();
  const points = state.points.slice();
  const winnerTeam = winner == null ? null : teamOf(winner);
  if (winnerTeam != null) points[winnerTeam] += awarded;
  const handRecord = {
    handNo: state.handNo,
    winner: winner ?? null,
    team: winnerTeam,
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

  if (winner != null && winnerTeam != null && points[winnerTeam] >= TARGET) return finishMatch(next, winner, handRecord, ctx);

  const active = activeSeatsOf(state, ctx);
  const fallbackLeader = nextActiveSeat(state, state.leader, ctx) ?? active[0] ?? 1;
  const winningLeader = winner != null && active.includes(winner) ? winner : fallbackLeader;

  if (points[0] >= 11 && points[1] >= 11) {
    return dealHand(next, { value: 3, leader: winningLeader, maoDeFerro: true }, ctx);
  }

  const crossing = [0, 1].find(team => points[team] >= 11 && previous[team] < 11);
  if (crossing != null) {
    const decider = teamRepresentative(state, crossing, ctx, winningLeader);
    return dealHand(next, {
      value: 3,
      leader: decider ?? winningLeader,
      phase: "mao",
      maoDeOnze: decider,
      maoDeOnzeSeat: decider,
      maoDeOnzeHand: true,
    }, ctx);
  }

  return dealHand(next, { value: 1, leader: winningLeader }, ctx);
}

/** Corre da mão de onze: entrega 1 ponto à dupla adversária e prepara a próxima mão. */
function runMaoFold(state, seat, ctx = {}) {
  const team = teamOf(seat);
  const opponentTeam = team == null ? 0 : 1 - team;
  const opponent = teamRepresentative(state, opponentTeam, ctx, nextOpponentSeat(state, seat, ctx));
  const previous = state.points.slice();
  const points = state.points.slice();
  points[opponentTeam] += 1;
  const handRecord = {
    handNo: state.handNo,
    winner: opponent,
    team: opponentTeam,
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
      pushPlay(state.plays, { seat, action: "mao", choice: "fold", to: opponent, team: opponentTeam, points: 1 }),
      { action: "hand", ...handRecord, pointsAfter: points.slice() },
    ),
  };

  if (points[opponentTeam] >= TARGET) return finishMatch(withAction, opponent, handRecord, ctx);
  if (points[0] >= 11 && points[1] >= 11) {
    return dealHand(withAction, { value: 3, leader: opponent ?? 1, maoDeFerro: true }, ctx);
  }

  /* A pessoa que correu continua com a dupla em 11, mas a mão de onze não se repete:
     só o cruzamento de 10 para 11 a ativa. */
  return dealHand(withAction, { value: 1, leader: opponent ?? 1 }, ctx);
}

/** Resolve a vaza quando todos os assentos ativos já jogaram. */
function resolveRound(state, ctx = {}) {
  const active = activeSeatsOf(state, ctx);
  const plays = state.table.filter(play => active.includes(play.seat));
  const best = plays.reduce((max, play) => Math.max(max, strengthOf(play.card)), 0);
  const top = plays.filter(play => strengthOf(play.card) === best);
  const topTeams = [...new Set(top.map(play => teamOf(play.seat)))];
  const winnerTeam = topTeams.length === 1 ? topTeams[0] : null;
  const winner = winnerTeam == null ? null : top.find(play => teamOf(play.seat) === winnerTeam)?.seat ?? null;
  const lastSeat = state.table.at(-1)?.seat ?? null;
  const entry = { round: state.round, cards: state.table.slice(), winner, team: winnerTeam, tie: winner === null };
  const roundResults = [...state.roundResults, entry];
  const roundWins = state.roundWins.slice();
  if (winnerTeam != null) roundWins[winnerTeam] += 1;
  const nextLeader = winner ?? (active.includes(state.roundLeader) ? state.roundLeader : nextActiveSeat(state, state.roundLeader, ctx) ?? state.roundLeader);
  const resolved = {
    ...state,
    roundResults,
    roundWins,
    last: { action: "round", round: state.round, winner, team: winnerTeam, tie: winner === null, seat: lastSeat },
    plays: pushPlay(state.plays, { action: "round", round: state.round, winner, team: winnerTeam, tie: winner === null, seat: lastSeat }),
  };

  const decided = decidedHand(roundResults);
  if (decided !== undefined) {
    const decidedSeat = decided == null
      ? null
      : roundResults.find(result => result.team === decided)?.winner ?? null;
    const finished = finishHand(resolved, decidedSeat, decidedSeat ? resolved.handValue : 0, decidedSeat ? "hand" : "tie", {}, ctx);
    return {
      state: finished,
      turn: finished.turn,
      ranking: finished.ranking,
      move: resolved.last,
      reason: finished.ranking ? (decidedSeat ? "hand" : "tie") : null,
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

  /* Em 2×2, o banco elimina o jogador que estourou/saiu, mas não sabe das duplas. A dupla que perdeu
     um jogador não continua: a partida fecha no lance seguinte. No 1×1 o banco já encerra antes. */
  if (out.length) {
    const next = finishByElimination(state, ctx);
    return { state: next, turn: null, ranking: next.ranking, move: next.last, reason: "elimination" };
  }

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
      const next = runMaoFold(state, seat, ctx);
      return { state: next, turn: next.turn, ranking: next.ranking, move: { seat, action: "mao", choice: "fold" }, reason: next.ranking ? (next.lastHand?.reason ?? "mao_fold") : null };
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
      const next = finishHand(folded, challenger, pending.stake, "fold", { foldedBy: seat }, ctx);
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
      const responder = nextOpponentSeat(state, seat, ctx);
      if (responder == null) return null;
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
    if (state.nextRaiser != null && teamOf(state.nextRaiser) !== teamOf(seat)) return null;
    const value = nextTrucoValue(state.handValue);
    if (!value) return null;
    const responder = nextOpponentSeat(state, seat, ctx);
    if (responder == null) return null;
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
  if (roundComplete(state, ctx)) {       // a vaza anterior terminou: a mesa vira para a próxima
    table = [];
    roundLeader = seat;
  }
  if (!table.length) roundLeader = seat;
  table = [...table, { seat, card }];
  const playRecord = { seat, action: "play", card, round: state.round };
  let next = {
    ...state,
    hands,
    table,
    roundLeader,
    raiseReady: true,
    last: playRecord,
    plays: pushPlay(state.plays, playRecord),
  };

  const active = activeSeatsOf(state, ctx);
  const played = new Set(table.map(play => play.seat));
  if (!active.every(activeSeat => played.has(activeSeat))) {
    next.turn = nextActiveSeat(state, seat, ctx);
    return { state: next, turn: next.turn, ranking: null, move: next.last, reason: null };
  }

  return resolveRound(next, ctx);
}

/** Estouro de tempo no modo local: joga a carta mais fraca, aceita? não — corre de truco/mão de onze.
    No online (onTimeout: "out") o servidor elimina quem estourou; no 2×2 a dupla perde no lance seguinte. */
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
  const viewTurn = state.turn != null && !out.includes(state.turn)
    ? state.turn
    : (state.phase === "playing" && state.turn != null ? nextActiveSeat(state, state.turn, ctx) : state.turn ?? null);
  const teams = [0, 1].map(team => seats.filter(s => teamOf(s) === team));
  return {
    seat,
    team: teamOf(seat),
    teams,
    turn: viewTurn,
    phase: state.phase,
    hand,
    counts: seats.map(s => ({ seat: s, team: teamOf(s), cards: handOf(state, s).length, out: out.includes(s) })),
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
    winnerTeam: state.winnerTeam ?? (state.winner == null ? null : teamOf(state.winner)),
    ranking: state.ranking ?? null,
    canPlay: active && state.phase === "playing" && !pending && viewTurn === seat,
    canTruco: active && state.phase === "playing" && !pending && !state.trucoLocked && viewTurn === seat
      && state.handValue < 12 && state.raiseReady && (state.nextRaiser == null || teamOf(state.nextRaiser) === teamOf(seat)),
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
