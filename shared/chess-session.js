/* Sessão do xadrez 1×1 (sem DOM) — lobby, polling, relógios e lances.
   A Edge + o Postgres são a autoridade: aqui só pedimos (create/join/ready/state/move/resign),
   escutamos o Realtime (espelho) e calculamos o relógio entre uma resposta e outra.
   Nada de vitória decidida no cliente. */
import { Cloud } from "./backend/cloud.js";

export const CHESS_POLL_MS = 1500;

/**
 * Relógios no instante `now`: os valores do servidor valem em `clockAt` (o `serverNow` do payload).
 * Só o lado da vez desconta o tempo; o outro fica parado. Durante a contagem (`startsAt` no futuro)
 * nada é descontado: o relógio só começa a correr na largada.
 */
export function clocksAt(chess, { status, clockAt, startsAt = null, now = Date.now(), serverOffset = 0 } = {}) {
  const out = { w: Math.max(0, chess?.clocks?.w ?? 0), b: Math.max(0, chess?.clocks?.b ?? 0) };
  if (status !== "running" || !chess?.turn || !clockAt) return out;
  const start = startsAt ? Date.parse(startsAt) : clockAt;
  const elapsed = Math.max(0, now + serverOffset - Math.max(clockAt, start));
  out[chess.turn] = Math.max(0, out[chess.turn] - elapsed);
  return out;
}

/** Milissegundos até a largada (relógio do servidor); 0 quando já começou. */
export const msToStart = (startsAt, { now = Date.now(), serverOffset = 0 } = {}) =>
  startsAt ? Math.max(0, Date.parse(startsAt) - (now + serverOffset)) : 0;

/** Resultado do ponto de vista de `uid`: "idle" | "running" | "win" | "lose" | "draw" | "cancelled". */
export function chessOutcome(state, uid) {
  if (!state) return "idle";
  if (state.status === "cancelled") return "cancelled";
  if (state.status !== "finished") return "running";
  if (!state.winner) return "draw";
  return state.winner.user_id === uid ? "win" : "lose";
}

/**
 * Cria a sessão de xadrez.
 * @param {object} opts
 * @param {object} opts.cloud  Cloud (injetável nos testes)
 * @param {number} opts.pollMs intervalo do polling de `chess_state` (0 desliga)
 * @param {() => number} opts.now relógio do cliente (injetável nos testes)
 */
export function createChessSession({ cloud = Cloud, pollMs = CHESS_POLL_MS, now = () => Date.now() } = {}) {
  const listeners = new Map();
  let id = null, code = null, status = "idle", startsAt = null, serverOffset = 0, isOpen = true;
  let players = [], winner = null, chess = null;
  let colors = { white: null, black: null }, myColor = null;
  let clockAt = 0, finished = false, destroyed = false;
  let channel = null, pollTimer = null;

  const emit = (type, detail) => { for (const fn of listeners.get(type) ?? []) fn(detail); };
  /** Escuta um evento; devolve a função que cancela a escuta. */
  const on = (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type)?.delete(fn);
  };
  const me = () => players.find(p => p.is_me) ?? null;
  const opponent = () => players.find(p => !p.is_me) ?? null;
  const myUid = () => cloud.uid ?? null;

  function apply(data) {
    if (!data || typeof data !== "object") return;
    if (data.id) id = data.id;
    if (data.code) code = data.code;
    if (data.status) status = data.status;
    if (data.startsAt !== undefined) startsAt = data.startsAt;
    if ("open" in data) isOpen = data.open !== false;
    if (Array.isArray(data.players)) players = data.players;
    if ("winner" in data) winner = data.winner;
    if (data.serverNow) {
      serverOffset = Date.parse(data.serverNow) - now();
      clockAt = Date.parse(data.serverNow);
    }
    if (data.chess) {
      chess = data.chess;
      colors = data.chess.colors ?? colors;
      myColor = colors.white && colors.white === myUid() ? "w"
        : colors.black && colors.black === myUid() ? "b" : null;
    }
    if (status === "finished" || status === "cancelled") settle();
  }

  function settle() {
    if (finished) return;
    if (status !== "finished" && status !== "cancelled") return;
    finished = true;
    stopPoll();
    emit("finished", { state: state(), outcome: chessOutcome(state(), myUid()) });
  }

  function stopPoll() {
    clearTimeout(pollTimer);
    pollTimer = null;
  }

  function schedulePoll() {
    if (!pollMs || destroyed || finished) return;
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      try { await refresh(); } catch { /* rede oscilou: o próximo ciclo tenta de novo */ }
      schedulePoll();
    }, pollMs);
  }

  function send(event, payload) {
    try { channel?.send?.({ type: "broadcast", event, payload }); } catch { /* Realtime é só espelho */ }
  }

  function openChannel() {
    if (channel || !id) return;
    let ch;
    try { ch = cloud.channel?.(cloud.duelTopic(id), { config: { private: true } }); } catch { return; }
    if (!ch) return;
    channel = ch;
    const ping = () => { refresh().catch(() => {}); };
    ch.on?.("broadcast", { event: "move" }, ping);
    ch.on?.("broadcast", { event: "ready" }, ping);
    ch.on?.("broadcast", { event: "resign" }, ping);
    ch.subscribe?.(s => { if (s === "SUBSCRIBED") ch.track?.({ uid: myUid() }); });
  }

  async function create(minutes, color, open = true) {
    const data = await cloud.chessCreate(minutes, color, open);
    apply(data);
    openChannel();
    emit("lobby", data);
    schedulePoll();
    return data;
  }

  async function join(invite) {
    const data = await cloud.duelJoin(invite);
    apply(data);
    openChannel();
    emit("lobby", data);
    await refresh();                 // o duel_join é genérico; o estado do xadrez vem daqui
    schedulePoll();
    return data;
  }

  async function attach(duelId) {
    id = duelId;
    openChannel();
    await refresh();
    schedulePoll();
    return state;
  }

  async function ready() {
    const data = await cloud.duelReady(id);
    apply(data);
    send("ready", { uid: myUid() });
    emit("ready", data);
    await refresh();
    schedulePoll();
    return data;
  }

  async function refresh() {
    if (!id || destroyed) return null;
    const data = await cloud.chessState(id);
    apply(data);
    emit("state", data);
    return data;
  }

  /** Envia um lance (a Edge valida; o Postgres confere vez/relógio/versão). */
  async function move(move) {
    const data = await cloud.chessMove(id, move);
    apply(data);
    send("move", { uid: myUid(), version: data?.chess?.version });
    emit("move", data);
    schedulePoll();
    return data;
  }

  async function resign() {
    const data = await cloud.chessResign(id);
    apply(data);
    send("resign", { uid: myUid() });
    emit("resign", data);
    return data;
  }

  async function leave() {
    if (!id) return null;
    const data = await cloud.duelLeave(id);
    emit("left", data);
    destroy();
    return data;
  }

  function destroy() {
    destroyed = true;
    stopPoll();
    try { channel?.unsubscribe?.(); } catch { /* canal já caiu */ }
    channel = null;
    listeners.clear();
  }

  const state = () => ({
    id, code, status, startsAt, serverOffset, players, winner, chess, colors, myColor,
  });

  return {
    on, create, join, attach, ready, refresh, move, resign, leave, destroy, me, opponent,
    get id() { return id; },
    get code() { return code; },
    get status() { return status; },
    /** Sala aberta (entra pela lista) ou fechada (só pelo código). */
    get open() { return isOpen; },
    get startsAt() { return startsAt; },
    get serverOffset() { return serverOffset; },
    get clockAt() { return clockAt; },
    get players() { return players; },
    get winner() { return winner; },
    get chess() { return chess; },
    get colors() { return colors; },
    get myColor() { return myColor; },
    get state() { return state(); },
    get outcome() { return chessOutcome(state(), myUid()); },
    /** Relógios exibidos agora (o da vez desconta o tempo desde a última resposta). */
    clocks(nowMs = now()) { return clocksAt(chess, { status, clockAt, startsAt, now: nowMs, serverOffset }); },
    msToStart(nowMs = now()) { return msToStart(startsAt, { now: nowMs, serverOffset }); },
    isMyTurn(nowMs = now()) {
      return status === "running" && Boolean(myColor) && chess?.turn === myColor && this.msToStart(nowMs) === 0;
    },
  };
}
