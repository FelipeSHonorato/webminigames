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
import { GEN, LEVELS, MOON, STORE_KEY, SUN, conflicts, generatePuzzle, isSolved } from "./domain.js";
import { fmtTime } from "../../shared/ranking-list.js";
import { nextScenario as nextScenarioOf, nextSpMidnight, renderDailyPanel, spDay } from "../../shared/daily.js";
import { mountTutorial } from "../../shared/tutorial.js";
import { TANGO_TUTORIAL } from "./tutorial.js";

const GAME_ID = "tango";
Music.play(GAME_ID);
const sessionUser = requireSession("../../index.html");   // sem sessão, volta para o login
if (sessionUser && !gameAllowed(GAME_ID, sessionUser)) location.replace("../../jogos.html");   // jogo desligado pelo administrador
mountUserBar(document.getElementById("userbar"), { base: "../../" });
const uid = sessionUser?.id ?? "guest";
const isCloud = Cloud.owns(uid);                          // o desafio diário só existe na nuvem (a seed é do servidor)
const ranking = mountRanking({ gameId: GAME_ID, title: "Tango" });
const mode = isCloud ? "daily" : "random";
mountTutorial({ trigger: "howto", ...TANGO_TUTORIAL });
const coinsEl = document.getElementById("coinBadge");

/* Estado da partida: phase = "playing" · "won" · "locked" (sem coins / esperando o servidor). */
let puzzle = null, grid = [], givenSet = new Set(), cells = [], markEls = [];
let phase = "locked", cursor = 0, credited = false, startedAt = 0, tickId = null, dailyTicket = null;

const boardEl = document.getElementById("board"), msgEl = document.getElementById("msg"), timerEl = document.getElementById("timer");
const phaseEl = document.getElementById("phase"), resetBtn = document.getElementById("reset"), nextBtn = document.getElementById("next");
const levelName = document.getElementById("levelName"), levelCount = document.getElementById("levelCount"), barFill = document.getElementById("barFill");
const dailyEl = document.getElementById("daily");

function setMessage(text, isError = false) { msgEl.textContent = text; msgEl.classList.toggle("err", isError); }

/* Coins: saldo ao lado do nome do jogo e liberação do botão "Nova fase" (só com fase concluída e coin disponível). */
function renderCoins() {
  if (mode === "daily") {
    const d = Cloud.daily(GAME_ID) ?? { coins: 0 };
    coinsEl.replaceChildren(coinBadge({ coins: d.coins ?? 0, max: d.maxCoins ?? 30 * (d.slots ?? Cloud.config()?.coinsPerDay ?? COINS_PER_DAY), nextRefillAt: nextSpMidnight(), daily: true }));
    const left = nextScenario();
    nextBtn.disabled = !(phase === "won" && left != null);
    nextBtn.title = left == null ? "Sem tickets pendentes." : phase === "won" ? "Abrir o próximo cenário." : "Conclua a fase atual para liberar a próxima.";
    return;
  }
  const balance = Coins.get(uid, GAME_ID);
  coinsEl.replaceChildren(coinBadge(balance));
  const canNext = phase === "won" && balance.coins > 0;
  nextBtn.disabled = !canNext;
  nextBtn.title = canNext ? "" : phase !== "won" ? "Conclua a fase atual para liberar a próxima." : `Sem coins por agora: novos em ${fmtDuration(balance.nextRefillAt - Date.now())}.`;
}
let seenDay = spDay();                                     // a virada de Brasília chega com a página aberta
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

/* ----- Progressão: a cada 15 vitórias o nível sobe ----- */
const loadWins = () => Progress.wins(STORE_KEY);
const saveWins = n => Progress.setWins(STORE_KEY, n);      // na nuvem só atualiza a tela: quem soma é Scores.submit
const levelOf = w => Math.min(LEVELS.length - 1, Math.floor(w / WINS_PER_LEVEL));
let wins = loadWins();
const currentLevel = () => LEVELS[levelOf(wins)];
function renderLevel() {
  const i = levelOf(wins), last = i === LEVELS.length - 1, into = wins - i * WINS_PER_LEVEL;
  levelName.textContent = LEVELS[i].name;
  levelCount.textContent = last ? `${wins} vitórias` : `${into}/${WINS_PER_LEVEL}`;
  barFill.style.width = (last ? 100 : (into / WINS_PER_LEVEL) * 100) + "%";
}

/* ----- Fase ----- */
const buildPuzzle = (seed, level) => ({ ...generatePuzzle(makeRng(seed), LEVELS[level]), level, seed });
/** Fase servida pelo servidor: chega SEM a solução (só dados e sinais). */
const serverPuzzle = (view, level) => ({ n: view.n, givens: view.givens, marks: view.marks, level, server: true });
function localFresh() {
  const seed = (Math.random() * 2 ** 32) >>> 0, level = levelOf(wins);
  Run.set(uid, GAME_ID, { seed, level, solved: false, gen: GEN });
  return buildPuzzle(seed, level);
}
const freshPuzzle = () => (Cloud.owns(uid) ? Cloud.open(GAME_ID).then(d => serverPuzzle(d.puzzle, d.level)) : Promise.resolve(localFresh()));
/** Tabuleiro neutro enquanto o servidor não entrega o cenário: não gasta geração. */
const placeholder = () => ({ n: LEVELS[levelOf(wins)].n, givens: [], marks: [], level: levelOf(wins), placeholder: true });

/* ----- Desenho: um SVG com uma casa por célula e os sinais entre elas ----- */
const DEFS = `<defs>
  <symbol id="sun" viewBox="0 0 100 100"><g transform="translate(9 9) scale(0.82)"><circle cx="50" cy="50" r="18"/><path d="M46.5 9h7v16h-7zM46.5 75h7v16h-7zM9 46.5h16v7H9zM75 46.5h16v7H75z"/><path d="M46.5 9h7v16h-7zM46.5 75h7v16h-7zM9 46.5h16v7H9zM75 46.5h16v7H75z" transform="rotate(45 50 50)"/></g></symbol>
  <symbol id="moon" viewBox="0 0 100 100"><path d="M69 26a30 30 0 1 0 0 48 25 25 0 0 1 0-48z"/></symbol>
</defs>`;

function badgeXY(m, n) {
  const a = m.a;
  const r = (a / n) | 0, c = a % n;
  return m.b === a + 1 ? [(c + 1) * 100, r * 100 + 50] : [c * 100 + 50, (r + 1) * 100];
}

function buildBoard() {
  const n = puzzle.n;
  boardEl.setAttribute("viewBox", `0 0 ${n * 100} ${n * 100}`);
  const parts = [DEFS];
  for (let i = 0; i < n * n; i++) {
    const r = (i / n) | 0, c = i % n;
    parts.push(`<g class="cell" data-i="${i}" transform="translate(${c * 100} ${r * 100})">`
      + `<rect x="4" y="4" width="92" height="92" rx="12"/>`
      + `<use class="sun" href="#sun" width="100" height="100"/><use class="moon" href="#moon" width="100" height="100"/></g>`);
  }
  puzzle.marks.forEach((m, k) => {
    const [x, y] = badgeXY(m, n);
    const vertical = m.b === m.a + n;
    const ink = m.same ? `<path class="ink" d="M-8-6H8M-8 6H8"/>` : `<path class="ink" d="M-7-7L7 7M7-7L-7 7"/>`;
    /* O "=" acompanha o eixo do par: na vertical ele fica "‖". */
    const body = m.same && vertical ? `<g transform="rotate(90)">${ink}</g>` : ink;
    parts.push(`<g class="mark" data-k="${k}" transform="translate(${x} ${y})"><rect x="-18" y="-18" width="36" height="36" rx="11"/>${body}</g>`);
  });
  boardEl.innerHTML = parts.join("");
  cells = [...boardEl.querySelectorAll(".cell")];
  markEls = [...boardEl.querySelectorAll(".mark")];
  givenSet = new Set(puzzle.givens.map(g => g.i));
}

const fmtClock = ms => { const s = Math.floor(ms / 1000); return `${String((s / 60) | 0).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
function renderClock() { timerEl.textContent = fmtClock(startedAt ? Date.now() - startedAt : 0); }
function startClock() {
  if (startedAt || phase !== "playing") return;
  startedAt = Date.now();
  if (sessionUser) Activity.played(sessionUser.id, GAME_ID);   // alimenta "último jogo" no perfil
  tickId = setInterval(renderClock, 250);
}
function stopClock() { clearInterval(tickId); tickId = null; }

/** Pinta as casas, os sinais e o painel de estado. */
function paint() {
  const bad = conflicts(puzzle, grid);
  cells.forEach((g, i) => {
    g.classList.toggle("v0", grid[i] === SUN);
    g.classList.toggle("v1", grid[i] === MOON);
    g.classList.toggle("given", givenSet.has(i));
    g.classList.toggle("bad", bad.has(i));
    g.classList.toggle("cur", i === cursor);
  });
  markEls.forEach((g, k) => {
    const m = puzzle.marks[k];
    const broken = grid[m.a] >= 0 && grid[m.b] >= 0 && (grid[m.a] === grid[m.b]) !== m.same;
    g.classList.toggle("bad", broken);
  });
  boardEl.classList.toggle("won", phase === "won");
  boardEl.classList.toggle("locked", phase === "locked");
  const filled = grid.filter(v => v >= 0).length;
  phaseEl.textContent = phase === "won"
    ? "Fase concluída! Metade de cada por linha e coluna, sem triplas."
    : phase === "locked" ? "Aguardando o cenário…"
    : `${filled} de ${puzzle.n * puzzle.n} casas${bad.size ? " · há conflitos" : ""}`;
  resetBtn.disabled = phase === "won" || phase === "locked";
  resetBtn.title = phase === "won" ? "Reiniciar só está disponível enquanto a fase não é concluída." : "";
  renderCoins();
}

/* ----- Jogadas ----- */
function cycle(i) {
  if (phase !== "playing" || givenSet.has(i)) return;
  startClock();
  grid[i] = grid[i] === -1 ? SUN : grid[i] === SUN ? MOON : -1;
  paint();
  checkWin();
}
function clearCell(i) {
  if (phase !== "playing" || givenSet.has(i) || grid[i] < 0) return;
  grid[i] = -1;
  paint();
}
function checkWin() {
  if (phase !== "playing" || !isSolved(puzzle, grid)) return false;
  phase = "won";
  stopClock();
  paint();
  if (mode === "daily") { setMessage("Fase concluída! Registrando…"); finishDaily(); }
  else setMessage("Fase concluída!" + creditWin());
  return true;
}
function creditWin() {
  if (credited) { renderCoins(); return ""; }
  credited = true;
  const before = levelOf(wins), points = pointsFor(puzzle.level);
  wins++; saveWins(wins); renderLevel();
  const cloudMode = Cloud.owns(uid);
  const spent = cloudMode ? false : Coins.spend(uid, GAME_ID);
  if (!cloudMode) Run.set(uid, GAME_ID, { seed: puzzle.seed, level: puzzle.level, solved: true, gen: GEN });
  let note = "";
  if (Scores.canRank()) {
    Scores.submit(GAME_ID, points, { state: { grid: grid.slice() } }).then(() => ranking.refresh());
    note = ` +${points} pontos!`;
  } else note = " Crie uma conta para pontuar no ranking.";
  if (spent) note += " −1 coin.";
  renderCoins();
  const left = Coins.get(uid, GAME_ID);
  if (!left.coins) note += ` Sem coins por agora: novos em ${fmtDuration(left.nextRefillAt - Date.now())}.`;
  return note + (levelOf(wins) > before ? ` Novo nível: ${currentLevel().name}!` : "");
}

/* ----- Entrada ----- */
boardEl.addEventListener("pointerdown", e => {
  if (!puzzle || phase !== "playing") return;
  const r0 = boardEl.getBoundingClientRect(), n = puzzle.n;
  const c = Math.floor(((e.clientX - r0.left) / r0.width) * n);
  const r = Math.floor(((e.clientY - r0.top) / r0.height) * n);
  if (r < 0 || c < 0 || r >= n || c >= n) return;
  cursor = r * n + c;
  boardEl.focus({ preventScroll: true });
  cycle(cursor);
});
document.addEventListener("keydown", e => {
  if (!puzzle) return;
  const t = e.target;
  if (t && typeof t.closest === "function" && t.closest("input, textarea, select, a, button")) return;
  const n = puzzle.n, r = (cursor / n) | 0, c = cursor % n;
  const move = (dr, dc) => {
    cursor = Math.min(n - 1, Math.max(0, r + dr)) * n + Math.min(n - 1, Math.max(0, c + dc));
    paint(); e.preventDefault();
  };
  if (e.key === "ArrowUp") move(-1, 0);
  else if (e.key === "ArrowDown") move(1, 0);
  else if (e.key === "ArrowLeft") move(0, -1);
  else if (e.key === "ArrowRight") move(0, 1);
  else if (e.key === " " || e.key === "Enter") { cycle(cursor); e.preventDefault(); }
  else if (e.key === "Backspace" || e.key === "Delete") { clearCell(cursor); e.preventDefault(); }
});

/* ----- Ciclo de vida ----- */
function loadPuzzle(p) {
  if (p !== puzzle) credited = false;
  stopClock();
  puzzle = p;
  grid = new Array(p.n * p.n).fill(-1);
  for (const g of p.givens) grid[g.i] = g.v;
  cursor = 0; startedAt = 0; phase = "playing";
  buildBoard(); paint(); renderClock();
  setMessage("");
}
/** Reiniciar: volta ao estado inicial (só os dados) e NÃO zera o cronômetro. */
function reset() {
  if (phase !== "playing") return;
  grid = new Array(puzzle.n * puzzle.n).fill(-1);
  for (const g of puzzle.givens) grid[g.i] = g.v;
  paint(); setMessage("");
}
resetBtn.onclick = reset;
nextBtn.onclick = async () => {
  if (mode === "daily") {
    const left = nextScenario();
    if (phase !== "won" || left == null) return;
    return openDaily(left);
  }
  if (phase !== "won" || Coins.get(uid, GAME_ID).coins <= 0) return;
  try { loadPuzzle(await freshPuzzle()); }
  catch (e) { setMessage(e?.code === "no_coins" ? "Sem coins por agora." : "Não foi possível abrir a fase. Tente de novo.", true); }
};
function restoreSolved() {
  credited = true;
  grid = puzzle.solution.slice();
  phase = "won";
  paint(); renderClock();
  setMessage("Fase já concluída. Use “Nova fase” para continuar.");
}
function lockBoard() {
  credited = true; phase = "locked"; paint();
  setMessage(`Sem coins por agora: novos em ${fmtDuration(Coins.get(uid, GAME_ID).nextRefillAt - Date.now())}.`);
}

/* ===================== Desafio diário ===================== */
const nextScenario = () => nextScenarioOf(GAME_ID);
function renderDaily() {
  if (mode !== "daily") return;
  renderDailyPanel({ el: dailyEl, gameId: GAME_ID, info: Cloud.daily(GAME_ID), day: dailyTicket?.day, slot: dailyTicket?.slot, won: phase === "won", onNext: () => nextBtn.click() });
}
async function openDaily(ticket) {
  try {
    const d = await Cloud.dailyOpen(GAME_ID, ticket.day, ticket.slot);
    dailyTicket = { day: d.day, slot: d.slot };
    loadPuzzle(serverPuzzle(d.puzzle, d.level));
    setMessage(`Desafio do dia · ${LEVELS[d.level].name}. Preencha a grade!`);
    renderDaily(); renderCoins();
  } catch (e) {
    setMessage(e?.code === "no_coins" ? "Sem tickets disponíveis: novos à meia-noite (Brasília)." : "Não foi possível abrir o desafio. Tente de novo.", true);
  }
}
function finishDaily() {
  Cloud.dailyFinish(GAME_ID, dailyTicket?.day, dailyTicket?.slot, { grid: grid.slice() })
    .then(r => {
      setMessage(r.ok
        ? `Tempo do cenário: ${fmtTime(r.ok.seconds)}.` + (r.ok.best != null && r.ok.best < r.ok.seconds ? ` Melhor do cenário: ${fmtTime(r.ok.best)}.` : "")
        : "Tempo enviado; será confirmado quando a conexão voltar.");
      wins = loadWins(); renderLevel();
      renderDaily(); renderCoins(); ranking.refresh();
    })
    .catch(() => setMessage("Fase concluída, mas não deu para registrar o tempo. Tente de novo.", true));
}
function dailyPlaceholder() {
  loadPuzzle(placeholder());
  credited = true; phase = "locked"; paint();
  phaseEl.textContent = "Preparando o cenário do dia…";
  renderDaily();
}

/* Fase inicial: na nuvem é o desafio do dia; no modo local, a fase aleatória salva por seed. */
renderLevel();
if (mode === "daily") {
  nextBtn.textContent = "Próximo cenário";
  dailyEl.hidden = false;
  dailyPlaceholder();
  Cloud.dailyStatus().then(() => {
    renderDaily(); renderCoins(); ranking.refresh();
    const ticket = nextScenario();
    if (ticket == null) { credited = true; phase = "locked"; paint(); phaseEl.textContent = "Você já concluiu os cenários disponíveis. Novos tickets à meia-noite (Brasília)."; renderCoins(); }
    else openDaily(ticket);
  });
} else {
  const saved = Run.get(uid, GAME_ID);
  if (saved) {
    loadPuzzle(buildPuzzle(saved.seed, saved.level));
    if (saved.solved) restoreSolved();
    else if (saved.gen !== GEN) Run.set(uid, GAME_ID, { seed: saved.seed, level: saved.level, solved: false, gen: GEN });
  }
  else if (Coins.get(uid, GAME_ID).coins > 0) loadPuzzle(localFresh());
  else { loadPuzzle(placeholder()); lockBoard(); }
}
