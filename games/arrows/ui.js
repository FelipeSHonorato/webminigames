import "../../shared/backend/boot.js";
import { Scores } from "../../shared/scores.js";
import { mountRanking } from "../../shared/ranking-panel.js";
import { Activity } from "../../shared/profile.js";
import { Coins, COINS_PER_DAY } from "../../shared/coins.js";
import { gameAllowed } from "../../shared/game-switch.js";
import { Run } from "../../shared/run.js";
import { coinBadge, fmtDuration } from "../../shared/coin-badge.js";
import { mountUserBar } from "../../js/userbar.js";
import { Music } from "../../shared/music.js";
import { requireSession } from "../../shared/session.js";
import { makeRng } from "../../shared/rng.js";
import { Cloud } from "../../shared/backend/cloud.js";
import { WINS_PER_LEVEL, Progress, pointsFor, pointsLegend } from "../../shared/progress.js";
import { DIRS, GEN, LEVELS, LIVES, STORE_KEY, beam, blocked, buildOcc, generatePuzzle } from "./domain.js";
import { fmtTime } from "../../shared/ranking-list.js";
import { nextScenario as nextScenarioOf, renderDailyPanel } from "../../shared/daily.js";

const sessionUser = requireSession("../../index.html");   // sem sessão, volta para o login
if (sessionUser && !gameAllowed("arrows", sessionUser)) location.replace("../../jogos.html");   // jogo desligado pelo administrador
mountUserBar(document.getElementById("userbar"), { base: "../../" });
const GAME_ID = "arrows";
Music.play(GAME_ID);
const uid = sessionUser?.id ?? "guest";
const isCloud = Cloud.owns(uid);                          // o desafio diário só existe na nuvem (a seed é do servidor)
const ranking = mountRanking({ gameId: GAME_ID, title: "Fuga das Setas", modes: isCloud ? ["daily", "points"] : ["points"] });
const coinsEl = document.getElementById("coinBadge");
/* Na nuvem o jogo é SÓ o desafio do dia (a fase aleatória deixou de existir); no modo local/visitante continua aleatória. */
const mode = isCloud ? "daily" : "random";

/* Meia-noite de Brasília (UTC-3, sem horário de verão): quando o desafio do dia e os coins do dia recomeçam. */
function nextSpMidnight() {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()).split("-").map(Number);
  return Date.UTC(y, m - 1, d + 1) + 3 * 3600 * 1000;
}

/* Coins: saldo ao lado do nome do jogo e liberação do botão "Nova fase" (só com fase concluída e coin disponível).
   No desafio diário o saldo mostrado é o do dia (reposto à meia-noite de Brasília; a quantidade é configurável). */
function renderCoins() {
  const next = document.getElementById("next"), reset = document.getElementById("reset");
  if (mode === "daily") {
    const d = Cloud.daily(GAME_ID) ?? { coins: 0 };
    coinsEl.replaceChildren(coinBadge({ coins: d.coins ?? 0, max: Math.max(d.slots ?? Cloud.config()?.coinsPerDay ?? COINS_PER_DAY, d.coins ?? 0), nextRefillAt: nextSpMidnight(), daily: true }));
    const left = nextScenario();                       // o botão só avança para o PRÓXIMO cenário (não há escolha)
    next.disabled = !solved || left == null;
    next.title = left == null ? "Sem tickets pendentes." : "Abrir o próximo cenário.";
    reset.disabled = solved;
    reset.title = solved ? "Reiniciar só está disponível enquanto a fase não é concluída." : "";
    return;
  }
  const balance = Coins.get(uid, GAME_ID);
  coinsEl.replaceChildren(coinBadge(balance));
  const canNext = solved && balance.coins > 0;
  next.disabled = !canNext;
  next.title = canNext ? "" : !solved ? "Conclua a fase atual para liberar a próxima." : `Sem coins por agora: novos em ${fmtDuration(balance.nextRefillAt - Date.now())}.`;
  reset.disabled = solved;                       // cenário concluído: não dá para reiniciar
  reset.title = solved ? "Reiniciar só está disponível enquanto a fase não é concluída." : "";
}
setInterval(renderCoins, 30000);   // a recarga de 24 h pode chegar com a página aberta
document.querySelector(".help")?.append(` ${pointsLegend()}`);   // pontuação junto da explicação do jogo

/* ===================== UI ===================== */
const board = document.getElementById("board");
const msg = document.getElementById("msg");
const timerEl = document.getElementById("timer");

/* ----- Progressão: a cada 15 vitórias o nível sobe (salvo no navegador) ----- */
const levelName = document.getElementById("levelName"), levelCount = document.getElementById("levelCount"), barFill = document.getElementById("barFill");
const loadWins = () => Progress.wins(STORE_KEY);   // nuvem: cache do Supabase; anônimo: navegador
const saveWins = n => Progress.setWins(STORE_KEY, n);   // na nuvem só atualiza a tela: o servidor soma a vitória em Scores.submit
const levelOf = w => Math.min(LEVELS.length - 1, Math.floor(w / WINS_PER_LEVEL));
let wins = loadWins(), credited = false;
const currentLevel = () => LEVELS[levelOf(wins)];
function renderLevel() {
  const i = levelOf(wins), last = i === LEVELS.length - 1, into = wins - i * WINS_PER_LEVEL;
  levelName.textContent = LEVELS[i].name;
  levelCount.textContent = last ? `${wins} vitórias` : `${into}/${WINS_PER_LEVEL}`;
  barFill.style.width = (last ? 100 : (into / WINS_PER_LEVEL) * 100) + "%";
}
/** Conta a vitória uma única vez por fase (reiniciar e resolver de novo não conta). */
function creditWin() {
  if (credited) { renderCoins(); return ""; }          // rejogar a mesma fase não pontua nem gasta coin
  credited = true;
  const before = levelOf(wins), points = pointsFor(puzzle.level ?? before);   // pontos do nível em que a fase foi gerada
  wins++; saveWins(wins); renderLevel();
  const cloudMode = Cloud.owns(uid);
  const spent = cloudMode ? false : Coins.spend(uid, GAME_ID);               // na nuvem o coin já foi cobrado ao SERVIR a fase (open)
  if (!cloudMode) Run.set(uid, GAME_ID, { seed: puzzle.seed, level: puzzle.level, solved: true, gen: GEN });
  let note = "";
  if (Scores.canRank()) {
    // Na nuvem o servidor recebe a ordem das retiradas, regenera a partir da seed e só pontua se ela limpar o tabuleiro de verdade.
    Scores.submit(GAME_ID, points, { state: { order } }).then(() => ranking.refresh());
    note = ` +${points} pontos!`;
  } else note = " Crie uma conta para pontuar no ranking.";
  if (spent) note += " −1 coin.";
  renderCoins();
  const left = Coins.get(uid, GAME_ID);
  if (!left.coins) note += ` Sem coins por agora: novos em ${fmtDuration(left.nextRefillAt - Date.now())}.`;
  return note + (levelOf(wins) > before ? ` Novo nível: ${currentLevel().name}!` : "");
}
function buildPuzzle(seed, level) {
  const p = generatePuzzle(makeRng(seed), LEVELS[level]);
  p.level = level; p.seed = seed;
  return p;
}
/** Fase servida pelo servidor: chega SEM a solução (a seed fica no servidor), então a tela não sabe a ordem certa. */
const serverPuzzle = (view, level) => ({
  n: view.n,
  pieces: view.pieces.map(p => ({ cells: p.cells.slice(), dir: p.dir })),
  redirectors: new Map((view.redirectors ?? []).map(r => [r.cell, r.dir])),
  level, server: true,
});
/** Fase nova no modo local: a seed fica salva, então recarregar a página devolve a mesma fase até ela ser concluída. */
function localFresh() {
  const seed = (Math.random() * 2 ** 32) >>> 0, level = levelOf(wins);
  Run.set(uid, GAME_ID, { seed, level, solved: false, gen: GEN });
  return buildPuzzle(seed, level);
}
/** Fase nova: na nuvem quem serve é o servidor (open cobra o coin e guarda a seed); local sorteia. */
const freshPuzzle = () => (Cloud.owns(uid) ? Cloud.open(GAME_ID).then(d => serverPuzzle(d.puzzle, d.level)) : Promise.resolve(localFresh()));

let puzzle, present = new Set(), order = [], solved = false, startedAt = 0, timerId = null;
let pieceEls = [], redirectorEls = [], lives = LIVES, turn = 0, boardLocked = false;
const SVGNS = "http://www.w3.org/2000/svg";
const DIR_NAMES = ["cima", "direita", "baixo", "esquerda"];
const DIR_COLORS = ["#3f8fd6", "#23b3a4", "#e4572e", "#e0a020"];   // cima, direita, baixo, esquerda
const REDIR_ARROW = "M0.5 0.26 L0.67 0.47 L0.56 0.47 L0.56 0.74 L0.44 0.74 L0.44 0.47 L0.33 0.47 Z";
const center = cell => { const n = puzzle.n; return [(cell % n) + 0.5, ((cell / n) | 0) + 0.5]; };

/** Ponta em forma de seta: triângulo na cabeça, apontando a direção de saída.
    `perp` é o vetor perpendicular em coordenadas de tela (x = coluna, y = linha). */
function tipPath(cell, d) {
  const [cx, cy] = center(cell), [dr, dc] = DIRS[d], px = dr, py = -dc;
  const tipx = cx + dc * 0.42, tipy = cy + dr * 0.42;   // ápice à frente
  const bx = cx - dc * 0.08, by = cy - dr * 0.08;       // base atrás do centro: encosta no corpo (sem vão)
  const w = 0.27;
  return `M${tipx} ${tipy} L${bx + px * w} ${by + py * w} L${bx - px * w} ${by - py * w} Z`;
}

/** Desenha cada seta como uma polilinha (com curvas) e a ponta na cabeça. Casas sem seta ficam vazias e as
    casas fixas (`redirectors`) viram blocos com uma seta dentro, que giram 90° a cada seta removida. */
function buildBoard() {
  const n = puzzle.n;
  board.style.setProperty("--n", n);
  board.replaceChildren();
  pieceEls = new Array(puzzle.pieces.length);
  redirectorEls = [];
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${n} ${n}`);
  svg.setAttribute("class", "pieces");
  svg.setAttribute("role", "group");
  svg.setAttribute("aria-label", "Tabuleiro de setas");

  /* Desviadores fixos: nenhuma seta ocupa estas casas; a ponta que entra nelas continua na direção indicada. */
  if (puzzle.redirectors) for (const [cell, dir] of puzzle.redirectors) {
    const g = document.createElementNS(SVGNS, "g");
    g.setAttribute("class", "redirector");
    g.setAttribute("transform", `translate(${cell % n} ${(cell / n) | 0})`);
    g.setAttribute("aria-hidden", "true");
    const box = document.createElementNS(SVGNS, "rect");
    box.setAttribute("x", 0.12); box.setAttribute("y", 0.12);
    box.setAttribute("width", 0.76); box.setAttribute("height", 0.76); box.setAttribute("rx", 0.14);
    const rot = document.createElementNS(SVGNS, "g");
    rot.setAttribute("class", "dir");
    rot.style.transform = `rotate(${((dir + turn) % 4) * 90}deg)`;   // estado inicial, sem animação
    const arrow = document.createElementNS(SVGNS, "path");
    arrow.setAttribute("d", REDIR_ARROW);
    rot.append(arrow);
    g.append(box, rot);
    svg.append(g);
    redirectorEls.push({ rot, dir });
  }

  puzzle.pieces.forEach((p, i) => {
    const g = document.createElementNS(SVGNS, "g");
    g.setAttribute("class", "piece"); g.dataset.i = i;
    g.setAttribute("role", "button"); g.setAttribute("tabindex", "0");
    g.setAttribute("aria-label", `Seta apontando para ${DIR_NAMES[p.dir]}`);
    g.style.setProperty("--c", DIR_COLORS[p.dir]);

    /* Peça de uma casa vira uma setinha curta: corpo reto atrás da ponta (com início na ponta, para escoar
       da cauda para a cabeça) e fundo reto. As demais seguem as casas. */
    let points;
    if (p.cells.length === 1) {
      const [cx, cy] = center(p.cells[0]), [dr, dc] = DIRS[p.dir];
      points = `${cx},${cy} ${cx - dc * 0.36},${cy - dr * 0.36}`;
    } else points = p.cells.map(c => { const [x, y] = center(c); return `${x},${y}`; }).join(" ");

    /* Área de clique = exatamente as casas da própria seta. As áreas não se sobrepõem (cada casa pertence a
       uma só seta), então clicar numa seta nunca aciona a vizinha — mesmo com a ponta perto da borda. */
    const hit = document.createElementNS(SVGNS, "path");
    hit.setAttribute("d", p.cells.map(c => {
      const x = c % n, y = (c / n) | 0;
      return `M${x} ${y}h1v1h-1z`;
    }).join(" "));
    const body = document.createElementNS(SVGNS, "polyline"); body.setAttribute("points", points);
    hit.setAttribute("class", "hit"); body.setAttribute("class", "body");
    const tip = document.createElementNS(SVGNS, "path");
    tip.setAttribute("d", tipPath(p.cells[0], p.dir)); tip.setAttribute("class", "tip");

    g.append(hit, body, tip);
    g.addEventListener("click", () => tap(i));
    g.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tap(i); } });
    svg.append(g); pieceEls[i] = g;
  });

  board.append(svg);
  renderLives();
}

/** Gira os desviadores para o estado atual: direção inicial + uma volta de 90° por seta já removida. */
function paintRedirectors() {
  for (const { rot, dir } of redirectorEls) rot.style.transform = `rotate(${((dir + turn) % 4) * 90}deg)`;
}

/** Corações das vidas: cheios enquanto restam; ao zerar, o tabuleiro volta e elas recarregam (o tempo continua). */
function renderLives() {
  const el = document.getElementById("lives");
  if (!el) return;
  el.replaceChildren(...Array.from({ length: LIVES }, (_, i) => {
    const h = document.createElement("span");
    h.className = "heart" + (i < lives ? " on" : "");
    h.textContent = i < lives ? "♥" : "♡";
    h.setAttribute("aria-hidden", "true");
    return h;
  }));
  el.setAttribute("aria-label", `Vidas: ${lives} de ${LIVES}`);
}

/** Perdeu uma vida batendo numa seta travada; ao chegar a zero, reinicia o tabuleiro SEM parar o cronômetro. */
function loseLife() {
  lives--;
  renderLives();
  if (lives > 0) { setMessage(`Seta travada! Vidas restantes: ${lives}.`, true); return; }
  present = new Set(puzzle.pieces.map((_, i) => i));
  order = []; lives = LIVES; solved = false; turn = 0; boardLocked = false;
  buildBoard();
  setMessage("Vidas esgotadas: o tabuleiro voltou ao início (o tempo continua).", true);
  renderCoins();
}

const formatTime = ms => { const s = Math.floor(ms / 1000); return `${String((s / 60) | 0).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
function startTimer(at = Date.now()) {
  if (timerId || solved) return;
  startedAt = at;                                            // no desafio do dia, o relógio começa quando o servidor abriu a fase
  if (sessionUser) Activity.played(sessionUser.id, GAME_ID); // alimenta "último jogo" no perfil
  timerId = setInterval(() => (timerEl.textContent = formatTime(Date.now() - startedAt)), 250);
}
function stopTimer() { clearInterval(timerId); timerId = null; }
function setMessage(text, isError = false) { msg.textContent = text; msg.classList.toggle("err", isError); }

/** keepTimer: o Reiniciar devolve as setas, mas o cronômetro segue de onde está (e só começa no primeiro toque). */
function loadPuzzle(p, { keepTimer = false } = {}) {
  if (p !== puzzle) credited = false;
  puzzle = p; present = new Set(puzzle.pieces.map((_, i) => i)); order = []; solved = false; lives = LIVES;
  turn = 0; boardLocked = false;
  if (!keepTimer) { stopTimer(); timerEl.textContent = "00:00"; }
  setMessage("");
  buildBoard();
  renderCoins();
}

/** Animação de saída no estilo "água no cano", em duas etapas:
    1) o corpo escoa pelo próprio caminho (cauda → ponta) via `stroke-dashoffset`;
    2) a ponta segue o CAMINHO da seta (com os desvios dos blocos) até fora do tabuleiro, girando nas curvas,
       e só lá some. `route` vem de beam(): { path: [casas], segs: [direção de saída de cada casa] }. */
function flyOut(el, piece, route, done) {
  const finish = () => { el.style.display = "none"; done?.(); };
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { finish(); return; }
  const n = puzzle.n, head = piece.cells[0], [hx, hy] = center(head);
  const body = el.querySelector("polyline.body"), tip = el.querySelector(".tip");
  const pts = route.path.map(cell => center(cell));
  const last = route.path[route.path.length - 1], lastDir = route.segs[route.segs.length - 1];
  const [ldr, ldc] = DIRS[lastDir], lr = (last / n) | 0, lc = last % n;
  const steps = [lr + 0.5, n - lc - 0.5, n - lr - 0.5, lc + 0.5][lastDir];   // casas da última até a borda
  pts.push([lc + 0.5 + ldc * steps, lr + 0.5 + ldr * steps]);                 // ponto fora do tabuleiro
  const segLen = pts.slice(1).map((p, j) => Math.hypot(p[0] - pts[j][0], p[1] - pts[j][1]));
  const total = segLen.reduce((a, b) => a + b, 0) || 1;
  const dur = 620, drainEnd = 0.45, t0 = performance.now();
  const clamp01 = v => Math.max(0, Math.min(1, v)), smooth = t => t * t * (3 - 2 * t);
  if (body) { body.setAttribute("pathLength", "100"); body.setAttribute("stroke-dasharray", "100"); }
  const step = now => {
    const t = Math.min(1, (now - t0) / dur);
    const drain = smooth(clamp01(t / drainEnd));               // etapa 1: esvazia da cauda para a cabeça
    if (body) body.setAttribute("stroke-dashoffset", (drain * 100).toFixed(2));
    const move = smooth(clamp01((t - drainEnd) / (1 - drainEnd)));   // etapa 2: a ponta percorre o caminho
    let dist = move * total, j = 0;
    while (j < segLen.length - 1 && dist > segLen[j]) { dist -= segLen[j]; j++; }
    const f = segLen[j] ? Math.min(1, dist / segLen[j]) : 0;
    const x = pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f;
    const y = pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f;
    el.setAttribute("transform", `translate(${(x - hx).toFixed(3)} ${(y - hy).toFixed(3)})`);
    if (tip) {
      tip.setAttribute("transform", `rotate(${(route.segs[j] - piece.dir) * 90} ${hx} ${hy})`);
      tip.style.opacity = String(t < 0.8 ? 1 : Math.max(0, 1 - (t - 0.8) / 0.2));   // some perto da borda
    }
    if (t < 1) requestAnimationFrame(step);
    else finish();
  };
  requestAnimationFrame(step);
}

/** Alguma seta pode sair no estado atual? (o giro dos blocos pode criar becos sem saída) */
function hasFreeMove() {
  const occ = buildOcc(puzzle.pieces, [...present]);
  for (const i of present) if (!blocked(puzzle.n, puzzle.pieces, occ, i, puzzle.redirectors, turn)) return true;
  return false;
}

/** Sem saída: volta ao layout inicial (desviadores no estado inicial) sem parar o cronômetro. */
function stuckReset() {
  boardLocked = true;
  setMessage("Sem saída: o tabuleiro voltou ao início (o tempo continua).", true);
  const old = puzzle;
  setTimeout(() => {
    if (old !== puzzle || !boardLocked || solved) return;
    present = new Set(puzzle.pieces.map((_, i) => i));
    order = []; turn = 0; boardLocked = false;
    buildBoard();
    setMessage("Sem saída: o tabuleiro voltou ao início (o tempo continua).", true);
  }, 650);
}

/** Um toque: se o caminho (com os desvios) estiver livre a seta escoa e sai; senão balança e custa uma vida.
    Tirar a última seta vence. */
function tap(i) {
  if (solved || boardLocked || !present.has(i)) return;
  startTimer();
  const occ = buildOcc(puzzle.pieces, [...present]);
  const route = beam(puzzle.n, puzzle.pieces[i].cells[0], puzzle.pieces[i].dir, occ, i, puzzle.redirectors, turn);
  if (!route) {
    const el = pieceEls[i];
    if (el) { el.classList.remove("shake"); void el.getBoundingClientRect(); el.classList.add("shake"); }
    loseLife();
    return;
  }
  setMessage("");
  boardLocked = true;                       // a seta sai primeiro; os blocos giram quando ela some
  present.delete(i); order.push(i);
  const after = () => {
    turn++;
    paintRedirectors();
    if (present.size === 0) {
      solved = true; stopTimer();
      if (mode === "daily") finishDaily();                     // desafio do dia: o SERVIDOR mede o tempo e pontua/progride
      else setMessage(`Resolvido em ${formatTime(Date.now() - startedAt)}!` + creditWin());
    } else if (!hasFreeMove()) stuckReset();
    else boardLocked = false;
  };
  const el = pieceEls[i];
  if (el) {
    el.classList.remove("shake");
    el.style.pointerEvents = "none";
    el.setAttribute("aria-hidden", "true");
    flyOut(el, puzzle.pieces[i], route, () => { if (el.isConnected) after(); });
  } else after();
}

document.getElementById("reset").onclick = () => { if (!solved) loadPuzzle(puzzle, { keepTimer: true }); };
document.getElementById("next").onclick = async () => {
  if (mode === "daily") {                              // desafio do dia: avança para o próximo cenário (sem escolher)
    const left = nextScenario();
    if (!solved || left == null) return;
    return openDaily(left);
  }
  if (!solved || Coins.get(uid, GAME_ID).coins <= 0) return;
  try { loadPuzzle(await freshPuzzle()); }
  catch (e) { setMessage(e?.code === "no_coins" ? "Sem coins por agora." : "Não foi possível abrir a fase. Tente de novo.", true); }
};

/** Fase já concluída (ao recarregar a página): mostra o tabuleiro limpo, trava e não pontua de novo. */
function restoreSolved() {
  credited = true; solved = true;
  present = new Set(); order = puzzle.solution.slice();
  turn = puzzle.solution.length; boardLocked = false;
  buildBoard();
  for (const el of pieceEls) if (el) { el.classList.add("out"); el.style.opacity = "0"; el.style.pointerEvents = "none"; }
  setMessage("Fase já concluída. Use “Nova fase” para continuar.");
  renderCoins();
}
/** Sem coins e sem fase salva: tabuleiro travado até a recarga. */
function lockBoard() {
  credited = true; solved = true;
  setMessage(`Sem coins por agora: novos em ${fmtDuration(Coins.get(uid, GAME_ID).nextRefillAt - Date.now())}.`);
  renderCoins();
}

/* ===================== Desafio diário =====================
   Mesmo cenário do dia para todos (por nível), ranking por TEMPO. Só na nuvem: a seed é derivada no servidor.
   A quantidade de cenários do dia é igual aos coins do dia (configurável pelo administrador). */
let dailyTicket = null;
const dailyEl = document.getElementById("daily");

const nextScenario = () => nextScenarioOf(GAME_ID);

/** Painel do desafio: progresso do dia e troféus dos cenários vencidos (shared/daily.js). */
function renderDaily() {
  if (mode !== "daily") return;
  renderDailyPanel({ el: dailyEl, gameId: GAME_ID, info: Cloud.daily(GAME_ID), day: dailyTicket?.day, slot: dailyTicket?.slot, won: solved });
}

async function openDaily(ticket) {
  try {
    const d = await Cloud.dailyOpen(GAME_ID, ticket.day, ticket.slot);
    dailyTicket = { day: d.day, slot: d.slot };
    loadPuzzle(serverPuzzle(d.puzzle, d.level));
    startTimer(d.startedAt ? Number(d.startedAt) : Date.now());
    setMessage(`Desafio do dia · ${LEVELS[d.level].name}. Tire todas as setas no menor tempo!`);
    renderDaily(); renderCoins();
  } catch (e) {
    setMessage(e?.code === "no_coins" ? "Sem tickets disponíveis: novos à meia-noite (Brasília)." : "Não foi possível abrir o desafio. Tente de novo.", true);
  }
}

/** Conclui o tabuleiro do dia: o SERVIDOR mede o tempo (relógio de parede) e guarda o melhor por slot. */
function finishDaily() {
  const localMs = Date.now() - startedAt;
  setMessage(`Resolvido em ${formatTime(localMs)}! Registrando…`);
  Cloud.dailyFinish(GAME_ID, dailyTicket?.day, dailyTicket?.slot, { order })
    .then(r => {
      setMessage(r.ok
        ? `Tempo do dia: ${fmtTime(r.ok.seconds)}.` + (r.ok.best != null && r.ok.best < r.ok.seconds ? ` Melhor do dia: ${fmtTime(r.ok.best)}.` : "")
        : `Tempo enviado (${formatTime(localMs)}); será confirmado quando a conexão voltar.`);
      wins = loadWins(); renderLevel();                  // concluir o cenário do dia também sobe a progressão (pontos)
      renderDaily(); renderCoins(); ranking.refresh();
    })
    .catch(() => setMessage(`Resolvido em ${formatTime(localMs)}, mas não deu para registrar o tempo. Tente de novo.`, true));
}

/** Tabuleiro neutro enquanto o cenário do dia é servido pelo servidor (não é jogável e não registra tempo). */
function dailyPlaceholder() {
  loadPuzzle(lockedPuzzle());
  credited = true; solved = true;
  setMessage("Preparando o cenário do dia…");
  renderCoins(); renderDaily();
}

/* Fase inicial. Na nuvem é o desafio do dia: o servidor serve o próximo cenário sozinho (sem escolha). No modo local,
   a fase aleatória de sempre (o desafio diário depende do servidor). */
renderLevel();
const lockedPuzzle = () => buildPuzzle((Math.random() * 2 ** 32) >>> 0, levelOf(wins));
if (mode === "daily") {
  document.getElementById("next").textContent = "Próximo cenário";   // não há escolha: o jogo avança para o próximo
  dailyEl.hidden = false;
  dailyPlaceholder();
  Cloud.dailyStatus().then(() => {
    renderDaily(); renderCoins(); ranking.refresh();
    const ticket = nextScenario();
    if (ticket == null) { credited = true; solved = true; setMessage("Você já concluiu os cenários disponíveis. Novos tickets à meia-noite (Brasília)."); renderCoins(); }
    else openDaily(ticket);                                           // abre sozinho o próximo ticket (mais antigo primeiro)
  });
} else {
  const saved = Run.get(uid, GAME_ID);
  if (saved) {
    loadPuzzle(buildPuzzle(saved.seed, saved.level));
    if (saved.solved) restoreSolved();
    else if (saved.gen !== GEN) Run.set(uid, GAME_ID, { seed: saved.seed, level: saved.level, solved: false, gen: GEN });
  }
  else if (Coins.get(uid, GAME_ID).coins > 0) loadPuzzle(localFresh());
  else { loadPuzzle(lockedPuzzle()); lockBoard(); }
}
