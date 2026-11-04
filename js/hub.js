import "../shared/backend/boot.js";
import { mountUserBar } from "./userbar.js";
import { Scores } from "../shared/scores.js";
import { Coins } from "../shared/coins.js";
import { Cloud } from "../shared/backend/cloud.js";
import { nextSpMidnight, spDay } from "../shared/daily.js";
import { GameSwitch } from "../shared/game-switch.js";
import { isAdmin } from "../shared/roles.js";
import { coinBadge } from "../shared/coin-badge.js";
import { scopeTabs, renderLeaderboard } from "../shared/ranking-list.js";
import { requireSession } from "../shared/session.js";
import { GAMES } from "./games.js";
import { rankLabel } from "../games/go/domain.js";
import { LEVEL_NAMES, WINS_PER_LEVEL, Progress } from "../shared/progress.js";
import { mountDuelEntry } from "../shared/duel-hub.js";
import { navItems, filterGames, modeFromHash, hashFor, modeText, normalizeMode, rankingPanels } from "../shared/hub-nav.js";

const $ = id => document.getElementById(id);
const user = requireSession("index.html");

/* Ícones da lateral (estáticos, sem dados do usuário). */
const NAV_ICONS = {
  all: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`,
  solo: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.4"/><path d="M5.5 20c.6-3.4 3.2-5.2 6.5-5.2s5.9 1.8 6.5 5.2"/></svg>`,
  duel: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8" r="3"/><circle cx="16.5" cy="9.5" r="2.6"/><path d="M2.8 19.5c.5-3 2.5-4.6 5.2-4.6s4.7 1.6 5.2 4.6"/><path d="M14.4 19.5c.4-2.3 1.9-3.6 4-3.6 1.3 0 2.4.5 3.2 1.4"/></svg>`,
};

/* Modo atual (Todos / Solo / Duelos) e a entrada de duelos montada, se houver. */
let mode = normalizeMode(modeFromHash(location.hash));
let duelEntry = null;

const winsOf = (game, uid) => Progress.wins(game.key, uid);
const PROVIDER_NOTE = { password: "", google: "", "google-demo": "Google (simulação)", anonymous: "Anônimo: o progresso fica só neste navegador" };

/* Ações logo abaixo de "Duelos 1×1": "Criar Sala" abre o pop-up do duelEntry; "Salas Online" é só um link por enquanto. */
const DUEL_ACTIONS = `<div class="hub-nav-sub">` +
  `<button class="hub-nav-sub-btn primary" type="button" id="btnCriarSala" data-action="create-room" aria-haspopup="dialog">Criar Sala</button>` +
  `<a class="hub-nav-sub-btn" id="btnSalasOnline" href="salas-online.html">Salas Online</a></div>`;

/** Lateral de modos: contadores vêm do catálogo; os jogos de duelo são os que têm `duel: true`. */
function renderNav() {
  $("hubNav").innerHTML = `<p class="hub-nav-title">Modos</p><div class="hub-nav-list">` +
    navItems(GAMES).map(item =>
      `<button class="hub-nav-item" type="button" data-mode="${item.mode}">${NAV_ICONS[item.mode]}` +
      `<span>${item.label}</span><span class="hub-nav-count">${item.count}</span></button>` +
      (item.mode === "duel" ? DUEL_ACTIONS : "")).join("") +
    `</div><p class="hub-nav-note">O duelo usa o <b>mesmo cenário</b> para os dois. Sem dicas, sem pontos — só o tempo.</p>`;
}

/** Mostra só os cards do modo (os skeletons também têm `data-game-id`, então seguem a mesma regra). */
function applyVisibility() {
  const visible = new Set(filterGames(GAMES, mode).map(([id]) => id));
  $("games").querySelectorAll("[data-game-id]").forEach(card => {
    card.hidden = !visible.has(card.dataset.gameId);
  });
}

/** Troca o modo no lugar (sem recarregar): título, subtítulo, cards e o hash. */
function setMode(next, { updateHash = true } = {}) {
  mode = normalizeMode(next);
  const text = modeText(mode);
  $("hub-title").textContent = text.title;
  /* Duelo exige conta: no modo Duelos a nota de anônimo não se aplica. */
  const anonymousNote = user.provider === "anonymous" && mode !== "duel" ? ` ${PROVIDER_NOTE.anonymous}.` : "";
  $("hubSub").textContent = text.sub + anonymousNote;
  $("hubNav").querySelectorAll("[data-mode]").forEach(btn => {
    if (btn.dataset.mode === mode) btn.setAttribute("aria-current", "true");
    else btn.removeAttribute("aria-current");
  });
  applyVisibility();
  $("games").dataset.hubMode = mode;   // no modo Duelos o selo 1×1 é redundante (todos os cards são do modo)
  const duels = navItems(GAMES)[2].count;
  $("hubEmpty").hidden = !(mode === "duel" && duels === 0);
  if (updateHash) {
    try { history.replaceState(null, "", hashFor(mode) || location.pathname + location.search); } catch { /* sem History API */ }
  }
  syncRanking();   // Solo = pontos; Duelos = um jogo por vez (carrossel de 3 s)
}

/** O saldo do card é o MESMO que o jogo usa: na nuvem, os coins do dia; no local/visitante, os coins locais.
    Se o status do dia ainda não carregou, cai no saldo local (o card é atualizado assim que ele chega). */
function balanceBadge(uid, id) {
  if (Cloud.owns(uid)) {
    const d = Cloud.daily(id);
    if (d) return coinBadge({ coins: d.coins ?? 0, max: d.maxCoins ?? 30 * (d.slots ?? Cloud.config()?.coinsPerDay ?? 2), nextRefillAt: nextSpMidnight(), daily: true });
  }
  return coinBadge(Coins.get(uid, id));
}

function renderSkeleton() {
  const ids = Object.keys(GAMES);
  $("games").setAttribute("aria-busy", "true");
  $("games").innerHTML = ids.map(id =>
    `<div class="game skeleton" data-game-id="${id}" aria-hidden="true">
      <div class="sk-preview"></div><div class="sk-line short"></div><div class="sk-line"></div><div class="sk-line"></div>
    </div>`).join("");
  applyVisibility();   // no modo Duelos sem jogos, o estado vazio aparece em vez dos skeletons
}

/** Miniatura do card: a mesma captura usada na página inicial (`assets/thumbs`, uma por tema). O SVG do
    catálogo fica escondido como reserva — se as imagens não existirem (jogo novo), ele aparece no lugar. */
const thumb = (id, g) =>
  `<span class="thumb"><img class="th-l" src="assets/thumbs/${id}-light.webp" alt="" width="360" height="360" decoding="async">` +
  `<img class="th-d" src="assets/thumbs/${id}-dark.webp" alt="" width="360" height="360" decoding="async">` +
  `<span class="thumb-fallback" hidden>${g.preview}</span></span>`;

/** Troca a miniatura pelo SVG de reserva quando alguma das imagens não carrega. */
function wireThumbFallback(btn) {
  const box = btn.querySelector(".thumb");
  if (!box) return;
  box.querySelectorAll("img").forEach(img => img.addEventListener("error", () => {
    const fallback = box.querySelector(".thumb-fallback");
    if (!fallback) return;
    box.innerHTML = fallback.innerHTML;
    box.classList.add("fallback");
  }, { once: true }));
}

function renderHub() {
  mountUserBar($("userbar"));
  $("games").setAttribute("aria-busy", "false");
  $("games").innerHTML = "";
  const entries = Object.entries(GAMES);
  entries.forEach(([id, g]) => {
    /* Jogo só de duelo (xadrez): não tem `key`, vitórias, nível nem coins — o card mostra o modo no lugar. */
    const solo = Boolean(g.key);
    const wins = solo ? winsOf(g, user.id) : 0, lv = Math.min(LEVEL_NAMES.length - 1, Math.floor(wins / WINS_PER_LEVEL));
    const last = lv === LEVEL_NAMES.length - 1, into = wins - lv * WINS_PER_LEVEL;
    const on = GameSwitch.isOn(id), playable = on || isAdmin(user);   // desligado: só o administrador entra
    const btn = document.createElement(playable ? "a" : "div");     // cada jogo é uma página própria
    btn.className = "game" + (on ? "" : " off");
    btn.dataset.gameId = id;                                        // a lateral filtra por este id
    if (playable) btn.href = g.path; else btn.setAttribute("aria-disabled", "true");
    const level = solo
      ? `<div class="lvl"><span>${LEVEL_NAMES[lv]}</span><div class="bar"><i style="width:${last ? 100 : (into / WINS_PER_LEVEL) * 100}%"></i></div><span>${last ? wins + " vitórias" : into + "/" + WINS_PER_LEVEL}</span></div>`
      : `<div class="lvl"><span>Duelo 1×1</span><span>Sem pontos</span></div>`;
    const badge = g.duel
      ? `<span class="badge-duel">1×1</span>`
      : `<span class="badge-solo">Solo</span>`;
    btn.innerHTML = `${thumb(id, g)}<h3>${g.title}</h3><p>${g.desc}</p>${level}
      <div class="game-foot">${badge}<span class="play">${playable ? "Jogar" : "Indisponível"}</span></div>`;
    const title = btn.querySelector("h3");
    title.dataset.game = id;
    if (solo) title.append(balanceBadge(user.id, id));   // coins na frente do nome do jogo
    if (!on) {
      const tag = document.createElement("span");
      tag.className = "offtag"; tag.textContent = isAdmin(user) ? "Desligado (só administrador)" : "Desligado";
      title.append(tag);
    }
    $("games").append(btn);
    wireThumbFallback(btn);
  });
  setMode(mode, { updateHash: false });   // aplica o modo do endereço (#solo / #duelos)
}

/* Pop-up "Criar Sala": o #duelEntry (montado por `mountDuelEntry`) fica dentro de um <dialog> modal.
   O <dialog> já cuida de Esc, foco preso e fundo inerte; aqui entram o clique fora e o botão fechar. */
let hubReady = Promise.resolve();   // vira a promessa de "duelEntry montado" quando o hub carrega
let duelOpener = null;              // botão que abriu o pop-up, para devolver o foco ao fechar

async function openDuelModal(opener) {
  await hubReady;   // se o clique veio antes do carregamento, espera a entrada de duelos ser montada
  const modal = $("duelModal"), host = $("duelEntry");
  if (!duelEntry) {
    /* `mountDuelEntry` devolve null sem a nuvem ligada (duelo exige conta): explica em vez de abrir vazio. */
    const msg = document.createElement("p");
    msg.className = "duel-modal-empty";
    msg.textContent = "Criar sala exige uma conta com a nuvem ligada. Entre com sua conta para desafiar um amigo.";
    host.replaceChildren(msg);
    host.hidden = false;
  }
  duelOpener = opener ?? null;
  if (!modal.open) modal.showModal();
  host.querySelector("select, input")?.focus();
}

function closeDuelModal() {
  const modal = $("duelModal");
  if (modal.open) modal.close();
}

$("duelModalClose").addEventListener("click", closeDuelModal);
$("duelModal").addEventListener("click", event => { if (event.target === event.currentTarget) closeDuelModal(); });   // clique no fundo
$("duelModal").addEventListener("close", () => { duelOpener?.focus({ preventScroll: true }); duelOpener = null; });
addEventListener("pageshow", event => { if (event.persisted) closeDuelModal(); });   // voltou do duelo pelo histórico

/* Ranking lateral: fora dos duelos é o "Ranking Geral - Solo" (soma dos pontos);
   no modo Duelos é um painel por jogo, alternado em carrossel a cada 3 s. */
const RANKING_ROTATE_MS = 3000;
let rankingTimer = null, panelIndex = 0, rankingToken = 0;

const rankingPanelsNow = () => rankingPanels(GAMES, mode);

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
    dot.onclick = () => {
      panelIndex = i;
      showRankingPanel(panels[i], panels);
      restartRankingTimer(panels);
    };
    host.append(dot);
  });
  syncDots();
}

function restartRankingTimer(panels) {
  stopRankingTimer();
  if (mode !== "duel" || panels.length < 2) return;
  rankingTimer = setInterval(() => {
    panelIndex = (panelIndex + 1) % panels.length;
    showRankingPanel(panels[panelIndex], panels);
  }, RANKING_ROTATE_MS);
}

async function showRankingPanel(panel, panels) {
  overallTabs.sync();
  $("overall-title").textContent = panel.title;
  $("overallSub").textContent = panel.sub;
  $("overallList").innerHTML = '<li class="empty">Carregando ranking…</li>';
  $("overallNote").textContent = "";
  syncDots();

  const token = ++rankingToken;
  const data = panel.gameId
    ? await Scores.duelLeaderboard(panel.gameId, { scope: overallTabs.scope, limit: 10 })
    : await Scores.overall({ scope: overallTabs.scope, limit: 10 });
  if (token !== rankingToken) return;                 // o modo/aba mudou enquanto a resposta vinha

  renderLeaderboard({
    list: $("overallList"), note: $("overallNote"), data, scope: overallTabs.scope,
    loginUrl: "index.html?modo=conta",
    suffix: panel.gameId ? "Elo" : "pts",
    valueOf: panel.gameId === "go" ? r => rankLabel(r.points) : null,
    emptyText: panel.gameId ? `Ninguém disputou ${GAMES[panel.gameId]?.title ?? "este duelo"} ainda.` : undefined,
    emptyRegionText: panel.gameId ? "Ninguém da sua região disputou ainda." : undefined,
    noteText: panel.gameId
      ? (Cloud.active ? "Vença um duelo para entrar no ranking." : "O ranking de duelo aparece quando a conta está na nuvem.")
      : undefined,
  });
}

function syncRanking() {
  stopRankingTimer();
  const panels = rankingPanelsNow();
  panelIndex = 0;
  paintDots(panels);
  if (!panels.length) {
    $("overall-title").textContent = "Ranking Geral - Duelos 1×1";
    $("overallSub").textContent = "Nenhum jogo de duelo por enquanto.";
    $("overallList").innerHTML = '<li class="empty">Nenhum jogo de duelo por enquanto.</li>';
    $("overallNote").textContent = "";
    return;
  }
  showRankingPanel(panels[0], panels);
  restartRankingTimer(panels);
}

const overallTabs = scopeTabs($("overallScopes"), () => {
  const panels = rankingPanelsNow();
  if (!panels.length) return;
  panelIndex = Math.min(panelIndex, panels.length - 1);
  showRankingPanel(panels[panelIndex], panels);
  restartRankingTimer(panels);
});

if (user) {
  /* Lateral: troca de modo no lugar e mantém #solo / #duelos no endereço (link compartilhável). */
  $("hubNav").addEventListener("click", event => {
    const create = event.target.closest("[data-action='create-room']");
    if (create) { openDuelModal(create); return; }
    const btn = event.target.closest("[data-mode]");
    if (btn) setMode(btn.dataset.mode);
  });
  addEventListener("hashchange", () => setMode(modeFromHash(location.hash), { updateHash: false }));
  renderNav();
  setMode(mode, { updateHash: false });

  /* Mantém os selos de coins iguais aos do jogo: na nuvem, recarrega a situação do dia quando ela vira (ou ao
     voltar para a aba) e atualiza só os selos, sem redesenhar o hub inteiro. */
  const refreshBadges = () => document.querySelectorAll("h3[data-game]").forEach(h3 =>
    h3.querySelector(".coins")?.replaceWith(balanceBadge(user.id, h3.dataset.game)));
  setInterval(() => {
    const stale = Cloud.owns(user.id) && Cloud.daily(Object.keys(GAMES)[0])?.day !== spDay();
    if (stale) Cloud.dailyStatus().catch(() => {}).then(refreshBadges); else refreshBadges();
  }, 30000);
  if (Cloud.owns(user.id)) document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") Cloud.dailyStatus().catch(() => {}).then(refreshBadges);
  });

  if (Cloud.owns(user.id)) renderSkeleton();
  const ready = Cloud.owns(user.id) ? Cloud.dailyStatus().catch(() => {}) : Promise.resolve();
  hubReady = ready.then(() => {
    duelEntry = mountDuelEntry($("duelEntry"), { games: GAMES, cloud: Cloud });   // só abre com a nuvem ligada
    renderHub();
    $("hub-title").focus({ preventScroll: true });
  });
}
