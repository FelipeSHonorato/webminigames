/* Sessão de uma partida com 2+ jogadores (sem DOM) — lobby, polling, largada, vez e lances.
   A Edge + o Postgres são a autoridade: aqui só pedimos (create/join/ready/start/state/move/leave), escutamos o
   Realtime (espelho) e calculamos contagem e tempo da vez entre uma resposta e outra. Nenhum resultado é decidido aqui.

   Uso típico num jogo:
     const session = createPartySession();
     session.on("lobby", render); session.on("state", render);
     session.on("start", () => mostrarTabuleiro(session.view));      // contagem acabou
     session.on("move", () => pintar(session.view));                  // inclui lances dos outros (polling/Realtime)
     session.on("finished", ({ outcome, standings }) => ...);
     await session.create("meujogo", { maxPlayers: 4 });              // ou session.join(código) / session.attach(id)
   `session.view` é a visão DO SEU ASSENTO (a Edge nunca manda o estado inteiro). */
import { Cloud } from "./backend/cloud.js";
import { lobbyStatus, msUntil, partyOutcome, standings } from "./party.js";

export const PARTY_POLL_MS = 1500;

export function createPartySession({ cloud = Cloud, pollMs = PARTY_POLL_MS, now = () => Date.now() } = {}) {
  const listeners = new Map();
  let room = null;               // último JSON da sala (party_json + `view`)
  let view = null;               // visão do meu assento (domínio do jogo)
  let serverOffset = 0;
  let started = false, finished = false, destroyed = false;
  let channel = null, pollTimer = null, startTimer = null;

  const emit = (type, detail) => { for (const fn of [...(listeners.get(type) ?? [])]) fn(detail); };
  /** Escuta um evento; devolve a função que cancela a escuta. */
  const on = (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type)?.delete(fn);
  };
  const myUid = () => cloud.uid ?? null;
  const players = () => room?.players ?? [];
  const me = () => players().find(p => p.is_me) ?? null;

  function apply(data) {
    if (!data || typeof data !== "object" || !data.id) return;
    room = { ...(room ?? {}), ...data };
    if ("view" in data) view = data.view;
    if (data.serverNow) serverOffset = Date.parse(data.serverNow) - now();
    checkStart();
    if (room.status === "finished" || room.status === "cancelled") settle();
  }

  /** "start" sai uma vez: a partida está rodando, a contagem acabou e já temos a visão do meu assento. */
  function checkStart() {
    if (started || room?.status !== "running") return;
    const wait = msToStart();
    if (wait > 0) {
      clearTimeout(startTimer);
      if (!destroyed) startTimer = setTimeout(() => { refresh().catch(() => {}); }, wait + 40);
      emit("countdown", { msLeft: wait });
      return;
    }
    if (view == null) return;   // a próxima resposta (com `view`) dispara a largada
    started = true;
    emit("start", { view, room });
  }

  function settle() {
    if (finished) return;
    finished = true;
    stopPoll();
    emit("finished", { room, outcome: outcome(), standings: standings(room) });
  }

  function stopPoll() { clearTimeout(pollTimer); pollTimer = null; }

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
    if (channel || !room?.id) return;
    let ch;
    try { ch = cloud.channel?.(cloud.duelTopic(room.id), { config: { private: true } }); } catch { return; }
    if (!ch) return;
    channel = ch;
    const ping = () => { refresh().catch(() => {}); };
    for (const event of ["join", "ready", "start", "move", "leave"]) ch.on?.("broadcast", { event }, ping);
    ch.subscribe?.(s => { if (s === "SUBSCRIBED") ch.track?.({ uid: myUid() }); });
  }

  async function enter(data, { poll = true } = {}) {
    apply(data);
    openChannel();
    emit("lobby", data);
    if (poll) schedulePoll();
    return data;
  }

  /** Cria a sala. `options`: { minPlayers, maxPlayers, turnSeconds, open } (a Edge limita ao contrato do jogo). */
  async function create(game, options = {}) {
    return enter(await cloud.partyCreate(game, options));
  }

  /** Entra por código (pode ser sala party mesmo vindo do `duelJoin` genérico: a Edge desvia). */
  async function join(code) {
    return enter(await cloud.partyJoin(code));
  }

  /** Entra pela lista de Salas Online. */
  async function joinRoom(duel) {
    return enter(await cloud.partyJoinRoom(duel));
  }

  /** Retoma uma sala em que já estou (página recarregada, `duel_mine`). */
  async function attach(duel) {
    room = { ...(room ?? {}), id: duel };
    openChannel();
    await refresh();
    schedulePoll();
    return state();
  }

  async function refresh() {
    if (!room?.id || destroyed) return null;
    let data;
    try {
      data = await cloud.partyState(room.id);
    } catch (e) {
      /* Fui expulso (ou a sala sumiu) enquanto esperava: avisa uma vez e encerra a sessão. */
      if (e?.code === "not_member" && room.status === "waiting" && !destroyed) {
        emit("kicked", { room });
        destroy();
        return null;
      }
      throw e;
    }
    apply(data);
    emit("state", data);
    if (started && data?.party) emit("move", data);
    return data;
  }

  /** Marca (ou desmarca) "estou pronto". Sala lotada e todos prontos: a Edge larga sozinha. */
  async function ready(flag = true) {
    const data = await cloud.partyReady(room.id, flag);
    apply(data);
    send("ready", { uid: myUid() });
    emit("ready", data);
    schedulePoll();
    return data;
  }

  /** Só o criador, com todos prontos e o mínimo de jogadores. */
  async function start() {
    const data = await cloud.partyStart(room.id);
    apply(data);
    send("start", { uid: myUid() });
    emit("lobby", data);
    schedulePoll();
    return data;
  }

  /** Envia um lance (a Edge valida com o domínio; o Postgres confere assento, vez e versão). */
  async function move(input) {
    const data = await cloud.partyMove(room.id, input);
    apply(data);
    send("move", { uid: myUid(), version: data?.party?.version });
    emit("move", data);
    schedulePoll();
    return data;
  }

  /** Sai da sala. Na espera libera a vaga (o criador passa o comando); em jogo equivale a desistir. */
  async function leave() {
    if (!room?.id) return null;
    const data = await cloud.partyLeave(room.id);
    send("leave", { uid: myUid() });
    emit("left", data);
    destroy();
    return data;
  }

  /** Desiste da partida em andamento (você é eliminado; a sessão continua para ver o resultado). */
  async function resign() {
    const data = await cloud.partyResign(room.id);
    apply(data);
    send("leave", { uid: myUid() });
    emit("resign", data);
    schedulePoll();
    return data;
  }

  /** Criador: remove um convidado da sala em espera. */
  async function kick(userId) {
    const data = await cloud.partyKick(room.id, userId);
    apply(data);
    send("leave", { uid: myUid() });
    emit("lobby", data);
    return data;
  }

  /** Criador: cancela a sala inteira (só na espera). */
  async function cancel() {
    const data = await cloud.partyCancel(room.id);
    emit("left", data);
    destroy();
    return data;
  }

  function destroy() {
    destroyed = true;
    stopPoll();
    clearTimeout(startTimer);
    try { channel?.unsubscribe?.(); } catch { /* canal já caiu */ }
    channel = null;
    listeners.clear();
  }

  const msToStart = (nowMs = now()) => msUntil(room?.startsAt, nowMs, serverOffset);
  const state = () => ({ room, view });
  const outcome = () => partyOutcome(room, myUid());

  return {
    on, create, join, joinRoom, attach, ready, start, refresh, move, resign, leave, kick, cancel, destroy, me,
    get id() { return room?.id ?? null; },
    get code() { return room?.code ?? null; },
    get gameId() { return room?.gameId ?? null; },
    get status() { return room?.status ?? "idle"; },
    get room() { return room; },
    /** A visão do SEU assento (mão, tabuleiro, o que o domínio deixa você ver). `null` antes da largada. */
    get view() { return view; },
    get players() { return players(); },
    get open() { return room?.open !== false; },
    get minPlayers() { return room?.minPlayers ?? 2; },
    get maxPlayers() { return room?.maxPlayers ?? 2; },
    get mySeat() { return room?.mySeat ?? null; },
    get startsAt() { return room?.startsAt ?? null; },
    get serverOffset() { return serverOffset; },
    get party() { return room?.party ?? null; },
    get ranking() { return room?.party?.ranking ?? null; },
    get winner() { return room?.winner ?? null; },
    get cancelReason() { return room?.cancelReason ?? null; },
    get started() { return started; },
    get outcome() { return outcome(); },
    get standings() { return standings(room); },
    /** Lobby: quantos faltam, quem não está pronto, se EU posso iniciar. */
    get lobby() { return lobbyStatus(room); },
    isHost() { return Boolean(room?.createdBy) && room.createdBy === myUid(); },
    /** Assento da vez (`null` no modo livre ou fora de jogo). */
    get turnSeat() { return room?.party?.turnSeat ?? null; },
    /** Quem joga agora (jogador da vez). */
    turnPlayer() { return players().find(p => p.seat === room?.party?.turnSeat) ?? null; },
    /** Posso jogar agora? Modo livre: qualquer ativo; vez a vez: só o assento da vez. */
    canPlay(nowMs = now()) {
      if (room?.status !== "running" || !started || msToStart(nowMs) > 0) return false;
      const mine = me();
      if (!mine || mine.out) return false;
      return room.party?.order === "free" || room.party?.turnSeat === mine.seat;
    },
    msToStart,
    /** Milissegundos que faltam para estourar a vez (`null` sem limite de tempo). */
    msToTurnEnd(nowMs = now()) {
      const end = room?.party?.turnEndsAt;
      return end ? msUntil(end, nowMs, serverOffset) : null;
    },
  };
}
