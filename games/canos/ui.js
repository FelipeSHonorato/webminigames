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
import { BIT, DELTA, E, GEN, LEVELS, N, S, STORE_KEY, W, firstLeaks, generatePuzzle, initialRots, maskOf, opposite, rotateTile, simulate, solutionRots } from "./domain.js";
import { fmtTime } from "../../shared/ranking-list.js";

const GAME_ID = "canos";
const sessionUser = requireSession("../../index.html");   // sem sessão, volta para o login
if (sessionUser && !gameAllowed(GAME_ID, sessionUser)) location.replace("../../jogos.html");   // jogo desligado pelo administrador
mountUserBar(document.getElementById("userbar"), { base: "../../" });
const uid = sessionUser?.id ?? "guest";
const isCloud = Cloud.owns(uid);                          // o desafio diário só existe na nuvem (a seed é do servidor)
const ranking = mountRanking({ gameId: GAME_ID, title: "Conexão de Canos", modes: isCloud ? ["daily", "points"] : ["points"] });
const coinsEl = document.getElementById("coinBadge");
/* Na nuvem o jogo é SÓ o desafio do dia (a fase aleatória deixou de existir); no modo local/visitante continua aleatória. */
const mode = isCloud ? "daily" : "random";

/* Estado da partida (declarado antes de qualquer função que o use).
   phase: "ready" (esperando o 1º giro) · "counting" (contagem regressiva) · "flowing" (água correndo) · "won" · "lost" · "locked" (sem coins). */
let puzzle, rots = [], angles = [], phase = "locked", moves = 0, deadline = 0, total = 0, sim = null, credited = false, clockId = null, flowId = null;

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
    const canNext = phase === "won" && left != null && (d.coins ?? 0) > 0;
    next.disabled = !canNext;
    next.title = left == null ? "Você já concluiu os cenários do dia." : (d.coins ?? 0) <= 0 ? "Sem coins do dia." : phase === "won" ? "Abrir o próximo cenário." : "Conclua a fase atual para liberar a próxima.";
    return;
  }
  const balance = Coins.get(uid, GAME_ID);
  coinsEl.replaceChildren(coinBadge(balance));
  const canNext = phase === "won" && balance.coins > 0;
  next.disabled = !canNext;
  next.title = canNext ? "" : phase !== "won" ? "Conclua a fase atual para liberar a próxima." : `Sem coins por agora: novos em ${fmtDuration(balance.nextRefillAt - Date.now())}.`;
}
setInterval(renderCoins, 30000);   // a recarga de 24 h pode chegar com a página aberta
document.querySelector(".help")?.append(` ${pointsLegend()}`);   // pontuação junto da explicação do jogo

/* ===================== UI ===================== */
const svg = document.getElementById("board"), msg = document.getElementById("msg"), timerEl = document.getElementById("timer");
const timeBar = document.getElementById("timeBar"), timeFill = document.getElementById("timeFill"), phaseEl = document.getElementById("phase"), retryBtn = document.getElementById("retry"), releaseBtn = document.getElementById("release");

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
  const cloudMode = Cloud.owns(uid);
  const spent = cloudMode ? false : Coins.spend(uid, GAME_ID);               // na nuvem o coin já foi cobrado ao SERVIR a fase (open)
  if (!cloudMode) Run.set(uid, GAME_ID, { seed: puzzle.seed, level: puzzle.level, solved: true, gen: GEN });
  let note = "";
  if (Scores.canRank()) {
    // Na nuvem o servidor recebe os giros, regenera a partir da seed e só pontua se a água chegar mesmo à saída.
    Scores.submit(GAME_ID, points, { state: { rots } }).then(() => ranking.refresh());
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
/** Fase servida pelo servidor: chega SEM a solução (a seed fica no servidor), então a tela não sabe os giros certos. */
const serverPuzzle = (view, level) => ({ n: view.n, tiles: view.tiles, inlet: view.inlet, outlet: view.outlet, level, server: true });
/** Fase nova no modo local: a seed fica salva, então recarregar a página devolve o mesmo cenário até ele ser concluído. */
function localFresh() {
  const seed = (Math.random() * 2 ** 32) >>> 0, level = levelOf(wins);
  Run.set(uid, GAME_ID, { seed, level, solved: false, gen: GEN });
  return buildPuzzle(seed, level);
}
/** Fase nova: na nuvem quem serve é o servidor (open cobra o coin e guarda a seed); local sorteia. */
const freshPuzzle = () => (Cloud.owns(uid) ? Cloud.open(GAME_ID).then(d => serverPuzzle(d.puzzle, d.level)) : Promise.resolve(localFresh()));

/* ----- Desenho do SVG -----
   A grade n x n fica no meio de um quadro (n+2) x (n+2): a margem de uma casa em volta guarda o cano de entrada e o de saída.
   Cada tipo de cano é um <symbol> reutilizado; a água de cada cano é um traço azul cuja opacidade vem da variável CSS --w. */
const C = { out: "#3f7a10", body: "#8fd62c", hi: "#c9f66f", water: "#19a7ea", fl1: "#4a8f12", fl2: "#76bf22" };
const GEOM = {   // traçado de cada tipo com rotação 0 (N-S, N-L, N-L-O, cruz) e os lados abertos
  I: { d: "M50 0V100", wd: ["M50 0V100", "M50 100V0"], ends: [N, S] },
  L: { d: "M50 0V28A22 22 0 0 0 72 50H100", wd: ["M50 0V28A22 22 0 0 0 72 50H100", "M100 50H72A22 22 0 0 1 50 28V0"], ends: [N, E] },
  T: { d: "M50 0V50M0 50H100", ends: [N, E, W], hub: true },
  X: { d: "M50 0V100M0 50H100", ends: [N, E, S, W], hub: true },
};
const FLANGE = { [N]: "M50 0V10", [E]: "M100 50H90", [S]: "M50 100V90", [W]: "M0 50H10" };
/* A água é um traço por cima do cano. No reto e na curva ela CORRE: o traço começa escondido (`--f:100px`) e vai aparecendo da entrada
   para a saída (`--f:0`), via `stroke-dashoffset`. Por isso cada tipo tem uma variante normal e uma reversa (`-r`), escolhida conforme o
   lado por onde a água entra. No T e na cruz (que espalham a água) ela aparece como um todo, por opacidade (`--w`). */
const WATER_FADE = 'style="opacity:var(--w,0)"';
const WATER_FLOW = 'pathLength="100" stroke-dasharray="100" style="stroke-dashoffset:var(--f,100px)"';
const SYMBOLS = ["I", "I-r", "L", "L-r", "T", "X"];
function symbolSvg(id) {
  const [type, rev] = id.split("-"), g = GEOM[type];
  const stroke = (d, color, w, extra = "") => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" ${extra}/>`;
  const water = g.hub ? WATER_FADE : WATER_FLOW, wd = g.hub ? g.d : g.wd[rev ? 1 : 0];
  return `<symbol id="p-${id}" viewBox="0 0 100 100"><rect width="100" height="100" fill="none"/>`
    + stroke(g.d, C.out, 40) + stroke(g.d, C.body, 32) + stroke(g.d, C.hi, 8, 'opacity=".55"')
    + (g.hub ? `<circle cx="50" cy="50" r="21" fill="${C.out}"/><circle cx="50" cy="50" r="17" fill="${C.body}"/>` : "")
    + stroke(wd, C.water, 18, water) + (g.hub ? `<circle cx="50" cy="50" r="10" fill="${C.water}" ${WATER_FADE}/>` : "")
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
  svg.innerHTML = `<defs>${SYMBOLS.map(symbolSvg).join("")}</defs>${tiles}${stubSvg(n, puzzle.inlet, "in")}${stubSvg(n, puzzle.outlet, "out")}`;
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
  releaseBtn.disabled = phase !== "counting";   // só faz sentido com a contagem em andamento; a água corre na hora e o relógio zera
  releaseBtn.title = phase === "ready" ? "Gire um cano para começar a contagem."
    : phase === "counting" ? "Faz a água correr agora e zera a contagem, sem esperar o tempo acabar." : "";
  renderCoins();
}
function stopTimers() { clearInterval(clockId); cancelAnimationFrame(flowId); clearTimeout(flowId); clockId = flowId = null; }

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
  clearWater();
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
/* ----- A água corre numa frente única e contínua (requestAnimationFrame): a frente anda 1 casa a cada `cellMs` e cada casa leva
   FILL casas-de-frente para encher, então as casas se sobrepõem e o movimento fica fluido, sem os "pulos" de uma onda por timeout. */
const FILL = 1.2;
/** Água de uma casa: no reto/curva revela o traço (`--f`), no T/cruz usa a opacidade (`--w`). `p` vai de 0 (seco) a 1 (cheio). */
function paintWater(cell, p) {
  const el = pipeEls[cell], t = puzzle.tiles[cell].type;
  if (t === "I" || t === "L") { el.style.setProperty("--w", "1"); el.style.setProperty("--f", `${(100 * (1 - p)).toFixed(2)}px`); }
  else el.style.setProperty("--w", p.toFixed(3));
  if (p > 0) tileEls[cell].classList.add("wet");
}
/** Limpa a água e devolve cada cano à variante normal (ao reiniciar ou abrir a fase). */
function clearWater() {
  tileEls.forEach((el, i) => {
    el.classList.remove("wet");
    pipeEls[i].style.removeProperty("--w"); pipeEls[i].style.removeProperty("--f");
    pipeEls[i].querySelector("use")?.setAttribute("href", `#p-${puzzle.tiles[i].type}`);
  });
}
/** Aponta o cano para a variante (normal/reversa) que faz o traço da água nascer do lado por onde ela entra. */
function orientWater(cell, entrySide) {
  const t = puzzle.tiles[cell].type;
  if ((t !== "I" && t !== "L") || entrySide < 0) return;
  const local = (((entrySide - rots[cell]) % 4) + 4) % 4;
  const rev = t === "I" ? local === S : local !== N;
  pipeEls[cell].querySelector("use")?.setAttribute("href", `#p-${t}${rev ? "-r" : ""}`);
}
/** Lado (global) por onde a água entra em cada casa: a entrada, pela borda; nas outras, o lado voltado para a casa uma onda antes. */
function entrySides(wet) {
  const depthOf = new Map(sim.fills.map(f => [f.cell, f.depth])), sides = new Map(), { n, inlet } = puzzle;
  for (const f of wet) {
    if (f.cell === inlet.cell) { sides.set(f.cell, inlet.side); continue; }
    const r = Math.floor(f.cell / n), c = f.cell % n, m = maskOf(puzzle.tiles[f.cell].type, rots[f.cell]);
    let side = -1;
    for (const s of [N, E, S, W]) {
      if (!(m & BIT[s])) continue;
      const nr = r + DELTA[s][0], nc = c + DELTA[s][1];
      if (nr < 0 || nc < 0 || nr >= n || nc >= n) continue;
      const nb = nr * n + nc;
      if (depthOf.get(nb) === f.depth - 1 && (maskOf(puzzle.tiles[nb].type, rots[nb]) & BIT[opposite(s)])) { side = s; break; }
    }
    sides.set(f.cell, side);
  }
  return sides;
}
/** O tempo acabou (ou o jogador soltou a água): a água entra e corre por todos os ramos. Vence quem chega à saída antes de vazar. */
function startFlow() {
  clearInterval(clockId); clockId = null; cancelAnimationFrame(flowId); flowId = null;
  phase = "flowing"; renderClock(0); setMessage(""); renderPhase();
  sim = simulate(puzzle, rots);
  const wet = sim.fills.filter(f => f.depth <= sim.endDepth), entry = entrySides(wet);
  for (const f of wet) orientWater(f.cell, entry.get(f.cell));
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {   // sem animação: a água aparece cheia de uma vez
    for (const f of wet) paintWater(f.cell, 1);
    if (sim.status === "win") outletEl.classList.add("wet");
    finish(); return;
  }
  const total = Math.max(3500, Math.min(11000, wet.length * 240));   // a animação inteira dura de ~3,5 a ~11 s
  const cellMs = total / (sim.endDepth + FILL), t0 = performance.now();
  const frame = now => {
    if (phase !== "flowing") return;
    const front = (now - t0) / cellMs;
    for (const f of wet) paintWater(f.cell, Math.max(0, Math.min(1, (front - f.depth) / FILL)));
    if (sim.status === "win" && front >= sim.outletDepth + FILL) outletEl.classList.add("wet");
    if (front >= sim.endDepth + FILL) { finish(); return; }
    flowId = requestAnimationFrame(frame);
  };
  flowId = requestAnimationFrame(frame);
}
/** Solta a água na hora, sem esperar a contagem: zera o relógio e começa o fluxo. Só vale durante a contagem. */
function releaseWater() {
  if (phase !== "counting") return;
  startFlow();
}
function finish() {
  if (sim.status === "win") {
    phase = "won"; svg.classList.add("won");
    if (mode === "daily") { setMessage("A água chegou à saída! Registrando…"); finishDaily(); }   // o SERVIDOR mede o tempo e pontua
    else setMessage("A água chegou à saída!" + creditWin());
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
releaseBtn.onclick = releaseWater;
retryBtn.onclick = () => {
  if (phase === "counting") { restoreRots(); renderPhase(); }   // contagem em andamento: os giros voltam ao começo, o tempo segue correndo
  else if (phase === "ready" || phase === "lost") reset();      // tentativa nova (a água já correu, ou ainda nem começou): relógio cheio, volta a contar no 1º giro
};   // "won", "flowing" e "locked": não reinicia
document.getElementById("next").onclick = async () => {
  if (mode === "daily") {                              // desafio do dia: avança para o próximo cenário (sem escolher)
    const left = nextScenario();
    if (phase !== "won" || left == null || (Cloud.daily(GAME_ID)?.coins ?? 0) <= 0) return;
    return openDaily(left);
  }
  if (phase !== "won" || Coins.get(uid, GAME_ID).coins <= 0) return;
  try { loadPuzzle(await freshPuzzle()); }
  catch (e) { setMessage(e?.code === "no_coins" ? "Sem coins por agora." : "Não foi possível abrir a fase. Tente de novo.", true); }
};

/** Fase já concluída (ao recarregar a página): mostra a solução com a água correndo e não pontua de novo. */
function restoreSolved() {
  credited = true;
  rots = solutionRots(puzzle); angles = rots.map(r => r * 90); applyAngles();
  puzzle.path.forEach(c => paintWater(c, 1));
  outletEl.classList.add("wet"); svg.classList.add("won");
  phase = "won"; renderClock(total); renderPhase();
  setMessage("Fase já concluída. Use “Nova fase” para continuar.");
}
/** Sem coins e sem fase salva: o cenário aparece, mas travado até a recarga. */
function lockBoard() {
  credited = true; phase = "locked"; renderPhase();
  setMessage(`Sem coins por agora: novos em ${fmtDuration(Coins.get(uid, GAME_ID).nextRefillAt - Date.now())}.`);
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
    const playing = !done && slot === dailySlot && phase !== "won";
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
    setMessage(`Desafio do dia · ${LEVELS[d.level].name}. Ligue a entrada à saída!`);
    renderDaily(); renderCoins();
  } catch (e) {
    setMessage(e?.code === "no_coins" ? "Sem coins do dia: voltam à meia-noite (Brasília)." : "Não foi possível abrir o desafio. Tente de novo.", true);
  }
}

/** Conclui o tabuleiro do dia: o SERVIDOR mede o tempo (relógio de parede) e guarda o melhor por slot. */
function finishDaily() {
  Cloud.dailyFinish(GAME_ID, dailySlot, { rots })
    .then(r => {
      setMessage(r.ok
        ? `Tempo do dia: ${fmtTime(r.ok.seconds)}.` + (r.ok.best != null && r.ok.best < r.ok.seconds ? ` Melhor do dia: ${fmtTime(r.ok.best)}.` : "")
        : "Tempo enviado; será confirmado quando a conexão voltar.");
      wins = loadWins(); renderLevel();                  // concluir o cenário do dia também sobe a progressão (pontos)
      renderDaily(); renderCoins(); ranking.refresh();
    })
    .catch(() => setMessage("A água chegou à saída, mas não deu para registrar o tempo. Tente de novo.", true));
}

/** Cenário neutro enquanto o desafio do dia é servido pelo servidor (travado e sem contar o tempo do jogo). */
function dailyPlaceholder() {
  loadPuzzle(lockedPuzzle());
  credited = true; phase = "locked"; renderPhase();
  phaseEl.textContent = "Preparando o cenário do dia…";
  renderDaily();
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
    if (slot == null) { credited = true; phase = "locked"; renderPhase(); phaseEl.textContent = "Você já concluiu os cenários do dia. Novos à meia-noite (Brasília)."; renderCoins(); }
    else if ((Cloud.daily(GAME_ID)?.coins ?? 0) <= 0) { credited = true; phase = "locked"; renderPhase(); phaseEl.textContent = "Sem coins do dia: voltam à meia-noite (Brasília)."; renderCoins(); }
    else openDaily(slot);                                             // abre sozinho o próximo cenário do dia (gasta 1 coin)
  });
} else {
  const saved = Run.get(uid, GAME_ID);
  if (saved) {
    loadPuzzle(buildPuzzle(saved.seed, saved.level));
    if (saved.solved) restoreSolved(); else if (saved.gen !== GEN) Run.set(uid, GAME_ID, { seed: saved.seed, level: saved.level, solved: false, gen: GEN });
  }
  else if (Coins.get(uid, GAME_ID).coins > 0) loadPuzzle(localFresh());
  else { loadPuzzle(lockedPuzzle()); lockBoard(); }
}
