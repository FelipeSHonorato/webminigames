import { Scores } from "./scores.js";
import { Cloud } from "./backend/cloud.js";
import { el, scopeTabs, renderLeaderboard } from "./ranking-list.js";

const TROPHY = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
  <path d="M7 4h10v5a5 5 0 0 1-10 0z" fill="#f2b134" stroke="#b9770e" stroke-width="1.2" stroke-linejoin="round"/>
  <path d="M7 5.5H4.2v1.8A2.8 2.8 0 0 0 7 10.1M17 5.5h2.8v1.8a2.8 2.8 0 0 1-2.8 2.8" fill="none" stroke="#b9770e" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M12 14v3.2" stroke="#b9770e" stroke-width="1.8" stroke-linecap="round"/>
  <rect x="8" y="17.2" width="8" height="3" rx="1" fill="#f2b134" stroke="#b9770e" stroke-width="1.2"/>
  <path d="M9.6 6.4v2.6" stroke="#fff" stroke-opacity=".6" stroke-width="1.4" stroke-linecap="round"/>
</svg>`;

const dayLabel = day => new Date(`${day}T12:00:00Z`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const dailyDays = gameId => {
  const info = Cloud.daily(gameId);
  return [...new Set([
    info?.day,
    ...Object.keys(info?.history ?? {}),
    ...(info?.pending ?? []).map(x => x.day),
    ...(info?.open ?? []).map(x => x.day),
  ].filter(Boolean))].sort().reverse();
};
const dailyLevel = (gameId, day) => {
  const info = Cloud.daily(gameId);
  if (!day) return null;
  if (info?.levels?.[day] != null) return info.levels[day];
  const ticket = [...(info?.pending ?? []), ...(info?.open ?? [])].find(x => x.day === day);
  return ticket?.level ?? (day === info?.day ? info?.level ?? null : null);
};

/** Painel lateral de ranking: visível ao entrar (em telas largas) e recolhível pela aba.
    `modes` lista os rankings disponíveis ("daily" = tempo do desafio do dia; "points" = pontuação). Com mais de um,
    aparece um alternador "Tempo do dia / Pontos". O primeiro da lista é o que abre. */
export function mountRanking({ gameId, title, loginUrl = "../../index.html?modo=conta", modes = ["points"] }) {
  const aside = el("aside", "ranking");
  aside.setAttribute("aria-label", `Ranking do ${title}`);

  const body = el("div", "ranking-body");
  body.id = "ranking-body";
  let kind = modes[0];
  const kinds = el("div", "ranking-kinds");
  const kindButtons = {};
  if (modes.length > 1) {
    kinds.setAttribute("role", "tablist");
    kinds.setAttribute("aria-label", "Tipo de ranking");
    for (const [id, label] of [["daily", "Tempo do dia"], ["points", "Pontos"]]) {
      if (!modes.includes(id)) continue;
      const b = el("button", "", label);
      b.type = "button"; b.setAttribute("role", "tab");
      b.onclick = () => { kind = id; refresh(); };
      kindButtons[id] = b; kinds.append(b);
    }
  }
  const scopes = el("div", "ranking-scopes");
  const tabs = scopeTabs(scopes, () => refresh());
  const daySelect = el("select", "ranking-days");
  daySelect.setAttribute("aria-label", "Dia do ranking do desafio");
  daySelect.onchange = () => { dailyDay = daySelect.value; refresh(); };
  const heading = el("h2", "", `Ranking · ${title}`);
  const list = el("ol", "ranking-list"), note = el("p", "ranking-note");
  let dailyDay = "";
  body.append(heading);
  if (modes.length > 1) body.append(kinds);      // só jogos com desafio diário têm o alternador
  body.append(daySelect, scopes, list, note);
  aside.append(body);
  const syncHeading = () => {
    const today = Cloud.daily(gameId)?.day;
    const suffix = kind === "daily" && dailyDay && dailyDay !== today ? ` · ${dayLabel(dailyDay)}` : "";
    heading.textContent = kind === "daily" ? `Desafio do dia${suffix} · ${title}` : `Ranking · ${title}`;
  };
  const syncKinds = () => { for (const [id, b] of Object.entries(kindButtons)) b.setAttribute("aria-selected", String(id === kind)); };
  const syncDays = () => {
    const days = dailyDays(gameId);
    if (!dailyDay || !days.includes(dailyDay)) dailyDay = days[0] ?? "";
    daySelect.replaceChildren(...days.map(day => {
      const o = el("option", "", day === Cloud.daily(gameId)?.day ? `Hoje · ${dayLabel(day)}` : dayLabel(day));
      o.value = day;
      return o;
    }));
    daySelect.value = dailyDay;
    daySelect.hidden = kind !== "daily" || days.length <= 1;
  };

  const tab = el("button", "ranking-tab");
  tab.type = "button";
  tab.title = "Ranking";
  tab.setAttribute("aria-label", "Ranking");
  tab.setAttribute("aria-controls", "ranking-body");
  tab.innerHTML = TROPHY;                       // ícone estático, sem dados do usuário

  /* Em telas largas a aba é irmã do painel (fora dele) e encosta na borda esquerda: continua clicável com o painel
     recolhido. No celular a aba vai para dentro da barra superior (fica sempre à mão, sem cobrir o jogo). */
  const bar = document.querySelector(".sitebar");
  const host = document.getElementById("userbar");
  const narrow = matchMedia("(max-width: 899px)");
  const place = () => {
    const inBar = narrow.matches && bar && host;
    if (inBar) bar.insertBefore(tab, host); else document.body.append(tab);
    tab.classList.toggle("in-bar", Boolean(inBar));
  };
  document.body.append(aside);
  place();
  narrow.addEventListener?.("change", place);

  /* A janela fica logo abaixo da barra superior, qualquer que seja a altura dela. */
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
    tabs.sync(); syncDays(); syncHeading(); syncKinds();
    const data = kind === "daily"
      ? await Scores.dailyLeaderboard(gameId, { scope: tabs.scope, limit: 10, day: dailyDay || null, level: dailyLevel(gameId, dailyDay) })
      : await Scores.leaderboard(gameId, { scope: tabs.scope, limit: 10 });
    renderLeaderboard({ list, note, data, scope: tabs.scope, loginUrl, kind });
  }
  refresh();
  return { refresh, setMode(m) { kind = m; refresh(); } };
}
