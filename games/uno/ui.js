/* UNO 2–4 jogadores — mesa, mão, cores do curinga e relógio no navegador.
   Toda a regra vem de ./domain.js (código puro, testado). Dois modos usam a MESMA mesa:
   • local (hot-seat): 2–4 jogadores no mesmo aparelho; a mesa gira para o jogador da vez ficar embaixo e
     uma tela de "passar o dispositivo" esconde a mão entre um turno e outro;
   • online: sala por código; mãos, vez, tempo e ranking são decididos pela Edge + Postgres
     (shared/party-session.js + shared/party-ui.js). O navegador só recebe a visão do próprio assento. */
import "../../shared/backend/boot.js";
import { getSession } from "../../shared/session.js";
import { mountUserBar } from "../../js/userbar.js";
import { Music } from "../../shared/music.js";
import { Cloud } from "../../shared/backend/cloud.js";
import { createPartySession } from "../../shared/party-session.js";
import { mountPartyUi, turnBanner } from "../../shared/party-ui.js";
import { avatarNode } from "../../shared/avatar.js";
import { isDuelCode, normalizeCode } from "../../shared/duel-hub.js";
import {
  COLOR_NAMES, PARTY, cardImage, cardName, isViewPlayable, isWild,
  partyMove, partyStart, partyView, placements, timeoutTurn,
} from "./domain.js";

const GAME_ID = "uno";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLOCK_TICK = 250;

const $ = id => document.getElementById(id);
const els = {
  setup: $("setup"), playerOptions: $("playerOptions"), timeOptions: $("timeOptions"), roomOptions: $("roomOptions"),
  startLocal: $("startLocal"), createRoom: $("createRoom"), duelNotice: $("duelNotice"),
  partyHost: $("partyHost"), game: $("game"), status: $("status"), main: document.querySelector("main"),
  leftPlayer: $("leftPlayer"), topPlayer: $("topPlayer"), rightPlayer: $("rightPlayer"), bottomPlayer: $("bottomPlayer"),
  dirBadge: $("dirBadge"), deckCount: $("deckCount"), turnTimer: $("turnTimer"),
  deckPile: $("deckPile"), topCardImg: $("topCardImg"), colorDot: $("colorDot"), colorName: $("colorName"),
  drawBtn: $("drawBtn"), passBtn: $("passBtn"), hint: $("hint"), handLabel: $("handLabel"), hand: $("hand"),
  gate: $("gate"), gateTitle: $("gateTitle"), gateText: $("gateText"), gateBtn: $("gateBtn"),
  colorPick: $("colorPick"), cancelColor: $("cancelColor"),
  result: $("result"), resultIcon: $("resultIcon"), resultTitle: $("resultTitle"), resultText: $("resultText"),
  resultList: $("resultList"), rematch: $("rematch"), backSetup: $("backSetup"),
};

const session = getSession();
mountUserBar($("userbar"), { base: "../../" });
Music.play(GAME_ID);

/* ===================== estado ===================== */

let mode = "local";                                   // "local" (hot-seat) | "online"
let settings = { players: 4, seconds: PARTY.turnSeconds, open: true };
let local = null;                                     // { state, viewSeat, seconds, deadline, ended, ranking, reason }
let gateOpen = false;                                 // tela de passar o aparelho aberta (só local)
let gateSeat = null;
let pendingWild = null;                               // curinga aguardando a escolha da cor
let online = null;                                    // sessão party (shared/party-session.js)
let partyUi = null;                                   // painel do lobby/resultado (shared/party-ui.js)
let sending = false;                                  // lance online em trânsito
let flashTimer = 0;

const seatsOf = n => Array.from({ length: Math.max(0, n | 0) }, (_, i) => i + 1);
const ctxOf = state => ({ seats: seatsOf(state.hands.length), out: [] });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const canOnline = () => Boolean(session && Cloud.active && Cloud.uid);

const ONLINE_MESSAGES = {
  duel_not_found: "Sala não encontrada. Confira o código com quem te convidou.",
  duel_full: "Essa sala já está cheia.",
  party_full: "Essa sala já está cheia.",
  bad_status: "Essa partida já começou ou terminou.",
  expired: "Essa sala expirou. Crie uma nova.",
  not_authenticated: "Entre na sua conta para jogar online.",
  not_party_game: "Esse jogo não tem partida online.",
  not_party_duel: "Essa sala não é de UNO.",
  bad_code: "Código inválido. Confira com quem te convidou.",
  bad_duel: "Sala inválida.",
  closed_room: "Essa sala é fechada: só entra com o código do convite.",
  too_many_open: "Você já tem uma sala aberta. Abra-a em Salas Online ou saia dela antes de criar outra.",
  invalid_move: "Jogada inválida. A mesa já foi atualizada.",
  not_your_turn: "Não é a sua vez.",
  stale: "A mesa mudou. Atualizando…",
  not_member: "Você não está nessa sala.",
  not_ready: "Ainda há jogadores sem marcar pronto.",
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
  if (players >= 2 && players <= PARTY.maxPlayers) settings.players = players;
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

function clearInvite() {
  try { history.replaceState(null, "", location.pathname); } catch { /* sem History API */ }
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
  return view?.counts?.find(entry => entry.seat === seat) ?? { seat, cards: 0, uno: false, out: false };
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

/* Em jogo, o painel da partida fica logo abaixo do título "UNO" (antes da mesa).
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
  renderPiles(view);
  renderActions(view);
  renderHand(view);
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
  count.textContent = countText(entry);
  if (entry.uno && !entry.out) {
    const badge = document.createElement("span");
    badge.className = "uno-badge";
    badge.textContent = "UNO!";
    count.append(" · ", badge);
  }
  meta.append(name, count);
  profile.append(avatar, meta);
  node.append(profile);

  if (!entry.out && entry.cards > 0) {
    const hand = document.createElement(position === "top" ? "div" : "div");
    hand.className = position === "top" ? "opponent-hand" : "side-hand";
    const shown = Math.min(entry.cards, position === "top" ? 7 : 3);
    for (let i = 0; i < shown; i++) {
      const back = document.createElement("img");
      back.src = "./cards/costa_cartas.png";
      back.alt = "";
      back.loading = "lazy";
      hand.append(back);
    }
    if (entry.cards > shown) {
      const more = document.createElement("span");
      more.className = "more";
      more.textContent = `+${entry.cards - shown}`;
      hand.append(more);
    }
    node.append(hand);
  }
  return node;
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
  count.textContent = countText(entry);
  if (entry.uno && !entry.out) {
    const badge = document.createElement("span");
    badge.className = "uno-badge";
    badge.textContent = "UNO!";
    count.append(" · ", badge);
  }
  meta.append(name, count);
  profile.append(avatar, meta);

  const side = document.createElement("span");
  side.className = "opponent-count";
  side.textContent = "Sua mão";
  node.append(profile, side);
  els.bottomPlayer.replaceChildren(node);
}

function renderPiles(view) {
  if (view.top) {
    els.topCardImg.src = `./cards/${cardImage(view.top)}`;
    els.topCardImg.alt = `Carta da mesa: ${cardName(view.top)}`;
  } else {
    els.topCardImg.src = "./cards/costa_cartas.png";
    els.topCardImg.alt = "Carta da mesa";
  }
  els.colorDot.className = "color-dot" + (view.color ? ` ${view.color}` : "");
  els.colorName.textContent = COLOR_NAMES[view.color] ?? "—";
  els.dirBadge.textContent = view.dir === -1 ? "↺" : "↻";
  els.dirBadge.title = view.dir === -1 ? "Sentido anti-horário" : "Sentido horário";
  els.deckCount.textContent = view.deck > 0 ? `${view.deck} no monte` : "Monte vazio";
}

function renderActions(view) {
  const active = canAct(view);
  els.drawBtn.disabled = !active || !view.canDraw;
  els.passBtn.disabled = !active || !view.canPass;
  els.deckPile.disabled = els.drawBtn.disabled;
  els.hint.textContent = hintText(view);
}

function hintText(view) {
  if (!view) return "";
  if (view.ranking) return "Partida encerrada.";
  if (mode === "local" && gateOpen) return "Passe o aparelho para o próximo jogador.";
  if (mode === "online" && !online?.started) return "Aguardando a largada…";
  if (view.turn !== view.seat) return `Vez de ${playerName(view.turn)}.`;
  if (view.drawn) return `Você comprou ${cardName(view.drawn)}. Jogue essa carta, jogue outra jogável ou passe.`;
  const playable = (view.hand ?? []).some(id => isViewPlayable(view, id));
  return playable ? "Escolha uma carta jogável ou compre." : "Nenhuma carta jogável: compre uma.";
}

function cardNode(id, playable, drawn) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "uno-card" + (drawn ? " drawn" : "");
  button.dataset.card = id;
  button.disabled = !playable;
  button.setAttribute("aria-label", `${cardName(id)}${playable ? " — jogável" : ""}`);
  const img = document.createElement("img");
  img.src = `./cards/${cardImage(id)}`;
  img.alt = "";
  img.draggable = false;
  button.append(img);
  return button;
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
  if (mode === "local") {
    els.handLabel.textContent = `${displayName(view.seat)} · ${plural(hand.length, "carta", "cartas")}${entry.uno ? " · UNO!" : ""}`;
  } else {
    els.handLabel.textContent = `Sua mão · ${plural(hand.length, "carta", "cartas")}${entry.uno ? " · UNO!" : ""}`;
  }

  if (!hand.length) {
    const empty = document.createElement("p");
    empty.className = "hand-empty";
    empty.textContent = view.ranking ? "Sem cartas — mão encerrada." : "Sem cartas.";
    els.hand.replaceChildren(empty);
    return;
  }

  const active = canAct(view);
  const cards = hand.map(id => {
    const playable = active && isViewPlayable(view, id);
    const button = cardNode(id, playable, view.drawn === id);
    if (playable) button.addEventListener("click", () => onCard(id, view));
    return button;
  });
  els.hand.replaceChildren(...cards);
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

function onCard(id, view) {
  if (!canAct(view)) return;
  if (!isViewPlayable(view, id)) { flash("Essa carta não combina com a mesa."); return; }
  if (isWild(id)) {
    pendingWild = id;
    els.colorPick.hidden = false;
    els.cancelColor.focus();
    return;
  }
  playCard(id, null);
}

function playCard(id, color) {
  closeColorPicker();
  const input = { action: "play", card: id };
  if (color) input.color = color;
  if (mode === "local") localMove(input);
  else onlineMove(input);
}

function closeColorPicker() {
  pendingWild = null;
  els.colorPick.hidden = true;
}

function drawCard() {
  const view = currentView();
  if (!view || !canAct(view) || !view.canDraw) return;
  if (mode === "local") localMove({ action: "draw" });
  else onlineMove({ action: "draw" });
}

function passTurn() {
  const view = currentView();
  if (!view || !canAct(view) || !view.canPass) return;
  if (mode === "local") localMove({ action: "pass" });
  else onlineMove({ action: "pass" });
}

function localMove(input) {
  if (!local || local.ended) return;
  const before = local.state.turn;
  const result = partyMove(local.state, before, input, ctxOf(local.state));
  if (!result) { flash("Jogada inválida."); return; }
  local.state = result.state;
  if (result.ranking) { finishLocal(result.ranking, result.reason); return; }

  const next = result.turn;
  local.viewSeat = next;
  const same = next === before;
  /* Comprar uma carta jogável continua o MESMO turno; jogar/passar/ser pulado inicia um turno novo. */
  const newTurn = input.action !== "draw" || !same;
  if (same) {
    if (newTurn) local.deadline = performance.now() + local.seconds * 1000;
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

/* ===================== gate e resultado local ===================== */

function openGate(seat) {
  gateOpen = true;
  gateSeat = seat;
  if (local) local.deadline = 0;
  pendingWild = null;
  els.colorPick.hidden = true;
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
  const nextSeat = next.turn;
  local.viewSeat = nextSeat;
  if (nextSeat === seat) {
    local.deadline = performance.now() + local.seconds * 1000;
    render();
    flash(`${playerName(seat)} não jogou a tempo: a vez passou.`);
  } else {
    openGate(nextSeat);
    flash(`${playerName(seat)} não jogou a tempo: a vez passou.`);
  }
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
  pendingWild = null;
  els.gate.hidden = true;
  els.colorPick.hidden = true;
  render();
  showLocalResult(ranking, local.reason);
}

function showLocalResult(ranking, reason) {
  const placeOf = placements(ranking);
  const winner = ranking[0]?.length === 1 ? ranking[0][0] : null;
  els.resultIcon.textContent = winner ? "UNO!" : "Fim";
  els.resultTitle.textContent = winner ? `${playerName(winner)} venceu!` : "Partida encerrada";
  els.resultText.textContent = winner
    ? `${playerName(winner)} ficou sem cartas. A classificação dos demais segue a menor mão.`
    : reason === "stalled"
      ? "Todas as cartas estão nas mãos. A classificação segue a menor mão."
      : "Classificação pela quantidade de cartas.";

  const rows = [];
  for (const group of ranking) {
    for (const seat of group) {
      const count = local.state.hands[seat - 1]?.length ?? 0;
      const li = document.createElement("li");
      li.className = "result-row" + (placeOf[seat] === 1 ? " first" : "");
      const place = document.createElement("span");
      place.className = "result-place";
      place.textContent = `${placeOf[seat]}º`;
      const name = document.createElement("span");
      name.className = "result-name";
      name.textContent = playerName(seat);
      const cards = document.createElement("span");
      cards.className = "result-cards";
      cards.textContent = count === 0 ? "sem cartas" : plural(count, "carta", "cartas");
      li.append(place, avatarNode(null), name, cards);
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
  pendingWild = null;
  els.gate.hidden = true;
  els.colorPick.hidden = true;
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
  els.colorPick.hidden = true;
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
  els.colorPick.hidden = true;
  els.result.hidden = true;
}

/* ===================== sessão online ===================== */

function showOnlineShell() {
  els.setup.hidden = true;
  els.partyHost.hidden = false;
  els.gate.hidden = true;
  els.colorPick.hidden = true;
  els.result.hidden = true;
}

function startOnline() {
  if (online) return online;
  online = createPartySession();
  partyUi = mountPartyUi(els.partyHost, online, {
    title: "UNO · 2–4 jogadores",
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
    handleOnline();
  } catch (e) {
    teardownOnline();
    noticeSetup(onlineMessage(e));
  }
}

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
els.cancelColor.addEventListener("click", closeColorPicker);
els.colorPick.addEventListener("click", event => {
  const button = event.target.closest("[data-color]");
  if (!button) return;
  const color = button.dataset.color;
  const id = pendingWild;
  if (!id) { closeColorPicker(); return; }
  pendingWild = null;
  els.colorPick.hidden = true;
  playCard(id, color);
});
els.deckPile.addEventListener("click", drawCard);
els.drawBtn.addEventListener("click", drawCard);
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
