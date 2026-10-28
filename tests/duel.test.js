/* Duelos 1×1: a sessão (máquina de estados sem DOM) e os textos do painel.
   O servidor é a autoridade; aqui garantimos que o cliente só pede, escuta e espelha. */
import test from "node:test";
import assert from "node:assert/strict";
import { createDuelSession, duelOutcome, msUntil, DEFAULT_POLL_MS } from "../shared/duel-session.js";
import { duelLink, countdownText, outcomeText, duelView } from "../shared/duel-ui.js";
import { duelGames, normalizeCode, isDuelCode, duelPage } from "../shared/duel-hub.js";
import { GAMES as CATALOG } from "../js/games.js";

const UID = "00000000-0000-4000-8000-00000000000a";

/** Nuvem de mentira: registra chamadas, guarda o que foi transmitido e deixa simular um broadcast recebido. */
function fakeCloud({ uid = UID, responses = {} } = {}) {
  const calls = [], sent = [];
  const channel = {
    topic: null, handlers: {},
    on(event, filter, cb) { calls.push(["on", filter.event]); this.handlers[filter.event] = cb; return this; },
    subscribe(cb) { calls.push(["subscribe"]); cb?.("SUBSCRIBED"); return this; },
    track(payload) { calls.push(["track", payload]); },
    send(message) { sent.push(message); },
    unsubscribe() { calls.push(["unsubscribe"]); },
    receive(event, payload) { this.handlers[event]?.({ payload }); },
  };
  const cloud = {
    uid,
    duelTopic: id => `duel:${id}`,
    channel(topic) { calls.push(["channel", topic]); channel.topic = topic; return channel; },
    async duelCreate(game, level) {
      calls.push(["create", game, level]);
      return responses.create ?? { id: "d1", code: "ABC123", gameId: game, level, rule: "first", maxSeconds: 120 };
    },
    async duelJoin(code) {
      calls.push(["join", code]);
      return responses.join ?? { id: "d1", code, gameId: "duelgame", level: 0, rule: "first", maxSeconds: 120, players: [] };
    },
    async duelReady(id) {
      calls.push(["ready", id]);
      return responses.ready ?? { status: "waiting", startsAt: null, serverNow: new Date().toISOString() };
    },
    async duelStart(id) {
      calls.push(["start", id]);
      return responses.start ?? { puzzle: { cells: [1] }, startsAt: null, serverNow: new Date().toISOString(), maxSeconds: 120, rule: "first" };
    },
    async duelState(id) {
      calls.push(["state", id]);
      return responses.state ?? { id, status: "waiting", players: [] };
    },
    async duelFinish(id, state, op) {
      calls.push(["finish", id, state, op]);
      return { ok: responses.finish ?? { won: true, winner: UID, seconds: 3 } };
    },
    async duelLeave(id) {
      calls.push(["leave", id]);
      return responses.leave ?? { status: "cancelled" };
    },
  };
  return { cloud, calls, sent, channel };
}

test("duelOutcome: vitória, derrota, empate, cancelado e em andamento", () => {
  assert.equal(duelOutcome(null, UID), "idle");
  assert.equal(duelOutcome({ status: "waiting" }, UID), "running");
  assert.equal(duelOutcome({ status: "running" }, UID), "running");
  assert.equal(duelOutcome({ status: "finished", winner: { user_id: UID } }, UID), "win");
  assert.equal(duelOutcome({ status: "finished", winner: { user_id: "outro" } }, UID), "lose");
  assert.equal(duelOutcome({ status: "finished", winner: null }, UID), "draw");
  assert.equal(duelOutcome({ status: "cancelled" }, UID), "cancelled");
});

test("msUntil: desconta o relógio do cliente e nunca fica negativo", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  assert.equal(msUntil("2026-01-01T00:00:04Z", now), 4000);
  assert.equal(msUntil("2026-01-01T00:00:04Z", now, 1000), 3000);   // relógio do cliente atrasado
  assert.equal(msUntil("2025-12-31T23:59:59Z", now), 0);
  assert.equal(msUntil(null, now), 0);
});

test("sessão de duelo: criar e entrar guardam a sala e abrem o canal do tópico", async () => {
  const { cloud, calls } = fakeCloud();
  const s = createDuelSession({ game: "duelgame", level: 2, cloud, pollMs: 0 });
  await s.create();
  assert.equal(s.id, "d1");
  assert.equal(s.code, "ABC123");
  assert.equal(s.gameId, "duelgame");
  assert.equal(s.level, 2);
  assert.equal(s.rule, "first");
  assert.equal(s.maxSeconds, 120);
  assert.deepEqual(calls.find(c => c[0] === "create"), ["create", "duelgame", 2]);
  assert.deepEqual(calls.find(c => c[0] === "channel"), ["channel", "duel:d1"]);

  const outro = fakeCloud();
  const s2 = createDuelSession({ cloud: outro.cloud, pollMs: 0 });
  await s2.join("abc123");
  assert.equal(s2.gameId, "duelgame");
  assert.deepEqual(outro.calls.find(c => c[0] === "join"), ["join", "abc123"]);
});

test("sessão de duelo: pronto agenda a contagem no relógio do servidor", async () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  const { cloud } = fakeCloud({
    responses: {
      ready: { status: "running", startsAt: "2026-01-01T00:00:04Z", serverNow: "2026-01-01T00:00:00Z" },
      start: { puzzle: { cells: [1, 2] }, startsAt: "2026-01-01T00:00:04Z", serverNow: "2026-01-01T00:00:05Z", maxSeconds: 120, rule: "first" },
    },
  });
  const s = createDuelSession({ game: "duelgame", cloud, pollMs: 0, autoStart: false, now: () => now });
  await s.create();

  const counts = [];
  let started = null;
  s.on("countdown", d => counts.push(d.msLeft));
  s.on("start", d => { started = d; });

  await s.ready();
  assert.equal(s.status, "running");
  assert.deepEqual(counts, [4000], "a contagem usa startsAt - relógio do servidor");

  await s.begin();
  assert.deepEqual(started.puzzle, { cells: [1, 2] });
  assert.deepEqual(s.puzzle, { cells: [1, 2] });
});

test("sessão de duelo: finalizar manda o tabuleiro, transmite e fecha pelo estado do servidor", async () => {
  const { cloud, calls, sent } = fakeCloud({
    responses: { state: { id: "d1", status: "finished", players: [], winner: { user_id: UID } } },
  });
  const s = createDuelSession({ game: "duelgame", cloud, pollMs: 0 });
  await s.create();

  let result = null, finished = null;
  s.on("result", d => { result = d; });
  s.on("finished", d => { finished = d; });

  const ok = await s.finish({ cells: [1] }, "op-1");
  assert.equal(ok.won, true);
  assert.equal(result.won, true);
  assert.equal(finished.outcome, "win");
  assert.deepEqual(calls.find(c => c[0] === "finish"), ["finish", "d1", { cells: [1] }, "op-1"]);
  assert.ok(sent.some(m => m.event === "finish"), "avisa o oponente para atualizar");
});

test("sessão de duelo: progresso vai e volta pelo canal, sem contar o próprio eco", async () => {
  const { cloud, sent, channel } = fakeCloud();
  const s = createDuelSession({ game: "duelgame", cloud, pollMs: 0 });
  await s.create();

  assert.equal(s.progress(0.42), 0.42);
  assert.deepEqual(sent.at(-1), { type: "broadcast", event: "progress", payload: { uid: UID, value: 0.42 } });
  assert.equal(s.progress(2), 1, "o progresso é limitado a 1");
  assert.equal(s.progress(-1), 0);

  const seen = [];
  s.on("opponent", d => seen.push(d));
  channel.receive("progress", { uid: UID, value: 0.9 });       // eco do próprio cliente
  channel.receive("progress", { uid: "outro", value: 0.7 });
  assert.deepEqual(seen, [{ uid: "outro", value: 0.7 }]);
  assert.equal(s.opponentProgress, 0.7);
});

test("sessão de duelo: sair avisa e desliga o canal", async () => {
  const { cloud, calls } = fakeCloud();
  const s = createDuelSession({ game: "duelgame", cloud, pollMs: 0 });
  await s.create();
  let left = null;
  s.on("left", d => { left = d; });
  await s.leave();
  assert.equal(left.status, "cancelled");
  assert.ok(calls.some(c => c[0] === "unsubscribe"));
});

test("sessão de duelo: polling de estado encerra quando o duelo termina", async () => {
  let calls = 0;
  const { cloud } = fakeCloud({
    responses: { state: { id: "d1", status: "finished", players: [], winner: { user_id: UID } } },
  });
  const original = cloud.duelState;
  cloud.duelState = async id => { calls++; return original(id); };
  const s = createDuelSession({ game: "duelgame", cloud, pollMs: 0 });
  await s.create();
  let finished = 0;
  s.on("finished", () => { finished++; });
  await s.refresh();
  await s.refresh();
  assert.equal(calls, 2);
  assert.equal(finished, 1, "o fim é avisado uma única vez");
});

test("UI do duelo: link de convite, contagem, resultado e bloco ativo", () => {
  assert.equal(duelLink("https://x.test/jogos/duelgame/index.html?a=1#topo", "ABC123"),
    "https://x.test/jogos/duelgame/index.html?duelo=ABC123");
  assert.equal(countdownText(2600), "Começa em 3…");
  assert.equal(countdownText(0), "Já!");
  assert.equal(outcomeText("win"), "Você venceu!");
  assert.equal(outcomeText("lose", "Bia"), "Bia venceu.");
  assert.equal(outcomeText("draw"), "Empate.");
  assert.equal(outcomeText("cancelled"), "Duelo cancelado.");
  assert.equal(duelView({ status: "idle", puzzle: null }), "lobby");
  assert.equal(duelView({ status: "waiting", puzzle: null }), "lobby");
  assert.equal(duelView({ status: "running", puzzle: null }), "countdown");
  assert.equal(duelView({ status: "running", puzzle: {} }), "running");
  assert.equal(duelView({ status: "finished", puzzle: {} }), "result");
  assert.equal(duelView({ status: "cancelled", puzzle: null }), "result");
});

test("sessão de duelo: usa 2,5 s de polling por padrão", () => {
  assert.equal(DEFAULT_POLL_MS, 2500);
});

/* ---------- entrada dos duelos no hub ---------- */
test("hub de duelos: só jogos marcados como duelo aparecem", () => {
  const games = { a: { path: "games/a/" }, b: { path: "games/b/", duel: true } };
  assert.deepEqual(duelGames(games).map(([id]) => id), ["b"]);
  assert.deepEqual(duelGames(CATALOG), [], "nenhum jogo atual é de duelo: multiplayer só para jogos novos");
});

test("hub de duelos: código do convite é normalizado e validado", () => {
  assert.equal(normalizeCode(" ab-c123 "), "ABC123");
  assert.equal(isDuelCode("abc123"), true);
  assert.equal(isDuelCode("AB12"), true);
  assert.equal(isDuelCode("ab"), false);
  assert.equal(isDuelCode("abcdefghi"), false);
  assert.equal(isDuelCode(""), false);
});

test("hub de duelos: criar abre ?duelo=novo; entrar leva o id da sala", () => {
  assert.equal(duelPage({ path: "games/x/" }), "games/x/?duelo=novo");
  assert.equal(duelPage({ path: "games/x/" }, "d1"), "games/x/?duelo=d1");
  assert.equal(duelPage({ path: "games/x/?a=1" }, "d1"), "games/x/?a=1&duelo=d1");
});
