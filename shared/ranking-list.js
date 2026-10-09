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

/** Linha do ranking: posição, foto pequena, nome e pontos. */
export function rankingRow(r) {
  const li = el("li", r.isMe ? "me" : "");
  li.title = regionName(r.region);
  li.append(el("span", "pos", String(r.rank)), avatarNode(r.avatar), el("span", "nm", r.name + (r.isMe ? " (você)" : "")), el("span", "pts", `${r.points} pts`));
  return li;
}

/** Preenche a lista e o aviso a partir de { top, me } (resultado de Scores.leaderboard / overall). */
export function renderLeaderboard({ list, note, data: { top, me }, scope, loginUrl }) {
  list.replaceChildren(); note.replaceChildren();
  if (!top.length) list.append(el("li", "empty", scope === "region" ? "Ninguém da sua região pontuou ainda." : "Ninguém pontuou ainda. Seja o primeiro!"));
  top.forEach(r => list.append(rankingRow(r)));
  if (me && !top.some(r => r.isMe)) list.append(el("li", "gap", "…"), rankingRow(me));
  if (!Scores.canRank()) {
    note.append("Você joga como anônimo: as vitórias não pontuam. ");
    const a = el("a", "", "Criar conta"); a.href = loginUrl; note.append(a);
  } else if (scope === "region" && !getSession()?.region) note.append("Sua conta não tem região definida.");
  else if (!me) note.append("Vença uma partida para entrar no ranking.");
}
