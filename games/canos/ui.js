import "../../shared/backend/boot.js";
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
import { WINS_PER_LEVEL, Progress, pointsFor, pointsLegend } from "../../shared/progress.js";
import { DELTA, E, GEN, LEVELS, N, S, STORE_KEY, W, firstLeaks, generatePuzzle, initialRots, rotateTile, simulate, solutionRots } from "./domain.js";

const GAME_ID = "canos";
const sessionUser = requireSession("../../index.html");   // sem sessão, volta para o login
if (sessionUser && !gameAllowed(GAME_ID, sessionUser)) location.replace("../../jogos.html");   // jogo desligado pelo administrador
mountUserBar(document.getElementById("userbar"), { base: "../../" });
const ranking = mountRanking({ gameId: GAME_ID, title: "Conexão de Canos" });
const uid = sessionUser?.id ?? "guest";
const coinsEl = document.getElementById("coinBadge");

/* Estado da partida (declarado antes de qualquer função que o use).
   phase: "ready" (esperando o 1º giro) · "counting" (contagem regressiva) · "flowing" (água correndo) · "won" · "lost" · "locked" (sem coins). */
let puzzle, rots = [], angles = [], phase = "locked", moves = 0, deadline = 0, total = 0, sim = null, credited = false, clockId = null, flowId = null;

/* Coins: saldo ao lado do nome do jogo e liberação do botão "Nova fase" (só com fase concluída e coin disponível). */
function renderCoins() {
  const balance = Coins.get(uid, GAME_ID), next = document.getElementById("next");
  coinsEl.replaceChildren(coinBadge(balance));
  const canNext = phase === "won" && balance.coins > 0;
  next.disabled = !canNext;
  next.title = canNext ? "" : phase !== "won" ? "Conclua a fase atual para liberar a próxima." : `Sem coins por agora: novos em ${fmtDuration(balance.nextRefillAt - Date.now())}.`;
}
setInterval(renderCoins, 30000);   // a recarga de 24 h pode chegar com a página aberta
document.querySelector(".help")?.append(` ${pointsLegend()}`);   // pontuação junto da explicação do jogo

/* ===================== UI ===================== */
const svg = document.getElementById("board"), msg = document.getElementById("msg"), timerEl = document.getElementById("timer");
const timeBar = document.getElementById("timeBar"), timeFill = document.getElementById("timeFill"), phaseEl = document.getElementById("phase"), retryBtn = document.getElementById("retry");

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

/** Conta a vitória uma única vez por fase. Os pontos são os do nível em que a fase foi gerada. */
function creditWin() {
  if (credited) { renderCoins(); return ""; }          // rejogar a mesma fase não pontua nem gasta coin
  credited = true;
  const before = levelOf(wins), points = pointsFor(puzzle.level);
  wins++; saveWins(wins); renderLevel();
  const spent = Coins.spend(uid, GAME_ID);                                   // o coin só é gasto aqui, ao vencer (falhar não gasta)
  Run.set(uid, GAME_ID, { seed: puzzle.seed, level: puzzle.level, solved: true, gen: GEN });
  let note = "";
  if (Scores.canRank()) {
    Scores.submit(GAME_ID, points).then(() => ranking.refresh());              // só aqui, ao vencer
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
/** Nova fase: a seed fica salva, então recarregar a página devolve o mesmo cenário até ele ser concluído. */
function freshPuzzle() {
  const seed = (Math.random() * 2 ** 32) >>> 0, level = levelOf(wins);
  Run.set(uid, GAME_ID, { seed, level, solved: false, gen: GEN });
  return buildPuzzle(seed, level);
}

/* ----- Desenho do SVG -----
   A grade n x n fica no meio de um quadro (n+2) x (n+2): a margem de uma casa em volta guarda o cano de entrada e o de saída.
   Cada tipo de cano é um <symbol> reutilizado; a água de cada cano é um traço azul cuja opacidade vem da variável CSS --w. */
const C = { out: "#3f7a10", body: "#8fd62c", hi: "#c9f66f", water: "#19a7ea", fl1: "#4a8f12", fl2: "#76bf22" };
const GEOM = {   // traçado de cada tipo com rotação 0 (N-S, N-L, N-L-O, cruz) e os lados abertos
  I: { d: "M50 0V100", ends: [N, S] },
  L: { d: "M50 0V28A22 22 0 0 0 72 50H100", ends: [N, E] },
  T: { d: "M50 0V50M0 50H100", ends: [N, E, W], hub: true },
  X: { d: "M50 0V100M0 50H100", ends: [N, E, S, W], hub: true },
};
const FLANGE = { [N]: "M50 0V10", [E]: "M100 50H90", [S]: "M50 100V90", [W]: "M0 50H10" };
const WATER_STYLE = 'style="opacity:var(--w,0);transition:opacity .3s"';
function symbolSvg(type) {
  const g = GEOM[type], stroke = (d, color, w, extra = "") => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" ${extra}/>`;
  return `<symbol id="p-${type}" viewBox="0 0 100 100"><rect width="100" height="100" fill="none"/>`
    + stroke(g.d, C.out, 40) + stroke(g.d, C.body, 32) + stroke(g.d, C.hi, 8, 'opacity=".55"')
    + (g.hub ? `<circle cx="50" cy="50" r="21" fill="${C.out}"/><circle cx="50" cy="50" r="17" fill="${C.body}"/>` : "")
    + stroke(g.d, C.water, 18, WATER_STYLE) + (g.hub ? `<circle cx="50" cy="50" r="10" fill="${C.water}" ${WATER_STYLE}/>` : "")
    + g.ends.map(s => stroke(FLANGE[s], C.fl1, 44) + stroke(FLANGE[s], C.fl2, 36)).join("")
    + "</symbol>";
}
const useSvg = type => `<use href="#p-${type}" width="100" height="100"/>`;
const at = (n, cell) => [(cell % n + 1) * 100, (Math.floor(cell / n) + 1) * 100];

/** Cano de entrada/saída: uma casa na margem, ao lado da casa de borda, com a "tampa" (azul com seta = entrada; laranja com alvo = saída). */
function stubSvg(n, spot, kind) {
  const [x, y] = at(n, spot.cell), [dr, dc] = DELTA[spot.side], horizontal = spot.side === E || spot.side === W;
  const sx = x + dc * 100, sy = y + dr * 100, rot = horizontal ? 90 : 0;
  const cx = 50 + dc * 28, cy = 50 + dr * 28, ax = -dc, ay = -dr;   // a tampa fica na ponta de fora; a seta da entrada aponta para a grade
  const cap = kind === "in"
    ? `<circle class="cap-in" cx="${cx}" cy="${cy}" r="19"/><path class="cap-sym" d="${arrowPath(cx, cy, ax, ay)}"/>`
    : `<circle class="cap-out" cx="${cx}" cy="${cy}" r="19"/><circle class="cap-sym" cx="${cx}" cy="${cy}" r="8"/>`;
  return `<g class="stub ${kind}" data-kind="${kind}" transform="translate(${sx} ${sy})"><circle class="halo" cx="${cx}" cy="${cy}" r="46"/><g class="pipe" style="transform:rotate(${rot}deg)">${useSvg("I")}</g>${cap}</g>`;
}
/** Seta de (cx, cy) apontando para (dx, dy) (vetor unitário), no tamanho da tampa. */
function arrowPath(cx, cy, dx, dy) {
  const tx = cx + dx * 9, ty = cy + dy * 9, bx = cx - dx * 9, by = cy - dy * 9, px = -dy, py = dx;
  return `M${bx} ${by}L${tx} ${ty}M${tx - dx * 8 + px * 7} ${ty - dy * 8 + py * 7}L${tx} ${ty}L${tx - dx * 8 - px * 7} ${ty - dy * 8 - py * 7}`;
}
let tileEls = [], pipeEls = [], outletEl = null;
function buildBoard() {
  const n = puzzle.n, size = (n + 2) * 100;
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  const tiles = puzzle.tiles.map((t, i) => {
    const [x, y] = at(n, i);
    return `<g class="tile" data-i="${i}" transform="translate(${x} ${y})"><rect class="bg" x="3" y="3" width="94" height="94" rx="8"/><rect class="bg2" x="10" y="10" width="80" height="80" rx="5"/>`
      + `<g class="pipe" style="transform:rotate(${angles[i]}deg)">${useSvg(t.type)}</g></g>`;
  }).join("");
  svg.innerHTML = `<defs>${["I", "L", "T", "X"].map(symbolSvg).join("")}</defs>${tiles}${stubSvg(n, puzzle.inlet, "in")}${stubSvg(n, puzzle.outlet, "out")}`;
  tileEls = [...svg.querySelectorAll(".tile")];
  pipeEls = tileEls.map(el => el.querySelector(".pipe"));
  outletEl = svg.querySelector(".stub.out");
}
/** Aplica os ângulos sem a animação de giro (ao abrir/reiniciar a fase). */
function applyAngles() {
  svg.classList.add("instant");
  pipeEls.forEach((el, i) => (el.style.transform = `rotate(${angles[i]}deg)`));
  svg.getBoundingClientRect();
  svg.classList.remove("instant");
}
/** Marca um vazamento: um ponto vermelho na ponta de cano que ficou sem ligação. */
function showLeak(l) {
  const n = puzzle.n, [x, y] = at(n, l.cell), [px, py] = [[50, 0], [100, 50], [50, 100], [0, 50]][l.side];
  svg.insertAdjacentHTML("beforeend", `<g class="leak" transform="translate(${x + px} ${y + py})"><circle class="ring" r="34"/><circle class="dot" r="21"/><path class="x" d="M-8-8L8 8M8-8L-8 8"/></g>`);
}

/* ----- Relógio e fases do jogo ----- */
const fmtClock = ms => { const s = Math.ceil(ms / 1000); return `${String((s / 60) | 0).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
function renderClock(left) {
  timerEl.textContent = fmtClock(left);
  const low = phase === "counting" && left <= 10000;
  timerEl.classList.toggle("low", low);
  timeBar.classList.toggle("low", low);
  timeFill.style.width = (total ? Math.max(0, left / total) * 100 : 100) + "%";
}
function setMessage(text, isError = false) { msg.textContent = text; msg.classList.toggle("err", isError); }
function renderPhase() {
  const text = {
    ready: `Gire um cano para começar: a contagem regressiva (${fmtClock(total)}) só inicia no primeiro giro.`,
    counting: `Ligue a entrada à saída antes que o tempo acabe. Giros: ${moves}.`,
    flowing: "A água está correndo…",
    won: "Fase concluída!",
    lost: "A água vazou. Tente o mesmo cenário de novo.",
    locked: "Sem coins por agora.",
  }[phase];
  phaseEl.textContent = text;
  svg.classList.toggle("busy", phase === "flowing" || phase === "won" || phase === "lost");
  svg.classList.toggle("locked", phase === "locked");
  retryBtn.disabled = phase === "flowing" || phase === "won" || phase === "locked"      // concluído, água correndo ou travado: não reinicia
    || ((phase === "ready" || phase === "counting") && moves === 0 && !svg.querySelector(".wet"));   // nada para desfazer
  retryBtn.textContent = phase === "lost" ? "Tentar de novo" : "Reiniciar";
  retryBtn.title = phase === "won" ? "Reiniciar só está disponível enquanto a fase não é concluída." : "";
  renderCoins();
}
function stopTimers() { clearInterval(clockId); clearTimeout(flowId); clockId = flowId = null; }

/** Devolve os canos aos giros do começo SEM tocar no relógio: é o que o Reiniciar faz com a contagem em andamento. */
function restoreRots() {
  rots = initialRots(puzzle); angles = rots.map(r => r * 90); moves = 0;
  applyAngles();
}
/** Volta o cenário ao começo (os mesmos giros do início), sem gastar nada: falhar não custa coin. Zera o relógio: só vale para uma tentativa nova (ao abrir a fase ou depois de vazar). */
function reset() {
  stopTimers();
  rots = initialRots(puzzle); angles = rots.map(r => r * 90); moves = 0; sim = null;
  total = LEVELS[puzzle.level].seconds * 1000;
  tileEls.forEach(el => el.classList.remove("wet"));
  svg.querySelectorAll(".leak").forEach(el => el.remove());
  outletEl.classList.remove("wet");
  svg.classList.remove("won", "lost");
  applyAngles();
  phase = "ready"; setMessage(""); renderClock(total); renderPhase();
}
function loadPuzzle(p) {
  if (p !== puzzle) credited = false;
  puzzle = p; rots = initialRots(p); angles = rots.map(r => r * 90);
  buildBoard();
  reset();
}

/* ----- Jogo: girar, contar o tempo, deixar a água correr ----- */
function startCountdown() {
  phase = "counting"; deadline = Date.now() + total;
  if (sessionUser) Activity.played(sessionUser.id, GAME_ID);   // alimenta "último jogo" no perfil
  clockId = setInterval(() => { const left = Math.max(0, deadline - Date.now()); renderClock(left); if (left <= 0) startFlow(); }, 100);
}
/** Gira a casa i (dir 1 = horário, -1 = anti-horário). O primeiro giro dispara a contagem; depois que a água corre, nada mais gira. */
function rotate(i, dir) {
  if (phase === "ready") startCountdown();
  if (phase !== "counting") return;
  rots = rotateTile(rots, i, dir); angles[i] += dir * 90; moves++;
  pipeEls[i].style.transform = `rotate(${angles[i]}deg)`;
  renderPhase();
}
/** O tempo acabou: a água entra e avança uma casa por onda, por todos os ramos. Vence quem chega à saída antes de vazar. */
function startFlow() {
  clearInterval(clockId); clockId = null;
  phase = "flowing"; renderClock(0); setMessage(""); renderPhase();
  sim = simulate(puzzle, rots);
  const byDepth = new Map();
  for (const f of sim.fills) if (f.depth <= sim.endDepth) byDepth.set(f.depth, [...(byDepth.get(f.depth) ?? []), f.cell]);
  const tick = Math.round(Math.min(420, Math.max(90, 9000 / (sim.endDepth + 2))));   // a animação inteira dura ~9 s, no máximo
  let wave = 0;
  const step = () => {
    for (const c of byDepth.get(wave) ?? []) tileEls[c].classList.add("wet");
    if (sim.status === "win" && wave === sim.outletDepth) outletEl.classList.add("wet");
    if (wave >= sim.endDepth) { flowId = setTimeout(finish, 500); return; }
    wave++; flowId = setTimeout(step, tick);
  };
  flowId = setTimeout(step, 350);
}
function finish() {
  if (sim.status === "win") {
    phase = "won"; svg.classList.add("won");
    setMessage("A água chegou à saída!" + creditWin());
  } else {
    phase = "lost"; svg.classList.add("lost");
    firstLeaks(sim).forEach(showLeak);
    const leak = sim.leaks.find(l => l.depth === sim.endDepth);
    setMessage(sim.status === "blocked" ? "A água não conseguiu entrar: o cano da entrada não está virado para ela."
      : sim.status === "stuck" ? "A água ficou presa num circuito fechado e não chegou à saída."
      : `Vazou! A água escapou na linha ${Math.floor(leak.cell / puzzle.n) + 1}, coluna ${(leak.cell % puzzle.n) + 1}.`, true);
  }
  renderPhase();
}

/* ----- Entrada: clique/toque na casa. Botão direito (ou Shift + clique) gira para o outro lado. ----- */
svg.addEventListener("pointerdown", e => {
  if (e.pointerType === "mouse" && e.button > 2) return;
  const r = svg.getBoundingClientRect(), n = puzzle.n;
  const col = Math.floor(((e.clientX - r.left) / r.width) * (n + 2)) - 1, row = Math.floor(((e.clientY - r.top) / r.height) * (n + 2)) - 1;
  if (row < 0 || col < 0 || row >= n || col >= n) return;
  rotate(row * n + col, e.pointerType === "mouse" && (e.button === 2 || e.shiftKey) ? -1 : 1);
});
svg.addEventListener("contextmenu", e => e.preventDefault());
retryBtn.onclick = () => {
  if (phase === "counting") { restoreRots(); renderPhase(); }   // contagem em andamento: os giros voltam ao começo, o tempo segue correndo
  else if (phase === "ready" || phase === "lost") reset();      // tentativa nova (a água já correu, ou ainda nem começou): relógio cheio, volta a contar no 1º giro
};   // "won", "flowing" e "locked": não reinicia
document.getElementById("next").onclick = () => { if (phase === "won" && Coins.get(uid, GAME_ID).coins > 0) loadPuzzle(freshPuzzle()); };

/** Fase já concluída (ao recarregar a página): mostra a solução com a água correndo e não pontua de novo. */
function restoreSolved() {
  credited = true;
  rots = solutionRots(puzzle); angles = rots.map(r => r * 90); applyAngles();
  puzzle.path.forEach(c => tileEls[c].classList.add("wet"));
  outletEl.classList.add("wet"); svg.classList.add("won");
  phase = "won"; renderClock(total); renderPhase();
  setMessage("Fase já concluída. Use “Nova fase” para continuar.");
}
/** Sem coins e sem fase salva: o cenário aparece, mas travado até a recarga. */
function lockBoard() {
  credited = true; phase = "locked"; renderPhase();
  setMessage(`Sem coins por agora: novos em ${fmtDuration(Coins.get(uid, GAME_ID).nextRefillAt - Date.now())}.`);
}

/* Fase inicial: volta a fase salva (mesma seed); sem fase salva, sorteia uma no nível atual se houver coin. */
renderLevel();
const saved = Run.get(uid, GAME_ID);
if (saved) {
  loadPuzzle(buildPuzzle(saved.seed, saved.level));
  if (saved.solved) restoreSolved(); else if (saved.gen !== GEN) Run.set(uid, GAME_ID, { seed: saved.seed, level: saved.level, solved: false, gen: GEN });
}
else if (Coins.get(uid, GAME_ID).coins > 0) loadPuzzle(freshPuzzle());
else { loadPuzzle(buildPuzzle((Math.random() * 2 ** 32) >>> 0, levelOf(wins))); lockBoard(); }
