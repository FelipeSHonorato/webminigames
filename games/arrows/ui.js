import "../../shared/backend/boot.js";
import { Scores } from "../../shared/scores.js";
import { mountRanking } from "../../shared/ranking-panel.js";
import { Activity } from "../../shared/profile.js";
import { Coins, COINS_PER_DAY } from "../../shared/coins.js";
import { gameAllowed } from "../../shared/game-switch.js";
import { Run } from "../../shared/run.js";
import { coinBadge, fmtDuration } from "../../shared/coin-badge.js";
import { mountUserBar } from "../../js/userbar.js";
import { requireSession } from "../../shared/session.js";
import { makeRng } from "../../shared/rng.js";
import { Cloud } from "../../shared/backend/cloud.js";
import { WINS_PER_LEVEL, Progress, pointsFor, pointsLegend } from "../../shared/progress.js";
import { DIRS, LEVELS, LIVES, STORE_KEY, blocked, buildOcc, generatePuzzle } from "./domain.js";
import { fmtTime } from "../../shared/ranking-list.js";

const sessionUser = requireSession("../../index.html");   // sem sessão, volta para o login
if (sessionUser && !gameAllowed("arrows", sessionUser)) location.replace("../../jogos.html");   // jogo desligado pelo administrador
mountUserBar(document.getElementById("userbar"), { base: "../../" });
const GAME_ID = "arrows";
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
    coinsEl.replaceChildren(coinBadge({ coins: d.coins ?? 0, max: d.slots ?? Cloud.config()?.coinsPerDay ?? COINS_PER_DAY, nextRefillAt: nextSpMidnight() }));
    const left = nextScenario();                       // o botão só avança para o PRÓXIMO cenário (não há escolha)
    next.disabled = !solved || left == null || (d.coins ?? 0) <= 0;
    next.title = left == null ? "Você já concluiu os cenários do dia." : (d.coins ?? 0) <= 0 ? "Sem coins do dia." : "Abrir o próximo cenário.";
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
  if (!cloudMode) Run.set(uid, GAME_ID, { seed: puzzle.seed, level: puzzle.level, solved: true });
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
const serverPuzzle = (view, level) => ({ n: view.n, pieces: view.pieces.map(p => ({ cells: p.cells.slice(), dir: p.dir })), level, server: true });
/** Fase nova no modo local: a seed fica salva, então recarregar a página devolve a mesma fase até ela ser concluída. */
function localFresh() {
  const seed = (Math.random() * 2 ** 32) >>> 0, level = levelOf(wins);
  Run.set(uid, GAME_ID, { seed, level, solved: false });
  return buildPuzzle(seed, level);
}
/** Fase nova: na nuvem quem serve é o servidor (open cobra o coin e guarda a seed); local sorteia. */
const freshPuzzle = () => (Cloud.owns(uid) ? Cloud.open(GAME_ID).then(d => serverPuzzle(d.puzzle, d.level)) : Promise.resolve(localFresh()));

let puzzle, present = new Set(), order = [], solved = false, startedAt = 0, timerId = null;
let pieceEls = [], lives = LIVES;
const SVGNS = "http://www.w3.org/2000/svg";
const DIR_NAMES = ["cima", "direita", "baixo", "esquerda"];
const DIR_COLORS = ["#3f8fd6", "#23b3a4", "#e4572e", "#e0a020"];   // cima, direita, baixo, esquerda
const center = cell => { const n = puzzle.n; return [(cell % n) + 0.5, ((cell / n) | 0) + 0.5]; };

/** Ponta em forma de seta: triângulo na cabeça, apontando a direção de saída.
    `perp` é o vetor perpendicular em coordenadas de tela (x = coluna, y = linha). */
function tipPath(cell, d) {
  const [cx, cy] = center(cell), [dr, dc] = DIRS[d], px = dr, py = -dc;
  const tipx = cx + dc * 0.46, tipy = cy + dr * 0.46;   // ápice à frente
  const bx = cx + dc * 0.10, by = cy + dr * 0.10;       // base logo à frente do centro
  const w = 0.27;
  return `M${tipx} ${tipy} L${bx + px * w} ${by + py * w} L${bx - px * w} ${by - py * w} Z`;
}

/** Desenha cada seta como uma polilinha (com curvas) e a ponta na cabeça. A grade é sempre cheia; casas sem
    seta simplesmente ficam vazias (o gerador deixa poucas). */
function buildBoard() {
  const n = puzzle.n;
  board.style.setProperty("--n", n);
  board.replaceChildren();
  pieceEls = new Array(puzzle.pieces.length);
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${n} ${n}`);
  svg.setAttribute("class", "pieces");
  svg.setAttribute("role", "group");
  svg.setAttribute("aria-label", "Tabuleiro de setas");

  puzzle.pieces.forEach((p, i) => {
    const g = document.createElementNS(SVGNS, "g");
    g.setAttribute("class", "piece"); g.dataset.i = i;
    g.setAttribute("role", "button"); g.setAttribute("tabindex", "0");
    g.setAttribute("aria-label", `Seta apontando para ${DIR_NAMES[p.dir]}`);
    g.style.setProperty("--c", DIR_COLORS[p.dir]);

    const points = p.cells.map(c => { const [x, y] = center(c); return `${x},${y}`; }).join(" ");
    let hit, body;
    if (p.cells.length === 1) {
      const [x, y] = center(p.cells[0]);
      hit = document.createElementNS(SVGNS, "circle");
      hit.setAttribute("cx", x); hit.setAttribute("cy", y); hit.setAttribute("r", 0.5);
      body = document.createElementNS(SVGNS, "circle");
      body.setAttribute("cx", x); body.setAttribute("cy", y); body.setAttribute("r", 0.17);
    } else {
      hit = document.createElementNS(SVGNS, "polyline"); hit.setAttribute("points", points);
      body = document.createElementNS(SVGNS, "polyline"); body.setAttribute("points", points);
    }
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
  order = []; lives = LIVES; solved = false;
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
  if (!keepTimer) { stopTimer(); timerEl.textContent = "00:00"; }
  setMessage("");
  buildBoard();
  renderCoins();
}

/** Animação de saída no estilo "água no cano": a peça escoa pelo próprio caminho, da ponta oposta
    (cauda) até a ponta da seta, e some no fim. Um traço com `stroke-dasharray` normalizado
    (`pathLength=100`) é "esvaziado" pelo `stroke-dashoffset`, como a água percorrendo o cano. */
function flyOut(el, piece) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { el.style.display = "none"; return; }
  const body = el.querySelector("polyline.body"), circle = el.querySelector("circle.body"), tip = el.querySelector(".tip");
  const dur = 480, t0 = performance.now();
  if (body) { body.setAttribute("pathLength", "100"); body.setAttribute("stroke-dasharray", "100"); }
  const step = now => {
    const t = Math.min(1, (now - t0) / dur), e = t * t * (3 - 2 * t);   // suave nas pontas
    if (body) body.setAttribute("stroke-dashoffset", (e * 100).toFixed(2));   // esvazia da cauda para a ponta
    if (circle) circle.setAttribute("r", (0.17 * (1 - e)).toFixed(4));         // peça de uma casa: encolhe
    if (tip) tip.style.opacity = String(Math.max(0, 1 - Math.max(0, (t - 0.7) / 0.3)));
    if (t < 1) requestAnimationFrame(step);
    else el.style.display = "none";
  };
  requestAnimationFrame(step);
}

/** Um toque: se o caminho estiver livre a seta inteira desliza e sai; senão balança e custa uma vida.
    Tirar a última seta vence. */
function tap(i) {
  if (solved || !present.has(i)) return;
  startTimer();
  const occ = buildOcc(puzzle.pieces, [...present]);
  if (blocked(puzzle.n, puzzle.pieces, occ, i)) {
    const el = pieceEls[i];
    if (el) { el.classList.remove("shake"); void el.getBoundingClientRect(); el.classList.add("shake"); }
    loseLife();
    return;
  }
  setMessage("");
  present.delete(i); order.push(i);
  const el = pieceEls[i];
  if (el) {
    el.style.pointerEvents = "none";
    el.setAttribute("aria-hidden", "true");
    flyOut(el, puzzle.pieces[i]);
  }
  if (present.size === 0) {
    solved = true; stopTimer();
    if (mode === "daily") finishDaily();                       // desafio do dia: o SERVIDOR mede o tempo e pontua/progride
    else setMessage(`Resolvido em ${formatTime(Date.now() - startedAt)}!` + creditWin());
  }
}

document.getElementById("reset").onclick = () => { if (!solved) loadPuzzle(puzzle, { keepTimer: true }); };
document.getElementById("next").onclick = async () => {
  if (mode === "daily") {                              // desafio do dia: avança para o próximo cenário (sem escolher)
    const left = nextScenario();
    if (!solved || left == null || (Cloud.daily(GAME_ID)?.coins ?? 0) <= 0) return;
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
let dailySlot = 0;
const dailyEl = document.getElementById("daily");

const dailySlots = info => info?.slots ?? Cloud.config()?.coinsPerDay ?? COINS_PER_DAY;
const slotsOf = info => Array.from({ length: dailySlots(info) }, (_, i) => ({ slot: i + 1, seconds: info?.results?.[i + 1] ?? null }));
const bestDaily = info => { const v = slotsOf(info).map(s => s.seconds).filter(s => s != null); return v.length ? Math.min(...v) : null; };
/** Próximo cenário a jogar = o primeiro ainda não concluído hoje. Não dá para escolher: o servidor serve esse. */
const nextScenario = () => {
  const info = Cloud.daily(GAME_ID);
  const done = new Set(Object.keys(info?.results ?? {}).map(Number));
  return slotsOf(info).map(s => s.slot).find(s => !done.has(s)) ?? null;
};

/** Painel do desafio: mostra o progresso do dia (um cenário por coin). É só leitura: o cenário é servido pelo servidor. */
function renderDaily() {
  if (mode !== "daily") return;
  const info = Cloud.daily(GAME_ID) ?? { coins: 0, slots: dailySlots(null), results: {}, level: 0 };
  dailyEl.replaceChildren();
  const status = document.createElement("div");
  status.className = "slots";
  for (const { slot, seconds } of slotsOf(info)) {
    const done = seconds != null;
    const playing = !done && slot === dailySlot && !solved;
    const chip = document.createElement("span");
    chip.className = "slot" + (done ? " done" : playing ? " current" : " pending");
    chip.textContent = done ? `Cenário ${slot}: ${fmtTime(seconds)}` : playing ? `Cenário ${slot}: jogando` : `Cenário ${slot}: pendente`;
    status.append(chip);
  }
  dailyEl.append(status);
  const tip = document.createElement("p");
  tip.className = "daily-tip";
  const best = bestDaily(info);
  tip.textContent = (info.coins ?? 0) > 0
    ? `${info.coins} ${info.coins === 1 ? "coin" : "coins"} do dia · melhor tempo: ${best != null ? fmtTime(best) : "—"}.`
    : "Sem coins do dia: voltam à meia-noite (Brasília).";
  dailyEl.append(tip);
}

async function openDaily(slot) {
  try {
    const d = await Cloud.dailyOpen(GAME_ID, slot);
    dailySlot = slot;
    loadPuzzle(serverPuzzle(d.puzzle, d.level));
    startTimer(d.startedAt ? Number(d.startedAt) : Date.now());
    setMessage(`Desafio do dia · ${LEVELS[d.level].name}. Tire todas as setas no menor tempo!`);
    renderDaily(); renderCoins();
  } catch (e) {
    setMessage(e?.code === "no_coins" ? "Sem coins do dia: voltam à meia-noite (Brasília)." : "Não foi possível abrir o desafio. Tente de novo.", true);
  }
}

/** Conclui o tabuleiro do dia: o SERVIDOR mede o tempo (relógio de parede) e guarda o melhor por slot. */
function finishDaily() {
  const localMs = Date.now() - startedAt;
  setMessage(`Resolvido em ${formatTime(localMs)}! Registrando…`);
  Cloud.dailyFinish(GAME_ID, dailySlot, { order })
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
    renderDaily(); renderCoins();
    const slot = nextScenario();
    if (slot == null) { credited = true; solved = true; setMessage("Você já concluiu os cenários do dia. Novos à meia-noite (Brasília)."); renderCoins(); }
    else if ((Cloud.daily(GAME_ID)?.coins ?? 0) <= 0) { credited = true; solved = true; setMessage("Sem coins do dia: voltam à meia-noite (Brasília)."); renderCoins(); }
    else openDaily(slot);                                             // abre sozinho o próximo cenário do dia (gasta 1 coin)
  });
} else {
  const saved = Run.get(uid, GAME_ID);
  if (saved) { loadPuzzle(buildPuzzle(saved.seed, saved.level)); if (saved.solved) restoreSolved(); }
  else if (Coins.get(uid, GAME_ID).coins > 0) loadPuzzle(localFresh());
  else { loadPuzzle(lockedPuzzle()); lockBoard(); }
}
