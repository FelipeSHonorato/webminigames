/* Salas Online (salas-online.html): lista das salas de duelo que esperam um desafiante.
   Só funções puras — limpeza da lista, filtro por jogo, hash e textos. O DOM fica em `js/salas.js`.
   O filtro lateral é um item "Todos" + um item por jogo de duelo do catálogo (`duel: true`), o mesmo
   critério do hub (`shared/hub-nav.js`), então um jogo novo de duelo aparece aqui sem mexer nesta página. */
import { hasRooms } from "./hub-nav.js";
import { rankLabel } from "../games/go/domain.js";

export const ALL = "all";

/** Ids dos jogos de duelo do catálogo, na ordem do catálogo. */
export const duelIds = (games = {}) => Object.entries(games).filter(([, game]) => hasRooms(game)).map(([id]) => id);   // duelo 1×1 e multijogador

/** Salas válidas: só de jogos de duelo que o catálogo conhece, da mais nova para a mais antiga. */
export function cleanRooms(raw, games = {}) {
  const known = new Set(duelIds(games));
  const time = room => Date.parse(room.createdAt) || 0;
  return (Array.isArray(raw) ? raw : [])
    .filter(room => room && typeof room.id === "string" && known.has(room.gameId))
    .sort((a, b) => time(b) - time(a));
}

/** Itens da lateral: "Todos" e um por jogo de duelo, cada um com o número de salas abertas. */
export function filterItems(games = {}, rooms = []) {
  return [
    { id: ALL, label: "Todos", count: rooms.length },
    ...duelIds(games).map(id => ({ id, label: games[id].title ?? id, count: rooms.filter(r => r.gameId === id).length })),
  ];
}

/** Salas do filtro escolhido (preserva a ordem). */
export const roomsOf = (rooms = [], filter = ALL) => (filter === ALL ? rooms : rooms.filter(room => room.gameId === filter));

/** Filtro a partir do endereço (`#chess`); valor desconhecido cai em "Todos". */
export function filterFromHash(hash = "", games = {}) {
  const value = String(hash).replace(/^#/, "").toLowerCase();
  return duelIds(games).find(id => id.toLowerCase() === value) ?? ALL;
}

/** Hash do filtro (vazio em "Todos", para não sujar o endereço). */
export const hashForFilter = filter => (filter === ALL ? "" : `#${filter}`);

/** Título e subtítulo da seção, trocados ao filtrar. */
export function filterText(filter = ALL, games = {}) {
  const title = games[filter]?.title;
  if (!title) {
    return {
      title: "Salas online",
      sub: "Salas criadas por outros jogadores que estão esperando um desafiante. Escolha um jogo na lateral para filtrar.",
    };
  }
  return { title: `Salas de ${title}`, sub: `Salas abertas de ${title} esperando um desafiante.` };
}

/** "agora", "há 5 min", "há 2 h": há quanto tempo a sala foi aberta. */
export function openedAgo(createdAt, now = Date.now()) {
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return "";
  const minutes = Math.max(0, Math.floor((now - t) / 60000));
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  return `há ${Math.floor(minutes / 60)} h`;
}

/** Tempo da partida ("10 min"). Vem de `maxSeconds`; sem valor válido, nada. */
export function durationLabel(room) {
  const seconds = Number(room?.maxSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  return seconds < 60 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`;
}

/** Sala aberta: qualquer jogador entra pela lista. Resposta antiga sem o campo conta como aberta. */
export const isOpenRoom = room => room?.open !== false;

/** Sala de OUTRO jogador em que dá para clicar e entrar direto (aberta e com página no catálogo). */
export function joinableRoom(room, games = {}) {
  const path = games[room?.gameId]?.path;
  if (!room || room.mine || !isOpenRoom(room)) return false;
  return Boolean(path) && typeof room.id === "string";
}

/** Link para reabrir uma sala MINHA (a tela do código de convite). Sala de outro jogador: "". */
export function roomHref(room, games = {}) {
  const path = games[room?.gameId]?.path;
  if (!room?.mine || !path || typeof room.id !== "string") return "";
  return `${path}?duelo=${encodeURIComponent(room.id)}`;
}

/** Pontuação do criador no ranking daquele jogo, como no ranking de duelos ("1520 Elo").
    No Go o rating vira o grau tradicional ("15 kyu"). Sem valor válido: "". */
export function ratingLabel(room) {
  const rating = Number(room?.host?.rating);
  if (!Number.isFinite(rating) || rating <= 0) return "";
  return room?.gameId === "go" ? rankLabel(rating) : `${Math.round(rating)} Elo`;
}

/** Vagas da sala ("2/4 jogadores"). Só salas com mais de 2 vagas (multijogador); o duelo 1×1 não mostra. */
export function slotsLabel(room) {
  const max = Number(room?.maxPlayers), n = Number(room?.players);
  if (!Number.isFinite(max) || max <= 2 || !Number.isFinite(n)) return "";
  return `${n}/${max} jogadores`;
}
