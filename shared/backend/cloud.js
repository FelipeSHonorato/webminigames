import { store, readJSON } from "../storage.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SDK } from "./config.js";
import { PASSWORD_HINT } from "../password.js";

/* ===================== NUVEM (Supabase) =====================
   Ponto de troca dos serviços de shared/ (Coins, Run, Scores, Profile, GameSwitch, Progress, AdminLevel) e de js/auth.js.
   Quando o Supabase está configurado, os dados do jogador são carregados UMA vez ao abrir a página (`start`) para um cache em
   memória: a leitura continua síncrona (os jogos leem coins, fase e nível sem esperar a rede) e as escritas seguem para o
   servidor em segundo plano. Pontos, vitórias, nível, coins e o PRÓPRIO puzzle são decididos pelo servidor (supabase/migrations
   + Edge Function "play"): o navegador só pede (open/hint/finish) e guarda a resposta; sem a seed do servidor, não há como
   derivar a solução. Sem Supabase configurado, `start` não faz nada e tudo roda local. */

const SESSION_KEY = "wmg.session", OUTBOX_KEY = "wmg.outbox";
const RUN_DELAY_MS = 700, RETRY_MS = 5000;
const empty = () => ({ profile: null, config: { coinsPerDay: 2 }, wins: {}, runs: {}, phases: {}, coins: {}, scores: {}, activity: {}, games: {}, daily: {} });
const fresh = () => ({ active: false, client: null, uid: null, degraded: false, reason: null, cache: empty(), dirty: new Set(), removed: new Set(), timer: null, runLock: null, outboxTimer: null, outboxLock: null, wired: false });
let S = fresh();

export const isConfigured = (url = SUPABASE_URL, key = SUPABASE_ANON_KEY) => Boolean(url && key);

/** Requisições de escrita pequenas usam keepalive: ainda saem se a aba for fechada logo depois de uma jogada. */
const keepaliveFetch = (url, init = {}) =>
  fetch(url, init.method && init.method !== "GET" && typeof init.body === "string" && init.body.length < 60000 ? { ...init, keepalive: true } : init);

async function makeClient() {
  const { createClient } = await import(SUPABASE_SDK);
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }, global: { fetch: keepaliveFetch } });
}

/** Mensagens em pt-BR para os erros de login/cadastro do Supabase Auth. */
export function authErrorMessage(error) {
  const code = error?.code ?? "", msg = String(error?.message ?? "");
  if (["user_already_exists", "email_exists"].includes(code)) return "Já existe uma conta com este e-mail. Use a aba Entrar.";
  if (code === "invalid_credentials") return "E-mail ou senha incorretos.";
  if (code === "email_not_confirmed") return "Confirme seu e-mail antes de entrar: procure o link na sua caixa de entrada.";
  if (code === "weak_password") return PASSWORD_HINT;
  if (code === "otp_expired") return "Este link expirou ou já foi usado. Peça um novo e-mail de confirmação.";
  if (code === "same_password") return "A nova senha deve ser diferente da atual.";
  if (["over_request_rate_limit", "over_email_send_rate_limit"].includes(code) || error?.status === 429) return "Muitas tentativas. Aguarde alguns minutos e tente de novo.";
  if (code === "signup_disabled") return "Os cadastros estão desativados neste momento.";
  if (code === "validation_failed" || code === "email_address_invalid") return "Digite um e-mail válido.";
  if (error?.name === "AuthRetryableFetchError" || /failed to fetch|networkerror|load failed/i.test(msg)) return "Sem conexão com o servidor. Verifique a internet e tente de novo.";
  return "Não foi possível concluir. Tente de novo em instantes.";
}

/** Erro que reenviar a mesma vitória não resolve (regra violada): sai da fila em vez de ficar tentando para sempre. */
export const isPermanent = error => ["22023", "23503", "42501", "28000"].includes(error?.code);
/** Erro passageiro (rede) ou ritmo: mantém na fila e tenta mais tarde. */
const isRetryable = error => !error?.status || error?.code === "too_fast";

const providerOf = user => (user?.app_metadata?.provider === "google" ? "google" : "password");
const sessionOf = (user, profile) => ({ id: user.id, name: profile.name, provider: providerOf(user), region: profile.region ?? null, role: profile.role ?? "user", email: user.email ?? null });
const writeSession = session => store.set(SESSION_KEY, JSON.stringify(session));
const degrade = e => { S.degraded = true; S.reason = e; console.warn("[WebMiniGames] Supabase indisponível:", e?.message ?? e); };

/** Erro da Edge Function "play": normaliza { status, code } a partir da resposta JSON ({ error }). */
async function edgeError(error) {
  let code = error?.message ?? "edge_error", status = error?.context?.status ?? error?.status ?? 0;
  try { const body = await error?.context?.json?.(); if (body?.error) code = body.error; } catch { /* corpo sem JSON */ }
  const e = new Error(code); e.code = code; e.status = status; return e;
}
/** Chama a Edge Function: ela decide o nível, cobra o coin, valida o tabuleiro e só então pontua. */
async function invoke(action, body) {
  const { data, error } = await S.client.functions.invoke("play", { body: { action, ...body } });
  if (error) throw await edgeError(error);
  return data;
}

async function loadGames() {
  const { data, error } = await S.client.from("games").select("id,enabled");
  if (error) throw error;
  return Object.fromEntries(data.map(g => [g.id, g.enabled]));
}

/** Carrega tudo do jogador de uma vez (uma chamada) e grava a sessão espelho usada pelo resto do site. */
async function loadUser(user, gamesPromise = loadGames()) {
  const [snap, games] = await Promise.all([S.client.rpc("my_snapshot").then(r => { if (r.error) throw r.error; return r.data; }), gamesPromise]);
  if (!snap?.profile) throw new Error("Perfil da conta não encontrado (veja docs/SUPABASE.md, seção de contas antigas).");
  S.cache = { ...empty(), ...snap, games };
  S.uid = user.id;
  const session = sessionOf(user, snap.profile);
  writeSession(session);
  await flushOutbox();
  return session;
}

function resetUser() {
  clearTimeout(S.timer); clearTimeout(S.outboxTimer);
  Object.assign(S, { uid: null, cache: { ...empty(), games: S.cache.games }, dirty: new Set(), removed: new Set(), timer: null, outboxTimer: null });
}

/* ----- Fase salva: grava em segundo plano (junta jogadas seguidas) ----- */
function scheduleRuns(delay = RUN_DELAY_MS) { clearTimeout(S.timer); S.timer = setTimeout(() => { flushRuns(); }, delay); }
function flushRuns() {
  clearTimeout(S.timer); S.timer = null;
  S.runLock = (S.runLock ?? Promise.resolve()).then(async () => {
    if (!S.client || S.uid === null || S.degraded) return;
    let failed = false;
    for (const g of [...S.dirty]) {
      S.dirty.delete(g);
      if (!(g in S.cache.runs)) continue;
      const { error } = await S.client.from("runs").upsert({ user_id: S.uid, game_id: g, state: S.cache.runs[g] }, { onConflict: "user_id,game_id" });
      if (error) { S.dirty.add(g); failed = true; console.warn("[WebMiniGames] não salvou a fase:", error.message); }
    }
    for (const g of [...S.removed]) {
      S.removed.delete(g);
      const { error } = await S.client.from("runs").delete().eq("user_id", S.uid).eq("game_id", g);
      if (error) { S.removed.add(g); failed = true; }
    }
    if (failed) scheduleRuns(RETRY_MS);
  });
  return S.runLock;
}

/* ----- Vitórias: a Edge Function valida o tabuleiro (com a seed secreta) e só então pontua.
   A fila no navegador guarda o TABULEIRO resolvido; cada pedido leva um id único, então reenviar nunca conta em dobro. ----- */
const readOutbox = () => readJSON(OUTBOX_KEY, []);
const writeOutbox = list => store.set(OUTBOX_KEY, JSON.stringify(list));
function applyWin(game, data) {
  S.cache.wins[game] = data.wins; S.cache.scores[game] = data.score; S.cache.coins[game] = data.coins;
  delete S.cache.phases[game];   // a fase foi consumida (ou já estava): não há o que retomar
}
const emptyDaily = () => ({ day: null, level: 0, coins: 0, slots: 2, maxCoins: 60, results: {}, pending: [], open: [], history: {}, levels: {}, stats: {}, statsByDay: {} });
const byDaySlot = (a, b) => String(a.day).localeCompare(String(b.day)) || a.slot - b.slot;
const dropEntry = (list, day, slot) => (list ?? []).filter(x => !(x.day === day && x.slot === slot));

/** Resultado do desafio diário: guarda os tickets/cenários, o melhor tempo por (dia, slot), os troféus e a progressão. */
function applyDaily(game, day, slot, data) {
  const g = (S.cache.daily[game] ??= emptyDaily());
  const d = String(data?.day ?? day ?? g.day ?? "");
  if (data?.coins != null) g.coins = data.coins;
  if (data?.slots != null) g.slots = data.slots;
  if (d && data?.level != null) g.levels[d] = data.level;
  g.pending = dropEntry(g.pending, d, slot);
  g.open = dropEntry(g.open, d, slot);
  if (d) {
    (g.history[d] ??= {});
    if (data?.seconds != null) g.history[d][slot] = Math.min(g.history[d][slot] ?? Infinity, data.seconds);
    if (d === g.day) {
      g.results[slot] = g.history[d][slot];
      g.levels[d] ??= data?.level;
    }
  }
  if (data?.stats) {                                                   // troféus do cenário (percentual, média, região)
    (g.statsByDay[d] ??= {})[slot] = data.stats;
    if (d === g.day) (g.stats ??= {})[slot] = data.stats;
  }
  if (data?.wins != null) S.cache.wins[game] = data.wins;              // concluir o cenário do dia também pontua/progride
  if (data?.score) S.cache.scores[game] = data.score;
}
function scheduleOutboxRetry() { clearTimeout(S.outboxTimer); S.outboxTimer = setTimeout(() => { S.outboxTimer = null; flushOutbox(); }, RETRY_MS); }
function flushOutbox() {
  S.outboxLock = (S.outboxLock ?? Promise.resolve()).then(async () => {
    if (!S.client || S.uid === null || S.degraded) return null;
    let last = null;
    for (;;) {
      const item = readOutbox().find(i => i.uid === S.uid);
      if (!item) return last;
      let data = null;
      try {
        data = item.slot
          ? await invoke("daily_finish", { game: item.game, day: item.day ?? null, slot: item.slot, state: item.state, op: item.op })
          : await invoke("finish", { game: item.game, state: item.state, op: item.op });
      } catch (e) {
        if (isRetryable(e)) { console.warn("[WebMiniGames] vitória na fila (será reenviada):", e.code); scheduleOutboxRetry(); return last; }
        console.warn("[WebMiniGames] vitória recusada:", e.code);   // tabuleiro inválido / sem fase: sai da fila
      }
      writeOutbox(readOutbox().filter(i => i.op !== item.op));
      if (data) { if (item.slot) applyDaily(item.game, item.day, item.slot, data); else applyWin(item.game, data); last = data.score ?? data.seconds; }
    }
  });
  return S.outboxLock;
}

function wire() {
  if (S.wired || typeof document === "undefined") return;
  S.wired = true;
  const flushAll = () => { if (S.uid !== null) { flushRuns(); flushOutbox(); } };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushAll(); });
  addEventListener("pagehide", flushAll);
  addEventListener("online", flushAll);
  S.client?.auth.onAuthStateChange?.(event => {            // saiu em outra aba: esta aba também deixa de ser a do jogador
    if (event === "SIGNED_OUT" && S.uid !== null) { resetUser(); store.set(SESSION_KEY, "null"); location.reload(); }
  });
}

export const Cloud = {
  get active() { return S.active; },
  get degraded() { return S.degraded; },
  get uid() { return S.uid; },
  /** O dono dos dados é este usuário da nuvem? (anônimos e o modo local usam o armazenamento do navegador) */
  owns: uid => S.active && S.uid !== null && S.uid === uid,
  client: () => S.client,
  role: () => S.cache.profile?.role ?? "user",

  /** Chamado uma vez por página (shared/backend/boot.js). Sem Supabase configurado, não faz nada.
      `url`/`key` existem para os testes forçarem o modo local sem mexer em shared/backend/config.js. */
  async start({ client, url = SUPABASE_URL, key = SUPABASE_ANON_KEY } = {}) {
    if (S.active) return S;
    if (!client && !isConfigured(url, key)) return null;
    S.active = true;
    try {
      S.client = client ?? await makeClient();
      const { data, error } = await S.client.auth.getSession();           // também conclui o retorno do login com Google
      if (error) throw error;
      const games = loadGames();
      if (data.session) await loadUser(data.session.user, games);
      else {
        S.cache.games = await games;
        const mirror = readJSON(SESSION_KEY, null);
        if (mirror && mirror.provider !== "anonymous") store.set(SESSION_KEY, "null");   // conta que expirou/saiu em outro lugar
      }
    } catch (e) { degrade(e); }
    wire();
    return S;
  },

  /** Depois de entrar/cadastrar: carrega os dados da conta e devolve a sessão. */
  async adopt(user) { try { return await loadUser(user); } catch (e) { degrade(e); throw e; } },
  async signOut() {
    await Promise.allSettled([flushRuns(), flushOutbox()]);
    const c = S.client;
    resetUser(); store.set(SESSION_KEY, "null");
    await c?.auth.signOut();
  },
  /** Entrar como anônimo: o anônimo é local, então a sessão da nuvem (se houver) é descartada neste navegador. */
  async dropSession() { const c = S.client; resetUser(); await c?.auth.signOut({ scope: "local" }); },
  /** Exclui a própria conta no servidor: apaga a conta e, por cascata, todos os dados dela (LGPD). */
  async deleteAccount() {
    const uid = S.uid;
    const { error } = await S.client.rpc("delete_my_account");
    if (error) throw new Error("Não foi possível excluir a conta agora. Tente de novo.");
    const c = S.client;
    if (uid !== null) writeOutbox(readOutbox().filter(i => i.uid !== uid));   // vitórias pendentes desta conta não têm mais para onde ir
    resetUser(); store.set(SESSION_KEY, "null");
    try { await c?.auth.signOut({ scope: "local" }); } catch { /* a conta já não existe; só limpa a sessão local */ }
  },

  /* ----- leitura (síncrona, do cache) ----- */
  profile: () => S.cache.profile ?? {},
  wins: g => S.cache.wins[g] ?? 0,
  run: g => S.cache.runs[g] ?? null,
  phase: g => S.cache.phases[g] ?? null,
  coinEntry: g => S.cache.coins[g] ?? null,
  scores: () => S.cache.scores,
  activity: () => S.cache.activity,
  gameOn: g => S.cache.games[g] !== false,

  /* ----- escrita ----- */
  setWins(g, n) { S.cache.wins[g] = n; },                                        // só o cache: quem conta vitória é o servidor
  setCoinEntry(g, entry) { S.cache.coins[g] = entry; },
  setRun(g, run) { S.cache.runs[g] = run; S.removed.delete(g); S.dirty.add(g); scheduleRuns(); },
  clearRun(g) { delete S.cache.runs[g]; S.dirty.delete(g); S.removed.add(g); scheduleRuns(); },
  flush: () => Promise.all([flushRuns(), flushOutbox()]),

  /* ----- fase servida pelo servidor ----- */
  /** Abre a fase: o servidor escolhe o nível, cobra 1 coin, guarda a seed (secreta) e devolve o puzzle SEM a solução.
      Lança { code: "no_coins" } quando o saldo acabou. */
  async open(game) {
    const d = await invoke("open", { game });
    S.cache.phases[game] = { level: d.level, hints: d.hints, puzzle: d.puzzle };
    if (d.coins) S.cache.coins[game] = d.coins;
    return d;
  },
  /** Pede uma dica: o servidor conta (e devolve o novo total). O conteúdo da dica vem no retorno, se houver. */
  async hint(game, state) {
    const d = await invoke("hint", { game, state });
    const p = S.cache.phases[game]; if (p) p.hints = d.hints;
    return d;
  },

  /** Fase servida pelo servidor: a vitória é decidida no servidor (fase aberta com open) e validada por ele
      (o tabuleiro regenerado a partir da seed tem de bater). Cai na fila do navegador até o servidor confirmar. */
  async finish(game, state) {
    writeOutbox([...readOutbox(), { uid: S.uid, game, state, op: crypto.randomUUID() }]);
    return flushOutbox();
  },
  /** Jogada final validada NA HORA (cruzadas): manda e espera a resposta, porque a tela precisa saber se a grade está certa.
      Se for um erro passageiro (rede/ritmo), cai na fila e devolve { pending: true } — a vitória otimista já foi contada; se o
      servidor recusar o tabuleiro, lança o erro para o chamador avisar o jogador. */
  async finishNow(game, state) {
    const item = { uid: S.uid, game, state, op: crypto.randomUUID() };
    try { const data = await invoke("finish", item); applyWin(game, data); return { ok: data }; }
    catch (e) {
      if (isRetryable(e)) { writeOutbox([...readOutbox(), item]); scheduleOutboxRetry(); return { pending: true }; }
      throw e;
    }
  },
  /* ----- desafio diário (tickets acumuláveis; mesmo cenário por dia/nível/slot; tempo nos troféus) ----- */
  daily: g => S.cache.daily[g] ?? null,
  /** Carrega tickets pendentes, tentativas abertas, resultados de hoje e o histórico de todos os jogos. */
  async dailyStatus() {
    if (!S.client || S.degraded || S.uid === null) return S.cache.daily;
    const { data, error } = await S.client.rpc("daily_status");
    if (error) { console.warn("[WebMiniGames] status do dia indisponível:", error.message); return S.cache.daily; }
    const oldDaily = S.cache.daily;
    S.cache.daily = data ?? {};
    for (const [game, info] of Object.entries(S.cache.daily)) {
      const oldStats = oldDaily[game]?.statsByDay ?? {};
      const g = (S.cache.daily[game] = { ...emptyDaily(), ...info });
      g.statsByDay = { ...oldStats };
      if (info?.day && info?.stats) g.statsByDay[info.day] = info.stats;
    }
    return S.cache.daily;
  },
  /** Abre o ticket (dia + slot): recomeça retomando o relógio; atrasado continua contando para o dia original. */
  async dailyOpen(game, day, slot) {
    const d = await invoke("daily_open", { game, day: day ?? null, slot });
    const g = (S.cache.daily[game] ??= emptyDaily());
    if (!g.day) { g.day = d.day; g.level = d.level; }
    g.coins = d.coins; if (d.slots != null) g.slots = d.slots;
    g.levels[d.day] = d.level;
    g.pending = dropEntry(g.pending, d.day, slot);
    if (!g.open.some(x => x.day === d.day && x.slot === slot)) g.open.push({ day: d.day, slot, level: d.level });
    g.open.sort(byDaySlot);
    return d;
  },
  /** Primeiro movimento do cenário: o relógio do servidor (Text Twist) começa a contar daqui. */
  async dailyStart(game, day, slot) {
    return invoke("daily_start", { game, day: day ?? null, slot });
  },
  dailyHint(game, day, slot, state) { return invoke("daily_hint", { game, day: day ?? null, slot, state }); },
  /** Conclui o ticket: o SERVIDOR mede o tempo e guarda o melhor por (dia, slot). */
  async dailyFinish(game, day, slot, state) {
    const item = { uid: S.uid, game, day: day ?? null, slot, state, op: crypto.randomUUID() };
    try { const data = await invoke("daily_finish", item); applyDaily(game, day, slot, data); return { ok: data }; }
    catch (e) {
      if (isRetryable(e)) { writeOutbox([...readOutbox(), item]); scheduleOutboxRetry(); return { pending: true }; }
      throw e;
    }
  },
  /** Ranking por tempo de um dia (mesmo jogo e nível). Qualquer um vê. */
  async dailyLeaderboard(game, level, scope, limit, day = null) {
    if (!S.client || S.degraded) return { top: [], me: null, total: 0 };
    const { data, error } = await S.client.rpc("daily_leaderboard", { p_game: game, p_level: level ?? null, p_scope: scope, p_limit: limit, p_day: day ?? null });
    if (error) { console.warn("[WebMiniGames] ranking do dia indisponível:", error.message); return { top: [], me: null, total: 0 }; }
    return data;
  },

  /* ----- duelos 1×1 (só jogos que declaram DUEL no domínio) -----
     A Edge + Postgres decidem tudo: o cliente pede, o servidor gera o cenário e valida o tabuleiro.
     O Realtime é apenas espelho visual (progresso do oponente e presença). */
  /** Tópico do canal Realtime: um por duelo. A policy do banco libera só para os dois jogadores. */
  duelTopic: duel => `duel:${duel}`,
  /** Cria a sala (código de convite). Devolve { id, code, rule, maxSeconds, level, gameId }. */
  duelCreate(game, level = 0) { return invoke("duel_create", { game, level }); },
  /** Entra pelo código do convite. Devolve a sala com os jogadores e o oponente. */
  duelJoin(code) { return invoke("duel_join", { code }); },
  /** Marca "pronto"; quando os dois marcam, o servidor fixa `starts_at` (contagem regressiva). */
  duelReady(duel) { return invoke("duel_ready", { duel }); },
  /** Só depois de `starts_at` o servidor entrega o puzzle — não dá para resolver durante a contagem. */
  duelStart(duel) { return invoke("duel_start", { duel }); },
  /** Estado para reconexão/polling: status, placar, tempos e vencedor. */
  duelState(duel) { return invoke("duel_state", { duel }); },
  /** Sai da sala: em `waiting` cancela (criador) ou libera a vaga; em `running` conta como desistência. */
  duelLeave(duel) { return invoke("duel_leave", { duel }); },
  /** Finaliza: a Edge valida o tabuleiro e o Postgres decide o vencedor. Reuse o mesmo `op` ao reenviar. */
  async duelFinish(duel, state, op = crypto.randomUUID()) {
    return { ok: await invoke("duel_finish", { duel, state, op }) };
  },
  /** Canal Realtime do duelo (só espelho). Devolve `null` quando a nuvem está desligada/degradada.
      `options` repassa a configuração do SDK (o duelo usa `{ config: { private: true } }`). */
  channel(topic, options) {
    if (!S.client || S.degraded) return null;
    return S.client.channel(topic, options);
  },

  recordPlay(g) {
    const a = (S.cache.activity[g] ??= { plays: 0, lastPlayedAt: 0 });
    a.plays += 1; a.lastPlayedAt = Date.now();
    if (!S.degraded) S.client.rpc("record_play", { p_game: g }).then(({ error }) => { if (error) console.warn("[WebMiniGames] atividade não registrada:", error.message); });
  },
  async setProfile(patch) {                                                      // { nickname?, avatar?, name?, region? }
    const { error } = await S.client.from("profiles").update(patch).eq("id", S.uid);
    if (error) {
      if (error.code === "23505") throw new Error("Esse apelido já está em uso.");
      if (error.code === "23514") throw new Error("Valor inválido para este campo.");
      throw new Error("Não foi possível salvar agora. Tente de novo.");
    }
    Object.assign(S.cache.profile, patch);
    const mirror = readJSON(SESSION_KEY, null);
    if (mirror?.id === S.uid) writeSession({ ...mirror, name: S.cache.profile.name, region: S.cache.profile.region ?? null });
  },
  async adminSetLevel(game, level) {
    const { data, error } = await S.client.rpc("admin_set_level", { p_game: game, p_level: level });
    if (error) throw new Error(error.code === "42501" ? "Só o administrador pode escolher o nível." : "Não foi possível mudar o nível.");
    S.cache.wins[game] = data.wins; delete S.cache.runs[game]; delete S.cache.daily[game]; S.dirty.delete(game); S.removed.delete(game);
  },
  async setGameEnabled(game, on) {
    const { data, error } = await S.client.from("games").update({ enabled: on }).eq("id", game).select("id");
    if (error || !data?.length) throw new Error("Só o administrador pode ligar ou desligar jogos.");
    S.cache.games[game] = on;
  },
  /** Configuração global (coins/cenários por dia). Vem no snapshot ao abrir a página. */
  config() { return S.cache.config ?? { coinsPerDay: 2 }; },
  /** Administrador: quantos coins (e cenários) por dia. Vale para todos os jogos. */
  async setCoinsPerDay(n) {
    const { data, error } = await S.client.rpc("set_coins_per_day", { p_n: n });
    if (error) throw new Error(error.code === "42501" ? "Só o administrador pode mudar os coins por dia." : "Não foi possível salvar os coins por dia.");
    S.cache.config = { ...S.cache.config, coinsPerDay: data.coinsPerDay };
    return data.coinsPerDay;
  },
  /** Administrador: concede tickets dos últimos dias a uma conta (pelo e-mail), em um jogo ou em todos. Só para teste. */
  async adminGrantCoins(email, game, days) {
    const { data, error } = await S.client.rpc("admin_grant_coins", { p_email: email, p_game: game, p_coins: days });
    if (error) {
      if (error.code === "42501") throw new Error("Só o administrador pode dar tickets.");
      if (/unknown_user/.test(error.message)) throw new Error("Não encontrei essa conta. Confira o e-mail.");
      throw new Error("Não foi possível dar os tickets agora.");
    }
    return data;
  },
  /** Ranking de um jogo (gameId) ou geral (null). Qualquer um pode ver, inclusive quem joga como anônimo. */
  async ranking(gameId, scope, limit) {
    if (!S.client || S.degraded) return { top: [], me: null, total: 0 };
    const { data, error } = await S.client.rpc("ranking", { p_game: gameId ?? null, p_scope: scope, p_limit: limit });
    if (error) { console.warn("[WebMiniGames] ranking indisponível:", error.message); return { top: [], me: null, total: 0 }; }
    return data;
  },

  /** Só para testes: volta ao estado inicial (modo local). */
  _reset() { clearTimeout(S.timer); clearTimeout(S.outboxTimer); S = fresh(); },
};
