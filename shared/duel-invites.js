/* Aviso global de desafiante — o criador de uma sala é chamado em QUALQUER página do site.
   Quem cria a sala pode navegar à vontade. Quando alguém entra, aparece um pop-up com duas saídas:
     • "Entrar na sala": abre o jogo e marca pronto; a partida só começa com os dois na sala;
     • "Desistir": o servidor cancela a sala (`duel_decline`) — o desafiante é avisado e NINGUÉM ganha
       nem perde pontos (o rating só muda quando a partida termina, nunca no cancelamento).
   A lógica fica em `createInviteController` (sem DOM, testada no Node); o pop-up é só a casca visual.
   A Edge + o Postgres continuam a autoridade: aqui só perguntamos (`duel_invites`) e pedimos (`duel_decline`). */
import { Cloud } from "./backend/cloud.js";
import { avatarNode } from "./avatar.js";
import { durationLabel } from "./rooms.js";

export const INVITE_POLL_MS = 6000;           // aba visível
export const INVITE_POLL_HIDDEN_MS = 30000;   // aba em segundo plano: o navegador já desacelera, e a Edge agradece
export const NOTICE_MS = 7000;

/** Evento disparado no `window` quando o criador clica em "Entrar na sala". A página do jogo que já está com
    a sala aberta chama `preventDefault()` e aceita ali mesmo; sem ouvinte, o site navega até o jogo. */
export const ACCEPT_EVENT = "wmg:duel-accept";

export const MESSAGES = {
  declined: "Você desistiu do duelo. Ninguém ganha nem perde pontos.",
  gone: "Esse convite não está mais ativo.",
  declineFailed: "Não foi possível desistir agora. Tente de novo.",
};

/** Convites que a página sabe abrir: com id e um jogo do catálogo (que tenha endereço). */
export function cleanInvites(raw, games = {}) {
  return (Array.isArray(raw) ? raw : []).filter(i => i && typeof i.id === "string" && games[i.gameId]?.path);
}

export const opponentName = invite => invite?.opponent?.nickname || "Um jogador";

/** "Ana entrou na sua sala de Xadrez". */
export function inviteTitle(invite, games = {}) {
  const game = games[invite?.gameId]?.title ?? "duelo";
  return `${opponentName(invite)} entrou na sua sala de ${game}`;
}

/** "10 min · Está pronto e esperando você." (ou o aviso de que ele pode ter saído da página). */
export function inviteDetail(invite) {
  const opp = invite?.opponent;
  const state = opp?.away
    ? "Parece que ele saiu da página. Você ainda pode entrar e esperar a volta dele."
    : opp?.ready === false ? "Já está na sala." : "Está pronto e esperando você.";
  const time = durationLabel(invite);
  return time ? `${time} · ${state}` : state;
}

/** Endereço do jogo para aceitar: `<jogo>/?duelo=<id>&aceitar=1`. A página abre a sala e marca pronto sozinha. */
export function acceptUrl(invite, games = {}, base = "") {
  const path = games[invite?.gameId]?.path;
  if (!path || typeof invite?.id !== "string") return "";
  return `${base}${path}${path.includes("?") ? "&" : "?"}duelo=${encodeURIComponent(invite.id)}&aceitar=1`;
}

/**
 * Controlador do aviso (sem DOM).
 * @param {object} opts
 * @param {object} opts.cloud           Cloud (injetável nos testes)
 * @param {object} opts.games           catálogo de jogos; sem ele, `loadGames()` só é chamado quando chega um convite
 * @param {() => Promise<object>} opts.loadGames
 * @param {string} opts.base            caminho até a raiz do site ("../../" nas páginas de jogo)
 * @param {(url: string) => void} opts.navigate
 * @param {(invite: object) => boolean} opts.handleInPage  true quando a página atual já cuida do aceite
 * @param {(view: object) => void} opts.onChange           recebe { invite, notice, busy, games } a cada mudança
 * @param {number} opts.pollMs / opts.hiddenMs             intervalos (0 desliga o polling)
 * @param {() => boolean} opts.isHidden
 */
export function createInviteController({
  cloud = Cloud, games = null, loadGames = null, base = "",
  navigate = url => { location.assign(url); }, handleInPage = () => false, onChange = () => {},
  pollMs = INVITE_POLL_MS, hiddenMs = INVITE_POLL_HIDDEN_MS,
  isHidden = () => typeof document !== "undefined" && document.hidden,
} = {}) {
  let invite = null, notice = "", busy = false, inflight = false, stopped = false, timer = null;
  let catalog = games;

  const view = () => ({ invite, notice, busy, games: catalog ?? {} });
  const emit = () => onChange(view());
  const enabled = () => !stopped && Boolean(cloud?.active && cloud?.uid);

  /** Pergunta ao servidor se há desafiante esperando (o polling e a volta à aba chamam isto). */
  async function check() {
    if (!enabled() || busy || inflight) return invite;
    inflight = true;
    try {
      const data = await cloud.duelInvites();
      const raw = Array.isArray(data?.invites) ? data.invites : [];
      if (raw.length && !catalog) catalog = (await loadGames?.()) ?? {};
      const next = cleanInvites(raw, catalog ?? {})[0] ?? null;
      if (next) notice = "";
      else if (invite) notice = MESSAGES.gone;          // o aviso sumiu sem o criador agir: o desafiante saiu ou expirou
      invite = next;
    } catch { /* rede ou erro passageiro: mantém o que está na tela e tenta no próximo ciclo */ }
    inflight = false;
    emit();
    return invite;
  }

  /** "Entrar na sala": a página que já tem a sala aceita ali; as outras navegam até o jogo. */
  function accept() {
    if (!invite || busy) return false;
    const target = invite;
    const url = acceptUrl(target, catalog ?? {}, base);
    if (!url) return false;
    invite = null; notice = "";
    if (handleInPage(target)) { emit(); return true; }
    busy = true;                                        // a página vai ser trocada: não deixa o polling reabrir o aviso
    emit();
    navigate(url);
    return true;
  }

  /** "Desistir": cancela a sala. O desafiante é avisado pela própria sala; ninguém ganha nem perde pontos. */
  async function decline() {
    if (!invite || busy) return false;
    const target = invite;
    busy = true; notice = "";
    emit();
    try {
      await cloud.duelDecline(target.id);
      invite = null;
      notice = MESSAGES.declined;
    } catch (e) {
      if (["bad_status", "duel_not_found", "not_creator"].includes(e?.code)) { invite = null; notice = MESSAGES.gone; }
      else notice = MESSAGES.declineFailed;
    }
    busy = false;
    emit();
    return true;
  }

  function dismissNotice() { if (notice) { notice = ""; emit(); } }

  function schedule() {
    clearTimeout(timer); timer = null;
    if (stopped || !pollMs) return;
    timer = setTimeout(async () => { await check(); schedule(); }, isHidden() ? hiddenMs : pollMs);
  }

  function start() { stopped = false; check().then(schedule, schedule); }
  function stop() { stopped = true; clearTimeout(timer); timer = null; }

  return {
    start, stop, check, accept, decline, dismissNotice,
    get invite() { return invite; },
    get notice() { return notice; },
    get busy() { return busy; },
  };
}

/* ===================== casca visual ===================== */

const node = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};

function ensureStyles(base) {
  if (document.getElementById("duel-invite-css")) return;
  const link = document.createElement("link");
  link.id = "duel-invite-css"; link.rel = "stylesheet"; link.href = `${base}css/duel-invite.css`;
  document.head.append(link);
}

let started = null;

/**
 * Liga o aviso global nesta página (uma vez só, mesmo que a barra seja montada de novo).
 * Só vale com a nuvem ligada e conta real; anônimo e modo local não têm duelo.
 */
export function startDuelInvites({ base = "", cloud = Cloud } = {}) {
  if (started || typeof document === "undefined" || !cloud?.active || !cloud?.uid) return started;
  ensureStyles(base);

  const host = node("div", "duel-invite-host");
  const card = node("section", "duel-invite");
  card.setAttribute("role", "alert");
  card.hidden = true;
  const head = node("div", "duel-invite-head");
  const avatar = node("span", "duel-invite-avatar");
  const text = node("div", "duel-invite-text");
  const title = node("strong", "duel-invite-title");
  const detail = node("span", "duel-invite-detail");
  text.append(title, detail);
  head.append(avatar, text);
  const actions = node("div", "duel-invite-actions");
  const btnEnter = node("button", "duel-invite-btn primary", "Entrar na sala");
  btnEnter.type = "button";
  const btnGiveUp = node("button", "duel-invite-btn", "Desistir");
  btnGiveUp.type = "button";
  actions.append(btnEnter, btnGiveUp);
  card.append(head, actions);

  const note = node("p", "duel-invite-note");
  note.setAttribute("role", "status");
  note.hidden = true;
  host.append(card, note);
  document.body.append(host);

  let shownId = null, noteTimer = null;
  const render = ({ invite, notice, busy, games }) => {
    if (invite) {
      if (shownId !== invite.id) {                       // refaz o conteúdo só quando o convite muda (o avatar é uma imagem)
        shownId = invite.id;
        avatar.replaceChildren(avatarNode(invite.opponent?.avatar));
      }
      title.textContent = inviteTitle(invite, games);
      detail.textContent = inviteDetail(invite);
      card.hidden = false;
    } else {
      shownId = null;
      card.hidden = true;
    }
    btnEnter.disabled = btnGiveUp.disabled = busy;
    note.hidden = !notice;
    note.textContent = notice;
    clearTimeout(noteTimer);
    if (notice) noteTimer = setTimeout(() => controller.dismissNotice(), NOTICE_MS);
  };

  const controller = createInviteController({
    cloud, base, onChange: render,
    loadGames: () => import("../js/games.js").then(m => m.GAMES),
    handleInPage: invite => !window.dispatchEvent(new CustomEvent(ACCEPT_EVENT, { cancelable: true, detail: { id: invite.id } })),
  });

  btnEnter.onclick = () => controller.accept();
  btnGiveUp.onclick = () => { controller.decline(); };
  const wake = () => { if (!document.hidden) controller.check(); };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("focus", wake);

  controller.start();
  started = {
    controller,
    destroy() {
      controller.stop();
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      clearTimeout(noteTimer);
      host.remove();
      started = null;
    },
  };
  return started;
}
