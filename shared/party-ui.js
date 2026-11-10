/* Painel visual da partida com 2+ jogadores — lobby (vagas, pronto, iniciar), contagem, faixa da vez e classificação.
   Cuida só da moldura (como o `duel-ui.js` do 1×1). O jogo desenha o tabuleiro/mão quando `onStart` chega,
   usando `session.view`. Textos sempre por textContent (nome de jogador nunca vira HTML). */
import { avatarNode } from "./avatar.js";
import { fmtTime } from "./ranking-list.js";
import { duelLink, countdownText } from "./duel-ui.js";
import { lobbyHint, lobbyStatus, outcomeText, slotsLabel } from "./party.js";

/** Qual bloco do painel está ativo. */
export function partyView(session) {
  if (session.status === "finished" || session.status === "cancelled") return "result";
  if (session.status === "running") return session.started ? "running" : "countdown";
  return "lobby";
}

/** Faixa da vez: "Sua vez · 0:23", "Vez de Bob · 0:12", "Todos jogam ao mesmo tempo" ou "" fora de jogo. */
export function turnBanner(session, nowMs = Date.now()) {
  if (session.status !== "running" || !session.started) return "";
  const party = session.party;
  if (party?.order === "free") return "Todos jogam ao mesmo tempo";
  const mine = session.me();
  if (mine?.out) return "Você saiu da partida";
  const left = session.msToTurnEnd(nowMs);
  const time = left == null ? "" : ` · ${fmtTime(Math.ceil(left / 1000))}`;
  if (party?.turnSeat != null && party.turnSeat === mine?.seat) return `Sua vez${time}`;
  const who = session.turnPlayer();
  return who ? `Vez de ${who.nickname || "Jogador"}${time}` : "";
}

/** Rótulos de um jogador na lista de vagas, na ordem em que aparecem. */
export function playerTags(player, status) {
  const tags = [];
  if (player.host) tags.push("Criador");
  if (status === "waiting") {
    if (player.ready) tags.push("Pronto");
    if (player.away) tags.push("Ausente");
  } else if (player.out) {
    tags.push("Fora");
  }
  if (Number.isInteger(player.placement) && status === "finished") tags.unshift(`${player.placement}º`);
  return tags;
}

const node = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};

const button = (label, cls) => {
  const b = node("button", `party-btn ${cls ?? ""}`.trim(), label);
  b.type = "button";
  return b;
};

/**
 * Monta o painel em `host` e liga nos eventos da sessão.
 * @returns {{ render: () => void, destroy: () => void }}
 */
export function mountPartyUi(host, session, { title = "Multijogador", onStart, onFinish, onExit } = {}) {
  if (!host) return null;
  const offs = [];
  let timer = null, noteTimer = null;

  const root = node("section", "party");
  root.setAttribute("aria-label", title);
  const head = node("div", "party-head");
  const statusEl = node("span", "party-status");
  head.append(node("span", "party-tag", title), statusEl);

  /* ----- lobby ----- */
  const lobby = node("div", "party-lobby");
  const codeEl = node("p", "party-code");
  const slotsEl = node("p", "party-slots");
  const list = node("ol", "party-seats");
  const hint = node("p", "party-hint");
  const actions = node("div", "party-actions");
  const btnReady = button("Estou pronto", "party-primary");
  const btnStart = button("Iniciar partida", "party-primary");
  const btnCopy = button("Copiar código");
  const btnLink = button("Copiar link");
  const btnLeave = button("Sair da sala");
  actions.append(btnReady, btnStart, btnCopy, btnLink, btnLeave);
  lobby.append(node("p", "party-label", "Código do convite"), codeEl, slotsEl, list, hint, actions);

  /* ----- contagem e faixa da vez ----- */
  const count = node("p", "party-count");
  const banner = node("p", "party-banner");
  banner.setAttribute("role", "status");

  /* ----- em jogo: quem está na partida (o tabuleiro é do jogo) ----- */
  const roster = node("ul", "party-roster");
  const btnResign = button("Desistir");

  /* ----- resultado ----- */
  const result = node("div", "party-result");
  const resultTitle = node("strong", "party-result-title");
  const table = node("ol", "party-standings");
  const btnExit = button("Sair");
  result.append(resultTitle, table, btnExit);

  const note = node("p", "party-note");
  note.setAttribute("role", "status");
  note.hidden = true;

  root.append(head, lobby, count, banner, roster, btnResign, result, note);
  host.replaceChildren(root);

  const flash = message => {
    note.textContent = message;
    note.hidden = false;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { note.hidden = true; }, 2800);
  };

  function seatRow(player) {
    const li = node("li", "party-seat" + (player.is_me ? " me" : "") + (player.out ? " out" : ""));
    const avatar = node("span", "party-avatar");
    avatar.append(avatarNode(player.avatar));
    const name = node("span", "party-name", player.nickname || "Jogador");
    const tags = node("span", "party-tags", playerTags(player, session.status).join(" · "));
    li.append(avatar, name, tags);
    if (session.status === "waiting" && session.isHost() && !player.is_me) {
      const kick = button("Remover", "party-kick");
      kick.setAttribute("aria-label", `Remover ${player.nickname || "jogador"} da sala`);
      kick.onclick = () => session.kick(player.user_id).catch(() => flash("Não foi possível remover."));
      li.append(kick);
    }
    return li;
  }

  function freeSeat(n) {
    const li = node("li", "party-seat free");
    li.append(node("span", "party-avatar"), node("span", "party-name", `Vaga ${n} livre`));
    return li;
  }

  function render() {
    const view = partyView(session);
    lobby.hidden = view !== "lobby";
    count.hidden = view !== "countdown";
    banner.hidden = !(view === "running");
    roster.hidden = view !== "running";
    btnResign.hidden = !(view === "running" && !session.me()?.out);
    result.hidden = view !== "result";

    statusEl.textContent = { idle: "", waiting: "Aguardando jogadores", running: "Em andamento", finished: "Encerrada", cancelled: "Cancelada" }[session.status] ?? "";
    codeEl.textContent = session.code ?? "—";

    const room = session.room;
    const s = lobbyStatus(room);
    slotsEl.textContent = slotsLabel(room);
    list.replaceChildren(...session.players.map(seatRow), ...Array.from({ length: s.free }, (_, i) => freeSeat(s.count + i + 1)));
    hint.textContent = lobbyHint(room);
    /* O criador já é "pronto"; só os convidados marcam. Quem marcou pode desmarcar enquanto a sala espera. */
    btnReady.hidden = s.isHost;
    btnReady.textContent = s.me?.ready ? "Não estou pronto" : "Estou pronto";
    btnStart.hidden = !s.isHost;
    btnStart.disabled = !s.canStart;

    if (view === "running") {
      roster.replaceChildren(...session.players.map(p => {
        const li = node("li", "party-roster-item" + (p.out ? " out" : "") + (p.seat === session.turnSeat ? " turn" : ""));
        li.append(node("span", "party-name", p.nickname || "Jogador"));
        if (p.out) li.append(node("span", "party-tags", "Fora"));
        return li;
      }));
      banner.textContent = turnBanner(session);
    }
    if (view === "result") {
      resultTitle.textContent = outcomeText(session.outcome, session.me()?.placement);
      table.replaceChildren(...session.standings.map(row => {
        const li = node("li", "party-standing" + (row.me ? " me" : ""));
        li.append(node("span", "party-place", `${row.place}º`), node("span", "party-name", row.nickname));
        return li;
      }));
    }
  }

  async function copy(text, ok) {
    try { await navigator.clipboard.writeText(text); flash(ok); } catch { flash(`Copie manualmente: ${text}`); }
  }

  const errorText = e => ({
    bad_status: "A partida já começou.", expired: "A sala expirou.", not_ready: "Ainda há jogadores sem marcar pronto.",
    roster_changed: "A sala mudou. Tente iniciar de novo.", not_creator: "Só o criador inicia a partida.", duel_full: "A sala está cheia.",
  }[e?.code] ?? "Não foi possível continuar.");

  btnReady.onclick = () => session.ready(!session.me()?.ready).catch(e => flash(errorText(e)));
  btnStart.onclick = () => session.start().catch(e => flash(errorText(e)));
  btnCopy.onclick = () => copy(session.code ?? "", "Código copiado!");
  btnLink.onclick = () => copy(duelLink(location.href, session.code), "Link copiado!");
  btnLeave.onclick = () => { session.leave().catch(() => {}).finally(() => onExit?.()); };
  btnResign.onclick = () => { if (confirm("Desistir da partida?")) session.resign().catch(e => flash(errorText(e))); };
  btnExit.onclick = () => { session.leave().catch(() => {}).finally(() => onExit?.()); };

  offs.push(
    session.on("lobby", render),
    session.on("ready", render),
    session.on("state", render),
    session.on("move", render),
    session.on("resign", render),
    session.on("countdown", ({ msLeft }) => { render(); count.textContent = countdownText(msLeft); }),
    session.on("start", data => { render(); onStart?.(data); }),
    session.on("finished", detail => { render(); onFinish?.(detail); }),
    session.on("kicked", () => { flash("Você foi removido da sala."); onExit?.(); }),
  );

  /* A faixa da vez conta o tempo sozinha entre uma resposta do servidor e outra. */
  timer = setInterval(() => {
    if (session.status === "running" && session.started) banner.textContent = turnBanner(session);
    else if (session.status === "running") count.textContent = countdownText(session.msToStart());
  }, 500);

  render();

  return {
    render,
    destroy() {
      clearInterval(timer);
      clearTimeout(noteTimer);
      for (const off of offs) off();
      root.remove();
    },
  };
}
