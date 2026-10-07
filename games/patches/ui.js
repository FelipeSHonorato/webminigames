import { Scores } from "../../shared/scores.js";
import { mountRanking } from "../../shared/ranking-panel.js";
import { requireSession } from "../../shared/session.js";
import { makeRng } from "../../shared/rng.js";
import { WINS_PER_LEVEL, winsKey, pointsFor, pointsLegend } from "../../shared/progress.js";
import { LEVELS, N, STORE_KEY, TOTAL, generatePuzzle, isSolved, rectCells, validateRect } from "./domain.js";

requireSession("../../index.html");   // sem sessão, volta para o login
const ranking = mountRanking({ gameId: "patches", title: "Patches" });
document.querySelector(".help")?.append(` ${pointsLegend()}`);   // pontuação junto da explicação do jogo

/* ===================== UI ===================== */
const board = document.getElementById("board");
const msg = document.getElementById("msg");
const timerEl = document.getElementById("timer");

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
  if (credited) return "";
  credited = true;
  const before = levelOf(wins), points = pointsFor(puzzle.level ?? before);   // pontos do nível em que a fase foi gerada
  wins++; saveWins(wins); renderLevel();
  let note = "";
  if (Scores.canRank()) {
    Scores.submit("patches", points).then(() => ranking.refresh());              // só aqui, ao concluir o cenário
    note = ` +${points} pontos!`;
  } else note = " Crie uma conta para pontuar no ranking.";
  return note + (levelOf(wins) > before ? ` Novo nível: ${currentLevel().name}!` : "");
}
function newPuzzle() {
  const level = levelOf(wins), p = generatePuzzle(makeRng((Math.random() * 2 ** 32) >>> 0), LEVELS[level]);
  p.level = level;
  return p;
}

let puzzle, patches = [], drag = null, solved = false, startedAt = 0, timerId = null;
let patchLayer, ghost;

const hue = i => Math.round((i * 137.5 + 20) % 360);
const place = ([r0, c0, r1, c1]) =>
  `left:${(c0 / N) * 100}%;top:${(r0 / N) * 100}%;width:${((c1 - c0 + 1) / N) * 100}%;height:${((r1 - r0 + 1) / N) * 100}%`;
const boxHTML = (rect, clue, cls) => `<div class="box ${cls}" style="${place(rect)};--h:${hue(clue)}"><div class="fill"></div></div>`;

function buildBoard() {
  board.style.setProperty("--n", N);
  const clues = puzzle.clues.map((k, i) => {
    const r = (k.cell / N) | 0, c = k.cell % N;
    return `<div class="clue" style="left:${(c / N) * 100}%;top:${(r / N) * 100}%;width:${100 / N}%;height:${100 / N}%;--h:${hue(i)}">
      <div class="glyph ${k.shape}">${k.area !== null ? `<b>${k.area}</b>` : ""}</div></div>`;
  }).join("");
  board.innerHTML = `<div id="cells" style="grid-template-columns:repeat(${N},1fr);grid-template-rows:repeat(${N},1fr)">${"<i></i>".repeat(TOTAL)}</div><div id="patches"></div>
    <div class="box" id="ghost" hidden><div class="fill"></div></div>${clues}`;
  patchLayer = board.querySelector("#patches");
  ghost = board.querySelector("#ghost");
}
function renderPatches(newest = -1) {
  patchLayer.innerHTML = patches.map((p, i) => boxHTML(p.rect, p.clue, i === newest ? "new" : "")).join("");
}

const formatTime = ms => { const s = Math.floor(ms / 1000); return `${String((s / 60) | 0).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
function startTimer() {
  if (timerId || solved) return;
  startedAt = Date.now();
  timerId = setInterval(() => (timerEl.textContent = formatTime(Date.now() - startedAt)), 250);
}
function stopTimer() { clearInterval(timerId); timerId = null; }

function setMessage(text, isError = false) { msg.textContent = text; msg.classList.toggle("err", isError); }

function loadPuzzle(p) {
  if (p !== puzzle) credited = false;
  puzzle = p; patches = []; drag = null; solved = false;
  stopTimer(); timerEl.textContent = "00:00"; setMessage("");
  buildBoard();
}
function removePatchAt(index) {
  patches.splice(index, 1);
  setMessage(""); renderPatches();
}

/* Entrada: coordenadas limitadas à grade, assim arrastar para fora do tabuleiro continua funcionando. */
const cellAt = e => {
  const r = board.getBoundingClientRect();
  const c = Math.min(N - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * N)));
  const row = Math.min(N - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * N)));
  return row * N + c;
};
const rectOf = (a, b) => {
  const [ra, ca, rb, cb] = [(a / N) | 0, a % N, (b / N) | 0, b % N];
  return [Math.min(ra, rb), Math.min(ca, cb), Math.max(ra, rb), Math.max(ca, cb)];
};

function showGhost(snap) {
  const rect = rectOf(drag.start, drag.end), cells = rectCells(...rect);
  const inside = puzzle.clues.map((_, i) => i).filter(i => cells.includes(puzzle.clues[i].cell));
  if (snap) ghost.classList.add("snap");
  ghost.hidden = false;
  ghost.style.cssText = place(rect) + (inside.length === 1 ? `;--h:${hue(inside[0])}` : "");
  ghost.classList.toggle("neutral", inside.length !== 1);
  if (snap) { void ghost.offsetWidth; ghost.classList.remove("snap"); }
}

board.addEventListener("pointerdown", e => {
  if (solved) return;
  const cell = cellAt(e);
  board.setPointerCapture(e.pointerId);
  const hit = patches.findIndex(p => rectCells(...p.rect).includes(cell));
  drag = { start: cell, end: cell, remove: hit >= 0 ? hit : null };
  if (hit < 0) { startTimer(); showGhost(true); }
});
board.addEventListener("pointermove", e => {
  if (!drag || drag.remove !== null) return;
  const cell = cellAt(e);
  if (cell !== drag.end) { drag.end = cell; showGhost(false); }
});
board.addEventListener("pointerup", e => {
  if (!drag) return;
  const d = drag; drag = null; ghost.hidden = true;
  if (d.remove !== null) { if (cellAt(e) === d.start) removePatchAt(d.remove); return; }
  const rect = rectOf(d.start, cellAt(e)), result = validateRect(puzzle, patches, rect);
  if (!result.ok) {
    setMessage(result.reason, true);
    board.classList.remove("shake"); void board.offsetWidth; board.classList.add("shake");
    return;
  }
  patches.push({ rect, clue: result.clue });
  renderPatches(patches.length - 1);
  if (isSolved(patches)) { solved = true; stopTimer(); setMessage(`Resolvido em ${formatTime(Date.now() - startedAt)}!` + creditWin()); }
  else setMessage("");
});
board.addEventListener("pointercancel", () => { drag = null; ghost.hidden = true; });

document.getElementById("undo").onclick = () => { if (!solved && patches.length) removePatchAt(patches.length - 1); };
document.getElementById("reset").onclick = () => loadPuzzle(puzzle);
document.getElementById("next").onclick = () => loadPuzzle(newPuzzle());

/* Fase inicial: sorteada no nível atual do jogador. */
renderLevel();
loadPuzzle(newPuzzle());
