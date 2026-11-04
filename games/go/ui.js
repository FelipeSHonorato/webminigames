/* Go 1×1 — tabuleiro, pedras e relógios no navegador. Toda a regra vem de ./domain.js (código puro, testado).
   Dois modos usam o MESMO tabuleiro:
   • local (hot-seat): os dois jogadores no mesmo dispositivo, relógio no navegador;
   • online: sala por código, relógios e lances decididos pela Edge + Postgres (shared/go-session.js). */
import "../../shared/backend/boot.js";
import { getSession } from "../../shared/session.js";
import { mountUserBar } from "../../js/userbar.js";
import { Music } from "../../shared/music.js";
import { Cloud } from "../../shared/backend/cloud.js";
import { createGoSession } from "../../shared/go-session.js";
import { duelLink } from "../../shared/duel-ui.js";
import { isDuelCode, normalizeCode } from "../../shared/duel-hub.js";
import { ACCEPT_EVENT } from "../../shared/duel-invites.js";
import { avatarNode } from "../../shared/avatar.js";
import { Profile } from "../../shared/profile.js";
import {
  RESULT_LABELS, colorOf, coordOf, findMove, newGame, opposite,
  playMove, positionKey, rankLabel, revive, score, starPoints,
} from "./domain.js";

const GAME_ID = "go";
const LOW_MS = 20000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TIME_CONTROLS = [
  { id: "classic", name: "Clássico", sub: "Standard", minutes: 60 },
  { id: "rapid", name: "Rápido", sub: "Rapid", minutes: 30 },
  { id: "blitz", name: "Blitz", sub: "", minutes: 10 },
  { id: "bullet", name: "Bullet", sub: "", minutes: 3 },
];

const BOARD_SIZES = [
  { size: 9, name: "9×9", sub: "Iniciante" },
  { size: 13, name: "13×13", sub: "Intermediário" },
  { size: 19, name: "19×19", sub: "Clássico" },
];

const ONLINE_MESSAGES = {
  duel_not_found: "Código não encontrado. Confira com quem te convidou.",
  duel_full: "Essa sala já está cheia.",
  bad_status: "Esse duelo já começou ou terminou.",
  expired: "Esse convite expirou. Peça um novo.",
  too_many_open: "Você já tem uma sala aberta. Abra-a em Salas Online (aparece como “Sua sala”) ou saia dela antes de criar outra.",
  not_authenticated: "Entre na sua conta para jogar online.",
  bad_size: "Tamanho de tabuleiro inválido.",
  bad_minutes: "Ritmo de jogo inválido.",
  bad_color: "Cor inválida.",
  not_member: "Você não está nessa sala.",
  not_go_duel: "Essa sala não é de Go.",
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
  sizeOptions: $("sizeOptions"), timeOptions: $("timeOptions"), colorOptions: $("colorOptions"),
  roomOptions: $("roomOptions"), startLocal: $("startLocal"), createRoom: $("createRoom"), duelNotice: $("duelNotice"),
  lobbyCode: $("lobbyCode"), lobbyPlayers: $("lobbyPlayers"), lobbyStatus: $("lobbyStatus"),
  copyCode: $("copyCode"), copyLink: $("copyLink"), ready: $("ready"), leaveLobby: $("leaveLobby"),
  playerTop: $("playerTop"), playerBottom: $("playerBottom"),
  topName: $("topName"), bottomName: $("bottomName"),
  topAvatar: $("topAvatar"), bottomAvatar: $("bottomAvatar"),
  topRatingVal: $("topRatingVal"), bottomRatingVal: $("bottomRatingVal"),
  topColorTag: $("topColorTag"), bottomColorTag: $("bottomColorTag"),
  topClock: $("topClock"), bottomClock: $("bottomClock"),
  topInfo: $("topInfo"), bottomInfo: $("bottomInfo"),
  topStone: $("topStone"), bottomStone: $("bottomStone"),
  turnTag: $("turnTag"), handicapInfo: $("handicapInfo"), komiInfo: $("komiInfo"),
  captureInfo: $("captureInfo"), passInfo: $("passInfo"),
  moves: $("moves"), moveCount: $("moveCount"),
  pass: $("pass"), resign: $("resign"), newGame: $("newGame"),
  result: $("result"), resultIcon: $("resultIcon"), resultTitle: $("resultTitle"),
  resultReason: $("resultReason"), resultScore: $("resultScore"), rematch: $("rematch"), backSetup: $("backSetup"),
};

const session = getSession();
mountUserBar($("userbar"), { base: "../../" });
Music.play(GAME_ID);

/* ===================== estado da partida ===================== */

let mode = "local";                              // "local" (hot-seat) | "online"
let lobbyError = "";                              // erro do "Estou pronto": fica na tela até a próxima tentativa (o polling não apaga)
let online = null;                               // sessão de Go online (shared/go-session.js)
let sending = false;                             // lance online em trânsito: bloqueia o tabuleiro
let settings = { size: 9, minutes: 10, color: "b", open: true };  // tabuleiro, ritmo, cor e visibilidade
let game = newGame({ size: settings.size });
let clocks = { w: 0, b: 0 };
let activeClock = null;
let lastClockAt = 0;
let clockTimer = 0;
let ended = true;
let onlineVersion = null;                        // versão da posição online já pintada
let lastResult = null;
let flashTimer = null;

const label = color => (color === "b" ? "Pretas" : "Brancas");
const canOnline = () => Boolean(session && Cloud.active && Cloud.uid);
const fmtPoints = value => String(value ?? 0).replace(".", ",");

/* ===================== escolha do tabuleiro, ritmo e cor ===================== */

function renderSizeOptions() {
  els.sizeOptions.replaceChildren(...BOARD_SIZES.map(control => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "size-option";
    button.dataset.size = String(control.size);
    button.setAttribute("aria-pressed", String(control.size === settings.size));
    const name = document.createElement("b");
    name.textContent = control.name;
    const sub = document.createElement("span");
    sub.textContent = control.sub;
    button.append(name, sub);
    button.addEventListener("click", () => { settings.size = control.size; renderSizeOptions(); });
    return button;
  }));
}

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
  settings.color = button.dataset.color === "w" ? "w" : "b";
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
  online = createGoSession();
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
  if (!online.go) { online.refresh().catch(() => {}); return; }
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

async function createOnlineRoom(size = settings.size, minutes = settings.minutes, color = settings.color, open = settings.open) {
  if (!session) { noticeSetup("Entre na sua conta para jogar online."); return; }
  if (!canOnline()) { noticeSetup("O duelo online não está disponível nesta sessão."); return; }
  els.createRoom.disabled = true;
  try {
    startOnline();
    await online.create(size, minutes, color, open);
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

/** O criador aceita o desafiante: marca pronto. Como o desafiante já entrou, os dois estão na sala e o servidor
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
    em andamento — abre ELA em vez de oferecer "Criar sala". */
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
  els.result.hidden = true;
  els.lobby.hidden = true;
  els.game.hidden = true;
  els.resign.disabled = false;
  els.resign.textContent = "Desistir";
  els.pass.disabled = false;
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
  const { size, minutes, color, open } = settings;
  els.result.hidden = true;
  teardownOnline();
  await createOnlineRoom(size, minutes, color, open);
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
    els.pass.disabled = false;
    els.newGame.textContent = "Sair";
    startOnlineTicker();
  }
  renderAll();
  if (game.result.over) finishOnline();
  else els.result.hidden = true;
}

async function applyOnlineState() {
  const c = online?.go;
  if (!c) return;
  if (sending) return;                   // lance nosso em trânsito: ele mesmo aplica o estado do servidor no fim

  let state;
  try { state = revive(c.state); } catch (e) { console.warn("[WebMiniGames] estado de Go inválido:", e); return; }

  const version = c.version ?? positionKey(state);
  if (onlineVersion !== null && onlineVersion !== version) { /* a posição mudou: nada selecionado para limpar */ }
  onlineVersion = version;

  game = {
    state,
    keys: Array.isArray(c.keys) ? c.keys : [],
    moves: Array.isArray(c.moves) ? c.moves : [],
    last: c.last ?? null,
    result: c.result
      ? { over: true, winner: c.result === "white" ? "w" : "b", reason: c.reason, score: score(state) }
      : { over: false, winner: null, reason: null, score: null },
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
  if (!ended) renderOnlineStatus();
}

function renderOnlineStatus() {
  if (!online || ended) return;
  const ms = online.msToStart();
  if (ms > 0) {
    els.status.textContent = `Começa em ${Math.ceil(ms / 1000)}…`;
    els.resign.disabled = true;
    els.pass.disabled = true;
    return;
  }
  els.resign.disabled = false;
  els.pass.disabled = false;
  els.resign.textContent = "Desistir";
  if (sending) { els.status.textContent = "Enviando lance…"; return; }

  const mine = online.myColor;
  const opp = online.opponent()?.nickname || "o adversário";
  if (mine && game.state.turn === mine) {
    els.status.textContent = game.state.passes === 1
      ? "Sua vez — uma passada já foi feita; a próxima encerra."
      : `Sua vez — jogue as ${label(game.state.turn).toLowerCase()}.`;
  } else {
    els.status.textContent = `Vez de ${opp} (${label(game.state.turn).toLowerCase()}).`;
  }
}

async function commitOnlineMove(move) {
  if (!online || sending) return false;
  sending = true;
  renderBoard();
  renderStatus();

  let failure = null;
  try {
    await online.move(move.type === "pass" ? { type: "pass" } : { point: move.point });
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
  const bottom = mode === "online" && online?.myColor ? online.myColor : settings.color;
  const top = opposite(bottom);
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

function renderBoard() {
  const state = game.state;
  const n = state.size;
  const interactive = !ended && (mode === "local" || (online?.isMyTurn() && !sending));
  const lastPoint = game.last?.type === "play" ? game.last.point : null;

  els.board.style.setProperty("--n", String(n));
  els.board.replaceChildren();
  const grid = document.createElement("div");
  grid.className = "go-grid";

  /* Pontos de referência (hoshi): ficam sob as pedras e não recebem clique. */
  for (const point of starPoints(n)) {
    const star = document.createElement("span");
    star.className = "star";
    star.style.left = `${((point % n) + 0.5) / n * 100}%`;
    star.style.top = `${(Math.floor(point / n) + 0.5) / n * 100}%`;
    star.setAttribute("aria-hidden", "true");
    grid.append(star);
  }

  for (let point = 0; point < n * n; point++) {
    const value = state.board[point];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "go-point";
    button.dataset.point = String(point);
    button.setAttribute("role", "gridcell");

    const coord = coordOf(n, point);
    const color = colorOf(value);
    let aria = `Interseção ${coord}`;
    if (color) aria += `, pedra ${color === "b" ? "preta" : "branca"}`;

    const legal = interactive && findMove(state, point);
    if (legal) aria += ", lance legal";
    button.setAttribute("aria-label", aria);

    if (color) {
      const stone = document.createElement("span");
      stone.className = "stone " + color + (point === lastPoint ? " last" : "");
      stone.setAttribute("aria-hidden", "true");
      button.append(stone);
    } else if (legal) {
      const ghost = document.createElement("span");
      ghost.className = "stone ghost " + state.turn;
      ghost.setAttribute("aria-hidden", "true");
      button.append(ghost);
    }

    button.disabled = !interactive || Boolean(value);
    button.addEventListener("click", () => onPoint(point));
    grid.append(button);
  }

  els.board.append(grid);
}

function renderPlayers() {
  const bottom = mode === "online" && online?.myColor ? online.myColor : settings.color;
  const top = opposite(bottom);
  const state = game.state;

  let bottomUser = { name: label(bottom), avatar: null, rank: mode === "online" ? rankLabel(1500) : "Local" };
  let topUser = { name: label(top), avatar: null, rank: mode === "online" ? rankLabel(1500) : "Local" };

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
      bottomUser.rank = rankLabel(bottomPlayer.rating);
    }
    if (topPlayer) {
      topUser.name = topPlayer.nickname || (topPlayer.is_me ? "Você" : "Aguardando…");
      topUser.avatar = topPlayer.avatar || null;
      topUser.rank = rankLabel(topPlayer.rating);
    }
  } else if (session) {
    const prof = Profile.get(session.id);
    bottomUser.name = Profile.displayName(session);
    bottomUser.avatar = prof?.avatar || null;
    bottomUser.rank = "Local";
  }

  els.bottomName.textContent = bottomUser.name;
  els.topName.textContent = topUser.name;
  els.bottomColorTag.textContent = label(bottom);
  els.topColorTag.textContent = label(top);
  els.bottomRatingVal.textContent = bottomUser.rank;
  els.topRatingVal.textContent = topUser.rank;
  els.bottomAvatar.replaceChildren(avatarNode(bottomUser.avatar));
  els.topAvatar.replaceChildren(avatarNode(topUser.avatar));
  els.bottomStone.className = "player-stone " + bottom;
  els.topStone.className = "player-stone " + top;

  els.bottomInfo.textContent = `Capturas ${state.captures[bottom]}`;
  els.topInfo.textContent = `Capturas ${state.captures[top]}`;
}

function renderMatchInfo() {
  const state = game.state;
  const handicap = state.handicap >= 2
    ? `${state.handicap} pedras · ${label(state.handicapColor)}`
    : "Sem handicap";
  els.handicapInfo.textContent = handicap;
  els.komiInfo.textContent = fmtPoints(state.komi);
  els.captureInfo.textContent = `P ${state.captures.b} · B ${state.captures.w}`;
  els.passInfo.textContent = String(state.passes);
  els.turnTag.textContent = ended && game.result.over ? "Fim" : `${label(state.turn)}`;
}

/* ===================== lances ===================== */

function canAct() {
  if (ended) return false;
  if (mode === "online") return Boolean(online?.isMyTurn() && !sending);
  return true;
}

function onPoint(point) {
  if (!canAct()) return;
  commitMove({ point });
}

/** Passar: uma passada troca a vez; a segunda seguida encerra e conta. */
async function passTurn() {
  if (!canAct()) return;
  await commitMove({ type: "pass" });
}

async function commitMove(input) {
  if (!canAct()) return false;
  const move = findMove(game.state, input);
  if (!move) { flash("Lance ilegal."); return false; }
  if (mode === "online") return commitOnlineMove(move);
  clockTick();                       // desconta o tempo até o instante do lance
  if (ended) return false;           // o relógio estourou durante o clique

  game = playMove(game, move);
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
    const tag = document.createElement("span");
    tag.className = "stone-tag " + (record.color ?? "b");
    tag.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.className = "san";
    text.textContent = record.type === "pass" ? "passou" : String(record.text ?? "");
    row.append(num, tag, text);
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
  const passHint = game.state.passes === 1 ? " Uma passada já foi feita; a próxima encerra a partida." : "";
  els.status.textContent = `Vez das ${label(turn).toLowerCase()}.${passHint}`;
  els.resign.textContent = `Desistir (${label(turn)})`;
}

function renderAll() {
  renderBoard();
  renderPlayers();
  renderClocks();
  renderMatchInfo();
  renderMoves();
  renderStatus();
}

/* ===================== fim de jogo ===================== */

function resultReason(result) {
  if (!result?.reason) return "";
  const loser = result.winner ? label(opposite(result.winner)).toLowerCase() : "";
  switch (result.reason) {
    case "score": return `Contagem chinesa: ${label(result.winner)} com mais área.`;
    case "resign": return `As ${loser} desistiram.`;
    case "timeout": return `O tempo das ${loser} acabou.`;
    default: return RESULT_LABELS[result.reason] ?? "";
  }
}

function resultScoreText(result) {
  const final = result?.score ?? score(game.state);
  if (!final) return "";
  return `Pretas ${fmtPoints(final.black)} · Brancas ${fmtPoints(final.white)} · Komi ${fmtPoints(final.komi)}`;
}

function showResult(result, { title, statusText } = {}) {
  ended = true;
  activeClock = null;
  clearInterval(clockTimer);
  clockTimer = 0;
  lastResult = result;

  renderClocks();
  renderBoard();
  renderMatchInfo();
  els.resign.disabled = true;
  els.pass.disabled = true;
  els.resign.textContent = "Desistir";
  els.status.textContent = statusText;

  els.resultTitle.textContent = title;
  els.resultReason.textContent = resultReason(result);
  els.resultScore.textContent = resultScoreText(result);
  els.resultIcon.textContent = "●";
  els.resultIcon.style.color = result.winner === "b" ? "#1b1b1b" : "#f4f1e8";
  els.result.hidden = false;
  els.rematch.focus();
}

function finish(result) {
  if (!els.result.hidden) return;
  const title = result.winner ? `${label(result.winner)} venceram` : "Partida encerrada";
  showResult(result, {
    title,
    statusText: result.winner
      ? `${label(result.winner)} venceram — ${RESULT_LABELS[result.reason] ?? ""}.`
      : `Partida encerrada — ${RESULT_LABELS[result.reason] ?? ""}.`,
  });
}

function finishOnline() {
  if (!online || !game.result.over || !els.result.hidden) return;
  const result = game.result;
  const outcome = online.outcome;
  const opp = online.opponent()?.nickname || "Oponente";

  showResult(result, {
    title: outcome === "win" ? "Você venceu!" : outcome === "lose" ? `${opp} venceu` : "Partida encerrada",
    statusText: outcome === "win" ? "Você venceu!" : outcome === "lose" ? `${opp} venceu.` : "Partida encerrada.",
  });
  els.rematch.textContent = "Nova sala";
  els.backSetup.textContent = "Sair";
}

/* ===================== início / reinício ===================== */

function startGame() {
  mode = "local";
  clearInterval(clockTimer);
  clockTimer = 0;
  activeClock = null;
  game = newGame({ size: settings.size });
  clocks = { w: settings.minutes * 60000, b: settings.minutes * 60000 };
  ended = false;
  onlineVersion = null;
  lastResult = null;
  els.result.hidden = true;
  els.setup.hidden = true;
  els.lobby.hidden = true;
  els.game.hidden = false;
  els.resign.disabled = false;
  els.pass.disabled = false;
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
els.newGame.addEventListener("click", () => { if (mode === "online") leaveGame(); else startGame(); });
els.backSetup.addEventListener("click", () => { if (mode === "online") leaveGame(); else backToSetup(); });
els.rematch.addEventListener("click", () => {
  els.result.hidden = true;
  if (mode === "online") rematchOnline();
  else startGame();
});
els.pass.addEventListener("click", passTurn);
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

/* ===================== primeira pintura ===================== */

renderSizeOptions();
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
    noticeSetup("Escolha o tabuleiro, o ritmo e a cor e clique em “Criar sala online”. O código aparece na sala para você convidar o amigo.");
  }
  resumeActiveRoom();
}
