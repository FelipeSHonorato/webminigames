/* Painel do cenário atual — compartilhado pelos jogos. Mostra só os "troféus" já conquistados (percentual
   de jogadores, média do cenário e posição na região), sem repetir tempo, número do cenário ou data.
   A fila é FIFO entre os dias.
   Os números vêm do servidor (daily_status/daily_finish -> stats), sempre sobre o mesmo cenário
   (dia, jogo, nível e slot). Os cálculos ficam em shared/daily-stats.js (puro). */
import { Cloud } from "./backend/cloud.js";
import { COINS_PER_DAY } from "./coins.js";
import { fmtTime } from "./ranking-list.js";
import { regionName } from "./regions.js";
import { scenarioTrophies } from "./daily-stats.js";

export const dailySlots = info => info?.slots ?? Cloud.config()?.coinsPerDay ?? COINS_PER_DAY;
export const resultsOf = (info, day) => day && info?.history?.[day] ? info.history[day] : (info?.results ?? {});
/* Dia e meia-noite de Brasília (UTC-3, sem horário de verão): quando o desafio e os coins do dia viram. */
export const spDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
export function nextSpMidnight() {
  const [y, m, d] = spDay().split("-").map(Number);
  return Date.UTC(y, m - 1, d + 1) + 3 * 3600 * 1000;
}

const dayOrder = (a, b) => String(a.day).localeCompare(String(b.day)) || a.slot - b.slot;

/** Próximo da fila: tenta retomar uma fase aberta e, se não houver, pega o ticket mais antigo. A fila inteira
    é ordenada por dia e slot, para um cenário atrasado nunca ser ultrapassado por um mais novo. */
export function nextTicket(open, pending) {
  return [...(open ?? []), ...(pending ?? [])].sort(dayOrder)[0] ?? null;
}
export function nextScenario(gameId) {
  const info = Cloud.daily(gameId);
  const t = nextTicket(info?.open, info?.pending);
  return t ? { day: t.day, slot: t.slot } : null;
}

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
      t.players <= 1 ? "Só você jogou este cenário" : `Sua posição: ${t.rank}º de ${plural(t.players, "jogador", "jogadores")}`));
  }
  cards.append(trophyCard("clock", AVERAGE_TEXT[t.average],
    t.players <= 1 ? "Só você jogou este cenário" : "em relação ao tempo do cenário",
    t.avgSeconds != null ? `Média do cenário: ${fmtTime(t.avgSeconds)}` : "Sem média do cenário"));
  if (t.regionRank != null) {
    cards.append(trophyCard("globe", `Nº ${t.regionRank} na sua região`, regionName(t.region),
      plural(t.regionPlayers ?? 0, "jogador", "jogadores") + " no cenário"));
  } else {
    cards.append(trophyCard("globe", "Sem região", "Defina sua região no perfil", "para comparar com a sua região"));
  }
  panel.append(cards);
}

/** Desenha o cenário atual (sem abas de dias ou de slots): mostra os troféus já conquistados e o botão
    para seguir para o próximo da fila. Ao vencer, a premiação abre sobre o tabuleiro. */
export function renderDailyPanel({ el: host, gameId, info, day, slot, won, onNext }) {
  if (!host) return;
  hideVeil();
  const data = info ?? { day: spDay(), coins: 0, slots: dailySlots(null), maxCoins: 0, results: {}, pending: [], open: [], history: {}, stats: {}, statsByDay: {} };
  const today = data.day ?? spDay();
  const currentDay = day ?? today;
  host.__dailyArgs = { el: host, gameId, info: data, day: currentDay, slot, won, onNext };
  host.replaceChildren();

  if (slot == null) {
    host.append(node("p", "daily-tip", "Nenhum cenário disponível agora. Novos cenários à meia-noite (Brasília)."));
    return;
  }

  const seconds = resultsOf(data, currentDay)[slot] ?? null;
  const stats = statsOf(data, currentDay, slot);
  const winKey = won && seconds != null ? `${currentDay}:${slot}` : "";
  const justWon = Boolean(winKey) && host.dataset.won !== winKey;
  host.dataset.won = winKey;

  const t = seconds != null ? scenarioTrophies(stats) : null;
  if (t) {
    const row = node("span", "daily-trophies");
    if (t.percent != null) row.append(mini("trophy", `${t.percent}%`, `Melhor que ${t.percent}% dos jogadores`));
    if (t.players > 1) row.append(mini(t.average === "above" ? "up" : t.average === "below" ? "down" : "even", AVERAGE_SHORT[t.average], `${AVERAGE_TEXT[t.average]}${t.avgSeconds != null ? ` (média: ${fmtTime(t.avgSeconds)})` : ""}`));
    if (t.regionRank != null) row.append(mini("globe", `#${t.regionRank}`, `Nº ${t.regionRank} na sua região`));
    if (row.children.length) {
      const card = node("div", "daily-current done");
      card.append(row);
      host.append(card);
    }
  }

  const next = nextTicket(data.open, data.pending);
  const pending = data.pending?.length ?? 0;
  if (pending) host.append(node("p", "daily-tip", plural(pending, "cenário pendente", "cenários pendentes")));

  if (seconds != null && next) {
    const b = node("button", "daily-next", "Próximo cenário");
    b.type = "button";
    b.onclick = () => onNext?.();
    host.append(b);
  } else if (seconds != null) {
    host.append(node("p", "daily-all", "Você concluiu todos os cenários disponíveis. Novos à meia-noite (Brasília)."));
  }

  if (justWon && stats) {
    const close = () => renderDailyPanel(host.__dailyArgs);
    showVeil(host, slot, stats, close);
  }
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

  /* O ranking abre/fecha com uma transição que desloca o tabuleiro sem mudar o tamanho dele, então o
     ResizeObserver não basta. Seguimos a posição durante a transição e também quando o body muda de classe. */
  const main = board.closest("main");
  let frame = 0, followUntil = 0;
  const follow = () => {
    frame = 0;
    place();
    if (performance.now() < followUntil) frame = requestAnimationFrame(follow);
  };
  const followBoard = () => {
    followUntil = performance.now() + 400;
    if (!frame) frame = requestAnimationFrame(follow);
  };

  const onKey = e => { if (e.key === "Escape") close(); };
  const onTransition = e => { if (e.target === main) followBoard(); };
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(place) : null;
  const mo = typeof MutationObserver === "function" ? new MutationObserver(followBoard) : null;
  ro?.observe(board);
  mo?.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  document.addEventListener("keydown", onKey);
  document.addEventListener("transitionrun", onTransition, true);
  document.addEventListener("transitionend", onTransition, true);
  document.addEventListener("transitioncancel", onTransition, true);
  window.addEventListener("scroll", place, true);
  window.addEventListener("resize", followBoard);
  veilCleanup = () => {
    cancelAnimationFrame(frame);
    ro?.disconnect();
    mo?.disconnect();
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("transitionrun", onTransition, true);
    document.removeEventListener("transitionend", onTransition, true);
    document.removeEventListener("transitioncancel", onTransition, true);
    window.removeEventListener("scroll", place, true);
    window.removeEventListener("resize", followBoard);
  };
}
