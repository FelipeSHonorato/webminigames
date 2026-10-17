import { store, readJSON } from "../storage.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SDK } from "./config.js";
import { PASSWORD_HINT } from "../password.js";

/* ===================== NUVEM (Supabase) =====================
   Ponto de troca dos serviços de shared/ (Coins, Run, Scores, Profile, GameSwitch, Progress, AdminLevel) e de js/auth.js.
   Quando o Supabase está configurado, os dados do jogador são carregados UMA vez ao abrir a página (`start`) para um cache em
   memória: a leitura continua síncrona (os jogos leem coins, fase e nível sem esperar a rede) e as escritas seguem para o
   servidor em segundo plano. Pontos, vitórias, nível e coins são decididos pelo servidor (supabase/migrations): o navegador
   só pede (submit_win) e guarda a resposta. Sem Supabase configurado, `start` não faz nada e tudo roda local. */

const SESSION_KEY = "wmg.session", OUTBOX_KEY = "wmg.outbox";
const RUN_DELAY_MS = 700, RETRY_MS = 5000;
const empty = () => ({ profile: null, wins: {}, runs: {}, coins: {}, scores: {}, activity: {}, games: {} });
const fresh = () => ({ active: false, client: null, uid: null, degraded: false, reason: null, cache: empty(), dirty: new Set(), removed: new Set(), timer: null, runLock: null, outboxLock: null, wired: false });
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

const providerOf = user => (user?.app_metadata?.provider === "google" ? "google" : "password");
const sessionOf = (user, profile) => ({ id: user.id, name: profile.name, provider: providerOf(user), region: profile.region ?? null, role: profile.role ?? "user", email: user.email ?? null });
const writeSession = session => store.set(SESSION_KEY, JSON.stringify(session));
const degrade = e => { S.degraded = true; S.reason = e; console.warn("[WebMiniGames] Supabase indisponível:", e?.message ?? e); };

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
  clearTimeout(S.timer);
  Object.assign(S, { uid: null, cache: { ...empty(), games: S.cache.games }, dirty: new Set(), removed: new Set(), timer: null });
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

/* ----- Vitórias: fila guardada no navegador; cada vitória leva um id único, então reenviar nunca conta em dobro ----- */
const readOutbox = () => readJSON(OUTBOX_KEY, []);
const writeOutbox = list => store.set(OUTBOX_KEY, JSON.stringify(list));
function applyWin(game, data) {
  S.cache.wins[game] = data.wins; S.cache.scores[game] = data.score; S.cache.coins[game] = data.coins;
}
function flushOutbox() {
  S.outboxLock = (S.outboxLock ?? Promise.resolve()).then(async () => {
    if (!S.client || S.uid === null || S.degraded) return null;
    let last = null;
    for (;;) {
      const item = readOutbox().find(i => i.uid === S.uid);
      if (!item) return last;
      const { data, error } = await S.client.rpc("submit_win", { p_game: item.game, p_points: item.points, p_op: item.op });
      if (error && !isPermanent(error)) { console.warn("[WebMiniGames] vitória na fila (será reenviada):", error.message); return last; }
      writeOutbox(readOutbox().filter(i => i.op !== item.op));
      if (!error) { applyWin(item.game, data); last = data.score; }
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
  coinEntry: g => S.cache.coins[g] ?? null,
  scores: () => S.cache.scores,
  activity: () => S.cache.activity,
  gameOn: g => S.cache.games[g] !== false,

  /* ----- escrita ----- */
  setWins(g, n) { S.cache.wins[g] = n; },                                        // só o cache: quem conta vitória é o servidor (submit_win)
  setCoinEntry(g, entry) { S.cache.coins[g] = entry; },
  setRun(g, run) { S.cache.runs[g] = run; S.removed.delete(g); S.dirty.add(g); scheduleRuns(); },
  clearRun(g) { delete S.cache.runs[g]; S.dirty.delete(g); S.removed.add(g); scheduleRuns(); },
  flush: () => Promise.all([flushRuns(), flushOutbox()]),

  /** Soma uma vitória: vai para a fila e é enviada já. Devolve a pontuação atual do jogo (ou null se ficou na fila). */
  async submitWin(game, points) {
    writeOutbox([...readOutbox(), { uid: S.uid, game, points, op: crypto.randomUUID() }]);
    return flushOutbox();
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
    S.cache.wins[game] = data.wins; delete S.cache.runs[game]; S.dirty.delete(game); S.removed.delete(game);
  },
  async setGameEnabled(game, on) {
    const { data, error } = await S.client.from("games").update({ enabled: on }).eq("id", game).select("id");
    if (error || !data?.length) throw new Error("Só o administrador pode ligar ou desligar jogos.");
    S.cache.games[game] = on;
  },
  /** Ranking de um jogo (gameId) ou geral (null). Qualquer um pode ver, inclusive quem joga como anônimo. */
  async ranking(gameId, scope, limit) {
    if (!S.client || S.degraded) return { top: [], me: null, total: 0 };
    const { data, error } = await S.client.rpc("ranking", { p_game: gameId ?? null, p_scope: scope, p_limit: limit });
    if (error) { console.warn("[WebMiniGames] ranking indisponível:", error.message); return { top: [], me: null, total: 0 }; }
    return data;
  },

  /** Só para testes: volta ao estado inicial (modo local). */
  _reset() { clearTimeout(S.timer); S = fresh(); },
};
