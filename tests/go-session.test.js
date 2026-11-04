/* Go online: sessão sem DOM (lobby, polling, relógios e lances).
   O servidor é a autoridade; aqui garantimos que o cliente só pede, escuta e espelha. */
import test from "node:test";
import assert from "node:assert/strict";
import { createGoSession, clocksAt, msToStart, goOutcome, GO_POLL_MS } from "../shared/go-session.js";
import { newGame, serialize } from "../games/go/domain.js";

const WHITE_UID = "00000000-0000-4000-8000-00000000000a";
const BLACK_UID = "00000000-0000-4000-8000-00000000000b";
const NOW = Date.parse("2026-01-01T00:00:00Z");
const START = "2026-01-01T00:00:04.000Z";

const players = () => [
  { user_id: WHITE_UID, nickname: "Ana", ready: true, is_me: true },
  { user_id: BLACK_UID, nickname: "Bia", ready: true, is_me: false },
];

const payload = (over = {}, go = {}) => ({
  id: "d1", code: "ABC123", gameId: "go", kind: "turn", status: "running",
  startsAt: START, serverNow: new Date(NOW).toISOString(), players: players(), winner: null,
  go: {
    state: serialize(newGame({ size: 9 }).state),
    turn: "b", version: 0, keys: ["k0"], moves: [], last: null,
    clocks: { w: 600000, b: 600000 }, colors: { white: WHITE_UID, black: BLACK_UID },
    result: null, reason: null, ...go,
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
    async goCreate(size, minutes, color, open) {
      calls.push(["create", size, minutes, color, open]);
      const colors = color === "b"
        ? { white: BLACK_UID, black: WHITE_UID }
        : { white: WHITE_UID, black: BLACK_UID };
      return responses.create ?? payload({ status: "waiting", startsAt: null, winner: null, open }, { colors });
    },
    async duelJoin(code) {
      calls.push(["join", code]);
      return responses.join ?? { id: "d1", code, gameId: "go", players: players() };
    },
    async goReady(id) {
      calls.push(["ready", id]);
      return responses.ready ?? { status: "running", startsAt: START, serverNow: new Date(NOW).toISOString() };
    },
    async goState(id) {
      calls.push(["state", id]);
      return responses.state ?? payload();
    },
    async goMove(id, move) {
      calls.push(["move", id, move]);
      return responses.move ?? payload({}, {
        state: serialize({ ...newGame({ size: 9 }).state, board: newGame({ size: 9 }).state.board.map((v, i) => (i === 40 ? 1 : v)), turn: "w" }),
        turn: "w",
        version: 1,
        colors: { white: BLACK_UID, black: WHITE_UID },
      });
    },
    async goResign(id) {
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

test("go: relógios — só o lado da vez desconta, e nada corre antes da largada", () => {
  const go = { state: { turn: "b" }, clocks: { w: 600000, b: 300000 } };
  const clockAt = Date.parse("2026-01-01T00:00:10Z");
  const startsAt = "2026-01-01T00:00:00Z";
  const at = now => clocksAt(go, { status: "running", clockAt, startsAt, now });

  assert.deepEqual(at(clockAt), { w: 600000, b: 300000 });
  assert.deepEqual(at(clockAt + 5000), { w: 600000, b: 295000 });
  assert.deepEqual(clocksAt({ ...go, state: { turn: "w" } }, { status: "running", clockAt, startsAt, now: clockAt + 5000 }), { w: 595000, b: 300000 });
  assert.deepEqual(at(clockAt - 2000), { w: 600000, b: 300000 }, "contagem não consome o relógio");
  assert.deepEqual(clocksAt(go, { status: "finished", clockAt, startsAt, now: clockAt + 5000 }), { w: 600000, b: 300000 });
  assert.deepEqual(clocksAt(go, { status: "running", clockAt, startsAt, now: clockAt + 5000, serverOffset: -5000 }), { w: 600000, b: 300000 });
  assert.deepEqual(clocksAt(go, { status: "running", clockAt, startsAt, now: clockAt + 700000 }), { w: 600000, b: 0 });
  assert.deepEqual(clocksAt(null, { status: "running" }), { w: 0, b: 0 });
});

test("go: msToStart e goOutcome — contagem pelo relógio do servidor e resultado de quem vê", () => {
  assert.equal(msToStart(START, { now: NOW }), 4000);
  assert.equal(msToStart(START, { now: NOW, serverOffset: 1000 }), 3000);
  assert.equal(msToStart(START, { now: NOW + 5000 }), 0);
  assert.equal(msToStart(null, { now: NOW }), 0);

  assert.equal(goOutcome(null, WHITE_UID), "idle");
  assert.equal(goOutcome({ status: "waiting" }, WHITE_UID), "running");
  assert.equal(goOutcome({ status: "finished", winner: { user_id: WHITE_UID } }, WHITE_UID), "win");
  assert.equal(goOutcome({ status: "finished", winner: { user_id: BLACK_UID } }, WHITE_UID), "lose");
  assert.equal(goOutcome({ status: "finished", winner: null }, WHITE_UID), "draw");
  assert.equal(goOutcome({ status: "cancelled" }, WHITE_UID), "cancelled");
});

test("go: criar sala guarda tamanho/código/cor, abre o canal privado e fica no lobby", async () => {
  const { cloud, calls } = fakeCloud();
  const s = createGoSession({ cloud, pollMs: 0, now: () => NOW });

  await s.create(9, 10, "b", false);
  assert.equal(s.id, "d1");
  assert.equal(s.code, "ABC123");
  assert.equal(s.status, "waiting");
  assert.equal(s.myColor, "b");
  assert.equal(s.go.state.size, 9);
  assert.equal(s.open, false, "sala fechada");
  assert.deepEqual(calls.find(c => c[0] === "create"), ["create", 9, 10, "b", false]);
  assert.deepEqual(calls.find(c => c[0] === "channel"), ["channel", "duel:d1", { config: { private: true } }]);
  assert.deepEqual(calls.find(c => c[0] === "track"), ["track", { uid: WHITE_UID }]);
  assert.deepEqual(s.clocks(), { w: 600000, b: 600000 }, "no lobby o relógio não corre");
  s.destroy();
});

test("go: pronto agenda a largada; só quem é da vez e depois da contagem pode jogar", async () => {
  const { cloud, calls } = fakeCloud();
  const s = createGoSession({ cloud, pollMs: 0, now: () => NOW });
  await s.create(13, 30, "w");
  await s.ready();

  assert.equal(s.status, "running");
  assert.equal(s.msToStart(), 4000);
  assert.equal(s.isMyTurn(), false, "antes da largada ninguém joga");
  assert.equal(s.isMyTurn(NOW + 4000), false, "pretas começam na partida equilibrada");
  assert.deepEqual(calls.find(c => c[0] === "ready"), ["ready", "d1"]);
  assert.equal(s.clocks(NOW + 4000).w, 600000);
  assert.equal(s.clocks(NOW + 9000).b, 595000, "só o relógio das pretas corre");
  s.destroy();
});

test("go: entrar por código busca o estado completo; anexar por id não entra de novo", async () => {
  const { cloud, calls } = fakeCloud();
  const s = createGoSession({ cloud, pollMs: 0, now: () => NOW });

  await s.join("abc123");
  assert.deepEqual(calls.find(c => c[0] === "join"), ["join", "abc123"]);
  assert.deepEqual(calls.find(c => c[0] === "state"), ["state", "d1"]);
  assert.equal(s.status, "running");
  assert.equal(s.go.turn, "b");

  calls.length = 0;
  const s2 = createGoSession({ cloud, pollMs: 0, now: () => NOW });
  await s2.attach("d1");
  assert.equal(calls.some(c => c[0] === "join"), false, "anexar não ocupa vaga");
  assert.deepEqual(calls.find(c => c[0] === "state"), ["state", "d1"]);
  s.destroy(); s2.destroy();
});

test("go: lance manda o ponto, aplica o estado novo e transmite pelo Realtime", async () => {
  const { cloud, calls, sent } = fakeCloud();
  const s = createGoSession({ cloud, pollMs: 0, now: () => NOW });
  await s.create(9, 10, "b");

  await s.move({ point: 40 });
  assert.deepEqual(calls.find(c => c[0] === "move"), ["move", "d1", { point: 40 }]);
  assert.equal(s.go.turn, "w");
  assert.equal(s.go.version, 1);
  assert.equal(s.go.state.board[40], 1, "a pedra preta de quem criou a sala");
  assert.equal(s.isMyTurn(NOW + 4000), false, "depois do lance passa a vez");
  assert.deepEqual(sent.at(-1), { type: "broadcast", event: "move", payload: { uid: WHITE_UID, version: 1 } });
  s.destroy();
});

test("go: desistir encerra pelo estado do servidor e avisa uma única vez", async () => {
  const finishedState = payload({ status: "finished", winner: { user_id: WHITE_UID } }, { result: "white", reason: "resign" });
  const { cloud, calls } = fakeCloud({ responses: { resign: finishedState, state: finishedState } });
  const s = createGoSession({ cloud, pollMs: 0, now: () => NOW });
  await s.create(9, 10, "w");
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

test("go: sair cancela a sala e destrói o canal", async () => {
  const { cloud, calls } = fakeCloud();
  const s = createGoSession({ cloud, pollMs: 0, now: () => NOW });
  await s.create(9, 10, "b");

  await s.leave();
  assert.deepEqual(calls.find(c => c[0] === "leave"), ["leave", "d1"]);
  assert.ok(calls.some(c => c[0] === "unsubscribe"));
  assert.equal(await s.refresh(), null, "depois de sair a sessão não consulta mais");
  assert.equal(GO_POLL_MS, 1500);
});

test("go: criador que sai com desafiante na sala desiste (duel_decline)", async () => {
  const waiting = payload({
    status: "waiting", startsAt: null, createdBy: WHITE_UID,
    players: [
      { user_id: WHITE_UID, nickname: "Ana", ready: false, is_me: true },
      { user_id: BLACK_UID, nickname: "Bia", ready: true, is_me: false },
    ],
  });
  const f = fakeCloud({ uid: WHITE_UID, responses: { state: waiting } });
  f.cloud.duelDecline = async id => { f.calls.push(["decline", id]); return { status: "cancelled", cancelReason: "declined" }; };
  const s = createGoSession({ cloud: f.cloud, pollMs: 0, now: () => NOW });
  await s.attach("d1");

  await s.leave();
  assert.deepEqual(f.calls.filter(c => c[0] === "decline"), [["decline", "d1"]]);
  assert.equal(f.calls.some(c => c[0] === "leave"), false);
});

test("go: attach devolve o estado da sala (e não a função que o monta)", async () => {
  const { cloud } = fakeCloud({ uid: WHITE_UID, responses: { state: payload({ status: "waiting", createdBy: WHITE_UID }) } });
  const s = createGoSession({ cloud, pollMs: 0, now: () => NOW });
  const st = await s.attach("d1");
  assert.equal(typeof st, "object");
  assert.equal(st.id, "d1");
  assert.equal(st.createdBy, WHITE_UID);
});
