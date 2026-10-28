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
import { LEVEL_NAMES, WINS_PER_LEVEL, Progress } from "../shared/progress.js";
import { mountDuelEntry } from "../shared/duel-hub.js";

const $ = id => document.getElementById(id);
const user = requireSession("index.html");

const winsOf = (game, uid) => Progress.wins(game.key, uid);
const PROVIDER_NOTE = { password: "", google: "", "google-demo": "Google (simulação)", anonymous: "Anônimo: o progresso fica só neste navegador" };

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
  const count = Object.keys(GAMES).length;
  $("games").setAttribute("aria-busy", "true");
  $("games").innerHTML = Array.from({ length: count }, () =>
    `<div class="game skeleton" aria-hidden="true">
      <div class="sk-preview"></div><div class="sk-line short"></div><div class="sk-line"></div><div class="sk-line"></div>
    </div>`).join("");
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
  $("hubSub").textContent = "Escolha um jogo para abrir o desafio de hoje. Cada jogo tem seu nível, seus tickets e seu ranking." + (user.provider === "anonymous" ? ` ${PROVIDER_NOTE.anonymous}.` : "");
  $("games").innerHTML = "";
  const entries = Object.entries(GAMES);
  entries.forEach(([id, g]) => {
    const wins = winsOf(g, user.id), lv = Math.min(LEVEL_NAMES.length - 1, Math.floor(wins / WINS_PER_LEVEL));
    const last = lv === LEVEL_NAMES.length - 1, into = wins - lv * WINS_PER_LEVEL;
    const on = GameSwitch.isOn(id), playable = on || isAdmin(user);   // desligado: só o administrador entra
    const btn = document.createElement(playable ? "a" : "div");     // cada jogo é uma página própria
    btn.className = "game" + (on ? "" : " off");
    if (playable) btn.href = g.path; else btn.setAttribute("aria-disabled", "true");
    btn.innerHTML = `${thumb(id, g)}<h3>${g.title}</h3><p>${g.desc}</p>
      <div class="lvl"><span>${LEVEL_NAMES[lv]}</span><div class="bar"><i style="width:${last ? 100 : (into / WINS_PER_LEVEL) * 100}%"></i></div><span>${last ? wins + " vitórias" : into + "/" + WINS_PER_LEVEL}</span></div>
      <span class="play">${playable ? "Jogar" : "Indisponível"}</span>`;
    const title = btn.querySelector("h3");
    title.dataset.game = id;
    title.append(balanceBadge(user.id, id));   // coins na frente do nome do jogo
    if (!on) {
      const tag = document.createElement("span");
      tag.className = "offtag"; tag.textContent = isAdmin(user) ? "Desligado (só administrador)" : "Desligado";
      title.append(tag);
    }
    $("games").append(btn);
    wireThumbFallback(btn);
  });
}

/* Ranking geral: soma dos pontos de todos os jogos. */
const overallTabs = scopeTabs($("overallScopes"), () => refreshOverall());
async function refreshOverall() {
  overallTabs.sync();
  $("overallList").innerHTML = '<li class="empty">Carregando ranking…</li>';
  $("overallNote").textContent = "";
  const data = await Scores.overall({ scope: overallTabs.scope, limit: 10 });
  renderLeaderboard({ list: $("overallList"), note: $("overallNote"), data, scope: overallTabs.scope, loginUrl: "index.html?modo=conta" });
}

if (user) {
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

  refreshOverall();
  if (Cloud.owns(user.id)) renderSkeleton();
  const ready = Cloud.owns(user.id) ? Cloud.dailyStatus().catch(() => {}) : Promise.resolve();
  ready.then(() => {
    mountDuelEntry($("duelEntry"), { games: GAMES, cloud: Cloud });   // só aparece com a nuvem ligada
    renderHub();
    $("hub-title").focus({ preventScroll: true });
  });
}
