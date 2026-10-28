import test from "node:test";
import assert from "node:assert/strict";
import { Cloud, authErrorMessage, isPermanent, isConfigured } from "../shared/backend/cloud.js";
import { Auth } from "../js/auth.js";
import { Coins, settle, DAY_MS } from "../shared/coins.js";
import { Run } from "../shared/run.js";
import { Scores } from "../shared/scores.js";
import { Profile, Activity } from "../shared/profile.js";
import { GameSwitch } from "../shared/game-switch.js";
import { Progress } from "../shared/progress.js";
import { AdminLevel } from "../shared/admin-level.js";
import { AdminCoins } from "../shared/admin-coins.js";
import { store } from "../shared/storage.js";

const UID = "00000000-0000-4000-8000-00000000000a";
const SNAP = {
  profile: { id: UID, name: "Ana", nickname: "Aninha", region: "sul", avatar: null, role: "user" },
  wins: { zip: 3 }, runs: { zip: { seed: 7, level: 0, solved: false } },
  coins: { zip: { coins: 1, anchor: Date.now() - 1000 } },
  scores: { zip: { points: 12, wins: 3, updatedAt: 1 } }, activity: { zip: { plays: 4, lastPlayedAt: 99 } },
};

/** Cliente Supabase de mentira: registra as chamadas e devolve o que o teste mandar. */
function fakeClient({ session = { user: { id: UID, email: "ana@t.com", app_metadata: { provider: "email" } } }, snapshot = SNAP, rpc = {}, tables = {}, auth = {}, functions = {} } = {}) {
  const calls = [];
  const chain = result => { const o = { eq: () => o, select: () => o, then: (ok, no) => Promise.resolve(result).then(ok, no) }; return o; };
  return {
    calls,
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      signOut: async () => ({ error: null }),
      onAuthStateChange() {},
      signInWithPassword: async args => { calls.push(["signInWithPassword", args]); return auth.signInWithPassword?.(args) ?? { data: { user: session?.user }, error: null }; },
      resetPasswordForEmail: async (email, opts) => { calls.push(["resetPasswordForEmail", email, opts]); return auth.resetPasswordForEmail?.(email, opts) ?? { data: {}, error: null }; },
      updateUser: async args => { calls.push(["updateUser", args]); return auth.updateUser?.(args) ?? { data: { user: session?.user }, error: null }; },
      verifyOtp: async args => { calls.push(["verifyOtp", args]); return auth.verifyOtp?.(args) ?? { data: { user: session?.user }, error: null }; },
    },
    functions: {
      invoke: async (name, opts) => { calls.push(["invoke", name, opts.body]); return functions.invoke?.(name, opts.body) ?? { data: null, error: null }; },
    },
    from: table => ({
      select: () => chain(tables.select?.(table) ?? { data: [{ id: "zip", enabled: true }, { id: "canos", enabled: false }], error: null }),
      upsert: (row, opts) => { calls.push(["upsert", table, row, opts]); return chain(tables.upsert?.(row) ?? { error: null }); },
      delete: () => { calls.push(["delete", table]); return chain({ error: null }); },
      update: patch => { calls.push(["update", table, patch]); return chain(tables.update?.(patch) ?? { data: [{ id: "x" }], error: null }); },
    }),
    rpc: async (fn, args) => { calls.push(["rpc", fn, args]); return (rpc[fn] ?? (() => (fn === "my_snapshot" ? { data: structuredClone(snapshot), error: null } : { data: null, error: null })))(args); },
    channel: topic => { calls.push(["channel", topic]); return { topic, on() { return this; }, subscribe() { calls.push(["subscribe", topic]); return this; }, unsubscribe() { calls.push(["unsubscribe", topic]); } }; },
  };
}
const boot = async (opts) => { Cloud._reset(); store.set("wmg.outbox", "[]"); store.set("wmg.session", "null"); const c = fakeClient(opts); await Cloud.start({ client: c }); return c; };
const winResult = { duplicate: false, wins: 4, score: { points: 17, wins: 4, updatedAt: 5 }, coins: { coins: 0, anchor: Date.now() } };

test("sem Supabase configurado, a nuvem fica desligada (modo local)", async () => {
  Cloud._reset();
  assert.equal(isConfigured("", ""), false); assert.equal(isConfigured("https://x.supabase.co", ""), false); assert.equal(isConfigured("https://x.supabase.co", "k"), true);
  assert.equal(await Cloud.start({ url: "", key: "" }), null);        // config explícita vazia: local, mesmo com o config.js preenchido
  assert.equal(Cloud.active, false); assert.equal(Cloud.owns(UID), false);
  assert.equal(GameSwitch.isOn("canos"), true);                       // local: tudo ligado
});

test("start: carrega a conta de uma vez e os serviços passam a ler do cache (de forma síncrona)", async () => {
  const c = await boot();
  assert.equal(Cloud.active && !Cloud.degraded, true);
  assert.equal(c.calls.filter(x => x[1] === "my_snapshot").length, 1, "um único snapshot");
  assert.ok(Cloud.owns(UID) && !Cloud.owns("outro"));
  assert.deepEqual(JSON.parse(store.get("wmg.session")), { id: UID, name: "Ana", provider: "password", region: "sul", role: "user", email: "ana@t.com" });
  assert.equal(Progress.wins("zip.wins", UID), 3); assert.equal(Progress.level("zip.wins", UID), 0);
  assert.equal(Run.get(UID, "zip").seed, 7);
  assert.equal(Coins.get(UID, "zip").coins, 1);
  assert.equal(Scores.mine().zip.points, 12);
  assert.equal(Profile.get(UID).nickname, "Aninha");
  assert.equal(Activity.all(UID).zip.plays, 4);
  assert.equal(GameSwitch.isOn("canos"), false); assert.equal(GameSwitch.isOn("zip"), true);
});

test("sem login na nuvem: sessão de conta antiga é descartada, anônimo é mantido", async () => {
  Cloud._reset(); store.set("wmg.session", JSON.stringify({ id: "u-1", provider: "password" }));
  await Cloud.start({ client: fakeClient({ session: null }) });
  assert.equal(store.get("wmg.session"), "null"); assert.equal(Cloud.uid, null);
  Cloud._reset(); store.set("wmg.session", JSON.stringify({ id: "a-1", provider: "anonymous" }));
  await Cloud.start({ client: fakeClient({ session: null }) });
  assert.equal(JSON.parse(store.get("wmg.session")).id, "a-1");
});

test("anônimo no modo nuvem continua local: não toca no servidor", async () => {
  const c = await boot({ session: null });
  Run.set("a-anon", "zip", { seed: 1 }); Coins.spend("a-anon", "zip");
  await Cloud.flush();
  assert.equal(c.calls.filter(x => x[0] !== "rpc" || x[1] !== "ranking").length, 0, JSON.stringify(c.calls));
  assert.deepEqual(Run.get("a-anon", "zip"), { seed: 1 });
  assert.equal(Cloud.owns("a-anon"), false);
});

test("Run: jogadas seguidas viram uma gravação por jogo; clear apaga no servidor", async () => {
  const c = await boot();
  Run.set(UID, "zip", { seed: 7, moves: 1 }); Run.set(UID, "zip", { seed: 7, moves: 2 }); Run.set(UID, "zip", { seed: 7, moves: 3 });
  await Cloud.flush();
  const ups = c.calls.filter(x => x[0] === "upsert");
  assert.equal(ups.length, 1);
  assert.deepEqual(ups[0].slice(1, 3), ["runs", { user_id: UID, game_id: "zip", state: { seed: 7, moves: 3 } }]);
  assert.equal(ups[0][3].onConflict, "user_id,game_id");
  Run.clear(UID, "zip"); await Cloud.flush();
  assert.equal(Run.get(UID, "zip"), null);
  assert.ok(c.calls.some(x => x[0] === "delete" && x[1] === "runs"));
});

test("Run: erro ao gravar não perde a fase (continua pendente e é reenviada)", async () => {
  let fail = true;
  const c = await boot({ tables: { upsert: () => (fail ? { error: { message: "offline" } } : { error: null }) } });
  Run.set(UID, "zip", { seed: 8 }); await Cloud.flush();
  fail = false; await Cloud.flush();
  assert.equal(c.calls.filter(x => x[0] === "upsert").length, 2);
});

test("abrir fase: o servidor serve o puzzle (sem solução) e o cache guarda nível e coins", async () => {
  const opened = { level: 2, hints: 0, puzzle: { cells: [1, 2, 0], givens: 2 }, coins: { coins: 1, anchor: 5 } };
  const c = await boot({ functions: { invoke: (name, body) => (body.action === "open" ? { data: opened, error: null } : { data: null, error: null }) } });
  const d = await Cloud.open("sudoku");
  assert.deepEqual(d, opened);
  const call = c.calls.find(x => x[0] === "invoke" && x[2].action === "open");
  assert.equal(call[1], "play"); assert.equal(call[2].game, "sudoku");
  assert.deepEqual(Cloud.phase("sudoku"), { level: 2, hints: 0, puzzle: { cells: [1, 2, 0], givens: 2 } });
  assert.equal(Cloud.coinEntry("sudoku").coins, 1);
});

test("dica: o servidor conta e devolve o novo total; o cache da fase acompanha", async () => {
  const c = await boot({ functions: { invoke: (name, body) => (body.action === "hint" ? { data: { cell: 4, value: "A", hints: 3 }, error: null } : { data: { level: 0, hints: 0, puzzle: { cells: [] }, coins: { coins: 2, anchor: 1 } }, error: null }) } });
  await Cloud.open("cruzadas");
  const d = await Cloud.hint("cruzadas", { entries: "", id: 0 });
  assert.deepEqual(d, { cell: 4, value: "A", hints: 3 });
  assert.equal(c.calls.find(x => x[0] === "invoke" && x[2].action === "hint")[2].state.id, 0);
  assert.equal(Cloud.phase("cruzadas").hints, 3);
});

test("vitória: o servidor valida o tabuleiro e o cache recebe pontos, vitórias e coins", async () => {
  const c = await boot({ functions: { invoke: () => ({ data: winResult, error: null }) } });
  Coins.spend(UID, "zip");
  const r = await Scores.submit("zip", 5, { state: { grid: [1, 2, 3] } });
  assert.deepEqual(r, winResult.score);
  const call = c.calls.find(x => x[0] === "invoke" && x[2].action === "finish");
  assert.equal(call[2].game, "zip"); assert.deepEqual(call[2].state, { grid: [1, 2, 3] }); assert.match(call[2].op, /^[0-9a-f-]{36}$/);
  assert.equal(Progress.wins("zip.wins", UID), 4); assert.equal(Scores.mine().zip.points, 17); assert.equal(Coins.get(UID, "zip").coins, 0);
  assert.equal(JSON.parse(store.get("wmg.outbox")).length, 0);
});

test("vitória sem rede fica na fila e é reenviada com o MESMO id (nunca conta duas vezes)", async () => {
  let offline = true;
  const c = await boot({ functions: { invoke: () => (offline ? { data: null, error: { message: "Failed to fetch" } } : { data: winResult, error: null }) } });
  assert.equal(await Scores.submit("zip", 5, { state: { grid: [1] } }), null);
  const queued = JSON.parse(store.get("wmg.outbox")); assert.equal(queued.length, 1);
  offline = false; await Cloud.flush();
  const ops = c.calls.filter(x => x[0] === "invoke" && x[2].action === "finish").map(x => x[2].op);
  assert.equal(ops.length, 2); assert.equal(ops[0], ops[1]); assert.equal(ops[0], queued[0].op);
  assert.equal(JSON.parse(store.get("wmg.outbox")).length, 0);
});

test("vitória recusada pelo servidor (tabuleiro inválido) sai da fila: não fica tentando para sempre", async () => {
  const c = await boot({ functions: { invoke: () => ({ data: null, error: { message: "invalid", context: { status: 422, json: async () => ({ error: "invalid" }) } } }) } });
  assert.equal(await Scores.submit("zip", 20, { state: { grid: [0] } }), null);
  assert.equal(JSON.parse(store.get("wmg.outbox")).length, 0);
  await Cloud.flush();
  assert.equal(c.calls.filter(x => x[0] === "invoke").length, 1);
  assert.deepEqual([isPermanent({ code: "22023" }), isPermanent({ code: "" }), isPermanent({ code: "PGRST301" })], [true, false, false]);
});

test("vitória 'too_fast' (ritmo) NÃO é descartada: fica na fila e é reenviada depois", async () => {
  let tooFast = true;
  const c = await boot({ functions: { invoke: () => (tooFast ? { data: null, error: { message: "too_fast", context: { status: 409, json: async () => ({ error: "too_fast", retryable: true }) } } } : { data: winResult, error: null }) } });
  assert.equal(await Scores.submit("zip", 5, { state: { grid: [1] } }), null);
  assert.equal(JSON.parse(store.get("wmg.outbox")).length, 1, "jogada offline em série não perde a vitória");
  tooFast = false; await Cloud.flush();
  assert.equal(JSON.parse(store.get("wmg.outbox")).length, 0);
  assert.equal(c.calls.filter(x => x[0] === "invoke").length, 2);
  assert.equal(isPermanent({ code: "P0001" }), false);
  Cloud._reset();
});

test("finishNow: o servidor valida e a vitória é contada NA HORA (sem passar pela fila)", async () => {
  const c = await boot({ functions: { invoke: (name, body) => (body.action === "finish" ? { data: winResult, error: null } : { data: null, error: null }) } });
  assert.deepEqual(await Cloud.finishNow("cruzadas", { entries: "AB" }), { ok: winResult });
  const call = c.calls.find(x => x[0] === "invoke" && x[2].action === "finish");
  assert.equal(call[2].game, "cruzadas"); assert.deepEqual(call[2].state, { entries: "AB" });
  assert.equal(Progress.wins("cruzadas.wins", UID), 4);
  assert.equal(JSON.parse(store.get("wmg.outbox")).length, 0);
});

test("finishNow: erro passageiro enfileira e devolve pending; tabuleiro recusado lança", async () => {
  let offline = true;
  await boot({ functions: { invoke: (name, body) => (body.action === "finish" ? (offline ? { data: null, error: { message: "Failed to fetch" } } : { data: winResult, error: null }) : { data: null, error: null }) } });
  assert.deepEqual(await Cloud.finishNow("cruzadas", { entries: "AB" }), { pending: true });
  assert.equal(JSON.parse(store.get("wmg.outbox")).length, 1);
  offline = false; await Cloud.flush();
  assert.equal(JSON.parse(store.get("wmg.outbox")).length, 0);
  await boot({ functions: { invoke: () => ({ data: null, error: { message: "invalid", context: { status: 422, json: async () => ({ error: "invalid" }) } } }) } });
  await assert.rejects(Cloud.finishNow("cruzadas", { entries: "AB" }), /invalid/);
  assert.equal(JSON.parse(store.get("wmg.outbox")).length, 0);
});

test("a fila é por jogador: vitórias pendentes de outra conta não são enviadas por esta", async () => {
  const c = await boot({ functions: { invoke: () => ({ data: winResult, error: null }) } });
  store.set("wmg.outbox", JSON.stringify([{ uid: "outra-conta", game: "zip", state: {}, op: "aaaaaaaa-0000-4000-8000-000000000001" }]));
  await Cloud.flush();
  assert.equal(c.calls.filter(x => x[0] === "invoke").length, 0);
  assert.equal(JSON.parse(store.get("wmg.outbox")).length, 1);
});

test("coins na nuvem: gastar só mexe na tela; a recarga de 24 h é recalculada; administrador tem 99999", async () => {
  const c = await boot();
  assert.equal(Coins.spend(UID, "zip"), true); assert.equal(Coins.get(UID, "zip").coins, 0); assert.equal(Coins.spend(UID, "zip"), false);
  assert.equal(c.calls.filter(x => x[0] === "rpc" && x[1] !== "my_snapshot").length, 0, "o gasto real é do servidor, na vitória");
  const later = Date.now() + DAY_MS + 5;
  assert.equal(Coins.get(UID, "zip", later).coins, 2);
  Cloud._reset(); await Cloud.start({ client: fakeClient({ snapshot: { ...SNAP, profile: { ...SNAP.profile, role: "admin" } } }) });
  assert.equal(Coins.get(UID, "sudoku").max, 99999);
});

test("settle (recarga pura): primeiro acesso, sem recarga, recarga em dias inteiros e teto", () => {
  assert.deepEqual(settle(undefined, 2, 1000), { coins: 2, anchor: 1000 });
  assert.deepEqual(settle({ coins: 0, anchor: 1000 }, 2, 1000 + DAY_MS - 1), { coins: 0, anchor: 1000 });
  assert.deepEqual(settle({ coins: 0, anchor: 1000 }, 2, 1000 + 2 * DAY_MS + 7), { coins: 2, anchor: 1000 + 2 * DAY_MS });
  assert.deepEqual(settle({ coins: 50, anchor: 0 }, 2, 10), { coins: 2, anchor: 0 });
});

test("perfil: apelido e foto vão ao banco; apelido repetido vira mensagem em português", async () => {
  const c = await boot();
  assert.equal(await Profile.setNickname(UID, "  Nova   Ana "), "Nova Ana");
  assert.deepEqual(c.calls.find(x => x[0] === "update" && x[1] === "profiles").slice(2), [{ nickname: "Nova Ana" }]);
  assert.equal(Profile.displayName(JSON.parse(store.get("wmg.session"))), "Nova Ana");
  assert.throws(() => Profile.setNickname(UID, "ab"), /3 a 20/);
  await Profile.setAvatar(UID, null); assert.equal(Profile.get(UID).avatar, null);
  Cloud._reset(); await Cloud.start({ client: fakeClient({ tables: { update: () => ({ error: { code: "23505" } }) } }) });
  await assert.rejects(async () => Profile.setNickname(UID, "Repetido"), /já está em uso/);
});

test("região: na nuvem vai ao banco e a sessão espelho é atualizada (qualquer conta)", async () => {
  const c = await boot();
  assert.equal(await Profile.setRegion(UID, "nordeste"), "nordeste");
  assert.deepEqual(c.calls.find(x => x[0] === "update" && x[1] === "profiles").slice(2), [{ region: "nordeste" }]);
  assert.equal(Profile.get(UID).region, "nordeste");
  assert.equal(JSON.parse(store.get("wmg.session")).region, "nordeste");
  await assert.rejects(async () => Profile.setRegion(UID, "marte"), /região/);
});

test("ranking vem do servidor (função ranking), com escopo e limite; erro vira lista vazia", async () => {
  const data = { top: [{ id: "x", name: "Ana", points: 5, rank: 1, isMe: false }], me: null, total: 1 };
  const c = await boot({ rpc: { ranking: () => ({ data, error: null }) } });
  assert.deepEqual(await Scores.leaderboard("zip", { scope: "region", limit: 5 }), data);
  assert.deepEqual(c.calls.find(x => x[1] === "ranking")[2], { p_game: "zip", p_scope: "region", p_limit: 5 });
  await Scores.overall(); assert.equal(c.calls.filter(x => x[1] === "ranking").at(-1)[2].p_game, null);
  await boot({ rpc: { ranking: () => ({ data: null, error: { message: "x" } }) } });
  assert.deepEqual(await Scores.leaderboard("zip"), { top: [], me: null, total: 0 });
});

test("administrador: nível e liga/desliga passam pelo servidor; recusa vira mensagem", async () => {
  const admin = { ...SNAP, profile: { ...SNAP.profile, role: "admin" } };
  const c = await boot({ snapshot: admin, rpc: {
    admin_set_level: () => ({ data: { wins: 45 }, error: null }),
    daily_status: () => ({ data: { zip: { day: "2026-10-26", level: 0, coins: 1, pending: [{ day: "2026-10-26", slot: 1, level: 0 }] } }, error: null }),
  } });
  const session = JSON.parse(store.get("wmg.session"));
  Run.set(UID, "zip", { seed: 1 });
  await Cloud.dailyStatus(); assert.equal(Cloud.daily("zip").pending[0].level, 0);
  assert.equal(await AdminLevel.set(session, "zip", "zip.wins", 3), 3);
  assert.deepEqual(c.calls.find(x => x[1] === "admin_set_level")[2], { p_game: "zip", p_level: 3 });
  assert.equal(Progress.level("zip.wins", UID), 3); assert.equal(Run.get(UID, "zip"), null);
  assert.equal(Cloud.daily("zip"), null);
  await GameSwitch.set("zip", false); assert.equal(GameSwitch.isOn("zip"), false);
  await boot({ tables: { update: () => ({ data: [], error: null }) } });
  await assert.rejects(async () => GameSwitch.set("zip", false), /administrador/);
  await assert.rejects(async () => AdminLevel.set({ id: UID, role: "user" }, "zip", "zip.wins", 1), /administrador/);
});

test("desafio diário: status guarda tickets e o dia original em open/finish/leaderboard", async () => {
  const daily = { zip: {
    day: "2026-10-26", slots: 2, maxCoins: 60, level: 0, coins: 1,
    pending: [{ day: "2026-10-24", slot: 1, level: 0 }], open: [],
    results: {}, history: {}, levels: {}, stats: {},
  } };
  const c = await boot({
    rpc: { daily_status: () => ({ data: daily, error: null }) },
    functions: { invoke: (name, body) => ({ data: body.action === "daily_open"
      ? { day: "2026-10-24", level: 0, slot: 1, slots: 2, startedAt: 0, puzzle: {}, coins: 0, resumed: false }
      : { day: "2026-10-24", level: 0, seconds: 42, best: 42, coins: 0, wins: 1, stats: { slot: 1, seconds: 42 }, score: { points: 5, wins: 1 } }, error: null }) },
  });
  await Cloud.dailyStatus();
  assert.deepEqual(Cloud.daily("zip").pending, [{ day: "2026-10-24", slot: 1, level: 0 }]);
  assert.equal(Cloud.daily("zip").day, "2026-10-26");
  assert.equal(Cloud.daily("zip").maxCoins, 60);

  await Cloud.dailyOpen("zip", "2026-10-24", 1);
  assert.deepEqual(c.calls.find(x => x[0] === "invoke" && x[2].action === "daily_open")[2], { action: "daily_open", game: "zip", day: "2026-10-24", slot: 1 });
  assert.deepEqual(Cloud.daily("zip").open, [{ day: "2026-10-24", slot: 1, level: 0 }]);
  assert.deepEqual(Cloud.daily("zip").pending, []);

  await Cloud.dailyFinish("zip", "2026-10-24", 1, { order: [] });
  assert.equal(Cloud.daily("zip").history["2026-10-24"][1], 42);
  assert.deepEqual(Cloud.daily("zip").open, []);
  assert.equal(Cloud.daily("zip").statsByDay["2026-10-24"][1].seconds, 42);

  await Cloud.dailyLeaderboard("zip", 0, "global", 10, "2026-10-24");
  assert.equal(c.calls.find(x => x[0] === "rpc" && x[1] === "daily_leaderboard")[2].p_day, "2026-10-24");
});

test("desafio diário: o primeiro movimento começa o relógio no servidor (Text Twist)", async () => {
  const c = await boot({
    functions: { invoke: (name, body) => ({ data: body.action === "daily_start"
      ? { startedAt: 123456, started: true }
      : { day: "2026-10-20", level: 0, slot: 1, slots: 2, startedAt: 0, started: false, puzzle: {}, coins: 0, resumed: true }, error: null }) },
  });
  assert.deepEqual(await Cloud.dailyStart("texttwist", "2026-10-20", 1), { startedAt: 123456, started: true });
  assert.deepEqual(c.calls.find(x => x[0] === "invoke" && x[2].action === "daily_start")[2], { action: "daily_start", game: "texttwist", day: "2026-10-20", slot: 1 });
});

/* ---------- duelos 1×1 ---------- */
test("duelos: cada ação chama a Edge com os campos certos", async () => {
  const c = await boot({ functions: { invoke: (name, body) => ({ data: { action: body.action }, error: null }) } });

  await Cloud.duelCreate("duelgame", 2);
  await Cloud.duelJoin("abc123");
  await Cloud.duelReady("d1");
  await Cloud.duelStart("d1");
  await Cloud.duelState("d1");
  await Cloud.duelLeave("d1");

  const bodies = c.calls.filter(x => x[0] === "invoke").map(x => x[2]);
  assert.deepEqual(bodies, [
    { action: "duel_create", game: "duelgame", level: 2 },
    { action: "duel_join", code: "abc123" },
    { action: "duel_ready", duel: "d1" },
    { action: "duel_start", duel: "d1" },
    { action: "duel_state", duel: "d1" },
    { action: "duel_leave", duel: "d1" },
  ]);
});

test("duelos: finalizar valida no servidor e reaproveita o op no reenvio", async () => {
  const result = { won: true, winner: UID, seconds: 12, words: null };
  const c = await boot({ functions: { invoke: () => ({ data: result, error: null }) } });

  assert.deepEqual(await Cloud.duelFinish("d1", { order: [1, 2, 3] }), { ok: result });
  const first = c.calls.find(x => x[2]?.action === "duel_finish")[2];
  assert.equal(first.duel, "d1");
  assert.deepEqual(first.state, { order: [1, 2, 3] });
  assert.match(first.op, /^[0-9a-f-]{36}$/, "cada tentativa leva um op único");

  await Cloud.duelFinish("d1", { order: [1, 2, 3] }, first.op);        // reenvio idempotente
  const last = c.calls.filter(x => x[2]?.action === "duel_finish").at(-1)[2];
  assert.equal(last.op, first.op);
});

test("duelos: erro da Edge chega com o código (sala cheia / jogo sem duelo)", async () => {
  await boot({ functions: { invoke: () => ({ data: null, error: { message: "duel_full", context: { status: 409, json: async () => ({ error: "duel_full" }) } } }) } });
  await assert.rejects(Cloud.duelJoin("ABC123"), e => e.code === "duel_full" && e.status === 409);

  await boot({ functions: { invoke: () => ({ data: null, error: { message: "not_duel_game", context: { status: 400, json: async () => ({ error: "not_duel_game" }) } } }) } });
  await assert.rejects(Cloud.duelCreate("zip"), e => e.code === "not_duel_game" && e.status === 400);
});

test("duelos: canal Realtime usa um tópico por duelo; em modo local não existe canal", async () => {
  const c = await boot();
  assert.equal(Cloud.duelTopic("d1"), "duel:d1");
  const ch = Cloud.channel(Cloud.duelTopic("d1"));
  assert.equal(ch.topic, "duel:d1");
  assert.deepEqual(c.calls.find(x => x[0] === "channel"), ["channel", "duel:d1"]);

  Cloud._reset();
  assert.equal(Cloud.channel("duel:d1"), null, "sem nuvem não há Realtime");
});

test("administrador: dar tickets diários (por e-mail) passa pelo servidor; validação em português", async () => {
  const admin = { ...SNAP, profile: { ...SNAP.profile, role: "admin" } };
  const r = { email: "bia@t.com", name: "Bia", day: "2026-10-19", coins: 10, games: ["zip", "patches"] };
  const c = await boot({ snapshot: admin, rpc: { admin_grant_coins: () => ({ data: r, error: null }) } });
  const session = JSON.parse(store.get("wmg.session"));
  assert.deepEqual(await AdminCoins.grant(session, "bia@t.com", null, 10), r);
  assert.deepEqual(c.calls.find(x => x[1] === "admin_grant_coins")[2], { p_email: "bia@t.com", p_game: null, p_coins: 10 });
  await assert.rejects(AdminCoins.grant({ id: UID, role: "user" }, "bia@t.com", "zip", 10), /administrador/);
  await assert.rejects(AdminCoins.grant(session, "sem-arroba", "zip", 10), /e-mail/);
  await assert.rejects(AdminCoins.grant(session, "bia@t.com", "zip", 0), /1 a 30 dias/);
  await boot({ snapshot: admin, rpc: { admin_grant_coins: () => ({ data: null, error: { code: "42501", message: "forbidden" } }) } });
  await assert.rejects(AdminCoins.grant(JSON.parse(store.get("wmg.session")), "bia@t.com", null, 5), /administrador/);
  await boot({ snapshot: admin, rpc: { admin_grant_coins: () => ({ data: null, error: { code: "22023", message: "unknown_user" } }) } });
  await assert.rejects(AdminCoins.grant(JSON.parse(store.get("wmg.session")), "bia@t.com", null, 5), /Confira o e-mail/);
  Cloud._reset();
  await assert.rejects(AdminCoins.grant(session, "bia@t.com", "zip", 10), /nuvem/);
});

test("falha ao carregar a conta: modo degradado, volta ao armazenamento local e NÃO grava na nuvem", async () => {
  const c = await boot({ rpc: { my_snapshot: () => ({ data: null, error: { message: "boom" } }) } });
  assert.equal(Cloud.degraded, true); assert.equal(Cloud.owns(UID), false);
  Run.set(UID, "zip", { seed: 99 }); await Cloud.flush();
  assert.equal(c.calls.filter(x => x[0] === "upsert").length, 0);
  assert.deepEqual(await Scores.leaderboard("zip"), { top: [], me: null, total: 0 });
});

test("mensagens de erro de login/cadastro em português", () => {
  const m = e => authErrorMessage(e);
  assert.match(m({ code: "invalid_credentials" }), /incorretos/);
  assert.match(m({ code: "user_already_exists" }), /Já existe/);
  assert.match(m({ code: "email_not_confirmed" }), /Confirme seu e-mail/);
  assert.match(m({ code: "weak_password" }), /8 caracteres, um número e uma letra maiúscula/);
  assert.match(m({ code: "otp_expired" }), /expirou ou já foi usado/);
  assert.match(m({ code: "over_email_send_rate_limit" }), /Muitas tentativas/);
  assert.match(m({ status: 429 }), /Muitas tentativas/);
  assert.match(m({ name: "AuthRetryableFetchError", message: "x" }), /Sem conexão/);
  assert.match(m({ message: "TypeError: Failed to fetch" }), /Sem conexão/);
  assert.match(m({ code: "algo_novo" }), /Tente de novo/);
  assert.doesNotMatch(m({ code: "algo_novo", message: "segredo interno" }), /segredo/);
});

test("recuperar senha na nuvem: pede o e-mail de redefinição e conclui com verifyOtp + nova senha", async () => {
  const c = await boot();
  await Auth.resetPassword("ana@t.com");
  assert.equal(c.calls.find(x => x[0] === "resetPasswordForEmail")[1], "ana@t.com");
  await Auth.completeReset({ tokenHash: "xyz", password: "NovaSenha1" });
  assert.deepEqual(c.calls.find(x => x[0] === "verifyOtp")[1], { token_hash: "xyz", type: "recovery" });
  assert.equal(c.calls.find(x => x[0] === "updateUser")[1].password, "NovaSenha1");
  await assert.rejects(Auth.completeReset({ tokenHash: "xyz", password: "123" }), /pelo menos 8/);
  await assert.rejects(Auth.resetPassword("sem-arroba"), /e-mail válido/);
});

test("excluir conta na nuvem: confirma a senha atual e chama delete_my_account", async () => {
  const c = await boot({ rpc: { delete_my_account: () => ({ data: null, error: null }) } });
  await Auth.deleteAccount({ password: "Segredo1" });
  const sign = c.calls.find(x => x[0] === "signInWithPassword");
  assert.equal(sign[1].email, "ana@t.com"); assert.equal(sign[1].password, "Segredo1");
  assert.ok(c.calls.some(x => x[0] === "rpc" && x[1] === "delete_my_account"));
  assert.equal(store.get("wmg.session"), "null");
});

test("excluir conta na nuvem: senha errada não apaga nada", async () => {
  const c = await boot({ auth: { signInWithPassword: () => ({ data: null, error: { code: "invalid_credentials" } }) } });
  await assert.rejects(Auth.deleteAccount({ password: "errada" }), /Senha incorreta/);
  assert.equal(c.calls.some(x => x[1] === "delete_my_account"), false);
});
