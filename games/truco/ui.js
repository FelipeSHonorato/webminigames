/* TRUCO PAULISTA 1×1 — mesa, mão e ações de truco no navegador.
   Toda a regra vem de ./domain.js (código puro, testado). Dois modos usam a MESMA mesa:
   • local (hot-seat): os dois jogadores no mesmo aparelho; a mesa gira para o jogador da vez ficar embaixo e
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
import { ACCEPT_EVENT } from "../../shared/duel-invites.js";
import { avatarNode } from "../../shared/avatar.js";
import { isDuelCode, normalizeCode } from "../../shared/duel-hub.js";
import {
  PARTY, RED_SUITS, SUIT_SYMBOLS, TRUCO_NAMES,
  cardName, cardOf, cardShort, isManilha, manilhaName, nextTrucoValue,
  partyMove, partyStart, partyView, placements, timeoutTurn,
} from "./domain.js";

const GAME_ID = "truco";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLOCK_TICK = 250;

const $ = id => document.getElementById(id);
const els = {
  setup: $("setup"), timeOptions: $("timeOptions"), roomOptions: $("roomOptions"),
  startLocal: $("startLocal"), createRoom: $("createRoom"), duelNotice: $("duelNotice"),
  partyHost: $("partyHost"), game: $("game"), status: $("status"), main: document.querySelector("main"),
  topPlayer: $("topPlayer"), bottomPlayer: $("bottomPlayer"),
  scoreBottomName: $("scoreBottomName"), scoreBottomValue: $("scoreBottomValue"),
  scoreTopName: $("scoreTopName"), scoreTopValue: $("scoreTopValue"),
  handNo: $("handNo"), handValue: $("handValue"), roundInfo: $("roundInfo"), turnTimer: $("turnTimer"),
  tableCards: $("tableCards"), roundResult: $("roundResult"), hint: $("hint"),
  trucoBtn: $("trucoBtn"), acceptBtn: $("acceptBtn"), raiseBtn: $("raiseBtn"), foldBtn: $("foldBtn"),
  maoPlayBtn: $("maoPlayBtn"), maoFoldBtn: $("maoFoldBtn"),
  handLabel: $("handLabel"), hand: $("hand"),
  gate: $("gate"), gateTitle: $("gateTitle"), gateText: $("gateText"), gateBtn: $("gateBtn"),
  result: $("result"), resultIcon: $("resultIcon"), resultTitle: $("resultTitle"), resultText: $("resultText"),
  resultList: $("resultList"), rematch: $("rematch"), backSetup: $("backSetup"),
};

const session = getSession();
mountUserBar($("userbar"), { base: "../../" });
Music.play(GAME_ID);

/* ===================== estado ===================== */

let mode = "local";                                   // "local" (hot-seat) | "online"
let settings = { seconds: PARTY.turnSeconds, open: true };
let local = null;                                     // { state, viewSeat, seconds, deadline, ended, ranking, reason }
let gateOpen = false;                                 // tela de passar o aparelho aberta (só local)
let gateSeat = null;
let online = null;                                    // sessão party (shared/party-session.js)
let partyUi = null;                                   // painel do lobby/resultado (shared/party-ui.js)
let sending = false;                                  // lance online em trânsito
let flashTimer = 0;

const otherSeat = seat => (seat === 1 ? 2 : 1);
const ctxOf = state => ({ seats: Array.from({ length: state.hands.length }, (_, i) => i + 1), out: [] });
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
  not_party_duel: "Essa sala não é de Truco.",
  bad_code: "Código inválido. Confira com quem te convidou.",
  bad_duel: "Sala inválida.",
  bad_players: "A sala precisa ter exatamente dois jogadores.",
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
  for (const button of els.timeOptions.querySelectorAll("[data-seconds]")) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.seconds) === settings.seconds));
  }
  for (const button of els.roomOptions.querySelectorAll("[data-open]")) {
    button.setAttribute("aria-pressed", String((button.dataset.open === "true") === settings.open));
  }
}

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

function renderTable(view, bottomSeat) {
  const topSeat = otherSeat(bottomSeat);
  renderPlayer(view, topSeat, "top");
  renderPlayer(view, bottomSeat, "bottom");
  renderScore(view, bottomSeat, topSeat);
  renderMatchInfo(view);
  renderTableCards(view);
  renderActions(view);
  renderHand(view);
}

/* ===================== jogadores e placar ===================== */

function playerBar(view, seat, role) {
  const entry = countOf(view, seat);
  const node = document.createElement("div");
  node.className = "opponent" + (view.turn === seat ? " turn" : "") + (entry.out ? " out" : "");

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
  count.className = "opponent-count" + ((view.points?.[seat - 1] ?? 0) >= 11 ? " eleven" : "");
  count.textContent = `${plural(view.points?.[seat - 1] ?? 0, "ponto", "pontos")} · ${countText(entry)}`;
  meta.append(name, count);
  profile.append(avatar, meta);

  if (role === "top") {
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
    side.textContent = "Sua mão";
    node.append(profile, side);
  }
  return node;
}

function renderPlayer(view, seat, role) {
  const host = role === "top" ? els.topPlayer : els.bottomPlayer;
  host.replaceChildren(playerBar(view, seat, role));
}

function renderScore(view, bottomSeat, topSeat) {
  const bottomPoints = view.points?.[bottomSeat - 1] ?? 0;
  const topPoints = view.points?.[topSeat - 1] ?? 0;
  els.scoreBottomName.textContent = mode === "online" ? "Você" : displayName(bottomSeat);
  els.scoreTopName.textContent = displayName(topSeat);
  els.scoreBottomValue.textContent = String(bottomPoints);
  els.scoreTopValue.textContent = String(topPoints);
  els.scoreBottomValue.parentElement.classList.toggle("at-eleven", bottomPoints >= 11);
  els.scoreTopValue.parentElement.classList.toggle("at-eleven", topPoints >= 11);
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

function renderTableCards(view) {
  const cards = Array.isArray(view.table) ? view.table : [];
  const lastRound = view.roundResults?.at(-1) ?? null;
  const nodes = [];
  if (!cards.length) {
    nodes.push(emptyTableSlot(), emptyTableSlot());
  } else {
    for (const play of cards) {
      const wrapper = document.createElement("div");
      wrapper.className = "played-card";
      const board = cardNode(play.card);
      const label = document.createElement("span");
      label.className = "played-by";
      label.textContent = playerName(play.seat);
      wrapper.append(board, label);
      nodes.push(wrapper);
    }
    if (cards.length === 1) nodes.push(emptyTableSlot("Aguardando a 2ª carta"));
    if (cards.length === 2 && lastRound) {
      const winner = lastRound.winner;
      if (winner) nodes[cards.findIndex(play => play.seat === winner)]?.classList.add("winner");
    }
  }
  els.tableCards.replaceChildren(...nodes);

  if (cards.length === 2 && lastRound) {
    els.roundResult.textContent = lastRound.tie
      ? `Rodada ${lastRound.round} empatada.`
      : `${playerName(lastRound.winner)} venceu a rodada ${lastRound.round}.`;
    return;
  }
  if (cards.length === 1) {
    els.roundResult.textContent = "Aguardando a segunda carta da rodada.";
    return;
  }
  const hand = view.lastHand;
  if (hand) {
    els.roundResult.textContent = hand.winner
      ? `${playerName(hand.winner)} fez ${plural(hand.points, "ponto", "pontos")} e venceu a mão.`
      : "Mão empatada: ninguém pontuou.";
    return;
  }
  els.roundResult.textContent = view.maoDeFerro ? "Mão de ferro: os dois em 11." : "";
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
    text: `Correr (+1 para ${playerName(otherSeat(view.seat))})`,
  });

  els.hint.textContent = hintText(view);
}

function hintText(view) {
  if (!view) return "";
  if (view.phase === "over" || view.ranking) return "Partida encerrada.";
  if (mode === "local" && gateOpen) return "Passe o aparelho para o próximo jogador.";
  if (mode === "online" && !online?.started) return "Aguardando a largada…";

  if (view.phase === "mao") {
    if (view.maoDeOnze === view.seat) {
      return "Você chegou a 11: jogue valendo 3 ou corra e dê 1 ponto ao adversário.";
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

  if (view.turn !== view.seat) return `Vez de ${playerName(view.turn)}.`;
  if (view.maoDeFerro) return "Mão de ferro: os dois estão em 11 e a mão vale 3.";
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
  els.handLabel.textContent = mode === "local"
    ? `${displayName(view.seat)} · ${plural(hand.length, "carta", "cartas")}`
    : `Sua mão · ${plural(hand.length, "carta", "cartas")}`;

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
    if (playable) {
      node.addEventListener("click", () => onCard(id, view));
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

function onCard(id, view) {
  if (!canAct(view) || !view.canPlay) return;
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
  if (result.ranking) { finishLocal(result.ranking, result.reason); return; }

  const next = result.turn;
  local.viewSeat = next;
  if (next === actor) {
    local.deadline = performance.now() + local.seconds * 1000;
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
  if (next.ranking) { finishLocal(next.ranking, next.lastHand?.reason ?? "timeout"); return; }

  const nextSeat = next.turn;
  local.viewSeat = nextSeat;
  if (nextSeat === seat) {
    local.deadline = performance.now() + local.seconds * 1000;
    render();
  } else {
    openGate(nextSeat);
  }
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
  const winner = ranking[0]?.length === 1 ? ranking[0][0] : null;
  const points = local.state.points;
  els.resultIcon.textContent = winner ? String(points[winner - 1]) : "Fim";
  els.resultTitle.textContent = winner ? `${displayName(winner)} venceu!` : "Partida encerrada";
  els.resultText.textContent = winner
    ? `${displayName(winner)} fez ${plural(points[winner - 1], "ponto", "pontos")} e venceu a partida.`
    : "A partida terminou sem vencedor.";

  const rows = [];
  for (const group of ranking) {
    for (const seat of group) {
      const li = document.createElement("li");
      li.className = "result-row" + (placeOf[seat] === 1 ? " first" : "");
      const place = document.createElement("span");
      place.className = "result-place";
      place.textContent = `${placeOf[seat]}º`;
      const name = document.createElement("span");
      name.className = "result-name";
      name.textContent = displayName(seat);
      const score = document.createElement("span");
      score.className = "result-cards";
      score.textContent = plural(points[seat - 1] ?? 0, "ponto", "pontos");
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
}

function startLocalGame() {
  teardownOnline();
  clearLocal();
  const start = partyStart({ seats: [1, 2], rng: Math.random });
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

function startOnline() {
  if (online) return online;
  online = createPartySession();
  partyUi = mountPartyUi(els.partyHost, online, {
    title: "Truco Paulista · 1×1",
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
    /* 1×1: o tamanho exato da sala é 2 e a partida só larga com os dois assentos prontos e dentro. */
    await online.create(GAME_ID, {
      minPlayers: 2,
      maxPlayers: 2,
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
    noticeSetup("Clique em “Criar sala online” e compartilhe o código com o adversário. A sala é sempre 1×1.");
  }
  resumeActiveRoom();
}
