/* Sessão de duelo 1×1 (sem DOM) — compartilhada pelos jogos feitos PARA o modo duelo.
   A Edge + o Postgres são a autoridade: aqui só pedimos (create/join/ready/start/finish) e escutamos.
   O Realtime é um espelho visual: leva o progresso do oponente e avisa quando ele termina; se o canal
   cair, o polling de `duel_state` continua dando status e vencedor. Nada de vitória decidida no cliente. */
import { Cloud } from "./backend/cloud.js";

export const DEFAULT_POLL_MS = 2500;
const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));

/** Resultado do ponto de vista de `uid`: "idle" | "running" | "win" | "lose" | "draw" | "cancelled". */
export function duelOutcome(state, uid) {
  if (!state) return "idle";
  if (state.status === "cancelled") return "cancelled";
  if (state.status !== "finished") return "running";
  if (!state.winner) return "draw";
  return state.winner.user_id === uid ? "win" : "lose";
}

/** Milissegundos até um instante ISO, já corrigidos pelo relógio do servidor (`serverOffset` em ms). */
export const msUntil = (iso, now = Date.now(), serverOffset = 0) =>
  iso ? Math.max(0, Date.parse(iso) - (now + serverOffset)) : 0;

/**
 * Cria a sessão de um duelo.
 * @param {object} opts
 * @param {string|null} opts.game    jogo que declara DUEL (obrigatório para criar)
 * @param {number} opts.level        nível do cenário (o servidor valida)
 * @param {object} opts.cloud        Cloud (injetável nos testes)
 * @param {number} opts.pollMs        intervalo do polling de `duel_state` (0 desliga)
 * @param {boolean} opts.autoStart    começar sozinho quando a contagem chega a zero
 * @param {() => number} opts.now     relógio do cliente (injetável nos testes)
 */
export function createDuelSession({
  game = null, level = 0, cloud = Cloud,
  pollMs = DEFAULT_POLL_MS, autoStart = true, now = () => Date.now(),
} = {}) {
  const listeners = new Map();
  let id = null, code = null, gameId = game, status = "idle", rule = null, maxSeconds = null;
  let players = [], winner = null, state = null, puzzle = null;
  let startsAt = null, serverOffset = 0;
  let myProgress = 0, opponentProgress = 0;
  let channel = null, pollTimer = null, startTimer = null, countdownTimer = null;
  let finished = false, destroyed = false;

  const emit = (type, detail) => { for (const fn of listeners.get(type) ?? []) fn(detail); };
  /** Escuta um evento; devolve a função que cancela a escuta. */
  const on = (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type)?.delete(fn);
  };
  const myUid = () => cloud.uid ?? null;
  const me = () => players.find(p => p.is_me) ?? null;
  const opponent = () => players.find(p => !p.is_me) ?? null;

  function apply(data) {
    if (!data || typeof data !== "object") return;
    if (data.id) id = data.id;
    if (data.code) code = data.code;
    if (data.gameId) gameId = data.gameId;
    if (data.level != null) level = data.level;
    if (data.rule) rule = data.rule;
    if (data.maxSeconds != null) maxSeconds = data.maxSeconds;
    if (data.status) status = data.status;
    if (data.startsAt !== undefined) startsAt = data.startsAt;
    if (Array.isArray(data.players)) players = data.players;
    if ("winner" in data) winner = data.winner;
    /* O relógio do servidor manda: guarda a diferença para a contagem não adiantar/atrasar. */
    if (data.serverNow) serverOffset = Date.parse(data.serverNow) - now();
    state = { ...(state ?? {}), ...data };
  }

  function stopTimers() {
    clearTimeout(pollTimer); clearTimeout(startTimer); clearInterval(countdownTimer);
    pollTimer = startTimer = countdownTimer = null;
  }

  function schedulePoll() {
    if (!pollMs || destroyed || finished) return;
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      try { await refresh(); } catch { /* rede oscilou: o próximo ciclo tenta de novo */ }
      schedulePoll();
    }, pollMs);
  }

  /** Fecha a sessão uma única vez quando o servidor diz que acabou (ou cancelou). */
  function settle() {
    if (finished) return;
    if (status !== "finished" && status !== "cancelled") return;
    finished = true;
    stopTimers();
    emit("finished", { state, outcome: duelOutcome(state, myUid()) });
  }

  function send(event, payload) {
    try { channel?.send?.({ type: "broadcast", event, payload }); } catch { /* Realtime é só espelho */ }
  }

  /** Canal do duelo: progresso do oponente, aviso de "terminei" e de "pronto". */
  function openChannel() {
    if (channel || !id) return;
    let ch;
    try { ch = cloud.channel?.(cloud.duelTopic(id), { config: { private: true } }); } catch { return; }
    if (!ch) return;
    channel = ch;
    ch.on?.("broadcast", { event: "progress" }, msg => {
      const p = msg?.payload;
      if (!p || p.uid === myUid()) return;
      opponentProgress = clamp01(p.value);
      emit("opponent", { uid: p.uid, value: opponentProgress });
    });
    ch.on?.("broadcast", { event: "finish" }, msg => { if (msg?.payload?.uid !== myUid()) refresh().catch(() => {}); });
    ch.on?.("broadcast", { event: "ready" }, () => refresh().catch(() => {}));
    ch.subscribe?.(s => { if (s === "SUBSCRIBED") ch.track?.({ uid: myUid() }); });
  }

  /** Prepara a largada: conta até `startsAt` (relógio do servidor) e então pede o puzzle. */
  function armStart() {
    clearTimeout(startTimer); clearInterval(countdownTimer);
    startTimer = countdownTimer = null;
    const left = msUntil(startsAt, now(), serverOffset);
    emit("countdown", { msLeft: left, startsAt });
    if (!autoStart) return;
    if (left <= 0) { begin().catch(() => {}); return; }
    countdownTimer = setInterval(() => {
      const msLeft = msUntil(startsAt, now(), serverOffset);
      emit("countdown", { msLeft, startsAt });
      if (msLeft <= 0) { clearInterval(countdownTimer); countdownTimer = null; }
    }, 250);
    startTimer = setTimeout(() => { begin().catch(() => {}); }, left);
  }

  async function create() {
    const data = await cloud.duelCreate(gameId, level);
    apply(data);
    openChannel();
    emit("lobby", { id, code, rule, maxSeconds, level, gameId });
    schedulePoll();
    return data;
  }

  async function join(invite) {
    const data = await cloud.duelJoin(invite);
    apply(data);
    openChannel();
    emit("lobby", { id, code, rule, maxSeconds, level, gameId, players, opponent: opponent() });
    schedulePoll();
    return data;
  }

  /** "Estou pronto": quando os dois marcam, o servidor fixa `starts_at` e a contagem começa. */
  async function ready() {
    const data = await cloud.duelReady(id);
    apply(data);
    emit("ready", data);
    if (status === "running") armStart();
    return data;
  }

  /** Pede o puzzle (o servidor só entrega depois de `starts_at`). */
  async function begin() {
    if (destroyed || finished || !id) return null;
    clearTimeout(startTimer); clearInterval(countdownTimer);
    startTimer = countdownTimer = null;
    try {
      const data = await cloud.duelStart(id);
      apply(data);
      puzzle = data?.puzzle ?? null;
      emit("start", data);
      schedulePoll();
      return data;
    } catch (e) {
      if (e?.code === "not_started") {                  // relógio do cliente adiantado: tenta de novo em instantes
        startTimer = setTimeout(() => { begin().catch(() => {}); }, 300);
        return null;
      }
      emit("error", e);
      throw e;
    }
  }

  /** Estado atual (reconexão/polling): status, placar e vencedor. */
  async function refresh() {
    if (!id || destroyed) return null;
    const data = await cloud.duelState(id);
    apply(data);
    emit("state", data);
    settle();
    return data;
  }

  /** Finaliza: manda o tabuleiro (a Edge valida) e o Postgres decide. O `op` é reutilizado no reenvio. */
  async function finish(boardState, op) {
    if (!id) throw new Error("no_duel");
    const { ok } = await cloud.duelFinish(id, boardState, op);
    emit("result", ok);
    send("finish", { uid: myUid() });
    try { await refresh(); } catch { /* o polling fecha depois */ }
    return ok;
  }

  async function leave() {
    if (!id) return null;
    const data = await cloud.duelLeave(id);
    emit("left", data);
    destroy();
    return data;
  }

  /** Atualiza a própria barra e transmite para o oponente (0..1). */
  function progress(value) {
    myProgress = clamp01(value);
    send("progress", { uid: myUid(), value: myProgress });
    emit("progress", { mine: true, value: myProgress });
    return myProgress;
  }

  function destroy() {
    destroyed = true;
    stopTimers();
    try { channel?.unsubscribe?.(); } catch { /* canal já caiu */ }
    channel = null;
    listeners.clear();
  }

  return {
    on, create, join, ready, begin, refresh, finish, leave, progress, destroy, me, opponent,
    get id() { return id; },
    get code() { return code; },
    get gameId() { return gameId; },
    get level() { return level; },
    get status() { return status; },
    get rule() { return rule; },
    get maxSeconds() { return maxSeconds; },
    get startsAt() { return startsAt; },
    get players() { return players; },
    get winner() { return winner; },
    get state() { return state; },
    get puzzle() { return puzzle; },
    get myProgress() { return myProgress; },
    get opponentProgress() { return opponentProgress; },
    get outcome() { return duelOutcome(state, myUid()); },
  };
}
