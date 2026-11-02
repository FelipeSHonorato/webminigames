/* Dama online: a sessão sem DOM (lobby, polling, relógios e lances).
   O servidor é a autoridade; aqui garantimos que o cliente só pede, escuta e espelha. */
import test from "node:test";
import assert from "node:assert/strict";
import { createDamaSession, clocksAt, msToStart, damaOutcome, DAMA_POLL_MS } from "../shared/dama-session.js";
import { START_POSITION } from "../games/dama/domain.js";

const WHITE_UID = "00000000-0000-4000-8000-00000000000a";
const BLACK_UID = "00000000-0000-4000-8000-00000000000b";
const NOW = Date.parse("2026-01-01T00:00:00Z");
const START = "2026-01-01T00:00:04.000Z";

const players = () => [
  { user_id: WHITE_UID, nickname: "Ana", ready: true, is_me: true },
  { user_id: BLACK_UID, nickname: "Bia", ready: true, is_me: false },
];

const payload = (over = {}, dama = {}) => ({
  id: "d1", code: "ABC123", gameId: "dama", kind: "turn", status: "running",
  startsAt: START, serverNow: new Date(NOW).toISOString(), players: players(), winner: null,
  dama: {
    position: START_POSITION, turn: "w", version: 0, keys: ["k0"], moves: [], last: null,
    clocks: { w: 600000, b: 600000 }, colors: { white: WHITE_UID, black: BLACK_UID },
    result: null, reason: null, ...dama,
  },
  ...over,
});

/** Nuvem de mentira: registra chamadas, guarda o que foi transmitido e deixa trocar as respostas. */
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
    async damaCreate(minutes, color, open) {
      calls.push(["create", minutes, color, open]);
      return responses.create ?? payload({ status: "waiting", startsAt: null, winner: null, open });
    },
    async duelJoin(code) {
      calls.push(["join", code]);
      return responses.join ?? { id: "d1", code, gameId: "dama", players: players() };
    },
    async duelReady(id) {
      calls.push(["ready", id]);
      return responses.ready ?? { status: "running", startsAt: START, serverNow: new Date(NOW).toISOString() };
    },
    async damaState(id) {
      calls.push(["state", id]);
      return responses.state ?? payload();
    },
    async damaMove(id, move) {
      calls.push(["move", id, move]);
      return responses.move ?? payload({}, { turn: "b", version: 1 });
    },
    async damaResign(id) {
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

test("dama: relógios — só o lado da vez desconta, e nada corre antes da largada", () => {
  const dama = { turn: "w", clocks: { w: 600000, b: 300000 } };
  const clockAt = Date.parse("2026-01-01T00:00:10Z");
  const startsAt = "2026-01-01T00:00:00Z";
  const at = now => clocksAt(dama, { status: "running", clockAt, startsAt, now });

  assert.deepEqual(at(clockAt), { w: 600000, b: 300000 });
  assert.deepEqual(at(clockAt + 5000), { w: 595000, b: 300000 });
  assert.deepEqual(clocksAt({ ...dama, turn: "b" }, { status: "running", clockAt, startsAt, now: clockAt + 5000 }), { w: 600000, b: 295000 });
  assert.deepEqual(at(clockAt - 2000), { w: 600000, b: 300000 }, "contagem não consome o relógio");
  assert.deepEqual(clocksAt(dama, { status: "finished", clockAt, startsAt, now: clockAt + 5000 }), { w: 600000, b: 300000 });
  assert.deepEqual(clocksAt(dama, { status: "running", clockAt, startsAt, now: clockAt + 5000, serverOffset: -5000 }), { w: 600000, b: 300000 });
  assert.deepEqual(clocksAt(dama, { status: "running", clockAt, startsAt, now: clockAt + 700000 }), { w: 0, b: 300000 });
});

test("dama: msToStart e damaOutcome — contagem pelo relógio do servidor e resultado de quem vê", () => {
  assert.equal(msToStart(START, { now: NOW }), 4000);
  assert.equal(msToStart(START, { now: NOW, serverOffset: 1000 }), 3000);
  assert.equal(msToStart(START, { now: NOW + 5000 }), 0);
  assert.equal(msToStart(null, { now: NOW }), 0);

  assert.equal(damaOutcome(null, WHITE_UID), "idle");
  assert.equal(damaOutcome({ status: "waiting" }, WHITE_UID), "running");
  assert.equal(damaOutcome({ status: "finished", winner: { user_id: WHITE_UID } }, WHITE_UID), "win");
  assert.equal(damaOutcome({ status: "finished", winner: { user_id: BLACK_UID } }, WHITE_UID), "lose");
  assert.equal(damaOutcome({ status: "finished", winner: null }, WHITE_UID), "draw");
  assert.equal(damaOutcome({ status: "cancelled" }, WHITE_UID), "cancelled");
});

test("dama: criar sala guarda código/cor, abre o canal privado e fica no lobby", async () => {
  const { cloud, calls } = fakeCloud();
  const s = createDamaSession({ cloud, pollMs: 0, now: () => NOW });

  await s.create(10, "w");
  assert.equal(s.id, "d1");
  assert.equal(s.code, "ABC123");
  assert.equal(s.status, "waiting");
  assert.equal(s.myColor, "w");
  assert.equal(s.open, true, "sala aberta por padrão");
  assert.deepEqual(calls.find(c => c[0] === "create"), ["create", 10, "w", true]);
  assert.deepEqual(calls.find(c => c[0] === "channel"), ["channel", "duel:d1", { config: { private: true } }]);
  assert.deepEqual(calls.find(c => c[0] === "track"), ["track", { uid: WHITE_UID }]);
  assert.deepEqual(s.clocks(), { w: 600000, b: 600000 }, "no lobby o relógio não corre");
  s.destroy();
});

test("dama: sala fechada é criada com `open: false` e o lobby sabe disso", async () => {
  const { cloud, calls } = fakeCloud();
  const s = createDamaSession({ cloud, pollMs: 0, now: () => NOW });

  await s.create(10, "w", false);
  assert.equal(s.open, false);
  assert.deepEqual(calls.find(c => c[0] === "create"), ["create", 10, "w", false]);
  s.destroy();
});

test("dama: pronto agenda a largada; só quem é da vez e depois da contagem pode jogar", async () => {
  const { cloud, calls } = fakeCloud();
  const s = createDamaSession({ cloud, pollMs: 0, now: () => NOW });
  await s.create(10, "w");
  await s.ready();

  assert.equal(s.status, "running");
  assert.equal(s.msToStart(), 4000);
  assert.equal(s.isMyTurn(), false, "antes da largada ninguém joga");
  assert.equal(s.isMyTurn(NOW + 4000), true);
  assert.equal(s.isMyTurn(NOW + 4000 + 1), true);
  assert.deepEqual(calls.find(c => c[0] === "ready"), ["ready", "d1"]);
  assert.equal(s.clocks(NOW + 4000).w, 600000);
  assert.equal(s.clocks(NOW + 9000).w, 595000);
  s.destroy();
});

test("dama: entrar por código busca o estado completo; anexar por id não entra de novo", async () => {
  const { cloud, calls } = fakeCloud();
  const s = createDamaSession({ cloud, pollMs: 0, now: () => NOW });

  await s.join("abc123");
  assert.deepEqual(calls.find(c => c[0] === "join"), ["join", "abc123"]);
  assert.deepEqual(calls.find(c => c[0] === "state"), ["state", "d1"]);
  assert.equal(s.status, "running");
  assert.equal(s.myColor, "w");

  calls.length = 0;
  const s2 = createDamaSession({ cloud, pollMs: 0, now: () => NOW });
  await s2.attach("d1");
  assert.equal(calls.some(c => c[0] === "join"), false, "anexar não ocupa vaga");
  assert.deepEqual(calls.find(c => c[0] === "state"), ["state", "d1"]);
  s.destroy(); s2.destroy();
});

test("dama: lance manda o caminho completo, aplica o estado novo e transmite pelo Realtime", async () => {
  const { cloud, calls, sent } = fakeCloud();
  const s = createDamaSession({ cloud, pollMs: 0, now: () => NOW });
  await s.create(10, "w");

  await s.move("c3d4");
  assert.deepEqual(calls.find(c => c[0] === "move"), ["move", "d1", "c3d4"]);
  assert.equal(s.dama.turn, "b");
  assert.equal(s.dama.version, 1);
  assert.equal(s.isMyTurn(NOW + 4000), false, "depois do lance passa a vez");
  assert.deepEqual(sent.at(-1), { type: "broadcast", event: "move", payload: { uid: WHITE_UID, version: 1 } });
  s.destroy();
});

test("dama: desistir encerra pelo estado do servidor e avisa uma única vez", async () => {
  const finishedState = payload({ status: "finished", winner: { user_id: WHITE_UID } }, { result: "white", reason: "resign" });
  const { cloud, calls } = fakeCloud({ responses: { resign: finishedState, state: finishedState } });
  const s = createDamaSession({ cloud, pollMs: 0, now: () => NOW });
  await s.create(10, "w");
  let finished = 0, detail = null;
  s.on("finished", d => { finished++; detail = d; });

  await s.resign();
  assert.deepEqual(calls.find(c => c[0] === "resign"), ["resign", "d1"]);
  assert.equal(s.status, "finished");
  assert.equal(s.outcome, "win");
  assert.equal(finished, 1);
  assert.equal(detail.outcome, "win");

  await s.refresh();                              // o polling não deve avisar de novo
  assert.equal(finished, 1);
  s.destroy();
});

test("dama: sair cancela a sala e destrói o canal", async () => {
  const { cloud, calls } = fakeCloud();
  const s = createDamaSession({ cloud, pollMs: 0, now: () => NOW });
  await s.create(10, "b");

  await s.leave();
  assert.deepEqual(calls.find(c => c[0] === "leave"), ["leave", "d1"]);
  assert.ok(calls.some(c => c[0] === "unsubscribe"));
  assert.equal(await s.refresh(), null, "depois de sair a sessão não consulta mais");
  assert.equal(DAMA_POLL_MS, 1500);
});

/* ---------- aviso de desafiante: criador, desistência e motivo do cancelamento ---------- */

const waitingRoom = (over = {}) => payload({
  status: "waiting", startsAt: null, createdBy: WHITE_UID,
  players: [
    { user_id: WHITE_UID, nickname: "Ana", ready: false, is_me: true },
    { user_id: BLACK_UID, nickname: "Bia", ready: true, is_me: false },
  ],
  ...over,
});

test("dama: sabe quem criou a sala e o motivo do cancelamento", async () => {
  const { cloud } = fakeCloud({ uid: WHITE_UID, responses: { state: waitingRoom() } });
  const s = createDamaSession({ cloud, pollMs: 0, now: () => NOW });
  await s.attach("d1");
  assert.equal(s.createdBy, WHITE_UID);
  assert.equal(s.isCreator(), true, "criador");
  assert.equal(s.cancelReason, null);

  const joiner = createDamaSession({ cloud: fakeCloud({ uid: BLACK_UID, responses: { state: waitingRoom() } }).cloud, pollMs: 0, now: () => NOW });
  await joiner.attach("d1");
  assert.equal(joiner.isCreator(), false, "quem entrou na sala não é o criador");

  const declined = fakeCloud({ uid: BLACK_UID, responses: { state: waitingRoom({ status: "cancelled", cancelReason: "declined" }) } });
  const j2 = createDamaSession({ cloud: declined.cloud, pollMs: 0, now: () => NOW });
  const done = [];
  j2.on("finished", d => done.push(d.outcome));
  await j2.attach("d1");
  assert.equal(j2.status, "cancelled");
  assert.equal(j2.cancelReason, "declined", "o desafiante descobre que o criador desistiu");
  assert.equal(j2.outcome, "cancelled", "cancelar nunca vira vitória nem derrota");
  assert.deepEqual(done, ["cancelled"]);
});

test("dama: o criador que sai com um desafiante na sala DESISTE (duel_decline), sem derrota para ninguém", async () => {
  const f = fakeCloud({ uid: WHITE_UID, responses: { state: waitingRoom() } });
  f.cloud.duelDecline = async id => { f.calls.push(["decline", id]); return { status: "cancelled", cancelReason: "declined" }; };
  const s = createDamaSession({ cloud: f.cloud, pollMs: 0, now: () => NOW });
  await s.attach("d1");

  await s.leave();
  assert.deepEqual(f.calls.filter(c => c[0] === "decline"), [["decline", "d1"]]);
  assert.equal(f.calls.some(c => c[0] === "leave"), false, "não usa o duel_leave, que não registra o motivo");
});

test("dama: sair sem desafiante, ou como desafiante, continua sendo o duel_leave de sempre", async () => {
  const alone = fakeCloud({
    uid: WHITE_UID,
    responses: { state: waitingRoom({ players: [{ user_id: WHITE_UID, nickname: "Ana", ready: false, is_me: true }] }) },
  });
  alone.cloud.duelDecline = async () => { throw new Error("não devia desistir"); };
  const a = createDamaSession({ cloud: alone.cloud, pollMs: 0, now: () => NOW });
  await a.attach("d1");
  await a.leave();
  assert.deepEqual(alone.calls.find(c => c[0] === "leave"), ["leave", "d1"]);

  const guest = fakeCloud({ uid: BLACK_UID, responses: { state: waitingRoom() } });
  guest.cloud.duelDecline = async () => { throw new Error("só o criador desiste"); };
  const b = createDamaSession({ cloud: guest.cloud, pollMs: 0, now: () => NOW });
  await b.attach("d1");
  await b.leave();
  assert.deepEqual(guest.calls.find(c => c[0] === "leave"), ["leave", "d1"], "o desafiante só libera a vaga");
});

test("dama: attach devolve o estado da sala (e não a função que o monta)", async () => {
  const { cloud } = fakeCloud({ uid: WHITE_UID, responses: { state: waitingRoom() } });
  const s = createDamaSession({ cloud, pollMs: 0, now: () => NOW });
  const st = await s.attach("d1");
  assert.equal(typeof st, "object");
  assert.equal(st.id, "d1");
  assert.equal(st.createdBy, WHITE_UID);
});
