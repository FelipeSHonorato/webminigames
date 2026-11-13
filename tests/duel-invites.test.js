/* Aviso global de desafiante: o criador da sala é chamado em qualquer página.
   Aqui testamos o controlador (sem DOM): o que ele pergunta ao servidor, quando mostra o aviso e o que faz em
   "Entrar na sala" e "Desistir". Quem decide tudo de verdade continua sendo a Edge + o Postgres. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCEPT_EVENT, MESSAGES, acceptUrl, cleanInvites, createInviteController, fullParty, inviteDetail, inviteTitle,
  noticeKey, opponentName, partyNoticeDetail, partyNoticeTitle,
} from "../shared/duel-invites.js";

const GAMES = { chess: { title: "Xadrez", path: "games/chess/", duel: true }, sudoku: { title: "Sudoku", path: "games/sudoku/" } };
const ID = "11111111-1111-4111-8111-111111111111";

const invite = (over = {}) => ({
  id: ID, code: "ABC123", gameId: "chess", kind: "turn", level: 0, maxSeconds: 600,
  opponent: { nickname: "Bia", avatar: null, ready: true, away: false }, ...over,
});

/** Nuvem de mentira: responde `duelInvites` com o que estiver em `state.invites` e registra as chamadas. */
function fakeCloud(state = {}) {
  const calls = [];
  const cloud = {
    active: true, uid: "u1", ...state.cloud,
    async duelInvites() {
      calls.push(["invites"]);
      if (state.inviteError) throw state.inviteError;
      return { invites: state.invites ?? [] };
    },
    async duelDecline(id) {
      calls.push(["decline", id]);
      if (state.declineError) throw state.declineError;
      return { status: "cancelled", cancelReason: "declined" };
    },
    async partyLeave(id) {
      calls.push(["partyLeave", id]);
      if (state.leaveError) throw state.leaveError;
      return { status: "waiting" };
    },
  };
  return { cloud, calls, state };
}

function setup(state = {}, opts = {}) {
  const f = fakeCloud(state);
  const views = [], navigated = [];
  const controller = createInviteController({
    cloud: f.cloud, games: GAMES, pollMs: 0, base: opts.base ?? "",
    navigate: url => navigated.push(url), onChange: v => views.push(v),
    handleInPage: opts.handleInPage, loadGames: opts.loadGames,
  });
  return { ...f, controller, views, navigated };
}

/* ---------- textos e endereço ---------- */

test("convites: só entram os que a página sabe abrir (id + jogo do catálogo com endereço)", () => {
  const raw = [invite(), invite({ id: "x", gameId: "naoexiste" }), null, { gameId: "chess" }, invite({ id: ID.replace("1", "2"), gameId: "sudoku" })];
  assert.deepEqual(cleanInvites(raw, GAMES).map(i => i.gameId), ["chess", "sudoku"]);
  assert.deepEqual(cleanInvites(undefined, GAMES), []);
  assert.deepEqual(cleanInvites(raw, {}), [], "sem catálogo nada abre");
});

test("textos do aviso: nome do desafiante, jogo, tempo e estado", () => {
  assert.equal(opponentName(invite()), "Bia");
  assert.equal(opponentName({ opponent: {} }), "Um jogador");
  assert.equal(inviteTitle(invite(), GAMES), "Bia entrou na sua sala de Xadrez");
  assert.equal(inviteDetail(invite()), "10 min · Está pronto e esperando você.");
  assert.match(inviteDetail(invite({ opponent: { nickname: "Bia", away: true, ready: true } })), /saiu da página/, "desafiante ausente é avisado");
  assert.equal(inviteDetail(invite({ maxSeconds: null, opponent: { ready: false } })), "Já está na sala.");
});

test("textos do aviso: sala party de 3+ troca o texto para 'sala completa'", () => {
  const party = invite({ kind: "party", maxPlayers: 4 });
  assert.equal(fullParty(party), true);
  assert.equal(inviteTitle(party, GAMES), "A sala criada do game Xadrez está completa");
  assert.equal(inviteDetail(party), "A sala está completa e esperando você.");

  const duo = invite({ kind: "party", maxPlayers: 2 });
  assert.equal(fullParty(duo), false, "sala party de 2 mantém o texto do 1×1");
  assert.equal(inviteTitle(duo, GAMES), "Bia entrou na sua sala de Xadrez");
  assert.equal(inviteDetail(duo), "10 min · Está pronto e esperando você.");
  assert.equal(fullParty(invite()), false, "1×1 continua igual");
});

test("textos do recado de desistência: jogador comum e criador da sala", () => {
  const left = invite({ kind: "party", notice: { kind: "left", userId: "u9", nickname: "Bia", at: "2026-11-12T12:00:00Z" } });
  assert.equal(partyNoticeTitle(left, GAMES), "Bia desistiu do game Xadrez");
  assert.equal(partyNoticeDetail(left), "A sala continua aberta esperando outro jogador.");

  const host = invite({ kind: "party", notice: { kind: "host_left", userId: "u1", nickname: "Ana", at: "2026-11-12T12:00:00Z" } });
  assert.equal(partyNoticeTitle(host, GAMES), "O criador da sala desistiu do game Xadrez");
  assert.equal(partyNoticeTitle({ id: ID, notice: { kind: "left" } }, {}), "Um jogador desistiu", "sem jogo/nome ainda dá texto");
  assert.notEqual(noticeKey(left), noticeKey(host), "cada evento tem a sua chave");
});

test("endereço de aceite: jogo + ?duelo=<id>&aceitar=1, respeitando a pasta da página", () => {
  assert.equal(acceptUrl(invite(), GAMES), `games/chess/?duelo=${ID}&aceitar=1`);
  assert.equal(acceptUrl(invite(), GAMES, "../../"), `../../games/chess/?duelo=${ID}&aceitar=1`, "vindo de uma página de jogo");
  assert.equal(acceptUrl(invite({ gameId: "naoexiste" }), GAMES), "");
  assert.equal(acceptUrl({ gameId: "chess" }, GAMES), "");
  assert.equal(acceptUrl(invite(), { chess: { path: "games/chess/?x=1" } }), `games/chess/?x=1&duelo=${ID}&aceitar=1`);
});

/* ---------- quando o aviso aparece ---------- */

test("sem desafiante: nada aparece", async () => {
  const t = setup({ invites: [] });
  assert.equal(await t.controller.check(), null);
  assert.equal(t.controller.invite, null);
  assert.equal(t.controller.notice, "");
});

test("desafiante entrou: o aviso aparece com o convite e o catálogo", async () => {
  const t = setup({ invites: [invite()] });
  await t.controller.check();
  const view = t.views.at(-1);
  assert.equal(view.invite.id, ID);
  assert.equal(view.invite.opponent.nickname, "Bia");
  assert.equal(view.games.chess.title, "Xadrez");
  assert.equal(view.busy, false);
});

test("sem conta na nuvem (anônimo, modo local) o aviso nem pergunta ao servidor", async () => {
  for (const cloud of [{ active: false, uid: "u1" }, { active: true, uid: null }]) {
    const t = setup({ cloud, invites: [invite()] });
    await t.controller.check();
    assert.deepEqual(t.calls, [], JSON.stringify(cloud));
    assert.equal(t.controller.invite, null);
  }
});

test("o catálogo de jogos só é carregado quando existe convite", async () => {
  let loads = 0;
  const f = fakeCloud({ invites: [] });
  const controller = createInviteController({
    cloud: f.cloud, pollMs: 0, loadGames: async () => { loads += 1; return GAMES; },
  });
  await controller.check();
  assert.equal(loads, 0, "sem convite não carrega o catálogo");

  f.state.invites = [invite()];
  await controller.check();
  assert.equal(loads, 1);
  assert.equal(controller.invite.id, ID);
  await controller.check();
  assert.equal(loads, 1, "carrega uma vez só");
});

test("erro de rede: o aviso na tela é mantido e o próximo ciclo tenta de novo", async () => {
  const t = setup({ invites: [invite()] });
  await t.controller.check();
  t.state.inviteError = Object.assign(new Error("offline"), { code: "offline" });
  await t.controller.check();
  assert.equal(t.controller.invite?.id, ID, "uma falha passageira não esconde o convite");
  assert.equal(t.controller.notice, "");
  t.state.inviteError = null;
  await t.controller.check();
  assert.equal(t.controller.invite?.id, ID);
});

test("o desafiante saiu (ou o convite expirou): o aviso some com uma nota neutra", async () => {
  const t = setup({ invites: [invite()] });
  await t.controller.check();
  t.state.invites = [];
  await t.controller.check();
  assert.equal(t.controller.invite, null);
  assert.equal(t.controller.notice, MESSAGES.gone);
  t.controller.dismissNotice();
  assert.equal(t.controller.notice, "");
});

/* ---------- "Entrar na sala" ---------- */

test("Entrar na sala: navega até o jogo já com ?duelo=<id>&aceitar=1 e não deixa o polling reabrir o aviso", async () => {
  const t = setup({ invites: [invite()] }, { base: "../../" });
  await t.controller.check();
  assert.equal(t.controller.accept(), true);
  assert.deepEqual(t.navigated, [`../../games/chess/?duelo=${ID}&aceitar=1`]);
  assert.equal(t.controller.invite, null);
  assert.equal(t.controller.busy, true, "a página vai ser trocada");
  t.calls.length = 0;
  await t.controller.check();
  assert.deepEqual(t.calls, [], "enquanto navega, nada de novas consultas");
  assert.equal(t.calls.some(c => c[0] === "decline"), false, "aceitar nunca desiste");
});

test("Entrar na sala: resposta atrasada de uma consulta anterior não mostra 'convite não está mais ativo'", async () => {
  let release;
  let calls = 0;
  const f = fakeCloud({ invites: [invite()] });
  f.cloud.duelInvites = async () => {
    calls += 1;
    if (calls === 1) return { invites: [invite()] };
    await new Promise(r => { release = r; });
    return { invites: [] };
  };
  const controller = createInviteController({
    cloud: f.cloud, games: GAMES, pollMs: 0, handleInPage: () => true, onChange: () => {},
  });
  await controller.check();
  const stale = controller.check();               // pergunta feita antes do aceite, resposta ainda pendente
  assert.equal(controller.accept(), true);
  release();
  await stale;
  assert.equal(controller.invite, null, "a resposta velha não reabre o aviso");
  assert.equal(controller.notice, "", "e não inventa um recado depois do aceite");
});

test("Entrar na sala numa página que já está com a sala aberta: aceita ali, sem recarregar", async () => {
  const seen = [];
  const t = setup({ invites: [invite()] }, { handleInPage: i => { seen.push(i.id); return true; } });
  await t.controller.check();
  assert.equal(t.controller.accept(), true);
  assert.deepEqual(seen, [ID]);
  assert.deepEqual(t.navigated, [], "não navega");
  assert.equal(t.controller.busy, false);
  assert.equal(t.controller.invite, null);
});

test("Entrar na sala sem convite (ou duas vezes seguidas) não faz nada", async () => {
  const t = setup({ invites: [invite()] });
  assert.equal(t.controller.accept(), false, "ainda sem convite");
  await t.controller.check();
  assert.equal(t.controller.accept(), true);
  assert.equal(t.controller.accept(), false, "o convite já foi usado");
  assert.equal(t.navigated.length, 1);
});

test("o evento de aceite tem nome estável (a página do jogo escuta por ele)", () => {
  assert.equal(ACCEPT_EVENT, "wmg:duel-accept");
});

/* ---------- "Desistir" ---------- */

test("Desistir: chama duel_decline na sala certa, some o aviso e explica que ninguém perde pontos", async () => {
  const t = setup({ invites: [invite()] });
  await t.controller.check();
  assert.equal(await t.controller.decline(), true);
  assert.deepEqual(t.calls.filter(c => c[0] === "decline"), [["decline", ID]]);
  assert.equal(t.controller.invite, null);
  assert.equal(t.controller.notice, MESSAGES.declined);
  assert.match(MESSAGES.declined, /Ninguém ganha nem perde pontos/);
  assert.equal(t.controller.busy, false);
  assert.deepEqual(t.navigated, [], "desistir não leva ao jogo");
});

test("Desistir: os botões ficam ocupados durante o pedido (sem clique duplo)", async () => {
  const t = setup({ invites: [invite()] });
  await t.controller.check();
  const first = t.controller.decline();
  assert.equal(t.controller.busy, true);
  assert.equal(await t.controller.decline(), false, "segundo clique ignorado");
  await first;
  assert.equal(t.calls.filter(c => c[0] === "decline").length, 1);
});

test("Desistir: se a sala já mudou no servidor (começou, cancelou), o aviso some em vez de travar", async () => {
  for (const code of ["bad_status", "duel_not_found", "not_creator"]) {
    const t = setup({ invites: [invite()], declineError: Object.assign(new Error(code), { code }) });
    await t.controller.check();
    await t.controller.decline();
    assert.equal(t.controller.invite, null, code);
    assert.equal(t.controller.notice, MESSAGES.gone, code);
    assert.equal(t.controller.busy, false, code);
  }
});

test("Desistir: falha de rede mantém o aviso (dá para tentar de novo) e explica", async () => {
  const t = setup({ invites: [invite()], declineError: Object.assign(new Error("offline"), { code: "offline" }) });
  await t.controller.check();
  await t.controller.decline();
  assert.equal(t.controller.invite?.id, ID, "o convite continua na tela");
  assert.equal(t.controller.notice, MESSAGES.declineFailed);
  assert.equal(t.controller.busy, false);

  t.state.declineError = null;
  await t.controller.decline();
  assert.equal(t.controller.invite, null);
  assert.equal(t.controller.notice, MESSAGES.declined);
});

/* ---------- salas party ---------- */

test("Desistir numa sala party: sai da sala (partyLeave) e ela continua aberta", async () => {
  const t = setup({ invites: [invite({ kind: "party", maxPlayers: 4 })] });
  await t.controller.check();
  assert.equal(await t.controller.decline(), true);
  assert.deepEqual(t.calls, [["invites"], ["partyLeave", ID]], "não usa o cancelamento do 1×1");
  assert.equal(t.controller.invite, null);
  assert.equal(t.controller.notice, MESSAGES.partyLeft);
  assert.match(MESSAGES.partyLeft, /continua aberta/);
  assert.equal(t.controller.busy, false);
});

test("Desistir numa sala party que já mudou: fecha o aviso em vez de travar", async () => {
  for (const code of ["bad_status", "duel_not_found", "not_member"]) {
    const t = setup({ invites: [invite({ kind: "party", maxPlayers: 4 })], leaveError: Object.assign(new Error(code), { code }) });
    await t.controller.check();
    await t.controller.decline();
    assert.equal(t.controller.invite, null, code);
    assert.equal(t.controller.notice, MESSAGES.gone, code);
  }
});

test("recado de desistência: aparece uma vez e fecha no 'Entendi'", async () => {
  const event = invite({ kind: "party", maxPlayers: 4, notice: { kind: "left", userId: "u9", nickname: "Bia", at: "2026-11-12T12:00:00Z" } });
  const t = setup({ invites: [event] });
  await t.controller.check();
  assert.equal(t.controller.noticeCard?.notice.nickname, "Bia");
  assert.equal(t.views.at(-1).noticeCard.notice.kind, "left");

  t.controller.dismissEvent();
  assert.equal(t.controller.noticeCard, null);
  await t.controller.check();
  assert.equal(t.controller.noticeCard, null, "o mesmo evento não volta no polling seguinte");
});

test("recado de desistência e convite convivem: um não esconde o outro", async () => {
  const event = invite({ kind: "party", maxPlayers: 4, notice: { kind: "host_left", userId: "u1", nickname: "Ana", at: "2026-11-12T12:00:00Z" } });
  const t = setup({ invites: [invite(), event] });
  await t.controller.check();
  assert.equal(t.controller.invite.id, ID);
  assert.equal(t.controller.noticeCard.notice.kind, "host_left");
  assert.equal(t.views.at(-1).invite.id, ID);
  assert.equal(t.views.at(-1).noticeCard.notice.nickname, "Ana");
});

/* ---------- polling ---------- */

test("polling: consulta de tempos em tempos (mais devagar com a aba em segundo plano) e para no stop()", async () => {
  const f = fakeCloud({ invites: [] });
  const delays = [];
  const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
  let hidden = false;
  const pending = [];
  globalThis.setTimeout = (fn, ms) => { delays.push(ms); pending.push(fn); return pending.length; };
  globalThis.clearTimeout = () => {};
  try {
    const controller = createInviteController({ cloud: f.cloud, games: GAMES, pollMs: 100, hiddenMs: 900, isHidden: () => hidden });
    controller.start();
    await new Promise(r => realSet(r, 0));
    assert.equal(f.calls.filter(c => c[0] === "invites").length, 1, "consulta logo ao ligar");
    assert.deepEqual(delays, [100]);

    hidden = true;
    await pending.shift()();
    assert.deepEqual(delays, [100, 900], "em segundo plano o intervalo é maior");
    assert.equal(f.calls.filter(c => c[0] === "invites").length, 2);

    controller.stop();
    await pending.shift()();
    assert.equal(f.calls.filter(c => c[0] === "invites").length, 2, "parado: não consulta mais");
  } finally {
    globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear;
  }
});
