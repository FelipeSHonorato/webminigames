import "../shared/backend/boot.js";
import { requireSession } from "../shared/session.js";
import { isAdmin } from "../shared/roles.js";
import { GameSwitch } from "../shared/game-switch.js";
import { AdminLevel } from "../shared/admin-level.js";
import { AdminConfig } from "../shared/admin-config.js";
import { AdminCoins } from "../shared/admin-coins.js";
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
    sw.onclick = async () => {
      try {
        await GameSwitch.set(id, !on);
        $("adminMsg").textContent = on ? `${g.title} desligado. Os pontos continuam salvos e nos rankings.` : `${g.title} ligado.`;
      } catch (err) { $("adminMsg").textContent = err.message; }
      render();
    };
    const right = document.createElement("span");
    right.className = "swrow"; right.append(status, sw);
    li.append(name, right, meta, levelRow(id, g));
    list.append(li);
  }
}

/** Linha "Nível para testar": o administrador escolhe o nível do jogo sem precisar jogar até ele. */
function levelRow(id, g) {
  const row = document.createElement("div"), label = document.createElement("span"), group = document.createElement("div");
  const current = AdminLevel.get(session, g.key);
  row.className = "lvlrow"; label.className = "lvllabel"; label.textContent = "Nível para testar:";
  group.className = "lvls"; group.setAttribute("role", "group"); group.setAttribute("aria-label", `Nível do ${g.title} para o administrador`);
  AdminLevel.levels.forEach((levelName, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = levelName; b.dataset.game = id; b.dataset.level = String(i);
    b.setAttribute("aria-pressed", String(i === current));
    b.onclick = async () => {
      try {
        await AdminLevel.set(session, id, g.key, i);
        $("adminMsg").textContent = `${g.title}: nível ${levelName}. A fase salva do administrador foi descartada; ao abrir o jogo, nasce uma fase nova nesse nível.`;
      } catch (err) { $("adminMsg").textContent = err.message; }
      await render();
      document.querySelector(`.lvls button[data-game="${id}"][data-level="${i}"]`)?.focus();   // o foco volta ao botão clicado
    };
    group.append(b);
  });
  row.append(label, group);
  return row;
}

/** Configuração global do desafio diário: coins (e cenários por nível) por dia. */
function renderConfig() {
  $("coinsPerDay").value = String(AdminConfig.coinsPerDay(session));
  $("coinsMsg").textContent = "";
}
function wireConfig() {
  renderConfig();
  $("coinsSave").onclick = async () => {
    try {
      const saved = await AdminConfig.setCoinsPerDay(session, Number($("coinsPerDay").value));
      $("coinsMsg").textContent = `Salvo: ${saved} ${saved === 1 ? "coin" : "coins"} por dia e ${saved} ${saved === 1 ? "cenário" : "cenários"} por nível em cada jogo.`;
      $("coinsPerDay").value = String(saved);
    } catch (err) { $("coinsMsg").textContent = err.message; }
  };
}

/** Coins de teste: o administrador recarrega o saldo do dia de uma conta, pelo e-mail do login. */
function renderGrant() {
  const sel = $("grantGame");
  sel.replaceChildren(new Option("Todos os jogos", ""));
  for (const [id, g] of Object.entries(GAMES)) sel.append(new Option(g.title, id));
  $("grantMsg").textContent = "";
}
function wireGrant() {
  renderGrant();
  $("grantSave").onclick = async () => {
    const msg = $("grantMsg"); msg.className = "fmsg";
    try {
      const r = await AdminCoins.grant(session, $("grantEmail").value, $("grantGame").value || null, Number($("grantAmount").value));
      const n = Array.isArray(r.games) ? r.games.length : 0;
      msg.textContent = `Pronto: ${r.coins} ${r.coins === 1 ? "coin" : "coins"} do dia para ${r.name || r.email} em ${n} ${n === 1 ? "jogo" : "jogos"}.`;
    } catch (err) { msg.className = "fmsg err"; msg.textContent = err.message; }
  };
}

if (session && !isAdmin(session)) location.replace("jogos.html");        // só o administrador
else if (session) { mountUserBar($("userbar")); render(); wireConfig(); wireGrant(); $("admin-title").focus({ preventScroll: true }); }
