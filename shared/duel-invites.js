/* Aviso global de desafiante — o criador de uma sala é chamado em QUALQUER página do site.
   Quem cria a sala pode navegar à vontade. Quando alguém entra, aparece um pop-up com duas saídas:
     • "Entrar na sala": abre o jogo e marca pronto; a partida só começa com os dois na sala;
     • "Desistir": o servidor cancela a sala (`duel_decline`) — o desafiante é avisado e NINGUÉM ganha
       nem perde pontos (o rating só muda quando a partida termina, nunca no cancelamento).
   Também cobre as partidas com 2+ jogadores (`kind = 'party'`):
     • sala de 2: o mesmo aviso do 1×1;
     • sala de 3+: quando ela lota e todos ficam prontos, avisa quem ainda não abriu o jogo; "Entrar na
       sala" leva direto para a mesa, que só começa a contagem quando todos estão dentro;
     • desistência na espera: um card avisa quem ficou e a sala continua aberta. O "Entendi" é lembrado
       no navegador (por conta), para o mesmo recado não voltar ao trocar de página.
   A lógica fica em `createInviteController` (sem DOM, testada no Node); o pop-up é só a casca visual.
   A Edge + o Postgres continuam a autoridade: aqui só perguntamos (`duel_invites`) e pedimos
   (`duel_decline` para 1×1, `party_leave` para salas party). */
import { Cloud } from "./backend/cloud.js";
import { avatarNode } from "./avatar.js";
import { durationLabel } from "./rooms.js";

export const INVITE_POLL_MS = 4000;           // aba visível
export const INVITE_POLL_HIDDEN_MS = 30000;   // aba em segundo plano: o navegador já desacelera, e a Edge agradece
export const NOTICE_MS = 4000;

/* O servidor repete o recado de desistência por até 60 s. O "Entendi" é do jogador, não da página:
   guardamos no navegador (por conta) as chaves já dispensadas, para o card não voltar ao navegar. */
const DISMISSED_KEY = "wmg:party-notices-dismissed";
const DISMISSED_TTL_MS = 10 * 60 * 1000;      // bem mais que os 60 s do servidor; só para não crescer sem limite
const DISMISSED_LIMIT = 20;

/** `localStorage` pode faltar (Node/modo privado/quota): sem ele o recado só reaparece na próxima página. */
function browserStorage() {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

/** Recados dispensados desta conta que ainda estão na validade. */
function dismissedNotices(storage, uid, nowMs = Date.now()) {
  if (!storage || !uid) return {};
  try {
    const all = JSON.parse(storage.getItem(DISMISSED_KEY) ?? "{}");
    const mine = all && typeof all === "object" && !Array.isArray(all) ? all[uid] : null;
    if (!mine || typeof mine !== "object") return {};
    return Object.fromEntries(Object.entries(mine)
      .filter(([, at]) => Number(at) + DISMISSED_TTL_MS > nowMs));
  } catch { return {}; }                      // storage corrompido: melhor mostrar de novo do que quebrar
}

function rememberDismissed(storage, uid, key, nowMs = Date.now()) {
  if (!storage || !uid || !key) return;
  try {
    const all = JSON.parse(storage.getItem(DISMISSED_KEY) ?? "{}");
    const next = all && typeof all === "object" && !Array.isArray(all) ? all : {};
    const mine = dismissedNotices(storage, uid, nowMs);
    mine[key] = nowMs;
    next[uid] = Object.fromEntries(Object.entries(mine)
      .sort((a, b) => a[1] - b[1]).slice(-DISMISSED_LIMIT));
    storage.setItem(DISMISSED_KEY, JSON.stringify(next));
  } catch { /* sem storage: o recado pode reaparecer na próxima página, mas nada quebra */ }
}

/** Evento disparado no `window` quando o criador clica em "Entrar na sala". A página do jogo que já está com
    a sala aberta chama `preventDefault()` e aceita ali mesmo; sem ouvinte, o site navega até o jogo. */
export const ACCEPT_EVENT = "wmg:duel-accept";

export const MESSAGES = {
  declined: "Você desistiu do duelo. Ninguém ganha nem perde pontos.",
  partyLeft: "Você saiu da sala. Ela continua aberta esperando outro jogador.",
  gone: "Esse convite não está mais ativo.",
  declineFailed: "Não foi possível desistir agora. Tente de novo.",
};

/** Convites que a página sabe abrir: com id e um jogo do catálogo (que tenha endereço). */
export function cleanInvites(raw, games = {}) {
  return (Array.isArray(raw) ? raw : []).filter(i => i && typeof i.id === "string" && games[i.gameId]?.path);
}

export const opponentName = invite => invite?.opponent?.nickname || "Um jogador";

/** Salas com 3+ jogadores: o aviso não é "fulano entrou", e sim "a sala está completa". */
export const fullParty = invite => invite?.kind === "party" && Number(invite?.maxPlayers) > 2;

/** "Ana entrou na sua sala de Xadrez" ou "A sala criada do game UNO está completa". */
export function inviteTitle(invite, games = {}) {
  const game = games[invite?.gameId]?.title ?? "duelo";
  if (fullParty(invite)) return `A sala criada do game ${game} está completa`;
  return `${opponentName(invite)} entrou na sua sala de ${game}`;
}

/** "10 min · Está pronto e esperando você." (ou o aviso de que ele pode ter saído da página). */
export function inviteDetail(invite) {
  if (fullParty(invite)) return "A sala está completa e esperando você.";
  const opp = invite?.opponent;
  const state = opp?.away
    ? "Parece que ele saiu da página. Você ainda pode entrar e esperar a volta dele."
    : opp?.ready === false ? "Já está na sala." : "Está pronto e esperando você.";
  const time = durationLabel(invite);
  return time ? `${time} · ${state}` : state;
}

/** Recado de quem desistiu antes da largada. `notice.kind` é `left` ou `host_left`. */
export function partyNoticeTitle(notice, games = {}) {
  const game = games[notice?.gameId]?.title;
  const where = game ? ` do game ${game}` : "";
  if (notice?.notice?.kind === "host_left") return `O criador da sala desistiu${where}`;
  return `${notice?.notice?.nickname || "Um jogador"} desistiu${where}`;
}

export function partyNoticeDetail() {
  return "A sala continua aberta esperando outro jogador.";
}

/** Chave do recado: o mesmo evento não volta a aparecer a cada consulta do polling. */
export const noticeKey = entry => [entry?.id, entry?.notice?.kind, entry?.notice?.userId, entry?.notice?.at].join("|");

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
  storage = browserStorage(),
} = {}) {
  let invite = null, event = null, notice = "", busy = false, inflight = false, stopped = false, timer = null;
  let epoch = 0;                    // muda a cada aceitar/desistir: respostas de consultas antigas são descartadas
  let catalog = games;
  const seenEvents = new Set();     // recados já mostrados nesta página; os de outras páginas ficam no storage

  const view = () => ({ invite, noticeCard: event, notice, busy, games: catalog ?? {} });
  const emit = () => onChange(view());
  const enabled = () => !stopped && Boolean(cloud?.active && cloud?.uid);

  /** Pergunta ao servidor se há desafiante esperando (o polling e a volta à aba chamam isto). */
  async function check() {
    if (!enabled() || busy || inflight) return invite;
    inflight = true;
    const ticket = epoch;
    try {
      const data = await cloud.duelInvites();
      const raw = Array.isArray(data?.invites) ? data.invites : [];
      const rawInvites = raw.filter(i => i && !i.notice);
      const rawEvents = raw.filter(i => i && i.notice);
      if ((rawInvites.length || rawEvents.length) && !catalog) catalog = (await loadGames?.()) ?? {};
      if (ticket !== epoch) { inflight = false; return invite; }   // o criador já decidiu: resposta velha não reabre o aviso
      const next = cleanInvites(rawInvites, catalog ?? {})[0] ?? null;
      if (next) notice = "";                                       // convite novo/renovado limpa o recado anterior
      else if (invite) notice = MESSAGES.gone;                     // sumiu sem o criador agir: o desafiante saiu ou expirou
      invite = next;
      if (!event) {
        const dismissed = dismissedNotices(storage, cloud?.uid);   // "Entendi" de outra página
        const fresh = cleanInvites(rawEvents, catalog ?? {}).find(e => {
          const key = noticeKey(e);
          return !seenEvents.has(key) && !(key in dismissed);
        });
        if (fresh) { seenEvents.add(noticeKey(fresh)); event = fresh; }
      }
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
    epoch += 1;
    invite = null; notice = "";
    if (handleInPage(target)) { emit(); return true; }
    busy = true;                                        // a página vai ser trocada: não deixa o polling reabrir o aviso
    emit();
    navigate(url);
    return true;
  }

  /** "Desistir": em salas party, sai da sala (ela continua aberta); no 1×1, cancela o duelo.
      Ninguém ganha nem perde pontos — o rating só muda quando a partida termina. */
  async function decline() {
    if (!invite || busy) return false;
    const target = invite;
    const party = target.kind === "party" && typeof cloud.partyLeave === "function";
    epoch += 1;
    busy = true; notice = "";
    emit();
    try {
      if (party) await cloud.partyLeave(target.id);
      else await cloud.duelDecline(target.id);
      invite = null;
      notice = party ? MESSAGES.partyLeft : MESSAGES.declined;
    } catch (e) {
      if (["bad_status", "duel_not_found", "not_creator", "not_member"].includes(e?.code)) { invite = null; notice = MESSAGES.gone; }   // a sala já mudou: só fecha o aviso
      else notice = MESSAGES.declineFailed;
    }
    busy = false;
    emit();
    return true;
  }

  function dismissNotice() { if (notice) { notice = ""; emit(); } }
  /** "Entendi": fecha agora e lembra a escolha nas próximas páginas (o servidor ainda repete o evento por 60 s). */
  function dismissEvent() {
    if (!event) return;
    const key = noticeKey(event);
    seenEvents.add(key);
    rememberDismissed(storage, cloud?.uid, key);
    event = null;
    emit();
  }

  function schedule() {
    clearTimeout(timer); timer = null;
    if (stopped || !pollMs) return;
    timer = setTimeout(async () => { await check(); schedule(); }, isHidden() ? hiddenMs : pollMs);
  }

  function start() { stopped = false; check().then(schedule, schedule); }
  function stop() { stopped = true; clearTimeout(timer); timer = null; }

  return {
    start, stop, check, accept, decline, dismissNotice, dismissEvent,
    get invite() { return invite; },
    get noticeCard() { return event; },
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

  /* Recado de desistência (o card do convite e o recado podem aparecer juntos). */
  const eventCard = node("section", "duel-invite duel-invite-notice");
  eventCard.setAttribute("role", "status");
  eventCard.hidden = true;
  const eventHead = node("div", "duel-invite-head");
  const eventAvatar = node("span", "duel-invite-avatar");
  const eventText = node("div", "duel-invite-text");
  const eventTitle = node("strong", "duel-invite-title");
  const eventDetail = node("span", "duel-invite-detail");
  eventText.append(eventTitle, eventDetail);
  eventHead.append(eventAvatar, eventText);
  const eventActions = node("div", "duel-invite-actions");
  const btnEventOk = node("button", "duel-invite-btn", "Entendi");
  btnEventOk.type = "button";
  eventActions.append(btnEventOk);
  eventCard.append(eventHead, eventActions);

  const note = node("p", "duel-invite-note");
  note.setAttribute("role", "status");
  note.hidden = true;
  host.append(card, eventCard, note);
  document.body.append(host);

  let shownId = null, shownEvent = null, noteTimer = null, shownNotice = "";
  const render = ({ invite, noticeCard, notice, busy, games }) => {
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
    if (noticeCard) {
      const key = noticeKey(noticeCard);
      if (shownEvent !== key) {
        shownEvent = key;
        eventAvatar.replaceChildren(avatarNode(noticeCard.opponent?.avatar));
      }
      eventTitle.textContent = partyNoticeTitle(noticeCard, games);
      eventDetail.textContent = partyNoticeDetail();
      eventCard.hidden = false;
    } else {
      shownEvent = null;
      eventCard.hidden = true;
    }
    btnEnter.disabled = btnGiveUp.disabled = busy;
    note.hidden = !notice;
    note.textContent = notice;
    if (notice !== shownNotice) {                        // o relógio do recado só reinicia quando o texto muda (a cada consulta o render roda de novo)
      shownNotice = notice;
      clearTimeout(noteTimer);
      if (notice) noteTimer = setTimeout(() => controller.dismissNotice(), NOTICE_MS);
    }
  };

  const controller = createInviteController({
    cloud, base, onChange: render,
    loadGames: () => import("../js/games.js").then(m => m.GAMES),
    handleInPage: invite => !window.dispatchEvent(new CustomEvent(ACCEPT_EVENT, { cancelable: true, detail: { id: invite.id } })),
  });

  btnEnter.onclick = () => controller.accept();
  btnGiveUp.onclick = () => { controller.decline(); };
  btnEventOk.onclick = () => controller.dismissEvent();
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
