/* Xadrez 1×1 — tabuleiro e relógios no navegador. Toda a regra vem de ./domain.js (código puro, testado).
   Dois modos usam o MESMO tabuleiro:
   • local (hot-seat): os dois jogadores no mesmo dispositivo, relógio no navegador;
   • online: sala por código, relógios e lances decididos pela Edge + Postgres (shared/chess-session.js). */
import "../../shared/backend/boot.js";
import { getSession } from "../../shared/session.js";
import { mountUserBar } from "../../js/userbar.js";
import { Music } from "../../shared/music.js";
import { Cloud } from "../../shared/backend/cloud.js";
import { createChessSession } from "../../shared/chess-session.js";
import { duelLink } from "../../shared/duel-ui.js";
import { isDuelCode, normalizeCode } from "../../shared/duel-hub.js";
import { ACCEPT_EVENT } from "../../shared/duel-invites.js";
import { avatarNode } from "../../shared/avatar.js";
import { Profile } from "../../shared/profile.js";
import {
  FILES, RESULT_LABELS, canMate, colorOf, findMove, fromFen, inCheck, kingSquare, legalMoves, newGame,
  opposite, parseSquare, playMove, square, squareName, toUci, typeOf,
} from "./domain.js";

const GAME_ID = "chess";
const NAMES = { K: "rei", Q: "rainha", R: "torre", B: "bispo", N: "cavalo", P: "peão" };
const GLYPH = { K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞", P: "♟" };
const START_COUNTS = { P: 8, N: 2, B: 2, R: 2, Q: 1 };
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
  setup: $("setup"), game: $("game"), lobby: $("lobby"), board: $("board"), promo: $("promo"), status: $("status"),
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
  topCaptured: $("topCaptured"), bottomCaptured: $("bottomCaptured"),
  moves: $("moves"), moveCount: $("moveCount"), resign: $("resign"), newGame: $("newGame"),
  result: $("result"), resultIcon: $("resultIcon"), resultTitle: $("resultTitle"),
  resultReason: $("resultReason"), rematch: $("rematch"), backSetup: $("backSetup"),
};

const session = getSession();
mountUserBar($("userbar"), { base: "../../" });
Music.play(GAME_ID);

/* ===================== estado da partida ===================== */

let mode = "local";                              // "local" (hot-seat) | "online"
let online = null;                               // sessão de xadrez online (shared/chess-session.js)
let sending = false;                             // lance online em trânsito: bloqueia o tabuleiro
let settings = { minutes: 10, color: "w", open: true };  // ritmo, cor e visibilidade da sala online
let game = newGame();
let clocks = { w: 0, b: 0 };
let activeClock = null;
let lastClockAt = 0;
let clockTimer = 0;
let ended = true;
let selected = null;
let legalForSelected = [];
let lastResult = null;
let animatingMove = null;                         // lance sendo animado: { from, to, rookFrom, rookTo }

const label = color => (color === "w" ? "Brancas" : "Pretas");
const canOnline = () => Boolean(session && Cloud.active && Cloud.uid);

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
  online = createChessSession();
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
  if (!online.chess) { online.refresh().catch(() => {}); return; }
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
  try { await online.ready(); } catch (e) { flash(onlineMessage(e), els.lobbyStatus); els.ready.disabled = false; }
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
  mode = "local";
  sending = false;
  ended = true;
  selected = null;
  legalForSelected = [];
  els.result.hidden = true;
  els.promo.hidden = true;
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
  try { await online.ready(); } catch (e) { flash(onlineMessage(e), els.lobbyStatus); els.ready.disabled = false; }
});
els.leaveLobby.addEventListener("click", leaveGame);

/* ===================== tabuleiro online ===================== */

async function enterOnlineGame() {
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
  const c = online?.chess;
  if (!c) return;
  const last = c.last ? {
    ...c.last,
    from: typeof c.last.from === "string" ? parseSquare(c.last.from) : c.last.from,
    to: typeof c.last.to === "string" ? parseSquare(c.last.to) : c.last.to,
  } : null;

  const previousMovesCount = game.moves.length;
  const newMovesCount = Array.isArray(c.moves) ? c.moves.length : 0;
  const shouldAnimateOpponent = !sending && last && newMovesCount === previousMovesCount + 1;

  if (shouldAnimateOpponent) {
    const movingPiece = game.state.board[last.from];
    if (movingPiece) {
      const isCastling = typeOf(movingPiece) === "K" && Math.abs(last.to - last.from) === 2;
      animatingMove = {
        from: last.from,
        to: last.to,
        rookFrom: isCastling ? (last.to > last.from ? last.from + 3 : last.from - 4) : null,
        rookTo: isCastling ? (last.to > last.from ? last.from + 1 : last.from - 1) : null,
      };
    }
  }

  game = {
    state: fromFen(c.fen),
    keys: Array.isArray(c.keys) ? c.keys : [],
    moves: Array.isArray(c.moves) ? c.moves : [],
    last,
    result: c.result
      ? { over: true, winner: c.result === "draw" ? null : c.result === "white" ? "w" : "b", reason: c.reason }
      : { over: false, winner: null, reason: null },
  };
  if (online.myColor) settings.color = online.myColor;
  clocks = online.clocks();
  ended = game.result.over || online.status !== "running";

  if (shouldAnimateOpponent && animatingMove) {
    renderAll();
    const movingPiece = game.state.board[last.to];
    const anims = [animatePieceMove(animatingMove.from, animatingMove.to, movingPiece, MOVE_DURATION)];
    if (animatingMove.rookFrom !== null) {
      const rookPiece = colorOf(movingPiece) === "w" ? "R" : "r";
      anims.push(animatePieceMove(animatingMove.rookFrom, animatingMove.rookTo, rookPiece, MOVE_DURATION));
    }
    await Promise.all(anims);
    animatingMove = null;
    renderBoard();
  }
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
    els.status.classList.remove("check");
    els.resign.disabled = true;
    return;
  }
  els.resign.disabled = false;
  const check = inCheck(game.state);
  const mine = online.myColor;
  const opp = online.opponent()?.nickname || "o adversário";
  if (mine && game.state.turn === mine) {
    els.status.textContent = check ? "Xeque! Sua vez." : "Sua vez.";
  } else {
    els.status.textContent = check ? `Xeque! Vez de ${opp}.` : `Vez de ${opp}.`;
  }
  els.status.classList.toggle("check", check);
  els.resign.textContent = "Desistir";
}

async function commitOnlineMove(move) {
  if (!online || sending) return false;
  sending = true;
  selected = null;
  legalForSelected = [];

  // Anima localmente a nossa peça de forma fluida antes ou durante o envio
  const piece = game.state.board[move.from];
  const isCastling = typeOf(piece) === "K" && Math.abs(move.to - move.from) === 2;
  animatingMove = {
    from: move.from,
    to: move.to,
    rookFrom: isCastling ? (move.to > move.from ? move.from + 3 : move.from - 4) : null,
    rookTo: isCastling ? (move.to > move.from ? move.from + 1 : move.from - 1) : null,
  };

  renderBoard();
  renderStatus();

  const anims = [animatePieceMove(move.from, move.to, piece, MOVE_DURATION)];
  if (isCastling && animatingMove.rookFrom !== null) {
    const rookPiece = colorOf(piece) === "w" ? "R" : "r";
    anims.push(animatePieceMove(animatingMove.rookFrom, animatingMove.rookTo, rookPiece, MOVE_DURATION));
  }
  await Promise.all(anims);
  animatingMove = null;

  try {
    await online.move(toUci(move));
  } catch (e) {
    if (["stale", "not_your_turn", "bad_status"].includes(e?.code)) await online.refresh().catch(() => {});
    flash(onlineMessage(e));
  } finally {
    sending = false;
    if (online && !els.game.hidden) { await applyOnlineState(); renderAll(); }
  }
  return true;
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
  const winner = opposite(color);
  const canWin = canMate(game.state.board, winner);
  finish({
    over: true,
    winner: canWin ? winner : null,
    reason: "timeout",
    note: canWin ? null : "material",
  });
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

function capturedBy(board, playerColor) {
  const enemy = opposite(playerColor);
  const out = [];
  for (const [type, total] of Object.entries(START_COUNTS)) {
    let have = 0;
    for (const piece of board) if (piece && colorOf(piece) === enemy && typeOf(piece) === type) have++;
    for (let i = have; i < total; i++) out.push(type);
  }
  return out.sort((a, b) => "PNBRQ".indexOf(a) - "PNBRQ".indexOf(b));
}

function capSpans(playerColor) {
  const capturedColor = opposite(playerColor);
  return capturedBy(game.state.board, playerColor).map(type => {
    const span = document.createElement("span");
    span.className = "cap-piece " + capturedColor;
    span.textContent = GLYPH[type];
    span.title = NAMES[type];
    return span;
  });
}

function renderPlayers() {
  const bottom = settings.color, top = opposite(bottom);

  let bottomUser = { name: label(bottom), avatar: null, rating: 1500 };
  let topUser = { name: label(top), avatar: null, rating: 1500 };

  if (mode === "online" && online) {
    const me = online.me();
    const opp = online.opponent();
    const isMeBottom = (online.colors?.white === me?.user_id && bottom === "w") ||
                       (online.colors?.black === me?.user_id && bottom === "b");
    const bottomPlayer = isMeBottom ? me : opp;
    const topPlayer = isMeBottom ? opp : me;

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
      bottomUser.rating = prof?.chess_rating || 1500;
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

  els.bottomCaptured.replaceChildren(...capSpans(bottom));
  els.topCaptured.replaceChildren(...capSpans(top));
}

function renderBoard() {
  const state = game.state;
  const ranks = settings.color === "w" ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const files = settings.color === "w" ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const targets = new Set(legalForSelected.map(move => move.to));
  const captures = new Set(legalForSelected.filter(move => state.board[move.to] || move.enPassant).map(move => move.to));
  const checkSq = !ended && inCheck(state) ? kingSquare(state.board, state.turn) : -1;
  const last = game.last;

  els.board.replaceChildren();
  for (const rank of ranks) {
    for (const file of files) {
      const sq = square(file, rank);
      const piece = state.board[sq];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sq " + ((file + rank) % 2 === 0 ? "dark" : "light");
      button.dataset.sq = String(sq);
      button.setAttribute("role", "gridcell");

      let aria = piece
        ? `${NAMES[typeOf(piece)]} ${colorOf(piece) === "w" ? "branco" : "preto"} em ${squareName(sq)}`
        : squareName(sq);
      if (targets.has(sq)) aria += " — lance legal";
      button.setAttribute("aria-label", aria);

      if (sq === selected) button.classList.add("sel");
      if (last && (sq === last.from || sq === last.to)) button.classList.add("last");
      if (sq === checkSq) button.classList.add("check");
      if (targets.has(sq)) {
        button.classList.add(captures.has(sq) ? "cap" : "move");
        const dot = document.createElement("span");
        dot.className = "dot";
        button.append(dot);
      }
      if (piece) {
        const span = document.createElement("span");
        span.className = "piece " + (colorOf(piece) === "w" ? "w" : "b");
        span.textContent = GLYPH[typeOf(piece)];
        span.setAttribute("aria-hidden", "true");
        if (animatingMove && (sq === animatingMove.to || sq === animatingMove.rookTo)) {
          span.style.visibility = "hidden";
        }
        button.append(span);
      }
      if (rank === ranks[ranks.length - 1]) {
        const coord = document.createElement("span");
        coord.className = "coord file";
        coord.textContent = FILES[file];
        button.append(coord);
      }
      if (file === files[0]) {
        const coord = document.createElement("span");
        coord.className = "coord rank";
        coord.textContent = String(rank + 1);
        button.append(coord);
      }
      button.addEventListener("click", () => onSquare(sq));
      els.board.append(button);
    }
  }
}

function onSquare(sq) {
  if (ended || !els.promo.hidden) return;
  if (mode === "online" && (!online?.isMyTurn() || sending)) return;
  const state = game.state;
  if (sq === selected) {
    selected = null;
    legalForSelected = [];
    renderBoard();
    return;
  }
  if (selected !== null) {
    const candidates = legalForSelected.filter(move => move.to === sq);
    if (candidates.length) {
      if (candidates.length > 1) askPromotion(candidates);
      else commitMove(candidates[0]);
      return;
    }
  }
  const piece = state.board[sq];
  if (piece && colorOf(piece) === state.turn) {
    selected = sq;
    legalForSelected = legalMoves(state).filter(move => move.from === sq);
  } else {
    selected = null;
    legalForSelected = [];
  }
  renderBoard();
  renderStatus();
}

function askPromotion(candidates) {
  const card = document.createElement("div");
  card.className = "promo-card";
  const title = document.createElement("p");
  title.textContent = "Promover a…";
  card.append(title);

  for (const move of candidates) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", `Promover a ${NAMES[typeOf(move.promotion)]}`);
    const span = document.createElement("span");
    span.className = "piece " + move.color;
    span.textContent = GLYPH[typeOf(move.promotion)];
    span.setAttribute("aria-hidden", "true");
    button.append(span);
    button.addEventListener("click", () => {
      els.promo.hidden = true;
      commitMove(move);
    });
    card.append(button);
  }

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "cancel";
  cancel.textContent = "Cancelar";
  cancel.addEventListener("click", () => {
    els.promo.hidden = true;
    selected = null;
    legalForSelected = [];
    renderBoard();
  });
  card.append(cancel);

  els.promo.replaceChildren(card);
  els.promo.hidden = false;
  card.querySelector("button")?.focus();
}

/* ===================== animação de movimento ===================== */

const MOVE_DURATION = 720; // Velocidade reduzida pela metade (360ms -> 720ms) para movimento bem visível

function animatePieceMove(fromSq, toSq, pieceChar, duration = MOVE_DURATION) {
  const fromBtn = els.board.querySelector(`[data-sq="${fromSq}"]`);
  const toBtn = els.board.querySelector(`[data-sq="${toSq}"]`);
  if (!fromBtn || !toBtn) return Promise.resolve();

  const boardRect = els.board.getBoundingClientRect();
  const fromRect = fromBtn.getBoundingClientRect();
  const toRect = toBtn.getBoundingClientRect();

  const ghost = document.createElement("div");
  const color = colorOf(pieceChar);
  const type = typeOf(pieceChar);
  ghost.className = "piece-ghost " + color;
  ghost.textContent = GLYPH[type];
  ghost.style.width = `${fromRect.width}px`;
  ghost.style.height = `${fromRect.height}px`;
  ghost.style.left = `${fromRect.left - boardRect.left}px`;
  ghost.style.top = `${fromRect.top - boardRect.top}px`;

  els.board.append(ghost);

  const deltaX = toRect.left - fromRect.left;
  const deltaY = toRect.top - fromRect.top;

  let keyframes = [];

  if (type === "N") {
    // Cavalo move em "L": primeiro percorre o eixo de 2 casas, depois a perna de 1 casa
    if (Math.abs(deltaY) > Math.abs(deltaX)) {
      // 2 casas no eixo vertical (Y), 1 casa no eixo horizontal (X)
      keyframes = [
        { transform: "translate3d(0, 0, 0)", offset: 0 },
        { transform: `translate3d(0, ${deltaY}px, 0)`, offset: 0.65 },
        { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)`, offset: 1 },
      ];
    } else {
      // 2 casas no eixo horizontal (X), 1 casa no eixo vertical (Y)
      keyframes = [
        { transform: "translate3d(0, 0, 0)", offset: 0 },
        { transform: `translate3d(${deltaX}px, 0, 0)`, offset: 0.65 },
        { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)`, offset: 1 },
      ];
    }
  } else {
    // Peão, Bispo (diagonal), Torre (linha reta), Dama e Rei (linha reta ou diagonal)
    keyframes = [
      { transform: "translate3d(0, 0, 0)" },
      { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
    ];
  }

  return new Promise(resolve => {
    const anim = ghost.animate(keyframes, {
      duration,
      easing: type === "N" ? "ease-in-out" : "cubic-bezier(0.2, 0.0, 0.2, 1)",
      fill: "forwards",
    });
    anim.onfinish = () => {
      ghost.remove();
      resolve();
    };
  });
}

async function playMoveWithAnimation(move) {
  const piece = game.state.board[move.from];
  const isCastling = typeOf(piece) === "K" && Math.abs(move.to - move.from) === 2;
  let rookAnim = null;

  animatingMove = {
    from: move.from,
    to: move.to,
    rookFrom: null,
    rookTo: null,
  };

  if (isCastling) {
    if (move.to > move.from) {
      animatingMove.rookFrom = move.from + 3;
      animatingMove.rookTo = move.from + 1;
    } else {
      animatingMove.rookFrom = move.from - 4;
      animatingMove.rookTo = move.from - 1;
    }
  }

  game = playMove(game, move);
  selected = null;
  legalForSelected = [];
  renderAll();

  const anims = [animatePieceMove(move.from, move.to, piece, MOVE_DURATION)];
  if (isCastling && animatingMove.rookFrom !== null) {
    const rookPiece = colorOf(piece) === "w" ? "R" : "r";
    anims.push(animatePieceMove(animatingMove.rookFrom, animatingMove.rookTo, rookPiece, MOVE_DURATION));
  }

  await Promise.all(anims);

  animatingMove = null;
  renderBoard();
}

/* ===================== lances ===================== */

async function commitMove(input) {
  if (ended) return false;
  const move = input && input.piece ? input : findMove(game.state, input);
  if (!move) return false;
  if (mode === "online") return commitOnlineMove(move);
  clockTick();                       // desconta o tempo até o instante do lance
  if (ended) return false;           // o relógio estourou durante o clique

  await playMoveWithAnimation(move);

  if (game.result.over) {
    finish(game.result);
    return true;
  }
  startClock(game.state.turn);
  return true;
}

function renderMoves() {
  els.moves.replaceChildren();
  if (!game.moves.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "Brancas começam.";
    els.moves.append(empty);
    els.moveCount.textContent = "0";
    return;
  }
  const currentRow = Math.floor((game.moves.length - 1) / 2);
  for (let i = 0; i < game.moves.length; i += 2) {
    const row = document.createElement("li");
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = `${i / 2 + 1}.`;
    const white = document.createElement("span");
    white.className = "san";
    white.textContent = game.moves[i].san;
    const black = document.createElement("span");
    black.className = "san";
    black.textContent = game.moves[i + 1]?.san ?? "";
    row.append(num, white, black);
    if (i / 2 === currentRow) row.classList.add("cur");
    els.moves.append(row);
  }
  els.moveCount.textContent = String(game.moves.length);
  els.moves.scrollTop = els.moves.scrollHeight;
}

function renderStatus() {
  if (mode === "online") return renderOnlineStatus();
  if (ended) return;
  const turn = game.state.turn;
  const check = inCheck(game.state);
  els.status.textContent = check ? `Xeque! Vez das ${label(turn).toLowerCase()}.` : `Vez das ${label(turn).toLowerCase()}.`;
  els.status.classList.toggle("check", check);
  els.resign.textContent = `Desistir (${label(turn)})`;
}

function renderAll() {
  renderBoard();
  renderPlayers();
  renderClocks();
  renderMoves();
  renderStatus();
}

/* ===================== fim de jogo ===================== */

function resultReason(result) {
  switch (result.reason) {
    case "checkmate": return "Xeque-mate: o rei não tem escapatória.";
    case "resign": return `As ${label(opposite(result.winner)).toLowerCase()} desistiram.`;
    case "timeout":
      if (!result.winner) return "O tempo acabou, mas o adversário não tem material para dar mate: empate.";
      return `O tempo das ${label(opposite(result.winner)).toLowerCase()} acabou.`;
    case "stalemate": return "Afogamento: o rei não está em xeque, mas não tem lances legais.";
    case "fifty": return "50 lances sem captura ou movimento de peão.";
    case "repetition": return "A mesma posição apareceu três vezes.";
    case "material": return "Material insuficiente para dar mate.";
    default: return "";
  }
}

function finish(result) {
  if (!els.result.hidden) return;
  ended = true;
  activeClock = null;
  clearInterval(clockTimer);
  clockTimer = 0;
  lastResult = result;

  renderClocks();
  els.resign.disabled = true;
  els.resign.textContent = "Desistir";
  els.status.classList.remove("check");
  els.status.textContent = result.winner
    ? `${label(result.winner)} venceram — ${RESULT_LABELS[result.reason] ?? ""}.`
    : `Empate — ${RESULT_LABELS[result.reason] ?? ""}.`;

  els.resultTitle.textContent = result.winner ? `${label(result.winner)} venceram` : "Empate";
  els.resultReason.textContent = resultReason(result);
  els.resultIcon.textContent = result.winner ? GLYPH.K : "½";
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

  renderClocks();
  els.resign.disabled = true;
  els.resign.textContent = "Desistir";
  els.status.classList.remove("check");
  els.status.textContent = outcome === "win" ? "Você venceu!" : outcome === "lose" ? `${opp} venceu.` : "Empate.";

  els.resultTitle.textContent = outcome === "win" ? "Você venceu!" : outcome === "lose" ? `${opp} venceu` : "Empate";
  els.resultReason.textContent = resultReason(result);
  els.resultIcon.textContent = outcome === "draw" ? "½" : GLYPH.K;
  els.resultIcon.className = "result-icon" + (outcome === "draw" ? "" : " " + (result.winner || settings.color));
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
  game = newGame();
  clocks = { w: settings.minutes * 60000, b: settings.minutes * 60000 };
  ended = false;
  selected = null;
  legalForSelected = [];
  lastResult = null;
  els.promo.hidden = true;
  els.result.hidden = true;
  els.setup.hidden = true;
  els.lobby.hidden = true;
  els.game.hidden = false;
  els.resign.disabled = false;
  els.resign.textContent = "Desistir";
  els.newGame.textContent = "Nova partida";
  els.rematch.textContent = "Revanche";
  els.backSetup.textContent = "Trocar ritmo";
  els.status.classList.remove("check");
  renderAll();
  startClock("w");
}

function backToSetup() {
  clearInterval(clockTimer);
  clockTimer = 0;
  activeClock = null;
  ended = true;
  els.result.hidden = true;
  els.promo.hidden = true;
  els.game.hidden = true;
  els.lobby.hidden = true;
  els.setup.hidden = false;
  els.startLocal.focus();
}

let flashTimer = null;
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
