import { mountUserBar } from "./userbar.js";
import { Scores } from "../shared/scores.js";
import { Coins } from "../shared/coins.js";
import { GameSwitch } from "../shared/game-switch.js";
import { isAdmin } from "../shared/roles.js";
import { coinBadge } from "../shared/coin-badge.js";
import { scopeTabs, renderLeaderboard } from "../shared/ranking-list.js";
import { store } from "../shared/storage.js";
import { requireSession } from "../shared/session.js";
import { GAMES } from "./games.js";
import { LEVEL_NAMES, WINS_PER_LEVEL, winsKey } from "../shared/progress.js";

const $ = id => document.getElementById(id);
const user = requireSession("index.html");

const winsOf = (game, uid) => Math.max(0, parseInt(store.get(winsKey(game.key, uid)), 10) || 0);
const PROVIDER_NOTE = { password: "", "google-demo": "Google (simulação)", anonymous: "Anônimo: o progresso fica só neste navegador" };

function renderHub() {
  mountUserBar($("userbar"));
  $("hubSub").textContent = "Os dois jogos estão liberados. Cada um tem o seu próprio nível e progresso." + (user.provider === "anonymous" ? ` ${PROVIDER_NOTE.anonymous}.` : "");
  $("games").innerHTML = "";
  for (const [id, g] of Object.entries(GAMES)) {
    const wins = winsOf(g, user.id), lv = Math.min(LEVEL_NAMES.length - 1, Math.floor(wins / WINS_PER_LEVEL));
    const last = lv === LEVEL_NAMES.length - 1, into = wins - lv * WINS_PER_LEVEL;
    const on = GameSwitch.isOn(id), playable = on || isAdmin(user);   // desligado: só o administrador entra
    const btn = document.createElement(playable ? "a" : "div");     // cada jogo é uma página própria
    btn.className = "game" + (on ? "" : " off");
    if (playable) btn.href = g.path; else btn.setAttribute("aria-disabled", "true");
    btn.innerHTML = `${g.preview}<h3>${g.title}</h3><p>${g.desc}</p>
      <div class="lvl"><span>${LEVEL_NAMES[lv]}</span><div class="bar"><i style="width:${last ? 100 : (into / WINS_PER_LEVEL) * 100}%"></i></div><span>${last ? wins + " vitórias" : into + "/" + WINS_PER_LEVEL}</span></div>
      <span class="play">${playable ? "Jogar" : "Indisponível"}</span>`;
    const title = btn.querySelector("h3");
    title.dataset.game = id;
    title.append(coinBadge(Coins.get(user.id, id)));   // coins na frente do nome do jogo
    if (!on) {
      const tag = document.createElement("span");
      tag.className = "offtag"; tag.textContent = isAdmin(user) ? "Desligado (só administrador)" : "Desligado";
      title.append(tag);
    }
    $("games").append(btn);
  }
}

/* Ranking geral: soma dos pontos de todos os jogos. */
const overallTabs = scopeTabs($("overallScopes"), () => refreshOverall());
async function refreshOverall() {
  overallTabs.sync();
  const data = await Scores.overall({ scope: overallTabs.scope, limit: 10 });
  renderLeaderboard({ list: $("overallList"), note: $("overallNote"), data, scope: overallTabs.scope, loginUrl: "index.html?modo=conta" });
}

/* A recarga de 24 h pode chegar com a página aberta: atualiza só os selos de coins. */
setInterval(() => document.querySelectorAll("h3[data-game]").forEach(h3 =>
  h3.querySelector(".coins")?.replaceWith(coinBadge(Coins.get(user.id, h3.dataset.game)))), 30000);

if (user) { refreshOverall(); renderHub(); $("hub-title").focus({ preventScroll: true }); }
