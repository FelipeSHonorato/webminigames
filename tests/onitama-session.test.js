/* Onitama online: a sessão sem DOM (lobby, polling, relógios e lances).
   O servidor é a autoridade; aqui garantimos que o cliente só pede, escuta e espelha. */
import test from "node:test";
import assert from "node:assert/strict";
import { createOnitamaSession, clocksAt, msToStart, onitamaOutcome, ONITAMA_POLL_MS } from "../shared/onitama-session.js";
import { START_POSITION } from "../games/onitama/domain.js";

const POSITION = `${START_POSITION} b tiger,dragon frog,rabbit crab`;

const BLUE_UID = "00000000-0000-4000-8000-00000000000a";
const RED_UID = "00000000-0000-4000-8000-00000000000b";
const NOW = Date.parse("2026-01-01T00:00:00Z");
const START = "2026-01-01T00:00:04.000Z";

const players = () => [
  { user_id: BLUE_UID, nickname: "Ana", ready: true, is_me: true },
  { user_id: RED_UID, nickname: "Bia", ready: true, is_me: false },
];

const payload = (over = {}, onitama = {}) => ({
  id: "d1", code: "ABC123", gameId: "onitama", kind: "turn", status: "running",
  startsAt: START, serverNow: new Date(NOW).toISOString(), players: players(), winner: null,
  onitama: {
    position: POSITION, turn: "b", version: 0, keys: ["k0"], moves: [], last: null,
    clocks: { b: 600000, r: 600000 }, colors: { blue: BLUE_UID, red: RED_UID },
    result: null, reason: null, ...onitama,
  },
  ...over,
});

/** Nuvem de mentira: registra chamadas, guarda o que foi transmitido e deixa trocar as respostas. */
function fakeCloud({ uid = BLUE_UID, responses = {} } = {}) {
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
    async onitamaCreate(minutes, color, open) {
      calls.push(["create", minutes, color, open]);
      return responses.create ?? payload({ status: "waiting", startsAt: null, winner: null, open });
    },
    async duelJoin(code) {
      calls.push(["join", code]);
      return responses.join ?? { id: "d1", code, gameId: "onitama", players: players() };
    },
    async duelReady(id) {
      calls.push(["ready", id]);
      return responses.ready ?? { status: "running", startsAt: START, serverNow: new Date(NOW).toISOString() };
    },
    async onitamaState(id) {
      calls.push(["state", id]);
      return responses.state ?? payload();
    },
    async onitamaMove(id, move) {
      calls.push(["move", id, move]);
      return responses.move ?? payload({}, { turn: "r", version: 1 });
    },
    async onitamaResign(id) {
      calls.push(["resign", id]);
      return responses.resign ?? payload({ status: "finished", winner: { user_id: BLUE_UID } }, { result: "blue", reason: "resign" });
    },
    async duelLeave(id) {
      calls.push(["leave", id]);
      return responses.leave ?? { status: "cancelled" };
    },
  };
  return { cloud, calls, sent };
}

test("onitama: relógios — só o lado da vez desconta, e nada corre antes da largada", () => {
  const onitama = { turn: "b", clocks: { b: 600000, r: 300000 } };
  const clockAt = Date.parse("2026-01-01T00:00:10Z");
  const startsAt = "2026-01-01T00:00:00Z";
  const at = now => clocksAt(onitama, { status: "running", clockAt, startsAt, now });

  assert.deepEqual(at(clockAt), { b: 600000, r: 300000 });
  assert.deepEqual(at(clockAt + 5000), { b: 595000, r: 300000 });
  assert.deepEqual(clocksAt({ ...onitama, turn: "r" }, { status: "running", clockAt, startsAt, now: clockAt + 5000 }), { b: 600000, r: 295000 });
  assert.deepEqual(at(clockAt - 2000), { b: 600000, r: 300000 }, "contagem não consome o relógio");
  assert.deepEqual(clocksAt(onitama, { status: "finished", clockAt, startsAt, now: clockAt + 5000 }), { b: 600000, r: 300000 });
  assert.deepEqual(clocksAt(onitama, { status: "running", clockAt, startsAt, now: clockAt + 5000, serverOffset: -5000 }), { b: 600000, r: 300000 });
  assert.deepEqual(clocksAt(onitama, { status: "running", clockAt, startsAt, now: clockAt + 700000 }), { b: 0, r: 300000 });
});

test("onitama: msToStart e onitamaOutcome — contagem pelo relógio do servidor e resultado de quem vê", () => {
  assert.equal(msToStart(START, { now: NOW }), 4000);
  assert.equal(msToStart(START, { now: NOW, serverOffset: 1000 }), 3000);
  assert.equal(msToStart(START, { now: NOW + 5000 }), 0);
  assert.equal(msToStart(null, { now: NOW }), 0);

  assert.equal(onitamaOutcome(null, BLUE_UID), "idle");
  assert.equal(onitamaOutcome({ status: "waiting" }, BLUE_UID), "running");
  assert.equal(onitamaOutcome({ status: "finished", winner: { user_id: BLUE_UID } }, BLUE_UID), "win");
  assert.equal(onitamaOutcome({ status: "finished", winner: { user_id: RED_UID } }, BLUE_UID), "lose");
  assert.equal(onitamaOutcome({ status: "finished", winner: null }, BLUE_UID), "draw");
  assert.equal(onitamaOutcome({ status: "cancelled" }, BLUE_UID), "cancelled");
});

test("onitama: criar sala guarda código/cor, abre o canal privado e fica no lobby", async () => {
  const { cloud, calls } = fakeCloud();
  const s = createOnitamaSession({ cloud, pollMs: 0, now: () => NOW });

  await s.create(10, "b");
  assert.equal(s.id, "d1");
  assert.equal(s.code, "ABC123");
  assert.equal(s.status, "waiting");
  assert.equal(s.myColor, "b");
  assert.equal(s.open, true, "sala aberta por padrão");
  assert.deepEqual(calls.find(c => c[0] === "create"), ["create", 10, "b", true]);
  assert.deepEqual(calls.find(c => c[0] === "channel"), ["channel", "duel:d1", { config: { private: true } }]);
  assert.deepEqual(calls.find(c => c[0] === "track"), ["track", { uid: BLUE_UID }]);
  assert.deepEqual(s.clocks(), { b: 600000, r: 600000 }, "no lobby o relógio não corre");
  s.destroy();
});

test("onitama: sala fechada é criada com `open: false` e o lobby sabe disso", async () => {
  const { cloud, calls } = fakeCloud();
  const s = createOnitamaSession({ cloud, pollMs: 0, now: () => NOW });

  await s.create(10, "b", false);
  assert.equal(s.open, false);
  assert.deepEqual(calls.find(c => c[0] === "create"), ["create", 10, "b", false]);
  s.destroy();
});

test("onitama: pronto agenda a largada; só quem é da vez e depois da contagem pode jogar", async () => {
  const { cloud, calls } = fakeCloud();
  const s = createOnitamaSession({ cloud, pollMs: 0, now: () => NOW });
  await s.create(10, "b");
  await s.ready();

  assert.equal(s.status, "running");
  assert.equal(s.msToStart(), 4000);
  assert.equal(s.isMyTurn(), false, "antes da largada ninguém joga");
  assert.equal(s.isMyTurn(NOW + 4000), true);
  assert.equal(s.isMyTurn(NOW + 4000 + 1), true);
  assert.deepEqual(calls.find(c => c[0] === "ready"), ["ready", "d1"]);
  assert.equal(s.clocks(NOW + 4000).b, 600000);
  assert.equal(s.clocks(NOW + 9000).b, 595000);
  s.destroy();
});

test("onitama: entrar por código busca o estado completo; anexar por id não entra de novo", async () => {
  const { cloud, calls } = fakeCloud();
  const s = createOnitamaSession({ cloud, pollMs: 0, now: () => NOW });

  await s.join("abc123");
  assert.deepEqual(calls.find(c => c[0] === "join"), ["join", "abc123"]);
  assert.deepEqual(calls.find(c => c[0] === "state"), ["state", "d1"]);
  assert.equal(s.status, "running");
  assert.equal(s.myColor, "b");

  calls.length = 0;
  const s2 = createOnitamaSession({ cloud, pollMs: 0, now: () => NOW });
  await s2.attach("d1");
  assert.equal(calls.some(c => c[0] === "join"), false, "anexar não ocupa vaga");
  assert.deepEqual(calls.find(c => c[0] === "state"), ["state", "d1"]);
  s.destroy(); s2.destroy();
});

test("onitama: lance manda só { from, to, card }, aplica o estado novo e transmite pelo Realtime", async () => {
  const { cloud, calls, sent } = fakeCloud();
  const s = createOnitamaSession({ cloud, pollMs: 0, now: () => NOW });
  await s.create(10, "b");

  const lance = { from: "c1", to: "c3", card: "tiger" };
  await s.move(lance);
  assert.deepEqual(calls.find(c => c[0] === "move"), ["move", "d1", lance], "só o lance vai ao servidor, nunca o estado novo");
  assert.equal(s.onitama.turn, "r");
  assert.equal(s.onitama.version, 1);
  assert.equal(s.isMyTurn(NOW + 4000), false, "depois do lance passa a vez");
  assert.deepEqual(sent.at(-1), { type: "broadcast", event: "move", payload: { uid: BLUE_UID, version: 1 } });
  s.destroy();
});

test("onitama: desistir encerra pelo estado do servidor e avisa uma única vez", async () => {
  const finishedState = payload({ status: "finished", winner: { user_id: BLUE_UID } }, { result: "blue", reason: "resign" });
  const { cloud, calls } = fakeCloud({ responses: { resign: finishedState, state: finishedState } });
  const s = createOnitamaSession({ cloud, pollMs: 0, now: () => NOW });
  await s.create(10, "b");
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

test("onitama: sair cancela a sala e destrói o canal", async () => {
  const { cloud, calls } = fakeCloud();
  const s = createOnitamaSession({ cloud, pollMs: 0, now: () => NOW });
  await s.create(10, "r");

  await s.leave();
  assert.deepEqual(calls.find(c => c[0] === "leave"), ["leave", "d1"]);
  assert.ok(calls.some(c => c[0] === "unsubscribe"));
  assert.equal(await s.refresh(), null, "depois de sair a sessão não consulta mais");
  assert.equal(ONITAMA_POLL_MS, 1500);
});

/* ---------- aviso de desafiante: criador, desistência e motivo do cancelamento ---------- */

const waitingRoom = (over = {}) => payload({
  status: "waiting", startsAt: null, createdBy: BLUE_UID,
  players: [
    { user_id: BLUE_UID, nickname: "Ana", ready: false, is_me: true },
    { user_id: RED_UID, nickname: "Bia", ready: true, is_me: false },
  ],
  ...over,
});

test("onitama: sabe quem criou a sala e o motivo do cancelamento", async () => {
  const { cloud } = fakeCloud({ uid: BLUE_UID, responses: { state: waitingRoom() } });
  const s = createOnitamaSession({ cloud, pollMs: 0, now: () => NOW });
  await s.attach("d1");
  assert.equal(s.createdBy, BLUE_UID);
  assert.equal(s.isCreator(), true, "criador");
  assert.equal(s.cancelReason, null);

  const joiner = createOnitamaSession({ cloud: fakeCloud({ uid: RED_UID, responses: { state: waitingRoom() } }).cloud, pollMs: 0, now: () => NOW });
  await joiner.attach("d1");
  assert.equal(joiner.isCreator(), false, "quem entrou na sala não é o criador");

  const declined = fakeCloud({ uid: RED_UID, responses: { state: waitingRoom({ status: "cancelled", cancelReason: "declined" }) } });
  const j2 = createOnitamaSession({ cloud: declined.cloud, pollMs: 0, now: () => NOW });
  const done = [];
  j2.on("finished", d => done.push(d.outcome));
  await j2.attach("d1");
  assert.equal(j2.status, "cancelled");
  assert.equal(j2.cancelReason, "declined", "o desafiante descobre que o criador desistiu");
  assert.equal(j2.outcome, "cancelled", "cancelar nunca vira vitória nem derrota");
  assert.deepEqual(done, ["cancelled"]);
});

test("onitama: o criador que sai com um desafiante na sala DESISTE (duel_decline), sem derrota para ninguém", async () => {
  const f = fakeCloud({ uid: BLUE_UID, responses: { state: waitingRoom() } });
  f.cloud.duelDecline = async id => { f.calls.push(["decline", id]); return { status: "cancelled", cancelReason: "declined" }; };
  const s = createOnitamaSession({ cloud: f.cloud, pollMs: 0, now: () => NOW });
  await s.attach("d1");

  await s.leave();
  assert.deepEqual(f.calls.filter(c => c[0] === "decline"), [["decline", "d1"]]);
  assert.equal(f.calls.some(c => c[0] === "leave"), false, "não usa o duel_leave, que não registra o motivo");
});

test("onitama: sair sem desafiante, ou como desafiante, continua sendo o duel_leave de sempre", async () => {
  const alone = fakeCloud({
    uid: BLUE_UID,
    responses: { state: waitingRoom({ players: [{ user_id: BLUE_UID, nickname: "Ana", ready: false, is_me: true }] }) },
  });
  alone.cloud.duelDecline = async () => { throw new Error("não devia desistir"); };
  const a = createOnitamaSession({ cloud: alone.cloud, pollMs: 0, now: () => NOW });
  await a.attach("d1");
  await a.leave();
  assert.deepEqual(alone.calls.find(c => c[0] === "leave"), ["leave", "d1"]);

  const guest = fakeCloud({ uid: RED_UID, responses: { state: waitingRoom() } });
  guest.cloud.duelDecline = async () => { throw new Error("só o criador desiste"); };
  const b = createOnitamaSession({ cloud: guest.cloud, pollMs: 0, now: () => NOW });
  await b.attach("d1");
  await b.leave();
  assert.deepEqual(guest.calls.find(c => c[0] === "leave"), ["leave", "d1"], "o desafiante só libera a vaga");
});

test("onitama: attach devolve o estado da sala (e não a função que o monta)", async () => {
  const { cloud } = fakeCloud({ uid: BLUE_UID, responses: { state: waitingRoom() } });
  const s = createOnitamaSession({ cloud, pollMs: 0, now: () => NOW });
  const st = await s.attach("d1");
  assert.equal(typeof st, "object");
  assert.equal(st.id, "d1");
  assert.equal(st.createdBy, BLUE_UID);
});

test("onitama: o lado vermelho é reconhecido, e `random` vai ao servidor sem o cliente decidir o lado", async () => {
  const { cloud, calls } = fakeCloud({ uid: RED_UID });
  const s = createOnitamaSession({ cloud, pollMs: 0, now: () => NOW });
  await s.create(5, "random");
  assert.deepEqual(calls.find(c => c[0] === "create"), ["create", 5, "random", true]);
  assert.equal(s.myColor, "r", "quem é o `red` do payload joga de vermelho");
  assert.equal(s.isMyTurn(NOW + 5000), false, "a vez inicial é do azul");
  s.destroy();
});

test("onitama: a vez inicial vem do servidor (selo da carta) e o relógio dessa vez é o que corre", async () => {
  const redFirst = payload({}, { turn: "r" });
  const { cloud } = fakeCloud({ uid: RED_UID, responses: { state: redFirst } });
  const s = createOnitamaSession({ cloud, pollMs: 0, now: () => NOW });
  await s.attach("d1");
  assert.equal(s.isMyTurn(NOW + 4000), true);
  assert.equal(s.clocks(NOW + 9000).r, 595000);
  assert.equal(s.clocks(NOW + 9000).b, 600000);
  s.destroy();
});

test("onitama: passar a vez também é um lance { pass: true, card }", async () => {
  const { cloud, calls } = fakeCloud();
  const s = createOnitamaSession({ cloud, pollMs: 0, now: () => NOW });
  await s.create(10, "b");
  await s.move({ pass: true, card: "tiger" });
  assert.deepEqual(calls.find(c => c[0] === "move"), ["move", "d1", { pass: true, card: "tiger" }]);
  s.destroy();
});
