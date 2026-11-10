/* Sessão cliente de partidas com 2+ jogadores (shared/party-session.js), com um servidor em memória que imita
   Edge + Postgres: assentos, pronto, largada, vez, versão e `view` por assento. Três jogadores jogam de verdade. */
import test from "node:test";
import assert from "node:assert/strict";
import { createPartySession } from "../shared/party-session.js";
import { nextSeat, runPartyMove, seatsOf } from "../shared/party.js";

const domain = {
  PARTY: { minPlayers: 3, maxPlayers: 4, order: "turns", turnSeconds: 30, onTimeout: "skip" },
  partyStart: ({ seats }) => ({ state: { pos: Object.fromEntries(seats.map(s => [s, 0])), secret: Object.fromEntries(seats.map(s => [s, `s${s}`])) }, turn: seats[0] }),
  partyMove: (state, seat, input, { seats, out }) => {
    if (![1, 2].includes(input?.add)) return null;
    const pos = { ...state.pos, [seat]: state.pos[seat] + input.add };
    const live = seats.filter(s => !out.includes(s));
    if (pos[seat] >= 4) return { state: { ...state, pos }, ranking: [[seat], live.filter(s => s !== seat)], move: { seat }, reason: "goal" };
    return { state: { ...state, pos }, turn: nextSeat(seats, out, seat), move: { seat } };
  },
  partyView: (state, seat) => ({ pos: state.pos, mine: state.secret[seat] }),
};

const fail = code => Object.assign(new Error(code), { code });

/** Servidor em memória: uma sala party. `clock.ms` é o relógio do servidor. */
function makeServer(clock, { startDelay = 0 } = {}) {
  const S = { id: "room-1", code: "ABC123", status: "waiting", players: [], state: null, version: 0, turnSeat: null, ranking: null, startsAt: null, winner: null, createdBy: null, calls: [] };
  const iso = ms => new Date(ms).toISOString();
  const seatsNow = () => S.players.map(p => p.seat);
  const outNow = () => S.players.filter(p => p.out).map(p => p.seat);
  const json = uid => {
    const mine = S.players.find(p => p.user_id === uid);
    const room = {
      id: S.id, code: S.code, gameId: "corrida", kind: "party", status: S.status, open: true, createdBy: S.createdBy,
      minPlayers: 3, maxPlayers: 4, serverNow: iso(clock.ms), startsAt: S.startsAt && iso(S.startsAt), mySeat: mine?.seat ?? null,
      full: S.players.length >= 4, winner: S.winner,
      players: S.players.map(p => ({ ...p, host: p.user_id === S.createdBy, is_me: p.user_id === uid, nickname: p.user_id.toUpperCase() })),
      party: { version: S.version, order: "turns", turnSeat: S.turnSeat, turnSeconds: 30, turnEndsAt: S.turnSeat ? iso(clock.ms + 30000) : null, ranking: S.ranking, moves: S.version },
    };
    if (mine && S.state && S.startsAt <= clock.ms) room.view = domain.partyView(S.state, mine.seat, {});
    return room;
  };
  const launch = uid => {
    if (S.players.length < 3 || !S.players.every(p => p.ready)) throw fail("not_ready");
    if (uid !== S.createdBy && S.players.length < 4) throw fail("not_creator");
    S.players.forEach((p, i) => { p.seat = i + 1; });
    const start = domain.partyStart({ seats: seatsOf(S.players.length) });
    S.state = start.state; S.turnSeat = start.turn; S.status = "running"; S.startsAt = clock.ms + startDelay;
  };
  const cloudFor = uid => ({
    uid, duelTopic: id => `duel:${id}`, channel: null,
    async partyCreate() { S.createdBy = uid; S.players = [{ user_id: uid, seat: 1, ready: true, out: false }]; return json(uid); },
    async partyJoin() {
      if (S.players.length >= 4) throw fail("duel_full");
      if (!S.players.some(p => p.user_id === uid)) S.players.push({ user_id: uid, seat: S.players.length + 1, ready: false, out: false });
      return json(uid);
    },
    async partyJoinRoom() { return this.partyJoin(); },
    async partyReady(_id, flag) {
      S.players.find(p => p.user_id === uid).ready = uid === S.createdBy || flag;
      if (S.players.length >= 4 && S.players.every(p => p.ready)) launch(uid);   // largada automática (Edge)
      return json(uid);
    },
    async partyStart() { launch(uid); return json(uid); },
    async partyState() {
      if (!S.players.some(p => p.user_id === uid)) throw fail("not_member");
      return json(uid);
    },
    async partyMove(_id, input) {
      const me = S.players.find(p => p.user_id === uid && !p.out);
      if (!me) throw fail("not_member");
      if (S.turnSeat !== me.seat) throw fail("not_your_turn");
      let run;
      try { run = runPartyMove(domain, S.state, me.seat, input, { seats: seatsNow(), out: outNow() }); } catch (e) { throw fail(e.message); }
      S.state = run.state; S.version += 1; S.turnSeat = run.turn;
      if (run.ranking) {
        S.status = "finished"; S.ranking = run.ranking; S.turnSeat = null;
        let place = 1;
        for (const g of run.ranking) { g.forEach(seat => { S.players.find(p => p.seat === seat).placement = place; }); place += g.length; }
        S.winner = run.ranking[0].length === 1 ? { user_id: S.players.find(p => p.seat === run.ranking[0][0]).user_id } : null;
      }
      return json(uid);
    },
    async partyLeave() {
      if (S.status === "waiting") S.players = S.players.filter(p => p.user_id !== uid);
      return { status: S.status };
    },
    async partyResign() { S.players.find(p => p.user_id === uid).out = true; return json(uid); },
    async partyKick(_id, target) { S.players = S.players.filter(p => p.user_id !== target); return json(uid); },
    async partyCancel() { S.status = "cancelled"; return { status: "cancelled" }; },
  });
  return { S, cloudFor };
}

const session = (server, uid, clock, extra = {}) => createPartySession({ cloud: server.cloudFor(uid), pollMs: 0, now: () => clock.ms, ...extra });

test("três jogadores: criar, entrar, ficar pronto, iniciar, jogar vez a vez e ver o ranking", async () => {
  const clock = { ms: 1_000_000 };
  const server = makeServer(clock);
  const [a, b, c] = ["ana", "bob", "cid"].map(u => session(server, u, clock));
  const events = [];
  for (const [name, s] of [["a", a], ["b", b], ["c", c]]) {
    s.on("start", () => events.push(`${name}:start`));
    s.on("finished", d => events.push(`${name}:finished:${d.outcome}`));
  }

  await a.create("corrida", { maxPlayers: 4 });
  assert.equal(a.isHost(), true);
  assert.equal(a.lobby.missing, 2);
  await b.join("ABC123");
  await c.joinRoom("room-1");
  await a.refresh();
  assert.equal(a.players.length, 3);
  assert.equal(a.lobby.canStart, false, "convidados ainda não estão prontos");

  await b.ready();
  await c.ready();
  await a.refresh();
  assert.equal(a.lobby.canStart, true, "3 prontos >= mínimo: o criador pode iniciar");
  assert.equal(b.lobby.canStart, false, "convidado não inicia");
  await a.start();
  await b.refresh(); await c.refresh();

  assert.deepEqual(events.sort(), ["a:start", "b:start", "c:start"], "a largada chega para todos (contagem 0)");
  assert.equal(a.view.mine, "s1", "cada um vê só o próprio segredo");
  assert.equal(b.view.mine, "s2");
  assert.equal(JSON.stringify(b.view).includes("s1"), false, "a visão de Bob não tem o segredo da Ana");
  assert.equal(a.canPlay(), true);
  assert.equal(b.canPlay(), false, "não é a vez do Bob");
  assert.equal(a.turnPlayer().user_id, "ana");
  assert.equal(a.msToTurnEnd(), 30000);

  await assert.rejects(() => b.move({ add: 1 }), e => e.code === "not_your_turn");
  await assert.rejects(() => a.move({ add: 9 }), e => e.code === "invalid_move", "lance ilegal volta como invalid_move");

  // ana 2, bob 2, cid 2, ana 4 => ana chega a 4
  await a.move({ add: 2 });
  await b.refresh();
  assert.equal(b.canPlay(), true, "a vez passou ao Bob (o outro lado vê pelo refresh)");
  await b.move({ add: 2 });
  await c.move({ add: 2 });
  await a.move({ add: 2 });
  await b.refresh(); await c.refresh();

  assert.equal(a.status, "finished");
  assert.equal(a.outcome, "win");
  assert.equal(b.outcome, "placed");
  assert.deepEqual(a.ranking, [[1], [2, 3]]);
  assert.deepEqual(b.standings.map(s => `${s.place}:${s.nickname}`), ["1:ANA", "2:BOB", "2:CID"]);
  assert.ok(events.includes("a:finished:win") && events.includes("b:finished:placed") && events.includes("c:finished:placed"));
  assert.equal(a.canPlay(), false, "partida encerrada ninguém joga");
  [a, b, c].forEach(s => s.destroy());
});

test("a largada só sai depois da contagem (e o relógio do servidor manda)", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const clock = { ms: 5_000_000 };
  const server = makeServer(clock, { startDelay: 4000 });
  const [a, b, c] = ["ana", "bob", "cid"].map(u => session(server, u, clock));
  let starts = 0, counts = 0;
  a.on("start", () => { starts += 1; });
  a.on("countdown", () => { counts += 1; });

  await a.create("corrida");
  await b.join("x"); await c.join("x");
  await b.ready(); await c.ready();
  await a.start();
  assert.equal(a.status, "running");
  assert.equal(a.msToStart(), 4000);
  assert.equal(starts, 0, "durante a contagem não há largada");
  assert.ok(counts >= 1);
  assert.equal(a.canPlay(), false);
  assert.equal(a.view, null, "sem view antes da largada");

  clock.ms += 4100;
  t.mock.timers.tick(4200);              // o timer da sessão refaz a consulta
  await new Promise(r => setImmediate(r));
  assert.equal(a.msToStart(), 0);
  assert.equal(starts, 1, "largou uma vez, com a view");
  assert.equal(a.canPlay(), true);
  await a.refresh();
  assert.equal(starts, 1, "a largada não repete a cada consulta");
  [a, b, c].forEach(s => s.destroy());
});

test("sala lotada e todos prontos largam sozinhas (sem o criador iniciar)", async () => {
  const clock = { ms: 9_000_000 };
  const server = makeServer(clock);
  const names = ["ana", "bob", "cid", "dan"];
  const [a, ...rest] = names.map(u => session(server, u, clock));
  await a.create("corrida", { maxPlayers: 4 });
  for (const s of rest) await s.join("x");
  for (const s of rest) await s.ready();
  assert.equal(server.S.status, "running", "o último pronto disparou a largada automática");
  await a.refresh();
  assert.equal(a.started, true);
  [a, ...rest].forEach(s => s.destroy());
});

test("convidado expulso recebe 'kicked' e a sessão encerra; sair na espera libera a vaga", async () => {
  const clock = { ms: 2_000_000 };
  const server = makeServer(clock);
  const [a, b, c] = ["ana", "bob", "cid"].map(u => session(server, u, clock));
  await a.create("corrida");
  await b.join("x"); await c.join("x");
  let kicked = 0;
  b.on("kicked", () => { kicked += 1; });

  await a.kick("bob");
  const stale = await b.refresh();
  assert.equal(kicked, 1, "Bob foi avisado");
  assert.equal(stale, null);
  assert.equal(server.S.players.length, 2);

  let left = 0;
  c.on("left", () => { left += 1; });
  await c.leave();
  assert.equal(left, 1);
  assert.equal(server.S.players.length, 1, "a vaga foi liberada");
  await assert.rejects(() => b.refresh().then(r => { if (r === null) throw new Error("sessão encerrada"); }), /sessão encerrada/);
  a.destroy();
});

test("desistir elimina: quem saiu não joga mais; cancelar encerra a sala", async () => {
  const clock = { ms: 3_000_000 };
  const server = makeServer(clock);
  const [a, b, c] = ["ana", "bob", "cid"].map(u => session(server, u, clock));
  await a.create("corrida");
  await b.join("x"); await c.join("x");
  await b.ready(); await c.ready();
  await a.start();
  await b.refresh();
  await b.resign();
  assert.equal(b.me().out, true);
  assert.equal(b.canPlay(), false, "eliminado não joga");
  [a, b, c].forEach(s => s.destroy());

  const s2 = makeServer(clock);
  const host = session(s2, "ana", clock);
  await host.create("corrida");
  let gone = 0;
  host.on("left", () => { gone += 1; });
  await host.cancel();
  assert.equal(gone, 1);
  assert.equal(s2.S.status, "cancelled");
});

test("sessão ociosa: getters seguros antes de criar e canal Realtime só espelha", async () => {
  const clock = { ms: 1 };
  const s = session(makeServer(clock), "ana", clock);
  assert.equal(s.status, "idle");
  assert.equal(s.id, null);
  assert.equal(s.view, null);
  assert.equal(s.canPlay(), false);
  assert.equal(s.msToTurnEnd(), null);
  assert.equal(s.turnPlayer(), null);
  assert.equal(s.outcome, "idle");
  assert.equal(await s.refresh(), null, "sem sala não consulta");
  s.destroy();

  const sent = [];
  const fakeChannel = { on(_t, { event }, fn) { this.handlers = { ...this.handlers, [event]: fn }; return this; }, subscribe() {}, track() {}, send: m => sent.push(m.event), unsubscribe() {} };
  const server = makeServer(clock);
  const cloud = { ...server.cloudFor("ana"), channel: () => fakeChannel };
  const live = createPartySession({ cloud, pollMs: 0, now: () => clock.ms });
  await live.create("corrida");
  assert.deepEqual(Object.keys(fakeChannel.handlers).sort(), ["join", "leave", "move", "ready", "start"], "escuta os cinco eventos da sala");
  await live.ready();
  assert.ok(sent.includes("ready"));
  live.destroy();
});
