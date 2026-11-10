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
import { WINS_PER_LEVEL, Progress, pointsFor } from "../../shared/progress.js";
import { GEN, LEVELS, STORE_KEY, generatePuzzle, isSolved, stateOf, wrongCells } from "./domain.js";
import { fmtTime } from "../../shared/ranking-list.js";
import { nextScenario as nextScenarioOf, nextSpMidnight, renderDailyPanel, spDay } from "../../shared/daily.js";
import { mountTutorial } from "../../shared/tutorial.js";
import { mountLevelHelp } from "../../shared/level-help.js";
import { CROSSMATH_TUTORIAL } from "./tutorial.js";

const GAME_ID = "crossmath";
Music.play(GAME_ID);
const sessionUser = requireSession("../../index.html");   // sem sessão, volta para o login
if (sessionUser && !gameAllowed(GAME_ID, sessionUser)) location.replace("../../jogos.html");   // jogo desligado pelo administrador
mountUserBar(document.getElementById("userbar"), { base: "../../" });
const uid = sessionUser?.id ?? "guest";
const isCloud = Cloud.owns(uid);                          // o desafio diário só existe na nuvem (a seed é do servidor)
const ranking = mountRanking({ gameId: GAME_ID, title: "CrossMath" });
const mode = isCloud ? "daily" : "random";
mountTutorial({ trigger: "howto", ...CROSSMATH_TUTORIAL });
const coinsEl = document.getElementById("coinBadge");

/* Estado da partida: phase = "playing" · "won" · "locked" (sem coins / esperando o servidor). */
let puzzle = null, values = new Map(), usedChips = [], selectedChip = null;
let phase = "locked", cursor = 0, credited = false, startedAt = 0, tickId = null, dailyTicket = null;

const boardEl = document.getElementById("board"), msgEl = document.getElementById("msg"), timerEl = document.getElementById("timer");
const bankEl = document.getElementById("bank");
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
const LEVEL_HELP_DETAILS = LEVELS.map(l => `Grade até ${l.w}×${l.h} · ${l.ops.join(" ")} · até ${l.blanks} buracos`);
mountLevelHelp({ trigger: "levelHelp", getLevel: () => levelOf(wins), details: LEVEL_HELP_DETAILS });

/* ----- Fase ----- */
const buildPuzzle = (seed, level) => ({ ...generatePuzzle(makeRng(seed), LEVELS[level]), level, seed });
/** Fase servida pelo servidor: chega SEM a solução (só a grade, as equações e o banco). */
const serverPuzzle = (view, level) => ({
  w: view.w, h: view.h, max: view.max, cells: view.cells,
  nums: view.nums, eqs: view.eqs, bank: view.bank, level, server: true,
});
function localFresh() {
  const seed = (Math.random() * 2 ** 32) >>> 0, level = levelOf(wins);
  Run.set(uid, GAME_ID, { seed, level, solved: false, gen: GEN });
  return buildPuzzle(seed, level);
}
const freshPuzzle = () => (Cloud.owns(uid) ? Cloud.open(GAME_ID).then(d => serverPuzzle(d.puzzle, d.level)) : Promise.resolve(localFresh()));
/** Tabuleiro neutro enquanto o servidor não entrega o cenário: não gasta geração. */
const placeholder = () => {
  const l = LEVELS[levelOf(wins)];
  return { w: l.w, h: l.h, max: l.max, cells: new Array(l.w * l.h).fill(null), nums: [], eqs: [], bank: [], level: levelOf(wins), placeholder: true };
};

const stateOfBoard = () => stateOf(puzzle, values);
const isGiven = cell => puzzle.cells[cell]?.t === "n" && puzzle.cells[cell].v != null;
const isPlayable = cell => puzzle.cells[cell]?.t === "n" && puzzle.cells[cell].v == null;

/** Pinta o tabuleiro (um SVG com uma casa por posição) e o banco de números. */
function renderBoard(bad) {
  const w = puzzle.w, h = puzzle.h;
  boardEl.setAttribute("viewBox", `0 0 ${w * 100} ${h * 100}`);
  boardEl.style.aspectRatio = `${w} / ${h}`;
  const parts = [];
  for (let i = 0; i < w * h; i++) {
    const r = (i / w) | 0, c = i % w, cell = puzzle.cells[i];
    if (!cell) {
      if (puzzle.placeholder) parts.push(`<rect class="ghost" x="${c * 100 + 7}" y="${r * 100 + 7}" width="86" height="86" rx="14"/>`);
      continue;
    }
    const cls = ["cm-cell", cell.t === "n" ? "num" : cell.t === "o" ? "op" : "eq"];
    if (cell.t === "n") {
      if (cell.v != null) cls.push("given");
      else cls.push("hole");
      if (values.has(i)) cls.push("filled");
    }
    if (bad.has(i)) cls.push("bad");
    if (i === cursor && isPlayable(i)) cls.push("cur");
    const label = cell.t === "n" ? (values.get(i) ?? "") : cell.t === "o" ? cell.v : "=";
    parts.push(`<g class="${cls.join(" ")}" data-i="${i}" transform="translate(${c * 100} ${r * 100})">`
      + `<rect x="7" y="7" width="86" height="86" rx="14"/>`
      + (label === "" ? `<circle class="dot" cx="50" cy="50" r="4"/>` : `<text x="50" y="54">${label}</text>`)
      + `</g>`);
  }
  boardEl.innerHTML = parts.join("");
}

function renderBank() {
  bankEl.replaceChildren(...puzzle.bank.map((v, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (usedChips[i] ? " used" : "") + (selectedChip === i ? " sel" : "");
    b.dataset.chip = String(i);
    b.disabled = usedChips[i];
    b.textContent = String(v);
    b.setAttribute("aria-label", `Número ${v}${usedChips[i] ? " (já usado)" : ""}`);
    return b;
  }));
}

/** Pinta as casas, o banco e o painel de estado. */
function paint() {
  if (!puzzle) return;
  const bad = wrongCells(puzzle, stateOfBoard());
  renderBoard(bad);
  renderBank();
  boardEl.classList.toggle("won", phase === "won");
  boardEl.classList.toggle("locked", phase === "locked" || phase === "placeholder");
  const filled = puzzle.nums.filter(cell => values.has(cell)).length;
  const holes = puzzle.bank.length;
  phaseEl.textContent = phase === "won"
    ? "Fase concluída! Todas as equações fecham com os números do banco."
    : phase === "locked" ? "Aguardando o cenário…"
    : puzzle.placeholder ? "Preparando o cenário…"
    : `${filled} de ${puzzle.nums.length} números na grade${bad.size ? " · há equação que não fecha" : ""}`
      + (holes ? ` · ${holes} no banco` : "");
  resetBtn.disabled = phase === "won" || phase === "locked" || puzzle.placeholder;
  resetBtn.title = phase === "won" ? "Reiniciar só está disponível enquanto a fase não é concluída." : "";
  renderCoins();
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

/* ----- Jogadas ----- */
function freeChipFor(v) {
  for (let i = usedChips.length - 1; i >= 0; i--) if (usedChips[i] && puzzle.bank[i] === v) { usedChips[i] = false; return; }
}

function afterMove() { startClock(); paint(); checkWin(); }

/** Coloca o número do chip escolhido, troca o que já estava ou devolve ao banco. */
function useCell(cell) {
  if (phase !== "playing" || !isPlayable(cell)) return;
  cursor = cell;
  const old = values.get(cell);
  if (selectedChip == null) {
    if (old != null) { values.delete(cell); freeChipFor(old); afterMove(); }
    else paint();
    return;
  }
  if (usedChips[selectedChip]) { selectedChip = null; paint(); return; }
  if (old != null) { values.delete(cell); freeChipFor(old); }
  values.set(cell, puzzle.bank[selectedChip]);
  usedChips[selectedChip] = true;
  selectedChip = null;
  afterMove();
}

function clearCell(cell) {
  if (phase !== "playing" || !isPlayable(cell)) return;
  const old = values.get(cell);
  if (old == null) return;
  values.delete(cell);
  freeChipFor(old);
  afterMove();
}

function chipForValue(v) {
  for (let i = 0; i < puzzle.bank.length; i++) if (!usedChips[i] && puzzle.bank[i] === v) return i;
  return -1;
}

function placeTyped(cell, v) {
  if (!isPlayable(cell)) return false;
  const chip = chipForValue(v);
  if (chip < 0) return false;
  const old = values.get(cell);
  if (old != null) { values.delete(cell); freeChipFor(old); }
  values.set(cell, v);
  usedChips[chip] = true;
  selectedChip = null;
  cursor = cell;
  afterMove();
  return true;
}

function checkWin() {
  if (phase !== "playing" || !isSolved(puzzle, stateOfBoard())) return false;
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
    Scores.submit(GAME_ID, points, { state: stateOfBoard() }).then(() => ranking.refresh());
    note = ` +${points} pontos!`;
  } else note = " Crie uma conta para pontuar no ranking.";
  if (spent) note += " −1 coin.";
  renderCoins();
  const left = Coins.get(uid, GAME_ID);
  if (!left.coins) note += ` Sem coins por agora: novos em ${fmtDuration(left.nextRefillAt - Date.now())}.`;
  return note + (levelOf(wins) > before ? ` Novo nível: ${currentLevel().name}!` : "");
}

/* ----- Entrada ----- */
function moveCursor(dr, dc) {
  if (!puzzle) return;
  const w = puzzle.w, h = puzzle.h;
  let r = (cursor / w) | 0, c = cursor % w;
  for (let step = 0; step < Math.max(w, h); step++) {
    r += dr; c += dc;
    if (r < 0 || c < 0 || r >= h || c >= w) return;
    const cell = r * w + c;
    if (puzzle.cells[cell]?.t === "n") { cursor = cell; paint(); return; }
  }
}

boardEl.addEventListener("pointerdown", e => {
  if (!puzzle || phase !== "playing" || puzzle.placeholder) return;
  const r0 = boardEl.getBoundingClientRect();
  const c = Math.floor(((e.clientX - r0.left) / r0.width) * puzzle.w);
  const r = Math.floor(((e.clientY - r0.top) / r0.height) * puzzle.h);
  if (r < 0 || c < 0 || r >= puzzle.h || c >= puzzle.w) return;
  const cell = r * puzzle.w + c;
  const cc = puzzle.cells[cell];
  if (!cc || cc.t !== "n") return;
  boardEl.focus({ preventScroll: true });
  if (isGiven(cell)) { cursor = cell; paint(); return; }
  useCell(cell);
});

bankEl.addEventListener("click", e => {
  const b = e.target.closest?.("button[data-chip]");
  if (!b || phase !== "playing") return;
  const i = Number(b.dataset.chip);
  if (usedChips[i]) return;
  selectedChip = selectedChip === i ? null : i;
  paint();
});

document.addEventListener("keydown", e => {
  if (!puzzle) return;
  const t = e.target;
  if (t && typeof t.closest === "function" && t.closest("input, textarea, select, a, button")) return;
  if (e.key === "ArrowUp") { moveCursor(-1, 0); e.preventDefault(); }
  else if (e.key === "ArrowDown") { moveCursor(1, 0); e.preventDefault(); }
  else if (e.key === "ArrowLeft") { moveCursor(0, -1); e.preventDefault(); }
  else if (e.key === "ArrowRight") { moveCursor(0, 1); e.preventDefault(); }
  else if (e.key === " " || e.key === "Enter") {
    if (phase === "playing") useCell(cursor);
    e.preventDefault();
  } else if (e.key === "Backspace" || e.key === "Delete") {
    clearCell(cursor);
    e.preventDefault();
  } else if (/^[1-9]$/.test(e.key)) {
    if (phase === "playing") placeTyped(cursor, Number(e.key));
  } else if (e.key === "Escape") {
    selectedChip = null; paint();
  }
});

/* ----- Ciclo de vida ----- */
function loadPuzzle(p) {
  if (p !== puzzle) credited = false;
  stopClock();
  puzzle = p;
  values = new Map();
  for (const cell of p.nums) {
    const c = p.cells[cell];
    if (c?.t === "n" && c.v != null) values.set(cell, c.v);
  }
  usedChips = p.bank.map(() => false);
  selectedChip = null;
  cursor = p.nums.find(cell => p.cells[cell].v == null) ?? p.nums[0] ?? 0;
  startedAt = 0; phase = "playing";
  paint(); renderClock();
  setMessage("");
}
/** Reiniciar: volta ao estado inicial (só os dados) e NÃO zera o cronômetro. */
function reset() {
  if (phase !== "playing" || puzzle.placeholder) return;
  values = new Map();
  for (const cell of puzzle.nums) {
    const c = puzzle.cells[cell];
    if (c?.t === "n" && c.v != null) values.set(cell, c.v);
  }
  usedChips = puzzle.bank.map(() => false);
  selectedChip = null;
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
  values = new Map();
  puzzle.nums.forEach((cell, i) => values.set(cell, puzzle.solution[i]));
  usedChips = puzzle.bank.map(() => true);
  selectedChip = null;
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
  Cloud.dailyFinish(GAME_ID, dailyTicket?.day, dailyTicket?.slot, { nums: stateOfBoard().nums })
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
