/* Testes das páginas "Como jogar": cada exemplo ilustrado precisa ser verdadeiro segundo o DOMÍNIO do jogo,
   e a página precisa estar ligada ao resto do site (abas, links nos jogos, sem recursos externos). */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as chess from "../games/chess/domain.js";
import * as dama from "../games/dama/domain.js";
import * as gamao from "../games/gamao/domain.js";
import { CHESS, DAMA, GAMMON, GUIDES, GUIDE_IDS, chessReach, damaFromPosition, damaPosition, gammonPoints } from "../js/como-jogar-data.js";
import { chessBoard, damaBoard, gammonBoard, diceSvg, parseFen } from "../js/como-jogar-art.js";

const root = new URL("../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const names = (squares, to = m => m.to) => new Set(squares.map(m => chess.squareName(to(m))));

/* ================================== XADREZ ================================== */

test("como jogar · xadrez: o mate do corredor é xeque-mate e o afogamento é afogamento", () => {
  const mate = chess.outcome(chess.fromFen(CHESS.mate));
  assert.deepEqual([mate.over, mate.reason, mate.winner], [true, "checkmate", "w"]);
  const stale = chess.outcome(chess.fromFen(CHESS.stalemate));
  assert.deepEqual([stale.over, stale.reason, stale.winner], [true, "stalemate", null]);
  assert.equal(chess.inCheck(chess.fromFen(CHESS.stalemate)), false, "afogamento: o rei NÃO está em xeque");
});

test("como jogar · xadrez: os pontos e anéis de cada peça são exatamente os lances legais", () => {
  for (const key of ["pawn", "rook", "bishop", "queen", "knight", "king", "capture"]) {
    const { fen, from } = CHESS[key];
    const state = chess.fromFen(fen);
    const legal = chess.movesFrom(state, chess.parseSquare(from));
    const { dots, rings } = chessReach(fen, from);
    assert.deepEqual([...names(legal)].sort(), [...dots, ...rings].sort(), `${key}: destinos diferem do domínio`);
    for (const m of legal) {
      const isCapture = Boolean(m.captured);
      assert.equal(rings.includes(chess.squareName(m.to)), isCapture, `${key}: ${chess.squareName(m.to)} deveria ${isCapture ? "ser anel" : "ser ponto"}`);
    }
  }
});

test("como jogar · xadrez: xeque, roque, en passant e promoção acontecem como ensinamos", () => {
  const check = chess.fromFen(CHESS.check);
  assert.equal(chess.inCheck(check), true);
  assert.deepEqual([...names(chess.legalMoves(check))].sort(), ["d7", "d8", "f7", "f8"], "a única saída é mover o rei (e7 é atacada)");

  const castle = chess.fromFen(CHESS.castle.fen);
  const king = chess.movesFrom(castle, chess.parseSquare("e1")).filter(m => m.castle);
  assert.deepEqual([...names(king)].sort(), ["c1", "g1"]);
  const after = chess.applyMove(castle, king.find(m => chess.squareName(m.to) === "g1"));
  assert.equal(chess.toFen(after).split(" ")[0], CHESS.castle.after.split(" ")[0], "o roque curto termina com rei em g1 e torre em f1");

  const ep = chess.fromFen(CHESS.enPassant);
  const take = chess.movesFrom(ep, chess.parseSquare("e5")).find(m => chess.squareName(m.to) === "d6");
  assert.ok(take?.enPassant, "e5xd6 é en passant");

  const promo = chess.fromFen(CHESS.promotion);
  const push = chess.movesFrom(promo, chess.parseSquare("a7")).filter(m => chess.squareName(m.to) === "a8");
  assert.deepEqual(push.map(m => m.promotion).sort(), ["B", "N", "Q", "R"], "o peão pode virar dama, torre, bispo ou cavalo");
});

/* =================================== DAMA =================================== */

const damaState = pieces => dama.fromPosition(damaPosition(pieces), "w");
const dnames = (moves, pick = m => m.to) => [...new Set(moves.map(m => dama.squareName(pick(m))))].sort();

test("como jogar · dama: a posição inicial desenhada é a do jogo", () => {
  assert.equal(DAMA.start, dama.START_POSITION);
  assert.equal(damaPosition(damaFromPosition(DAMA.start)), dama.START_POSITION);
});

test("como jogar · dama: mover, capturar e capturar em sequência", () => {
  const step = damaState(DAMA.step.pieces);
  const stepMoves = dama.movesFrom(step, dama.parseSquare("c3"));
  assert.deepEqual(dnames(stepMoves), ["b4", "d4"]);
  assert.ok(stepMoves.every(m => m.captureCount === 0));

  const one = dama.legalMoves(damaState(DAMA.capture.pieces));
  assert.equal(one.length, 1, "com captura disponível, é o único lance");
  assert.deepEqual([dama.squareName(one[0].to), one[0].captureCount], ["e5", 1]);

  const chain = dama.legalMoves(damaState(DAMA.chain.pieces));
  assert.equal(chain.length, 1);
  assert.deepEqual(chain[0].path.map(dama.squareName), ["c3", "e5", "g7"]);
  assert.equal(chain[0].captureCount, 2);
});

test("como jogar · dama: captura obrigatória e lei da maioria", () => {
  const state = damaState(DAMA.majority.pieces);
  const moves = dama.legalMoves(state);
  assert.equal(moves.length, 1, "só a captura de duas peças vale");
  assert.equal(dama.squareName(moves[0].from), "c3");
  assert.equal(moves[0].captureCount, 2);
  assert.equal(dama.movesFrom(state, dama.parseSquare("h2")).length, 0, "a captura simples de h2 é proibida pela maioria");

  // Sem nenhuma captura na mesa, a pedra pode andar livremente (a obrigação só existe quando há captura).
  assert.ok(dama.legalMoves(damaState(DAMA.step.pieces)).some(m => m.captureCount === 0));
});

test("como jogar · dama: promoção e dama voadora", () => {
  const promo = damaState(DAMA.promo.pieces);
  const moves = dama.movesFrom(promo, dama.parseSquare("c7"));
  assert.deepEqual(dnames(moves), ["b8", "d8"]);
  assert.ok(moves.every(m => m.promotion));
  const crowned = dama.applyMove(promo, moves[0]);
  assert.equal(crowned.board[moves[0].to], "D", "chegou na última fileira: vira dama");

  const king = damaState(DAMA.king.pieces);
  const flying = dama.legalMoves(king);
  assert.deepEqual(dnames(flying), ["f6", "g7", "h8"], "a dama pula de longe e cai em qualquer casa livre depois da peça");
  assert.ok(flying.every(m => dama.squareName(m.from) === "a1" && m.captureCount === 1));
});

/* =================================== GAMÃO =================================== */

function gamaoState({ state, dice, turn = "w" }) {
  const list = dice[0] === dice[1] ? [dice[0], dice[0], dice[0], dice[0]] : dice.slice();
  return { ...gamao.initial(), points: gammonPoints(state), bar: { ...state.bar }, off: { ...state.off }, turn, dice: list, roll: dice.slice(), awaitingRoll: false };
}
const startState = (dice, turn) => gamaoState({ state: GAMMON.start, dice, turn });
const has = (moves, from, to, die) => moves.some(m => m.from === from && (to === "off" ? m.toOff : m.to === to && !m.toOff) && m.die === die);

test("como jogar · gamão: todo exemplo tem 15 peças de cada cor e a posição inicial é a do jogo", () => {
  assert.deepEqual(gammonPoints(GAMMON.start).slice(1), gamao.START_POINTS.slice(1));
  const states = [GAMMON.start, GAMMON.hitBefore.state, GAMMON.hitAfter, GAMMON.entry.state, GAMMON.bearOff.state, GAMMON.bearOffAfter];
  for (const s of states) {
    for (const color of ["w", "b"]) {
      const onBoard = Object.values(s[color]).reduce((a, b) => a + b, 0);
      assert.equal(onBoard + s.bar[color] + s.off[color], 15, `exemplo com ${onBoard + s.bar[color] + s.off[color]} peças ${color}`);
    }
  }
});

test("como jogar · gamão: mover com dados, dobres e pontos bloqueados", () => {
  const two = gamao.legalMoves(startState(GAMMON.dice35.dice));
  for (const [from, to, die] of GAMMON.dice35.moves) assert.ok(has(two, from, to, die), `${from}→${to} com o dado ${die}`);

  const dbl = startState(GAMMON.doubles.dice);
  assert.equal(dbl.dice.length, 4, "dobres viram quatro dados");
  const doubles = gamao.legalMoves(dbl);
  for (const [from, to, die] of GAMMON.doubles.moves) assert.ok(has(doubles, from, to, die), `${from}→${to} com o dado ${die}`);

  const blocked = gamao.legalMoves(startState(GAMMON.blocked.dice));
  const [bf, bt, bd] = GAMMON.blocked.blocked, [of, ot, od] = GAMMON.blocked.ok;
  assert.equal(has(blocked, bf, bt, bd), false, "o ponto 19 tem 5 peças escuras: bloqueado");
  assert.equal(has(blocked, of, ot, od), true, "o ponto 21 está livre");
});

test("como jogar · gamão: bater, entrar pela barra e retirar peças", () => {
  const before = gamaoState(GAMMON.hitBefore);
  const [hf, ht, hd] = GAMMON.hitBefore.hit;
  const hit = gamao.legalMoves(before).find(m => m.from === hf && m.to === ht && m.die === hd);
  assert.ok(hit?.hit, "13→7 com o 6 bate a peça sozinha");
  const after = gamao.applyMove(before, hit);
  assert.equal(after.bar.b, 1, "a peça batida vai para a barra");
  assert.deepEqual(after.points.slice(1), gammonPoints(GAMMON.hitAfter).slice(1), "a figura 'depois' é o tabuleiro real depois do lance");

  const entry = gamao.legalMoves(gamaoState({ ...GAMMON.entry, turn: "b" }));
  assert.ok(entry.length > 0 && entry.every(m => m.fromBar), "com peça na barra só se entra");
  assert.deepEqual(entry.map(m => [m.to, m.die]), [[3, GAMMON.entry.okDie]], "o 6 é bloqueado (ponto 6 tem 5 claras); só o 3 entra");

  const bear = gamaoState(GAMMON.bearOff);
  assert.equal(gamao.canBearOff(bear, "w"), true);
  const off = gamao.legalMoves(bear);
  for (const [from, , die] of GAMMON.bearOff.moves) assert.ok(has(off, from, "off", die), `retirar do ponto ${from} com o ${die}`);
  assert.equal(gamao.canBearOff(gamaoState({ state: GAMMON.hitBefore.state, dice: [6, 1] }), "w"), false, "com peças fora da casa não se retira");

  // Usar os dois dados (5 e 2) deixa exatamente o tabuleiro da figura "depois": 2 peças na bandeja.
  let next = bear;
  for (const [from, , die] of GAMMON.bearOff.moves) {
    next = gamao.applyMove(next, gamao.legalMoves(next).find(m => m.from === from && m.toOff && m.die === die));
  }
  assert.equal(next.off.w, 2);
  assert.deepEqual(next.points.slice(1), gammonPoints(GAMMON.bearOffAfter).slice(1), "a figura 'depois' é o tabuleiro real depois dos dois lances");
});

/* ============================== figuras e página ============================== */

test("como jogar · figuras: SVG acessível, sem <defs>, sem recursos externos", () => {
  const all = GUIDES.flatMap(g => g.sections.flatMap(s => s.figures ?? []));
  assert.ok(all.length >= 25, "há figuras suficientes para ilustrar as ações");
  for (const f of all) {
    assert.match(f.html, /<svg [^>]*role="img"[^>]*aria-label="[^"]+"/, "toda figura precisa de aria-label");
    assert.doesNotMatch(f.html, /<defs|url\(#|<script|<image|<foreignObject|https?:\/\//, "SVG autossuficiente e seguro");
    assert.ok(f.caption.length > 20, "toda figura precisa de legenda");
  }
});

test("como jogar · figuras: peça em casa clara da dama e FEN inválido são recusados", () => {
  assert.throws(() => damaBoard({ pieces: { a2: "P" }, label: "x" }), /casa clara/);
  assert.throws(() => chessBoard({ fen: "8/8/8", label: "x" }), /FEN inválido/);
  assert.equal(Object.keys(parseFen(CHESS.start)).length, 32);
  assert.match(diceSvg([3, 5]), /aria-label="Dados: 3 e 5"/);
  assert.equal((gammonBoard({ label: "x" }).match(/<polygon/g) ?? []).length >= 24, true);
});

test("como jogar · conteúdo: ids únicos, três guias e links dos jogos", () => {
  assert.deepEqual(GUIDE_IDS, ["xadrez", "dama", "gamao"]);
  const catalog = read("js/games.js");
  for (const g of GUIDES) {
    const ids = g.sections.map(s => s.id);
    assert.equal(new Set(ids).size, ids.length, `${g.id}: ids de seção repetidos`);
    assert.ok(g.sections.length >= 6 && g.screen.steps.length >= 4, `${g.id}: guia curto demais`);
    assert.ok(g.legend.length === 4);
    assert.ok(catalog.includes(`path: "${g.cta.href}"`), `${g.id}: o botão aponta para um jogo que não está no catálogo`);
  }
});

test("como jogar · página: abas, módulo, tema e sem recursos externos", () => {
  const html = read("como-jogar.html");
  assert.match(html, /<script src="shared\/theme-init\.js"><\/script>/, "tema salvo antes da primeira pintura");
  assert.match(html, /id="cjTabs"[^>]*role="tablist"/);
  assert.match(html, /id="cjPanels"/);
  assert.match(html, /<script type="module" src="js\/como-jogar\.js"><\/script>/);
  assert.match(html, /name="viewport"[^>]*viewport-fit=cover/);
  assert.doesNotMatch(html, /https?:\/\//, "a página não depende de nada externo");
  const js = read("js/como-jogar.js");
  assert.match(js, /location\.hash/, "abas por #xadrez, #dama e #gamao");
  assert.match(js, /hashchange/);
});

test("como jogar · cada jogo de duelo tem o link 'Como jogar' à direita do título do setup, fora do sitebar", () => {
  const css = read("css/gamebar.css");
  assert.match(css, /howto-link/);
  for (const [dir, hash] of [["chess", "xadrez"], ["dama", "dama"], ["gamao", "gamao"]]) {
    const html = read(`games/${dir}/index.html`);
    assert.match(html, new RegExp(`<a class="howto-link" href="\\.\\./\\.\\./como-jogar\\.html#${hash}"`), `${dir}: link faltando`);
    assert.match(html, /<div class="setup-title-row"><h1 id="setupTitle">[^<]+<\/h1><a class="howto-link"[^>]*><span>Como jogar<\/span><\/a><\/div>/, `${dir}: o link deve ficar à direita do título do setup`);
    const nav = html.match(/<nav class="sitebar">[\s\S]*?<\/nav>/)?.[0] ?? "";
    assert.doesNotMatch(nav, /howto-link/, `${dir}: o link não fica mais no sitebar`);
    assert.match(nav, /<strong>[^<]+<\/strong><span class="mode-tag">1×1<\/span>/, `${dir}: o sitebar fica com o nome e o 1×1`);
  }
});

test("como jogar · celular: o rótulo 'Como jogar' continua visível e o texto dos passos flui na mesma linha", () => {
  const bar = read("css/gamebar.css");
  assert.ok(!bar.includes(".howto-link span{display:none}"), "no celular o link não pode virar só '?'");
  assert.ok(bar.includes(".setup-title-row"), "o link fica junto do título do setup");
  const css = read("css/como-jogar.css");
  assert.ok(!css.includes(".cj-steps b{display:block"), "o <b> dentro da frase do passo não pode virar bloco");
  assert.ok(css.includes(".cj-steps li > div > b{display:block"), "só o título do passo é bloco");
});

test("como jogar · o grupo Duelos 1×1 do hub não tem o botão (o guia abre pelo link de cada jogo)", () => {
  const hub = read("js/hub.js");
  const actions = hub.match(/const DUEL_ACTIONS = [\s\S]*?;/)?.[0] ?? "";
  assert.match(actions, /Criar Sala/);
  assert.match(actions, /Salas Online/);
  assert.doesNotMatch(actions, /Como jogar/);
});
