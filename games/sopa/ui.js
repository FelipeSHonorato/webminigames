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
import { GEN, LEVELS, STORE_KEY, canHint, generatePuzzle, isSolved, matchSelection, maskWord, maxHints, pointsAfterHints, readCells, snapLine } from "./domain.js";
import { fmtTime } from "../../shared/ranking-list.js";

const GAME_ID = "sopa";
const sessionUser = requireSession("../../index.html");   // sem sessão, volta para o login
if (sessionUser && !gameAllowed(GAME_ID, sessionUser)) location.replace("../../jogos.html");   // jogo desligado pelo administrador
mountUserBar(document.getElementById("userbar"), { base: "../../" });
const uid = sessionUser?.id ?? "guest";
const isCloud = Cloud.owns(uid);                          // o desafio diário só existe na nuvem (a seed é do servidor)
const ranking = mountRanking({ gameId: GAME_ID, title: "Sopa de Letras", modes: isCloud ? ["daily", "points"] : ["points"] });
const coinsEl = document.getElementById("coinBadge");
/* Na nuvem o jogo é SÓ o desafio do dia (a fase aleatória deixou de existir); no modo local/visitante continua aleatória. */
const mode = isCloud ? "daily" : "random";

/* Estado da partida (declarado antes de qualquer função que o use).
   foundCells: células de cada palavra achada, na ordem de leitura (a fase servida pelo servidor não traz as células das palavras, então
   a posição vem da seleção do jogador — é ela que o servidor confere). Na fase local, reconstrói das palavras ao retomar. */
let puzzle, found = new Set(), foundCells = new Map(), hints = 0, solved = false, credited = false, drag = null, startedAt = 0, timerId = null;

/* Meia-noite de Brasília (UTC-3, sem horário de verão): quando o desafio do dia e os coins do dia recomeçam. */
function nextSpMidnight() {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()).split("-").map(Number);
  return Date.UTC(y, m - 1, d + 1) + 3 * 3600 * 1000;
}

/* Coins: saldo ao lado do nome do jogo e liberação do botão "Nova fase" (só com fase concluída e coin disponível).
   No desafio diário o saldo mostrado é o do dia (reposto à meia-noite de Brasília; a quantidade é configurável). */
function renderCoins() {
  const next = document.getElementById("next");
  if (mode === "daily") {
    const d = Cloud.daily(GAME_ID) ?? { coins: 0 };
    coinsEl.replaceChildren(coinBadge({ coins: d.coins ?? 0, max: d.slots ?? Cloud.config()?.coinsPerDay ?? COINS_PER_DAY, nextRefillAt: nextSpMidnight() }));
    const left = nextScenario();                       // o botão só avança para o PRÓXIMO cenário (não há escolha)
    next.disabled = !solved || left == null || (d.coins ?? 0) <= 0;
    next.title = left == null ? "Você já concluiu os cenários do dia." : (d.coins ?? 0) <= 0 ? "Sem coins do dia." : "Abrir o próximo cenário.";
    return;
  }
  const balance = Coins.get(uid, GAME_ID);
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
const wordsEl = document.getElementById("words");
const hintBtn = document.getElementById("hint");

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

/** Pontos da fase agora: base do nível em que ela foi gerada menos 1 por dica usada (mínimo 1). */
const phasePoints = () => pointsAfterHints(pointsFor(puzzle.level), hints);
/** Salva o andamento: assim recarregar a página não zera as dicas já gastas nem as palavras achadas. Na nuvem o andamento parcial fica só na tela. */
const persist = (done = false) => { if (Cloud.owns(uid)) return; Run.set(uid, GAME_ID, { seed: puzzle.seed, level: puzzle.level, solved: done, hints, found: [...found], gen: GEN }); };
/** Células (ordem de leitura) de cada palavra já achada: as que o jogador marcou, ou, na fase local retomada, as próprias da fase. */
function seedFoundCells() {
  foundCells = new Map();
  for (const k of found) { const c = puzzle.words[k]?.cells; if (c) foundCells.set(k, [...c]); }
}

/** Conta a vitória uma única vez por fase. Pontos = base do nível − dicas usadas. */
function creditWin() {
  if (credited) { renderCoins(); return ""; }          // rejogar a mesma fase não pontua nem gasta coin
  credited = true;
  const before = levelOf(wins), points = phasePoints();
  wins++; saveWins(wins); renderLevel();
  const cloudMode = Cloud.owns(uid);
  const spent = cloudMode ? false : Coins.spend(uid, GAME_ID);               // na nuvem o coin já foi cobrado ao SERVIR a fase (open)
  persist(true);
  let note = "";
  if (Scores.canRank()) {
    // Na nuvem o servidor recebe as palavras achadas (com as células), regenera a partir da seed e só pontua se forem de verdade.
    const foundWords = [...found].sort((a, b) => a - b), cellsOf = index => foundCells.get(index) ?? puzzle.words[index]?.cells;
    Scores.submit(GAME_ID, points, { state: { found: foundWords.map(index => (cellsOf(index) ? { index, cells: cellsOf(index) } : index)) } }).then(() => ranking.refresh());
    note = ` +${points} ${points === 1 ? "ponto" : "pontos"}${hints ? ` (${hints} ${hints === 1 ? "dica usada" : "dicas usadas"})` : ""}!`;
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
/** Fase servida pelo servidor: chega SEM a solução (a seed fica no servidor), então a tela não sabe onde as palavras estão. */
const serverPuzzle = (view, level) => ({ n: view.n, grid: view.grid, words: view.words, level, server: true });
/** Fase nova no modo local: a seed fica salva, então recarregar a página devolve a mesma fase até ela ser concluída. */
function localFresh() {
  const seed = (Math.random() * 2 ** 32) >>> 0, level = levelOf(wins);
  Run.set(uid, GAME_ID, { seed, level, solved: false, hints: 0, found: [], gen: GEN });
  return buildPuzzle(seed, level);
}
/** Fase nova: na nuvem quem serve é o servidor (open cobra o coin e guarda a seed); local sorteia. */
const freshPuzzle = () => (Cloud.owns(uid) ? Cloud.open(GAME_ID).then(d => serverPuzzle(d.puzzle, d.level)) : Promise.resolve(localFresh()));

/* ----- Desenho -----
   As células são criadas uma vez por fase e só mudam de classe (como no Sudoku, não recriar o que o dedo toca). */
let cellEls = [];
function buildBoard() {
  board.style.setProperty("--n", puzzle.n);
  cellEls = puzzle.grid.map((ch, i) => { const el = document.createElement("div"); el.className = "cell"; el.dataset.i = i; el.textContent = ch; return el; });
  board.replaceChildren(...cellEls);
}
/** Palavras achadas colorem as células (cada palavra tem a sua cor); a seleção em andamento fica por cima. */
function renderBoard() {
  const color = new Map(), picked = new Set(drag?.cells ?? []);
  puzzle.words.forEach((w, k) => { if (found.has(k)) for (const c of (foundCells.get(k) ?? [])) color.set(c, k % 8); });
  cellEls.forEach((el, i) => {
    const cls = "cell" + (color.has(i) ? ` found f${color.get(i)}` : "") + (picked.has(i) ? " pick" : "");
    if (el.className !== cls) el.className = cls;
  });
  board.classList.toggle("locked", solved);
}
/** Lista de palavras: ocultas (uma casinha por letra); as dicas preenchem letras; achadas aparecem por inteiro. */
function renderWords() {
  wordsEl.replaceChildren(...puzzle.words.map((w, k) => {
    const done = found.has(k), li = document.createElement("li");
    if (done) li.className = `done f${k % 8}`;
    const mask = document.createElement("span");
    mask.className = "mask";
    mask.setAttribute("aria-label", done ? w.text : `Palavra oculta com ${w.norm.length} letras`);
    mask.replaceChildren(...maskWord(w, done, hints).map(ch => { const i = document.createElement("i"); i.textContent = ch ?? ""; return i; }));
    li.append(mask);
    return li;
  }));
  document.getElementById("remaining").textContent = `${found.size}/${puzzle.words.length}`;
}
function renderHint() {
  const level = LEVELS[puzzle.level], max = maxHints(level), can = !solved && canHint(puzzle, level, found, hints);
  hintBtn.disabled = !can;
  hintBtn.title = can || solved ? "" : hints >= max ? `Limite de ${max} dicas neste nível.` : "As palavras que faltam já mostram todas as letras que uma dica pode revelar.";
  document.getElementById("hintinfo").textContent = `Dicas: ${hints} de ${max} · Esta fase vale ${phasePoints()} ${phasePoints() === 1 ? "ponto" : "pontos"}`;
}
const render = () => { renderBoard(); renderWords(); renderHint(); };

const formatTime = ms => { const s = Math.floor(ms / 1000); return `${String((s / 60) | 0).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
function startTimer(at = Date.now()) {
  if (timerId || solved) return;
  startedAt = at;                                            // no desafio do dia, o relógio começa quando o servidor abriu a fase
  if (sessionUser) Activity.played(sessionUser.id, GAME_ID);   // alimenta "último jogo" no perfil
  timerId = setInterval(() => (timerEl.textContent = formatTime(Date.now() - startedAt)), 250);
}
function stopTimer() { clearInterval(timerId); timerId = null; }
function setMessage(text, isError = false) { msg.textContent = text; msg.classList.toggle("err", isError); }

/** Abre uma fase. `progress` traz dicas e palavras já achadas de uma fase salva (recarregar a página não as perde). */
function loadPuzzle(p, progress = {}) {
  if (p !== puzzle) credited = false;
  puzzle = p; found = new Set(progress.found ?? []); hints = progress.hints ?? 0; drag = null; solved = false;
  seedFoundCells();
  stopTimer(); timerEl.textContent = "00:00"; setMessage("");
  buildBoard(); render();
  renderCoins();
}

/* ----- Jogadas ----- */
function win() {
  solved = true; stopTimer(); drag = null;
  render();
  if (mode === "daily") finishDaily();                 // desafio do dia: o SERVIDOR mede o tempo e pontua/progride
  else setMessage(`Todas as palavras encontradas em ${formatTime(Date.now() - startedAt)}!` + creditWin());
}
/** Fim do arrasto: confere a linha marcada com as palavras que faltam. */
function evaluate(cells) {
  if (cells.length < 2) return;                                    // um toque simples não marca nada
  const m = matchSelection(puzzle, cells, found);
  if (m.index >= 0) {
    // Guarda a ocorrência na ordem de leitura (o jogador pode ter arrastado de trás para frente): é ela que o serviço valida.
    found.add(m.index); foundCells.set(m.index, readCells(puzzle, cells) === puzzle.words[m.index].norm ? [...cells] : [...cells].reverse());
    persist();
    setMessage(`Achou: ${puzzle.words[m.index].text}!`);
    render();
    if (isSolved(puzzle, found)) win();
  } else setMessage(m.already ? "Você já achou essa palavra." : "Essas letras não formam uma palavra da lista.", true);
}
/** Dica: revela mais uma letra de cada palavra (o servidor decide e conta, na nuvem). Custa 1 ponto. */
async function useHint() {
  if (solved || !canHint(puzzle, LEVELS[puzzle.level], found, hints)) return;
  startTimer();
  if (isCloud) {
    try { hints = (await (mode === "daily" ? Cloud.dailyHint(GAME_ID, dailySlot, { found: [...found] }) : Cloud.hint(GAME_ID, { found: [...found] }))).hints; }
    catch { setMessage("Não foi possível pedir a dica agora.", true); return; }
  } else { hints++; persist(); }
  setMessage(`Dica ${hints}: mais uma letra de cada palavra. A fase agora vale ${phasePoints()} ${phasePoints() === 1 ? "ponto" : "pontos"}.`);
  render();
}

/* ----- Entrada: arrastar com mouse ou dedo (Pointer Events); o ponteiro fica "capturado" pela grade até soltar ----- */
function cellUnder(e) {
  const r = board.getBoundingClientRect(), size = board.clientWidth / puzzle.n;   // clientWidth/Left/Top: dentro da borda, onde ficam as células
  return { row: Math.floor((e.clientY - r.top - board.clientTop) / size), col: Math.floor((e.clientX - r.left - board.clientLeft) / size) };   // pode sair da grade: snapLine limita
}
board.addEventListener("pointerdown", e => {
  if (solved || (e.pointerType === "mouse" && e.button !== 0)) return;
  const { row, col } = cellUnder(e), n = puzzle.n;
  if (row < 0 || col < 0 || row >= n || col >= n) return;
  drag = { start: row * n + col, cells: [row * n + col] };
  board.setPointerCapture(e.pointerId);
  startTimer();
  renderBoard();
  e.preventDefault();
});
board.addEventListener("pointermove", e => {
  if (!drag) return;
  const { row, col } = cellUnder(e), cells = snapLine(puzzle.n, drag.start, row, col);
  if (cells.length === drag.cells.length && cells.at(-1) === drag.cells.at(-1)) return;   // nada mudou
  drag.cells = cells;
  renderBoard();
});
board.addEventListener("pointerup", () => {
  if (!drag) return;
  const cells = drag.cells;
  drag = null;
  renderBoard();
  evaluate(cells);
});
board.addEventListener("pointercancel", () => { drag = null; renderBoard(); });
board.addEventListener("contextmenu", e => e.preventDefault());      // segurar o dedo não abre menu no meio do arrasto

hintBtn.onclick = useHint;
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

/** Fase já concluída (ao recarregar a página): mostra tudo achado, trava a grade e não pontua de novo. */
function restoreSolved() {
  credited = true; solved = true;
  found = new Set(puzzle.words.keys());
  seedFoundCells();
  render();
  setMessage("Fase já concluída. Use “Nova fase” para continuar.");
  renderCoins();
}
/** Sem coins e sem fase salva: grade travada até a recarga. */
function lockBoard() {
  credited = true; solved = true;
  render();
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
    setMessage(`Desafio do dia · ${LEVELS[d.level].name}. Ache todas as palavras!`);
    renderDaily(); renderCoins();
  } catch (e) {
    setMessage(e?.code === "no_coins" ? "Sem coins do dia: voltam à meia-noite (Brasília)." : "Não foi possível abrir o desafio. Tente de novo.", true);
  }
}

/** Conclui o tabuleiro do dia: o SERVIDOR mede o tempo (relógio de parede, +30 s por dica) e guarda o melhor por slot. */
function finishDaily() {
  const localMs = Date.now() - startedAt;
  setMessage(`Encontradas todas em ${formatTime(localMs)}! Registrando…`);
  const foundWords = [...found].sort((a, b) => a - b), cellsOf = index => foundCells.get(index) ?? puzzle.words[index]?.cells;
  Cloud.dailyFinish(GAME_ID, dailySlot, { found: foundWords.map(index => (cellsOf(index) ? { index, cells: cellsOf(index) } : index)) })
    .then(r => {
      setMessage(r.ok
        ? `Tempo do dia: ${fmtTime(r.ok.seconds)}.` + (r.ok.best != null && r.ok.best < r.ok.seconds ? ` Melhor do dia: ${fmtTime(r.ok.best)}.` : "")
        : `Tempo enviado (${formatTime(localMs)}); será confirmado quando a conexão voltar.`);
      wins = loadWins(); renderLevel();                  // concluir o cenário do dia também sobe a progressão (pontos)
      renderDaily(); renderCoins(); ranking.refresh();
    })
    .catch(() => setMessage(`Encontradas em ${formatTime(localMs)}, mas não deu para registrar o tempo. Tente de novo.`, true));
}

/** Grade neutra enquanto o cenário do dia é servido pelo servidor (não é jogável e não registra tempo). */
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
    renderDaily(); renderCoins();
    const slot = nextScenario();
    if (slot == null) { credited = true; solved = true; setMessage("Você já concluiu os cenários do dia. Novos à meia-noite (Brasília)."); render(); renderCoins(); }
    else if ((Cloud.daily(GAME_ID)?.coins ?? 0) <= 0) { credited = true; solved = true; setMessage("Sem coins do dia: voltam à meia-noite (Brasília)."); render(); renderCoins(); }
    else openDaily(slot);                                             // abre sozinho o próximo cenário do dia (gasta 1 coin)
  });
} else {
  const saved = Run.get(uid, GAME_ID);
  if (saved) {
    /* Fase salva por uma versão antiga do gerador: a mesma seed gera outra fase, então dicas e palavras achadas (que são índices
       da lista) não valem mais e o andamento recomeça. Fases já concluídas só mostram a solução, sem problema. */
    const sameGen = saved.gen === GEN;
    loadPuzzle(buildPuzzle(saved.seed, saved.level), sameGen ? saved : {});
    if (saved.solved) restoreSolved(); else if (!sameGen) persist();
  }
  else if (Coins.get(uid, GAME_ID).coins > 0) loadPuzzle(localFresh());
  else { loadPuzzle(lockedPuzzle()); lockBoard(); }
}
