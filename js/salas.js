import "../shared/backend/boot.js";
import { mountUserBar } from "./userbar.js";
import { Scores } from "../shared/scores.js";
import { Cloud } from "../shared/backend/cloud.js";
import { avatarNode } from "../shared/avatar.js";
import { el, scopeTabs, renderLeaderboard } from "../shared/ranking-list.js";
import { requireSession } from "../shared/session.js";
import { GAMES } from "./games.js";
import { rankingPanels } from "../shared/hub-nav.js";
import {
  ALL, cleanRooms, filterItems, roomsOf, filterFromHash, hashForFilter, filterText, openedAgo, durationLabel, roomHref,
} from "../shared/rooms.js";

const $ = id => document.getElementById(id);
const user = requireSession("index.html");

const REFRESH_MS = 10000;        // a lista se atualiza sozinha enquanto a aba está visível
const RANKING_ROTATE_MS = 3000;  // mesmo carrossel do modo Duelos do hub

const ICONS = {
  all: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`,
  game: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8" r="3"/><circle cx="16.5" cy="9.5" r="2.6"/><path d="M2.8 19.5c.5-3 2.5-4.6 5.2-4.6s4.7 1.6 5.2 4.6"/><path d="M14.4 19.5c.4-2.3 1.9-3.6 4-3.6 1.3 0 2.4.5 3.2 1.4"/></svg>`,
};

let filter = filterFromHash(location.hash, GAMES);   // "all" ou o id de um jogo de duelo
let rooms = [];                                      // todas as salas abertas (já limpas)
let state = "loading";                               // loading | ready | offline | error
let updatedAt = null;
let busy = false;
let paintedSig = "";

/* ---------- Lateral: o filtro por jogo ---------- */

/** Monta os botões uma vez; depois só atualiza contagem e o item atual (o foco do teclado não se perde). */
function paintNav() {
  const nav = $("roomsNav");
  const items = filterItems(GAMES, rooms);
  if (!nav.querySelector("[data-filter]")) {
    nav.innerHTML = `<p class="hub-nav-title">Jogos</p><div class="hub-nav-list">` +
      items.map(item =>
        `<button class="hub-nav-item" type="button" data-filter="${item.id}">${item.id === ALL ? ICONS.all : ICONS.game}` +
        `<span>${item.label}</span><span class="hub-nav-count">0</span></button>`).join("") +
      `</div><p class="hub-nav-note">Escolha um jogo para ver só as salas dele.</p>`;
  }
  for (const item of items) {
    const btn = nav.querySelector(`[data-filter="${item.id}"]`);
    if (!btn) continue;
    btn.querySelector(".hub-nav-count").textContent = String(item.count);
    if (item.id === filter) btn.setAttribute("aria-current", "true"); else btn.removeAttribute("aria-current");
  }
}

/* ---------- Lista de salas ---------- */

function roomNode(room) {
  const game = GAMES[room.gameId];
  const li = el("li", "room" + (room.mine ? " mine" : ""));
  li.dataset.roomId = room.id;

  const avatar = el("span", "room-avatar");
  avatar.append(avatarNode(room.host?.avatar));

  const title = el("p", "room-title");
  title.append(el("span", "room-game", game.title));
  if (room.mine) title.append(el("span", "room-badge", "Sua sala"));

  const time = durationLabel(room);
  const meta = el("p", "room-meta", [
    room.host?.nickname || "Jogador",                // nome sempre por textContent (el), nunca innerHTML
    time && `Tempo: ${time}`,
    openedAgo(room.createdAt) && `aberta ${openedAgo(room.createdAt)}`,
  ].filter(Boolean).join(" · "));

  const body = el("div", "room-body");
  body.append(title, meta);
  const href = roomHref(room, GAMES);
  li.append(avatar, body, el("span", "room-state", href ? "Ver código da sala" : "Aguardando desafiante"));
  if (href) {
    /* Sua sala: o card inteiro leva de volta à tela do código (a página do jogo reabre a sala pelo id). */
    const open = el("a", "room-open");
    open.href = href;
    open.setAttribute("aria-label", `Abrir sua sala de ${game.title} e ver o código de convite`);
    li.classList.add("clickable");
    li.append(open);
  }
  return li;
}

function emptyMessage(visible) {
  const box = $("roomsEmpty");
  box.replaceChildren();
  if (state === "offline") {
    box.append("As salas online exigem uma conta com a nuvem ligada. ");
    const a = el("a", "", "Entre com sua conta");
    a.href = "index.html?modo=conta";
    box.append(a, " para ver e criar salas.");
    return true;
  }
  if (state === "error" && !rooms.length) { box.textContent = "Não foi possível carregar as salas agora. Vamos tentar de novo em instantes."; return true; }
  if (state === "ready" && !visible.length) {
    const title = GAMES[filter]?.title;
    box.append(title ? `Nenhuma sala de ${title} aberta agora. ` : "Nenhuma sala aberta agora. ");
    const a = el("a", "", "Crie uma sala");
    a.href = "jogos.html#duelos";
    box.append(a, " em Duelos 1×1 e espere um desafiante.");
    return true;
  }
  return false;
}

function paintRooms() {
  const list = $("rooms");
  const visible = roomsOf(rooms, filter);
  /* Só redesenha quando algo visível mudou (evita piscar o avatar a cada atualização). */
  const sig = JSON.stringify([state, filter, visible.map(r => [r.id, r.mine, openedAgo(r.createdAt)])]);
  if (sig === paintedSig) return;
  paintedSig = sig;

  list.setAttribute("aria-busy", String(state === "loading"));
  if (state === "loading") {
    list.replaceChildren(...[0, 1, 2].map(() => el("li", "room skeleton")));
    $("roomsEmpty").hidden = true;
    return;
  }
  const empty = emptyMessage(visible);
  $("roomsEmpty").hidden = !empty;
  /* O link da sua sala é focável: se o teclado estava nele, devolve o foco depois de redesenhar. */
  const focusedId = document.activeElement?.closest?.("[data-room-id]")?.dataset.roomId;
  list.replaceChildren(...(state === "offline" ? [] : visible.map(roomNode)));
  if (focusedId) [...list.querySelectorAll("[data-room-id]")].find(li => li.dataset.roomId === focusedId)?.querySelector(".room-open")?.focus({ preventScroll: true });
}

function paintStatus() {
  const text = {
    loading: "Carregando salas…",
    offline: "",
    error: rooms.length ? "Sem conexão com o servidor: mostrando a última lista." : "",
    ready: updatedAt ? `Atualizado às ${updatedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "",
  }[state];
  $("roomsStatus").textContent = text;
  $("roomsRefresh").hidden = state === "offline";
  $("roomsRefresh").disabled = busy;
}

function paint() {
  paintNav();
  paintRooms();
  paintStatus();
}

async function load() {
  if (busy) return;
  if (!Cloud.owns(user.id)) { state = "offline"; paint(); return; }   // duelo exige conta na nuvem
  busy = true; paintStatus();
  try {
    const data = await Cloud.duelRooms();
    rooms = cleanRooms(data?.rooms, GAMES);
    state = "ready"; updatedAt = new Date();
  } catch (e) {
    console.warn("[WebMiniGames] salas online indisponíveis:", e?.message ?? e);
    state = "error";
  } finally {
    busy = false;
  }
  paint();
}

/* ---------- Filtro, título e endereço ---------- */

function setFilter(next, { updateHash = true } = {}) {
  filter = filterFromHash(hashForFilter(next), GAMES);
  const text = filterText(filter, GAMES);
  $("rooms-title").textContent = text.title;
  $("roomsSub").textContent = text.sub;
  if (updateHash) {
    try { history.replaceState(null, "", hashForFilter(filter) || location.pathname + location.search); } catch { /* sem History API */ }
  }
  paint();
  syncRanking();
}

/* ---------- Ranking: o mesmo do modo Duelos 1×1 do hub ----------
   Em "Todos", um painel por jogo de duelo em carrossel (3 s); com um jogo escolhido, só o ranking dele. */
let rankingTimer = null, panelIndex = 0, rankingToken = 0;

const panelsNow = () => rankingPanels(GAMES, "duel").filter(panel => filter === ALL || panel.gameId === filter);

function stopRankingTimer() {
  if (rankingTimer) { clearInterval(rankingTimer); rankingTimer = null; }
}

function syncDots() {
  [...$("overallDots").children].forEach((dot, i) => dot.setAttribute("aria-current", String(i === panelIndex)));
}

function paintDots(panels) {
  const host = $("overallDots");
  host.replaceChildren();
  host.hidden = panels.length < 2;
  if (panels.length < 2) return;
  panels.forEach((panel, i) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "overall-dot";
    dot.title = panel.title;
    dot.setAttribute("aria-label", panel.title);
    dot.onclick = () => { panelIndex = i; showRankingPanel(panels[i]); restartRankingTimer(panels); };
    host.append(dot);
  });
  syncDots();
}

function restartRankingTimer(panels) {
  stopRankingTimer();
  if (panels.length < 2) return;
  rankingTimer = setInterval(() => {
    panelIndex = (panelIndex + 1) % panels.length;
    showRankingPanel(panels[panelIndex]);
  }, RANKING_ROTATE_MS);
}

async function showRankingPanel(panel) {
  overallTabs.sync();
  $("overall-title").textContent = panel.title;
  $("overallSub").textContent = panel.sub;
  $("overallList").innerHTML = '<li class="empty">Carregando ranking…</li>';
  $("overallNote").textContent = "";
  syncDots();

  const token = ++rankingToken;
  const data = await Scores.duelLeaderboard(panel.gameId, { scope: overallTabs.scope, limit: 10 });
  if (token !== rankingToken) return;                 // o filtro/aba mudou enquanto a resposta vinha

  renderLeaderboard({
    list: $("overallList"), note: $("overallNote"), data, scope: overallTabs.scope,
    loginUrl: "index.html?modo=conta",
    suffix: "Elo",
    emptyText: `Ninguém disputou ${GAMES[panel.gameId]?.title ?? "este duelo"} ainda.`,
    emptyRegionText: "Ninguém da sua região disputou ainda.",
    noteText: Cloud.active ? "Vença um duelo para entrar no ranking." : "O ranking de duelo aparece quando a conta está na nuvem.",
  });
}

function syncRanking() {
  stopRankingTimer();
  const panels = panelsNow();
  panelIndex = 0;
  paintDots(panels);
  if (!panels.length) {
    $("overall-title").textContent = "Ranking Geral - Duelos 1×1";
    $("overallSub").textContent = "Nenhum jogo de duelo por enquanto.";
    $("overallList").innerHTML = '<li class="empty">Nenhum jogo de duelo por enquanto.</li>';
    $("overallNote").textContent = "";
    return;
  }
  showRankingPanel(panels[0]);
  restartRankingTimer(panels);
}

const overallTabs = scopeTabs($("overallScopes"), () => {
  const panels = panelsNow();
  if (!panels.length) return;
  panelIndex = Math.min(panelIndex, panels.length - 1);
  showRankingPanel(panels[panelIndex]);
  restartRankingTimer(panels);
});

/* ---------- Início ---------- */

if (user) {
  mountUserBar($("userbar"));
  $("roomsNav").addEventListener("click", event => {
    const btn = event.target.closest("[data-filter]");
    if (btn) setFilter(btn.dataset.filter);
  });
  $("roomsRefresh").addEventListener("click", load);
  addEventListener("hashchange", () => setFilter(filterFromHash(location.hash, GAMES), { updateHash: false }));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") load(); });
  setInterval(() => { if (document.visibilityState === "visible") load(); }, REFRESH_MS);

  setFilter(filter, { updateHash: false });
  load().then(() => $("rooms-title").focus({ preventScroll: true }));
}
