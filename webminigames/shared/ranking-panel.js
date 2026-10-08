import { Scores } from "./scores.js";
import { getSession } from "./session.js";
import { regionName } from "./regions.js";

const TROPHY = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
  <path d="M7 4h10v5a5 5 0 0 1-10 0z" fill="#f2b134" stroke="#b9770e" stroke-width="1.2" stroke-linejoin="round"/>
  <path d="M7 5.5H4.2v1.8A2.8 2.8 0 0 0 7 10.1M17 5.5h2.8v1.8a2.8 2.8 0 0 1-2.8 2.8" fill="none" stroke="#b9770e" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M12 14v3.2" stroke="#b9770e" stroke-width="1.8" stroke-linecap="round"/>
  <rect x="8" y="17.2" width="8" height="3" rx="1" fill="#f2b134" stroke="#b9770e" stroke-width="1.2"/>
  <path d="M9.6 6.4v2.6" stroke="#fff" stroke-opacity=".6" stroke-width="1.4" stroke-linecap="round"/>
</svg>`;

const el = (tag, cls = "", text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;   // textContent: nomes de usuário nunca viram HTML
  return n;
};

/** Painel lateral de ranking: visível ao entrar (em telas largas) e recolhível pela aba. */
export function mountRanking({ gameId, title, loginUrl = "../../index.html?conta=1" }) {
  let scope = "global";
  const aside = el("aside", "ranking");
  aside.setAttribute("aria-label", `Ranking do ${title}`);
  const tab = el("button", "ranking-tab");
  tab.type = "button";
  tab.title = "Ranking";
  tab.setAttribute("aria-label", "Ranking");
  tab.setAttribute("aria-controls", "ranking-body");
  tab.innerHTML = TROPHY;                       // ícone estático, sem dados do usuário

  const body = el("div", "ranking-body");
  body.id = "ranking-body";
  const scopes = el("div", "ranking-scopes");
  scopes.setAttribute("role", "tablist");
  const scopeButtons = {};
  for (const [id, label] of [["global", "Geral"], ["region", "Minha região"]]) {
    const b = el("button", "", label);
    b.type = "button"; b.setAttribute("role", "tab");
    b.onclick = () => { scope = id; refresh(); };
    scopeButtons[id] = b; scopes.append(b);
  }
  const list = el("ol", "ranking-list"), note = el("p", "ranking-note");
  body.append(el("h2", "", `Ranking · ${title}`), scopes, list, note);
  aside.append(tab, body);
  document.body.append(aside);

  /* A janela fica logo abaixo da barra superior, qualquer que seja a altura dela. */
  const bar = document.querySelector(".sitebar");
  const fit = () => document.documentElement.style.setProperty("--ranking-top", `${(bar?.offsetHeight ?? 0) + 12}px`);
  fit();
  addEventListener("resize", fit);

  const setOpen = open => {
    aside.classList.toggle("closed", !open);
    document.body.classList.toggle("ranking-open", open);
    tab.setAttribute("aria-expanded", String(open));
  };
  setOpen(matchMedia("(min-width: 900px)").matches);   // telas estreitas começam recolhidas para não cobrir o jogo
  tab.onclick = () => setOpen(aside.classList.contains("closed"));

  const row = r => {
    const li = el("li", r.isMe ? "me" : "");
    li.title = regionName(r.region);
    li.append(el("span", "pos", String(r.rank)), el("span", "nm", r.name + (r.isMe ? " (você)" : "")), el("span", "pts", `${r.points} pts`));
    return li;
  };

  async function refresh() {
    for (const [id, b] of Object.entries(scopeButtons)) b.setAttribute("aria-selected", String(id === scope));
    const { top, me } = await Scores.leaderboard(gameId, { scope, limit: 10 });
    list.replaceChildren(); note.replaceChildren();
    if (!top.length) list.append(el("li", "empty", scope === "region" ? "Ninguém da sua região pontuou ainda." : "Ninguém pontuou ainda. Seja o primeiro!"));
    top.forEach(r => list.append(row(r)));
    if (me && !top.some(r => r.isMe)) { list.append(el("li", "gap", "…"), row(me)); }
    const session = getSession();
    if (!Scores.canRank()) {
      note.append("Você joga como anônimo: as vitórias não pontuam. ");
      const a = el("a", "", "Criar conta"); a.href = loginUrl; note.append(a);
    } else if (scope === "region" && !session?.region) note.append("Sua conta não tem região definida.");
    else if (!me) note.append("Vença uma partida para entrar no ranking.");
  }
  refresh();
  return { refresh };
}
