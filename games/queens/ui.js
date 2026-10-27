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
import { GEN, LEVELS, STORE_KEY, conflicts, generatePuzzle, isSolved, solutionCells } from "./domain.js";
import { adjacencyOf, assignColors, inkFor, regionShades } from "./colors.js";
import { fmtTime } from "../../shared/ranking-list.js";
import { nextScenario as nextScenarioOf, nextSpMidnight, renderDailyPanel, spDay } from "../../shared/daily.js";
import { mountTutorial } from "../../shared/tutorial.js";
import { QUEENS_TUTORIAL } from "./tutorial.js";

const GAME_ID = "queens";
Music.play(GAME_ID);
const sessionUser = requireSession("../../index.html");   // sem sessão, volta para o login
if (sessionUser && !gameAllowed(GAME_ID, sessionUser)) location.replace("../../jogos.html");   // jogo desligado pelo administrador
mountUserBar(document.getElementById("userbar"), { base: "../../" });
const uid = sessionUser?.id ?? "guest";
const isCloud = Cloud.owns(uid);                          // o desafio diário só existe na nuvem (a seed é do servidor)
const ranking = mountRanking({ gameId: GAME_ID, title: "Queens" });
const mode = isCloud ? "daily" : "random";
mountTutorial({ trigger: "howto", ...QUEENS_TUTORIAL });
const coinsEl = document.getElementById("coinBadge");

/* Estado da partida: phase = "playing" (jogando) · "won" (concluída) · "locked" (sem coins / esperando o servidor). */
let puzzle = null, queens = new Set(), marks = new Set(), cells = [];
let phase = "locked", cursor = 0, credited = false, startedAt = 0, tickId = null, dailyTicket = null;

const boardEl = document.getElementById("board"), msgEl = document.getElementById("msg"), timerEl = document.getElementById("timer");
const phaseEl = document.getElementById("phase"), resetBtn = document.getElementById("reset"), nextBtn = document.getElementById("next");
const levelName = document.getElementById("levelName"), levelCount = document.getElementById("levelCount"), barFill = document.getElementById("barFill");
const dailyEl = document.getElementById("daily");

const el = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };
function setMessage(text, isError = false) { msgEl.textContent = text; msgEl.classList.toggle("err", isError); }

/* Coins: saldo ao lado do nome do jogo e liberação do botão "Nova fase" (só com fase concluída e coin disponível).
   No desafio diário o saldo mostrado é o dos tickets do dia (repostos à meia-noite de Brasília). */
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

/* ----- Progressão: a cada 15 vitórias o nível sobe (salvo no navegador) ----- */
const loadWins = () => Progress.wins(STORE_KEY);
const saveWins = n => Progress.setWins(STORE_KEY, n);      // na nuvem só atualiza a tela: o servidor soma a vitória em Scores.submit
const levelOf = w => Math.min(LEVELS.length - 1, Math.floor(w / WINS_PER_LEVEL));
let wins = loadWins();
const currentLevel = () => LEVELS[levelOf(wins)];
function renderLevel() {
  const i = levelOf(wins), last = i === LEVELS.length - 1, into = wins - i * WINS_PER_LEVEL;
  levelName.textContent = LEVELS[i].name;
  levelCount.textContent = last ? `${wins} vitórias` : `${into}/${WINS_PER_LEVEL}`;
  barFill.style.width = (last ? 100 : (into / WINS_PER_LEVEL) * 100) + "%";
}

/* ----- Fase: geração local (modo aleatório) ou servida pelo servidor (desafio do dia) ----- */
const buildPuzzle = (seed, level) => ({ ...generatePuzzle(makeRng(seed), LEVELS[level]), level, seed });
/** Fase servida pelo servidor: chega SEM a solução (a seed fica no servidor); só o mapa de regiões. */
const serverPuzzle = (view, level) => ({ n: view.n, regions: view.regions, level, server: true });
/** Fase nova no modo local: a seed fica salva, então recarregar a página devolve o mesmo cenário até ele ser concluído. */
function localFresh() {
  const seed = (Math.random() * 2 ** 32) >>> 0, level = levelOf(wins);
  Run.set(uid, GAME_ID, { seed, level, solved: false, gen: GEN });
  return buildPuzzle(seed, level);
}
const freshPuzzle = () => (Cloud.owns(uid) ? Cloud.open(GAME_ID).then(d => serverPuzzle(d.puzzle, d.level)) : Promise.resolve(localFresh()));
/** Tabuleiro neutro (uma cor só) enquanto o servidor não entrega o cenário: não gasta geração. */
const placeholder = () => ({ n: LEVELS[levelOf(wins)].n, regions: new Array(LEVELS[levelOf(wins)].n ** 2).fill(0), level: levelOf(wins), placeholder: true });

/* ----- Desenho do tabuleiro ----- */
let regionAdj = [];

/** Cores das regiões: a paleta do jogo é a mesma nos dois temas. A cor da coroa/X (`--ink`) vem do
    contraste com a cor da casa, porque a paleta mistura tons muito claros e muito escuros. */
function applyRegionColors() {
  if (!puzzle || !cells.length) return;
  const colors = assignColors(puzzle.n, regionAdj);
  cells.forEach((cell, i) => {
    const hex = colors[puzzle.regions[i]], shade = regionShades(hex);
    cell.style.setProperty("--region", shade.base);
    cell.style.setProperty("--region-hi", shade.hi);
    cell.style.setProperty("--region-lo", shade.lo);
    cell.style.setProperty("--ink", inkFor(hex));
  });
}

function buildBoard() {
  const n = puzzle.n;
  boardEl.style.setProperty("--n", n);
  const frag = document.createDocumentFragment();
  cells = [];
  for (let i = 0; i < n * n; i++) {
    const cell = el("div", "cell");
    cell.dataset.i = i;
    cell.setAttribute("role", "gridcell");
    cell.append(el("span", "q"), el("span", "x"));
    cells.push(cell); frag.append(cell);
  }
  boardEl.replaceChildren(frag);
  regionAdj = adjacencyOf(puzzle.regions, n);
  applyRegionColors();
  boardEl.classList.toggle("locked", phase === "locked");
  boardEl.classList.toggle("won", phase === "won");
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

/** Pinta as classes de cada casa e o painel de estado. */
function paint() {
  const bad = conflicts(puzzle, [...queens]);
  cells.forEach((cell, i) => {
    cell.classList.toggle("hasq", queens.has(i));
    cell.classList.toggle("mark", marks.has(i));
    cell.classList.toggle("bad", bad.has(i));
    cell.classList.toggle("cur", i === cursor);
  });
  boardEl.classList.toggle("won", phase === "won");
  boardEl.classList.toggle("locked", phase === "locked");
  const n = puzzle.n;
  phaseEl.textContent = phase === "won"
    ? `Fase concluída! ${n} rainhas, uma por linha, coluna e região.`
    : phase === "locked" ? "Aguardando o cenário…"
    : `${queens.size} de ${n} rainhas${bad.size ? " · há rainhas se atacando" : ""}`;
  resetBtn.disabled = phase === "won" || phase === "locked";
  resetBtn.title = phase === "won" ? "Reiniciar só está disponível enquanto a fase não é concluída." : "";
  renderCoins();
}

/* ----- Colocar, marcar e limpar ----- */
function toggleQueen(i) {
  if (phase !== "playing") return;
  startClock();
  if (queens.has(i)) queens.delete(i);
  else { queens.add(i); marks.delete(i); }
  paint();
  checkWin();
}
function toggleMark(i) {
  if (phase !== "playing") return;
  if (queens.has(i)) { queens.delete(i); paint(); return; }   // X numa casa com rainha tira a rainha
  if (marks.has(i)) marks.delete(i); else marks.add(i);
  paint();
}
function clearCell(i) {
  if (phase !== "playing") return;
  const hadQueen = queens.delete(i), hadMark = marks.delete(i);
  if (hadQueen || hadMark) paint();
}

/** Vitória: uma rainha por linha, coluna e região, sem nenhuma tocando outra. */
function checkWin() {
  if (phase !== "playing") return false;
  if (!isSolved(puzzle, [...queens])) return false;
  phase = "won";
  stopClock();
  paint();
  const state = [...queens].sort((a, b) => a - b);
  if (mode === "daily") { setMessage("Fase concluída! Registrando…"); finishDaily(state); }
  else setMessage("Fase concluída!" + creditWin());
  return true;
}

/** Conta a vitória uma única vez por fase. Os pontos são os do nível em que a fase foi gerada. */
function creditWin() {
  if (credited) { renderCoins(); return ""; }               // rejogar a mesma fase não pontua nem gasta coin
  credited = true;
  const before = levelOf(wins), points = pointsFor(puzzle.level);
  wins++; saveWins(wins); renderLevel();
  const cloudMode = Cloud.owns(uid);
  const spent = cloudMode ? false : Coins.spend(uid, GAME_ID);   // na nuvem o coin já foi cobrado ao SERVIR a fase
  if (!cloudMode) Run.set(uid, GAME_ID, { seed: puzzle.seed, level: puzzle.level, solved: true, gen: GEN });
  let note = "";
  if (Scores.canRank()) {
    // Na nuvem o servidor regenera a partir da seed e só pontua se as rainhas estiverem certas.
    Scores.submit(GAME_ID, points, { state: { queens: [...queens].sort((a, b) => a - b) } }).then(() => ranking.refresh());
    note = ` +${points} pontos!`;
  } else note = " Crie uma conta para pontuar no ranking.";
  if (spent) note += " −1 coin.";
  renderCoins();
  const left = Coins.get(uid, GAME_ID);
  if (!left.coins) note += ` Sem coins por agora: novos em ${fmtDuration(left.nextRefillAt - Date.now())}.`;
  return note + (levelOf(wins) > before ? ` Novo nível: ${currentLevel().name}!` : "");
}

/* ----- Entrada: toque/clique na casa; botão direito (ou Shift + clique) marca X; teclado com setas ----- */
boardEl.addEventListener("pointerdown", e => {
  if (e.pointerType === "mouse" && e.button > 2) return;
  const cell = e.target.closest(".cell");
  if (!cell) return;
  const i = Number(cell.dataset.i);
  cursor = i;
  boardEl.focus({ preventScroll: true });
  if (e.pointerType === "mouse" && (e.button === 2 || e.shiftKey)) { toggleMark(i); return; }
  toggleQueen(i);
});
boardEl.addEventListener("contextmenu", e => e.preventDefault());

document.addEventListener("keydown", e => {
  if (!puzzle) return;
  const t = e.target;
  if (t && typeof t.closest === "function" && t.closest("input, textarea, select, a, button")) return;
  const n = puzzle.n, r = (cursor / n) | 0, c = cursor % n;
  const move = (dr, dc) => {
    const rr = Math.min(n - 1, Math.max(0, r + dr)), cc = Math.min(n - 1, Math.max(0, c + dc));
    cursor = rr * n + cc; paint(); e.preventDefault();
  };
  if (e.key === "ArrowUp") move(-1, 0);
  else if (e.key === "ArrowDown") move(1, 0);
  else if (e.key === "ArrowLeft") move(0, -1);
  else if (e.key === "ArrowRight") move(0, 1);
  else if (e.key === " " || e.key === "Enter") { toggleQueen(cursor); e.preventDefault(); }
  else if (e.key === "x" || e.key === "X") { toggleMark(cursor); e.preventDefault(); }
  else if (e.key === "Backspace" || e.key === "Delete") { clearCell(cursor); e.preventDefault(); }
});

/* ----- Ciclo de vida da fase ----- */
function loadPuzzle(p) {
  if (p !== puzzle) credited = false;
  stopClock();
  puzzle = p;
  queens = new Set(); marks = new Set();
  cursor = 0; startedAt = 0;
  phase = "playing";
  buildBoard(); paint(); renderClock();
  setMessage("");
}
/** Reiniciar: limpa o tabuleiro e NÃO zera o cronômetro (o tempo segue de onde estava). */
function reset() {
  if (phase !== "playing") return;
  queens.clear(); marks.clear();
  paint(); setMessage("");
}
resetBtn.onclick = reset;
nextBtn.onclick = async () => {
  if (mode === "daily") {                                   // desafio do dia: avança para o próximo cenário (sem escolher)
    const left = nextScenario();
    if (phase !== "won" || left == null) return;
    return openDaily(left);
  }
  if (phase !== "won" || Coins.get(uid, GAME_ID).coins <= 0) return;
  try { loadPuzzle(await freshPuzzle()); }
  catch (e) { setMessage(e?.code === "no_coins" ? "Sem coins por agora." : "Não foi possível abrir a fase. Tente de novo.", true); }
};

/** Fase já concluída (ao recarregar a página): mostra as rainhas certas e não pontua de novo. */
function restoreSolved() {
  credited = true;
  queens = new Set(solutionCells(puzzle));
  phase = "won";
  paint(); renderClock();
  setMessage("Fase já concluída. Use “Nova fase” para continuar.");
}
/** Sem coins e sem fase salva: o cenário aparece, mas travado até a recarga. */
function lockBoard() {
  credited = true; phase = "locked"; paint();
  setMessage(`Sem coins por agora: novos em ${fmtDuration(Coins.get(uid, GAME_ID).nextRefillAt - Date.now())}.`);
}

/* ===================== Desafio diário =====================
   Mesmo cenário do dia para todos (por nível). Só na nuvem: a seed é derivada no servidor; o tempo fica nos troféus. */
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
    setMessage(`Desafio do dia · ${LEVELS[d.level].name}. Coloque ${LEVELS[d.level].n} rainhas!`);
    renderDaily(); renderCoins();
  } catch (e) {
    setMessage(e?.code === "no_coins" ? "Sem tickets disponíveis: novos à meia-noite (Brasília)." : "Não foi possível abrir o desafio. Tente de novo.", true);
  }
}
/** Conclui o tabuleiro do dia: o SERVIDOR mede o tempo, valida e guarda o melhor por slot. */
function finishDaily(state) {
  Cloud.dailyFinish(GAME_ID, dailyTicket?.day, dailyTicket?.slot, { queens: state })
    .then(r => {
      setMessage(r.ok
        ? `Tempo do cenário: ${fmtTime(r.ok.seconds)}.` + (r.ok.best != null && r.ok.best < r.ok.seconds ? ` Melhor do cenário: ${fmtTime(r.ok.best)}.` : "")
        : "Tempo enviado; será confirmado quando a conexão voltar.");
      wins = loadWins(); renderLevel();                    // concluir o cenário do dia também sobe a progressão (pontos)
      renderDaily(); renderCoins(); ranking.refresh();
    })
    .catch(() => setMessage("Fase concluída, mas não deu para registrar o tempo. Tente de novo.", true));
}
/** Cenário neutro enquanto o desafio do dia é servido pelo servidor (travado e sem contar o tempo). */
function dailyPlaceholder() {
  loadPuzzle(placeholder());
  credited = true; phase = "locked"; paint();
  phaseEl.textContent = "Preparando o cenário do dia…";
  renderDaily();
}

/* Fase inicial. Na nuvem é o desafio do dia (o servidor serve o próximo cenário sozinho). No modo local, a fase
   aleatória de sempre: a seed fica salva e recarregar devolve o mesmo cenário. */
renderLevel();
if (mode === "daily") {
  nextBtn.textContent = "Próximo cenário";                 // não há escolha: o jogo avança para o próximo
  dailyEl.hidden = false;
  dailyPlaceholder();
  Cloud.dailyStatus().then(() => {
    renderDaily(); renderCoins(); ranking.refresh();
    const ticket = nextScenario();
    if (ticket == null) { credited = true; phase = "locked"; paint(); phaseEl.textContent = "Você já concluiu os cenários disponíveis. Novos tickets à meia-noite (Brasília)."; renderCoins(); }
    else openDaily(ticket);                                // abre sozinho o próximo ticket (mais antigo primeiro)
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
