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
import { GEN, LEVELS, MIN_WORD, STORE_KEY, displayOf, generatePuzzle, isValidWord, wordsFrom } from "./domain.js";
import { fmtTime } from "../../shared/ranking-list.js";
import { nextScenario as nextScenarioOf, nextSpMidnight, renderDailyPanel, spDay } from "../../shared/daily.js";
import { mountTutorial } from "../../shared/tutorial.js";
import { mountLevelHelp } from "../../shared/level-help.js";
import { TEXTTWIST_TUTORIAL } from "./tutorial.js";

const GAME_ID = "texttwist";
Music.play(GAME_ID);
const sessionUser = requireSession("../../index.html");   // sem sessão, volta para o login
if (sessionUser && !gameAllowed(GAME_ID, sessionUser)) location.replace("../../jogos.html");   // jogo desligado pelo administrador
mountUserBar(document.getElementById("userbar"), { base: "../../" });
const uid = sessionUser?.id ?? "guest";
const isCloud = Cloud.owns(uid);                          // o desafio diário só existe na nuvem
const ranking = mountRanking({ gameId: GAME_ID, title: "Text Twist" });
const mode = isCloud ? "daily" : "random";
const coinsEl = document.getElementById("coinBadge");

/* Estado da rodada: phase = "playing" · "won" · "lost" (tempo acabou) · "locked" (sem coins / servidor). */
let puzzle = null, order = [], typed = [], found = new Set();
let phase = "locked", deadline = 0, tickId = null, credited = false, dailyTicket = null, roundDone = false;

const lettersEl = document.getElementById("letters"), typedEl = document.getElementById("typed"), msgEl = document.getElementById("msg");
const timerEl = document.getElementById("timer"), timeFill = document.getElementById("timeFill"), timeBar = document.getElementById("timeBar");
const phaseEl = document.getElementById("phase"), foundEl = document.getElementById("found");
const resetBtn = document.getElementById("retry"), nextBtn = document.getElementById("next"), submitBtn = document.getElementById("submit");
const levelName = document.getElementById("levelName"), levelCount = document.getElementById("levelCount"), barFill = document.getElementById("barFill");
const dailyEl = document.getElementById("daily");
mountTutorial({ trigger: "howto", ...TEXTTWIST_TUTORIAL });

function setMessage(text, isError = false) { msgEl.textContent = text; msgEl.classList.toggle("err", isError); }
const countOf = (list, ch) => list.reduce((n, c) => n + (c === ch ? 1 : 0), 0);

/* Coins: saldo ao lado do nome do jogo e liberação do botão "Nova fase" (só com rodada concluída e coin). */
function renderCoins() {
  if (mode === "daily") {
    const d = Cloud.daily(GAME_ID) ?? { coins: 0 };
    coinsEl.replaceChildren(coinBadge({ coins: d.coins ?? 0, max: d.maxCoins ?? 30 * (d.slots ?? Cloud.config()?.coinsPerDay ?? COINS_PER_DAY), nextRefillAt: nextSpMidnight(), daily: true }));
    const left = nextScenario();
    nextBtn.disabled = !(phase === "won" && left != null);
    nextBtn.title = left == null ? "Sem tickets pendentes." : phase === "won" ? "Abrir o próximo cenário." : "Conclua a rodada para liberar a próxima.";
    return;
  }
  const balance = Coins.get(uid, GAME_ID);
  coinsEl.replaceChildren(coinBadge(balance));
  const canNext = phase === "won" && balance.coins > 0;
  nextBtn.disabled = !canNext;
  nextBtn.title = canNext ? "" : phase !== "won" ? "Conclua a rodada para liberar a próxima." : `Sem coins por agora: novos em ${fmtDuration(balance.nextRefillAt - Date.now())}.`;
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

/* ----- Progressão ----- */
const loadWins = () => Progress.wins(STORE_KEY);
const saveWins = n => Progress.setWins(STORE_KEY, n);
const levelOf = w => Math.min(LEVELS.length - 1, Math.floor(w / WINS_PER_LEVEL));
let wins = loadWins();
const currentLevel = () => LEVELS[levelOf(wins)];
function renderLevel() {
  const i = levelOf(wins), last = i === LEVELS.length - 1, into = wins - i * WINS_PER_LEVEL;
  levelName.textContent = LEVELS[i].name;
  levelCount.textContent = last ? `${wins} vitórias` : `${into}/${WINS_PER_LEVEL}`;
  barFill.style.width = (last ? 100 : (into / WINS_PER_LEVEL) * 100) + "%";
}
const LEVEL_HELP_DETAILS = LEVELS.map(l => `${l.n} letras · ${fmtTime(l.seconds)} · ${l.minWords}+ palavras`);
mountLevelHelp({ trigger: "levelHelp", getLevel: () => levelOf(wins), details: LEVEL_HELP_DETAILS });

/* ----- Fase ----- */
const buildPuzzle = (seed, level) => ({ ...generatePuzzle(makeRng(seed), LEVELS[level]), level, seed });
/** Fase servida pelo servidor: chega só com as letras (o dicionário é público). */
const serverPuzzle = (view, level) => ({ n: view.n, letters: view.letters, words: wordsFrom(view.letters), level, server: true });
function localFresh() {
  const seed = (Math.random() * 2 ** 32) >>> 0, level = levelOf(wins);
  Run.set(uid, GAME_ID, { seed, level, solved: false, gen: GEN });
  return buildPuzzle(seed, level);
}
const freshPuzzle = () => (Cloud.owns(uid) ? Cloud.open(GAME_ID).then(d => serverPuzzle(d.puzzle, d.level)) : Promise.resolve(localFresh()));
const placeholder = () => ({ n: LEVELS[levelOf(wins)].n, letters: [..."ABCDEFGHI"].slice(0, LEVELS[levelOf(wins)].n), words: [], level: levelOf(wins), placeholder: true });

/* ----- Desenho ----- */
const fmtClock = ms => { const s = Math.ceil(ms / 1000); return `${String((s / 60) | 0).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
const totalMs = () => (LEVELS[puzzle.level]?.seconds ?? 120) * 1000;
function renderClock(left = totalMs()) {
  timerEl.textContent = fmtClock(left);
  const low = phase === "playing" && left <= 15000;
  timerEl.classList.toggle("low", low);
  timeBar.classList.toggle("low", low);
  timeFill.style.width = `${Math.max(0, Math.min(1, left / totalMs())) * 100}%`;
}
function renderLetters() {
  lettersEl.replaceChildren(...order.map((i, k) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tile";
    b.textContent = puzzle.letters[i];
    b.dataset.k = k;
    b.disabled = phase !== "playing" || countOf(typed, puzzle.letters[i]) >= countOf(puzzle.letters, puzzle.letters[i]);
    b.onclick = () => append(puzzle.letters[i]);
    return b;
  }));
}
function renderTyped() {
  const n = puzzle.n;
  const slots = [];
  for (let i = 0; i < n; i++) {
    const s = document.createElement("span");
    s.className = "slot" + (i < typed.length ? " on" : "");
    s.textContent = typed[i] ?? "";
    slots.push(s);
  }
  typedEl.replaceChildren(...slots);
}
function renderFound() {
  const groups = new Map();
  for (const w of puzzle.words) {
    if (!groups.has(w.length)) groups.set(w.length, []);
    groups.get(w.length).push(w);
  }
  const parts = [];
  for (const len of [...groups.keys()].sort((a, b) => a - b)) {
    const list = groups.get(len).sort((a, b) => displayOf(a).localeCompare(displayOf(b)));
    const box = document.createElement("section");
    const h = document.createElement("h3");
    h.textContent = `${len} letras · ${list.filter(w => found.has(w)).length}/${list.length}`;
    const chips = document.createElement("div");
    chips.className = "chips";
    for (const w of list) {
      const c = document.createElement("span");
      c.className = "chip" + (found.has(w) ? " ok" : "");
      c.textContent = found.has(w) ? displayOf(w) : "•••";
      chips.append(c);
    }
    box.append(h, chips);
    parts.push(box);
  }
  foundEl.replaceChildren(...parts);
}
function paint() {
  renderLetters(); renderTyped(); renderFound();
  const keyLen = puzzle.n;
  phaseEl.textContent = phase === "won" ? "Rodada concluída! Você achou a palavra de todas as letras."
    : phase === "lost" ? "O tempo acabou. Tente de novo com as mesmas letras."
    : phase === "locked" ? "Aguardando a rodada…"
    : `${found.size} de ${puzzle.words.length} palavras · a chave tem ${keyLen} letras`;
  resetBtn.disabled = phase !== "lost" || mode === "daily";   // no desafio o ticket já foi consumido
  submitBtn.disabled = phase !== "playing";
  renderCoins();
}

/* ----- Relógio ----- */
function startClock() {
  if (phase !== "playing") return;
  if (!deadline) deadline = Date.now() + totalMs();
  if (tickId) return;
  if (sessionUser) Activity.played(sessionUser.id, GAME_ID);   // alimenta "último jogo" no perfil
  tickId = setInterval(() => {
    const left = Math.max(0, deadline - Date.now());
    renderClock(left);
    if (left <= 0) lose();
  }, 250);
}
function stopClock() { clearInterval(tickId); tickId = null; }

/* ----- Jogadas ----- */
function append(ch) {
  if (phase !== "playing" || typed.length >= puzzle.n) return;
  if (countOf(typed, ch) >= countOf(puzzle.letters, ch)) return;
  startClock();
  typed.push(ch);
  renderLetters(); renderTyped();
}
function pop() {
  if (phase !== "playing" || !typed.length) return;
  typed.pop();
  renderLetters(); renderTyped();
}
function clearTyped() {
  if (phase !== "playing") return;
  typed = [];
  renderLetters(); renderTyped();
}
function shuffleLetters() {
  if (!puzzle) return;
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  renderLetters();
}
function submit() {
  if (phase !== "playing") return;
  const word = typed.join("");
  if (word.length < MIN_WORD) return setMessage(`Use pelo menos ${MIN_WORD} letras.`, true);
  if (!puzzle.words.includes(word)) return setMessage("Essa palavra não vale — confira as letras.", true);
  if (found.has(word)) return setMessage("Você já achou essa.", true);
  found.add(word);
  typed = [];
  setMessage(`${displayOf(word)}!`);
  if (word.length === puzzle.n) return win();
  paint();
}
function lose() {
  stopClock();
  phase = "lost";
  renderClock(0);
  /* No desafio diário a rodada termina de verdade: as palavras vão para o servidor (sem pontos, porque
     não achou a palavra-chave) e os troféus aparecem. No modo local, "Tentar de novo" recomeça. */
  if (mode === "daily") {
    roundDone = true;
    paint();
    setMessage("Tempo esgotado! Registrando as palavras…");
    finishDaily(true);
    return;
  }
  paint();
  setMessage("O tempo acabou. Tente de novo com as mesmas letras.", true);
}
function win() {
  stopClock();
  phase = "won";
  paint();
  if (mode === "daily") { setMessage("Rodada concluída! Registrando…"); finishDaily(); }
  else setMessage("Rodada concluída!" + creditWin());
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
    Scores.submit(GAME_ID, points, { state: { words: [...found] } }).then(() => ranking.refresh());
    note = ` +${points} pontos!`;
  } else note = " Crie uma conta para pontuar no ranking.";
  if (spent) note += " −1 coin.";
  renderCoins();
  const left = Coins.get(uid, GAME_ID);
  if (!left.coins) note += ` Sem coins por agora: novos em ${fmtDuration(left.nextRefillAt - Date.now())}.`;
  return note + (levelOf(wins) > before ? ` Novo nível: ${currentLevel().name}!` : "");
}

/* ----- Entrada ----- */
document.getElementById("shuffle").onclick = shuffleLetters;
document.getElementById("erase").onclick = clearTyped;
submitBtn.onclick = submit;
resetBtn.onclick = () => { if (phase === "lost") startRound(); };
document.addEventListener("keydown", e => {
  if (!puzzle || phase !== "playing") return;
  const t = e.target;
  if (t && typeof t.closest === "function" && t.closest("input, textarea, select")) return;
  if (e.key === "Enter") { submit(); e.preventDefault(); return; }
  if (e.key === "Backspace") { pop(); e.preventDefault(); return; }
  if (e.key === "Escape") { clearTyped(); return; }
  const ch = e.key.toUpperCase();
  if (/^[A-Z]$/.test(ch)) { append(ch); e.preventDefault(); }
});

/* ----- Ciclo de vida ----- */
function startRound(startedAt = 0) {
  stopClock();
  deadline = 0; typed = []; found = new Set(); credited = false; roundDone = false;
  order = puzzle.letters.map((_, i) => i);
  shuffleLetters();
  phase = "playing";
  /* No desafio diário o relógio é o do servidor: retomar um cenário já aberto não devolve o tempo cheio. */
  if (mode === "daily" && startedAt) {
    deadline = Number(startedAt) + totalMs();
    renderClock(Math.max(0, deadline - Date.now()));
    startClock();
  } else {
    renderClock(totalMs());
  }
  paint(); setMessage("");
}
function loadPuzzle(p, startedAt = 0) {
  puzzle = p;
  startRound(startedAt);
}
resetBtn.disabled = true;
nextBtn.onclick = async () => {
  if (mode === "daily") {
    const left = nextScenario();
    if (phase !== "won" || left == null) return;
    return openDaily(left);
  }
  if (phase !== "won" || Coins.get(uid, GAME_ID).coins <= 0) return;
  try { loadPuzzle(await freshPuzzle()); }
  catch (e) { setMessage(e?.code === "no_coins" ? "Sem coins por agora." : "Não foi possível abrir a rodada. Tente de novo.", true); }
};
function restoreSolved() {
  credited = true;
  found = new Set(puzzle.words.filter(w => w.length === puzzle.n));
  phase = "won";
  renderClock(totalMs()); paint();
  setMessage("Rodada já concluída. Use “Nova fase” para continuar.");
}
function lockBoard() {
  credited = true; phase = "locked"; paint();
  setMessage(`Sem coins por agora: novos em ${fmtDuration(Coins.get(uid, GAME_ID).nextRefillAt - Date.now())}.`);
}

/* ===================== Desafio diário ===================== */
const nextScenario = () => nextScenarioOf(GAME_ID);
function renderDaily() {
  if (mode !== "daily") return;
  renderDailyPanel({ el: dailyEl, gameId: GAME_ID, info: Cloud.daily(GAME_ID), day: dailyTicket?.day, slot: dailyTicket?.slot, won: phase === "won" || roundDone, onNext: () => nextBtn.click() });
}
async function openDaily(ticket) {
  try {
    const d = await Cloud.dailyOpen(GAME_ID, ticket.day, ticket.slot);
    dailyTicket = { day: d.day, slot: d.slot };
    loadPuzzle(serverPuzzle(d.puzzle, d.level), d.startedAt);
    setMessage(`Desafio do dia · ${LEVELS[d.level].name}. Ache a palavra de ${LEVELS[d.level].n} letras!`);
    renderDaily(); renderCoins();
  } catch (e) {
    setMessage(e?.code === "no_coins" ? "Sem tickets disponíveis: novos à meia-noite (Brasília)." : "Não foi possível abrir o desafio. Tente de novo.", true);
  }
}
function finishDaily(timeout = false) {
  Cloud.dailyFinish(GAME_ID, dailyTicket?.day, dailyTicket?.slot, {
    words: [...found],
    ...(timeout ? { timeout: true } : {}),
  })
    .then(r => {
      setMessage(r.ok
        ? `Tempo do cenário: ${fmtTime(r.ok.seconds)}.` + (r.ok.best != null && r.ok.best < r.ok.seconds ? ` Melhor do cenário: ${fmtTime(r.ok.best)}.` : "")
        : "Tempo enviado; será confirmado quando a conexão voltar.");
      wins = loadWins(); renderLevel();
      renderDaily(); renderCoins(); ranking.refresh();
    })
    .catch(() => setMessage("Rodada concluída, mas não deu para registrar o tempo. Tente de novo.", true));
}
function dailyPlaceholder() {
  loadPuzzle(placeholder());
  credited = true; phase = "locked"; paint();
  phaseEl.textContent = "Preparando a rodada do dia…";
  renderDaily();
}

/* Rodada inicial: na nuvem é o desafio do dia; no modo local, a fase salva por seed. */
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
