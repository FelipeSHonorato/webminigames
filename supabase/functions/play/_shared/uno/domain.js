/* UNO — regras completas para 2 a 4 jogadores. Código puro (sem DOM, sem rede, sem Math.random/Date.now):
   roda igual no navegador, na Edge Function (Deno) e nos testes do Node.

   Estado (JSON puro):
     hands    array de mãos; índice = assento - 1 (assento 1 ocupa hands[0])
     deck     cartas viradas para baixo (a próxima a comprar é a última)
     discard  pilha de descarte (o topo é a última)
     color    cor atual (o curinga escolhe; o resto vale a cor da carta)
     dir      +1 sentido normal (assentos crescentes), -1 invertido
     turn     assento da vez
     seed     semente do embaralhamento determinístico do descarte (nunca vai para a view)
     drawn    null | { seat, card }: quem comprou e ainda pode jogar ou passar
     last     último lance público (sem revelar a carta comprada)
     plays    histórico público dos lances
     winner / ranking  preenchidos só quando a partida acaba

   Cartas (ids únicos, strings):
     "<cor>-<valor>"       cópia única do 0
     "<cor>-<valor>-1|2"   duas cópias dos demais números e ações
     "w-wild-1..4"         curingas
     "w-draw4-1..4"        curingas +4
   Cores: r (vermelho), y (amarelo), g (verde), b (azul). Valores: 0..9, skip, reverse, draw2, wild, draw4.

   Regras:
   • 108 cartas; 7 para cada jogador; a primeira do descarte não pode ser curinga (+4 também é curinga).
   • Joga-se uma carta da mesma cor ou do mesmo valor da mesa (curingas sempre; +4 só sem carta da cor atual).
   • Bloqueio pula o próximo; inverter muda o sentido (com 2 jogadores vale como bloqueio);
     +2 e +4 fazem o próximo comprar 2/4 e perder a vez.
   • Sem carta jogável, o jogador compra uma. Se ela servir, pode jogar (qualquer carta jogável) ou passar;
     se não servir, a vez passa automaticamente.
   • UNO automático: ao ficar com uma carta, o jogador já está "de UNO" (sem mecânica de pegar).
   • Vence quem zerar a mão. Os demais são classificados por quantidade de cartas (menos cartas, melhor). */

export const PARTY = {
  minPlayers: 2,
  maxPlayers: 4,
  order: "turns",
  turnSeconds: 45,
  turnOptions: [30, 45, 60],
  onTimeout: "skip",
  maxSeconds: 1200,
};

export const COLORS = ["r", "y", "g", "b"];
export const COLOR_NAMES = { r: "Vermelho", y: "Amarelo", g: "Verde", b: "Azul" };
export const COLOR_FILES = { r: "vermelho", y: "amarelo", g: "verde", b: "azul" };
export const VALUES = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "skip", "reverse", "draw2"];
export const VALUE_NAMES = { skip: "Bloqueio", reverse: "Inverter", draw2: "+2", wild: "Curinga", draw4: "Curinga +4" };
const VALUE_FILES = { skip: "bloqueio", reverse: "inverter", draw2: "mais2" };
const ACTION_VALUES = ["skip", "reverse", "draw2"];
const WILD_FILES = ["coringa_vermelho.png", "coringa_amarelo.png", "coringa_verde.png", "coringa_azul.png"];

const isInt = value => Number.isInteger(value);

/** Carta a partir do id. Devolve null para id inválido. */
export function cardOf(id) {
  if (typeof id !== "string") return null;
  if (id.startsWith("w-")) {
    const [, value, variantText] = id.split("-");
    const variant = Number(variantText);
    if ((value !== "wild" && value !== "draw4") || !isInt(variant) || variant < 1 || variant > 4) return null;
    return { id, color: null, value, variant, wild: true };
  }
  const [color, value, variantText] = id.split("-");
  if (!COLORS.includes(color)) return null;
  if (!VALUES.includes(value)) return null;
  const variant = variantText == null ? 1 : Number(variantText);
  if (!isInt(variant) || variant < 1 || variant > 2) return null;
  if (value === "0" && variant !== 1) return null;
  return { id, color, value, variant, wild: false };
}

export const isWild = id => Boolean(cardOf(id)?.wild);
export const isWildCard = isWild;
export const cardColor = id => cardOf(id)?.color ?? null;
export const cardValue = id => cardOf(id)?.value ?? null;

/** Nome legível da carta, para aria-label e histórico. */
export function cardName(id) {
  const card = cardOf(id);
  if (!card) return "Carta";
  if (card.value === "wild") return "Curinga";
  if (card.value === "draw4") return "Curinga +4";
  const value = VALUE_NAMES[card.value] ?? card.value;
  return `${COLOR_NAMES[card.color]} ${value}`;
}

/** Arquivo da imagem em games/uno/cards/ (o baralho físico tem duas artes para números/ações). */
export function cardImage(id) {
  const card = cardOf(id);
  if (!card) return "costa_cartas.png";
  if (card.value === "wild") return WILD_FILES[(card.variant - 1) % WILD_FILES.length];
  if (card.value === "draw4") return `coringa_mais4_${card.variant}.png`;
  const value = VALUE_FILES[card.value] ?? card.value;
  return `${COLOR_FILES[card.color]}_${value}${card.variant === 2 ? "_2" : ""}.png`;
}

/** Baralho completo de 108 cartas, na ordem canônica. */
export function buildDeck() {
  const deck = [];
  for (const color of COLORS) {
    deck.push(`${color}-0`);
    for (const value of VALUES) {
      if (value === "0") continue;
      deck.push(`${color}-${value}-1`, `${color}-${value}-2`);
    }
  }
  for (let i = 1; i <= 4; i++) {
    deck.push(`w-wild-${i}`, `w-draw4-${i}`);
  }
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

/** Embaralha com a LCG guardada no estado (descarte reaproveitado é determinístico). */
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

/** Compra `count` cartas; se o monte acabar, reembaralha o descarte (menos o topo). */
function drawFrom(deck0, discard0, seed0, count) {
  let deck = deck0.slice();
  let discard = discard0.slice();
  let seed = seed0 >>> 0;
  const cards = [];
  for (let i = 0; i < count; i++) {
    if (!deck.length) {
      if (discard.length <= 1) break;
      const top = discard[discard.length - 1];
      const shuffled = seededShuffle(discard.slice(0, -1), seed);
      deck = shuffled.list;
      seed = shuffled.seed;
      discard = [top];
    }
    cards.push(deck.pop());
  }
  return { cards, deck, discard, seed };
}

/** Próximo assento ativo, andando `steps` casas no sentido `dir`, pulando eliminados. */
export function seatAfter(state, from, steps, dir = 1, out = []) {
  const n = state.hands.length;
  const active = Array.from({ length: n }, (_, i) => i + 1).filter(seat => !out.includes(seat));
  if (!active.length) return null;
  const fromIndex = Math.max(0, active.indexOf(from));
  const move = dir === -1 ? -1 : 1;
  let index = fromIndex;
  for (let i = 0; i < Math.max(0, steps | 0); i++) {
    index = (index + move + active.length) % active.length;
  }
  return active[index];
}

const seatsFromState = state => Array.from({ length: state.hands.length }, (_, i) => i + 1);
const handOf = (state, seat) => (isInt(seat) && seat >= 1 && seat <= state.hands.length ? state.hands[seat - 1] : []);

function giveCards(state, seat, cards) {
  if (!cards.length) return state;
  const hands = state.hands.slice();
  hands[seat - 1] = [...hands[seat - 1], ...cards];
  return { ...state, hands };
}

/** Aplica o efeito da carta inicial (bloqueio/inverter/+2), como se ela tivesse sido virada na mesa. */
function applyOpeningCard(state) {
  const value = cardValue(state.discard[state.discard.length - 1]);
  if (value === "skip") return { ...state, turn: seatAfter(state, 1, 1, 1, []) };
  if (value === "reverse") {
    if (state.hands.length === 2) return { ...state, turn: 2 };
    return { ...state, dir: -1, turn: state.hands.length };
  }
  if (value === "draw2") {
    const draw = drawFrom(state.deck, state.discard, state.seed, 2);
    const hands = state.hands.slice();
    hands[0] = [...hands[0], ...draw.cards];
    return { ...state, hands, deck: draw.deck, discard: draw.discard, seed: draw.seed, turn: seatAfter(state, 1, 1, 1, []) };
  }
  return state;
}

/** Partida nova. `seats` = [1..n]; `rng` = função 0..1 (no servidor, a seed secreta). */
export function partyStart({ seats, rng } = {}) {
  if (!Array.isArray(seats) || seats.length < PARTY.minPlayers || seats.length > PARTY.maxPlayers) throw new Error("bad_players");
  if (typeof rng !== "function") throw new Error("rng obrigatório");
  const deck = shuffle(buildDeck(), rng);
  const hands = seats.map(() => deck.splice(0, 7));
  let top = deck.pop();
  while (top && isWild(top)) {          // a mesa nunca começa com curinga (nem +4)
    deck.unshift(top);
    top = deck.pop();
  }
  const seed = Math.floor(rng() * 0x100000000) >>> 0;
  let state = {
    hands,
    deck,
    discard: [top],
    color: cardColor(top),
    dir: 1,
    turn: 1,
    seed,
    drawn: null,
    last: null,
    plays: [],
    winner: null,
    ranking: null,
  };
  state = applyOpeningCard(state);
  return { state, turn: state.turn };
}

/** Regra central, também usada na view (sem o estado completo): cor igual, valor igual ou curinga. */
export function canPlayCard(hand = [], cardId, color, topId = null) {
  const card = cardOf(cardId);
  if (!card) return false;
  if (card.value === "wild") return true;
  if (card.value === "draw4") return !hand.some(id => cardColor(id) === color);
  return card.color === color || card.value === cardOf(topId)?.value;
}

/** A carta da mesa pode ser jogada por `seat`? (o +4 exige não ter carta da cor atual) */
export function isPlayable(state, cardId, seat = null) {
  const card = cardOf(cardId);
  if (!card) return false;
  const hand = isInt(seat) ? handOf(state, seat) : null;
  return canPlayCard(hand ?? (state.hands.find(list => list.includes(cardId)) ?? []), cardId, state.color, topCard(state));
}

/** Mesma regra usando só a view do assento (o navegador online nunca recebe o estado inteiro). */
export const isViewPlayable = (view, cardId) => canPlayCard(view?.hand ?? [], cardId, view?.color, view?.top);

/** Ids da mão de `seat` que podem ser jogados agora. */
export function playableCards(state, seat) {
  return handOf(state, seat).filter(id => isPlayable(state, id, seat));
}

export const topCard = state => state.discard[state.discard.length - 1] ?? null;
export const handCount = (state, seat) => handOf(state, seat).length;

/** Classificação: vencedor primeiro; os demais em grupos de mesma quantidade de cartas. */
function rankingGroups(state, seats, out) {
  const groups = new Map();
  for (const seat of seats) {
    if (out.includes(seat)) continue;
    const count = handOf(state, seat).length;
    if (!groups.has(count)) groups.set(count, []);
    groups.get(count).push(seat);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, group]) => group.sort((a, b) => a - b));
}

function rankingOf(state, winner, seats, out) {
  return [[winner], ...rankingGroups(state, seats.filter(seat => seat !== winner), out)];
}

/** Executa um lance. Devolve null para lance ilegal. `ctx = { seats, out }`. */
export function partyMove(state, seat, input, ctx = {}) {
  const seats = Array.isArray(ctx.seats) && ctx.seats.length ? ctx.seats : seatsFromState(state);
  const out = Array.isArray(ctx.out) ? ctx.out : [];
  if (!seats.includes(seat) || out.includes(seat)) return null;
  if (state.winner != null) return null;
  if (state.turn !== seat) return null;

  const action = input?.action;
  const hand = handOf(state, seat);

  if (action === "draw") {
    if (state.drawn) return null;                     // já comprou neste turno
    const draw = drawFrom(state.deck, state.discard, state.seed, 1);
    if (!draw.cards.length) {
      /* Caso extremo: todas as 108 cartas estão nas mãos e não há o que comprar. Encerra pela menor mão. */
      const ranking = rankingGroups(state, seats, out);
      const stalled = {
        ...state,
        turn: null,
        winner: null,
        ranking,
        drawn: null,
        last: { seat, action: "stalled" },
        plays: [...state.plays, { seat, action: "stalled" }].slice(-80),
      };
      return { state: stalled, turn: null, ranking, move: stalled.last, reason: "stalled" };
    }
    const card = draw.cards[0];
    let next = {
      ...state,
      deck: draw.deck,
      discard: draw.discard,
      seed: draw.seed,
      hands: state.hands.slice(),
      drawn: null,
    };
    next.hands[seat - 1] = [...hand, card];
    if (isPlayable(next, card, seat)) {
      next.drawn = { seat, card };
      next.last = { seat, action: "draw", playable: true };
      return { state: next, turn: seat, ranking: null, move: next.last, reason: null };
    }
    next.turn = seatAfter(next, seat, 1, next.dir, out);
    next.last = { seat, action: "draw", playable: false };
    return { state: next, turn: next.turn, ranking: null, move: next.last, reason: null };
  }

  if (action === "pass") {
    if (!state.drawn || state.drawn.seat !== seat) return null;
    const next = {
      ...state,
      drawn: null,
      turn: seatAfter(state, seat, 1, state.dir, out),
      last: { seat, action: "pass" },
      plays: [...state.plays, { seat, action: "pass" }],
    };
    return { state: next, turn: next.turn, ranking: null, move: next.last, reason: null };
  }

  if (action !== "play") return null;
  const cardId = input?.card;
  if (!hand.includes(cardId) || !isPlayable(state, cardId, seat)) return null;
  const card = cardOf(cardId);
  const color = card.wild ? input?.color : card.color;
  if (card.wild && !COLORS.includes(color)) return null;

  const hands = state.hands.slice();
  hands[seat - 1] = hand.filter(id => id !== cardId);
  const record = { seat, action: "play", card: cardId, color };
  let next = {
    ...state,
    hands,
    discard: [...state.discard, cardId],
    color,
    drawn: null,
    last: record,
    plays: [...state.plays, record].slice(-80),
  };

  if (!hands[seat - 1].length) {
    const ranking = rankingOf(next, seat, seats, out);
    next = { ...next, turn: null, winner: seat, ranking };
    return { state: next, turn: null, ranking, move: record, reason: "uno" };
  }

  let target = null;
  let drawCount = 0;
  if (card.value === "skip") {
    next.turn = seatAfter(next, seat, 2, next.dir, out);
  } else if (card.value === "reverse") {
    next.dir = next.dir * -1;
    next.turn = seatAfter(next, seat, next.hands.length === 2 ? 2 : 1, next.dir, out);
  } else if (card.value === "draw2" || card.value === "draw4") {
    drawCount = card.value === "draw2" ? 2 : 4;
    target = seatAfter(next, seat, 1, next.dir, out);
    const draw = drawFrom(next.deck, next.discard, next.seed, drawCount);
    next = { ...next, deck: draw.deck, discard: draw.discard, seed: draw.seed };
    next = giveCards(next, target, draw.cards);
    next.turn = seatAfter(next, seat, 2, next.dir, out);
    record.target = target;
    record.amount = drawCount;
    next.last = record;
  } else {
    next.turn = seatAfter(next, seat, 1, next.dir, out);
  }

  return { state: next, turn: next.turn, ranking: null, move: next.last, reason: null };
}

/** Estouro de tempo no modo local (a Edge/Postgres já cuida do tempo no online). */
export function timeoutTurn(state, seat, ctx = {}) {
  const seats = Array.isArray(ctx.seats) ? ctx.seats : seatsFromState(state);
  const out = Array.isArray(ctx.out) ? ctx.out : [];
  if (state.winner != null || state.turn !== seat || !seats.includes(seat) || out.includes(seat)) return null;
  const next = {
    ...state,
    drawn: null,
    turn: seatAfter(state, seat, 1, state.dir, out),
    last: { seat, action: "timeout" },
    plays: [...state.plays, { seat, action: "timeout" }].slice(-80),
  };
  return next;
}

/** Visão do assento: mão própria, topo e contagens públicas. NUNCA devolve deck, seed ou mãos alheias. */
export function partyView(state, seat, ctx = {}) {
  const seats = Array.isArray(ctx.seats) && ctx.seats.length ? ctx.seats : seatsFromState(state);
  const out = Array.isArray(ctx.out) ? ctx.out : [];
  const hand = handOf(state, seat).slice();
  return {
    seat,
    turn: state.turn ?? null,
    dir: state.dir,
    color: state.color,
    top: topCard(state),
    hand,
    drawn: state.drawn?.seat === seat ? state.drawn.card : null,
    counts: seats.map(s => {
      const count = handOf(state, s).length;
      return { seat: s, cards: count, uno: count === 1, out: out.includes(s) };
    }),
    deck: state.deck.length,
    discard: state.discard.length,
    canDraw: state.winner == null && state.turn === seat && !state.drawn,
    canPass: state.winner == null && state.turn === seat && state.drawn?.seat === seat,
    last: state.last ?? null,
    plays: (state.plays ?? []).slice(-8),
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
