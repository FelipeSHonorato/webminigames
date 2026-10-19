import { Scores } from "./scores.js";
import { getSession } from "./session.js";
import { regionName } from "./regions.js";
import { avatarNode } from "./avatar.js";

export const el = (tag, cls = "", text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;   // textContent: nomes de usuário nunca viram HTML
  return n;
};

/** Abas "Geral" / "Minha região". `onChange(scope)` é chamado a cada troca. */
export function scopeTabs(host, onChange) {
  let scope = "global";
  const buttons = {};
  host.setAttribute("role", "tablist");
  for (const [id, label] of [["global", "Geral"], ["region", "Minha região"]]) {
    const b = el("button", "", label);
    b.type = "button"; b.setAttribute("role", "tab");
    b.onclick = () => { scope = id; onChange(scope); };
    buttons[id] = b; host.append(b);
  }
  const sync = () => { for (const [id, b] of Object.entries(buttons)) b.setAttribute("aria-selected", String(id === scope)); };
  sync();
  return { get scope() { return scope; }, sync };
}

/** "MM:SS" ou "H:MM:SS" a partir de segundos (ranking por tempo do desafio diário). */
export function fmtTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, "0"), ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Linha do ranking: posição, foto pequena, nome e a métrica (pontos ou, no desafio diário, o tempo). */
export function rankingRow(r) {
  const li = el("li", r.isMe ? "me" : "");
  li.title = regionName(r.region);
  const metric = r.seconds != null ? fmtTime(r.seconds) : `${r.points} pts`;
  li.append(el("span", "pos", String(r.rank)), avatarNode(r.avatar), el("span", "nm", r.name + (r.isMe ? " (você)" : "")), el("span", "pts", metric));
  return li;
}

/** Preenche a lista e o aviso a partir de { top, me } (resultado de Scores.leaderboard / dailyLeaderboard).
    `kind = "daily"` troca os textos para o desafio diário (ranking por tempo). */
export function renderLeaderboard({ list, note, data: { top, me }, scope, loginUrl, kind = "points" }) {
  const daily = kind === "daily";
  list.replaceChildren(); note.replaceChildren();
  if (!top.length) list.append(el("li", "empty", scope === "region"
    ? (daily ? "Ninguém da sua região completou ainda." : "Ninguém da sua região pontuou ainda.")
    : (daily ? "Ninguém completou o desafio de hoje ainda. Seja o primeiro!" : "Ninguém pontuou ainda. Seja o primeiro!")));
  top.forEach(r => list.append(rankingRow(r)));
  if (me && !top.some(r => r.isMe)) list.append(el("li", "gap", "…"), rankingRow(me));
  if (!Scores.canRank()) {
    note.append("Você joga como anônimo: as vitórias não contam. ");
    const a = el("a", "", "Criar conta"); a.href = loginUrl; note.append(a);
  } else if (scope === "region" && !getSession()?.region) note.append("Sua conta não tem região definida.");
  else if (!me) note.append(daily ? "Jogue o desafio de hoje para entrar no ranking." : "Vença uma partida para entrar no ranking.");
}
