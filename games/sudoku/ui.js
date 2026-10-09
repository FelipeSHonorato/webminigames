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
import {
  LEVELS, PEERS, SIZE, STORE_KEY, TOTAL, colOf, conflicts, digitCounts, generatePuzzle, isSolved, newState, noteDigits, rowOf,
  setDigit, toggleNote,
} from "./domain.js";

const GAME_ID = "sudoku";
const sessionUser = requireSession("../../index.html");   // sem sessão, volta para o login
if (sessionUser && !gameAllowed(GAME_ID, sessionUser)) location.replace("../../jogos.html");   // jogo desligado pelo administrador
mountUserBar(document.getElementById("userbar"), { base: "../../" });
const ranking = mountRanking({ gameId: GAME_ID, title: "Sudoku" });
const uid = sessionUser?.id ?? "guest";
const coinsEl = document.getElementById("coinBadge");

/* Estado da partida (declarado antes de qualquer função que o use). */
let puzzle, state, history = [], selected = null, notesMode = false, solved = false, credited = false, startedAt = 0, timerId = null;

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
const board = document.getElementById("board");
const msg = document.getElementById("msg");
const timerEl = document.getElementById("timer");
const padButtons = [...document.querySelectorAll("#pad button")];
const notesBtn = document.getElementById("notes");

/* ----- Progressão: a cada 15 vitórias o nível sobe (salvo no navegador) ----- */
const levelName = document.getElementById("levelName"), levelCount = document.getElementById("levelCount"), barFill = document.getElementById("barFill");
function loadWins() { try { return Math.max(0, parseInt(localStorage.getItem(winsKey(STORE_KEY)), 10) || 0); } catch { return 0; } }
function saveWins(n) { try { localStorage.setItem(winsKey(STORE_KEY), String(n)); } catch { /* sem armazenamento: segue sem salvar */ } }
const levelOf = w => Math.min(LEVELS.length - 1, Math.floor(w / WINS_PER_LEVEL));
let wins = loadWins();
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

/* ----- Desenho do tabuleiro -----
   As 81 células são criadas uma vez por fase e só mudam de classe e conteúdo: se o clique recriasse o elemento tocado,
   o navegador perderia o foco do tabuleiro e o teclado pararia de funcionar. */
let cellEls = [], shown = [];
function buildBoard() {
  cellEls = Array.from({ length: TOTAL }, (_, i) => { const el = document.createElement("div"); el.dataset.i = i; return el; });
  shown = new Array(TOTAL).fill(null);
  board.replaceChildren(...cellEls);
}
function cellView(i, bad, selVal) {
  const v = state.grid[i], cls = ["cell", `r${rowOf(i)}`, `c${colOf(i)}`];
  if (puzzle.cells[i]) cls.push("given"); else if (v) cls.push("user");
  if (selected !== null) {
    if (i === selected) cls.push("sel");
    else if (v && v === selVal) cls.push("same");
    else if (PEERS[selected].includes(i)) cls.push("peer");
  }
  if (bad.has(i)) cls.push("bad");
  let inner = v ? String(v) : "";
  if (!v && state.notes[i]) {
    const on = noteDigits(state.notes[i]);
    inner = `<div class="notes n${on.length}">${on.map(d => `<span${d === selVal ? ' class="hit"' : ""}>${d}</span>`).join("")}</div>`;   // centralizadas na célula; nN = quantas anotações (a fonte encolhe)
  }
  return { cls: cls.join(" "), inner };
}
function render() {
  const bad = conflicts(state.grid), selVal = selected === null ? 0 : state.grid[selected];
  for (let i = 0; i < TOTAL; i++) {
    const { cls, inner } = cellView(i, bad, selVal), el = cellEls[i];
    if (el.className !== cls) el.className = cls;
    if (shown[i] !== inner) { el.innerHTML = inner; shown[i] = inner; }
  }
  board.classList.toggle("locked", solved);
  const counts = digitCounts(state.grid);
  padButtons.forEach(b => b.classList.toggle("done", counts[+b.dataset.d] >= SIZE));   // dígito que já aparece 9 vezes
  notesBtn.setAttribute("aria-pressed", String(notesMode));
  document.getElementById("undo").disabled = solved || !history.length;
}

const formatTime = ms => { const s = Math.floor(ms / 1000); return `${String((s / 60) | 0).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
function startTimer() {
  if (timerId || solved) return;
  startedAt = Date.now();
  if (sessionUser) Activity.played(sessionUser.id, GAME_ID);   // alimenta "último jogo" no perfil
  timerId = setInterval(() => (timerEl.textContent = formatTime(Date.now() - startedAt)), 250);
}
function stopTimer() { clearInterval(timerId); timerId = null; }
function setMessage(text, isError = false) { msg.textContent = text; msg.classList.toggle("err", isError); }

function loadPuzzle(p) {
  if (p !== puzzle) credited = false;
  puzzle = p; state = newState(p); history = []; selected = null; solved = false;
  stopTimer(); timerEl.textContent = "00:00"; setMessage("");
  buildBoard(); render();
  renderCoins();
}

/* ----- Jogadas ----- */
function select(i, start = true) {
  if (solved) return;
  selected = i;
  if (start) startTimer();
  render();
}
function commit(next) {
  if (next === state) return;
  history.push(state); state = next; setMessage("");
  render();
  if (isSolved(state.grid)) {
    solved = true; stopTimer(); selected = null; render();
    setMessage(`Resolvido em ${formatTime(Date.now() - startedAt)}!` + creditWin());
  }
}
/** d de 1 a 9: põe o número (ou a anotação, no modo anotações); d = 0 apaga. */
function applyDigit(d) {
  if (solved) return;
  if (selected === null) { setMessage("Toque em uma célula primeiro.", true); return; }
  if (puzzle.cells[selected]) { setMessage("Essa célula é uma pista e não pode mudar.", true); return; }
  if (d && notesMode && state.grid[selected]) { setMessage("Apague o número da célula para fazer anotações.", true); return; }
  startTimer();
  commit(d === 0 ? setDigit(puzzle, state, selected, 0) : notesMode ? toggleNote(puzzle, state, selected, d) : setDigit(puzzle, state, selected, d));
}
function undo() {
  if (solved || !history.length) return;
  state = history.pop(); setMessage("");
  render();
}
function toggleNotesMode() { notesMode = !notesMode; render(); }

/* ----- Entrada: toque/mouse nas células, números na tela e teclado ----- */
board.addEventListener("pointerdown", e => {
  const el = e.target.closest(".cell");
  if (!el) return;
  select(+el.dataset.i);
});
const firstFree = () => { const i = state.grid.findIndex((v, k) => !v && !puzzle.cells[k]); return i >= 0 ? i : 0; };
board.addEventListener("focus", () => {                 // ao focar pelo teclado sem seleção, começa na primeira célula livre
  if (selected === null && !solved) select(firstFree(), false);   // só focar não inicia o cronômetro
});
const STEP = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
/* O teclado vale em toda a área do jogo (não só com o tabuleiro focado): depois de tocar num botão, o foco fica nele
   e os atalhos precisam continuar funcionando. Campos de texto e o resto da página (ranking, barra) ficam de fora. */
document.addEventListener("keydown", e => {
  if (e.target !== document.body && !e.target.closest("main")) return;
  if (e.ctrlKey || e.metaKey || e.altKey) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { undo(); e.preventDefault(); }
    return;
  }
  if (e.key in STEP) {
    if (solved) return;
    if (selected === null) select(firstFree(), false);
    else {
      const [dr, dc] = STEP[e.key];
      const r = Math.min(SIZE - 1, Math.max(0, rowOf(selected) + dr)), c = Math.min(SIZE - 1, Math.max(0, colOf(selected) + dc));
      select(r * SIZE + c, false);
    }
  } else if (/^[1-9]$/.test(e.key)) applyDigit(+e.key);
  else if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") applyDigit(0);
  else if (e.key.toLowerCase() === "n") toggleNotesMode();
  else return;
  e.preventDefault();
});
padButtons.forEach(b => b.addEventListener("click", () => applyDigit(+b.dataset.d)));

document.getElementById("undo").onclick = undo;
document.getElementById("erase").onclick = () => applyDigit(0);
notesBtn.onclick = toggleNotesMode;
document.getElementById("reset").onclick = () => loadPuzzle(puzzle);
document.getElementById("next").onclick = () => { if (solved && Coins.get(uid, GAME_ID).coins > 0) loadPuzzle(freshPuzzle()); };

/** Fase já concluída (ao recarregar a página): mostra a solução, trava o tabuleiro e não pontua de novo. */
function restoreSolved() {
  credited = true; solved = true;
  state = { grid: [...puzzle.solution], notes: new Array(TOTAL).fill(0) };
  render();
  setMessage("Fase já concluída. Use “Nova fase” para continuar.");
  renderCoins();
}
/** Sem coins e sem fase salva: tabuleiro travado até a recarga. */
function lockBoard() {
  credited = true; solved = true;
  render();
  setMessage(`Sem coins por agora: novos em ${fmtDuration(Coins.get(uid, GAME_ID).nextRefillAt - Date.now())}.`);
  renderCoins();
}

/* Fase inicial: volta a fase salva (mesma seed); sem fase salva, sorteia uma no nível atual se houver coin. */
renderLevel();
const saved = Run.get(uid, GAME_ID);
if (saved) { loadPuzzle(buildPuzzle(saved.seed, saved.level)); if (saved.solved) restoreSolved(); }
else if (Coins.get(uid, GAME_ID).coins > 0) loadPuzzle(freshPuzzle());
else { loadPuzzle(buildPuzzle((Math.random() * 2 ** 32) >>> 0, levelOf(wins))); lockBoard(); }
