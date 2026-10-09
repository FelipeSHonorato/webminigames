import { requireSession } from "../shared/session.js";
import { isAdmin } from "../shared/roles.js";
import { GameSwitch } from "../shared/game-switch.js";
import { Scores } from "../shared/scores.js";
import { GAMES } from "./games.js";
import { mountUserBar } from "./userbar.js";

const $ = id => document.getElementById(id);
const session = requireSession("index.html");

async function render() {
  const list = $("gameSwitches");
  list.replaceChildren();
  for (const [id, g] of Object.entries(GAMES)) {
    const on = GameSwitch.isOn(id);
    const { total } = await Scores.leaderboard(id, { limit: 1 });      // pontuações guardadas (não dependem da chave)
    const li = document.createElement("li"), name = document.createElement("span"), status = document.createElement("span"), meta = document.createElement("span"), sw = document.createElement("button");
    name.className = "t"; name.textContent = g.title;
    status.className = "pts"; status.textContent = on ? "Ligado" : "Desligado";
    meta.className = "meta"; meta.textContent = `${total} ${total === 1 ? "jogador com pontos guardados" : "jogadores com pontos guardados"}`;
    sw.type = "button"; sw.className = "onoff"; sw.setAttribute("role", "switch");
    sw.setAttribute("aria-checked", String(on)); sw.setAttribute("aria-label", `${g.title}: ${on ? "ligado" : "desligado"}`);
    sw.innerHTML = '<span class="knob" aria-hidden="true"></span>';
    sw.onclick = () => {
      GameSwitch.set(id, !on);
      $("adminMsg").textContent = on ? `${g.title} desligado. Os pontos continuam salvos e nos rankings.` : `${g.title} ligado.`;
      render();
    };
    const right = document.createElement("span");
    right.className = "swrow"; right.append(status, sw);
    li.append(name, right, meta);
    list.append(li);
  }
}

if (session && !isAdmin(session)) location.replace("jogos.html");        // só o administrador
else if (session) { mountUserBar($("userbar")); render(); $("admin-title").focus({ preventScroll: true }); }
