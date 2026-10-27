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
import {
  GEN, LEVELS, STORE_KEY, answersAt, canHint, hintValue, isAnswerCorrect, isDouble, decodeEntries, encodeEntries, firstOpenCell, generatePuzzle, isComplete, isFilled, jumpTarget,
  letterCells, maxHints, newEntries, nextHintCell, normalizeLetter, pickAnswerAt, pointsAfterHints, setLetter, stepInAnswer, toggleAnswerAt, neighborAnswer, typeInCell, eraseAt,
} from "./domain.js";
import { fmtTime } from "../../shared/ranking-list.js";
import { nextScenario as nextScenarioOf, nextSpMidnight, renderDailyPanel, spDay } from "../../shared/daily.js";
import { mountTutorial } from "../../shared/tutorial.js";
import { CRUZADAS_TUTORIAL } from "./tutorial.js";

const GAME_ID = "cruzadas";
Music.play(GAME_ID);
const sessionUser = requireSession("../../index.html");   // sem sessão, volta para o login
if (sessionUser && !gameAllowed(GAME_ID, sessionUser)) location.replace("../../jogos.html");   // jogo desligado pelo administrador
mountUserBar(document.getElementById("userbar"), { base: "../../" });
const uid = sessionUser?.id ?? "guest";
const isCloud = Cloud.owns(uid);                          // o desafio diário só existe na nuvem (a seed é do servidor)
const ranking = mountRanking({ gameId: GAME_ID, title: "Palavras Cruzadas" });
const coinsEl = document.getElementById("coinBadge");
/* Na nuvem o jogo é SÓ o desafio do dia (a fase aleatória deixou de existir); no modo local/visitante continua aleatória. */
const mode = isCloud ? "daily" : "random";
mountTutorial({ trigger: "howto", ...CRUZADAS_TUTORIAL });

/* Estado da partida (declarado antes de qualquer função que o use).
   selected: id da resposta escolhida (-1 = nenhuma). active: casa onde o cursor está (-1 = nenhuma). locked: casas reveladas por dica. */
let puzzle, entries = [], locked = new Set(), hints = 0, selected = -1, active = -1, tapped = -1, solved = false, credited = false, finishing = false, startedAt = 0, timerId = null;


/* Coins: saldo ao lado do nome do jogo e liberação do botão "Nova fase" (só com fase concluída e coin disponível).
   No desafio diário o saldo mostrado é o do dia (reposto à meia-noite de Brasília; a quantidade é configurável). */
function renderCoins() {
  const next = document.getElementById("next");
  if (mode === "daily") {
    const d = Cloud.daily(GAME_ID) ?? { coins: 0 };
    coinsEl.replaceChildren(coinBadge({ coins: d.coins ?? 0, max: d.maxCoins ?? 30 * (d.slots ?? Cloud.config()?.coinsPerDay ?? COINS_PER_DAY), nextRefillAt: nextSpMidnight(), daily: true }));
    const left = nextScenario();                       // o botão só avança para o PRÓXIMO cenário (não há escolha)
    next.disabled = !solved || left == null;
    next.title = left == null ? "Sem tickets pendentes." : "Abrir o próximo cenário.";
    return;
  }
  const balance = Coins.get(uid, GAME_ID);
  coinsEl.replaceChildren(coinBadge(balance));
  const canNext = solved && balance.coins > 0;
  next.disabled = !canNext;
  next.title = canNext ? "" : !solved ? "Conclua a fase atual para liberar a próxima." : `Sem coins por agora: novos em ${fmtDuration(balance.nextRefillAt - Date.now())}.`;
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
const board = document.getElementById("board");
const msg = document.getElementById("msg");
const timerEl = document.getElementById("timer");
const hintBtn = document.getElementById("hint");
const clueBox = document.getElementById("clueBox"), clueDir = document.getElementById("clueDir"), clueText = document.getElementById("clueText");
const EMPTY_CLUE = "Toque em uma casa amarela (a dica) ou em uma casa branca da grade.";

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
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/** Salva o andamento: assim recarregar a página não perde as letras digitadas nem as dicas já gastas. Na nuvem o andamento parcial fica só na tela. */
const persist = (done = false) => { if (Cloud.owns(uid)) return; Run.set(uid, GAME_ID, { seed: puzzle.seed, level: puzzle.level, solved: done, hints, entries: encodeEntries(entries), locked: [...locked], gen: GEN }); };

/** Conta a vitória uma única vez por fase. Pontos = base do nível − dicas usadas. `alreadySubmitted`: na nuvem o servidor já validou e
    pontuou a jogada (finishNow), então aqui só atualiza o ranking — sem reenviar. */
function creditWin(alreadySubmitted = false) {
  if (credited) { renderCoins(); return ""; }          // rejogar a mesma fase não pontua nem gasta coin
  credited = true;
  const before = levelOf(wins), points = phasePoints();
  wins++; saveWins(wins); renderLevel();
  const cloudMode = Cloud.owns(uid);
  const spent = cloudMode ? false : Coins.spend(uid, GAME_ID);               // na nuvem o coin já foi cobrado ao SERVIR a fase (open)
  persist(true);
  let note = "";
  if (Scores.canRank()) {
    // Na nuvem o servidor recebe as letras, regenera a partir da seed e só pontua se a grade estiver completa de verdade.
    if (alreadySubmitted) ranking.refresh();
    else Scores.submit(GAME_ID, points, { state: { entries: encodeEntries(entries) } }).then(() => ranking.refresh());
    note = ` +${plural(points, "ponto", "pontos")}${hints ? ` (${plural(hints, "dica usada", "dicas usadas")})` : ""}!`;
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
/** Fase servida pelo servidor: chega SEM a solução (a seed fica no servidor), então a tela não sabe as letras certas. */
const serverPuzzle = (view, level) => ({ n: view.n, cells: view.cells, answers: view.answers, level, server: true });
/** Fase nova no modo local: a seed fica salva, então recarregar a página devolve a mesma fase até ela ser concluída. */
function localFresh() {
  const seed = (Math.random() * 2 ** 32) >>> 0, level = levelOf(wins);
  Run.set(uid, GAME_ID, { seed, level, solved: false, hints: 0, entries: "", locked: [], gen: GEN });
  return buildPuzzle(seed, level);
}
/** Fase nova: na nuvem quem serve é o servidor (open cobra o coin e guarda a seed); local sorteia. */
const freshPuzzle = () => (Cloud.owns(uid) ? Cloud.open(GAME_ID).then(d => serverPuzzle(d.puzzle, d.level)) : Promise.resolve(localFresh()));

/* ----- Desenho -----
   As casas são criadas uma vez por fase e só mudam de classe e conteúdo (recriar o que o dedo toca faria o navegador perder o foco). */
const ARROWS = {   // setas em SVG: → ↳ ↓ ↴ (a casa da dica fica ao lado ou acima da 1ª letra; a seta aponta para ela)
  R: '<path d="M1 5.5H9.5M6.8 2.8L9.5 5.5L6.8 8.2"/>',
  RD: '<path d="M1 2H8.5V9.5M5.8 6.8L8.5 9.5L11.2 6.8"/>',
  D: '<path d="M5.5 1V9.5M2.8 6.8L5.5 9.5L8.2 6.8"/>',
  DR: '<path d="M2 1V8.5H9.5M6.8 5.8L9.5 8.5L6.8 11.2"/>',
};
const arrowSvg = v => `<svg class="arw arw-${v}" viewBox="0 0 11 11" aria-hidden="true">${ARROWS[v]}</svg>`;
const escapeHtml = s => s.replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
let cellEls = [], shown = [], dblDir = [];   // dblDir[i]: "a"/"d" nas casas de duas letras (sentido da resposta que passa por ela), "" nas demais
function buildBoard() {
  board.style.setProperty("--n", puzzle.n);
  cellEls = puzzle.cells.map((c, i) => {
    const el = document.createElement("div");
    el.dataset.i = i;
    if (c.t === "L") {
      el.className = "cell letter";
      if (isDouble(c)) el.innerHTML = '<span class="d1"></span><span class="d2"></span>';   // casa com diagonal \: duas letras, uma em cada triângulo
    } else if (c.t === "B") el.className = "cell block";
    else {
      el.className = "cell clue";
      el.innerHTML = c.clues.map(k => {
        const a = puzzle.answers[k.id];
        return `<div class="c ${k.slot}" data-id="${k.id}" title="${escapeHtml(a.clue)}"><span class="t">${escapeHtml(a.clue)}</span>${arrowSvg(a.variant)}</div>`;
      }).join("");
    }
    return el;
  });
  shown = new Array(puzzle.cells.length).fill(null);
  dblDir = puzzle.cells.map(c => (isDouble(c) ? (c.across >= 0 ? "a" : "d") : ""));
  board.replaceChildren(...cellEls);
}
function renderBoard() {
  const inWord = new Set(selected >= 0 ? puzzle.answers[selected].cells : []);
  puzzle.cells.forEach((c, i) => {
    const el = cellEls[i];
    if (c.t === "L") {
      const cls = "cell letter" + (dblDir[i] ? ` dbl dbl-${dblDir[i]}` : "") + (inWord.has(i) ? " word" : "") + (i === active && !solved ? " active" : "") + (locked.has(i) ? " hint" : ""), key = cls + "|" + entries[i];
      if (shown[i] !== key) {
        el.className = cls; shown[i] = key;
        if (dblDir[i]) { el.children[0].textContent = entries[i][0] ?? ""; el.children[1].textContent = entries[i][1] ?? ""; }
        else el.textContent = entries[i];
      }
    } else if (c.t === "C") for (const half of el.children) half.classList.toggle("sel", +half.dataset.id === selected);
  });
  board.classList.toggle("locked", solved);
}
/** Há dica a pedir agora: resposta escolhida, dentro do limite e (na fase local, que conhece a solução) com letra a revelar. */
const canAskHint = () => !solved && hints < maxHints(puzzle.level) && selected >= 0 && (puzzle.server || canHint(puzzle, entries, selected, hints, puzzle.level));
function renderPanel() {
  const a = selected >= 0 ? puzzle.answers[selected] : null;
  clueBox.classList.toggle("empty", !a);
  clueDir.textContent = a ? `${a.dir === "across" ? "→ Horizontal" : "↓ Vertical"} · ${plural(a.len, "letra", "letras")}${a.cells.length < a.len ? ` em ${plural(a.cells.length, "casa", "casas")}` : ""}` : "Dica";
  clueText.textContent = a ? a.clue : EMPTY_CLUE;
  document.getElementById("prevClue").disabled = document.getElementById("nextClue").disabled = solved;
  const max = maxHints(puzzle.level), can = canAskHint();
  hintBtn.disabled = !can;
  hintBtn.title = can || solved ? "" : selected < 0 ? "Escolha uma dica (casa amarela) ou uma casa da grade primeiro."
    : hints >= max ? `Limite de ${plural(max, "dica", "dicas")} neste nível.`
    : !puzzle.server && isAnswerCorrect(puzzle, entries, selected) ? "Essa palavra já está certa." : "Só falta a 2ª letra de uma casa de duas letras: a dica revela só uma das duas, digite a outra.";
  document.getElementById("hintinfo").textContent = `Dicas: ${hints} de ${max} · Esta fase vale ${plural(phasePoints(), "ponto", "pontos")}`;
}
const render = () => { renderBoard(); renderPanel(); };

const formatTime = ms => { const s = Math.floor(ms / 1000); return `${String((s / 60) | 0).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
function startTimer(at = Date.now()) {
  if (timerId || solved) return;
  startedAt = at;                                            // no desafio do dia, o relógio começa quando o servidor abriu a fase
  if (sessionUser) Activity.played(sessionUser.id, GAME_ID);   // alimenta "último jogo" no perfil
  timerId = setInterval(() => (timerEl.textContent = formatTime(Date.now() - startedAt)), 250);
}
function stopTimer() { clearInterval(timerId); timerId = null; }
function setMessage(text, isError = false) { msg.textContent = text; msg.classList.toggle("err", isError); }

/** Abre uma fase. `progress` traz letras, dicas e casas travadas de uma fase salva. */
function loadPuzzle(p, progress = {}) {
  if (p !== puzzle) credited = false;
  puzzle = p; entries = decodeEntries(p, progress.entries); hints = progress.hints ?? 0;
  const valid = new Set(letterCells(p));
  locked = new Set((progress.locked ?? []).filter(i => valid.has(i) && (!p.cells[i].ch || entries[i] === p.cells[i].ch)));   // só vale travada a casa que está certa (na fase servida não há ch: nenhuma travada)
  selected = -1; active = -1; tapped = -1; solved = false; finishing = false;
  stopTimer(); timerEl.textContent = "00:00"; setMessage("");
  buildBoard(); render();
  renderCoins();
}

/* ----- Jogadas ----- */
function win() {
  solved = true; stopTimer(); selected = -1; active = -1;
  render();
  setMessage(`Cruzadinha completa em ${formatTime(Date.now() - startedAt)}!` + creditWin());
}
/** Vitória na nuvem: o servidor já validou e pontuou a grade (finishNow); aqui só fecha a fase e atualiza a tela. */
function winConfirmed() {
  solved = true; stopTimer(); selected = -1; active = -1;
  render();
  setMessage(`Cruzadinha completa em ${formatTime(Date.now() - startedAt)}!` + creditWin(true));
}
/** Aplica uma mudança nas letras: salva e confere se a grade está completa. `typed`: veio de uma letra digitada (avisa se encheu com erro).
    Na nuvem a grade não traz a solução: com todas as casas preenchidas, quem confere é o servidor. */
function commit(next, typed = false) {
  if (next === entries) return;
  entries = next; persist(); setMessage("");
  render();
  if (puzzle.server) { if (isFilled(puzzle, entries)) finishServer(); return; }
  if (isComplete(puzzle, entries)) win();
  else if (typed && isFilled(puzzle, entries)) setMessage("Todas as casas estão preenchidas, mas ainda há letras erradas.", true);
}
/** Grade cheia na nuvem: manda AGORA para o servidor validar. Se ele confirmar (ou ficar na fila por rede/ritmo), a fase é vencida;
    se recusar, avisa e deixa o jogador corrigir. */
async function finishServer() {
  if (finishing || solved) return;
  finishing = true;
  setMessage("Conferindo o tabuleiro…");
  try {
    const r = mode === "daily"
      ? await Cloud.dailyFinish(GAME_ID, dailyTicket?.day, dailyTicket?.slot, { entries: encodeEntries(entries) })   // desafio do dia: o SERVIDOR mede o tempo e pontua
      : await Cloud.finishNow(GAME_ID, { entries: encodeEntries(entries) });
    if (r?.ok || r?.pending) { if (mode === "daily") winDaily(r); else winConfirmed(); }
  } catch (e) {
    if (e?.code === "invalid") setMessage("Todas as casas estão preenchidas, mas ainda há letras erradas.", true);
    else if (e?.code === "no_phase") setMessage("Esta fase não está mais aberta. Use “Nova fase”.", true);
    else setMessage("Não foi possível enviar a jogada agora. Tente de novo.", true);
  } finally { finishing = false; }
}
/** Vitória no desafio do dia: o SERVIDOR mediu o tempo e guardou o melhor do slot (ou ficou na fila). Aqui só fecha a fase e mostra o tempo. */
function winDaily(r) {
  solved = true; stopTimer(); selected = -1; active = -1;
  render();
  setMessage(r?.ok
    ? `Tempo do cenário: ${fmtTime(r.ok.seconds)}.` + (r.ok.best != null && r.ok.best < r.ok.seconds ? ` Melhor do cenário: ${fmtTime(r.ok.best)}.` : "")
    : "Tempo enviado; será confirmado quando a conexão voltar.");
  wins = loadWins(); renderLevel();                    // concluir o cenário do dia também sobe a progressão (pontos)
  renderDaily(); renderCoins(); ranking.refresh();
}
/** Escolhe uma resposta (pelo toque na dica ou numa letra) e leva o cursor à primeira casa vazia dela. */
function selectAnswer(id, cell = -1) {
  if (solved) return;
  if (cell < 0) tapped = -1;
  selected = id; active = cell >= 0 ? cell : firstOpenCell(puzzle, entries, id);
  startTimer();
  render();
}
/** Toque numa letra. Tocar duas vezes seguidas na mesma letra troca o sentido (horizontal ⇄ vertical); a casa que o cursor ocupa
    depois de escolher uma dica ou de digitar não conta como "primeiro toque", senão o sentido trocaria sozinho. */
function selectCell(idx) {
  if (solved) return;
  const { across, down } = answersAt(puzzle, idx);
  if (across < 0 && down < 0) return;
  const id = idx === tapped && (selected === across || selected === down) ? toggleAnswerAt(puzzle, idx, selected) : pickAnswerAt(puzzle, idx, selected);
  tapped = idx;
  selectAnswer(id, idx);
}
/** Digita uma letra na casa do cursor e avança para a próxima da resposta. Casa travada por dica não muda. */
function typeLetter(letter) {
  if (solved || finishing) return;
  if (active < 0) { setMessage("Toque em uma dica ou em uma casa da grade primeiro.", true); return; }
  startTimer();
  const { entries: next, advance } = typeInCell(puzzle, entries, locked, active, letter);   // casa de duas letras: a 1ª abre a casa, a 2ª fecha e só então o cursor avança
  if (selected >= 0 && advance) active = stepInAnswer(puzzle, selected, active, 1);
  tapped = -1;
  if (next === entries) { render(); return; }
  commit(next, true);
}
/** Backspace: apaga a última letra da casa (numa casa de duas letras, uma de cada vez); se a casa estiver vazia (ou travada por dica), volta uma casa e apaga lá. */
function erase() {
  if (solved || finishing || active < 0) return;
  let target = active;
  if ((entries[active] === "" || locked.has(active)) && selected >= 0) { target = stepInAnswer(puzzle, selected, active, -1); active = target; }
  const next = eraseAt(puzzle, entries, locked, target);
  if (next === entries) { render(); return; }
  commit(next);
}
function move(dr, dc) {
  if (solved) return;
  const from = active >= 0 ? active : letterCells(puzzle)[0], to = active >= 0 ? jumpTarget(puzzle, from, dr, dc) : from;
  if (to < 0) return;
  const { across, down } = answersAt(puzzle, to);
  selected = dr === 0 ? (across >= 0 ? across : down) : (down >= 0 ? down : across);
  active = to; tapped = -1;
  startTimer();
  render();
}
/** Dica: preenche a próxima letra (a primeira que ainda não está certa) da resposta escolhida. Custa 1 ponto.
    Na nuvem o servidor decide a casa e a letra, e conta a dica. */
async function useHint() {
  if (solved || finishing) return;
  startTimer();
  if (isCloud) {
    if (!canAskHint()) return;   // na nuvem a grade não traz a solução: só dá para pedir dica com uma resposta escolhida e dentro do limite
    let d;
    try { d = await (mode === "daily" ? Cloud.dailyHint(GAME_ID, dailyTicket?.day, dailyTicket?.slot, { id: selected, entries: encodeEntries(entries) }) : Cloud.hint(GAME_ID, { id: selected, entries: encodeEntries(entries) })); }
    catch (e) {
      setMessage(e?.code === "no_hint" ? "Essa palavra já está certa." : e?.code === "no_phase" ? "Esta fase não está mais aberta. Use “Nova fase”." : "Não foi possível pedir a dica agora.", true);
      return;
    }
    hints = d.hints;
    const idx = d.cell, cell = puzzle.cells[idx], half = isDouble(cell), cells = puzzle.answers[selected].cells;
    if (half) active = idx;   // casa de duas letras (C\H, R\R…): só a 1ª é revelada e a casa NÃO trava; o cursor fica nela para o jogador digitar a outra
    else {
      locked.add(idx);
      active = cells.slice(cells.indexOf(idx) + 1).find(i => !locked.has(i)) ?? idx;
    }
    entries = setLetter(puzzle, entries, new Set(), idx, d.value);
    render();
    if (isFilled(puzzle, entries)) { finishServer(); return; }
    const what = half ? `a 1ª letra (${d.value}) foi revelada: digite a outra` : "letra revelada";
    setMessage(`Dica ${hints}: ${what}. A fase agora vale ${plural(phasePoints(), "ponto", "pontos")}.`);
    return;
  }
  if (!canHint(puzzle, entries, selected, hints, puzzle.level)) return;
  const idx = nextHintCell(puzzle, entries, selected), cell = puzzle.cells[idx], half = isDouble(cell);
  hints++;
  const cells = puzzle.answers[selected].cells;
  if (half) active = idx;   // casa de duas letras (C\H, R\R…): só a 1ª é revelada e a casa NÃO trava; o cursor fica nela para o jogador digitar a outra
  else {
    locked.add(idx);
    active = cells.slice(cells.indexOf(idx) + 1).find(i => !locked.has(i)) ?? idx;   // o cursor segue para a próxima casa livre: a letra revelada fica travada e engoliria o que o jogador digitar
  }
  entries = setLetter(puzzle, entries, new Set(), idx, hintValue(cell));
  persist(); render();
  if (isComplete(puzzle, entries)) { win(); return; }
  const what = half ? `uma das duas letras (${cell.ch[0]}) foi revelada: digite a outra` : "letra revelada";
  setMessage(`Dica ${hints}: ${what}. A fase agora vale ${plural(phasePoints(), "ponto", "pontos")}.`);
}

/* ----- Entrada: toque/mouse na grade, teclado da tela e teclado físico ----- */
board.addEventListener("pointerdown", e => {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  const half = e.target.closest(".c");
  if (half) { selectAnswer(+half.dataset.id); return; }
  const cell = e.target.closest(".cell.letter");
  if (cell) selectCell(+cell.dataset.i);
});
document.querySelectorAll("#kbd button").forEach(b => b.addEventListener("click", () => (b.dataset.k ? typeLetter(b.dataset.k) : erase())));
hintBtn.onclick = useHint;
/* ‹ › : dica anterior/próxima em ordem de leitura. Ajuda no celular, onde cada metade de uma casa com duas dicas é pequena para o dedo. */
document.getElementById("prevClue").onclick = () => { if (!solved) selectAnswer(neighborAnswer(puzzle, selected, -1)); };
document.getElementById("nextClue").onclick = () => { if (!solved) selectAnswer(neighborAnswer(puzzle, selected, 1)); };
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

const STEP = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
/* O teclado vale em toda a área do jogo (não só com a grade focada): depois de tocar num botão, o foco fica nele
   e os atalhos precisam continuar funcionando. Campos de texto e o resto da página (ranking, barra) ficam de fora. */
document.addEventListener("keydown", e => {
  if (e.target !== document.body && !e.target.closest?.("main")) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key in STEP) move(...STEP[e.key]);
  else if (e.key === "Backspace" || e.key === "Delete") erase();
  else if ((e.key === " " || e.key === "Enter") && (e.target === board || e.target === document.body)) {   // em botão focado, Espaço/Enter continuam acionando o botão
    if (!solved && active >= 0) { selectAnswer(toggleAnswerAt(puzzle, active, selected), active); tapped = -1; }
  } else {
    const letter = normalizeLetter(e.key);
    if (!letter) return;
    typeLetter(letter);
  }
  e.preventDefault();
});

/** Fase já concluída (ao recarregar a página): mostra a grade resolvida, trava e não pontua de novo. */
function restoreSolved() {
  credited = true; solved = true;
  entries = puzzle.cells.map(c => (c.t === "L" ? c.ch : ""));
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
    setMessage(`Desafio do dia · ${LEVELS[d.level].name}. Complete a grade!`);
    renderDaily(); renderCoins();
  } catch (e) {
    setMessage(e?.code === "no_coins" ? "Sem tickets disponíveis: novos à meia-noite (Brasília)." : "Não foi possível abrir o desafio. Tente de novo.", true);
  }
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
    renderDaily(); renderCoins(); ranking.refresh();
    const ticket = nextScenario();
    if (ticket == null) { credited = true; solved = true; setMessage("Você já concluiu os cenários disponíveis. Novos tickets à meia-noite (Brasília)."); render(); renderCoins(); }
    else openDaily(ticket);                                           // abre sozinho o próximo ticket (mais antigo primeiro)
  });
} else {
  const saved = Run.get(uid, GAME_ID);
  if (saved) {
    /* Fase salva por uma versão antiga do gerador: a mesma seed gera outra grade, então letras e dicas não valem e recomeçam.
       Fases já concluídas só mostram a solução, sem problema. */
    const sameGen = saved.gen === GEN;
    loadPuzzle(buildPuzzle(saved.seed, saved.level), sameGen ? saved : {});
    if (saved.solved) restoreSolved(); else if (!sameGen) persist();
  }
  else if (Coins.get(uid, GAME_ID).coins > 0) loadPuzzle(localFresh());
  else { loadPuzzle(lockedPuzzle()); lockBoard(); }
}
