/* Partidas com 2 ou mais jogadores ("party") — regras puras, SEM DOM e SEM imports.
   Este arquivo existe em duas cópias IDÊNTICAS: `shared/party.js` (navegador e testes) e
   `supabase/functions/play/_shared/party.js` (Edge). `tests/edge.test.js` falha se divergirem — edite sempre os dois.

   Vocabulário (o mesmo do SQL, migração 20261053000000):
     assento (seat)   número 1..n de cada jogador na partida (sem buracos depois do lançamento);
     vez (turn)       assento que joga agora (`null` no modo "free", em que todos jogam ao mesmo tempo);
     eliminado (out)  quem desistiu, saiu ou estourou o tempo (`onTimeout: "out"`); não joga mais;
     ranking          grupos de assentos ATIVOS, melhor primeiro: [[3], [1, 2], [4]] = 3 vence, 1 e 2 empatam em 2º.
   Colocação por empate "de competição": [[3],[1,2],[4]] => 3:1º, 1:2º, 2:2º, 4:4º. */

export const PARTY_MIN = 2;
export const PARTY_MAX = 12;
/** Contagem entre "todos prontos" e a largada (igual ao 1×1: `starts_at = now() + 4 s` no SQL). */
export const START_DELAY_MS = 4000;

const isInt = v => Number.isInteger(v);
const uniqSorted = list => [...new Set(list)].sort((a, b) => a - b);

/* ------------------------------------------------------------------------------------------------
   Contrato do domínio
   Um jogo para 2+ jogadores exporta, no domain.js:

     export const PARTY = {
       minPlayers: 3, maxPlayers: 6,
       order: "turns",                 // "turns" (vez a vez) | "free" (todos ao mesmo tempo)
       turnSeconds: 60,                // tempo por jogada (null = sem limite)
       turnOptions: [30, 60, 120],     // opções que o criador pode escolher (opcional; padrão = só turnSeconds)
       onTimeout: "skip",              // "skip" passa a vez | "out" elimina quem estourou
       maxSeconds: 1800,               // parada sem lances por este tempo => a limpeza cancela
     };
     export function partyStart({ seats, rng }) { return { state, turn }; }       // sorteios aqui (rng = 0..1)
     export function partyMove(state, seat, input, ctx) { return null | { state, turn, ranking, move, reason }; }
     export function partyView(state, seat, ctx) { return { ... }; }               // o que ESTE assento pode ver

   `ctx = { seats: [1..n], out: [assentos eliminados] }`. O estado é JSON puro (sem Map/Set/Date). `partyMove` devolve
   `null` para lance ilegal; `ranking` só quando a partida acabou; `turn` é o próximo assento ATIVO (modo turns).
   `partyView` nunca devolve o que é escondido dos outros (mãos, cartas viradas para baixo...). */
export function partyContract(domain) {
  const p = domain?.PARTY;
  if (!p || typeof p !== "object") return null;
  if (typeof domain.partyStart !== "function" || typeof domain.partyMove !== "function" || typeof domain.partyView !== "function") return null;
  const min = p.minPlayers, max = p.maxPlayers;
  if (!isInt(min) || !isInt(max) || min < PARTY_MIN || max < min || max > PARTY_MAX) return null;
  const order = p.order === "free" ? "free" : p.order === "turns" ? "turns" : null;
  if (!order) return null;
  const okSeconds = v => isInt(v) && v >= 5 && v <= 3600;
  const turnSeconds = p.turnSeconds == null ? null : okSeconds(p.turnSeconds) ? p.turnSeconds : undefined;
  if (turnSeconds === undefined) return null;
  const onTimeout = p.onTimeout === "out" ? "out" : "skip";
  const maxSeconds = isInt(p.maxSeconds) && p.maxSeconds >= 30 && p.maxSeconds <= 3600 ? p.maxSeconds : 1800;
  const options = Array.isArray(p.turnOptions) ? p.turnOptions.filter(okSeconds) : [];
  const turnOptions = order === "turns" ? uniqSorted(turnSeconds == null ? options : [...options, turnSeconds]) : [];
  return { minPlayers: min, maxPlayers: max, order, turnSeconds: order === "turns" ? turnSeconds : null, turnOptions, onTimeout, maxSeconds };
}

/* ------------------------------------------------------------------------------------------------
   Assentos e vez (espelha party_next_seat do SQL)
   ------------------------------------------------------------------------------------------------ */

/** Assentos 1..n. */
export const seatsOf = n => Array.from({ length: Math.max(0, n | 0) }, (_, i) => i + 1);

/** Assentos ainda em jogo. */
export const activeSeats = (seats = [], out = []) => seats.filter(s => !out.includes(s));

/** Próximo assento ativo depois de `from` (circular); `null` se não sobrou ninguém. */
export function nextSeat(seats = [], out = [], from = 0) {
  const live = activeSeats(seats, out).sort((a, b) => a - b);
  if (!live.length) return null;
  return live.find(s => s > from) ?? live[0];
}

/* ------------------------------------------------------------------------------------------------
   Ranking
   ------------------------------------------------------------------------------------------------ */

/** Ranking válido: lista de grupos não vazios, cada assento ativo exatamente uma vez, nenhum assento de fora. */
export function validateRanking(ranking, active = []) {
  if (!Array.isArray(ranking) || !ranking.length) return false;
  const seen = [];
  for (const group of ranking) {
    if (!Array.isArray(group) || !group.length) return false;
    for (const seat of group) {
      if (!isInt(seat) || !active.includes(seat) || seen.includes(seat)) return false;
      seen.push(seat);
    }
  }
  return seen.length === active.length;
}

/** Colocação de cada assento: `Map(assento -> 1º, 2º...)`. Empatados dividem a colocação (como o SQL). */
export function placementsOf(ranking = []) {
  const out = new Map();
  let place = 1;
  for (const group of ranking) {
    for (const seat of group) out.set(seat, place);
    place += group.length;
  }
  return out;
}

/** Vencedor único (1º grupo com um só assento) ou `null` em empate no topo. */
export const soleWinner = (ranking = []) => (ranking[0]?.length === 1 ? ranking[0][0] : null);

/**
 * Roda um lance do domínio e confere o que ele devolveu (a Edge usa isto antes de gravar no Postgres).
 * Lança `invalid_move` (lance ilegal) ou `bad_domain_result` (o domínio devolveu algo que o banco recusaria).
 */
export function runPartyMove(domain, state, seat, input, { seats, out = [] } = {}) {
  const contract = partyContract(domain);
  if (!contract) throw new Error("not_party_game");
  const active = activeSeats(seats, out);
  if (!active.includes(seat)) throw new Error("invalid_move");
  const ctx = { seats, out };
  const result = domain.partyMove(state, seat, input, ctx);
  if (!result) throw new Error("invalid_move");
  if (!result.state || typeof result.state !== "object") throw new Error("bad_domain_result");

  const ranking = result.ranking ?? null;
  if (ranking) {
    if (!validateRanking(ranking, active)) throw new Error("bad_domain_result");
    return { state: result.state, turn: null, ranking, move: result.move ?? null, reason: result.reason ?? "ended" };
  }
  let turn = null;
  if (contract.order === "turns") {
    turn = result.turn;
    if (!isInt(turn) || !active.includes(turn)) throw new Error("bad_domain_result");
  }
  return { state: result.state, turn, ranking: null, move: result.move ?? null, reason: null };
}

/* ------------------------------------------------------------------------------------------------
   Sala: o que o navegador mostra (a sala vem de `party_json`)
   ------------------------------------------------------------------------------------------------ */

const playersOf = room => (Array.isArray(room?.players) ? room.players : []);

/** "3/4 jogadores" (sala em espera) ou "3 a 6 jogadores" quando só há o contrato. */
export function slotsLabel(room) {
  const n = Number(room?.players?.length ?? room?.players);
  const max = Number(room?.maxPlayers), min = Number(room?.minPlayers);
  if (Number.isFinite(n) && Number.isFinite(max) && max > 0) return `${n}/${max} jogadores`;
  if (Number.isFinite(min) && Number.isFinite(max)) return min === max ? `${max} jogadores` : `${min} a ${max} jogadores`;
  return "";
}

/** "1º", "2º"... */
export const ordinal = n => (Number.isInteger(n) && n > 0 ? `${n}º` : "");

/** Situação do lobby do ponto de vista de quem vê: quantos faltam, quem não está pronto, quem pode iniciar. */
export function lobbyStatus(room) {
  const players = playersOf(room);
  const min = Number(room?.minPlayers) || PARTY_MIN;
  const max = Number(room?.maxPlayers) || min;
  const missing = Math.max(0, min - players.length);
  const notReady = players.filter(p => !p.ready);
  const me = players.find(p => p.is_me) ?? null;
  const isHost = Boolean(me?.host);
  /* `inside` vem do heartbeat do servidor (party_json); ausente = dentro, para salas antigas/testes. */
  const away = players.filter(p => p.inside === false);
  const allInside = away.length === 0;
  const canLaunch = room?.status === "waiting" && missing === 0 && notReady.length === 0;
  return {
    count: players.length, min, max, missing, notReady, me, isHost, canLaunch,
    free: Math.max(0, max - players.length),
    away, allInside,
    /** Iniciar manualmente: só o criador, com todos prontos, o mínimo atingido e todos dentro do jogo. */
    canStart: isHost && canLaunch && allInside,
    /** Largada automática: sala lotada, todos prontos e todos já dentro do jogo. */
    autoStart: canLaunch && players.length >= max && allInside,
  };
}

/** Frase de apoio do lobby. */
export function lobbyHint(room) {
  const s = lobbyStatus(room);
  if (room?.status && room.status !== "waiting") return "";
  if (s.missing > 0) return s.missing === 1 ? "Falta 1 jogador para poder começar." : `Faltam ${s.missing} jogadores para poder começar.`;
  if (s.notReady.length) {
    const names = s.notReady.map(p => p.nickname || "Jogador");
    return names.length === 1 ? `Esperando ${names[0]} ficar pronto.` : `Esperando ${names.length} jogadores ficarem prontos.`;
  }
  if (!s.allInside) {
    const names = s.away.map(p => p.nickname || "Jogador");
    if (names.length === 1) {
      return s.count >= s.max
        ? `Sala completa. Esperando ${names[0]} entrar no jogo.`
        : `Esperando ${names[0]} entrar no jogo.`;
    }
    return s.count >= s.max
      ? `Sala completa. Esperando ${names.length} jogadores entrarem no jogo.`
      : `Esperando ${names.length} jogadores entrarem no jogo.`;
  }
  if (s.autoStart) return "Sala cheia e todos prontos: a partida já vai começar.";
  return s.isHost ? "Todos prontos. Inicie agora ou espere mais jogadores (até " + s.max + ")." : "Todos prontos. Esperando o criador iniciar.";
}

/** Resultado do ponto de vista de `uid`: "idle" | "running" | "cancelled" | "win" | "tie" | "placed" | "out". */
export function partyOutcome(room, uid) {
  if (!room) return "idle";
  if (room.status === "cancelled") return "cancelled";
  if (room.status !== "finished") return "running";
  const me = playersOf(room).find(p => p.user_id === uid || p.is_me);
  if (!me || !Number.isInteger(me.placement)) return "placed";
  if (me.placement === 1) return room.winner ? "win" : "tie";
  return "placed";
}

/** Texto do resultado. */
export function outcomeText(outcome, placement) {
  switch (outcome) {
    case "win": return "Você venceu!";
    case "tie": return "Empate no 1º lugar.";
    case "placed": return placement ? `Você ficou em ${ordinal(placement)} lugar.` : "Partida encerrada.";
    case "cancelled": return "Partida cancelada.";
    case "running": return "Em andamento…";
    default: return "";
  }
}

/** Classificação final em linhas prontas: [{ place, nickname, seat, me }] da melhor para a pior colocação. */
export function standings(room) {
  return playersOf(room)
    .filter(p => Number.isInteger(p.placement))
    .map(p => ({ place: p.placement, nickname: p.nickname || "Jogador", seat: p.seat, me: Boolean(p.is_me), out: Boolean(p.out) }))
    .sort((a, b) => a.place - b.place || a.seat - b.seat);
}

/** Milissegundos até um instante ISO, corrigidos pelo relógio do servidor (`serverOffset` em ms). */
export const msUntil = (iso, now = Date.now(), serverOffset = 0) => (iso ? Math.max(0, Date.parse(iso) - (now + serverOffset)) : 0);
