import { Auth } from "./auth.js";
import { store } from "../shared/storage.js";
import { requireSession } from "../shared/session.js";
import { GAMES } from "./games.js";
import { LEVEL_NAMES, WINS_PER_LEVEL, winsKey } from "../shared/progress.js";

const $ = id => document.getElementById(id);
const user = requireSession("index.html");

const winsOf = (game, uid) => Math.max(0, parseInt(store.get(winsKey(game.key, uid)), 10) || 0);
const PROVIDER_NOTE = { password: "", "google-demo": "Google (simulação)", anonymous: "Anônimo: o progresso fica só neste navegador" };

function renderHub() {
  $("userLabel").innerHTML = "";
  const b = document.createElement("b"); b.textContent = user.name;
  $("userLabel").append(b, PROVIDER_NOTE[user.provider] ? ` · ${PROVIDER_NOTE[user.provider]}` : "");
  $("hubSub").textContent = "Os dois jogos estão liberados. Cada um tem o seu próprio nível e progresso.";
  $("games").innerHTML = "";
  for (const g of Object.values(GAMES)) {
    const wins = winsOf(g, user.id), lv = Math.min(LEVEL_NAMES.length - 1, Math.floor(wins / WINS_PER_LEVEL));
    const last = lv === LEVEL_NAMES.length - 1, into = wins - lv * WINS_PER_LEVEL;
    const btn = document.createElement("a");          // cada jogo é uma página própria
    btn.className = "game"; btn.href = g.path;
    btn.innerHTML = `${g.preview}<h3>${g.title}</h3><p>${g.desc}</p>
      <div class="lvl"><span>${LEVEL_NAMES[lv]}</span><div class="bar"><i style="width:${last ? 100 : (into / WINS_PER_LEVEL) * 100}%"></i></div><span>${last ? wins + " vitórias" : into + "/" + WINS_PER_LEVEL}</span></div>
      <span class="play">Jogar</span>`;
    $("games").append(btn);
  }
}

$("logout").onclick = () => { Auth.logout(); location.assign("index.html"); };
if (user) { renderHub(); $("hub-title").focus({ preventScroll: true }); }
