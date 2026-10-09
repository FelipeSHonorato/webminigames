import { Scores } from "./scores.js";
import { el, scopeTabs, renderLeaderboard } from "./ranking-list.js";

const TROPHY = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
  <path d="M7 4h10v5a5 5 0 0 1-10 0z" fill="#f2b134" stroke="#b9770e" stroke-width="1.2" stroke-linejoin="round"/>
  <path d="M7 5.5H4.2v1.8A2.8 2.8 0 0 0 7 10.1M17 5.5h2.8v1.8a2.8 2.8 0 0 1-2.8 2.8" fill="none" stroke="#b9770e" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M12 14v3.2" stroke="#b9770e" stroke-width="1.8" stroke-linecap="round"/>
  <rect x="8" y="17.2" width="8" height="3" rx="1" fill="#f2b134" stroke="#b9770e" stroke-width="1.2"/>
  <path d="M9.6 6.4v2.6" stroke="#fff" stroke-opacity=".6" stroke-width="1.4" stroke-linecap="round"/>
</svg>`;

/** Painel lateral de ranking: visível ao entrar (em telas largas) e recolhível pela aba. */
export function mountRanking({ gameId, title, loginUrl = "../../index.html?modo=conta" }) {
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
  const tabs = scopeTabs(scopes, () => refresh());
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

  async function refresh() {
    tabs.sync();
    const data = await Scores.leaderboard(gameId, { scope: tabs.scope, limit: 10 });
    renderLeaderboard({ list, note, data, scope: tabs.scope, loginUrl });
  }
  refresh();
  return { refresh };
}
