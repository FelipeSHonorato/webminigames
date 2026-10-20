import "../../shared/backend/boot.js";
import { Scores } from "../../shared/scores.js";
import { mountRanking } from "../../shared/ranking-panel.js";
import { Activity } from "../../shared/profile.js";
import { Coins, COINS_PER_DAY } from "../../shared/coins.js";
import { Cloud } from "../../shared/backend/cloud.js";
import { gameAllowed } from "../../shared/game-switch.js";
import { Run } from "../../shared/run.js";
import { coinBadge, fmtDuration } from "../../shared/coin-badge.js";
import { mountUserBar } from "../../js/userbar.js";
import { Music } from "../../shared/music.js";
import { requireSession } from "../../shared/session.js";
import { makeRng } from "../../shared/rng.js";
import { WINS_PER_LEVEL, Progress, pointsFor, pointsLegend } from "../../shared/progress.js";
import {
  LEVELS, PEERS, SIZE, STORE_KEY, TOTAL, colOf, conflicts, digitCounts, generatePuzzle, isSolved, newState, noteDigits, rowOf,
  setDigit, toggleNote,
} from "./domain.js";
import { fmtTime } from "../../shared/ranking-list.js";
import { nextScenario as nextScenarioOf, renderDailyPanel } from "../../shared/daily.js";

const GAME_ID = "sudoku";
Music.play(GAME_ID);
const sessionUser = requireSession("../../index.html");   // sem sessão, volta para o login
if (sessionUser && !gameAllowed(GAME_ID, sessionUser)) location.replace("../../jogos.html");   // jogo desligado pelo administrador
mountUserBar(document.getElementById("userbar"), { base: "../../" });
const uid = sessionUser?.id ?? "guest";
const isCloud = Cloud.owns(uid);                          // o desafio diário só existe na nuvem (a seed é do servidor)
const ranking = mountRanking({ gameId: GAME_ID, title: "Sudoku", modes: isCloud ? ["daily", "points"] : ["points"] });
const coinsEl = document.getElementById("coinBadge");
/* Na nuvem o jogo é SÓ o desafio do dia (a fase aleatória deixou de existir); no modo local/visitante continua aleatória. */
const mode = isCloud ? "daily" : "random";

/* Estado da partida (declarado antes de qualquer função que o use). */
let puzzle, state, history = [], selected = null, notesMode = false, solved = false, credited = false, startedAt = 0, timerId = null;

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
const padButtons = [...document.querySelectorAll("#pad button")];
const notesBtn = document.getElementById("notes");

/* ----- Progressão: a cada 15 vitórias o nível sobe (salvo no navegador) ----- */
const levelName = document.getElementById("levelName"), levelCount = document.getElementById("levelCount"), barFill = document.getElementById("barFill");
const loadWins = () => Progress.wins(STORE_KEY);   // nuvem: cache do Supabase; anônimo: navegador
const saveWins = n => Progress.setWins(STORE_KEY, n);   // na nuvem só atualiza a tela: o servidor soma a vitória em Scores.submit
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
  const cloudMode = Cloud.owns(uid);
  const before = levelOf(wins), points = pointsFor(puzzle.level ?? before);   // pontos do nível em que a fase foi gerada
  wins++; saveWins(wins); renderLevel();
  const spent = cloudMode ? false : Coins.spend(uid, GAME_ID);                // na nuvem o coin já foi cobrado ao SERVIR a fase (open)
  if (!cloudMode) Run.set(uid, GAME_ID, { seed: puzzle.seed, level: puzzle.level, solved: true });
  let note = "";
  if (Scores.canRank()) {
    // Na nuvem o servidor recebe o tabuleiro, regenera a partir da seed e só pontua se for solução de verdade.
    Scores.submit(GAME_ID, points, { state: { grid: state.grid } }).then(() => ranking.refresh());
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
/** Fase servida pelo servidor: chega SEM a solução (a seed fica no servidor), então a tela não sabe a resposta. */
const serverPuzzle = (view, level) => ({ cells: view.cells, givens: view.givens, level, server: true });
/** Fase nova no modo local: a seed fica salva, então recarregar a página devolve a mesma fase até ela ser concluída. */
function localFresh() {
  const seed = (Math.random() * 2 ** 32) >>> 0, level = levelOf(wins);
  Run.set(uid, GAME_ID, { seed, level, solved: false });
  return buildPuzzle(seed, level);
}
/** Fase nova: na nuvem quem serve é o servidor (open cobra o coin e guarda a seed); local sorteia. */
const freshPuzzle = () => (Cloud.owns(uid) ? Cloud.open(GAME_ID).then(d => serverPuzzle(d.puzzle, d.level)) : Promise.resolve(localFresh()));

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
function startTimer(at = Date.now()) {
  if (timerId || solved) return;
  startedAt = at;                                            // no desafio do dia, o relógio começa quando o servidor abriu a fase
  if (sessionUser) Activity.played(sessionUser.id, GAME_ID);   // alimenta "último jogo" no perfil
  timerId = setInterval(() => (timerEl.textContent = formatTime(Date.now() - startedAt)), 250);
}
function stopTimer() { clearInterval(timerId); timerId = null; }
function setMessage(text, isError = false) { msg.textContent = text; msg.classList.toggle("err", isError); }

/** keepTimer: o Reiniciar limpa o tabuleiro, mas o cronômetro segue de onde está (e só começa no primeiro movimento, como sempre). */
function loadPuzzle(p, { keepTimer = false } = {}) {
  if (p !== puzzle) credited = false;
  puzzle = p; state = newState(p); history = []; selected = null; solved = false;
  if (!keepTimer) { stopTimer(); timerEl.textContent = "00:00"; }
  setMessage("");
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
    if (mode === "daily") finishDaily();               // desafio do dia: o SERVIDOR mede o tempo e pontua/progride
    else setMessage(`Resolvido em ${formatTime(Date.now() - startedAt)}!` + creditWin());
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
    setMessage(`Desafio do dia · ${LEVELS[d.level].name}. Faça o menor tempo!`);
    renderDaily(); renderCoins();
  } catch (e) {
    setMessage(e?.code === "no_coins" ? "Sem tickets disponíveis: novos à meia-noite (Brasília)." : "Não foi possível abrir o desafio. Tente de novo.", true);
  }
}

/** Conclui o tabuleiro do dia: o SERVIDOR mede o tempo (relógio de parede, +30 s por dica) e guarda o melhor por slot. */
function finishDaily() {
  const localMs = Date.now() - startedAt;
  setMessage(`Resolvido em ${formatTime(localMs)}! Registrando…`);
  Cloud.dailyFinish(GAME_ID, dailyTicket?.day, dailyTicket?.slot, { grid: state.grid })
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
  render();
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
  if (saved) { loadPuzzle(buildPuzzle(saved.seed, saved.level)); if (saved.solved) restoreSolved(); }
  else if (Coins.get(uid, GAME_ID).coins > 0) loadPuzzle(localFresh());
  else { loadPuzzle(lockedPuzzle()); lockBoard(); }
}
