/* Painel dos cenários do dia (um por coin) — compartilhado pelos jogos. Mostra o progresso do dia e, nos
   cenários já vencidos, os "troféus": em que percentual de jogadores o tempo ficou, se ficou acima/abaixo da
   média do dia e a posição na região. Os números vêm do servidor (daily_status/daily_finish -> stats), sempre
   sobre o mesmo cenário (dia, jogo, nível e slot). Os cálculos ficam em shared/daily-stats.js (puro). */
import { Cloud } from "./backend/cloud.js";
import { COINS_PER_DAY } from "./coins.js";
import { fmtTime } from "./ranking-list.js";
import { regionName } from "./regions.js";
import { scenarioTrophies } from "./daily-stats.js";

export const dailySlots = info => info?.slots ?? Cloud.config()?.coinsPerDay ?? COINS_PER_DAY;
export const resultsOf = (info, day) => day && info?.history?.[day] ? info.history[day] : (info?.results ?? {});
export const slotsOf = (info, day) => Array.from({ length: dailySlots(info) }, (_, i) => ({ slot: i + 1, seconds: resultsOf(info, day)[i + 1] ?? null }));
export const bestDaily = (info, day) => { const v = slotsOf(info, day).map(s => s.seconds).filter(s => s != null); return v.length ? Math.min(...v) : null; };

/* Dia e meia-noite de Brasília (UTC-3, sem horário de verão): quando o desafio e os coins do dia viram. */
export const spDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
export function nextSpMidnight() {
  const [y, m, d] = spDay().split("-").map(Number);
  return Date.UTC(y, m - 1, d + 1) + 3 * 3600 * 1000;
}

const dayOrder = (a, b) => String(a.day).localeCompare(String(b.day)) || a.slot - b.slot;

/** Próximo cenário a jogar: retoma a tentativa aberta mais antiga ou abre o ticket mais antigo (FIFO). */
export function nextScenario(gameId) {
  const info = Cloud.daily(gameId);
  const open = [...(info?.open ?? [])].sort(dayOrder)[0];
  if (open) return { day: open.day, slot: open.slot };
  const pending = [...(info?.pending ?? [])].sort(dayOrder)[0];
  return pending ? { day: pending.day, slot: pending.slot } : null;
}

export const dayLabel = day => day ? new Date(`${day}T12:00:00Z`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "";
const dayText = (day, today) => day === today ? "hoje" : dayLabel(day);
const hasTicket = (info, day, slot) => (info?.pending ?? []).some(x => x.day === day && x.slot === slot);
const isOpen = (info, day, slot) => (info?.open ?? []).some(x => x.day === day && x.slot === slot);
const statsOf = (info, day, slot) => (day === info?.day ? info?.stats?.[slot] : info?.statsByDay?.[day]?.[slot]);

/* ---------- ícones (SVG inline, no tom do tema) ---------- */
const ICONS = {
  trophy: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v5a5 5 0 0 1-10 0z" fill="currentColor"/><path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M12 14v3M8 20h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  globe: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
  up: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5l6 7h-4v7h-4v-7H6z" fill="currentColor"/></svg>`,
  down: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19l-6-7h4V5h4v7h4z" fill="currentColor"/></svg>`,
  even: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 11h14v2H5z" fill="currentColor"/></svg>`,
};

const node = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const icon = (name, extra) => { const s = document.createElement("span"); s.className = extra ? `trophy-ico ${extra}` : "trophy-ico"; s.innerHTML = ICONS[name] ?? ""; return s; };

const AVERAGE_TEXT = { above: "Acima da média", below: "Abaixo da média", even: "Na média" };
const AVERAGE_SHORT = { above: "acima", below: "abaixo", even: "média" };

function mini(name, text, title) {
  const n = node("span", "mini");
  n.title = title;
  n.append(icon(name, "mini-ico"), node("span", "mini-text", text));
  return n;
}

function trophyCard(name, main, sub, detail) {
  const c = node("div", "trophy-card");
  c.append(icon(name));
  c.append(node("strong", "trophy-main", main));
  c.append(node("span", "trophy-sub", sub));
  if (detail) c.append(node("span", "trophy-detail", detail));
  return c;
}

/** Cartões grandes dos troféus (a "premiação" de um cenário) dentro de `panel`. */
function appendTrophies(panel, slot, stats) {
  const t = scenarioTrophies(stats);
  if (!t) return;

  const head = node("div", "trophies-head");
  head.append(node("strong", "trophies-title", `Cenário ${slot} · ${fmtTime(t.seconds)}`));
  const meta = [];
  if (t.points) meta.push(`+${t.points} pts`);
  if (t.hints) meta.push(plural(t.hints, "dica", "dicas"));
  if (meta.length) head.append(node("span", "trophies-meta", meta.join(" · ")));
  panel.append(head);

  const cards = node("div", "trophy-cards");
  if (t.percent != null) {
    cards.append(trophyCard("trophy", `Melhor que ${t.percent}%`, "dos jogadores",
      t.players <= 1 ? "Só você jogou este cenário hoje" : `Sua posição: ${t.rank}º de ${plural(t.players, "jogador", "jogadores")}`));
  }
  cards.append(trophyCard("clock", AVERAGE_TEXT[t.average],
    t.players <= 1 ? "Só você jogou hoje" : "em relação ao tempo de hoje",
    t.avgSeconds != null ? `Média de hoje: ${fmtTime(t.avgSeconds)}` : "Sem média do dia"));
  if (t.regionRank != null) {
    cards.append(trophyCard("globe", `Nº ${t.regionRank} na sua região`, regionName(t.region),
      plural(t.regionPlayers ?? 0, "jogador", "jogadores") + " no cenário"));
  } else {
    cards.append(trophyCard("globe", "Sem região", "Defina sua região no perfil", "para comparar com a sua região"));
  }
  panel.append(cards);
}

/** Desenha o painel do dia: escolhe o dia, mostra os cenários (vencido = preenchido + troféus) e, por cima
    do cenário selecionado, a premiação — que abre ao vencer e só sai no × ou no Esc (não some ao clicar fora). */
export function renderDailyPanel({ el: host, gameId, info, day, slot, won }) {
  if (!host) return;
  hideVeil();
  const data = info ?? { day: spDay(), coins: 0, slots: dailySlots(null), results: {}, pending: [], open: [], history: {}, stats: {}, statsByDay: {} };
  const today = data.day ?? spDay();
  const days = [...new Set([
    today,
    ...Object.keys(data.history ?? {}),
    ...(data.pending ?? []).map(x => x.day),
    ...(data.open ?? []).map(x => x.day),
  ].filter(Boolean))].sort().reverse();
  let selectedDay = day && days.includes(day) ? day : host.dataset.day && days.includes(host.dataset.day) ? host.dataset.day : today;
  if (!days.includes(selectedDay)) selectedDay = days[0] ?? today;
  host.dataset.day = selectedDay;
  host.__dailyArgs = { el: host, gameId, info: data, day: selectedDay, slot, won };

  const list = slotsOf(data, selectedDay);
  const done = list.filter(s => s.seconds != null);
  const lastDone = done.length ? done[done.length - 1].slot : null;

  let open = host.dataset.openDay === selectedDay && host.dataset.open ? Number(host.dataset.open) : null;
  if (open != null && !done.some(s => s.slot === open)) open = null;                 // virou o dia / cenário sumiu
  const wonNow = won && slot && selectedDay === day && done.some(s => s.slot === slot);
  const wonSlot = statsOf(data, selectedDay, slot);
  if (wonNow && wonSlot && host.dataset.won !== `${selectedDay}:${slot}`) open = slot; // acabou de vencer: abre
  host.dataset.won = wonNow ? `${selectedDay}:${slot}` : "";

  const stored = Number(host.dataset.selected);
  const selected = open ?? (stored && done.some(s => s.slot === stored) ? stored : lastDone);
  host.dataset.open = open ? String(open) : "";
  host.dataset.openDay = open ? selectedDay : "";
  host.dataset.selected = selected ? String(selected) : "";

  host.replaceChildren();
  if (!list.length) return;

  if (days.length > 1) {
    const picker = node("div", "daily-days");
    for (const d of days) {
      const b = node("button", "daily-day" + (d === selectedDay ? " selected" : ""), dayText(d, today));
      b.type = "button";
      b.setAttribute("aria-pressed", String(d === selectedDay));
      b.onclick = () => {
        host.dataset.day = d;
        host.dataset.open = ""; host.dataset.openDay = ""; host.dataset.selected = "";
        renderDailyPanel({ ...host.__dailyArgs, day: d });
      };
      picker.append(b);
    }
    host.append(picker);
  }

  const status = node("div", "slots");
  for (const s of list) {
    const isDone = s.seconds != null;
    const ticket = hasTicket(data, selectedDay, s.slot);
    const running = isOpen(data, selectedDay, s.slot);
    const playing = running && s.slot === slot && selectedDay === day && !won;
    const stats = statsOf(data, selectedDay, s.slot);
    const t = isDone ? scenarioTrophies(stats) : null;
    const canOpen = isDone && !!stats;
    const item = document.createElement(canOpen ? "button" : "span");
    if (canOpen) {
      item.type = "button";
      item.setAttribute("aria-pressed", String(s.slot === open));
      item.title = s.slot === open ? "Fechar os troféus" : "Ver os troféus deste cenário";
      item.onclick = () => {
        host.dataset.open = Number(host.dataset.open) === s.slot ? "" : String(s.slot);
        host.dataset.openDay = host.dataset.open ? selectedDay : "";
        host.dataset.selected = String(s.slot);
        renderDailyPanel(host.__dailyArgs);
      };
    }
    item.className = "slot" + (isDone ? " done" : playing ? " current" : " pending") + (s.slot === selected ? " selected" : "");
    item.append(node("span", "slot-name", `Cenário ${s.slot}${selectedDay === today ? "" : ` · ${dayLabel(selectedDay)}`}`));
    if (isDone) {
      item.append(node("span", "slot-time", fmtTime(s.seconds)));
      if (t) {
        const row = node("span", "slot-trophies");
        if (t.percent != null) row.append(mini("trophy", `${t.percent}%`, `Melhor que ${t.percent}% dos jogadores`));
        if (t.players > 1) row.append(mini(t.average === "above" ? "up" : t.average === "below" ? "down" : "even", AVERAGE_SHORT[t.average], `${AVERAGE_TEXT[t.average]} (média do dia: ${fmtTime(t.avgSeconds)})`));
        if (t.regionRank != null) row.append(mini("globe", `#${t.regionRank}`, `Nº ${t.regionRank} na sua região`));
        if (row.children.length) item.append(row);
      }
    } else {
      item.append(node("span", "slot-status", playing ? "jogando" : running ? "em aberto" : ticket ? "ticket" : "indisponível"));
    }
    status.append(item);
  }
  host.append(status);

  const tip = node("p", "daily-tip");
  const best = bestDaily(data, selectedDay);
  const pending = data.pending?.length ?? 0;
  const oldest = [...(data.pending ?? [])].sort(dayOrder)[0]?.day;
  const balance = pending > 0
    ? `${pending} ${pending === 1 ? "ticket pendente" : "tickets pendentes"}${oldest ? ` · mais antigo: ${dayText(oldest, today)}` : ""}`
    : "Sem tickets pendentes.";
  tip.textContent = `${balance} · melhor tempo${selectedDay === today ? " de hoje" : ` de ${dayLabel(selectedDay)}`}: ${best != null ? fmtTime(best) : "—"}.`;
  host.append(tip);

  const close = () => { host.dataset.open = ""; host.dataset.openDay = ""; renderDailyPanel(host.__dailyArgs); };
  if (open && statsOf(data, selectedDay, open)) showVeil(host, open, statsOf(data, selectedDay, open), close);
}

/** O "quadrado" do jogo: o tabuleiro que recebe o véu dos troféus. */
const boardOf = host => host.closest("main")?.querySelector("#board") ?? document.getElementById("board");

let veil = null;               // véu atual; fica no body para cobrir o tabuleiro sem mexer no DOM do jogo
let veilCleanup = null;

/** Tira o véu do tabuleiro (e solta os listeners). */
function hideVeil() {
  if (veilCleanup) { veilCleanup(); veilCleanup = null; }
  veil?.remove();
  veil = null;
}

/** Mostra os troféus no meio do tabuleiro, sobre uma cor translúcida. Permanece até o × ou o Esc. */
function showVeil(host, slot, stats, close) {
  hideVeil();
  const board = boardOf(host);
  const panel = node("div", "trophies");
  const x = node("button", "trophies-close", "×");
  x.type = "button";
  x.setAttribute("aria-label", "Fechar os troféus");
  x.onclick = close;
  panel.append(x);
  appendTrophies(panel, slot, stats);
  if (!board) {                       // sem tabuleiro (página inesperada): cai no painel normal do dia
    host.append(panel);
    return;
  }

  const inner = node("div", "wmg-veil-inner");
  inner.append(panel);
  veil = node("div", "wmg-veil");
  veil.append(inner);
  document.body.append(veil);

  const place = () => {
    const r = board.getBoundingClientRect();
    veil.style.left = `${Math.round(r.left + window.scrollX)}px`;
    veil.style.top = `${Math.round(r.top + window.scrollY)}px`;
    veil.style.width = `${Math.round(r.width)}px`;
    veil.style.height = `${Math.round(r.height)}px`;
    const radius = getComputedStyle(board).borderRadius;
    if (radius) veil.style.borderRadius = radius;
  };
  place();

  const onKey = e => { if (e.key === "Escape") close(); };
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(place) : null;
  ro?.observe(board);
  document.addEventListener("keydown", onKey);
  window.addEventListener("scroll", place, true);
  window.addEventListener("resize", place);
  veilCleanup = () => {
    ro?.disconnect();
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("scroll", place, true);
    window.removeEventListener("resize", place);
  };
}
