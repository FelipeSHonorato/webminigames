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

/** "MM:SS" ou "H:MM:SS" a partir de segundos (tempo dos cenários diários). */
export function fmtTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, "0"), ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Linha do ranking: posição, foto pequena, nome e pontos (ou rating, no duelo).
    `valueOf(r)` troca o texto do valor — o Go usa para mostrar o grau Kyu/Dan em vez do Elo. */
export function rankingRow(r, suffix = "pts", valueOf = null) {
  const li = el("li", r.isMe ? "me" : "");
  li.title = regionName(r.region);
  const custom = typeof valueOf === "function" ? valueOf(r) : null;
  const value = custom != null ? String(custom) : suffix ? `${r.points} ${suffix}` : String(r.points);
  li.append(el("span", "pos", String(r.rank)), avatarNode(r.avatar), el("span", "nm", r.name + (r.isMe ? " (você)" : "")), el("span", "pts", value));
  return li;
}

/** Preenche a lista e o aviso a partir de { top, me } (resultado de Scores.leaderboard).
    `suffix` troca "pts" por "Elo"; os textos podem ser próprios de cada jogo de duelo. */
export function renderLeaderboard({
  list, note, data: { top, me }, scope, loginUrl,
  suffix = "pts",
  valueOf = null,
  emptyText = "Ninguém pontuou ainda. Seja o primeiro!",
  emptyRegionText = "Ninguém da sua região pontuou ainda.",
  noteText = "Vença uma partida para entrar no ranking.",
}) {
  list.replaceChildren(); note.replaceChildren();
  if (!top.length) list.append(el("li", "empty", scope === "region" ? emptyRegionText : emptyText));
  top.forEach(r => list.append(rankingRow(r, suffix, valueOf)));
  if (me && !top.some(r => r.isMe)) list.append(el("li", "gap", "…"), rankingRow(me, suffix, valueOf));
  if (!Scores.canRank()) {
    note.append("Você joga como anônimo: as vitórias não contam. ");
    const a = el("a", "", "Criar conta"); a.href = loginUrl; note.append(a);
  } else if (scope === "region" && !getSession()?.region) note.append("Sua conta não tem região definida.");
  else if (!me) note.append(noteText);
}
