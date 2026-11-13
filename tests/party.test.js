/* Núcleo das partidas com 2+ jogadores (shared/party.js): contrato do domínio, vez, ranking, lobby e resultado.
   Usa um domínio de mentira (`corrida`) só para provar o contrato; ele NÃO é um jogo do catálogo. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  PARTY_MIN, PARTY_MAX, partyContract, seatsOf, activeSeats, nextSeat, validateRanking, placementsOf, soleWinner,
  runPartyMove, slotsLabel, ordinal, lobbyStatus, lobbyHint, partyOutcome, outcomeText, standings, msUntil,
} from "../shared/party.js";

/* ---------- domínio de mentira: quem chegar a 10 primeiro vence; cada lance soma 1 ou 2 ---------- */
const corrida = {
  PARTY: { minPlayers: 3, maxPlayers: 6, order: "turns", turnSeconds: 60, turnOptions: [30, 120], onTimeout: "skip", maxSeconds: 900 },
  partyStart: ({ seats, rng }) => ({
    state: { pos: Object.fromEntries(seats.map(s => [s, 0])), secret: Object.fromEntries(seats.map(s => [s, Math.floor(rng() * 100)])) },
    turn: seats[Math.floor(rng() * seats.length)],
  }),
  partyMove: (state, seat, input, { seats, out }) => {
    if (![1, 2].includes(input?.add)) return null;
    const pos = { ...state.pos, [seat]: state.pos[seat] + input.add };
    const next = { ...state, pos };
    if (pos[seat] >= 10) {
      const rest = activeSeats(seats, out).filter(s => s !== seat);
      return { state: next, ranking: [[seat], rest], move: { seat, add: input.add }, reason: "goal" };
    }
    return { state: next, turn: nextSeat(seats, out, seat), move: { seat, add: input.add } };
  },
  partyView: (state, seat) => ({ pos: state.pos, mine: state.secret[seat] }),   // o segredo dos outros nunca sai
};

test("partyContract: normaliza o contrato válido", () => {
  assert.deepEqual(partyContract(corrida), {
    minPlayers: 3, maxPlayers: 6, order: "turns", turnSeconds: 60, turnOptions: [30, 60, 120], onTimeout: "skip", maxSeconds: 900,
  });
  const free = { ...corrida, PARTY: { minPlayers: 2, maxPlayers: 2, order: "free", turnSeconds: 30 } };
  const c = partyContract(free);
  assert.equal(c.order, "free");
  assert.equal(c.turnSeconds, null, "modo livre não tem tempo por vez");
  assert.deepEqual(c.turnOptions, []);
  assert.equal(c.maxSeconds, 1800, "maxSeconds ausente vira o padrão");
});

test("partyContract: recusa o que o banco recusaria", () => {
  const withParty = party => ({ ...corrida, PARTY: { ...corrida.PARTY, ...party } });
  assert.equal(partyContract({}), null, "sem PARTY");
  assert.equal(partyContract(null), null);
  assert.equal(partyContract({ PARTY: corrida.PARTY }), null, "sem as três funções");
  assert.equal(partyContract({ ...corrida, partyView: undefined }), null, "falta partyView");
  assert.equal(partyContract(withParty({ minPlayers: 1 })), null, `mínimo é ${PARTY_MIN}`);
  assert.equal(partyContract(withParty({ maxPlayers: PARTY_MAX + 1 })), null, `máximo é ${PARTY_MAX}`);
  assert.equal(partyContract(withParty({ minPlayers: 5, maxPlayers: 4 })), null, "max < min");
  assert.equal(partyContract(withParty({ order: "bagunça" })), null);
  assert.equal(partyContract(withParty({ turnSeconds: 2 })), null, "tempo da vez entre 5 e 3600 s");
  assert.equal(partyContract(withParty({ turnSeconds: 5000 })), null);
  assert.equal(partyContract(withParty({ turnSeconds: null })).turnSeconds, null, "sem limite de tempo é válido");
  assert.equal(partyContract(withParty({ onTimeout: "?" })).onTimeout, "skip", "valor desconhecido cai em skip");
  assert.deepEqual(partyContract(withParty({ turnOptions: [1, 45, 9999] })).turnOptions, [45, 60], "opções inválidas saem");
});

test("assentos e vez: circular, pula eliminados (espelha party_next_seat do SQL)", () => {
  const seats = seatsOf(4);
  assert.deepEqual(seats, [1, 2, 3, 4]);
  assert.deepEqual(activeSeats(seats, [2]), [1, 3, 4]);
  assert.equal(nextSeat(seats, [], 1), 2);
  assert.equal(nextSeat(seats, [], 4), 1, "depois do último volta ao primeiro");
  assert.equal(nextSeat(seats, [3], 2), 4, "pula o eliminado");
  assert.equal(nextSeat(seats, [2, 3, 4], 1), 1, "sobrou um só: ele mesmo");
  assert.equal(nextSeat(seats, [1, 2, 3, 4], 1), null, "ninguém sobrou");
  assert.equal(nextSeat(seats, [], 0), 1, "de 0 começa no primeiro");
  assert.deepEqual(seatsOf(0), []);
});

test("validateRanking: cobre os ativos exatamente uma vez", () => {
  assert.ok(validateRanking([[3], [1, 2]], [1, 2, 3]));
  assert.ok(validateRanking([[1, 2, 3]], [1, 2, 3]), "todos empatados");
  assert.ok(validateRanking([[2]], [2]), "só um ativo");
  assert.ok(!validateRanking([[3], [1]], [1, 2, 3]), "falta o 2");
  assert.ok(!validateRanking([[3], [1, 2], [2]], [1, 2, 3]), "assento repetido");
  assert.ok(!validateRanking([[3], [1, 2, 4]], [1, 2, 3]), "assento que não está ativo");
  assert.ok(!validateRanking([[3], []], [3]), "grupo vazio");
  assert.ok(!validateRanking([], [1]), "vazio");
  assert.ok(!validateRanking(null, [1]));
  assert.ok(!validateRanking([["1"]], [1]), "só inteiros");
});

test("placementsOf: empate divide a colocação (igual ao pgTAP: 1,2,3 e 1,1)", () => {
  assert.deepEqual([...placementsOf([[3], [1], [2]])], [[3, 1], [1, 2], [2, 3]]);
  assert.deepEqual([...placementsOf([[3], [1, 2], [4]])], [[3, 1], [1, 2], [2, 2], [4, 4]]);
  assert.deepEqual([...placementsOf([[1, 2]])], [[1, 1], [2, 1]]);
  assert.equal(soleWinner([[3], [1, 2]]), 3);
  assert.equal(soleWinner([[1, 2], [3]]), null, "empate no topo: sem vencedor único");
  assert.equal(soleWinner([]), null);
});

test("runPartyMove: o lance passa pelo domínio e volta no formato que o banco aceita", () => {
  const seats = seatsOf(3);
  const start = corrida.partyStart({ seats, rng: () => 0.5 });
  const r = runPartyMove(corrida, start.state, 2, { add: 2 }, { seats });
  assert.equal(r.state.pos[2], 2);
  assert.equal(r.turn, 3, "vez vai ao próximo ativo");
  assert.equal(r.ranking, null);
  assert.deepEqual(r.move, { seat: 2, add: 2 });
  assert.equal(start.state.pos[2], 0, "o estado anterior não é alterado");

  assert.equal(runPartyMove(corrida, start.state, 3, { add: 1 }, { seats, out: [1] }).turn, 2, "pula o eliminado");
  assert.throws(() => runPartyMove(corrida, start.state, 1, { add: 7 }, { seats }), /invalid_move/, "lance ilegal");
  assert.throws(() => runPartyMove(corrida, start.state, 1, { add: 1 }, { seats, out: [1] }), /invalid_move/, "eliminado não joga");
  assert.throws(() => runPartyMove(corrida, start.state, 9, { add: 1 }, { seats }), /invalid_move/, "assento que não existe");
  assert.throws(() => runPartyMove({}, start.state, 1, { add: 1 }, { seats }), /not_party_game/);
});

test("runPartyMove: fim de partida devolve ranking validado e sem vez", () => {
  const seats = seatsOf(3);
  const state = { pos: { 1: 9, 2: 4, 3: 0 }, secret: {} };
  const r = runPartyMove(corrida, state, 1, { add: 1 }, { seats });
  assert.deepEqual(r.ranking, [[1], [2, 3]]);
  assert.equal(r.turn, null);
  assert.equal(r.reason, "goal");
  const withOut = runPartyMove(corrida, state, 1, { add: 2 }, { seats, out: [3] });
  assert.deepEqual(withOut.ranking, [[1], [2]], "o ranking só tem os assentos ainda ativos");
});

test("runPartyMove: recusa domínio que devolve vez inválida ou ranking quebrado", () => {
  const seats = seatsOf(3);
  const base = (over) => ({ ...corrida, partyMove: () => ({ state: { x: 1 }, ...over }) });
  assert.throws(() => runPartyMove(base({ turn: 9 }), {}, 1, {}, { seats }), /bad_domain_result/, "vez fora dos assentos");
  assert.throws(() => runPartyMove(base({ turn: 2 }), {}, 1, {}, { seats, out: [2] }), /bad_domain_result/, "vez num eliminado");
  assert.throws(() => runPartyMove(base({}), {}, 1, {}, { seats }), /bad_domain_result/, "turns sem vez");
  assert.throws(() => runPartyMove(base({ ranking: [[1]] }), {}, 1, {}, { seats }), /bad_domain_result/, "ranking incompleto");
  assert.throws(() => runPartyMove({ ...corrida, partyMove: () => ({ state: null, turn: 2 }) }, {}, 1, {}, { seats }), /bad_domain_result/, "sem estado");
  const free = { ...corrida, PARTY: { ...corrida.PARTY, order: "free" }, partyMove: () => ({ state: { x: 1 } }) };
  assert.equal(runPartyMove(free, {}, 2, {}, { seats }).turn, null, "modo livre não precisa de vez");
});

test("a visão de cada assento não vaza o que é dos outros", () => {
  const { state } = corrida.partyStart({ seats: seatsOf(3), rng: () => 0.42 });
  const v1 = corrida.partyView(state, 1), v2 = corrida.partyView(state, 2);
  assert.equal(JSON.stringify(v1).includes("secret"), false);
  assert.equal(v1.mine, state.secret[1]);
  assert.equal(v2.mine, state.secret[2]);
  assert.deepEqual(Object.keys(v1).sort(), ["mine", "pos"]);
});

/* ---------- sala (o que vem de party_json) ---------- */
const room = (over = {}, players = null) => ({
  status: "waiting", minPlayers: 3, maxPlayers: 4,
  players: players ?? [
    { user_id: "a", nickname: "Ana", seat: 1, ready: true, host: true, is_me: true },
    { user_id: "b", nickname: "Bob", seat: 2, ready: false },
  ],
  ...over,
});

test("slotsLabel e ordinal", () => {
  assert.equal(slotsLabel(room()), "2/4 jogadores");
  assert.equal(slotsLabel({ players: 3, maxPlayers: 6 }), "3/6 jogadores", "a lista de salas manda só o número");
  assert.equal(slotsLabel({ minPlayers: 3, maxPlayers: 6 }), "3 a 6 jogadores");
  assert.equal(slotsLabel({ minPlayers: 4, maxPlayers: 4 }), "4 jogadores");
  assert.equal(slotsLabel({}), "");
  assert.equal(ordinal(1), "1º");
  assert.equal(ordinal(0), "");
  assert.equal(ordinal(null), "");
});

test("lobbyStatus: faltam jogadores, falta ficar pronto, criador inicia, sala cheia larga sozinha", () => {
  let s = lobbyStatus(room());
  assert.equal(s.missing, 1);
  assert.equal(s.canLaunch, false);
  assert.equal(s.canStart, false);
  assert.equal(s.free, 2);
  assert.equal(s.isHost, true);

  const three = [
    { user_id: "a", nickname: "Ana", ready: true, host: true, is_me: true },
    { user_id: "b", nickname: "Bob", ready: false },
    { user_id: "c", nickname: "Cid", ready: true },
  ];
  s = lobbyStatus(room({}, three));
  assert.equal(s.missing, 0);
  assert.deepEqual(s.notReady.map(p => p.nickname), ["Bob"]);
  assert.equal(s.canStart, false, "não larga com alguém sem estar pronto");

  three[1].ready = true;
  s = lobbyStatus(room({}, three));
  assert.equal(s.canStart, true, "3 prontos >= mínimo: o criador inicia");
  assert.equal(s.autoStart, false, "ainda cabe mais 1: não larga sozinha");

  const four = [...three, { user_id: "d", nickname: "Duda", ready: true }];
  s = lobbyStatus(room({}, four));
  assert.equal(s.autoStart, true, "lotada e todos prontos: largada automática");

  const guest = three.map(p => ({ ...p, is_me: p.user_id === "b" }));
  assert.equal(lobbyStatus(room({}, guest)).canStart, false, "convidado não inicia");
  assert.equal(lobbyStatus(room({ status: "running" }, three)).canLaunch, false, "só na espera");
});

test("lobbyStatus: sala com tamanho exato (min = max) só larga com todos prontos", () => {
  const exact = over => room({ minPlayers: 3, maxPlayers: 3, ...over });
  const ana = { user_id: "a", nickname: "Ana", seat: 1, ready: true, host: true, is_me: true };
  const bob = { user_id: "b", nickname: "Bob", seat: 2, ready: true };
  const cid = { user_id: "c", nickname: "Cid", seat: 3, ready: true };

  let s = lobbyStatus(exact({ players: [ana, bob] }));
  assert.equal(s.missing, 1, "falta 1 dos 3 assentos");
  assert.equal(s.canStart, false, "não inicia com menos jogadores que o escolhido");
  assert.equal(s.autoStart, false);

  s = lobbyStatus(exact({ players: [ana, bob, { ...cid, ready: false }] }));
  assert.equal(s.missing, 0, "assentos completos");
  assert.equal(s.canStart, false, "não inicia enquanto todos não estiverem prontos");
  assert.equal(s.autoStart, false);

  s = lobbyStatus(exact({ players: [ana, bob, cid] }));
  assert.equal(s.canStart, true, "3 de 3 prontos: o criador pode iniciar");
  assert.equal(s.autoStart, true, "mesa cheia e pronta: largada automática");
});

test("lobbyStatus: a largada espera todos DENTRO do jogo", () => {
  const ana = { user_id: "a", nickname: "Ana", seat: 1, ready: true, host: true, is_me: true, inside: true };
  const bob = { user_id: "b", nickname: "Bob", seat: 2, ready: true, inside: true };
  const cid = { user_id: "c", nickname: "Cid", seat: 3, ready: true, inside: true };
  const duda = { user_id: "d", nickname: "Duda", seat: 4, ready: true, inside: false };
  const full = room({ minPlayers: 4, maxPlayers: 4 }, [ana, bob, cid, duda]);

  let s = lobbyStatus(full);
  assert.equal(s.canLaunch, true, "cheia e pronta");
  assert.equal(s.allInside, false);
  assert.deepEqual(s.away.map(p => p.nickname), ["Duda"]);
  assert.equal(s.canStart, false, "o criador também espera");
  assert.equal(s.autoStart, false, "sem todos dentro não há contagem");
  assert.equal(lobbyHint(full), "Sala completa. Esperando Duda entrar no jogo.");

  duda.inside = true;
  s = lobbyStatus(full);
  assert.equal(s.allInside, true);
  assert.equal(s.autoStart, true);

  const twoAway = [ana, { ...bob, inside: false }, { ...cid, inside: false }, duda];
  assert.equal(lobbyHint(room({ minPlayers: 4, maxPlayers: 4 }, twoAway)), "Sala completa. Esperando 2 jogadores entrarem no jogo.");

  const beforeFull = [ana, bob, { ...cid, inside: false }];
  assert.equal(lobbyHint(room({ minPlayers: 3, maxPlayers: 4 }, beforeFull)), "Esperando Cid entrar no jogo.", "sala ainda com vaga não diz 'completa'");

  const legacy = [{ user_id: "a", nickname: "Ana", ready: true, host: true, is_me: true }, { user_id: "b", nickname: "Bob", ready: true }];
  assert.equal(lobbyStatus(room({ minPlayers: 2, maxPlayers: 2 }, legacy)).allInside, true, "sem o campo, todos contam como dentro");
});

test("lobbyHint: diz o que falta, no singular e no plural", () => {
  assert.equal(lobbyHint(room()), "Falta 1 jogador para poder começar.");
  assert.equal(lobbyHint(room({ minPlayers: 4 })), "Faltam 2 jogadores para poder começar.");
  const three = [
    { nickname: "Ana", ready: true, host: true, is_me: true },
    { nickname: "Bob", ready: false },
    { nickname: "Cid", ready: true },
  ];
  assert.equal(lobbyHint(room({}, three)), "Esperando Bob ficar pronto.");
  three[2].ready = false;
  assert.equal(lobbyHint(room({}, three)), "Esperando 2 jogadores ficarem prontos.");
  three.forEach(p => { p.ready = true; });
  assert.match(lobbyHint(room({}, three)), /Inicie agora ou espere mais jogadores \(até 4\)/);
  three[0].is_me = false; three[0].host = false; three[1].is_me = true;
  assert.equal(lobbyHint(room({}, three)), "Todos prontos. Esperando o criador iniciar.");
  assert.equal(lobbyHint(room({ status: "running" })), "");
});

test("partyOutcome e outcomeText: vitória, empate no topo, colocação e cancelamento", () => {
  const done = (placements, winner) => ({
    status: "finished", winner,
    players: placements.map((placement, i) => ({ user_id: `u${i}`, is_me: i === 0, placement, seat: i + 1, nickname: `J${i}` })),
  });
  assert.equal(partyOutcome(null, "u0"), "idle");
  assert.equal(partyOutcome({ status: "running", players: [] }, "u0"), "running");
  assert.equal(partyOutcome({ status: "cancelled", players: [] }, "u0"), "cancelled");
  assert.equal(partyOutcome(done([1, 2, 3], { user_id: "u0" }), "u0"), "win");
  assert.equal(partyOutcome(done([1, 1, 3], null), "u0"), "tie");
  assert.equal(partyOutcome(done([3, 1, 2], { user_id: "u1" }), "u0"), "placed");
  assert.equal(outcomeText("win"), "Você venceu!");
  assert.equal(outcomeText("tie"), "Empate no 1º lugar.");
  assert.equal(outcomeText("placed", 3), "Você ficou em 3º lugar.");
  assert.equal(outcomeText("placed"), "Partida encerrada.");
  assert.equal(outcomeText("cancelled"), "Partida cancelada.");
  assert.equal(outcomeText("nada"), "");
});

test("standings: classificação final em ordem, empatados juntos, o próprio jogador marcado", () => {
  const rows = standings({
    players: [
      { nickname: "Ana", seat: 1, placement: 2, is_me: true },
      { nickname: "Bob", seat: 2, placement: 1 },
      { nickname: "Cid", seat: 3, placement: 2, out: true },
      { nickname: "Duda", seat: 4 },
    ],
  });
  assert.deepEqual(rows.map(r => `${r.place}:${r.nickname}`), ["1:Bob", "2:Ana", "2:Cid"], "quem não tem colocação fica de fora");
  assert.equal(rows[1].me, true);
  assert.equal(rows[2].out, true);
  assert.deepEqual(standings(null), []);
});

test("msUntil usa o relógio do servidor e nunca devolve negativo", () => {
  const at = "2026-11-09T12:00:10.000Z";
  const now = Date.parse("2026-11-09T12:00:00.000Z");
  assert.equal(msUntil(at, now, 0), 10000);
  assert.equal(msUntil(at, now, 4000), 6000, "servidor adiantado em 4 s");
  assert.equal(msUntil(at, now + 20000, 0), 0);
  assert.equal(msUntil(null, now, 0), 0);
});
