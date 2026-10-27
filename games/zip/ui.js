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
import { LEVELS, N, STORE_KEY, TOTAL, applyMove, generatePuzzle, isSolved, setSize } from "./domain.js";
import { fmtTime } from "../../shared/ranking-list.js";
import { nextScenario as nextScenarioOf, nextSpMidnight, renderDailyPanel, spDay } from "../../shared/daily.js";
import { mountTutorial } from "../../shared/tutorial.js";
import { ZIP_TUTORIAL } from "./tutorial.js";

const sessionUser = requireSession("../../index.html");   // sem sessão, volta para o login
if (sessionUser && !gameAllowed("zip", sessionUser)) location.replace("../../jogos.html");   // jogo desligado pelo administrador
mountUserBar(document.getElementById("userbar"), { base: "../../" });
const GAME_ID = "zip";
Music.play(GAME_ID);
const uid = sessionUser?.id ?? "guest";
const isCloud = Cloud.owns(uid);                          // o desafio diário só existe na nuvem (a seed é do servidor)
const ranking = mountRanking({ gameId: GAME_ID, title: "Zip" });
const coinsEl = document.getElementById("coinBadge");
/* Na nuvem o jogo é SÓ o desafio do dia (a fase aleatória deixou de existir); no modo local/visitante continua aleatória. */
const mode = isCloud ? "daily" : "random";
mountTutorial({ trigger: "howto", ...ZIP_TUTORIAL });


/* Coins: saldo ao lado do nome do jogo e liberação do botão "Nova fase" (só com fase concluída e coin disponível).
   No desafio diário o saldo mostrado é o do dia (reposto à meia-noite de Brasília; a quantidade é configurável). */
function renderCoins() {
  const next = document.getElementById("next"), reset = document.getElementById("reset");
  if (mode === "daily") {
    const d = Cloud.daily(GAME_ID) ?? { coins: 0 };
    coinsEl.replaceChildren(coinBadge({ coins: d.coins ?? 0, max: d.maxCoins ?? 30 * (d.slots ?? Cloud.config()?.coinsPerDay ?? COINS_PER_DAY), nextRefillAt: nextSpMidnight(), daily: true }));
    const left = nextScenario();                       // o botão só avança para o PRÓXIMO cenário (não há escolha)
    next.disabled = !solved || left == null;
    next.title = left == null ? "Sem tickets pendentes." : "Abrir o próximo cenário.";
  } else {
    const balance = Coins.get(uid, GAME_ID);
    coinsEl.replaceChildren(coinBadge(balance));
    const canNext = solved && balance.coins > 0;
    next.disabled = !canNext;
    next.title = canNext ? "" : !solved ? "Conclua a fase atual para liberar a próxima." : `Sem coins por agora: novos em ${fmtDuration(balance.nextRefillAt - Date.now())}.`;
  }
  reset.disabled = solved;                       // cenário concluído: não dá para reiniciar
  reset.title = solved ? "Reiniciar só está disponível enquanto a fase não é concluída." : "";
}
let seenDay = spDay();                             // a virada de Brasília chega com a página aberta
function tickDaily() {
  if (mode === "daily" && spDay() !== seenDay) {
    seenDay = spDay();
    Cloud.dailyStatus().then(() => {
      renderDaily(); renderCoins(); ranking.refresh();
      if (!dailyTicket) { const ticket = nextScenario(); if (ticket) openDaily(ticket); }
    });
    return;
  }
  renderCoins();
}
setInterval(tickDaily, 30000);
document.querySelector(".help")?.append(` ${pointsLegend()}`);   // pontuação junto da explicação do jogo

/* ===================== UI ===================== */
const svg = document.getElementById("board");
const msg = document.getElementById("msg");
const timerEl = document.getElementById("timer");
const S = 100;
let VIEW = N * S;
const center = c => [(c % N) * S + S / 2, ((c / N) | 0) * S + S / 2];
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

let puzzle, path = [], dragging = false, startedAt = 0, timerId = null, solved = false;
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
    // Na nuvem o servidor recebe o caminho, regenera a partir da seed e só pontua se for solução de verdade.
    Scores.submit(GAME_ID, points, { state: { path } }).then(() => ranking.refresh());
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
/** Fase servida pelo servidor: chega SEM a solução (a seed fica no servidor), então a tela não sabe o caminho. */
function serverPuzzle(view, level) {
  setSize(view.n);
  return { waypoints: new Map(view.waypoints), walls: new Set(view.walls), max: view.max, level, server: true };
}
/** Fase nova no modo local: a seed fica salva, então recarregar a página devolve a mesma fase até ela ser concluída. */
function localFresh() {
  const seed = (Math.random() * 2 ** 32) >>> 0, level = levelOf(wins);
  Run.set(uid, GAME_ID, { seed, level, solved: false });
  return buildPuzzle(seed, level);
}
/** Fase nova: na nuvem quem serve é o servidor (open cobra o coin e guarda a seed); local sorteia. */
const freshPuzzle = () => (Cloud.owns(uid) ? Cloud.open(GAME_ID).then(d => serverPuzzle(d.puzzle, d.level)) : Promise.resolve(localFresh()));

let head = { x: 0, y: 0 }, aim = { x: 0, y: 0 }, axis = null, pointer = null, rafId = null, lastT = 0, trailEl, headEl;

/* Camada estática: só é reconstruída ao trocar de fase. */
function buildBoard() {
  VIEW = N * S;
  svg.setAttribute("viewBox", `0 0 ${VIEW} ${VIEW}`);
  let h = "";
  for (let i = 0; i < TOTAL; i++) h += `<rect class="cell" x="${(i % N) * S}" y="${((i / N) | 0) * S}" width="${S}" height="${S}"/>`;
  h += `<path class="trail" id="trail"/><circle class="head" id="head" r="19" visibility="hidden"/>`;
  puzzle.waypoints.forEach((v, c) => {
    const [x, y] = center(c);
    h += `<circle class="node" data-c="${c}" cx="${x}" cy="${y}" r="30"/><text class="num" x="${x}" y="${y + 1}">${v}</text>`;
  });
  puzzle.walls.forEach(key => {
    const [a, b] = key.split("|").map(Number);
    if (b === a + 1) { const x = (b % N) * S, y = ((a / N) | 0) * S; h += `<line class="wall" x1="${x}" y1="${y}" x2="${x}" y2="${y + S}"/>`; }
    else { const y = ((b / N) | 0) * S, x = (a % N) * S; h += `<line class="wall" x1="${x}" y1="${y}" x2="${x + S}" y2="${y}"/>`; }
  });
  h += `<rect class="frame" x="3" y="3" width="${VIEW - 6}" height="${VIEW - 6}" rx="8"/>`;
  svg.innerHTML = h;
  trailEl = svg.querySelector("#trail");
  headEl = svg.querySelector("#head");
}
const syncNodes = () => svg.querySelectorAll(".node").forEach(n => n.classList.toggle("on", path.includes(+n.dataset.c)));

/* Curva com cantos arredondados passando pelos centros das células. */
function smoothPath(p, r = 20) {
  if (p.length < 2) return "";
  let d = `M${p[0][0]} ${p[0][1]}`;
  for (let i = 1; i < p.length - 1; i++) {
    const [a, b, c] = [p[i - 1], p[i], p[i + 1]];
    const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, l2 = Math.hypot(c[0] - b[0], c[1] - b[1]) || 1;
    const k1 = Math.min(r, l1 / 2) / l1, k2 = Math.min(r, l2 / 2) / l2;
    d += `L${b[0] + (a[0] - b[0]) * k1} ${b[1] + (a[1] - b[1]) * k1}Q${b[0]} ${b[1]} ${b[0] + (c[0] - b[0]) * k2} ${b[1] + (c[1] - b[1]) * k2}`;
  }
  const e = p[p.length - 1];
  return d + `L${e[0]} ${e[1]}`;
}

function draw() {
  if (!path.length) { trailEl.setAttribute("d", ""); headEl.setAttribute("visibility", "hidden"); return; }
  const cs = path.map(center), L = cs.length - 1, pts = cs.slice();
  if (L > 0) {                                     // cabeça ainda "atrás" do último centro: o traço termina nela
    const dx = Math.sign(cs[L][0] - cs[L - 1][0]), dy = Math.sign(cs[L][1] - cs[L - 1][1]);
    const hx = head.x - cs[L][0], hy = head.y - cs[L][1];
    if (hx * dx + hy * dy < -0.5 && Math.abs(hx * dy) + Math.abs(hy * dx) < 2) pts.pop();
  }
  pts.push([head.x, head.y]);
  trailEl.setAttribute("d", smoothPath(pts));
  headEl.setAttribute("cx", head.x); headEl.setAttribute("cy", head.y);
  headEl.setAttribute("visibility", "visible");
}

/* A cabeça segue o ponteiro projetado em UM eixo (reto), partindo do centro da última célula.
   Ao trocar de célula a posição absoluta é a mesma, então não há salto. */
function computeAim() {
  if (!path.length) return;
  const L = path.length - 1, [cx, cy] = center(path[L]);
  let ox = 0, oy = 0;
  if (dragging && pointer && !solved) {
    const px = pointer.x - cx, py = pointer.y - cy;
    const cur = axis === "x" ? Math.abs(px) : Math.abs(py), oth = axis === "x" ? Math.abs(py) : Math.abs(px);
    if (!axis || oth > cur + 14) axis = Math.abs(px) >= Math.abs(py) ? "x" : "y";   // histerese na troca de eixo
    const v = axis === "x" ? px : py, sgn = Math.sign(v) || 1;
    const col = path[L] % N, row = (path[L] / N) | 0;
    const nc = axis === "x" ? col + sgn : col, nr = axis === "y" ? row + sgn : row;
    const target = nc < 0 || nr < 0 || nc >= N || nr >= N ? -1 : nr * N + nc;
    let len = Math.abs(v);
    if (target === path[L - 1]) len = Math.min(len, S);                     // recuo: cabeça volta pelo traço
    else len = target >= 0 && applyMove(puzzle, path, target) !== path ? Math.min(len, S / 2 + 14) : 0;
    ox = axis === "x" ? sgn * len : 0; oy = axis === "y" ? sgn * len : 0;
  }
  aim = { x: cx + ox, y: cy + oy };
}
function kick() { if (!rafId) { lastT = performance.now(); rafId = requestAnimationFrame(tick); } }
function setAim() { computeAim(); kick(); }
function tick(t) {
  const k = reduceMotion ? 1 : 1 - Math.exp(-Math.min(t - lastT, 50) / 22);   // suavização mínima, só para amaciar trocas de eixo
  lastT = t;
  head.x += (aim.x - head.x) * k; head.y += (aim.y - head.y) * k;
  draw();
  rafId = Math.hypot(aim.x - head.x, aim.y - head.y) > 0.3 ? requestAnimationFrame(tick) : null;
}

const formatTime = ms => { const s = Math.floor(ms / 1000); return `${String((s / 60) | 0).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
function startTimer(at = Date.now()) {
  if (timerId) return;
  startedAt = at;                                            // no desafio do dia, o relógio começa quando o servidor abriu a fase
  if (sessionUser) Activity.played(sessionUser.id, "zip");   // alimenta "último jogo" no perfil
  timerId = setInterval(() => (timerEl.textContent = formatTime(Date.now() - startedAt)), 250);
  timerEl.textContent = formatTime(Date.now() - startedAt);
}
function stopTimer() { clearInterval(timerId); timerId = null; }

function update(newPath) {
  if (newPath === path) return;
  const isStep = path.length > 0 && Math.abs(newPath.length - path.length) === 1;
  path = newPath;
  axis = null;                                    // eixo de entrada na nova última célula
  if (path.length > 1) { const [a, b] = [center(path[path.length - 2]), center(path[path.length - 1])]; axis = a[0] !== b[0] ? "x" : "y"; }
  if (path.length && !solved) startTimer();
  if (isSolved(puzzle, path)) {
    solved = true; dragging = false; stopTimer();
    if (mode === "daily") finishDaily();        // desafio do dia: o SERVIDOR mede o tempo e pontua/progride
    else msg.textContent = `Resolvido em ${formatTime(Date.now() - startedAt)}!` + creditWin();
  } else msg.textContent = "";
  svg.classList.toggle("done", solved);
  syncNodes(); computeAim();
  if (!isStep) head = { ...aim };                  // cortes/primeira célula: sem animação
  kick(); draw();
}

/** keepTimer: o Reiniciar limpa o tabuleiro, mas o cronômetro segue de onde está (e só começa no primeiro movimento, como sempre). */
function loadPuzzle(p, { keepTimer = false } = {}) {
  if (p !== puzzle) credited = false;
  puzzle = p; path = []; solved = false; dragging = false; pointer = null;
  if (!keepTimer) { stopTimer(); timerEl.textContent = "00:00"; }
  msg.textContent = "";
  svg.classList.remove("done");
  buildBoard(); draw();
  renderCoins();
}

/* Coordenadas do ponteiro no sistema do viewBox; margin evita "tremida" na borda entre células. */
const toView = e => { const r = svg.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * VIEW, y: ((e.clientY - r.top) / r.height) * VIEW }; };
const cellAtXY = (x, y, margin = 0) => {
  const c = Math.floor(x / S), r = Math.floor(y / S);
  if (c < 0 || r < 0 || c >= N || r >= N) return -1;
  const fx = x - c * S, fy = y - r * S;
  return fx < margin || fy < margin || fx > S - margin || fy > S - margin ? -1 : r * N + c;
};

svg.addEventListener("pointerdown", e => {
  if (solved) return;
  const p = toView(e), cell = cellAtXY(p.x, p.y);
  if (cell < 0) return;
  svg.setPointerCapture(e.pointerId);
  const idx = path.indexOf(cell);
  if (idx >= 0) update(path.slice(0, idx + 1));   // tocar no caminho recorta até ali
  else if (!path.length) update(applyMove(puzzle, path, cell));
  dragging = path.length > 0; pointer = p; setAim();
});
svg.addEventListener("pointermove", e => {
  if (!dragging || solved) return;
  const p = toView(e), from = pointer || p, dx = p.x - from.x, dy = p.y - from.y;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 20));   // amostragem: não pula células em arrastes rápidos
  for (let s = 1; s <= steps && !solved; s++) {
    const cell = cellAtXY(from.x + (dx * s) / steps, from.y + (dy * s) / steps, 14);
    if (cell >= 0 && cell !== path[path.length - 1]) update(applyMove(puzzle, path, cell));
  }
  pointer = p; setAim();
});
["pointerup", "pointercancel"].forEach(t => svg.addEventListener(t, () => { dragging = false; pointer = null; setAim(); }));

svg.addEventListener("keydown", e => {
  if (solved) return;
  if (e.key === "Backspace") { e.preventDefault(); update(path.slice(0, -1)); return; }
  if (!path.length) { if (e.key.startsWith("Arrow")) { const one = [...puzzle.waypoints].find(([, v]) => v === 1)[0]; update([one]); } return; }
  const last = path[path.length - 1], c = last % N;
  const target = { ArrowUp: last - N, ArrowDown: last + N, ArrowLeft: c > 0 ? last - 1 : -1, ArrowRight: c < N - 1 ? last + 1 : -1 }[e.key];
  if (target === undefined) return;
  e.preventDefault();
  if (target >= 0 && target < TOTAL) update(applyMove(puzzle, path, target));
});

document.getElementById("undo").onclick = () => !solved && update(path.slice(0, -1));
document.getElementById("reset").onclick = () => { if (!solved) loadPuzzle(puzzle, { keepTimer: true }); };
document.getElementById("next").onclick = async () => {
  if (mode === "daily") {                              // desafio do dia: avança para o próximo cenário (sem escolher)
    const left = nextScenario();
    if (!solved || left == null) return;
    return openDaily(left);
  }
  if (!solved || Coins.get(uid, GAME_ID).coins <= 0) return;
  try { loadPuzzle(await freshPuzzle()); }
  catch (e) { msg.textContent = e?.code === "no_coins" ? "Sem coins por agora." : "Não foi possível abrir a fase. Tente de novo."; }
};

/** Fase já concluída (ao recarregar a página): mostra a solução, trava o tabuleiro e não pontua de novo. */
function restoreSolved() {
  credited = true; solved = true;
  path = puzzle.solution;
  syncNodes(); svg.classList.add("done");
  computeAim(); head = { ...aim }; draw();
  msg.textContent = "Fase já concluída. Use “Nova fase” para continuar.";
  renderCoins();
}
/** Sem coins e sem fase salva: tabuleiro travado até a recarga. */
function lockBoard() {
  credited = true; solved = true;
  msg.textContent = `Sem coins por agora: novos em ${fmtDuration(Coins.get(uid, GAME_ID).nextRefillAt - Date.now())}.`;
  renderCoins();
}

/* ===================== Desafio diário =====================
   Mesmo cenário do dia para todos (por nível). Só na nuvem: a seed é derivada no servidor; o tempo fica nos troféus.
   A quantidade de cenários do dia é igual aos coins do dia (configurável pelo administrador). */
let dailyTicket = null;
const dailyEl = document.getElementById("daily");

const nextScenario = () => nextScenarioOf(GAME_ID);

/** Painel do desafio: progresso do dia e troféus dos cenários vencidos (shared/daily.js). */
function renderDaily() {
  if (mode !== "daily") return;
  renderDailyPanel({ el: dailyEl, gameId: GAME_ID, info: Cloud.daily(GAME_ID), day: dailyTicket?.day, slot: dailyTicket?.slot, won: solved, onNext: () => document.getElementById("next").click() });
}

async function openDaily(ticket) {
  try {
    const d = await Cloud.dailyOpen(GAME_ID, ticket.day, ticket.slot);
    dailyTicket = { day: d.day, slot: d.slot };
    loadPuzzle(serverPuzzle(d.puzzle, d.level));
    startTimer(d.startedAt ? Number(d.startedAt) : Date.now());
    msg.textContent = `Desafio do dia · ${LEVELS[d.level].name}. Faça o menor tempo!`;
    renderDaily(); renderCoins();
  } catch (e) {
    msg.textContent = e?.code === "no_coins" ? "Sem tickets disponíveis: novos à meia-noite (Brasília)." : "Não foi possível abrir o desafio. Tente de novo.";
  }
}

/** Conclui o tabuleiro do dia: o SERVIDOR mede o tempo (relógio de parede, +30 s por dica) e guarda o melhor por slot. */
function finishDaily() {
  const localMs = Date.now() - startedAt;
  msg.textContent = `Resolvido em ${formatTime(localMs)}! Registrando…`;
  Cloud.dailyFinish(GAME_ID, dailyTicket?.day, dailyTicket?.slot, { path })
    .then(r => {
      msg.textContent = r.ok
        ? `Tempo do cenário: ${fmtTime(r.ok.seconds)}.` + (r.ok.best != null && r.ok.best < r.ok.seconds ? ` Melhor do cenário: ${fmtTime(r.ok.best)}.` : "")
        : `Tempo enviado (${formatTime(localMs)}); será confirmado quando a conexão voltar.`;
      wins = loadWins(); renderLevel();                  // concluir o cenário do dia também sobe a progressão (pontos)
      renderDaily(); renderCoins(); ranking.refresh();
    })
    .catch(() => { msg.textContent = `Resolvido em ${formatTime(localMs)}, mas não deu para registrar o tempo. Tente de novo.`; });
}

/** Tabuleiro neutro enquanto o cenário do dia é servido pelo servidor (não é jogável e não registra tempo). */
function dailyPlaceholder() {
  loadPuzzle(lockedPuzzle());
  credited = true; solved = true;
  msg.textContent = "Preparando o cenário do dia…";
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
    if (ticket == null) { credited = true; solved = true; msg.textContent = "Você já concluiu os cenários disponíveis. Novos tickets à meia-noite (Brasília)."; renderCoins(); }
    else openDaily(ticket);                                           // abre sozinho o próximo ticket (mais antigo primeiro)
  });
} else if (isCloud) {
  const cached = Cloud.phase(GAME_ID);
  if (cached) loadPuzzle(serverPuzzle(cached.puzzle, cached.level));
  else if (Coins.get(uid, GAME_ID).coins > 0) freshPuzzle().then(p => loadPuzzle(p)).catch(e => { loadPuzzle(lockedPuzzle()); e?.code === "no_coins" ? lockBoard() : msg.textContent = "Não foi possível carregar a fase. Recarregue a página."; });
  else { loadPuzzle(lockedPuzzle()); lockBoard(); }
} else {
  const saved = Run.get(uid, GAME_ID);
  if (saved) { loadPuzzle(buildPuzzle(saved.seed, saved.level)); if (saved.solved) restoreSolved(); }
  else if (Coins.get(uid, GAME_ID).coins > 0) loadPuzzle(localFresh());
  else { loadPuzzle(lockedPuzzle()); lockBoard(); }
}
