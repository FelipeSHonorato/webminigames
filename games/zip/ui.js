import { Scores } from "../../shared/scores.js";
import { mountRanking } from "../../shared/ranking-panel.js";
import { Activity } from "../../shared/profile.js";
import { Coins } from "../../shared/coins.js";
import { gameAllowed } from "../../shared/game-switch.js";
import { Run } from "../../shared/run.js";
import { coinBadge, fmtDuration } from "../../shared/coin-badge.js";
import { mountUserBar } from "../../js/userbar.js";
import { requireSession } from "../../shared/session.js";
import { makeRng } from "../../shared/rng.js";
import { WINS_PER_LEVEL, winsKey, pointsFor, pointsLegend } from "../../shared/progress.js";
import { LEVELS, N, STORE_KEY, TOTAL, applyMove, generatePuzzle, isSolved } from "./domain.js";

const sessionUser = requireSession("../../index.html");   // sem sessão, volta para o login
if (sessionUser && !gameAllowed("zip", sessionUser)) location.replace("../../jogos.html");   // jogo desligado pelo administrador
mountUserBar(document.getElementById("userbar"), { base: "../../" });
const ranking = mountRanking({ gameId: "zip", title: "Zip" });
const GAME_ID = "zip";
const uid = sessionUser?.id ?? "guest";
const coinsEl = document.getElementById("coinBadge");

/* Coins: saldo ao lado do nome do jogo e liberação do botão "Nova fase" (só com fase concluída e coin disponível). */
function renderCoins() {
  const balance = Coins.get(uid, GAME_ID), next = document.getElementById("next");
  coinsEl.replaceChildren(coinBadge(balance));
  const canNext = solved && balance.coins > 0;
  next.disabled = !canNext;
  next.title = canNext ? "" : !solved ? "Conclua a fase atual para liberar a próxima." : `Sem coins por agora: novos em ${fmtDuration(balance.nextRefillAt - Date.now())}.`;
}
setInterval(renderCoins, 30000);   // a recarga de 24 h pode chegar com a página aberta
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
function loadWins() { try { return Math.max(0, parseInt(localStorage.getItem(winsKey(STORE_KEY)), 10) || 0); } catch { return 0; } }
function saveWins(n) { try { localStorage.setItem(winsKey(STORE_KEY), String(n)); } catch { /* sem armazenamento: segue sem salvar */ } }
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
  const spent = Coins.spend(uid, GAME_ID);                                   // o coin só é gasto aqui, ao concluir a fase
  Run.set(uid, GAME_ID, { seed: puzzle.seed, level: puzzle.level, solved: true });
  let note = "";
  if (Scores.canRank()) {
    Scores.submit(GAME_ID, points).then(() => ranking.refresh());              // só aqui, ao concluir o cenário
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
/** Nova fase: a seed fica salva, então recarregar a página devolve a mesma fase até ela ser concluída. */
function freshPuzzle() {
  const seed = (Math.random() * 2 ** 32) >>> 0, level = levelOf(wins);
  Run.set(uid, GAME_ID, { seed, level, solved: false });
  return buildPuzzle(seed, level);
}

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
function startTimer() {
  if (timerId) return;
  startedAt = Date.now();
  if (sessionUser) Activity.played(sessionUser.id, "zip");   // alimenta "último jogo" no perfil
  timerId = setInterval(() => (timerEl.textContent = formatTime(Date.now() - startedAt)), 250);
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
    msg.textContent = `Resolvido em ${formatTime(Date.now() - startedAt)}!` + creditWin();
  } else msg.textContent = "";
  svg.classList.toggle("done", solved);
  syncNodes(); computeAim();
  if (!isStep) head = { ...aim };                  // cortes/primeira célula: sem animação
  kick(); draw();
}

function loadPuzzle(p) {
  if (p !== puzzle) credited = false;
  puzzle = p; path = []; solved = false; dragging = false; pointer = null;
  stopTimer(); timerEl.textContent = "00:00"; msg.textContent = "";
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
document.getElementById("reset").onclick = () => loadPuzzle(puzzle);
document.getElementById("next").onclick = () => { if (solved && Coins.get(uid, GAME_ID).coins > 0) loadPuzzle(freshPuzzle()); };

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

/* Fase inicial: volta a fase salva (mesma seed); sem fase salva, sorteia uma no nível atual se houver coin. */
renderLevel();
const saved = Run.get(uid, GAME_ID);
if (saved) { loadPuzzle(buildPuzzle(saved.seed, saved.level)); if (saved.solved) restoreSolved(); }
else if (Coins.get(uid, GAME_ID).coins > 0) loadPuzzle(freshPuzzle());
else { loadPuzzle(buildPuzzle((Math.random() * 2 ** 32) >>> 0, levelOf(wins))); lockBoard(); }
