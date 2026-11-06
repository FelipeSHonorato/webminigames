/* Gamão 1×1 — tabuleiro, dados e relógios no navegador. Toda a regra vem de ./domain.js (código puro, testado).
   Dois modos usam o MESMO tabuleiro:
   • local (hot-seat): os dois jogadores no mesmo dispositivo, relógio no navegador;
   • online: sala por código, relógios e lances decididos pela Edge + Postgres (shared/gamao-session.js). */
import "../../shared/backend/boot.js";
import { getSession } from "../../shared/session.js";
import { mountUserBar } from "../../js/userbar.js";
import { Music } from "../../shared/music.js";
import { Cloud } from "../../shared/backend/cloud.js";
import { createGamaoSession } from "../../shared/gamao-session.js";
import { duelLink } from "../../shared/duel-ui.js";
import { isDuelCode, normalizeCode } from "../../shared/duel-hub.js";
import { ACCEPT_EVENT } from "../../shared/duel-invites.js";
import { avatarNode } from "../../shared/avatar.js";
import { Profile } from "../../shared/profile.js";
import {
  CHECKERS, RESULT_LABELS, autoRoll, colorOf, findMove, legalMoves, newGame, opposite,
  playMove, positionKey, revive, rollOpening,
} from "./domain.js";

const GAME_ID = "gamao";
const LOW_MS = 20000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TIME_CONTROLS = [
  { id: "classic", name: "Clássico", sub: "Standard", minutes: 60 },
  { id: "rapid", name: "Rápido", sub: "Rapid", minutes: 30 },
  { id: "blitz", name: "Blitz", sub: "", minutes: 10 },
  { id: "bullet", name: "Bullet", sub: "", minutes: 3 },
];

const ONLINE_MESSAGES = {
  duel_not_found: "Código não encontrado. Confira com quem te convidou.",
  duel_full: "Essa sala já está cheia.",
  bad_status: "Esse duelo já começou ou terminou.",
  expired: "Esse convite expirou. Peça um novo.",
  too_many_open: "Você já tem uma sala aberta. Abra-a em Salas Online (aparece como “Sua sala”) ou saia dela antes de criar outra.",
  not_authenticated: "Entre na sua conta para jogar online.",
  bad_minutes: "Ritmo de jogo inválido.",
  bad_color: "Cor inválida.",
  not_member: "Você não está nessa sala.",
  not_gamao_duel: "Essa sala não é de gamão.",
  invalid_move: "Lance inválido.",
  not_your_turn: "Não é a sua vez.",
  stale: "O tabuleiro mudou. Atualizando…",
  not_started: "A partida ainda não começou.",
  opponent_away: "O desafiante saiu da página. Espere ele voltar ou saia da sala.",
  not_creator: "Só quem criou a sala pode fazer isso.",
};
/* Erro conhecido: mensagem própria. Desconhecido: a genérica + o motivo técnico (curto) e o erro completo no console,
   para dar para descobrir o que o servidor respondeu em vez de um aviso mudo. */
const onlineMessage = e => {
  const known = ONLINE_MESSAGES[e?.code];
  if (known) return known;
  console.warn("[WebMiniGames] erro online:", { code: e?.code, status: e?.status, error: e });
  const reason = String(e?.code ?? e?.message ?? "").trim().slice(0, 80);
  return "Não foi possível continuar agora. Tente de novo." + (reason ? ` (${e?.status ? `${e.status}: ` : ""}${reason})` : "");
};

const $ = id => document.getElementById(id);
const els = {
  setup: $("setup"), game: $("game"), lobby: $("lobby"), board: $("board"), status: $("status"),
  timeOptions: $("timeOptions"), colorOptions: $("colorOptions"), roomOptions: $("roomOptions"), startLocal: $("startLocal"),
  createRoom: $("createRoom"), duelNotice: $("duelNotice"),
  lobbyCode: $("lobbyCode"), lobbyPlayers: $("lobbyPlayers"), lobbyStatus: $("lobbyStatus"),
  copyCode: $("copyCode"), copyLink: $("copyLink"), ready: $("ready"), leaveLobby: $("leaveLobby"),
  playerTop: $("playerTop"), playerBottom: $("playerBottom"),
  topName: $("topName"), bottomName: $("bottomName"),
  topAvatar: $("topAvatar"), bottomAvatar: $("bottomAvatar"),
  topRatingVal: $("topRatingVal"), bottomRatingVal: $("bottomRatingVal"),
  topColorTag: $("topColorTag"), bottomColorTag: $("bottomColorTag"),
  topClock: $("topClock"), bottomClock: $("bottomClock"),
  topPieces: $("topPieces"), bottomPieces: $("bottomPieces"),
  trayLeft: $("trayLeft"), trayRight: $("trayRight"), leftOffVal: $("leftOffVal"), rightOffVal: $("rightOffVal"),
  dice: $("dice"), diceLeft: $("diceLeft"), diceStage: $("diceStage"),
  moves: $("moves"), moveCount: $("moveCount"), resign: $("resign"), newGame: $("newGame"),
  result: $("result"), resultIcon: $("resultIcon"), resultTitle: $("resultTitle"),
  resultReason: $("resultReason"), rematch: $("rematch"), backSetup: $("backSetup"),
};

const session = getSession();
mountUserBar($("userbar"), { base: "../../" });
Music.play(GAME_ID);

/* ===================== estado da partida ===================== */

let mode = "local";                              // "local" (hot-seat) | "online"
let lobbyError = "";                              // erro do "Estou pronto": fica na tela até a próxima tentativa (o polling não apaga)
let online = null;                               // sessão de gamão online (shared/gamao-session.js)
let sending = false;                             // lance online em trânsito: bloqueia o tabuleiro
let settings = { minutes: 10, color: "w", open: true };  // ritmo, cor e visibilidade da sala online
let game = newGame();
let clocks = { w: 0, b: 0 };
let activeClock = null;
let lastClockAt = 0;
let clockTimer = 0;
let ended = true;
let selected = null;                             // número do ponto ou "bar"
let legalForSelected = [];
let pickedDie = null;                            // dado escolhido antes do destino
let choice = null;                               // { to, toOff } quando o mesmo destino aceita mais de um dado
let onlineVersion = null;                        // versão da posição online já pintada (para limpar seleção velha)
let lastResult = null;
let flashTimer = null;
let rollSig;                                     // assinatura da última rolagem exibida (undefined = ainda não inicializada)
let rollTimers = [];                             // timers do efeito de dados no tabuleiro

const label = color => (color === "w" ? "Claras" : "Escuras");
const canOnline = () => Boolean(session && Cloud.active && Cloud.uid);
const colorCount = (state, color, point) => {
  const n = state.points[point] ?? 0;
  return color === "w" ? Math.max(0, n) : Math.max(0, -n);
};
const ownCount = (state, point) => colorCount(state, state.turn, point);

/* ===================== escolha do ritmo e da cor ===================== */

function renderTimeOptions() {
  els.timeOptions.replaceChildren(...TIME_CONTROLS.map(control => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "time-option";
    button.dataset.minutes = String(control.minutes);
    button.setAttribute("aria-pressed", String(control.minutes === settings.minutes));
    const name = document.createElement("b");
    name.textContent = control.name;
    const sub = document.createElement("span");
    sub.textContent = `${control.sub ? control.sub + " · " : ""}${control.minutes} min por jogador`;
    button.append(name, sub);
    button.addEventListener("click", () => { settings.minutes = control.minutes; renderTimeOptions(); });
    return button;
  }));
}

function renderColorOptions() {
  for (const button of els.colorOptions.querySelectorAll(".color-option")) {
    button.setAttribute("aria-pressed", String(button.dataset.color === settings.color));
  }
}

els.colorOptions.addEventListener("click", event => {
  const button = event.target.closest(".color-option");
  if (!button) return;
  settings.color = button.dataset.color === "b" ? "b" : "w";
  renderColorOptions();
});

function renderRoomOptions() {
  for (const button of els.roomOptions.querySelectorAll(".visibility-option")) {
    button.setAttribute("aria-pressed", String((button.dataset.open === "true") === settings.open));
  }
}

els.roomOptions.addEventListener("click", event => {
  const button = event.target.closest(".visibility-option");
  if (!button) return;
  settings.open = button.dataset.open === "true";
  renderRoomOptions();
});

/* ===================== endereço: ?duelo=novo | ?duelo=<código> | ?duelo=<id> ===================== */

const params = new URLSearchParams(location.search);
const invite = params.get("duelo");
const inviteKind = !invite ? null : invite === "novo" ? "new" : UUID_RE.test(invite) ? "id" : "code";
const acceptRequested = params.get("aceitar") === "1";   // vem do aviso global: o criador clicou em "Entrar na sala"

function clearInvite() {
  try { history.replaceState(null, "", location.pathname); } catch { /* sem History API */ }
}

/** Mantém a sala no endereço (recarregar volta para ela) e tira o `aceitar`, para o aceite não se repetir. */
function keepRoomInUrl(id) {
  try { history.replaceState(null, "", `${location.pathname}?duelo=${encodeURIComponent(id)}`); } catch { /* sem History API */ }
}

function noticeSetup(message = "") {
  els.duelNotice.hidden = !message;
  els.duelNotice.textContent = message;
}

function showSetup(message = "") {
  els.setup.hidden = false;
  els.lobby.hidden = true;
  els.game.hidden = true;
  els.result.hidden = true;
  noticeSetup(message);
}

/* ===================== sessão online ===================== */

function startOnline() {
  if (online) return online;
  online = createGamaoSession();
  wireSession(online);
  return online;
}

function wireSession(s) {
  s.on("lobby", handleOnline);
  s.on("ready", handleOnline);
  s.on("state", handleOnline);
  s.on("move", handleOnline);
  s.on("finished", handleOnline);
  s.on("left", () => { teardownOnline(); showSetup(); clearInvite(); });
  s.on("error", e => flash(onlineMessage(e)));
}

function handleOnline() {
  if (!online) return;
  if (online.status === "waiting") {
    showLobby();
    renderLobby();
    return;
  }
  if (online.status === "cancelled") {
    const message = cancelMessage();
    teardownOnline();
    showSetup(message);
    clearInvite();
    return;
  }
  if (!online.gamao) { online.refresh().catch(() => {}); return; }
  enterOnlineGame();
}

/** Por que a sala acabou, do ponto de vista de quem está vendo. Desistir não mexe em pontos nem em rating. */
function cancelMessage() {
  if (!online) return "A sala foi cancelada.";
  if (online.cancelReason === "declined") {
    if (online.isCreator()) return "Você desistiu do duelo. Ninguém ganha nem perde pontos.";
    const host = online.players.find(p => p.user_id === online.createdBy)?.nickname || "O criador da sala";
    return `${host} desistiu do duelo. Ninguém ganha nem perde pontos.`;
  }
  if (online.cancelReason === "expired") return "O convite expirou. Crie uma nova sala.";
  return "A sala foi cancelada.";
}

async function createOnlineRoom(minutes = settings.minutes, color = settings.color, open = settings.open) {
  if (!session) { noticeSetup("Entre na sua conta para jogar online."); return; }
  if (!canOnline()) { noticeSetup("O duelo online não está disponível nesta sessão."); return; }
  els.createRoom.disabled = true;
  try {
    startOnline();
    await online.create(minutes, color, open);
    handleOnline();
  } catch (e) {
    teardownOnline();
    noticeSetup(onlineMessage(e));
  } finally {
    els.createRoom.disabled = !canOnline();
  }
}

async function joinOnlineRoom(code) {
  const clean = normalizeCode(code);
  if (!session) { noticeSetup("Entre na sua conta para entrar na sala."); return; }
  if (!canOnline()) { noticeSetup("O duelo online não está disponível nesta sessão."); return; }
  if (!isDuelCode(clean)) { noticeSetup(ONLINE_MESSAGES.duel_not_found); return; }
  try {
    startOnline();
    await online.join(clean);
    handleOnline();
  } catch (e) {
    teardownOnline();
    noticeSetup(onlineMessage(e));
  }
}

async function attachOnlineRoom(id, { accept = false } = {}) {
  if (!session) { noticeSetup("Entre na sua conta para abrir a sala."); return; }
  if (!canOnline()) { noticeSetup("O duelo online não está disponível nesta sessão."); return; }
  try {
    startOnline();
    await online.attach(id);
    handleOnline();
    if (accept) await acceptOnlineInvite();
  } catch (e) {
    teardownOnline();
    noticeSetup(onlineMessage(e));
  }
}

/** O criador aceita o desafiante: marca pronto. Como o desafiante já entrou pronto, os dois estão na sala e o servidor
    fixa a largada (contagem de 4 s); o relógio só começa a correr depois dela. */
async function acceptOnlineInvite() {
  if (!online || online.status !== "waiting" || !online.isCreator()) return;
  keepRoomInUrl(online.id);
  if (!online.opponent()) { flash("O desafiante saiu da sala. Aguardando outro jogador…", els.lobbyStatus); return; }
  if (online.me()?.ready) return;
  els.ready.disabled = true;
  lobbyError = "";
  try { await online.ready(); } catch (e) { lobbyError = onlineMessage(e); renderLobby(); }
}

/* "Entrar na sala" do aviso global: quando esta página já está com a sala aberta, aceita aqui mesmo (sem recarregar). */
window.addEventListener(ACCEPT_EVENT, event => {
  if (!online || online.id !== event.detail?.id) return;
  event.preventDefault();
  acceptOnlineInvite();
});

/** Sem `?duelo=` (ou com `?duelo=novo`): se já existe uma sala minha neste jogo — esperando, com ou sem desafiante, ou
    em andamento — abre ELA em vez de oferecer "Criar sala". Criar outra enquanto a atual vive é o que fazia o criador
    "perder" a sala assim que alguém entrava (ela some da lista de Salas Online). */
async function resumeActiveRoom() {
  if (!canOnline()) return;
  els.createRoom.disabled = true;                       // não deixa criar uma 2ª sala enquanto procuramos a atual
  try {
    const { duel } = await Cloud.duelMine(GAME_ID);
    if (duel?.id && els.game.hidden) { await attachOnlineRoom(duel.id); return; }
  } catch { /* sem a consulta, segue para a tela de criar: o servidor ainda barra sala duplicada (too_many_open) */ }
  finally { els.createRoom.disabled = !canOnline(); }
}

function teardownOnline() {
  clearInterval(clockTimer);
  clockTimer = 0;
  online?.destroy();
  online = null;
  onlineVersion = null;
  mode = "local";
  sending = false;
  ended = true;
  rollSig = undefined;
  clearRollEffect();
  clearSelection();
  els.result.hidden = true;
  els.lobby.hidden = true;
  els.game.hidden = true;
  els.resign.disabled = false;
  els.resign.textContent = "Desistir";
  els.newGame.textContent = "Nova partida";
  els.rematch.textContent = "Revanche";
  els.backSetup.textContent = "Trocar ritmo";
}

async function leaveGame() {
  const s = online;
  if (s && (s.status === "waiting" || s.status === "running")) await s.leave().catch(() => {});
  teardownOnline();
  showSetup();
  clearInvite();
}

async function rematchOnline() {
  const { minutes, color, open } = settings;
  els.result.hidden = true;
  teardownOnline();
  await createOnlineRoom(minutes, color, open);
}

/* ===================== lobby ===================== */

function showLobby() {
  clearInterval(clockTimer);
  clockTimer = 0;
  ended = true;
  els.setup.hidden = true;
  els.game.hidden = true;
  els.lobby.hidden = false;
  els.result.hidden = true;
}

function renderLobby() {
  if (!online) return;
  els.lobbyCode.textContent = online.code ?? "—";

  const rows = online.players.map(player => {
    const color = online.colors.white === player.user_id ? "w"
      : online.colors.black === player.user_id ? "b" : null;
    const li = document.createElement("li");
    li.className = "lobby-player";
    const name = document.createElement("span");
    name.className = "lobby-name";
    name.textContent = (player.nickname || "Jogador") + (player.is_me ? " (você)" : "");
    const tag = document.createElement("span");
    tag.className = "lobby-tag" + (color ? " " + color : "");
    tag.textContent = color ? label(color) : "—";
    const ready = document.createElement("span");
    ready.className = "lobby-ready" + (player.ready ? " on" : "");
    ready.textContent = player.ready ? "Pronto" : "Aguardando";
    li.append(name, tag, ready);
    return li;
  });
  if (!rows.length) {
    const li = document.createElement("li");
    li.className = "lobby-player empty";
    li.textContent = "Conectando à sala…";
    rows.push(li);
  }
  els.lobbyPlayers.replaceChildren(...rows);

  const me = online.me();
  const opp = online.opponent();
  const name = opp?.nickname || "O amigo";
  /* O criador só marca pronto depois que o desafiante marcou: é o "Estou pronto" dele que chama o criador. */
  els.ready.disabled = Boolean(me?.ready) || (online.isCreator() && !opp?.ready);
  els.leaveLobby.textContent = online.isCreator() && opp ? "Desistir" : "Sair da sala";   // com desafiante na sala, sair = desistir
  els.lobbyStatus.textContent = !opp
    ? (online.open === false
      ? "Aguardando o amigo entrar com o código…"
      : "Aguardando alguém entrar pela lista de salas (ou pelo código)…")
    : opp.ready && me?.ready
      ? "Os dois prontos! Preparando o tabuleiro…"
      : online.isCreator()
        ? (opp.ready ? `${name} entrou e está pronto. Marque pronto para começar.` : `${name} entrou. Aguardando ele marcar pronto…`)
        : me?.ready
          ? `Aguardando ${name} aceitar o desafio…`
          : `Você entrou na sala de ${name}. Marque pronto para começar.`;
  if (me?.ready) lobbyError = "";
  if (lobbyError) els.lobbyStatus.textContent = lobbyError;   // a falha não some no próximo ciclo do polling
}

async function copyText(text, okMessage) {
  try {
    await navigator.clipboard.writeText(text);
    els.lobbyStatus.textContent = okMessage;
  } catch {
    els.lobbyStatus.textContent = `Copie manualmente: ${text}`;
  }
}

els.copyCode.addEventListener("click", () => copyText(online?.code ?? "", "Código copiado!"));
els.copyLink.addEventListener("click", () => copyText(duelLink(location.href, online?.code ?? ""), "Link copiado!"));
els.ready.addEventListener("click", async () => {
  if (!online) return;
  els.ready.disabled = true;
  lobbyError = "";
  try { await online.ready(); } catch (e) { lobbyError = onlineMessage(e); renderLobby(); }
});
els.leaveLobby.addEventListener("click", leaveGame);

/* ===================== tabuleiro online ===================== */

async function enterOnlineGame() {
  mode = "online";
  await applyOnlineState();
  if (els.game.hidden) {
    els.setup.hidden = true;
    els.lobby.hidden = true;
    els.game.hidden = false;
    els.result.hidden = true;
    els.resign.disabled = false;
    els.newGame.textContent = "Sair";
    startOnlineTicker();
  }
  renderAll();
  if (game.result.over) finishOnline();
  else els.result.hidden = true;
}

async function applyOnlineState() {
  const c = online?.gamao;
  if (!c) return;
  if (sending) return;                   // lance nosso em trânsito: ele mesmo aplica o estado do servidor no fim

  let state;
  try { state = revive(c.state); } catch (e) { console.warn("[WebMiniGames] estado de gamão inválido:", e); return; }

  /* A posição mudou (lance do adversário ou confirmação do nosso) e a seleção antiga pode não valer mais. */
  const version = c.version ?? positionKey(state);
  if (onlineVersion !== null && onlineVersion !== version) clearSelection();
  onlineVersion = version;

  game = {
    state,
    keys: Array.isArray(c.keys) ? c.keys : [],
    moves: Array.isArray(c.moves) ? c.moves : [],
    last: c.last ?? null,
    result: c.result
      ? { over: true, winner: c.result === "white" ? "w" : "b", reason: c.reason }
      : { over: false, winner: null, reason: null },
  };
  if (online.myColor) settings.color = online.myColor;
  clocks = online.clocks();
  ended = game.result.over || online.status !== "running";
}

function startOnlineTicker() {
  clearInterval(clockTimer);
  clockTimer = setInterval(onlineTick, 100);
}

function onlineTick() {
  if (mode !== "online" || !online || els.game.hidden) return;
  clocks = online.clocks();
  renderClocks();
  if (!ended) { renderOnlineStatus(); syncRollEffect(); }
}

function renderOnlineStatus() {
  if (!online || ended) return;
  const ms = online.msToStart();
  if (ms > 0) {
    els.status.textContent = `Começa em ${Math.ceil(ms / 1000)}…`;
    els.resign.disabled = true;
    return;
  }
  els.resign.disabled = false;
  els.resign.textContent = "Desistir";
  if (sending) { els.status.textContent = "Enviando lance…"; return; }

  const mine = online.myColor;
  const opp = online.opponent()?.nickname || "o adversário";
  if (choice) { els.status.textContent = "Escolha o dado para completar o lance."; return; }
  if (selected !== null) { els.status.textContent = "Escolha o destino (ou o dado)."; return; }
  if (mine && game.state.turn === mine) {
    els.status.textContent = game.state.turn === "w" ? "Sua vez — jogue as claras." : "Sua vez — jogue as escuras.";
  } else {
    els.status.textContent = `Vez de ${opp}.`;
  }
}

async function commitOnlineMove(move) {
  if (!online || sending) return false;
  sending = true;
  clearSelection();
  renderAll();

  let failure = null;
  try {
    await online.move({ from: move.from, to: move.to, die: move.die });
  } catch (e) {
    failure = e;
  } finally {
    sending = false;
    if (failure) {
      if (["stale", "not_your_turn", "bad_status"].includes(failure?.code)) await online.refresh().catch(() => {});
      flash(onlineMessage(failure));
    }
    /* A posição do servidor manda: confirma o lance ou desfaz se ele foi recusado. */
    if (online && !els.game.hidden) { await applyOnlineState(); renderAll(); }
  }
  if (game.result.over) finishOnline();
  return !failure;
}

/* ===================== relógio ===================== */

function fmtClock(ms) {
  const total = Math.max(0, ms);
  if (total < LOW_MS) {
    const tenths = Math.floor(total / 100) / 10;
    const minutes = Math.floor(tenths / 60);
    const seconds = tenths - minutes * 60;
    return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
  }
  const seconds = Math.ceil(total / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function startClock(color) {
  activeClock = color;
  lastClockAt = performance.now();
  clearInterval(clockTimer);
  clockTimer = setInterval(clockTick, 100);
  renderClocks();
}

function clockTick() {
  if (ended || !activeClock) return;
  const now = performance.now();
  clocks[activeClock] = Math.max(0, clocks[activeClock] - (now - lastClockAt));
  lastClockAt = now;
  renderClocks();
  if (clocks[activeClock] === 0) flag(activeClock);
}

function flag(color) {
  finish({ over: true, winner: opposite(color), reason: "timeout" });
}

function renderClocks() {
  const bottom = settings.color, top = opposite(bottom);
  const active = ended ? null : game.state.turn;
  els.bottomClock.textContent = fmtClock(clocks[bottom]);
  els.topClock.textContent = fmtClock(clocks[top]);
  els.bottomClock.setAttribute("aria-label", `Relógio das ${label(bottom).toLowerCase()}`);
  els.topClock.setAttribute("aria-label", `Relógio das ${label(top).toLowerCase()}`);
  els.playerBottom.classList.toggle("active", active === bottom);
  els.playerTop.classList.toggle("active", active === top);
  els.playerBottom.classList.toggle("low", clocks[bottom] <= LOW_MS);
  els.playerTop.classList.toggle("low", clocks[top] <= LOW_MS);
}

/* ===================== tabuleiro ===================== */

/* Ordem visual dos pontos. No modo normal (claras embaixo) o canto inferior direito é a casa 1.
   Para as escuras o tabuleiro gira 180°: a casa 24 fica embaixo, à esquerda. */
function visualPoints(bottomColor) {
  return bottomColor === "w"
    ? { top: Array.from({ length: 12 }, (_, i) => 13 + i), bottom: Array.from({ length: 12 }, (_, i) => 12 - i) }
    : { top: Array.from({ length: 12 }, (_, i) => 1 + i), bottom: Array.from({ length: 12 }, (_, i) => 24 - i) };
}

function checkerNode(color) {
  const span = document.createElement("span");
  span.className = "checker " + color;
  span.setAttribute("aria-hidden", "true");
  return span;
}

function stackNode(count, color, limit = 5) {
  const stack = document.createElement("span");
  stack.className = "stack";
  for (let i = 0; i < Math.min(count, limit); i++) stack.append(checkerNode(color));
  if (count > limit) {
    const badge = document.createElement("span");
    badge.className = "count";
    badge.textContent = `×${count}`;
    stack.append(badge);
  }
  return stack;
}

function pointTargets() {
  const out = new Map();
  for (const move of legalForSelected) {
    if (choice && (move.toOff !== choice.toOff || move.to !== choice.to)) continue;
    if (pickedDie != null && move.die !== pickedDie) continue;
    out.set(move.to, Boolean(out.get(move.to)) || Boolean(move.hit));
  }
  return out;
}

function renderBoard() {
  const state = game.state;
  const bottomColor = settings.color;
  const topColor = opposite(bottomColor);
  const layout = visualPoints(bottomColor);
  const targets = pointTargets();
  const interactive = !ended && (mode === "local" || (online?.isMyTurn() && !sending));

  els.board.replaceChildren();

  const addPoint = (point, row, index) => {
    const count = state.points[point] ?? 0;
    const color = colorOf(count);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `point ${row === 1 ? "top" : "bottom"}${point % 2 === 0 ? " alt" : ""}`;
    button.dataset.point = String(point);
    button.style.gridRow = String(row);
    button.style.gridColumn = String(index < 6 ? index + 1 : index + 2);
    button.setAttribute("role", "gridcell");

    let aria = `${Math.abs(count)} peça${Math.abs(count) === 1 ? "" : "s"} no ponto ${point}`;
    if (color) aria = `${Math.abs(count)} peça${Math.abs(count) === 1 ? "" : "s"} ${color === "w" ? "claras" : "escuras"} no ponto ${point}`;
    if (targets.has(point)) aria += " — destino legal";
    button.setAttribute("aria-label", aria);

    if (targets.has(point)) {
      button.classList.add(targets.get(point) ? "hit-target" : "target");
      const dot = document.createElement("span");
      dot.className = "dot";
      button.append(dot);
    }
    if (color) button.append(stackNode(Math.abs(count), color));
    const coord = document.createElement("span");
    coord.className = "coord";
    coord.textContent = String(point);
    button.append(coord);

    button.disabled = !interactive;
    button.addEventListener("click", () => onPoint(point));
    els.board.append(button);
  };

  layout.top.forEach((point, i) => addPoint(point, 1, i));
  layout.bottom.forEach((point, i) => addPoint(point, 2, i));

  /* Barra: as peças batidas entram de volta por ela. A cor de baixo ocupa o lado de baixo. */
  const bar = document.createElement("button");
  bar.type = "button";
  bar.className = "bar";
  bar.setAttribute("aria-label", `Barra: ${state.bar.w} claras e ${state.bar.b} escuras`);
  bar.disabled = !interactive;
  bar.addEventListener("click", onBar);

  const barStack = color => {
    const wrap = document.createElement("span");
    wrap.className = "bar-stack";
    const count = state.bar[color];
    for (let i = 0; i < Math.min(count, 4); i++) wrap.append(checkerNode(color));
    if (count > 4) {
      const badge = document.createElement("span");
      badge.className = "bar-count";
      badge.textContent = `×${count}`;
      wrap.append(badge);
    }
    return wrap;
  };
  const topBar = barStack(topColor);
  const bottomBar = barStack(bottomColor);
  const title = document.createElement("span");
  title.className = "bar-label";
  title.textContent = "BARRA";
  bar.append(topBar, title, bottomBar);
  els.board.append(bar);

  renderTrays();
}

function renderTrays() {
  const state = game.state;
  const bottom = settings.color, top = opposite(bottom);
  els.leftOffVal.textContent = String(state.off[top]);
  els.rightOffVal.textContent = String(state.off[bottom]);
  els.trayLeft.setAttribute("aria-label", `Peças ${label(top).toLowerCase()} fora do tabuleiro: ${state.off[top]} de ${CHECKERS}`);
  els.trayRight.setAttribute("aria-label", `Peças ${label(bottom).toLowerCase()} fora do tabuleiro: ${state.off[bottom]} de ${CHECKERS}`);

  const canLeave = !ended && (mode === "local" || (online?.isMyTurn() && !sending));
  const offMoves = canLeave && selected !== null ? legalForSelected.some(move => move.toOff) : false;
  const side = state.turn === bottom ? els.trayRight : els.trayLeft;
  els.trayLeft.classList.toggle("target", offMoves && side === els.trayLeft);
  els.trayRight.classList.toggle("target", offMoves && side === els.trayRight);
  els.trayLeft.classList.toggle("disabled", !offMoves);
  els.trayRight.classList.toggle("disabled", !offMoves);
}

function renderPlayers() {
  const bottom = settings.color, top = opposite(bottom);
  const state = game.state;

  let bottomUser = { name: label(bottom), avatar: null, rating: 1500 };
  let topUser = { name: label(top), avatar: null, rating: 1500 };

  if (mode === "online" && online) {
    const me = online.me();
    const opp = online.opponent();
    const colorOfUser = player => {
      if (!player) return null;
      if (online.colors?.white === player.user_id) return "w";
      if (online.colors?.black === player.user_id) return "b";
      return null;
    };
    const myColor = online.myColor || bottom;
    const bottomPlayer = colorOfUser(me) === myColor ? me : (colorOfUser(opp) === myColor ? opp : null);
    const topPlayer = bottomPlayer === me ? opp : me;
    if (bottomPlayer) {
      bottomUser.name = bottomPlayer.nickname || (bottomPlayer.is_me ? "Você" : "Jogador");
      bottomUser.avatar = bottomPlayer.avatar || null;
      bottomUser.rating = bottomPlayer.rating || 1500;
    }
    if (topPlayer) {
      topUser.name = topPlayer.nickname || (topPlayer.is_me ? "Você" : "Aguardando…");
      topUser.avatar = topPlayer.avatar || null;
      topUser.rating = topPlayer.rating || 1500;
    }
  } else {
    if (session) {
      const prof = Profile.get(session.id);
      bottomUser.name = Profile.displayName(session);
      bottomUser.avatar = prof?.avatar || null;
      bottomUser.rating = prof?.gamao_rating || 1500;
    }
    topUser.name = "Adversário";
    topUser.avatar = null;
    topUser.rating = 1500;
  }

  els.bottomName.textContent = bottomUser.name;
  els.topName.textContent = topUser.name;
  if (els.bottomColorTag) els.bottomColorTag.textContent = label(bottom);
  if (els.topColorTag) els.topColorTag.textContent = label(top);
  if (els.bottomRatingVal) els.bottomRatingVal.textContent = String(bottomUser.rating);
  if (els.topRatingVal) els.topRatingVal.textContent = String(topUser.rating);
  if (els.bottomAvatar) els.bottomAvatar.replaceChildren(avatarNode(bottomUser.avatar));
  if (els.topAvatar) els.topAvatar.replaceChildren(avatarNode(topUser.avatar));

  els.bottomPieces.textContent = `Barra ${state.bar[bottom]} · Fora ${state.off[bottom]}/${CHECKERS}`;
  els.topPieces.textContent = `Barra ${state.bar[top]} · Fora ${state.off[top]}/${CHECKERS}`;
}

/* ===================== dados ===================== */

const PIPS = {
  1: ["2/2"],
  2: ["1/1", "3/3"],
  3: ["1/1", "2/2", "3/3"],
  4: ["1/1", "3/1", "1/3", "3/3"],
  5: ["1/1", "3/1", "2/2", "1/3", "3/3"],
  6: ["1/1", "3/1", "1/2", "3/2", "1/3", "3/3"],
};

function setPips(node, value) {
  node.replaceChildren();
  for (const area of PIPS[value] ?? []) {
    const pip = document.createElement("i");
    pip.style.gridArea = area;
    node.append(pip);
  }
}

/** A abertura usa um dado de cada cor: o maior é de quem começa e o menor do adversário. */
const isOpeningTurn = state => state.turnNo === 1 && !state.awaitingRoll;

/** Dado da cor de quem joga: peças escuras jogam dado escuro, peças claras jogam dado claro. */
function dieNode(value, { button = false, color = game.state.turn } = {}) {
  const node = document.createElement(button ? "button" : "span");
  if (button) node.type = "button";
  node.className = "die" + (color === "b" ? " die-dark" : "");
  node.setAttribute("aria-label", `Dado ${value}`);
  setPips(node, value);
  return node;
}

function renderDice() {
  const state = game.state;
  els.dice.replaceChildren();
  const values = [...new Set(state.dice)].sort((a, b) => a - b);
  const opening = isOpeningTurn(state);
  const openingHigh = opening ? Math.max(...state.dice) : null;
  const interactive = !ended && (mode === "local" || (online?.isMyTurn() && !sending)) && selected !== null;

  if (!state.dice.length) {
    const empty = document.createElement("span");
    empty.className = "die empty";
    empty.textContent = state.awaitingRoll ? "Role" : "—";
    els.dice.append(empty);
    els.diceLeft.textContent = state.awaitingRoll ? "aguardando" : "0 dados";
    return;
  }

  for (const value of values) {
    const left = state.dice.filter(die => die === value).length;
    const wrap = document.createElement("span");
    wrap.className = "die-wrap";
    const color = opening ? (value === openingHigh ? state.turn : opposite(state.turn)) : state.turn;
    const node = dieNode(value, { button: interactive, color });
    const available = legalForSelected.some(move => move.die === value);
    if (interactive) {
      node.classList.add("pick");
      if (!available) node.classList.add("unavailable");
      node.addEventListener("click", () => onDie(value));
    }
    if (pickedDie === value) node.classList.add("chosen");
    if (choice) {
      const candidate = legalForSelected.some(move =>
        move.die === value && move.toOff === choice.toOff && move.to === choice.to);
      if (candidate) node.classList.add("chosen");
    }
    wrap.append(node);
    if (left > 1) {
      const mult = document.createElement("span");
      mult.className = "die-mult";
      mult.textContent = `×${left}`;
      wrap.append(mult);
    }
    els.dice.append(wrap);
  }
  els.diceLeft.textContent = `${state.dice.length} ${state.dice.length === 1 ? "dado" : "dados"}`;
}

/* ===================== efeito de jogada dos dados ===================== */

const rollSignature = state =>
  (state.roll.length === 2 && !state.awaitingRoll) ? `${state.turnNo}|${state.turn}|${state.roll.join(",")}` : null;

function clearRollEffect() {
  rollTimers.forEach(timer => { clearTimeout(timer); clearInterval(timer); });
  rollTimers = [];
  els.diceStage.hidden = true;
  els.diceStage.classList.remove("fading");
  els.diceStage.replaceChildren();
}

/** Dois dados da cor de quem rolou são lançados na metade direita do tabuleiro, rolam trocando de face e assentam. */
function playRollEffect(state) {
  clearRollEffect();
  const [d1, d2] = state.roll;
  if (!d1 || !d2) return;
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  /* Na abertura, o primeiro dado é o de quem começa (o maior) e o segundo é o do adversário. */
  const colors = isOpeningTurn(state) ? [state.turn, opposite(state.turn)] : [state.turn, state.turn];

  const dice = [d1, d2].map((value, i) => {
    const holder = document.createElement("span");
    holder.className = "stage-die" + (i ? " second" : "");
    const node = dieNode(still ? value : 1 + Math.floor(Math.random() * 6), { color: colors[i] });
    holder.append(node);
    return { holder, node, value };
  });
  els.diceStage.replaceChildren(...dice.map(d => d.holder));
  els.diceStage.hidden = false;

  els.dice.classList.add("fresh");
  rollTimers.push(setTimeout(() => els.dice.classList.remove("fresh"), 700));

  if (!still) {
    const shuffle = setInterval(() => dice.forEach(d => setPips(d.node, 1 + Math.floor(Math.random() * 6))), 70);
    rollTimers.push(shuffle);
    rollTimers.push(setTimeout(() => {
      clearInterval(shuffle);
      dice.forEach(d => setPips(d.node, d.value));
    }, 800));
  }
  rollTimers.push(setTimeout(() => els.diceStage.classList.add("fading"), 2300));
  rollTimers.push(setTimeout(clearRollEffect, 2850));
}

/** Chamado a cada pintura: se saiu uma rolagem nova, dispara o efeito. Entrar numa partida online já em andamento não repete. */
function syncRollEffect() {
  if (els.game.hidden) return;
  if (mode === "online" && online && online.msToStart() > 0) return;   // espera a contagem de largada acabar
  const sig = rollSignature(game.state);
  if (sig === rollSig) return;
  const first = rollSig === undefined;
  rollSig = sig;
  if (!sig || ended) { if (!sig) clearRollEffect(); return; }
  if (first && game.moves.length > 0) return;
  playRollEffect(game.state);
}

/* ===================== seleção ===================== */

function canAct() {
  if (ended) return false;
  if (mode === "online") return Boolean(online?.isMyTurn() && !sending);
  return true;
}

function selectSource(source) {
  selected = source;
  pickedDie = null;
  choice = null;
  legalForSelected = legalMoves(game.state).filter(move =>
    source === "bar" ? move.fromBar : (!move.fromBar && move.from === source));
  renderBoard();
  renderDice();
  renderStatus();
}

function clearSelection() {
  selected = null;
  legalForSelected = [];
  pickedDie = null;
  choice = null;
}

function onPoint(point) {
  if (!canAct()) return;
  const state = game.state;

  if (state.bar[state.turn] > 0) {
    // Com peça na barra só se entra pela barra; clicar no tabuleiro não seleciona outra peça.
    if (selected === null) return;
  }

  if (selected === null) {
    if (ownCount(state, point) > 0) selectSource(point);
    return;
  }

  if (selected === point && choice === null) {
    clearSelection();
    renderBoard();
    renderDice();
    renderStatus();
    return;
  }

  const moves = legalForSelected.filter(move => !move.toOff && move.to === point);
  if (moves.length) { chooseMove(moves); return; }

  if (ownCount(state, point) > 0 && state.bar[state.turn] === 0) { selectSource(point); return; }
  clearSelection();
  renderBoard();
  renderDice();
  renderStatus();
}

function onBar() {
  if (!canAct()) return;
  const state = game.state;
  if (selected === "bar") {
    clearSelection();
    renderBoard();
    renderDice();
    renderStatus();
    return;
  }
  if (state.bar[state.turn] > 0) selectSource("bar");
}

function onTray(which) {
  if (!canAct() || selected === null) return;
  const bottom = settings.color, top = opposite(bottom);
  const color = which === "right" ? bottom : top;
  if (color !== game.state.turn) return;
  const moves = legalForSelected.filter(move => move.toOff);
  if (moves.length) chooseMove(moves);
}

function onDie(value) {
  if (!canAct() || selected === null) return;
  const moves = legalForSelected.filter(move => move.die === value);
  if (!moves.length) return;

  if (choice) {
    const done = moves.find(move => move.toOff === choice.toOff && move.to === choice.to);
    if (done) { commitMove(done); return; }
  }
  pickedDie = value;
  if (moves.length === 1) { commitMove(moves[0]); return; }
  renderBoard();
  renderDice();
  renderStatus();
}

/** Um destino pode aceitar mais de um dado: pergunta qual (destaque nos dados) em vez de escolher por conta própria. */
function chooseMove(moves) {
  if (moves.length === 1) { commitMove(moves[0]); return; }
  const dies = [...new Set(moves.map(move => move.die))];
  if (dies.length === 1) { commitMove(moves[0]); return; }
  choice = { to: moves[0].to, toOff: moves[0].toOff };
  pickedDie = null;
  renderBoard();
  renderDice();
  renderStatus();
}

/* ===================== lances ===================== */

async function commitMove(input) {
  if (!canAct()) return false;
  const move = findMove(game.state, input);
  if (!move) return false;
  if (mode === "online") return commitOnlineMove(move);
  clockTick();                       // desconta o tempo até o instante do lance
  if (ended) return false;           // o relógio estourou durante o clique

  clearSelection();
  game = playMove(game, move);

  if (!game.result.over) {
    // O próximo jogador já recebe os dados; se não tiver lance, a vez passa sozinha (regra oficial).
    const state = autoRoll(game.state, Math.random);
    game = {
      ...game,
      state,
      keys: [...game.keys, positionKey(state)],
    };
  }

  renderAll();
  if (game.result.over) { finish(game.result); return true; }
  startClock(game.state.turn);
  return true;
}

function renderMoves() {
  els.moves.replaceChildren();
  if (!game.moves.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = `Abertura: as ${label(game.state.turn).toLowerCase()} começam.`;
    els.moves.append(empty);
    els.moveCount.textContent = "0";
    return;
  }
  for (let i = 0; i < game.moves.length; i++) {
    const record = game.moves[i];
    const row = document.createElement("li");
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = `${i + 1}.`;
    const clean = String(record.text ?? "").replace(/\s*\(\d\)$/, "");
    const tag = document.createElement("span");
    tag.className = "die-tag";
    tag.textContent = String(record.die ?? "");
    const text = document.createElement("span");
    text.className = "san";
    text.textContent = clean;
    row.append(num, tag, text);
    if (record.color) row.classList.add(record.color);
    if (i === game.moves.length - 1) row.classList.add("cur");
    els.moves.append(row);
  }
  els.moveCount.textContent = String(game.moves.length);
  els.moves.scrollTop = els.moves.scrollHeight;
}

function renderStatus() {
  if (mode === "online") return renderOnlineStatus();
  if (ended) return;
  const turn = game.state.turn;
  if (choice) { els.status.textContent = "Escolha o dado para completar o lance."; return; }
  if (selected !== null) { els.status.textContent = "Escolha o destino (ou o dado)."; return; }
  const bar = game.state.bar[turn] > 0 ? " Entre com a peça da barra." : "";
  const dice = game.state.dice.length ? ` Dados: ${game.state.dice.join(" e ")}.` : "";
  els.status.textContent = `Vez das ${label(turn).toLowerCase()}.${bar}${dice}`;
  els.resign.textContent = `Desistir (${label(turn)})`;
}

function renderAll() {
  renderBoard();
  renderPlayers();
  renderClocks();
  renderDice();
  renderMoves();
  renderStatus();
  syncRollEffect();
}

/* ===================== fim de jogo ===================== */

function resultReason(result) {
  if (!result?.reason) return "";
  const loser = result.winner ? label(opposite(result.winner)).toLowerCase() : "";
  switch (result.reason) {
    case "off": return `As ${loser} tiveram todas as peças fora primeiro.`;
    case "resign": return `As ${loser} desistiram.`;
    case "timeout": return `O tempo das ${loser} acabou.`;
    default: return RESULT_LABELS[result.reason] ?? "";
  }
}

function finish(result) {
  if (!els.result.hidden) return;
  ended = true;
  activeClock = null;
  clearInterval(clockTimer);
  clockTimer = 0;
  lastResult = result;
  clearSelection();

  renderClocks();
  renderBoard();
  renderDice();
  els.resign.disabled = true;
  els.resign.textContent = "Desistir";
  els.status.textContent = result.winner
    ? `${label(result.winner)} venceram — ${RESULT_LABELS[result.reason] ?? ""}.`
    : `Partida encerrada — ${RESULT_LABELS[result.reason] ?? ""}.`;

  els.resultTitle.textContent = result.winner ? `${label(result.winner)} venceram` : "Partida encerrada";
  els.resultReason.textContent = resultReason(result);
  els.resultIcon.textContent = "●";
  els.resultIcon.className = "result-icon" + (result.winner ? " " + result.winner : "");
  els.result.hidden = false;
  els.rematch.focus();
}

function finishOnline() {
  if (!online || !game.result.over || !els.result.hidden) return;
  const result = game.result;
  const outcome = online.outcome;
  const opp = online.opponent()?.nickname || "Oponente";

  ended = true;
  activeClock = null;
  clearInterval(clockTimer);
  clockTimer = 0;
  lastResult = result;
  clocks = online.clocks();
  clearSelection();

  renderClocks();
  renderBoard();
  renderDice();
  els.resign.disabled = true;
  els.resign.textContent = "Desistir";
  els.status.textContent = outcome === "win" ? "Você venceu!" : outcome === "lose" ? `${opp} venceu.` : "Partida encerrada.";

  els.resultTitle.textContent = outcome === "win" ? "Você venceu!" : outcome === "lose" ? `${opp} venceu` : "Partida encerrada";
  els.resultReason.textContent = resultReason(result);
  els.resultIcon.textContent = "●";
  els.resultIcon.className = "result-icon" + (result.winner ? " " + result.winner : "");
  els.rematch.textContent = "Nova sala";
  els.backSetup.textContent = "Sair";
  els.result.hidden = false;
  els.rematch.focus();
}

/* ===================== início / reinício ===================== */

function startGame() {
  mode = "local";
  clearInterval(clockTimer);
  clockTimer = 0;
  activeClock = null;
  game = newGame(rollOpening(Math.random));
  clocks = { w: settings.minutes * 60000, b: settings.minutes * 60000 };
  ended = false;
  rollSig = undefined;
  clearRollEffect();
  clearSelection();
  lastResult = null;
  els.result.hidden = true;
  els.setup.hidden = true;
  els.lobby.hidden = true;
  els.game.hidden = false;
  els.resign.disabled = false;
  els.resign.textContent = "Desistir";
  els.newGame.textContent = "Nova partida";
  els.rematch.textContent = "Revanche";
  els.backSetup.textContent = "Trocar ritmo";
  renderAll();
  startClock(game.state.turn);
}

function backToSetup() {
  clearInterval(clockTimer);
  clockTimer = 0;
  activeClock = null;
  ended = true;
  rollSig = undefined;
  clearRollEffect();
  clearSelection();
  els.result.hidden = true;
  els.game.hidden = true;
  els.lobby.hidden = true;
  els.setup.hidden = false;
  els.startLocal.focus();
}

function flash(message, target = els.status) {
  target.textContent = message;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    if (target === els.lobbyStatus) renderLobby();
    else if (!ended) renderStatus();
  }, 3200);
}

els.startLocal.addEventListener("click", startGame);
els.createRoom.addEventListener("click", () => createOnlineRoom());
els.newGame.addEventListener("click", () => { if (mode === "online") leaveGame(); else backToSetup(); });
els.backSetup.addEventListener("click", () => { if (mode === "online") leaveGame(); else backToSetup(); });
els.rematch.addEventListener("click", () => {
  els.result.hidden = true;
  if (mode === "online") rematchOnline();
  else startGame();
});
els.resign.addEventListener("click", async () => {
  if (ended) return;
  if (mode === "online") {
    if (!online) return;
    els.resign.disabled = true;
    try { await online.resign(); } catch (e) { flash(onlineMessage(e)); els.resign.disabled = false; }
    return;
  }
  finish({ over: true, winner: opposite(game.state.turn), reason: "resign" });
});
els.trayLeft.addEventListener("click", () => onTray("left"));
els.trayRight.addEventListener("click", () => onTray("right"));

/* ===================== primeira pintura ===================== */

renderTimeOptions();
renderColorOptions();
renderRoomOptions();
els.createRoom.disabled = !canOnline();

if (inviteKind === "code") {
  joinOnlineRoom(invite);
} else if (inviteKind === "id") {
  attachOnlineRoom(invite, { accept: acceptRequested });
} else {
  if (inviteKind === "new") {
    noticeSetup("Escolha o ritmo e a cor e clique em “Criar sala online”. O código aparece na sala para você convidar o amigo.");
  }
  resumeActiveRoom();
}
