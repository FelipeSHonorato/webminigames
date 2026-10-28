/* Painel visual do duelo 1×1 — compartilhado pelos jogos feitos PARA o modo duelo.
   Cuida só da moldura: lobby com código/link, contagem, barra do oponente e resultado.
   O jogo monta o tabuleiro quando `onStart` chega (o servidor só entrega o puzzle depois da largada). */
import { avatarNode } from "./avatar.js";
import { fmtTime } from "./ranking-list.js";

/** Link de convite a partir do endereço atual: preserva o caminho e troca a query por `?duelo=CÓDIGO`. */
export function duelLink(href, code) {
  try {
    const url = new URL(href);
    url.hash = "";
    url.search = "";
    url.searchParams.set("duelo", code);
    return url.toString();
  } catch {
    return href;
  }
}

/** Texto da contagem: "Começa em 3…" e "Já!" no zero. */
export const countdownText = ms => (ms > 0 ? `Começa em ${Math.ceil(ms / 1000)}…` : "Já!");

/** Texto do resultado do ponto de vista de quem está vendo. */
export const outcomeText = (outcome, opponentName = "Oponente") => ({
  win: "Você venceu!",
  lose: `${opponentName} venceu.`,
  draw: "Empate.",
  cancelled: "Duelo cancelado.",
  running: "Em andamento…",
  idle: "",
}[outcome] ?? "");

/** Qual bloco do painel está ativo. */
export function duelView(session) {
  if (session.status === "finished" || session.status === "cancelled") return "result";
  if (session.status === "running") return session.puzzle ? "running" : "countdown";
  return "lobby";
}

const node = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};

const nameOf = player => player?.nickname || "Jogador";

/** Placar curto do jogador (tempo e, na regra `words`, palavras). */
function scoreOf(player, rule) {
  if (!player) return "";
  const parts = [];
  if (rule === "words" && player.words != null) parts.push(`${player.words} ${player.words === 1 ? "palavra" : "palavras"}`);
  if (player.seconds != null) parts.push(fmtTime(player.seconds));
  return parts.join(" · ");
}

/**
 * Monta o painel em `host` e liga nos eventos da sessão.
 * @returns {{ render: () => void, progress: (value: number) => void, destroy: () => void }}
 */
export function mountDuelUi(host, session, { title = "Duelo 1×1", onStart, onFinish, onExit } = {}) {
  if (!host) return null;
  const offs = [];

  const root = node("section", "duel");
  root.setAttribute("aria-label", title);
  const head = node("div", "duel-head");
  head.append(node("span", "duel-tag", title));
  const statusEl = node("span", "duel-status");
  head.append(statusEl);
  root.append(head);

  /* ----- lobby: código, convite e "estou pronto" ----- */
  const lobby = node("div", "duel-lobby");
  const codeLabel = node("p", "duel-label", "Código do convite");
  const codeEl = node("p", "duel-code");
  const actions = node("div", "duel-actions");
  const btnReady = node("button", "duel-btn duel-primary", "Estou pronto");
  btnReady.type = "button";
  const btnCopy = node("button", "duel-btn", "Copiar código");
  btnCopy.type = "button";
  const btnLink = node("button", "duel-btn", "Copiar link");
  btnLink.type = "button";
  actions.append(btnReady, btnCopy, btnLink);
  const lobbyHint = node("p", "duel-hint", "Mande o código (ou o link) para o seu amigo. O duelo começa quando os dois marcarem pronto.");
  lobby.append(codeLabel, codeEl, actions, lobbyHint);

  /* ----- contagem ----- */
  const count = node("p", "duel-count");
  count.hidden = true;

  /* ----- durante o duelo: barra do oponente (e a sua) ----- */
  const rival = node("div", "duel-rival");
  const rivalAvatar = node("span", "duel-avatar");
  const rivalInfo = node("div", "duel-rival-info");
  const rivalName = node("span", "duel-rival-name");
  const rivalBar = node("div", "duel-bar");
  const rivalFill = node("i", "duel-bar-fill");
  rivalBar.append(rivalFill);
  rivalInfo.append(rivalName, rivalBar);
  const rivalPct = node("span", "duel-pct", "0%");
  rival.append(rivalAvatar, rivalInfo, rivalPct);
  rival.hidden = true;

  const mine = node("div", "duel-mine");
  const mineName = node("span", "duel-rival-name", "Você");
  const mineBar = node("div", "duel-bar duel-bar-mine");
  const mineFill = node("i", "duel-bar-fill");
  mineBar.append(mineFill);
  mine.append(mineName, mineBar);
  mine.hidden = true;

  /* ----- resultado ----- */
  const result = node("div", "duel-result");
  const resultTitle = node("strong", "duel-result-title");
  const resultDetail = node("span", "duel-result-detail");
  const resultActions = node("div", "duel-actions");
  const btnExit = node("button", "duel-btn", "Sair");
  btnExit.type = "button";
  resultActions.append(btnExit);
  result.append(resultTitle, resultDetail, resultActions);
  result.hidden = true;

  const note = node("p", "duel-note");
  note.setAttribute("role", "status");
  note.hidden = true;

  root.append(lobby, count, rival, mine, result, note);
  host.replaceChildren(root);

  let noteTimer = null;
  function flash(message) {
    note.textContent = message;
    note.hidden = false;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { note.hidden = true; }, 2600);
  }

  function show(block) {
    lobby.hidden = block !== "lobby";
    count.hidden = block !== "countdown";
    rival.hidden = mine.hidden = block !== "running";
    result.hidden = block !== "result";
  }

  function paintBar(fill, pct, value) {
    const v = Math.max(0, Math.min(1, Number(value) || 0));
    fill.style.width = `${Math.round(v * 100)}%`;
    if (pct) pct.textContent = `${Math.round(v * 100)}%`;
  }

  function render() {
    const view = duelView(session);
    show(view);
    codeEl.textContent = session.code ?? "—";
    statusEl.textContent = {
      idle: "", waiting: "Aguardando o amigo", running: "Em andamento", finished: "Encerrado", cancelled: "Cancelado",
    }[session.status] ?? "";
    btnReady.disabled = Boolean(session.me()?.ready) || session.status !== "waiting";

    const opp = session.opponent();
    rivalAvatar.replaceChildren(avatarNode(opp?.avatar));
    rivalName.textContent = opp ? nameOf(opp) : "Aguardando o amigo…";
    paintBar(rivalFill, rivalPct, session.opponentProgress);
    paintBar(mineFill, null, session.myProgress);

    if (view === "result") {
      resultTitle.textContent = outcomeText(session.outcome, opp ? nameOf(opp) : undefined);
      const me = session.me();
      const details = [];
      if (me) details.push(`Você: ${scoreOf(me, session.rule) || "—"}`);
      if (opp) details.push(`${nameOf(opp)}: ${scoreOf(opp, session.rule) || "—"}`);
      resultDetail.textContent = details.join("  ·  ");
    }
  }

  function renderCountdown({ msLeft }) {
    show("countdown");
    count.textContent = countdownText(msLeft);
  }

  async function copy(text, okMessage) {
    try {
      await navigator.clipboard.writeText(text);
      flash(okMessage);
    } catch {
      flash(`Copie manualmente: ${text}`);
    }
  }

  btnReady.onclick = () => { session.ready().catch(e => flash(e?.code === "bad_status" ? "O duelo já começou." : "Não foi possível marcar pronto.")); };
  btnCopy.onclick = () => copy(session.code ?? "", "Código copiado!");
  btnLink.onclick = () => copy(duelLink(location.href, session.code), "Link copiado!");
  btnExit.onclick = () => { session.leave().catch(() => {}).finally(() => onExit?.()); };

  offs.push(
    session.on("lobby", render),
    session.on("ready", render),
    session.on("state", render),
    session.on("opponent", () => { paintBar(rivalFill, rivalPct, session.opponentProgress); }),
    session.on("progress", () => paintBar(mineFill, null, session.myProgress)),
    session.on("countdown", renderCountdown),
    session.on("start", data => { render(); onStart?.(data); }),
    session.on("finished", detail => { render(); onFinish?.(detail); }),
    session.on("error", e => flash(e?.code === "expired" ? "O tempo do duelo acabou." : "Não foi possível continuar o duelo.")),
  );

  render();

  return {
    render,
    /** Atualiza a sua barra e transmite o progresso para o oponente (0..1). */
    progress(value) { session.progress(value); paintBar(mineFill, null, session.myProgress); },
    destroy() {
      clearTimeout(noteTimer);
      for (const off of offs) off();
      root.remove();
    },
  };
}
