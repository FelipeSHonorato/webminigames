/* Gamão online: a sessão sem DOM (lobby, polling, relógios e lances).
   O servidor é a autoridade; aqui garantimos que o cliente só pede, escuta e espelha. */
import test from "node:test";
import assert from "node:assert/strict";
import { createGamaoSession, clocksAt, msToStart, gamaoOutcome, GAMAO_POLL_MS } from "../shared/gamao-session.js";
import { newGame, serialize } from "../games/gamao/domain.js";

const WHITE_UID = "00000000-0000-4000-8000-00000000000a";
const BLACK_UID = "00000000-0000-4000-8000-00000000000b";
const NOW = Date.parse("2026-01-01T00:00:00Z");
const START = "2026-01-01T00:00:04.000Z";

const players = () => [
  { user_id: WHITE_UID, nickname: "Ana", ready: true, is_me: true },
  { user_id: BLACK_UID, nickname: "Bia", ready: true, is_me: false },
];

const payload = (over = {}, gamao = {}) => ({
  id: "d1", code: "ABC123", gameId: "gamao", kind: "turn", status: "running",
  startsAt: START, serverNow: new Date(NOW).toISOString(), players: players(), winner: null,
  gamao: {
    state: serialize(newGame({ w: 6, b: 5 }).state),
    turn: "w", version: 0, keys: ["k0"], moves: [], last: null,
    clocks: { w: 600000, b: 600000 }, colors: { white: WHITE_UID, black: BLACK_UID },
    result: null, reason: null, ...gamao,
  },
  ...over,
});

function fakeCloud({ uid = WHITE_UID, responses = {} } = {}) {
  const calls = [], sent = [];
  const channel = {
    topic: null, handlers: {},
    on(event, filter, cb) { calls.push(["on", filter.event]); this.handlers[filter.event] = cb; return this; },
    subscribe(cb) { calls.push(["subscribe"]); cb?.("SUBSCRIBED"); return this; },
    track(data) { calls.push(["track", data]); },
    send(message) { sent.push(message); },
    unsubscribe() { calls.push(["unsubscribe"]); },
  };
  const cloud = {
    uid,
    duelTopic: id => `duel:${id}`,
    channel(topic, options) { calls.push(["channel", topic, options]); channel.topic = topic; return channel; },
    async gamaoCreate(minutes, color, open) {
      calls.push(["create", minutes, color, open]);
      const colors = color === "b"
        ? { white: BLACK_UID, black: WHITE_UID }
        : { white: WHITE_UID, black: BLACK_UID };
      return responses.create ?? payload({ status: "waiting", startsAt: null, winner: null, open }, { colors });
    },
    async duelJoin(code) {
      calls.push(["join", code]);
      return responses.join ?? { id: "d1", code, gameId: "gamao", players: players() };
    },
    async duelReady(id) {
      calls.push(["ready", id]);
      return responses.ready ?? { status: "running", startsAt: START, serverNow: new Date(NOW).toISOString() };
    },
    async gamaoState(id) {
      calls.push(["state", id]);
      return responses.state ?? payload();
    },
    async gamaoMove(id, move) {
      calls.push(["move", id, move]);
      return responses.move ?? payload({}, {
        state: serialize({ ...newGame({ w: 6, b: 5 }).state, turn: "b" }),
        turn: "b",
        version: 1,
      });
    },
    async gamaoResign(id) {
      calls.push(["resign", id]);
      return responses.resign ?? payload({ status: "finished", winner: { user_id: WHITE_UID } }, { result: "white", reason: "resign" });
    },
    async duelLeave(id) {
      calls.push(["leave", id]);
      return responses.leave ?? { status: "cancelled" };
    },
  };
  return { cloud, calls, sent };
}

test("gamão: relógios — só o lado da vez desconta, e nada corre antes da largada", () => {
  const gamao = { state: { turn: "w" }, clocks: { w: 600000, b: 300000 } };
  const clockAt = Date.parse("2026-01-01T00:00:10Z");
  const startsAt = "2026-01-01T00:00:00Z";
  const at = now => clocksAt(gamao, { status: "running", clockAt, startsAt, now });

  assert.deepEqual(at(clockAt), { w: 600000, b: 300000 });
  assert.deepEqual(at(clockAt + 5000), { w: 595000, b: 300000 });
  assert.deepEqual(clocksAt({ ...gamao, state: { turn: "b" } }, { status: "running", clockAt, startsAt, now: clockAt + 5000 }), { w: 600000, b: 295000 });
  assert.deepEqual(at(clockAt - 2000), { w: 600000, b: 300000 }, "contagem não consome o relógio");
  assert.deepEqual(clocksAt(gamao, { status: "finished", clockAt, startsAt, now: clockAt + 5000 }), { w: 600000, b: 300000 });
  assert.deepEqual(clocksAt(gamao, { status: "running", clockAt, startsAt, now: clockAt + 5000, serverOffset: -5000 }), { w: 600000, b: 300000 });
  assert.deepEqual(clocksAt(gamao, { status: "running", clockAt, startsAt, now: clockAt + 700000 }), { w: 0, b: 300000 });
});

test("gamão: msToStart e gamaoOutcome — contagem pelo relógio do servidor e resultado de quem vê", () => {
  assert.equal(msToStart(START, { now: NOW }), 4000);
  assert.equal(msToStart(START, { now: NOW, serverOffset: 1000 }), 3000);
  assert.equal(msToStart(START, { now: NOW + 5000 }), 0);
  assert.equal(msToStart(null, { now: NOW }), 0);

  assert.equal(gamaoOutcome(null, WHITE_UID), "idle");
  assert.equal(gamaoOutcome({ status: "waiting" }, WHITE_UID), "running");
  assert.equal(gamaoOutcome({ status: "finished", winner: { user_id: WHITE_UID } }, WHITE_UID), "win");
  assert.equal(gamaoOutcome({ status: "finished", winner: { user_id: BLACK_UID } }, WHITE_UID), "lose");
  assert.equal(gamaoOutcome({ status: "finished", winner: null }, WHITE_UID), "draw");
  assert.equal(gamaoOutcome({ status: "cancelled" }, WHITE_UID), "cancelled");
});

test("gamão: criar sala guarda código/cor, abre o canal privado e fica no lobby", async () => {
  const { cloud, calls } = fakeCloud();
  const s = createGamaoSession({ cloud, pollMs: 0, now: () => NOW });

  await s.create(10, "b", false);
  assert.equal(s.id, "d1");
  assert.equal(s.code, "ABC123");
  assert.equal(s.status, "waiting");
  assert.equal(s.myColor, "b");
  assert.equal(s.open, false, "sala fechada");
  assert.deepEqual(calls.find(c => c[0] === "create"), ["create", 10, "b", false]);
  assert.deepEqual(calls.find(c => c[0] === "channel"), ["channel", "duel:d1", { config: { private: true } }]);
  assert.deepEqual(calls.find(c => c[0] === "track"), ["track", { uid: WHITE_UID }]);
  assert.deepEqual(s.clocks(), { w: 600000, b: 600000 }, "no lobby o relógio não corre");
  s.destroy();
});

test("gamão: pronto agenda a largada; só quem é da vez e depois da contagem pode jogar", async () => {
  const { cloud, calls } = fakeCloud();
  const s = createGamaoSession({ cloud, pollMs: 0, now: () => NOW });
  await s.create(10, "w");
  await s.ready();

  assert.equal(s.status, "running");
  assert.equal(s.msToStart(), 4000);
  assert.equal(s.isMyTurn(), false, "antes da largada ninguém joga");
  assert.equal(s.isMyTurn(NOW + 4000), true);
  assert.deepEqual(calls.find(c => c[0] === "ready"), ["ready", "d1"]);
  assert.equal(s.clocks(NOW + 4000).w, 600000);
  assert.equal(s.clocks(NOW + 9000).w, 595000);
  s.destroy();
});

test("gamão: entrar por código busca o estado completo; anexar por id não entra de novo", async () => {
  const { cloud, calls } = fakeCloud();
  const s = createGamaoSession({ cloud, pollMs: 0, now: () => NOW });

  await s.join("abc123");
  assert.deepEqual(calls.find(c => c[0] === "join"), ["join", "abc123"]);
  assert.deepEqual(calls.find(c => c[0] === "state"), ["state", "d1"]);
  assert.equal(s.status, "running");
  assert.equal(s.gamao.turn, "w");

  calls.length = 0;
  const s2 = createGamaoSession({ cloud, pollMs: 0, now: () => NOW });
  await s2.attach("d1");
  assert.equal(calls.some(c => c[0] === "join"), false, "anexar não ocupa vaga");
  assert.deepEqual(calls.find(c => c[0] === "state"), ["state", "d1"]);
  s.destroy(); s2.destroy();
});

test("gamão: lance manda from/to/die, aplica o estado novo e transmite pelo Realtime", async () => {
  const { cloud, calls, sent } = fakeCloud();
  const s = createGamaoSession({ cloud, pollMs: 0, now: () => NOW });
  await s.create(10, "w");

  await s.move({ from: 13, to: 7, die: 6 });
  assert.deepEqual(calls.find(c => c[0] === "move"), ["move", "d1", { from: 13, to: 7, die: 6 }]);
  assert.equal(s.gamao.turn, "b");
  assert.equal(s.gamao.version, 1);
  assert.equal(s.isMyTurn(NOW + 4000), false, "depois do lance passa a vez");
  assert.deepEqual(sent.at(-1), { type: "broadcast", event: "move", payload: { uid: WHITE_UID, version: 1 } });
  s.destroy();
});

test("gamão: desistir encerra pelo estado do servidor e avisa uma única vez", async () => {
  const finishedState = payload({ status: "finished", winner: { user_id: WHITE_UID } }, { result: "white", reason: "resign" });
  const { cloud, calls } = fakeCloud({ responses: { resign: finishedState, state: finishedState } });
  const s = createGamaoSession({ cloud, pollMs: 0, now: () => NOW });
  await s.create(10, "w");
  let finished = 0, detail = null;
  s.on("finished", d => { finished++; detail = d; });

  await s.resign();
  assert.deepEqual(calls.find(c => c[0] === "resign"), ["resign", "d1"]);
  assert.equal(s.status, "finished");
  assert.equal(s.outcome, "win");
  assert.equal(finished, 1);
  assert.equal(detail.outcome, "win");

  await s.refresh();
  assert.equal(finished, 1);
  s.destroy();
});

test("gamão: sair cancela a sala e destrói o canal", async () => {
  const { cloud, calls } = fakeCloud();
  const s = createGamaoSession({ cloud, pollMs: 0, now: () => NOW });
  await s.create(10, "b");

  await s.leave();
  assert.deepEqual(calls.find(c => c[0] === "leave"), ["leave", "d1"]);
  assert.ok(calls.some(c => c[0] === "unsubscribe"));
  assert.equal(await s.refresh(), null, "depois de sair a sessão não consulta mais");
  assert.equal(GAMAO_POLL_MS, 1500);
});

test("gamão: criador que sai com desafiante na sala desiste (duel_decline)", async () => {
  const waiting = payload({
    status: "waiting", startsAt: null, createdBy: WHITE_UID,
    players: [
      { user_id: WHITE_UID, nickname: "Ana", ready: false, is_me: true },
      { user_id: BLACK_UID, nickname: "Bia", ready: true, is_me: false },
    ],
  });
  const f = fakeCloud({ uid: WHITE_UID, responses: { state: waiting } });
  f.cloud.duelDecline = async id => { f.calls.push(["decline", id]); return { status: "cancelled", cancelReason: "declined" }; };
  const s = createGamaoSession({ cloud: f.cloud, pollMs: 0, now: () => NOW });
  await s.attach("d1");

  await s.leave();
  assert.deepEqual(f.calls.filter(c => c[0] === "decline"), [["decline", "d1"]]);
  assert.equal(f.calls.some(c => c[0] === "leave"), false);
});

test("gamão: attach devolve o estado da sala (e não a função que o monta)", async () => {
  const { cloud } = fakeCloud({ uid: WHITE_UID, responses: { state: payload({ status: "waiting", createdBy: WHITE_UID }) } });
  const s = createGamaoSession({ cloud, pollMs: 0, now: () => NOW });
  const st = await s.attach("d1");
  assert.equal(typeof st, "object");
  assert.equal(st.id, "d1");
  assert.equal(st.createdBy, WHITE_UID);
});
