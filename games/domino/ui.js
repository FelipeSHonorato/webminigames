/* DOMINÓ 2–4 JOGADORES — mesa, mão e encaixe das pedras no navegador.
   Toda a regra vem de ./domain.js (código puro, testado). Dois modos usam a MESMA mesa:
   • local (hot-seat): 2–4 jogadores no mesmo aparelho; a mesa gira para o jogador da vez ficar embaixo e
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
  PARTY, legalEnds, partyMove, partyStart, partyView, placements, timeoutTurn, tileName, tileOf,
} from "./domain.js";

const GAME_ID = "domino";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLOCK_TICK = 250;

const $ = id => document.getElementById(id);
const els = {
  setup: $("setup"), playerOptions: $("playerOptions"), timeOptions: $("timeOptions"), roomOptions: $("roomOptions"),
  startLocal: $("startLocal"), createRoom: $("createRoom"), duelNotice: $("duelNotice"),
  partyHost: $("partyHost"), game: $("game"), status: $("status"), main: document.querySelector("main"),
  leftPlayer: $("leftPlayer"), topPlayer: $("topPlayer"), rightPlayer: $("rightPlayer"), bottomPlayer: $("bottomPlayer"),
  roundBadge: $("roundBadge"), endsText: $("endsText"), boneyardCount: $("boneyardCount"), turnTimer: $("turnTimer"),
  board: $("board"), roundNote: $("roundNote"), drawBtn: $("drawBtn"), passBtn: $("passBtn"), hint: $("hint"),
  handLabel: $("handLabel"), hand: $("hand"),
  gate: $("gate"), gateTitle: $("gateTitle"), gateText: $("gateText"), gateBtn: $("gateBtn"),
  endPick: $("endPick"), endText: $("endText"), cancelEnd: $("cancelEnd"),
  result: $("result"), resultIcon: $("resultIcon"), resultTitle: $("resultTitle"), resultText: $("resultText"),
  resultList: $("resultList"), rematch: $("rematch"), backSetup: $("backSetup"),
};

const session = getSession();
mountUserBar($("userbar"), { base: "../../" });
mountTemplatePicker({ game: GAME_ID });
Music.play(GAME_ID);

/* ===================== estado ===================== */

let mode = "local";                                   // "local" (hot-seat) | "online"
let settings = { players: 4, seconds: PARTY.turnSeconds, open: true };
let local = null;                                     // { state, viewSeat, seconds, deadline, ended, ranking, reason }
let gateOpen = false;                                 // tela de passar o aparelho aberta (só local)
let gateSeat = null;
let pendingTile = null;                               // pedra aguardando a escolha da ponta
let online = null;                                    // sessão party (shared/party-session.js)
let partyUi = null;                                   // painel do lobby/resultado (shared/party-ui.js)
let sending = false;                                  // lance online em trânsito
let flashTimer = 0;

const seatsOf = n => Array.from({ length: Math.max(0, n | 0) }, (_, i) => i + 1);
const ctxOf = state => ({ seats: seatsOf(state.hands.length), out: [] });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const canOnline = () => Boolean(session && Cloud.active && Cloud.uid);
const isPlayable = (view, id) => Array.isArray(view?.playable) && view.playable.includes(id);

const ONLINE_MESSAGES = {
  duel_not_found: "Sala não encontrada. Confira o código com quem te convidou.",
  duel_full: "Essa sala já está cheia.",
  party_full: "Essa sala já está cheia.",
  bad_status: "Essa partida já começou ou terminou.",
  expired: "Essa sala expirou. Crie uma nova.",
  not_authenticated: "Entre na sua conta para jogar online.",
  not_party_game: "Esse jogo não tem partida online.",
  not_party_duel: "Essa sala não é de Dominó.",
  bad_code: "Código inválido. Confira com quem te convidou.",
  bad_duel: "Sala inválida.",
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
const acceptRequested = params.get("aceitar") === "1";   // vem do aviso global: "Entrar na sala"
let acceptPending = acceptRequested;

function clearInvite() {
  try { history.replaceState(null, "", location.pathname); } catch { /* sem History API */ }
}

/** Mantém a sala no endereço (recarregar volta para ela) e tira o `aceitar`, para o aceite não se repetir. */
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
  return view?.counts?.find(entry => entry.seat === seat) ?? { seat, tiles: 0, out: false };
}

const countText = entry => (entry.out ? "fora" : entry.tiles === 0 ? "sem pedras" : plural(entry.tiles, "pedra", "pedras"));
const pointsOf = (view, seat) => view?.points?.[seat - 1] ?? 0;
const pointsText = value => `${value} ${value === 1 ? "ponto" : "pontos"}`;

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

/* Em jogo, o painel da partida fica logo abaixo do título "Dominó" (antes da mesa).
   No lobby, na contagem e no resultado ele volta para cima da seção, já que a mesa está escondida. */
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

function renderTable(view, bottomSeat) {
  renderOpponents(view, bottomSeat);
  renderBottom(view, bottomSeat);
  renderBoard(view);
  renderActions(view);
  renderHand(view);
  renderRound(view);
}

function renderOpponents(view, bottom) {
  els.leftPlayer.replaceChildren();
  els.topPlayer.replaceChildren();
  els.rightPlayer.replaceChildren();
  const n = view.counts.length;
  const positions = n <= 2 ? ["top"] : n === 3 ? ["left", "top"] : ["left", "top", "right"];
  positions.forEach((position, index) => {
    const seat = ((bottom - 1 + index + 1) % n) + 1;
    const host = position === "left" ? els.leftPlayer : position === "top" ? els.topPlayer : els.rightPlayer;
    host.replaceChildren(opponentNode(view, seat, position));
  });
}

function opponentNode(view, seat, position) {
  const entry = countOf(view, seat);
  const node = document.createElement("div");
  node.className = `opponent ${position === "top" ? "top" : "side"}`
    + (view.turn === seat ? " turn" : "")
    + (entry.out ? " out" : "");

  const profile = document.createElement("div");
  profile.className = "opponent-profile";
  const avatar = document.createElement("span");
  avatar.className = "opponent-avatar";
  avatar.append(avatarNode(playerAvatar(seat)));
  const meta = document.createElement("div");
  meta.className = "opponent-meta";
  const name = document.createElement("span");
  name.className = "opponent-name";
  name.textContent = displayName(seat);
  const count = document.createElement("span");
  count.className = "opponent-count";
  count.textContent = `${countText(entry)} · ${pointsText(pointsOf(view, seat))}`;
  meta.append(name, count);
  profile.append(avatar, meta);
  node.append(profile);

  if (!entry.out && entry.tiles > 0) {
    const hand = document.createElement("div");
    hand.className = "opponent-hand";
    const shown = Math.min(entry.tiles, 7);
    for (let i = 0; i < shown; i++) {
      const back = document.createElement("span");
      back.className = "back-tile";
      back.setAttribute("aria-hidden", "true");
      hand.append(back);
    }
    if (entry.tiles > shown) {
      const more = document.createElement("span");
      more.className = "more";
      more.textContent = `+${entry.tiles - shown}`;
      hand.append(more);
    }
    node.append(hand);
  }
  return node;
}

function renderBottom(view, bottom) {
  const entry = countOf(view, bottom);
  const node = document.createElement("div");
  node.className = "opponent bottom" + (view.turn === bottom ? " turn" : "") + (entry.out ? " out" : "");

  const profile = document.createElement("div");
  profile.className = "opponent-profile";
  const avatar = document.createElement("span");
  avatar.className = "opponent-avatar";
  avatar.append(avatarNode(playerAvatar(bottom)));
  const meta = document.createElement("div");
  meta.className = "opponent-meta";
  const name = document.createElement("span");
  name.className = "opponent-name";
  name.textContent = displayName(bottom);
  const count = document.createElement("span");
  count.className = "opponent-count";
  count.textContent = `${countText(entry)} · ${pointsText(pointsOf(view, bottom))}`;
  meta.append(name, count);
  profile.append(avatar, meta);

  const side = document.createElement("span");
  side.className = "opponent-count";
  side.textContent = "Sua mão";
  node.append(profile, side);
  els.bottomPlayer.replaceChildren(node);
}

/* ---------- desenho das pedras ---------- */

const DOT_POSITIONS = [
  [], [4], [2, 6], [2, 4, 6], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8],
];

function tileFace(value) {
  const face = document.createElement("span");
  face.className = "tile-face";
  const on = new Set(DOT_POSITIONS[value] ?? []);
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement("span");
    cell.className = "pip-cell" + (on.has(i) ? " on" : "");
    face.append(cell);
  }
  return face;
}

/** Pedra visual com as duas faces (left/right já na orientação da mesa). */
function tileNode(left, right, className = "tile") {
  const node = document.createElement("span");
  node.className = className;
  node.append(tileFace(left), tileFace(right));
  return node;
}

/* ---------- animação: a pedra sai da mão e pousa na mesa ---------- */

let flight = null;   // { tile, from: DOMRect, after? } — o lance já saiu da mão, falta desenhar o voo
let flying = null;   // clone em voo na tela; o render seguinte esconde a pedra de destino até ela pousar

const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/** Guarda a posição da pedra na mão ANTES do lance: o render seguinte troca a mão pela mesa. */
function queueFlight(id) {
  flight = null;
  if (reduceMotion()) return;
  const source = els.hand.querySelector(`[data-tile="${id}"]`);
  if (!source) return;
  const from = source.getBoundingClientRect();
  if (from.width < 8 || from.height < 8) return;
  flight = { tile: id, from };
}

/** Cria um clone da pedra na posição da mão e leva até o lugar que ela ocupa na mesa. */
function launchFlight() {
  const job = flight;
  flight = null;
  if (!job) return;
  const dest = els.board.querySelector(`.tile[data-tile="${job.tile}"]`);
  if (!dest) { job.after?.(); return; }
  const from = job.from;
  const to = dest.getBoundingClientRect();
  if (!to.width || !to.height) { job.after?.(); return; }
  if (to.left === from.left && to.top === from.top && to.width === from.width) { job.after?.(); return; }

  const ghost = dest.cloneNode(true);
  ghost.removeAttribute("role");
  ghost.removeAttribute("aria-label");
  ghost.classList.remove("just-played");
  ghost.classList.add("flying-tile");
  Object.assign(ghost.style, {
    left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`,
  });
  dest.style.visibility = "hidden";
  flying = job;
  document.body.append(ghost);

  let landed = false;
  const land = () => {
    if (landed) return;
    landed = true;
    clearTimeout(guard);
    ghost.remove();
    flying = null;
    /* Um render no meio do voo troca o nó: procura a pedra atual antes de revelar. */
    const tile = els.board.querySelector(`.tile[data-tile="${job.tile}"]`) ?? dest;
    tile.style.visibility = "";
    tile.classList.add("tile-landed");
    setTimeout(() => tile.classList.remove("tile-landed"), 320);
    job.after?.();
  };
  const guard = setTimeout(land, 600);
  ghost.addEventListener("transitionend", land, { once: true });

  const dx = to.left - from.left;
  const dy = to.top - from.top;
  const scale = to.width / from.width;
  requestAnimationFrame(() => {
    ghost.style.transition = "transform .34s cubic-bezier(.22,.9,.32,1.08)";
    ghost.style.transform = `translate(${dx}px,${dy}px) scale(${scale})`;
  });
}

function renderBoard(view) {
  const board = Array.isArray(view.board) ? view.board : [];
  const [left, right] = view.ends ?? [null, null];
  els.endsText.textContent = board.length ? `Pontas ${left} · ${right}` : "Mesa vazia";
  els.roundBadge.textContent = `Rodada ${view.roundNo ?? 1}`;

  if (!board.length) {
    const empty = document.createElement("p");
    empty.className = "board-empty";
    empty.textContent = "A mesa espera a primeira pedra.";
    els.board.replaceChildren(empty);
    flight = null;
    return;
  }

  els.board.classList.toggle("dense", board.length > 14);
  els.board.classList.toggle("x-dense", board.length > 22);
  const lastTile = view.last?.action === "play" ? view.last.tile : null;
  const nodes = board.map(entry => {
    const node = tileNode(entry.left, entry.right);
    node.dataset.tile = entry.tile;
    node.setAttribute("role", "img");
    node.setAttribute("aria-label", tileName(entry.tile));
    if (entry.tile === lastTile) node.classList.add("just-played");
    return node;
  });
  els.board.replaceChildren(...nodes);
  if (flying) {
    const pending = els.board.querySelector(`.tile[data-tile="${flying.tile}"]`);
    if (pending) pending.style.visibility = "hidden";
  }

  const target = nodes[Math.max(0, board.findIndex(entry => entry.tile === lastTile))] ?? nodes[0];
  if (target) {
    els.board.scrollLeft = Math.max(0, target.offsetLeft - (els.board.clientWidth - target.offsetWidth) / 2);
  }
  launchFlight();
}

function renderActions(view) {
  const active = canAct(view);
  els.drawBtn.disabled = !active || !view.canDraw;
  els.passBtn.disabled = !active || !view.canPass;
  els.boneyardCount.textContent = view.boneyard > 0 ? `${view.boneyard} no monte` : "Monte vazio";
  els.hint.textContent = hintText(view);
}

function hintText(view) {
  if (!view) return "";
  if (view.ranking) return "Partida encerrada.";
  if (mode === "local" && gateOpen) return "Passe o aparelho para o próximo jogador.";
  if (mode === "online" && !online?.started) return "Aguardando a largada…";
  if (view.turn !== view.seat) return `Vez de ${playerName(view.turn)}.`;
  if (view.canDraw) return "Nenhuma pedra encaixa: compre do monte.";
  if (view.canPass) return "Sem pedra jogável e monte vazio: passe a vez.";
  if ((view.playable ?? []).length > 1) return "Escolha uma pedra e, se servir nas duas pontas, o lado.";
  return "Jogue uma pedra que encaixe em uma das pontas.";
}

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
  const label = mode === "local" ? displayName(view.seat) : "Sua mão";
  els.handLabel.textContent = `${label} · ${plural(hand.length, "pedra", "pedras")} · ${pointsText(pointsOf(view, view.seat))}${entry.out ? " · fora" : ""}`;

  if (!hand.length) {
    const empty = document.createElement("p");
    empty.className = "hand-empty";
    empty.textContent = view.ranking ? "Sem pedras — rodada encerrada." : "Sem pedras.";
    els.hand.replaceChildren(empty);
    return;
  }

  const active = canAct(view);
  const buttons = hand.map(id => {
    const playable = active && isPlayable(view, id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tile-hand";
    button.dataset.tile = id;
    button.disabled = !playable;
    button.setAttribute("aria-label", `${tileName(id)}${playable ? " — jogável" : ""}`);
    const tile = tileOf(id);
    button.append(tileNode(tile.a, tile.b));
    if (playable) button.addEventListener("click", () => onTile(id, view));
    return button;
  });
  els.hand.replaceChildren(...buttons);
}

function renderRound(view) {
  const round = view.lastRound;
  if (!round) { els.roundNote.textContent = ""; return; }
  els.roundNote.textContent = roundSummary(round);
}

function roundSummary(round) {
  const prefix = `Rodada ${round.roundNo}: `;
  if (round.reason === "batida") {
    return `${prefix}${playerName(round.winner)} bateu e somou ${pointsText(round.points)}.`;
  }
  if (round.reason === "fechado") {
    if (round.tie) return `${prefix}jogo fechado com empate na menor mão — ninguém pontuou.`;
    return `${prefix}jogo fechado: ${playerName(round.winner)} tinha a menor mão e somou ${pointsText(round.points)}.`;
  }
  return "";
}

/* ===================== status e relógio ===================== */

function renderStatus() {
  /* Em jogo online a faixa da partida (shared/party-ui.js) já mostra a vez e o tempo:
     escondemos o selo do cabeçalho para não repetir a mesma informação duas vezes. */
  els.status.hidden = mode === "online" && online?.status === "running" && Boolean(online.started);
  if (mode === "local") {
    if (!local) return;
    if (local.ended) { els.status.textContent = "Partida encerrada."; return; }
    if (gateOpen) { els.status.textContent = `Vez de ${playerName(local.state.turn)} — aguardando o jogador.`; return; }
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

function onTile(id, view) {
  if (!canAct(view) || !isPlayable(view, id)) return;
  const legal = legalEnds(id, view.ends);
  if (!legal.length) { flash("Essa pedra não encaixa em nenhuma ponta."); return; }
  const [left, right] = view.ends ?? [null, null];
  if (legal.length > 1 && left != null && right != null && left !== right) {
    openEndPick(id, view, legal);
    return;
  }
  playTile(id, legal.includes("right") ? "right" : legal[0]);
}

function openEndPick(id, view, legal) {
  pendingTile = id;
  const [left, right] = view.ends;
  for (const button of els.endPick.querySelectorAll("[data-end]")) {
    const end = button.dataset.end;
    button.hidden = !legal.includes(end);
    button.querySelector(".end-number").textContent = end === "left" ? left : right;
  }
  els.endText.textContent = `${tileName(id)} serve nas duas pontas. Escolha de que lado ela entra.`;
  els.endPick.hidden = false;
  els.endPick.querySelector("[data-end]:not([hidden])")?.focus();
}

function closeEndPick() {
  pendingTile = null;
  els.endPick.hidden = true;
}

function playTile(id, end) {
  closeEndPick();
  queueFlight(id);
  move({ action: "play", tile: id, end });
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
  if (!result) { flight = null; flash("Jogada inválida."); return; }
  local.state = result.state;
  local.deadline = 0;
  if (result.ranking) { finishLocal(result.ranking, result.reason); return; }
  const next = result.turn;
  if (next === actor) {
    local.viewSeat = actor;
    local.deadline = performance.now() + local.seconds * 1000;
    render();
  } else if (flight) {
    /* A pedra pousa na mesa antes da tela de "passar o aparelho" cobrir a mesa. */
    flight.after = () => openGate(next);
    render();
  } else {
    openGate(next);
  }
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

function drawTile() {
  const view = currentView();
  if (!view || !canAct(view) || !view.canDraw) return;
  move({ action: "draw" });
}

function passTurn() {
  const view = currentView();
  if (!view || !canAct(view) || !view.canPass) return;
  move({ action: "pass" });
}

/* ===================== gate e resultado local ===================== */

function openGate(seat, note = "") {
  gateOpen = true;
  gateSeat = seat;
  if (local) local.deadline = 0;
  closeEndPick();
  els.gateTitle.textContent = `Vez de ${playerName(seat)}`;
  els.gateText.textContent = `Passe o aparelho para ${playerName(seat)}. Só ele deve olhar a mão.` + (note ? ` ${note}` : "");
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
  const beforeRound = local.state.roundNo;
  const next = timeoutTurn(local.state, seat, ctxOf(local.state));
  if (!next) return;
  local.state = next;
  local.deadline = 0;
  if (next.phase === "over") {
    flash(`${playerName(seat)} não jogou a tempo.`);
    finishLocal(next.ranking, "match");
    return;
  }
  const nextSeat = next.turn;
  local.viewSeat = nextSeat;
  const how = next.roundNo !== beforeRound ? "a rodada fechou e outra começou" : "a jogada foi automática";
  const note = `${playerName(seat)} não jogou a tempo: ${how}.`;
  if (nextSeat === seat) {
    local.deadline = performance.now() + local.seconds * 1000;
    render();
    flash(note);
  } else {
    openGate(nextSeat, note);
  }
}

function finishLocal(ranking, reason) {
  if (!local) return;
  local.ended = true;
  local.ranking = ranking;
  local.reason = reason ?? "match";
  local.deadline = 0;
  local.viewSeat = ranking?.[0]?.[0] ?? local.viewSeat;
  gateOpen = false;
  gateSeat = null;
  closeEndPick();
  els.gate.hidden = true;
  render();
  showLocalResult(ranking, local.reason);
}

function showLocalResult(ranking, reason) {
  const placeOf = placements(ranking);
  const winner = ranking[0]?.length === 1 ? ranking[0][0] : null;
  els.resultIcon.textContent = "Dominó";
  els.resultTitle.textContent = winner ? `${playerName(winner)} venceu!` : "Partida encerrada";
  els.resultText.textContent = winner
    ? `${playerName(winner)} chegou a ${pointsText(local.state.points[winner - 1] ?? 0)} e fechou a partida.`
    : reason === "elimination"
      ? "A partida terminou por eliminação. A classificação segue a menor mão."
      : "Classificação pela pontuação da partida.";

  const rows = [];
  for (const group of ranking) {
    for (const seat of group) {
      const points = local.state.points[seat - 1] ?? 0;
      const li = document.createElement("li");
      li.className = "result-row" + (placeOf[seat] === 1 ? " first" : "");
      const place = document.createElement("span");
      place.className = "result-place";
      place.textContent = `${placeOf[seat]}º`;
      const name = document.createElement("span");
      name.className = "result-name";
      name.textContent = playerName(seat);
      const score = document.createElement("span");
      score.className = "result-cards";
      score.textContent = pointsText(points);
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
  closeEndPick();
  els.gate.hidden = true;
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
  closeEndPick();
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
  closeEndPick();
  els.result.hidden = true;
}

/* ===================== sessão online ===================== */

function showOnlineShell() {
  els.setup.hidden = true;
  els.partyHost.hidden = false;
  els.gate.hidden = true;
  closeEndPick();
  els.result.hidden = true;
}

function startOnline() {
  if (online) return online;
  online = createPartySession();
  partyUi = mountPartyUi(els.partyHost, online, {
    title: "Dominó · 2–4 jogadores",
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
  els.game.hidden = true;   // espera ou contagem
  placePartyPanel(false);
}

async function createOnlineRoom() {
  if (!session) { noticeSetup("Entre na sua conta para jogar online."); return; }
  if (!canOnline()) { noticeSetup("O jogo online não está disponível nesta sessão."); return; }
  els.createRoom.disabled = true;
  try {
    startOnline();
    /* A quantidade escolhida é o tamanho exato da mesa: a sala só larga com todos os
       assentos ocupados e todos prontos (min = max). */
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

/** "Entrar na sala" do aviso global: a sala já está aberta nesta página; entra e marca pronto se preciso.
    A partida só começa quando todos estiverem dentro (a Edge larga e a contagem aparece no meio da tela). */
async function acceptOnlineInvite() {
  if (!online) return;
  if (online.status === "waiting" && !online.me()?.ready) {
    try { await online.ready(); } catch { /* a sala pode ter largado/mudado nesse meio-tempo */ }
  }
  await online.refresh().catch(() => { /* o polling tenta de novo */ });
  handleOnline();
}

/* A página já está com a sala aberta: aceita aqui mesmo, sem recarregar. */
window.addEventListener(ACCEPT_EVENT, event => {
  if (!online || online.id !== event.detail?.id) return;
  event.preventDefault();
  acceptPending = false;
  keepRoomInUrl(online.id);
  acceptOnlineInvite();
});

/** Sem `?duelo=`: se já existe uma sala minha neste jogo, abre ELA em vez de oferecer criar outra. */
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
  }, 3200);
}

/* ===================== eventos fixos ===================== */

els.startLocal.addEventListener("click", startLocalGame);
els.createRoom.addEventListener("click", () => createOnlineRoom());
els.gateBtn.addEventListener("click", confirmGate);
els.cancelEnd.addEventListener("click", closeEndPick);
els.endPick.addEventListener("click", event => {
  const button = event.target.closest("[data-end]");
  if (!button) return;
  const tile = pendingTile;
  if (!tile) { closeEndPick(); return; }
  playTile(tile, button.dataset.end);
});
els.drawBtn.addEventListener("click", drawTile);
els.passBtn.addEventListener("click", passTurn);
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
    noticeSetup("Escolha as vagas e o tempo e clique em “Criar sala online”. O código aparece na sala para convidar os amigos.");
  }
  resumeActiveRoom();
}
