/* Onitama 1×1 — tabuleiro, cartas e relógios no navegador. Toda a regra vem de ./domain.js (código puro, testado).
   Dois modos usam o MESMO tabuleiro:
   • local (hot-seat): os dois jogadores no mesmo dispositivo, cartas sorteadas aqui e relógio no navegador;
   • online: sala por código; cartas, relógios e lances decididos pela Edge + Postgres (shared/onitama-session.js).
   Jogada: toque numa CARTA, depois numa PEÇA e no DESTINO (a ordem carta/peça é livre; se dois cartas levam ao
   mesmo destino, o jogo pergunta qual usar). Sem nenhum lance possível, tocar numa carta troca-a e passa a vez. */
import "../../shared/backend/boot.js";
import { getSession } from "../../shared/session.js";
import { mountUserBar } from "../../js/userbar.js";
import { Music } from "../../shared/music.js";
import { Cloud } from "../../shared/backend/cloud.js";
import { createOnitamaSession } from "../../shared/onitama-session.js";
import { duelLink } from "../../shared/duel-ui.js";
import { isDuelCode, normalizeCode } from "../../shared/duel-hub.js";
import { ACCEPT_EVENT } from "../../shared/duel-invites.js";
import { avatarNode } from "../../shared/avatar.js";
import { Profile } from "../../shared/profile.js";
import {
  CARDS, FILES, RESULT_LABELS, SIZE, TEMPLE, colorOf, dealCards, fromPosition, isMaster, legalMoves,
  moveText, newGame, offsets, opposite, parseSquare, playMove, square, squareName,
} from "./domain.js";

const GAME_ID = "onitama";
const LOW_MS = 20000;
const PIECE_SCALE = 0.70;                         // o disco ocupa 70% da casa (o resto é respiro)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TIME_CONTROLS = [
  { id: "bullet", name: "Relâmpago", sub: "", minutes: 2 },
  { id: "blitz", name: "Rápido", sub: "", minutes: 5 },
  { id: "rapid", name: "Padrão", sub: "", minutes: 10 },
  { id: "classic", name: "Clássico", sub: "", minutes: 15 },
];

const ONLINE_MESSAGES = {
  duel_not_found: "Código não encontrado. Confira com quem te convidou.",
  duel_full: "Essa sala já está cheia.",
  bad_status: "Esse duelo já começou ou terminou.",
  expired: "Esse convite expirou. Peça um novo.",
  too_many_open: "Você já tem uma sala aberta. Abra-a em Salas Online (aparece como “Sua sala”) ou saia dela antes de criar outra.",
  not_authenticated: "Entre na sua conta para jogar online.",
  bad_minutes: "Ritmo de jogo inválido.",
  bad_color: "Lado inválido.",
  not_member: "Você não está nessa sala.",
  not_onitama_duel: "Essa sala não é de Onitama.",
  invalid_move: "Lance inválido.",
  not_your_turn: "Não é a sua vez.",
  stale: "O tabuleiro mudou. Atualizando…",
  not_started: "A partida ainda não começou.",
  opponent_away: "O desafiante saiu da página. Espere ele voltar ou saia da sala.",
  not_creator: "Só quem criou a sala pode fazer isso.",
  bad_state: "Não foi possível montar a partida. Tente criar a sala de novo.",
};
/* Erro conhecido: mensagem própria. Desconhecido: a genérica + o motivo técnico (curto) e o erro completo no console. */
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
  topHand: $("topHand"), bottomHand: $("bottomHand"), sideCard: $("sideCard"),
  moves: $("moves"), moveCount: $("moveCount"), resign: $("resign"), newGame: $("newGame"),
  result: $("result"), resultIcon: $("resultIcon"), resultTitle: $("resultTitle"),
  resultReason: $("resultReason"), rematch: $("rematch"), backSetup: $("backSetup"),
};

const session = getSession();
mountUserBar($("userbar"), { base: "../../" });
Music.play(GAME_ID);

/* ===================== estado da partida ===================== */

let mode = "local";                              // "local" (hot-seat) | "online"
let lobbyError = "";                              // erro do "Estou pronto": fica na tela até a próxima tentativa
let online = null;                               // sessão online (shared/onitama-session.js)
let sending = false;                             // lance online em trânsito: bloqueia o tabuleiro
let settings = { minutes: 10, color: "b", open: true };   // ritmo, lado ("b" | "r" | "random") e visibilidade da sala
let viewColor = "b";                             // lado que aparece embaixo (online: o meu; local: o escolhido)
let game = newGame(dealCards(Math.random));      // só para a primeira pintura; startGame sorteia de novo
let clocks = { b: 0, r: 0 };
let activeClock = null;
let lastClockAt = 0;
let clockTimer = 0;
let ended = true;
let selCard = null;                              // carta escolhida (id)
let selFrom = null;                              // casa da peça escolhida
let pendingTo = null;                            // destino tocado quando duas cartas levam até ele
let animatingMove = null;                        // { path: [de, para] } do lance sendo animado
let legalCache = { ref: null, value: [] };

const label = color => (color === "b" ? "Azul" : "Vermelho");
const canOnline = () => Boolean(session && Cloud.active && Cloud.uid);

/** Lances legais da posição atual (memoizado por estado: o render chama várias vezes). */
function legal() {
  if (legalCache.ref !== game.state) legalCache = { ref: game.state, value: legalMoves(game.state) };
  return legalCache.value;
}
const onlyPasses = () => legal().length > 0 && legal().every(m => m.pass);

/** Registro do servidor/histórico (`from`/`to` em texto) → casas. */
function pathFromRecord(record) {
  if (!record || record.pass || !record.from || !record.to) return null;
  const from = parseSquare(record.from), to = parseSquare(record.to);
  return from >= 0 && to >= 0 ? [from, to] : null;
}

/* ===================== escolha do ritmo e do lado ===================== */

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
    sub.textContent = `${control.minutes} min por jogador`;
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
  const color = button.dataset.color;
  settings.color = color === "r" || color === "random" ? color : "b";
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
  online = createOnitamaSession();
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
  if (!online.onitama) { online.refresh().catch(() => {}); return; }
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
  mode = "local";
  sending = false;
  ended = true;
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
    const color = online.colors.blue === player.user_id ? "b"
      : online.colors.red === player.user_id ? "r" : null;
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
      ? "Os dois prontos! Sorteando as cartas…"
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

/* ===================== partida online ===================== */

async function enterOnlineGame() {
  /* Sem isto a página tratava a partida online como local: o clique jogava a peça só na tela, o lance nunca ia
     ao servidor e a próxima consulta de estado devolvia a peça ao lugar. */
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
  if (!sending && !animatingMove) renderAll();   // redesenhar no meio da animação apagaria a peça que está voando
  if (game.result.over) finishOnline();
  else els.result.hidden = true;
}

async function applyOnlineState() {
  const c = online?.onitama;
  if (!c) return;
  if (sending) return;                   // lance nosso em trânsito: ele mesmo aplica o estado do servidor no fim

  const last = c.last ?? null;
  const lastPath = pathFromRecord(last);
  const previousMovesCount = game.moves.length;
  const newMovesCount = Array.isArray(c.moves) ? c.moves.length : 0;
  const shouldAnimateOpponent = Boolean(lastPath) && newMovesCount === previousMovesCount + 1 && mode === "online";
  const movingPiece = shouldAnimateOpponent ? game.state.board[lastPath[0]] : null;

  game = {
    state: fromPosition(c.position),
    keys: Array.isArray(c.keys) ? c.keys : [],
    moves: Array.isArray(c.moves) ? c.moves : [],
    last,
    result: c.result
      ? { over: true, winner: c.result === "draw" ? null : c.result === "blue" ? "b" : "r", reason: c.reason }
      : { over: false, winner: null, reason: null },
  };
  if (online.myColor) viewColor = online.myColor;
  if (newMovesCount !== previousMovesCount) clearSelection();   // a posição mudou: a seleção antiga não vale mais
  clocks = online.clocks();
  ended = game.result.over || online.status !== "running";

  if (shouldAnimateOpponent && movingPiece) {
    animatingMove = { path: lastPath };
    renderAll();
    await animatePath(lastPath, movingPiece);
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
  if (!ended) renderStatus();
}

/** Corpo do lance que vai ao servidor: só { from, to, card } (ou { pass, card }) — nunca a posição nova. */
const payloadOf = move => (move.pass
  ? { pass: true, card: move.card }
  : { from: squareName(move.from), to: squareName(move.to), card: move.card });

async function commitOnlineMove(move) {
  if (!online || sending) return false;
  sending = true;
  clearSelection();

  const piece = move.pass ? null : game.state.board[move.from];
  try {
    /* Lance otimista, como no modo local: a tela já mostra a posição NOVA e o pedido ao servidor segue em paralelo
       com a animação. Se o servidor recusar, o estado dele volta a valer no fim. */
    game = playMove(game, move);
    animatingMove = move.pass ? null : { path: [move.from, move.to] };
    renderAll();

    let failure = null;
    const request = online.move(payloadOf(move)).catch(e => { failure = e; });
    await Promise.all([move.pass ? Promise.resolve() : animatePath([move.from, move.to], piece), request]);
    animatingMove = null;

    if (failure) {
      if (["stale", "not_your_turn", "bad_status"].includes(failure?.code)) await online.refresh().catch(() => {});
      flash(onlineMessage(failure));
    }
  } catch {
    animatingMove = null;                // lance ilegal na cópia local: nada foi enviado
  } finally {
    sending = false;
    /* A posição do servidor manda: confirma o lance (igual ao que já está na tela) ou desfaz se ele foi recusado. */
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
  // No Onitama sempre dá para vencer pelo Rio: quem estourou o tempo perde, sem exceção de material.
  finish({ over: true, winner: opposite(color), reason: "timeout" });
}

function renderClocks() {
  const bottom = viewColor, top = opposite(bottom);
  const active = ended ? null : game.state.turn;
  els.bottomClock.textContent = fmtClock(clocks[bottom]);
  els.topClock.textContent = fmtClock(clocks[top]);
  els.bottomClock.setAttribute("aria-label", `Relógio do ${label(bottom).toLowerCase()}`);
  els.topClock.setAttribute("aria-label", `Relógio do ${label(top).toLowerCase()}`);
  els.playerBottom.classList.toggle("active", active === bottom);
  els.playerTop.classList.toggle("active", active === top);
  els.playerBottom.classList.toggle("low", clocks[bottom] <= LOW_MS);
  els.playerTop.classList.toggle("low", clocks[top] <= LOW_MS);
}

/* ===================== jogadores ===================== */

function renderPlayers() {
  const bottom = viewColor, top = opposite(bottom);

  const bottomUser = { name: label(bottom), avatar: null, rating: 1500 };
  const topUser = { name: label(top), avatar: null, rating: 1500 };

  if (mode === "online" && online) {
    const me = online.me();
    const opp = online.opponent();
    const isMeBottom = (online.colors?.blue === me?.user_id && bottom === "b") ||
                       (online.colors?.red === me?.user_id && bottom === "r");
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
    }
    topUser.name = "Adversário";
  }

  els.bottomName.textContent = bottomUser.name;
  els.topName.textContent = topUser.name;
  els.bottomColorTag.textContent = label(bottom);
  els.topColorTag.textContent = label(top);
  els.bottomRatingVal.textContent = String(bottomUser.rating);
  els.topRatingVal.textContent = String(topUser.rating);
  els.bottomAvatar.replaceChildren(avatarNode(bottomUser.avatar));
  els.topAvatar.replaceChildren(avatarNode(topUser.avatar));
}

/* ===================== cartas ===================== */

/** Quem pode tocar nas cartas/peças agora. */
function canAct() {
  if (ended || sending || animatingMove) return false;
  if (mode === "online") return Boolean(online?.isMyTurn());
  return true;
}

/** Cartas da mão que levam ao destino `to` com a peça `from` (para saber se há ambiguidade). */
const cardsFor = (from, to) => [...new Set(legal().filter(m => !m.pass && m.from === from && m.to === to).map(m => m.card))];

/** Diagrama 5×5 da carta, visto de `viewColor`; `owner` define o espelhamento (o rival vê de cabeça para baixo). */
function cardNode(id, owner, { clickable = false, picked = false, side = false, hot = false } = {}) {
  const info = CARDS[id];
  const button = document.createElement("button");
  button.type = "button";
  button.className = `card stamp-${info.stamp} owner-${owner}` + (side ? " side" : "") + (clickable ? " mine" : "")
    + (picked ? " picked" : "") + (hot ? " hot" : "");
  button.dataset.card = id;
  button.disabled = !clickable;
  const count = info.moves.length;
  button.setAttribute("aria-label", `${info.name}: ${count} movimentos${picked ? ", escolhida" : ""}${side ? ", carta do lado" : ""}`);
  button.setAttribute("aria-pressed", String(picked));

  const grid = document.createElement("div");
  grid.className = "card-grid";
  grid.setAttribute("aria-hidden", "true");
  const marks = new Set();
  for (const [dx, dy] of offsets(id, owner)) {
    const col = viewColor === "b" ? 2 + dx : 2 - dx;
    const row = viewColor === "b" ? 2 - dy : 2 + dy;
    marks.add(row * SIZE + col);
  }
  for (let i = 0; i < SIZE * SIZE; i++) {
    const cell = document.createElement("i");
    if (i === 12) cell.className = "c";
    else if (marks.has(i)) cell.className = "m";
    grid.append(cell);
  }
  const name = document.createElement("span");
  name.className = "card-name";
  name.textContent = info.name;
  button.append(grid, name);
  if (clickable) button.addEventListener("click", () => onCard(id));
  return button;
}

function renderHands() {
  const bottom = viewColor, top = opposite(bottom);
  const turn = game.state.turn;
  const mineActive = canAct();
  const ambiguous = pendingTo !== null && selFrom !== null ? new Set(cardsFor(selFrom, pendingTo)) : new Set();

  const build = (color, host) => {
    const turnOfThis = turn === color && !ended;
    // Em modo local as duas mãos são "minhas" na própria vez; online só a mão do meu lado.
    const clickable = mineActive && turnOfThis && (mode === "local" || online?.myColor === color);
    host.replaceChildren(...game.state.cards[color].map(id =>
      cardNode(id, color, { clickable, picked: selCard === id && turnOfThis, hot: ambiguous.has(id) && turnOfThis })));
  };
  build(top, els.topHand);
  build(bottom, els.bottomHand);
  els.sideCard.replaceChildren(cardNode(game.state.cards.side, turn, { side: true }));
}

/* ===================== tabuleiro ===================== */

/** Destinos da peça escolhida (filtrados pela carta, se houver): casa → alguma captura? */
function targets() {
  const out = new Map();
  if (selFrom === null) return out;
  for (const m of legal()) {
    if (m.pass || m.from !== selFrom) continue;
    if (selCard && m.card !== selCard) continue;
    out.set(m.to, Boolean(out.get(m.to)) || Boolean(m.captured));
  }
  return out;
}

/** Peças que podem usar a carta escolhida (realçadas quando ainda não escolhi a peça). */
function movablePieces() {
  const out = new Set();
  if (!selCard || selFrom !== null) return out;
  for (const m of legal()) if (!m.pass && m.card === selCard) out.add(m.from);
  return out;
}

const pieceName = p => `${isMaster(p) ? "mestre" : "aluno"} ${colorOf(p) === "b" ? "azul" : "vermelho"}`;

function renderBoard() {
  const state = game.state;
  const ranks = viewColor === "b" ? [4, 3, 2, 1, 0] : [0, 1, 2, 3, 4];
  const files = viewColor === "b" ? [0, 1, 2, 3, 4] : [4, 3, 2, 1, 0];
  const lastPath = pathFromRecord(game.last);
  const dests = targets();
  const movable = movablePieces();

  els.board.replaceChildren();
  for (const rank of ranks) {
    for (const file of files) {
      const sq = square(file, rank);
      const piece = state.board[sq];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sq " + ((file + rank) % 2 === 0 ? "dark" : "light");
      if (sq === TEMPLE.b || sq === TEMPLE.r) button.classList.add("temple");
      button.dataset.sq = String(sq);
      button.setAttribute("role", "gridcell");

      let aria = piece ? `${pieceName(piece)} em ${squareName(sq)}` : squareName(sq);
      if (sq === TEMPLE.b) aria += " (templo azul)";
      if (sq === TEMPLE.r) aria += " (templo vermelho)";
      if (dests.has(sq)) aria += " — lance legal";
      button.setAttribute("aria-label", aria);

      if (sq === selFrom) button.classList.add("sel");
      else if (movable.has(sq)) button.classList.add("movable");
      if (sq === pendingTo) button.classList.add("path");
      if (lastPath && lastPath.includes(sq)) button.classList.add("last");
      if (dests.has(sq)) {
        button.classList.add(dests.get(sq) ? "cap" : "move");
        const dot = document.createElement("span");
        dot.className = "dot";
        button.append(dot);
      }
      if (piece) {
        const span = document.createElement("span");
        span.className = "piece " + colorOf(piece) + (isMaster(piece) ? " master" : "");
        span.setAttribute("aria-hidden", "true");
        if (animatingMove?.path && sq === animatingMove.path[animatingMove.path.length - 1]) {
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

function clearSelection() {
  selCard = null;
  selFrom = null;
  pendingTo = null;
}

function refreshSelection() {
  renderBoard();
  renderHands();
  renderStatus();
}

/** Joga `card` de `from` para `to` (ou a passada, com `from` nulo). */
function commitSelection(from, to, card) {
  const move = legal().find(m => (from === null ? m.pass && m.card === card : !m.pass && m.from === from && m.to === to && m.card === card));
  if (!move) return false;
  return commitMove(move);
}

function onCard(id) {
  if (!canAct()) return;
  if (onlyPasses()) {                       // sem lance de peça: tocar numa carta troca-a e passa a vez
    commitSelection(null, null, id);
    return;
  }
  if (pendingTo !== null && selFrom !== null && cardsFor(selFrom, pendingTo).includes(id)) {
    commitSelection(selFrom, pendingTo, id);   // destino ambíguo resolvido pela carta
    return;
  }
  selCard = selCard === id ? null : id;
  pendingTo = null;
  refreshSelection();
}

function onSquare(sq) {
  if (!canAct()) return;
  const state = game.state;
  const piece = state.board[sq];
  const dests = targets();

  if (selFrom !== null && dests.has(sq)) {
    const cards = cardsFor(selFrom, sq).filter(c => !selCard || c === selCard);
    if (cards.length === 1) { commitSelection(selFrom, sq, cards[0]); return; }
    pendingTo = sq;                         // duas cartas chegam aqui: o jogador escolhe a carta
    refreshSelection();
    return;
  }

  if (piece && colorOf(piece) === state.turn) {
    selFrom = sq === selFrom ? null : sq;
    pendingTo = null;
    refreshSelection();
    return;
  }

  selFrom = null;
  pendingTo = null;
  refreshSelection();
}

/* ===================== animação de movimento ===================== */

const MOVE_DURATION = 520;

/** Anima a peça deslizando da casa de origem à de destino. */
function animatePath(pathSquares, pieceChar, duration = MOVE_DURATION) {
  if (!pieceChar || !Array.isArray(pathSquares) || pathSquares.length < 2) return Promise.resolve();

  const boardRect = els.board.getBoundingClientRect();
  const rectOf = sq => els.board.querySelector(`[data-sq="${sq}"]`)?.getBoundingClientRect();
  const startRect = rectOf(pathSquares[0]);
  const endRect = rectOf(pathSquares[pathSquares.length - 1]);
  if (!startRect || !endRect || !startRect.width) return Promise.resolve();

  const ghost = document.createElement("div");
  ghost.className = "piece-ghost " + colorOf(pieceChar) + (isMaster(pieceChar) ? " master" : "");
  const size = startRect.width * PIECE_SCALE;
  ghost.style.width = `${size}px`;
  ghost.style.height = `${size}px`;
  ghost.style.left = `${startRect.left - boardRect.left + (startRect.width - size) / 2}px`;
  ghost.style.top = `${startRect.top - boardRect.top + (startRect.height - size) / 2}px`;
  els.board.append(ghost);

  const keyframes = [
    { transform: "translate3d(0, 0, 0)" },
    { transform: `translate3d(${endRect.left - startRect.left}px, ${endRect.top - startRect.top}px, 0)` },
  ];
  return new Promise(resolve => {
    const anim = ghost.animate(keyframes, { duration, easing: "cubic-bezier(0.2, 0.0, 0.2, 1)", fill: "forwards" });
    anim.onfinish = () => { ghost.remove(); resolve(); };
  });
}

/* ===================== lances ===================== */

async function commitMove(move) {
  if (ended) return false;
  if (mode === "online") return commitOnlineMove(move);
  clockTick();                       // desconta o tempo até o instante do lance
  if (ended) return false;           // o relógio estourou durante o clique

  const piece = move.pass ? null : game.state.board[move.from];
  animatingMove = move.pass ? null : { path: [move.from, move.to] };
  game = playMove(game, move);
  clearSelection();
  renderAll();
  if (!move.pass) await animatePath([move.from, move.to], piece);
  animatingMove = null;
  renderAll();

  if (game.result.over) {
    finish(game.result);
    return true;
  }
  startClock(game.state.turn);
  return true;
}

function renderMoves() {
  els.moves.replaceChildren();
  const n = game.moves.length;
  if (!n) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = `${label(game.state.turn)} começa (carta do lado).`;
    els.moves.append(empty);
    els.moveCount.textContent = "0";
    return;
  }
  game.moves.forEach((record, i) => {
    const mover = (n - i) % 2 === 1 ? opposite(game.state.turn) : game.state.turn;   // a vez atual diz quem jogou cada lance
    const li = document.createElement("li");
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = `${i + 1}.`;
    const dot = document.createElement("span");
    dot.className = "mini-piece " + mover;
    dot.style.width = dot.style.height = "10px";
    dot.setAttribute("aria-hidden", "true");
    const san = document.createElement("span");
    san.className = "san";
    san.textContent = moveText(record);
    li.append(num, dot, san);
    if (i === n - 1) li.classList.add("cur");
    els.moves.append(li);
  });
  els.moveCount.textContent = String(n);
  els.moves.scrollTop = els.moves.scrollHeight;
}

/** Texto de orientação do turno, de acordo com o que já foi escolhido. */
function hintText() {
  if (onlyPasses()) return "Sem lances possíveis: toque numa carta para trocá-la e passar a vez.";
  if (pendingTo !== null) return "Duas cartas levam até aí: escolha qual usar.";
  if (selCard && selFrom === null) return `${CARDS[selCard].name}: escolha uma peça realçada.`;
  if (selFrom !== null && !selCard) return "Escolha o destino ou uma carta.";
  if (selFrom !== null && selCard && targets().size === 0) return `${CARDS[selCard].name} não leva essa peça a lugar nenhum.`;
  return "Escolha uma carta e uma peça.";
}

function renderStatus() {
  if (ended) return;
  if (mode === "online") {
    if (!online) return;
    const ms = online.msToStart();
    if (ms > 0) {
      els.status.textContent = `Começa em ${Math.ceil(ms / 1000)}…`;
      els.resign.disabled = true;
      return;
    }
    els.resign.disabled = false;
    const opp = online.opponent()?.nickname || "o adversário";
    els.status.textContent = online.isMyTurn() ? `Sua vez. ${hintText()}` : `Vez de ${opp}.`;
    els.resign.textContent = "Desistir";
    return;
  }
  const turn = game.state.turn;
  els.status.textContent = `Vez do ${label(turn).toLowerCase()}. ${hintText()}`;
  els.resign.textContent = `Desistir (${label(turn)})`;
}

function renderAll() {
  renderBoard();
  renderHands();
  renderPlayers();
  renderClocks();
  renderMoves();
  renderStatus();
}

/* ===================== fim de jogo ===================== */

function resultReason(result) {
  const loser = result.winner ? label(opposite(result.winner)).toLowerCase() : "";
  const winner = result.winner ? label(result.winner).toLowerCase() : "";
  switch (result.reason) {
    case "stone": return `O mestre ${loser} foi capturado.`;
    case "stream": return `O mestre ${winner} chegou ao templo rival.`;
    case "resign": return `O ${loser} desistiu.`;
    case "timeout": return `O tempo do ${loser} acabou.`;
    case "repetition": return "A mesma posição, com as mesmas cartas, apareceu três vezes.";
    default: return "";
  }
}

function showResult({ title, status, icon, winnerClass }) {
  ended = true;
  activeClock = null;
  clearInterval(clockTimer);
  clockTimer = 0;
  clearSelection();
  renderClocks();
  renderHands();
  els.resign.disabled = true;
  els.resign.textContent = "Desistir";
  els.status.textContent = status;
  els.resultTitle.textContent = title;
  els.resultIcon.textContent = icon;
  els.resultIcon.className = "result-icon" + (winnerClass ? " " + winnerClass : "");
}

function finish(result) {
  if (!els.result.hidden) return;
  const who = result.winner ? label(result.winner) : "";
  showResult({
    title: result.winner ? `${who} venceu` : "Empate",
    status: result.winner ? `${who} venceu — ${RESULT_LABELS[result.reason] ?? ""}.` : `Empate — ${RESULT_LABELS[result.reason] ?? ""}.`,
    icon: result.winner ? "♛" : "½",
    winnerClass: result.winner,
  });
  els.resultReason.textContent = resultReason(result);
  els.result.hidden = false;
  els.rematch.focus();
}

function finishOnline() {
  if (!online || !game.result.over || !els.result.hidden) return;
  const result = game.result;
  const outcome = online.outcome;
  const opp = online.opponent()?.nickname || "Oponente";
  clocks = online.clocks();

  showResult({
    title: outcome === "win" ? "Você venceu!" : outcome === "lose" ? `${opp} venceu` : "Empate",
    status: outcome === "win" ? "Você venceu!" : outcome === "lose" ? `${opp} venceu.` : "Empate.",
    icon: outcome === "draw" ? "½" : "♛",
    winnerClass: outcome === "draw" ? "" : (result.winner || viewColor),
  });
  els.resultReason.textContent = resultReason(result);
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
  game = newGame(dealCards(Math.random));          // hot-seat: o sorteio local não vale ranking
  viewColor = settings.color === "r" ? "r" : "b";
  clocks = { b: settings.minutes * 60000, r: settings.minutes * 60000 };
  ended = false;
  animatingMove = null;
  clearSelection();
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
  els.result.hidden = true;
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
    noticeSetup("Escolha o ritmo e o lado e clique em “Criar sala online”. O código aparece na sala para você convidar o amigo.");
  }
  resumeActiveRoom();
}
