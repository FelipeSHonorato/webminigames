/* TRUCO PAULISTA 2–4 JOGADORES — mesa, mão e ações de truco no navegador.
   2 jogadores jogam 1×1; 4 jogadores jogam em duplas 2×2, com parceiros em assentos opostos.
   Toda a regra vem de ./domain.js (código puro, testado). Dois modos usam a MESMA mesa:
   • local (hot-seat): 2 ou 4 jogadores no mesmo aparelho; a mesa gira para o jogador da vez ficar embaixo e
     uma tela de "passar o dispositivo" esconde a mão entre um turno e outro;
   • online: sala por código; mãos, vez, tempo e ranking são decididos pela Edge + Postgres
     (shared/party-session.js + shared/party-ui.js). O navegador só recebe a visão do próprio assento. */
import "../../shared/backend/boot.js";
import { getSession } from "../../shared/session.js";
import { mountUserBar } from "../../js/userbar.js";
import { mountTemplatePicker } from "../../shared/template-picker.js";
import { Music } from "../../shared/music.js";
import { Cloud } from "../../shared/backend/cloud.js";
import { createPartySession } from "../../shared/party-session.js";
import { mountPartyUi, turnBanner } from "../../shared/party-ui.js";
import { ACCEPT_EVENT } from "../../shared/duel-invites.js";
import { avatarNode } from "../../shared/avatar.js";
import { isDuelCode, normalizeCode } from "../../shared/duel-hub.js";
import {
  PARTY, RED_SUITS, SUIT_SYMBOLS, TEAM_NAMES, TRUCO_NAMES,
  cardName, cardOf, cardShort, isManilha, manilhaName, nextTrucoValue,
  partyMove, partyStart, partyView, placements, teamOf, timeoutTurn,
} from "./domain.js";

const GAME_ID = "truco";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLOCK_TICK = 250;

const $ = id => document.getElementById(id);
const els = {
  setup: $("setup"), playerOptions: $("playerOptions"), timeOptions: $("timeOptions"), roomOptions: $("roomOptions"),
  formatTitle: $("formatTitle"), formatNote: $("formatNote"),
  startLocal: $("startLocal"), createRoom: $("createRoom"), duelNotice: $("duelNotice"),
  partyHost: $("partyHost"), game: $("game"), status: $("status"), main: document.querySelector("main"),
  tableGrid: document.querySelector(".table-grid"),
  leftPlayer: $("leftPlayer"), topPlayer: $("topPlayer"), rightPlayer: $("rightPlayer"), bottomPlayer: $("bottomPlayer"),
  scoreboard: $("scoreboard"),
  handNo: $("handNo"), handValue: $("handValue"), roundInfo: $("roundInfo"), turnTimer: $("turnTimer"),
  tableCards: $("tableCards"), roundResult: $("roundResult"), hint: $("hint"),
  trucoBtn: $("trucoBtn"), acceptBtn: $("acceptBtn"), raiseBtn: $("raiseBtn"), foldBtn: $("foldBtn"),
  maoPlayBtn: $("maoPlayBtn"), maoFoldBtn: $("maoFoldBtn"),
  handLabel: $("handLabel"), hand: $("hand"),
  gate: $("gate"), gateTitle: $("gateTitle"), gateText: $("gateText"), gateBtn: $("gateBtn"),
  result: $("result"), resultIcon: $("resultIcon"), resultTitle: $("resultTitle"), resultText: $("resultText"),
  resultList: $("resultList"), rematch: $("rematch"), backSetup: $("backSetup"),
  trucoFx: $("trucoFx"), trucoFxKicker: $("trucoFxKicker"), trucoFxTitle: $("trucoFxTitle"), trucoFxText: $("trucoFxText"),
};

const session = getSession();
mountUserBar($("userbar"), { base: "../../" });
mountTemplatePicker({ game: GAME_ID });
Music.play(GAME_ID);

/* ===================== estado ===================== */

let mode = "local";                                   // "local" (hot-seat) | "online"
let settings = { players: 2, seconds: PARTY.turnSeconds, open: true };
let local = null;                                     // { state, viewSeat, seconds, deadline, ended, ranking, reason }
let gateOpen = false;                                 // tela de passar o aparelho aberta (só local)
let gateSeat = null;
let online = null;                                    // sessão party (shared/party-session.js)
let partyUi = null;                                   // painel do lobby/resultado (shared/party-ui.js)
let sending = false;                                  // lance online em trânsito
let flashTimer = 0;

const otherSeat = seat => (seat === 1 ? 2 : 1);
const seatsOf = n => Array.from({ length: Math.max(0, n | 0) }, (_, i) => i + 1);
const ctxOf = state => ({ seats: seatsOf(state.hands.length), out: [] });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const canOnline = () => Boolean(session && Cloud.active && Cloud.uid);
const isTeamGame = view => (view?.counts?.length ?? 0) === 4;
const teamLabel = team => TEAM_NAMES[team] ?? "Dupla";

const ONLINE_MESSAGES = {
  duel_not_found: "Sala não encontrada. Confira o código com quem te convidou.",
  duel_full: "Essa sala já está cheia.",
  party_full: "Essa sala já está cheia.",
  bad_status: "Essa partida já começou ou terminou.",
  expired: "Essa sala expirou. Crie uma nova.",
  not_authenticated: "Entre na sua conta para jogar online.",
  not_party_game: "Esse jogo não tem partida online.",
  not_party_duel: "Essa sala não é de Truco.",
  bad_code: "Código inválido. Confira com quem te convidou.",
  bad_duel: "Sala inválida.",
  bad_players: "A sala precisa ter a quantidade de jogadores escolhida: 2 (1×1) ou 4 (duplas 2×2).",
  closed_room: "Essa sala é fechada: só entra com o código do convite.",
  too_many_open: "Você já tem uma sala aberta. Abra-a em Salas Online ou saia dela antes de criar outra.",
  invalid_move: "Jogada inválida. A mesa já foi atualizada.",
  not_your_turn: "Não é a sua vez.",
  stale: "A mesa mudou. Atualizando…",
  not_member: "Você não está nessa sala.",
  not_ready: "Ainda há jogadores sem marcar pronto.",
  not_all_inside: "Ainda há jogadores fora do jogo. Espere todos entrarem.",
  roster_changed: "A sala mudou. Tente iniciar de novo.",
  not_creator: "Só quem criou a sala pode fazer isso.",
  unknown_game: "Esse jogo não está mais disponível.",
};
const onlineMessage = e => {
  const known = ONLINE_MESSAGES[e?.code];
  if (known) return known;
  console.warn("[WebMiniGames] erro online:", { code: e?.code, status: e?.status, error: e });
  const reason = String(e?.code ?? e?.message ?? "").trim().slice(0, 80);
  return "Não foi possível continuar agora. Tente de novo." + (reason ? ` (${e?.status ? `${e.status}: ` : ""}${reason})` : "");
};

/* ===================== opções do setup ===================== */

function syncOptions() {
  for (const button of els.playerOptions.querySelectorAll("[data-players]")) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.players) === settings.players));
  }
  for (const button of els.timeOptions.querySelectorAll("[data-seconds]")) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.seconds) === settings.seconds));
  }
  for (const button of els.roomOptions.querySelectorAll("[data-open]")) {
    button.setAttribute("aria-pressed", String((button.dataset.open === "true") === settings.open));
  }
  const teams = settings.players === 4;
  els.formatTitle.textContent = teams ? "Duplas 2 × 2" : "1 × 1";
  els.formatNote.textContent = teams
    ? "Parceiros em assentos opostos (1 e 3 contra 2 e 4) · placar da dupla · partida até 12 pontos"
    : "Truco Paulista · 40 cartas · cada um por si · partida até 12 pontos";
}

els.playerOptions.addEventListener("click", event => {
  const button = event.target.closest("[data-players]");
  if (!button) return;
  const players = Number(button.dataset.players);
  if (PARTY.playerCounts.includes(players)) settings.players = players;
  syncOptions();
});

els.timeOptions.addEventListener("click", event => {
  const button = event.target.closest("[data-seconds]");
  if (!button) return;
  const seconds = Number(button.dataset.seconds);
  if (PARTY.turnOptions.includes(seconds)) settings.seconds = seconds;
  syncOptions();
});

els.roomOptions.addEventListener("click", event => {
  const button = event.target.closest("[data-open]");
  if (!button) return;
  settings.open = button.dataset.open === "true";
  syncOptions();
});

function noticeSetup(message = "") {
  els.duelNotice.hidden = !message;
  els.duelNotice.textContent = message;
}

/* ===================== endereço: ?duelo=novo | ?duelo=<código> | ?duelo=<id> ===================== */

const params = new URLSearchParams(location.search);
const invite = params.get("duelo");
const inviteKind = !invite ? null : invite === "novo" ? "new" : UUID_RE.test(invite) ? "id" : "code";
const acceptRequested = params.get("aceitar") === "1";
let acceptPending = acceptRequested;

function clearInvite() {
  try { history.replaceState(null, "", location.pathname); } catch { /* sem History API */ }
}

function keepRoomInUrl(id) {
  try { history.replaceState(null, "", `${location.pathname}?duelo=${encodeURIComponent(id)}`); } catch { /* sem History API */ }
}

/* ===================== nomes, avatares e contagens ===================== */

function playerOf(seat) {
  if (mode !== "online" || !online) return null;
  return online.players.find(player => player.seat === seat) ?? null;
}

function playerName(seat) {
  if (seat == null) return "Jogador";
  const player = playerOf(seat);
  return player?.nickname || (player?.is_me ? "Você" : `Jogador ${seat}`);
}

function displayName(seat) {
  if (seat == null) return "Jogador";
  const player = playerOf(seat);
  if (!player) return `Jogador ${seat}`;
  return player.is_me ? `${player.nickname || "Você"} (você)` : (player.nickname || `Jogador ${seat}`);
}

function playerAvatar(seat) {
  return playerOf(seat)?.avatar || null;
}

function countOf(view, seat) {
  return view?.counts?.find(entry => entry.seat === seat) ?? { seat, cards: 0, out: false };
}

const countText = entry => (entry.out ? "fora" : entry.cards === 0 ? "sem cartas" : plural(entry.cards, "carta", "cartas"));

/* ===================== render: mesa ===================== */

function currentView() {
  if (mode === "local" && local) return partyView(local.state, local.viewSeat, ctxOf(local.state));
  if (mode === "online" && online?.view) return online.view;
  return null;
}

function canAct(view = currentView()) {
  if (!view) return false;
  if (mode === "local") {
    return Boolean(local && !local.ended && !gateOpen && local.state.turn === view.seat && view.turn === view.seat);
  }
  return Boolean(online && online.status === "running" && online.started && !sending && online.canPlay() && view.seat === online.mySeat);
}

function placePartyPanel(inGame) {
  const host = els.partyHost;
  if (inGame) {
    const table = els.game.querySelector(".table-grid");
    if (host.parentNode !== els.game) els.game.insertBefore(host, table);
  } else if (host.parentNode !== els.main) {
    els.main.insertBefore(host, els.game);
  }
}

function render() {
  if (mode === "local") renderLocal();
  else if (mode === "online") renderOnline();
  renderStatus();
  renderTimer();
}

function renderLocal() {
  if (!local) return;
  renderTable(partyView(local.state, local.viewSeat, ctxOf(local.state)), local.viewSeat);
}

function renderOnline() {
  if (!online?.view) return;
  placePartyPanel(true);
  renderTable(online.view, online.mySeat ?? online.view.seat);
}

/** Posições ao redor da mesa, na mesma ordem do UNO: sozinho no topo ou esquerda, topo e direita. */
function positionSeats(view, bottom) {
  const n = view.counts?.length ?? 2;
  if (n <= 2) return { top: otherSeat(bottom) };
  const positions = ["left", "top", "right"];
  const seats = {};
  positions.forEach((position, index) => {
    seats[position] = ((bottom - 1 + index + 1) % n) + 1;
  });
  return seats;
}

function renderTable(view, bottomSeat) {
  els.tableGrid.classList.toggle("two-players", (view.counts?.length ?? 2) <= 2);
  const around = positionSeats(view, bottomSeat);
  renderPlayer(view, around.left, "left");
  renderPlayer(view, around.top, "top");
  renderPlayer(view, around.right, "right");
  renderPlayer(view, bottomSeat, "bottom");
  renderScore(view, bottomSeat);
  renderMatchInfo(view);
  renderTableCards(view);
  renderActions(view);
  renderHand(view);
  animateTablePlays(view);
  syncTrucoFx(view);
}

/* ===================== jogadores e placar ===================== */

function playerBar(view, seat, role) {
  const entry = countOf(view, seat);
  const team = teamOf(seat);
  const points = view.points?.[team] ?? 0;
  const node = document.createElement("div");
  node.className = "opponent " + (role === "top" || role === "bottom" ? role : "side")
    + (isTeamGame(view) ? ` team-${team === 0 ? "a" : "b"}` : "")
    + (view.turn === seat ? " turn" : "")
    + (entry.out ? " out" : "");
  node.dataset.seat = String(seat);

  const profile = document.createElement("div");
  profile.className = "opponent-profile";
  const avatar = document.createElement("span");
  avatar.className = "opponent-avatar";
  avatar.append(avatarNode(playerAvatar(seat)));
  const meta = document.createElement("div");
  meta.className = "opponent-meta";
  const name = document.createElement("span");
  name.className = "opponent-name";
  name.textContent = role === "bottom" && mode === "online" ? "Você" : displayName(seat);
  const count = document.createElement("span");
  count.className = "opponent-count" + (points >= 11 ? " eleven" : "");
  count.textContent = `${plural(points, "ponto", "pontos")} · ${countText(entry)}`;
  meta.append(name, count);
  profile.append(avatar, meta);

  if (role !== "bottom") {
    const hand = document.createElement("div");
    hand.className = "opponent-hand";
    const shown = Math.min(entry.cards, 4);
    for (let i = 0; i < shown; i++) {
      const back = document.createElement("span");
      back.className = "mini-back";
      back.setAttribute("aria-hidden", "true");
      hand.append(back);
    }
    if (entry.cards > shown) {
      const more = document.createElement("span");
      more.className = "more";
      more.textContent = `+${entry.cards - shown}`;
      hand.append(more);
    }
    node.append(profile, hand);
  } else {
    const side = document.createElement("span");
    side.className = "opponent-count";
    side.textContent = isTeamGame(view) ? `${teamLabel(team)} · sua mão` : "Sua mão";
    node.append(profile, side);
  }
  return node;
}

function renderPlayer(view, seat, role) {
  const host = role === "left" ? els.leftPlayer
    : role === "top" ? els.topPlayer
      : role === "right" ? els.rightPlayer
        : els.bottomPlayer;
  host.replaceChildren();
  if (seat != null) host.append(playerBar(view, seat, role));
}

function scoreSide(label, points, className, team) {
  const side = document.createElement("div");
  side.className = `score-side ${className} team-${team === 0 ? "a" : "b"}`;
  if (points >= 11) side.classList.add("at-eleven");
  const name = document.createElement("span");
  name.textContent = label;
  const value = document.createElement("b");
  value.textContent = String(points);
  side.append(name, value);
  return side;
}

function renderScore(view, bottomSeat) {
  const bottomTeam = teamOf(bottomSeat);
  const topTeam = 1 - bottomTeam;
  const teamPoints = team => view.points?.[team] ?? 0;
  const labelFor = team => {
    if (isTeamGame(view)) return team === bottomTeam ? `${teamLabel(team)} (sua)` : teamLabel(team);
    const seat = view.counts.find(entry => entry.team === team)?.seat ?? (team === bottomTeam ? bottomSeat : otherSeat(bottomSeat));
    return team === bottomTeam && mode === "online" ? "Você" : displayName(seat);
  };

  const cross = document.createElement("span");
  cross.className = "score-x";
  cross.setAttribute("aria-hidden", "true");
  cross.textContent = "×";
  els.scoreboard.replaceChildren(
    scoreSide(labelFor(bottomTeam), teamPoints(bottomTeam), "score-bottom", bottomTeam),
    cross,
    scoreSide(labelFor(topTeam), teamPoints(topTeam), "score-top", topTeam),
  );
}

function renderMatchInfo(view) {
  els.handNo.textContent = `Mão ${view.handNo}`;
  els.handValue.textContent = view.maoDeFerro
    ? "Mão de ferro · vale 3"
    : view.maoDeOnzeHand
      ? "Mão de onze · vale 3"
      : `Vale ${view.handValue}`;
  els.roundInfo.textContent = view.phase === "mao"
    ? "Decisão da mão de onze"
    : `Rodada ${Math.min(view.round, 3)} de 3`;
}

/* ===================== cartas da mesa ===================== */

function cardNode(id, { playable = false } = {}) {
  const card = cardOf(id);
  const node = document.createElement(playable ? "button" : "div");
  if (playable) node.type = "button";
  const red = card && RED_SUITS.includes(card.suit);
  node.className = "truco-card" + (red ? " red" : "") + (isManilha(id) ? " manilha" : "");
  if (playable) {
    node.setAttribute("aria-label", `${cardName(id)} — jogável`);
    node.disabled = false;
  } else {
    node.setAttribute("role", "img");
    node.setAttribute("aria-label", cardName(id));
  }

  const corner = document.createElement("span");
  corner.className = "card-corner";
  const rank = document.createElement("span");
  rank.className = "card-rank";
  rank.textContent = card?.rank ?? "?";
  const suit = document.createElement("span");
  suit.className = "card-suit";
  suit.textContent = card ? SUIT_SYMBOLS[card.suit] : "";
  corner.append(rank, suit);

  const center = document.createElement("span");
  center.className = "card-center";
  center.textContent = card ? SUIT_SYMBOLS[card.suit] : "";
  node.append(corner, center);

  if (isManilha(id)) {
    const badge = document.createElement("span");
    badge.className = "card-manilha";
    badge.textContent = manilhaName(id);
    node.append(badge);
  }
  return node;
}

function emptyTableSlot(text = "Mesa vazia") {
  const slot = document.createElement("div");
  slot.className = "table-card-empty";
  slot.textContent = text;
  return slot;
}

/* ===================== efeitos: carta voando e truco na tela =====================
   Dois efeitos públicos, um para cada jogador da mesa:
   • a carta sai da mão/avatar e voa até o lugar dela na mesa (.card-flight);
   • truco, aumento, aceite, corrida e mão de onze tomam a tela com um aviso grande (#trucoFx).
   O modo local espera os dois terminarem antes de abrir a tela de "passar o aparelho" ou o resultado. */

const FLIGHT_MS = 430;
const FX_MS = 1700;
const FX_ACTIONS = new Set(["truco", "raise", "accept", "mao"]);

let flightOrigins = [];                 // [{ seat, card, rect }] — retângulo de onde a carta saiu
let playWatcher = { ready: false, key: null };
let flightPromises = new Set();
let flightsIdle = Promise.resolve();
let trucoFxIdle = Promise.resolve();
let trucoFxTimer = 0;
let shakeTimer = 0;
let fxKeys = { last: null, hand: null, first: true };

function reducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Resolve quando o voo das cartas e o efeito de truco (se houver) terminam. */
function fxWait() {
  return Promise.allSettled([flightsIdle, trucoFxIdle]);
}

function resetFx() {
  flightOrigins = [];
  playWatcher = { ready: false, key: null };
  fxKeys = { last: null, hand: null, first: true };
  clearTimeout(trucoFxTimer);
  clearTimeout(shakeTimer);
  flightsIdle = Promise.resolve();
  trucoFxIdle = Promise.resolve();
  els.trucoFx.classList.remove("show");
  els.trucoFx.setAttribute("aria-hidden", "true");
  els.tableGrid.classList.remove("truco-shake");
}

/* ---------- carta saindo da mão ---------- */

function recordFlightOrigin(seat, card, node) {
  const rect = node?.getBoundingClientRect?.();
  if (!rect || !rect.width) return;
  flightOrigins.push({ seat, card, rect, at: performance.now() });
  if (flightOrigins.length > 6) flightOrigins.splice(0, flightOrigins.length - 6);
}

function takeFlightOrigin(seat, card) {
  const index = flightOrigins.findIndex(origin => origin.seat === seat && origin.card === card);
  if (index < 0) return null;
  const [origin] = flightOrigins.splice(index, 1);
  return performance.now() - origin.at > 8000 ? null : origin.rect;   // jogada recusada: origem expira
}

function seatRect(seat) {
  const bar = document.querySelector(`.table-grid .opponent[data-seat="${seat}"]`);
  const avatar = bar?.querySelector(".opponent-avatar") ?? bar;
  return avatar ? avatar.getBoundingClientRect() : null;
}

function handRect() {
  const rect = els.hand.getBoundingClientRect();
  if (!rect.width) return null;
  return { left: rect.left + rect.width / 2 - 34, top: rect.top + 10, width: 68, height: 102 };
}

/** De onde a carta saiu: a mão de quem jogou, ou o avatar do assento (adversários no online). */
function originFor(view, seat, card) {
  const recorded = takeFlightOrigin(seat, card);
  if (recorded) return recorded;
  if (seat === view.seat) return handRect() ?? seatRect(seat);
  return seatRect(seat);
}

function flyCard(card, from, to) {
  if (!from || !to || !to.width) return null;
  const width = to.width;
  const height = to.height;
  const clone = document.createElement("div");
  clone.className = "card-flight";
  clone.setAttribute("aria-hidden", "true");
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  clone.style.left = `${from.left + from.width / 2 - width / 2}px`;
  clone.style.top = `${from.top + from.height / 2 - height / 2}px`;
  clone.append(cardNode(card));
  document.body.append(clone);
  if (typeof clone.animate !== "function") { clone.remove(); return null; }

  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const scale = Math.max(0.6, Math.min(1.35, from.width / width));
  const animation = clone.animate([
    { transform: `translate3d(0,0,0) scale(${scale}) rotate(-14deg)`, opacity: 0.55 },
    { transform: `translate3d(${dx * 0.55}px,${dy * 0.55}px,0) scale(${(scale + 1) / 2}) rotate(-5deg)`, opacity: 1, offset: 0.6 },
    { transform: `translate3d(${dx}px,${dy}px,0) scale(1) rotate(0deg)`, opacity: 1 },
  ], { duration: FLIGHT_MS, easing: "cubic-bezier(.24,.86,.3,1)", fill: "both" });

  const done = animation.finished.catch(() => {}).then(() => clone.remove());
  flightPromises.add(done);
  done.finally(() => flightPromises.delete(done));
  flightsIdle = Promise.allSettled([...flightPromises]).then(() => {});
  return done;
}

/** Compara o último lance público com o anterior e anima a carta que acabou de cair na mesa. */
function latestPlay(view) {
  const plays = Array.isArray(view.plays) ? view.plays : [];
  for (let i = plays.length - 1; i >= 0; i--) {
    const play = plays[i];
    if (play?.action === "play" && play.card) return play;
  }
  return null;
}

function tableCenterRect() {
  const box = els.tableCards.getBoundingClientRect();
  if (!box.width) return null;
  return { left: box.left + box.width / 2 - 46, top: box.top + box.height / 2 - 69, width: 92, height: 138 };
}

function animateTablePlays(view) {
  const play = latestPlay(view);
  const key = play ? [view.handNo, play.seat, play.card, play.round].join(":") : null;
  const first = !playWatcher.ready;
  playWatcher.ready = true;
  if (!key || key === playWatcher.key) return;
  playWatcher.key = key;
  if (first || reducedMotion()) return;                 // entrada no meio da mão: sem voo retroativo

  /* A mesa guarda a carta jogada; quando a mão fecha, a mesa já foi limpa e o voo vai para o centro. */
  const board = els.tableCards.querySelector(`[data-card="${play.card}"][data-seat="${play.seat}"]`);
  const target = board ? board.getBoundingClientRect() : tableCenterRect();
  const flight = flyCard(play.card, originFor(view, play.seat, play.card), target);
  if (!flight || !board) return;
  board.style.visibility = "hidden";                    // a carta real aparece quando o voo chega
  flight.then(() => { board.style.visibility = ""; });
}

/* ---------- efeito de truco ---------- */

function fxName(seat) {
  if (seat == null) return "Jogador";
  if (mode === "online" && seat === online?.mySeat) return "Você";
  return playerName(seat);
}

function trucoCopy(view, last) {
  const name = fxName(last.seat);
  const responder = view.pending?.responder;
  const answer = responder != null ? ` Falta ${fxName(responder)} responder.` : "";
  if (last.action === "truco") {
    const label = TRUCO_NAMES[last.value] ?? "Truco";
    return { tone: "call", kicker: `${name} pediu`, title: label.toUpperCase(), text: `Aposta de ${last.value} pontos.${answer}` };
  }
  if (last.action === "raise") {
    const label = TRUCO_NAMES[last.value] ?? `Vale ${last.value}`;
    return { tone: "raise", kicker: `${name} aumentou`, title: label.toUpperCase(), text: `Aposta em ${last.value} pontos.${answer}` };
  }
  if (last.action === "accept") {
    return { tone: "accept", kicker: `${name} aceitou`, title: `VALE ${last.value}`, text: `A mão vale ${last.value} pontos.` };
  }
  return { tone: "mao", kicker: "Mão de onze", title: "VALE 3", text: `${name} decidiu jogar a mão valendo 3.` };
}

function foldCopy(view, hand) {
  const name = fxName(hand.foldedBy);
  const points = hand.points ?? 1;
  const winner = isTeamGame(view) && hand.team != null ? teamLabel(hand.team) : fxName(hand.winner);
  return {
    tone: "fold",
    kicker: hand.reason === "mao_fold" ? `${name} correu da mão de onze` : `${name} correu`,
    title: `+${points}`,
    text: `${winner} leva ${plural(points, "ponto", "pontos")}.`,
  };
}

function showTrucoFx({ tone = "call", kicker = "", title = "", text = "" }) {
  if (!els.trucoFx || !title) return;
  clearTimeout(trucoFxTimer);
  clearTimeout(shakeTimer);
  els.trucoFx.className = `truco-fx ${tone}`;
  els.trucoFx.setAttribute("aria-hidden", "false");
  els.trucoFxKicker.textContent = kicker;
  els.trucoFxTitle.textContent = title;
  els.trucoFxText.textContent = text;
  void els.trucoFx.offsetWidth;                          // reinicia a animação mesmo em eventos seguidos
  els.trucoFx.classList.add("show");

  if (!reducedMotion()) {
    els.tableGrid.classList.remove("truco-shake");
    void els.tableGrid.offsetWidth;
    els.tableGrid.classList.add("truco-shake");
    shakeTimer = setTimeout(() => els.tableGrid.classList.remove("truco-shake"), 620);
  }

  trucoFxIdle = new Promise(resolve => {
    trucoFxTimer = setTimeout(() => {
      els.trucoFx.classList.remove("show");
      els.trucoFx.setAttribute("aria-hidden", "true");
      resolve();
    }, reducedMotion() ? 900 : FX_MS);
  });
}

function lastSignature(view) {
  const last = view?.last;
  if (!last) return "";
  return [view.handNo, last.action, last.seat, last.value, last.choice, last.round, last.winner, last.tie].join(":");
}

function handSignature(hand) {
  if (!hand) return "";
  return [hand.handNo, hand.reason, hand.points, hand.winner, hand.team, hand.foldedBy].join(":");
}

/** Dispara o efeito uma única vez por evento, para todos os clientes (o estado público traz last/lastHand). */
function syncTrucoFx(view) {
  const nextKeys = { last: lastSignature(view), hand: handSignature(view.lastHand), first: false };
  const previous = fxKeys;
  fxKeys = nextKeys;
  if (previous.first) return;

  const hand = view.lastHand;
  if (nextKeys.hand && nextKeys.hand !== previous.hand && hand?.foldedBy != null
    && (hand.reason === "fold" || hand.reason === "mao_fold")) {
    showTrucoFx(foldCopy(view, hand));
    return;
  }

  const last = view.last;
  if (!nextKeys.last || nextKeys.last === previous.last || !last || !FX_ACTIONS.has(last.action)) return;
  if (last.action === "mao" && last.choice !== "play") return;
  showTrucoFx(trucoCopy(view, last));
}

function renderTableCards(view) {
  const cards = Array.isArray(view.table) ? view.table : [];
  const seats = view.counts?.length ?? 2;
  const lastRound = view.roundResults?.at(-1) ?? null;
  const roundDone = cards.length > 0 && cards.length === seats;
  const nodes = [];

  for (const play of cards) {
    const wrapper = document.createElement("div");
    wrapper.className = "played-card";
    const board = cardNode(play.card);
    board.dataset.card = play.card;
    board.dataset.seat = String(play.seat);
    const label = document.createElement("span");
    label.className = "played-by";
    label.textContent = playerName(play.seat);
    wrapper.append(board, label);
    nodes.push(wrapper);
  }
  for (let i = cards.length; i < seats; i++) {
    nodes.push(emptyTableSlot(cards.length ? "" : i === 0 ? "Mesa vazia" : ""));
  }
  if (roundDone && lastRound?.winner) {
    const index = cards.findIndex(play => play.seat === lastRound.winner);
    if (index >= 0) nodes[index]?.classList.add("winner");
  }
  els.tableCards.replaceChildren(...nodes);

  if (roundDone && lastRound) {
    if (lastRound.tie) {
      els.roundResult.textContent = `Rodada ${lastRound.round} empatada.`;
    } else if (isTeamGame(view) && lastRound.team != null) {
      els.roundResult.textContent = `${teamLabel(lastRound.team)} venceu a rodada ${lastRound.round}.`;
    } else {
      els.roundResult.textContent = `${playerName(lastRound.winner)} venceu a rodada ${lastRound.round}.`;
    }
    return;
  }
  if (cards.length) {
    els.roundResult.textContent = "Aguardando as cartas da rodada.";
    return;
  }
  const hand = view.lastHand;
  if (hand) {
    if (hand.winner == null) {
      els.roundResult.textContent = "Mão empatada: ninguém pontuou.";
    } else if (isTeamGame(view) && hand.team != null) {
      els.roundResult.textContent = `${teamLabel(hand.team)} fez ${plural(hand.points, "ponto", "pontos")} e venceu a mão.`;
    } else {
      els.roundResult.textContent = `${playerName(hand.winner)} fez ${plural(hand.points, "ponto", "pontos")} e venceu a mão.`;
    }
    return;
  }
  els.roundResult.textContent = view.maoDeFerro
    ? "Mão de ferro: as duas duplas em 11."
    : isTeamGame(view) ? "Duplas 2 × 2: parceiros em assentos opostos." : "";
}

/* ===================== ações ===================== */

function trucoLabel(value) {
  const next = nextTrucoValue(value);
  if (!next) return "Sem aumento";
  return `${TRUCO_NAMES[next] ?? "Truco"} (vale ${next})`;
}

function setButton(button, { hidden = false, disabled = false, text = null } = {}) {
  button.hidden = hidden;
  button.disabled = disabled;
  if (text != null) button.textContent = text;
}

function renderActions(view) {
  const active = canAct(view);
  const pending = view.pending;
  const playing = view.phase === "playing";
  const responder = Boolean(pending && pending.responder === view.seat);
  const showTruco = playing && !pending && !view.trucoLocked && view.handValue < 12;

  setButton(els.trucoBtn, { hidden: !showTruco, disabled: !active || !view.canTruco, text: trucoLabel(view.handValue) });

  setButton(els.acceptBtn, {
    hidden: !(playing && responder),
    disabled: !active || !view.canAccept,
    text: pending ? `Aceitar (vale ${pending.value})` : "Aceitar",
  });
  setButton(els.raiseBtn, {
    hidden: !(playing && responder && view.canRaise),
    disabled: !active || !view.canRaise,
    text: pending ? `Aumentar (vale ${nextTrucoValue(pending.value)})` : "Aumentar",
  });
  setButton(els.foldBtn, {
    hidden: !(playing && responder),
    disabled: !active || !view.canFold,
    text: pending ? `Correr (${plural(pending.stake, "ponto", "pontos")})` : "Correr",
  });

  const showMao = view.phase === "mao" && view.maoDeOnze === view.seat;
  setButton(els.maoPlayBtn, { hidden: !showMao, disabled: !active || !view.canChooseMao, text: "Jogar valendo 3" });
  setButton(els.maoFoldBtn, {
    hidden: !showMao,
    disabled: !active || !view.canChooseMao,
    text: `Correr (+1 para ${rivalLabel(view)})`,
  });

  els.hint.textContent = hintText(view);
}

/** Nome do adversário direto: a dupla contrária no 2×2, o outro jogador no 1×1. */
function rivalLabel(view) {
  const rivalTeam = 1 - teamOf(view.seat);
  if (isTeamGame(view)) return teamLabel(rivalTeam);
  const seat = view.counts.find(entry => entry.team === rivalTeam)?.seat ?? otherSeat(view.seat);
  return playerName(seat);
}

function hintText(view) {
  if (!view) return "";
  if (view.phase === "over" || view.ranking) return "Partida encerrada.";
  if (mode === "local" && gateOpen) return "Passe o aparelho para o próximo jogador.";
  if (mode === "online" && !online?.started) return "Aguardando a largada…";
  const teams = isTeamGame(view);

  if (view.phase === "mao") {
    if (view.maoDeOnze === view.seat) {
      return teams
        ? "Sua dupla chegou a 11: jogue valendo 3 ou corra e dê 1 ponto à dupla adversária."
        : "Você chegou a 11: jogue valendo 3 ou corra e dê 1 ponto ao adversário.";
    }
    return `Aguardando ${playerName(view.maoDeOnze)} decidir a mão de onze.`;
  }

  if (view.pending) {
    if (view.pending.responder === view.seat) {
      const name = TRUCO_NAMES[view.pending.value] ?? "truco";
      return `${playerName(view.pending.seat)} pediu ${name}. Aceite, aumente ou corra.`;
    }
    return `Aguardando ${playerName(view.pending.responder)} responder ao pedido.`;
  }

  if (view.turn !== view.seat) {
    const partner = teams && teamOf(view.turn) === teamOf(view.seat);
    return `Vez de ${playerName(view.turn)}${partner ? " (sua dupla)" : ""}.`;
  }
  if (view.maoDeFerro) return teams
    ? "Mão de ferro: as duas duplas estão em 11 e a mão vale 3."
    : "Mão de ferro: os dois estão em 11 e a mão vale 3.";
  if (view.maoDeOnzeHand) return "Mão de onze: vale 3 e não aceita truco. Escolha uma carta.";
  if (view.canPlay) return view.canTruco ? "Escolha uma carta ou peça truco." : "Escolha uma carta para jogar.";
  return "Aguardando…";
}

/* ===================== mão ===================== */

function renderHand(view) {
  if (mode === "local" && gateOpen) {
    const hidden = document.createElement("p");
    hidden.className = "hand-empty";
    hidden.textContent = "Mão escondida até o próximo jogador confirmar.";
    els.hand.replaceChildren(hidden);
    els.handLabel.textContent = "Mão escondida";
    return;
  }

  const hand = Array.isArray(view.hand) ? view.hand : [];
  const entry = countOf(view, view.seat);
  const team = isTeamGame(view) ? ` · ${teamLabel(teamOf(view.seat))}` : "";
  els.handLabel.textContent = mode === "local"
    ? `${displayName(view.seat)}${team} · ${plural(hand.length, "carta", "cartas")}`
    : `Sua mão${team} · ${plural(hand.length, "carta", "cartas")}`;

  if (!hand.length) {
    const empty = document.createElement("p");
    empty.className = "hand-empty";
    empty.textContent = view.ranking ? "Mão encerrada." : "Sem cartas.";
    els.hand.replaceChildren(empty);
    return;
  }

  const active = canAct(view);
  const nodes = hand.map(id => {
    const playable = active && view.canPlay;
    const node = cardNode(id, { playable });
    node.dataset.card = id;
    if (playable) {
      node.addEventListener("click", event => onCard(id, view, event.currentTarget));
      node.title = cardShort(id);
    } else {
      node.title = cardName(id);
    }
    return node;
  });
  els.hand.replaceChildren(...nodes);
}

/* ===================== status e relógio ===================== */

function renderStatus() {
  els.status.hidden = mode === "online" && online?.status === "running" && Boolean(online.started);
  if (mode === "local") {
    if (!local) return;
    if (local.ended) { els.status.textContent = "Partida encerrada."; return; }
    if (gateOpen) { els.status.textContent = `Vez de ${playerName(local.state.turn)} — aguardando o jogador.`; return; }
    if (local.state.phase === "mao") { els.status.textContent = `Mão de onze — ${playerName(local.state.turn)} decide.`; return; }
    els.status.textContent = `Vez de ${playerName(local.state.turn)}.`;
    return;
  }
  if (!online) return;
  if (online.status === "finished" || online.status === "cancelled") { els.status.textContent = "Partida encerrada."; return; }
  if (online.status !== "running" || !online.started) { els.status.textContent = "Aguardando a largada…"; return; }
  els.status.textContent = turnBanner(online) || "Aguardando…";
}

function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function renderTimer() {
  let text = "—";
  let low = false;
  if (mode === "local" && local && !local.ended && !gateOpen && local.deadline) {
    const left = local.deadline - performance.now();
    text = formatClock(left);
    low = left <= 10000;
  } else if (mode === "online" && online?.status === "running" && online.started) {
    const left = online.msToTurnEnd();
    if (left != null) {
      text = formatClock(left);
      low = left <= 10000;
    }
  }
  els.turnTimer.textContent = text;
  els.turnTimer.classList.toggle("low", low);
}

/* ===================== lances ===================== */

function onCard(id, view, node) {
  if (!canAct(view) || !view.canPlay) return;
  recordFlightOrigin(view.seat, id, node);
  move({ action: "play", card: id });
}

function move(input) {
  if (mode === "local") localMove(input);
  else onlineMove(input);
}

function localMove(input) {
  if (!local || local.ended) return;
  const actor = local.state.turn;
  if (actor == null) return;
  const result = partyMove(local.state, actor, input, ctxOf(local.state));
  if (!result) { flash("Jogada inválida."); return; }
  local.state = result.state;
  /* A mesa fica no jogador que jogou até o voo da carta e o efeito de truco terminarem; o relógio do
     próximo turno só começa depois disso, para a animação não custar tempo de jogada a ninguém. */
  local.viewSeat = actor;
  local.deadline = 0;
  render();
  const wait = fxWait();

  if (result.ranking) { wait.then(() => finishLocal(result.ranking, result.reason)); return; }

  const next = result.turn;
  if (next == null) return;
  wait.then(() => {
    if (!local || local.ended || local.state.turn !== next) return;
    local.viewSeat = next;
    if (next === actor) {
      local.deadline = performance.now() + local.seconds * 1000;
      render();
    } else {
      openGate(next);
    }
  });
}

async function onlineMove(input) {
  if (!online || sending) return;
  sending = true;
  const view = currentView();
  if (view) renderActions(view);
  try {
    await online.move(input);
    if (online.view) render();
  } catch (e) {
    flash(onlineMessage(e));
    if (["stale", "not_your_turn", "bad_status", "invalid_move"].includes(e?.code)) {
      await online.refresh().catch(() => {});
    }
    if (online?.view) render();
  } finally {
    sending = false;
    if (mode === "online" && online?.view) render();
  }
}

/* ===================== gate e resultado local ===================== */

function openGate(seat) {
  gateOpen = true;
  gateSeat = seat;
  if (local) local.deadline = 0;
  els.gateTitle.textContent = `Vez de ${playerName(seat)}`;
  els.gateText.textContent = `Passe o aparelho para ${playerName(seat)}. Só ele deve olhar a mão.`;
  els.gateBtn.textContent = `Sou ${playerName(seat)}`;
  els.gate.hidden = false;
  render();
}

function confirmGate() {
  if (!gateOpen) return;
  gateOpen = false;
  gateSeat = null;
  els.gate.hidden = true;
  if (mode === "local" && local && !local.ended) {
    local.viewSeat = local.state.turn;
    local.deadline = performance.now() + local.seconds * 1000;
  }
  render();
}

function localTimeout() {
  if (!local || local.ended || !local.state.turn) return;
  const seat = local.state.turn;
  const next = timeoutTurn(local.state, seat, ctxOf(local.state));
  if (!next) return;
  local.state = next;
  local.viewSeat = seat;
  local.deadline = 0;
  render();
  const wait = fxWait();

  if (next.ranking) {
    wait.then(() => finishLocal(next.ranking, next.lastHand?.reason ?? "timeout"));
    flash(`${playerName(seat)} não jogou a tempo: a jogada automática foi feita.`);
    return;
  }

  const nextSeat = next.turn;
  if (nextSeat == null) return;
  wait.then(() => {
    if (!local || local.ended || local.state.turn !== nextSeat) return;
    local.viewSeat = nextSeat;
    if (nextSeat === seat) {
      local.deadline = performance.now() + local.seconds * 1000;
      render();
    } else {
      openGate(nextSeat);
    }
  });
  flash(`${playerName(seat)} não jogou a tempo: a jogada automática foi feita.`);
}

function finishLocal(ranking, reason) {
  if (!local) return;
  local.ended = true;
  local.ranking = ranking;
  local.reason = reason ?? "ended";
  local.deadline = 0;
  local.viewSeat = ranking?.[0]?.[0] ?? local.viewSeat;
  gateOpen = false;
  gateSeat = null;
  els.gate.hidden = true;
  render();
  showLocalResult(ranking, local.reason);
}

function showLocalResult(ranking) {
  const placeOf = placements(ranking);
  const first = ranking[0] ?? [];
  const winner = first.length === 1 ? first[0] : null;
  const championTeam = first.length && first.every(seat => teamOf(seat) === teamOf(first[0]))
    ? teamOf(first[0])
    : null;
  const teamWin = first.length > 1 && championTeam != null;
  const points = local.state.points;

  els.resultIcon.textContent = teamWin
    ? String(points[championTeam] ?? 0)
    : winner ? String(points[teamOf(winner)] ?? 0) : "Fim";
  els.resultTitle.textContent = teamWin
    ? `${teamLabel(championTeam)} venceu!`
    : winner ? `${displayName(winner)} venceu!` : "Partida encerrada";
  els.resultText.textContent = teamWin
    ? `${teamLabel(championTeam)} fez ${plural(points[championTeam] ?? 0, "ponto", "pontos")} e venceu a partida.`
    : winner
      ? `${displayName(winner)} fez ${plural(points[teamOf(winner)] ?? 0, "ponto", "pontos")} e venceu a partida.`
      : "A partida terminou sem vencedor.";

  const rows = [];
  for (const group of ranking) {
    for (const seat of group) {
      const team = teamOf(seat);
      const li = document.createElement("li");
      li.className = "result-row" + (placeOf[seat] === 1 ? " first" : "");
      const place = document.createElement("span");
      place.className = "result-place";
      place.textContent = `${placeOf[seat]}º`;
      const name = document.createElement("span");
      name.className = "result-name";
      name.textContent = isTeamGame(currentView()) ? `${displayName(seat)} · ${teamLabel(team)}` : displayName(seat);
      const score = document.createElement("span");
      score.className = "result-cards";
      score.textContent = plural(points[team] ?? 0, "ponto", "pontos");
      li.append(place, avatarNode(null), name, score);
      rows.push(li);
    }
  }
  els.resultList.replaceChildren(...rows);
  els.result.hidden = false;
  els.rematch.focus();
}

/* ===================== início / saída ===================== */

function clearLocal() {
  local = null;
  gateOpen = false;
  gateSeat = null;
  els.gate.hidden = true;
  resetFx();
}

function startLocalGame() {
  teardownOnline();
  clearLocal();
  const start = partyStart({ seats: seatsOf(settings.players), rng: Math.random });
  local = {
    state: start.state,
    viewSeat: start.turn,
    seconds: settings.seconds,
    deadline: 0,
    ended: false,
    ranking: null,
    reason: null,
  };
  mode = "local";
  els.setup.hidden = true;
  els.partyHost.hidden = true;
  els.game.hidden = false;
  els.result.hidden = true;
  clearInvite();
  openGate(start.turn);
}

function showSetup(message = "") {
  teardownOnline();
  clearLocal();
  mode = "local";
  els.setup.hidden = false;
  els.partyHost.hidden = true;
  els.game.hidden = true;
  els.result.hidden = true;
  els.gate.hidden = true;
  noticeSetup(message);
  clearInvite();
}

function teardownOnline() {
  const current = online;
  online = null;
  if (current) { try { current.destroy(); } catch { /* já encerrada */ } }
  if (partyUi) { try { partyUi.destroy(); } catch { /* já removido */ } }
  partyUi = null;
  sending = false;
  if (mode === "online") mode = "local";
  clearLocal();
  els.partyHost.replaceChildren();
  els.partyHost.hidden = true;
  els.game.hidden = true;
  placePartyPanel(false);
  els.gate.hidden = true;
  els.result.hidden = true;
}

/* ===================== sessão online ===================== */

function showOnlineShell() {
  els.setup.hidden = true;
  els.partyHost.hidden = false;
  els.gate.hidden = true;
  els.result.hidden = true;
}

/** Título do resultado online: no 2×2 o ranking vem agrupado por dupla (dois assentos em 1º). */
function onlineResultLabel({ outcome, placement }) {
  const first = online?.ranking?.[0] ?? [];
  const teamWin = first.length > 1 && first.every(seat => teamOf(seat) === teamOf(first[0]));
  if (teamWin) {
    const team = teamOf(first[0]);
    const mine = online?.me?.();
    return mine && teamOf(mine.seat) === team
      ? `${teamLabel(team)} venceu!`
      : `${teamLabel(team)} venceu a partida.`;
  }
  if (outcome === "win") return "Você venceu!";
  if (outcome === "tie") return "Empate no 1º lugar.";
  if (outcome === "cancelled") return "Partida cancelada.";
  return placement ? `Você ficou em ${placement}º lugar.` : "Partida encerrada.";
}

function startOnline() {
  if (online) return online;
  resetFx();
  online = createPartySession();
  partyUi = mountPartyUi(els.partyHost, online, {
    title: "Truco Paulista",
    resultLabel: onlineResultLabel,
    onStart: () => {
      mode = "online";
      showOnlineShell();
      els.game.hidden = false;
      renderOnline();
    },
    onFinish: () => handleOnline(),
    onExit: () => showSetup("Você saiu da sala."),
  });
  wireSession(online);
  return online;
}

function wireSession(s) {
  s.on("lobby", () => handleOnline());
  s.on("ready", () => handleOnline());
  s.on("state", () => handleOnline());
  s.on("move", () => {
    if (s.status === "running" && s.view) {
      mode = "online";
      els.game.hidden = false;
      renderOnline();
    }
  });
  s.on("start", () => {
    mode = "online";
    showOnlineShell();
    els.game.hidden = false;
    renderOnline();
  });
  s.on("finished", () => handleOnline());
  s.on("left", () => showSetup("Você saiu da sala."));
  s.on("kicked", () => showSetup("Você foi removido da sala."));
  s.on("error", e => flash(onlineMessage(e)));
}

function handleOnline() {
  if (!online) return;
  const status = online.status;
  if (status === "idle") return;
  showOnlineShell();
  if (status === "cancelled") {
    mode = "online";
    els.game.hidden = true;
    placePartyPanel(false);
    return;
  }
  if (status === "running" && online.started && online.view) {
    mode = "online";
    els.game.hidden = false;
    renderOnline();
    return;
  }
  if (status === "finished") {
    mode = "online";
    if (online.view) {
      els.game.hidden = false;
      renderOnline();
    } else {
      els.game.hidden = true;
      placePartyPanel(false);
    }
    return;
  }
  els.game.hidden = true;
  placePartyPanel(false);
}

async function createOnlineRoom() {
  if (!session) { noticeSetup("Entre na sua conta para jogar online."); return; }
  if (!canOnline()) { noticeSetup("O jogo online não está disponível nesta sessão."); return; }
  els.createRoom.disabled = true;
  try {
    startOnline();
    /* O tamanho da sala é exatamente o escolhido (2 no 1×1, 4 nas duplas 2×2) e a partida só larga com
       todos os assentos prontos e dentro. */
    await online.create(GAME_ID, {
      minPlayers: settings.players,
      maxPlayers: settings.players,
      turnSeconds: settings.seconds,
      open: settings.open,
    });
    handleOnline();
  } catch (e) {
    teardownOnline();
    noticeSetup(onlineMessage(e));
  } finally {
    els.createRoom.disabled = !canOnline();
  }
}

async function joinOnlineRoom(code) {
  const clean = normalizeCode(code);
  if (!session) { noticeSetup("Entre na sua conta para entrar na sala."); return; }
  if (!canOnline()) { noticeSetup("O jogo online não está disponível nesta sessão."); return; }
  if (!isDuelCode(clean)) { noticeSetup(ONLINE_MESSAGES.duel_not_found); return; }
  try {
    startOnline();
    await online.join(clean);
    handleOnline();
  } catch (e) {
    teardownOnline();
    noticeSetup(onlineMessage(e));
  }
}

async function attachOnlineRoom(id) {
  if (!session) { noticeSetup("Entre na sua conta para abrir a sala."); return; }
  if (!canOnline()) { noticeSetup("O jogo online não está disponível nesta sessão."); return; }
  try {
    startOnline();
    await online.attach(id);
    keepRoomInUrl(id);
    handleOnline();
    if (acceptPending) { acceptPending = false; await acceptOnlineInvite(); }
  } catch (e) {
    teardownOnline();
    noticeSetup(onlineMessage(e));
  }
}

async function acceptOnlineInvite() {
  if (!online) return;
  if (online.status === "waiting" && !online.me()?.ready) {
    try { await online.ready(); } catch { /* a sala pode ter largado/mudado nesse meio-tempo */ }
  }
  await online.refresh().catch(() => { /* o polling tenta de novo */ });
  handleOnline();
}

window.addEventListener(ACCEPT_EVENT, event => {
  if (!online || online.id !== event.detail?.id) return;
  event.preventDefault();
  acceptPending = false;
  keepRoomInUrl(online.id);
  acceptOnlineInvite();
});

async function resumeActiveRoom() {
  if (!canOnline() || els.setup.hidden) return;
  els.createRoom.disabled = true;
  try {
    const { duel } = await Cloud.duelMine(GAME_ID);
    if (duel?.id && !els.setup.hidden) await attachOnlineRoom(duel.id);
  } catch {
    /* sem a consulta segue para o setup: o servidor ainda barra sala duplicada (too_many_open) */
  } finally {
    els.createRoom.disabled = !canOnline();
  }
}

/* ===================== mensagens passageiras ===================== */

function flash(message) {
  if (!message) return;
  if (els.game.hidden) { noticeSetup(message); return; }
  els.hint.textContent = message;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    if (mode === "local") render();
    else if (online?.view) renderOnline();
  }, 3600);
}

/* ===================== eventos fixos ===================== */

els.startLocal.addEventListener("click", startLocalGame);
els.createRoom.addEventListener("click", () => createOnlineRoom());
els.gateBtn.addEventListener("click", confirmGate);
els.trucoBtn.addEventListener("click", () => {
  const view = currentView();
  if (view && canAct(view) && view.canTruco) move({ action: "truco" });
});
els.acceptBtn.addEventListener("click", () => {
  const view = currentView();
  if (view && canAct(view) && view.canAccept) move({ action: "accept" });
});
els.raiseBtn.addEventListener("click", () => {
  const view = currentView();
  if (view && canAct(view) && view.canRaise) move({ action: "raise" });
});
els.foldBtn.addEventListener("click", () => {
  const view = currentView();
  if (view && canAct(view) && view.canFold) move({ action: "fold" });
});
els.maoPlayBtn.addEventListener("click", () => {
  const view = currentView();
  if (view && canAct(view) && view.canChooseMao) move({ action: "mao", choice: "play" });
});
els.maoFoldBtn.addEventListener("click", () => {
  const view = currentView();
  if (view && canAct(view) && view.canChooseMao) move({ action: "mao", choice: "fold" });
});
els.rematch.addEventListener("click", () => {
  els.result.hidden = true;
  if (mode === "online") return;
  startLocalGame();
});
els.backSetup.addEventListener("click", () => showSetup());

setInterval(() => {
  if (mode === "local") {
    if (!local || local.ended || gateOpen) { renderTimer(); return; }
    if (local.deadline && performance.now() >= local.deadline) {
      local.deadline = 0;
      localTimeout();
    } else {
      renderTimer();
    }
  } else if (mode === "online" && online?.status === "running" && online.started && online.view && !els.game.hidden) {
    renderTimer();
    renderStatus();
  }
}, CLOCK_TICK);

/* ===================== primeira pintura ===================== */

syncOptions();
els.createRoom.disabled = !canOnline();
renderTimer();

if (inviteKind === "code") {
  joinOnlineRoom(invite);
} else if (inviteKind === "id") {
  attachOnlineRoom(invite);
} else {
  if (inviteKind === "new") {
    noticeSetup("Clique em “Criar sala online” e compartilhe o código. Escolha 2 jogadores (1×1) ou 4 (duplas 2×2).");
  }
  resumeActiveRoom();
}
