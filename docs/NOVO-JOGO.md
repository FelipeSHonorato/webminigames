# Integrando um jogo novo

Guia de integração do WebMiniGames, escrito a partir da dissecação ponta a ponta do **Conexão de Canos**
(`games/canos/`) — o jogo mais completo do repositório e o melhor modelo arquitetural.

**Leia este arquivo antes de criar um jogo.** Ele responde: o que o jogo novo precisa ter, onde cada peça
entra, quais regras de desafio diário/tickets ele herda de graça, e o que quebra o build quando você esquece
uma ponta.

Complementa o [README](../README.md) (visão do produto) e o [CONTINUAR](CONTINUAR.md) (estado e decisões).

---

## 1. Como um jogo existe hoje: três camadas

```
   jogos.html          js/games.js          games/<id>/              Supabase
   (cards do hub) ───▶ (catálogo) ────────▶ domain.js  (puro)  ───▶ games        (catálogo)
                                           ui.js      (DOM)         Edge play    (serve + valida)
   landing, perfil,                        index.html               _shared/board.js
   admin também leem                       style.css                _shared/<id>/domain.js
   o catálogo                                                       (CÓPIA IDÊNTICA)
```

O ponto que sustenta tudo: **`domain.js` é o mesmo código no navegador e no servidor**. A Edge Function
regenera a fase a partir da seed secreta usando a cópia em `_shared/`, e compara com o tabuleiro que o
cliente enviou. Por isso o domínio precisa ser **puro e determinístico**.

---

## 2. O que o jogo novo herda sem escrever código

Basta o jogo existir em `public.games` (SQL) e em `_shared/board.js`, e ele entra automaticamente no ciclo
desafio diário → tickets → troféus → ranking.

### 2.1 Dia e seed

| Item | Regra | Onde |
|---|---|---|
| Dia | `daily_day()` = `(now() at time zone 'America/Sao_Paulo')::date` | desafio_diario |
| Virada | meia-noite de Brasília, **sem cron** (a concessão acontece na próxima chamada) | `daily_grant` |
| Seed | `daily_seed(day, game, level, slot)` = `hashtextextended` da string `dia` + `jogo` + `nível` + `slot` separados por barra vertical, truncado em 32 bits (`& 4294967295`) | desafio_diario |
| Segredo | a seed **nunca** chega ao navegador; só o `public_view` | Edge `play` |
| Determinismo | mesma seed ⇒ mesmo tabuleiro, mesmo depois de um deploy | `generatePuzzle(rng, level)` |

### 2.2 Tickets

- **1 ticket = 1 cenário.** Um ticket guarda `(user, day, game, slot, level, seed)`, com **nível e seed
  congelados na concessão** — jogar um cenário atrasado não recalcula o nível.
- Quantidade por dia: `coins_cap()` = `settings.coins_per_day` (padrão **2**, faixa **1–10**,
  `max_scenarios()` = 10). É **global** e configurável no painel do administrador.
- Acúmulo: até **30 dias** (`daily_backlog_days()`), contando a partir de `daily_backlog_start()`
  (hoje `2026-10-20`). A fila mais velha que o corte é descartada, junto com tentativas abertas expiradas.
- Concessão idempotente: `daily_grant()` preenche todos os dias pulados desde
  `greatest(created_at, backlog_start, hoje − 29)`.
- Fila: `daily_status()` devolve `pending` (tickets) + `open` (tentativas abertas); o cliente ordena os
  dois por `(day, slot)` — **FIFO entre todos os dias**, sem escolher cenário.
- Conta administradora: 99999 tickets e não entra em ranking algum.

### 2.3 Abrir, jogar, concluir

| Etapa | O que acontece no servidor |
|---|---|
| `daily_open` | consome o ticket, cria `daily_runs` com `started_at = now()`; se já havia tentativa para o mesmo `(day, slot)`, **retoma o relógio** (`resumed: true`) |
| cenário | `daily_scenarios (day, game, level, slot)` é snapshot **imutável**: `public_view` + `full_puzzle`; a Edge pré-gera o dia inteiro em segundo plano e o cron `daily_generate` faz o mesmo à meia-noite |
| dicas | `daily_hint` só conta; **+30 s por dica** (`daily_hint_seconds()`), a Edge decide *qual* dica |
| `daily_finish` | `seconds = now() − started_at + 30 × hints`; guarda o **melhor** por `(day, slot)`; o resultado pertence ao **dia original** |
| pontos | só na **primeira** conclusão do slot: `daily_points(level, hints)` = base do nível − dicas (piso 1) + 1 vitória |
| troféus | `daily_scenario_stats`: percentual, média, posição na região e pódio dos 3 melhores — sempre do **mesmo cenário** (dia/jogo/nível/slot). O ranking é **vitória → palavras achadas → tempo** (`daily_results.won`/`words`); jogos sem contagem de palavras gravam 0 e continuam ordenados só pelo tempo |
| ranking do site | continua **por pontos** (`ranking`); `daily_leaderboard` existe mas não é exibido |

**Perder não custa ticket novo:** a tentativa aberta continua em `daily_runs`, então o "Tentar de novo" é
apenas um reset local que retoma o mesmo cenário e o mesmo relógio.

### 2.4 Modo local (sem Supabase)

Sem nuvem, nada disso existe: `shared/backend/config.js` vazio ⇒ `Cloud.active === false`. Vale o modo
antigo, com `localStorage`:

- coins `2` por jogo a cada 24 h (`shared/coins.js`), gastos **só ao concluir** a fase;
- fase salva por seed em `shared/run.js` (`{ seed, level, solved, gen }`): recarregar devolve a mesma fase;
- a UI decide a vitória (não há servidor validando).

A `ui.js` **precisa dos dois caminhos**. O padrão é `const mode = isCloud ? "daily" : "random"`.

### 2.5 Duelos 1×1 (só para jogos novos do modo)

Duelo **não** é um modo que se liga em jogo existente: a decisão de produto é que só jogos criados para
duelo declaram `DUEL` no domínio. O hub (`jogos.html`) tem a lateral **Todos / Solo / Duelos 1×1**
(`shared/hub-nav.js` + `css/hub-nav.css`): o contador de "Duelos 1×1" vem dos jogos com `duel: true` no
catálogo (`js/games.js`), o card ganha o selo `1×1` no modo Todos e a entrada "Desafiar amigo" só aparece
no modo Duelos — com `Cloud.active` e ao menos um jogo do modo. A Edge só cria sala quando `duelOf(game)`
existe.

Fluxo: o criador abre a sala (`duel_create`) e recebe um código de 6 caracteres; o amigo entra
(`duel_join`); os dois marcam "pronto" (`duel_ready`) e o servidor fixa `starts_at` (~4 s). O puzzle só é
entregue por `duel_start` **depois** de `starts_at`. A cada jogada a UI chama `session.progress(0..1)` e
o oponente vê a barra pelo Realtime (canal privado `duel:<id>`); ao concluir, o jogo manda o tabuleiro em
`session.finish(state)` e a Edge valida com o `domain.js` antes de o Postgres decidir. O polling de
`duel_state` cobre reconexão e a decisão final.

Regras: `first` = quem termina primeiro vence; `words` = mais palavras vence, empate no menor tempo. O
duelo **não** dá pontos, coins nem progressão. Sem dicas. Salas `waiting` expiram em 15 min; o cron
`duel_cleanup` (a cada 5 min) é a rede de segurança para salas abandonadas.

---

## 3. Contrato do `domain.js`

Código puro: sem DOM, sem `fetch`, sem `Date.now()`/`Math.random()` na geração (o aleatório vem do `rng`
recebido), compatível com Deno.

```js
// games/<id>/domain.js
export const LEVELS = [                        // EXATAMENTE 4 (a Edge usa LEVELS.length para pré-gerar o dia)
  { name: "Fácil",   n: 5,  /* ...parâmetros do nível... */ },
  { name: "Médio",   n: 10, /* ... */ },
  { name: "Difícil", n: 15, /* ... */ },
  { name: "Genius",  n: 20, /* ... */ },
];
export const GEN = 1;                          // versão do gerador: AUMENTE ao mudar o sorteio
export const STORE_KEY = "<id>.wins";          // o teste exige key === `${id}.wins`

/** Fase nova. Determinística: mesma seed ⇒ mesma fase (o servidor regenera para validar). */
export function generatePuzzle(rng, level) { /* ... */ }

/** Regras/validação PURAS, usadas pela UI E pela Edge (board.js). */
export function isSolved(puzzle, state) { /* ... */ }
```

Regras de ouro:

1. **Determinismo absoluto.** Toda aleatoriedade sai de `rng()` (de `shared/rng.js`). Um `Math.random()`
   escondido faz cliente e servidor discordarem e toda vitória vira `invalid`.
2. **`GEN` é versionamento.** Mudou o sorteio do gerador ⇒ `GEN++`. As fases locais salvas com `gen` antigo
   são descartadas ao carregar. Cenários diários já materializados **não** mudam (snapshot é imutável).
3. **Solução explícita.** Guarde `solution` no objeto do puzzle para o servidor validar e para a UI mostrar a
   fase concluída ao recarregar. Ela **nunca** entra no `public_view`.
4. **Estado enviado (`state`) pequeno e autoexplicativo:** no Canos é `{ rots: number[] }`; no Fubá das Setas,
   `{ order: number[] }`; no Sudoku, `{ grid: number[] }`. É o que a UI manda e a Edge revalida.

### 3.1 Jogos de duelo: `DUEL`

Além do contrato acima, um jogo criado **para** o duelo declara no `domain.js`:

```js
export const DUEL = {
  rule: "first",                          // "first" | "words"
  maxSeconds: 180,                        // 30..3600 (a Edge limita)
  progressOf: (puzzle, state) => 0.42,    // 0..1; puro e barato (barra do oponente)
};
```

- `rule: "first"` para quebra-cabeças de conclusão única; `"words"` para jogos de contagem (no timeout a
  UI envia o estado parcial e a Edge conta as palavras).
- `progressOf` é chamado pela UI a cada jogada; sem DOM, `Date.now()` ou `Math.random()`.
- O catálogo (`js/games.js`) precisa do mesmo `duel: true`; `tests/edge.test.js` falha se o catálogo e o
  domínio divergirem.
- Não há dicas no duelo: `hasHints` não é consultado e a UI não mostra o botão.

---

## 4. Contrato da `ui.js`

A ordem do topo não é decorativa — o `boot.js` precisa carregar a conta antes de qualquer leitura síncrona.

```js
import "../../shared/backend/boot.js";                    // 1ª LINHA, sempre
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
import { Cloud } from "../../shared/backend/cloud.js";
import { WINS_PER_LEVEL, Progress, pointsFor } from "../../shared/progress.js";
import { nextScenario, nextSpMidnight, renderDailyPanel, spDay } from "../../shared/daily.js";

const GAME_ID = "<id>";
Music.play(GAME_ID);
const sessionUser = requireSession("../../index.html");
if (sessionUser && !gameAllowed(GAME_ID, sessionUser)) location.replace("../../jogos.html");
mountUserBar(document.getElementById("userbar"), { base: "../../" });
const uid = sessionUser?.id ?? "guest";
const isCloud = Cloud.owns(uid);
const ranking = mountRanking({ gameId: GAME_ID, title: "<Título>" });
const mode = isCloud ? "daily" : "random";
```

### 4.1 Vitória no modo aleatório (local)

```js
function creditWin() {
  if (credited) return "";                        // rejogar a fase concluída não pontua nem gasta coin
  credited = true;
  const before = levelOf(wins), points = pointsFor(puzzle.level);
  wins++; saveWins(wins); renderLevel();
  const spent = Coins.spend(uid, GAME_ID);
  Run.set(uid, GAME_ID, { seed: puzzle.seed, level: puzzle.level, solved: true, gen: GEN });
  if (Scores.canRank()) Scores.submit(GAME_ID, points, { state: /* tabuleiro */ });
  return note;
}
```

### 4.2 Vitória no desafio diário (nuvem)

```js
Cloud.dailyFinish(GAME_ID, ticket.day, ticket.slot, { /* state */ })
  .then(r => { if (r.ok) { /* r.ok.seconds, r.ok.best, troféus */ } else { /* r.pending: foi para a fila */ } })
  .catch(() => setMessage("não deu para registrar o tempo", true));
```

O servidor mede o tempo e valida; o cliente **não** calcula pontos nem nível.

### 4.3 Abertura: diário × aleatório

```js
// nuvem: o servidor serve o próximo ticket da fila (não há escolha)
if (mode === "daily") {
  next.textContent = "Próximo cenário";
  dailyEl.hidden = false;
  dailyPlaceholder();                            // tabuleiro neutro/travado enquanto a Edge responde
  Cloud.dailyStatus().then(() => {
    renderDaily(); renderCoins(); ranking.refresh();
    const ticket = nextScenario(GAME_ID);
    ticket ? openDaily(ticket) : /* "já concluiu os cenários de hoje" */;
  });
} else {
  const saved = Run.get(uid, GAME_ID);
  // saved.solved ⇒ restoreSolved(); saved.gen !== GEN ⇒ descartar
  // senão: localFresh() com seed nova (se houver coin) ou lockBoard()
}
```

### 4.4 O que a `ui.js` precisa ter

| Peça | Função |
|---|---|
| `credited` | impede pontuar duas vezes a mesma fase |
| `phase` | `ready` / `playing` / `won` / `lost` / `locked` |
| `renderCoins()` | selo de saldo + habilita `#next` só com fase vencida |
| `renderLevel()` | barra de progressão (`#levelName`, `#levelCount`, `#barFill`) |
| `renderDaily()` | `renderDailyPanel({ el, gameId, info, day, slot, won, onNext })` |
| `tickDaily` | `setInterval(..., 30000)` comparando `spDay()` para pegar a virada da meia-noite |
| `mountLevelHelp(...)` | `?` ao lado de `#levelName`: explica as dificuldades, os pontos e os níveis (seção 5.1) |
| `Activity.played(...)` | alimenta "último jogo" no perfil (uma vez por partida) |
| `ranking.refresh()` | depois de pontuar/concluir |

`phase === "won"` desabilita "Reiniciar"; `#next` só abre com a fase concluída (e, no local, com coin).

### 4.5 Se o `public_view` não permitir saber a vitória

A UI só conhece a visão pública. Se o jogo **não** conseguir decidir sozinho que venceu (caso das Cruzadas,
onde o servidor não revela as letras), use o caminho síncrono: `Cloud.finishNow(game, { state })`, que devolve
`{ ok }`, `{ pending: true }` ou lança `invalid`/`no_phase`, em vez de `Scores.submit`/`Cloud.dailyFinish`
otimistas. No Canos não é preciso: `simulate(puzzle, rots)` só depende de `tiles + rots`.

---

## 5. Contrato do `index.html`

```html
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title><Título></title>
  <link rel="icon" href="../../assets/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="../../assets/email-logo.png" type="image/png" sizes="96x96">
  <link rel="apple-touch-icon" href="../../assets/email-logo.png">
  <script src="../../shared/theme-init.js"></script>   <!-- antes da 1ª pintura: sem piscar no tema errado -->
  <link rel="stylesheet" href="style.css">
  <link rel="stylesheet" href="../../css/gamebar.css">
  <link rel="stylesheet" href="../../css/ranking-list.css">
  <link rel="stylesheet" href="../../css/ranking.css">
  <link rel="stylesheet" href="../../css/userbar.css">
  <link rel="stylesheet" href="../../css/coins.css">
  <link rel="stylesheet" href="../../css/daily.css">
  <link rel="stylesheet" href="../../css/tutorial.css">
  <link rel="stylesheet" href="tutorial.css">   <!-- só se o jogo tiver tutorial -->
</head>
<body>
<nav class="sitebar">
  <a href="../../jogos.html">← Jogos</a>
  <div class="gametitle"><strong><Título></strong><span id="coinBadge"></span></div>
  <div id="userbar"></div>
</nav>
<main>
  <header><div class="head-title"><h1><Título></h1><button id="howto" class="howto" type="button" aria-haspopup="dialog"><span class="howto-icon" aria-hidden="true">?</span><span class="howto-label">Como jogar</span></button></div><span id="timer"></span></header>
  <div id="level"><div class="level-title"><b id="levelName"></b><button id="levelHelp" class="level-help" type="button" aria-haspopup="dialog" aria-label="Como funcionam as dificuldades e os níveis"><span class="howto-icon" aria-hidden="true">?</span></button></div><div class="bar"><i id="barFill"></i></div><span id="levelCount"></span></div>
  <section class="boardwrap">
    <div id="board" role="application" aria-label="…"></div>   <!-- o véu dos troféus ancora AQUI -->
    <div id="msg" role="status"></div>
    <div id="daily" class="daily" hidden></div>                <!-- painel do desafio -->
  </section>
  <aside class="side">
    <div id="phase"></div>
    <div class="actions"><button id="next">Nova fase</button></div>
  </aside>
</main>
<script src="../../shared/file-warning.js"></script>
<script type="module" src="./ui.js"></script>
</body>
```

As duas folhas do tutorial, o botão `#howto` (dentro de `.head-title`, logo após o `<h1>`) e o `#levelHelp` só entram se o jogo tiver tutorial/ajuda de níveis — veja a seção 5.1. Sem eles, o `<header>` pode voltar a ter só o `<h1>` e o `#timer`, e o `#level` só o nome, a barra e a contagem. **Não use** o parágrafo `.help`: as regras ficam no tutorial e a pontuação, na ajuda de níveis.

IDs que o código compartilhado procura (**sem eles a integração quebra silenciosamente**):

| ID | Quem usa | Sem ele |
|---|---|---|
| `#board` | `shared/daily.js` (`boardOf`) | troféus não aparecem no meio do tabuleiro |
| `#daily` | `renderDailyPanel` | o painel do dia não desenha |
| `#next` | `renderCoins` / `openDaily` | não há como avançar de cenário |
| `#coinBadge`, `#userbar` | `coinBadge`, `mountUserBar` | saldo/usuário somem |
| `#levelName`, `#levelCount`, `#barFill` | `renderLevel` | barra de progressão quebrada |
| `#msg` | mensagens | jogador não sabe por que perdeu/errou |

O `style.css` precisa dos tokens de tema usados pelo resto do site — caso contrário o painel de ranking fica
transparente e sem borda:

```css
:root { --bg: …; --fg: …; --muted: …; --accent: …; --cell: …; --grid: …; }
```

`tests/theme.test.js` exige contraste AA de `--accent` com branco e com `--bg` (e `--path` no Zip).

**Jogo largo:** se o tabuleiro passar de ~900px, replique o ajuste de `body.ranking-open` de
`games/canos/style.css`, `sopa` e `cruzadas` (reserva `100vw − 380px`), senão o painel de ranking cobre o jogo.

### 5.1 Tutorial animado e ajuda de níveis (recomendado)

O tutorial é opcional e **não tem abertura automática**: só aparece pelo botão `#howto` ("Como jogar"). Para o
jogo novo, siga o modelo do Zip (o piloto) ou de qualquer um dos outros nove jogos:

1. `games/<id>/tutorial.js` exporta `{ title, steps: [{ title, text, demo }] }`, com 3–5 passos. `demo` é HTML
   inline (SVG ou divs) usando as classes de animação de `css/tutorial.css` (`.fade`, `.pop`, `.draw`, `.rise`,
   `.slide`, `.grow`, `.glow`, `.press`, `.loop`) e o `--d` para escalonar os atrasos. Nada de `<script>` nem de
   URL externa; o teste `tests/tutorial.test.js` recusa os dois.
2. `games/<id>/tutorial.css` traz só o que é daquele jogo (formas, cores e keyframes próprios). Use os tokens do
   jogo (`--fg`, `--cell`, `--grid`/`--line`, `--accent`/`--path`, `--btn`, `--muted`) para funcionar nos dois temas.
3. No `index.html`, carregue `../../css/tutorial.css` e `tutorial.css` e ponha o botão dentro de `.head-title`,
   imediatamente depois do `<h1>` (veja a seção 5) — não no lado do cronômetro.
4. Na `ui.js`: `import { mountTutorial } from "../../shared/tutorial.js";` e
   `import { <ID>_TUTORIAL } from "./tutorial.js";`, depois chame
   `mountTutorial({ trigger: "howto", ...<ID>_TUTORIAL })` uma vez.
5. Para a ajuda de dificuldades, ponha o `?` (`#levelHelp`) ao lado de `#levelName`, dentro de `.level-title`
   (com `min-width:5em` no grupo, a barra não pula ao trocar de nível), importe
   `mountLevelHelp` de `../../shared/level-help.js` e chame
   `mountLevelHelp({ trigger: "levelHelp", getLevel: () => levelOf(wins), details })` **depois** de
   `renderLevel()` (a função usa `wins`). `details` é um array na ordem dos níveis com o que muda em cada um
   (tamanho, tempo, pistas etc.); derive dos `LEVELS` do jogo para não duplicar valores. Com isso, não
   acrescente o parágrafo `.help` nem `pointsLegend()`.
6. A base de cada elemento animado deve ser o **quadro final visível**; a animação só parte de um estado
   escondido. Assim `prefers-reduced-motion` deixa o desenho legível (as animações são desligadas em
   `css/tutorial.css`).
7. Se o jogo tiver um `button{width:100%}` global, não mexa nos botões do tutorial: `css/tutorial.css` já
   fixa `width:auto` em `.howto`, `.level-help`, `.tut-skip` e `.tut-nav button` para eles não esticarem.

O motor (`shared/tutorial.js`) já cuida de `<dialog>`, foco, Esc, clique no fundo, Anterior/Próximo, "Concluir",
bolinhas e setas ←/→. A ajuda de níveis (`shared/level-help.js`) já cuida do `<dialog>`, do destaque do nível
atual e do isolamento do teclado. Não duplique isso no jogo.

---

## 6. Checklist — arquivos NOVOS

| # | Arquivo | Conteúdo |
|---|---|---|
| 1 | `games/<id>/domain.js` | contrato da seção 3 |
| 2 | `games/<id>/ui.js` | contrato da seção 4 |
| 3 | `games/<id>/index.html` | contrato da seção 5 |
| 4 | `games/<id>/style.css` | tokens + layout + responsivo |
| 5 | `supabase/functions/play/_shared/<id>/domain.js` | **cópia idêntica** do item 1 |
| 6 | `supabase/migrations/<timestamp>_jogo_<id>.sql` | registra o jogo (modelo: `20261023000000_jogo_setas.sql`) |
| 7 | `tests/<id>.test.js` | cada nível gera fase solucionável/única; validador aceita a solução e recusa lixo |
| 8 | `assets/thumbs/<id>-light.webp` e `<id>-dark.webp` | captura do tabuleiro (360×360), uma por tema — é o que aparece nos cards da página inicial **e** da lista de jogos |
| 9 | `games/<id>/tutorial.js` | (opcional) passos e mini-demos do "Como jogar" — seção 5.1 |
| 10 | `games/<id>/tutorial.css` | (opcional) estilos e keyframes das demos — seção 5.1 |

Migração mínima:

```sql
insert into public.games (id, title, sort) values ('<id>', '<Título>', 8)
on conflict (id) do update set title = excluded.title, sort = excluded.sort;
```

---

## 7. Checklist — arquivos ALTERADOS

| # | Arquivo | Alteração |
|---|---|---|
| 1 | `js/games.js` | entrada `{ title, key: "<id>.wins", path: "games/<id>/", desc, preview }` — o `preview` (SVG) só aparece se faltar a miniatura |
| 2 | `supabase/migrations/20261014000000_init.sql` | linha no `insert into public.games` (instalações novas) — **o teste compara com `GAMES`** |
| 3 | `supabase/functions/play/_shared/board.js` | `import`, `GAMES`, `GENS` e os switches de `viewOf`, `serialize`, `revive`, `validatePuzzle` |
| 4 | `supabase/functions/play/index.ts` | `GAME_IDS` (linha ~14) |
| 5 | `shared/music.js` | entrada em `MOODS` (sem ela o jogo fica **mudo**) |
| 6 | `tests/edge.test.js` | listas de paridade, de visão pública, casos de snapshot e `Object.keys(GAMES)` |
| 7 | `tests/theme.test.js` | id no laço de contraste |
| 8 | `tests/supabase.test.js` | `migrationNames` (varreduras de RLS/`search_path`) |
| 9 | `README.md` | descrição do jogo na lista e na tabela de estrutura |
| 10 | `docs/CONTINUAR.md` | regras, decisões e sutilezas (é o que a próxima IA lê primeiro) |
| 11 | `jogos.html` + CSS do hub | o grid é `auto-fit, minmax(200px, 1fr)` (3 colunas em telas largas, ao lado da lateral de modos): um jogo novo muda o número de linhas — conferir no navegador |

`js/hub.js`, `js/perfil.js`, `js/admin.js` e `js/landing.js` **já iteram `GAMES`** e não precisam de código
novo — mas entram no teste visual (card, painel do admin, lista do perfil, landing).

---

## 8. O lado do servidor em detalhe

### 8.1 `_shared/board.js` — quatro switches

```js
import * as <id> from "./<id>/domain.js";
export const GAMES = { arrows, canos, cruzadas, patches, sopa, sudoku, zip, <id> };
export const GENS  = { …, <id>: <id>.GEN };

const viewOf = (game, p) => { switch (game) {
  case "<id>": return { /* SOMENTE o que o jogador precisa ver, sem solução */ };
  default: throw new Error("unknown_game");
}};

function serialize(game, p) { /* puzzle COMPLETO (com solução) para o snapshot imutável */ }
function revive(game, s)    { /* reconstruir Map/Set se o domínio usar */ }
export function validatePuzzle(game, p, data) { switch (game) {
  case "<id>": return <id>.isSolved(p, data?.state);   // ou simulação equivalente
  default: return false;
}};
```

Os **duelos** não têm switch novo: `DUELS`/`duelOf(game)` são derivados de `GAMES[game].DUEL`. Ao criar a
sala, a Edge usa `snapshot()` (puzzle completo + visão pública) e, ao finalizar, valida com
`validateSnapshot()` (ou `validatePartial()` na regra `words`) e conta as palavras com `countWords()` antes
de chamar `duel_finish`.

Detalhes que mordem:

- A visão pública é serializada em JSON: `Map` e `Set` viram `{}` — converta para array e reconstrua no
  `revive` (como `arrows` e `zip` fazem).
- `validatePuzzle` recebe o puzzle **completo**: pode usar `p.solution`, mas nunca confie em `data` cru —
  valide tipos e faixas (o Canos usa `ints(arr, n*n, 0, 3)`).
- Só há **um** lugar com as regras de validação, usado pela UI e pela Edge. Duplicar é criar divergência.

### 8.2 `index.ts`

A Edge aceita **todos** os jogos de `_shared/board.js` (`const GAME_IDS = new Set(Object.keys(BOARD_GAMES))`):
não há lista fixa para editar. `generateDayScenarios` percorre esses jogos e usa
`BOARD_GAMES[game].LEVELS.length` — mais um jogo aumenta o custo da pré-geração e do cron.

### 8.3 Deploy

Sempre que um jogo novo entra, **faça o deploy da Edge** junto com as migrações. Um deploy antigo não
conhece o jogo, responde `unknown_game` e o desafio diário dele não abre — mesmo com banco e cliente
atualizados (foi o que aconteceu com Queens, Tango e Text Twist).

```bash
supabase db push                 # ou rodar as migrações em ordem no SQL Editor
supabase functions deploy play
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...   # + DAILY_CRON_KEY para o cron
```

Se o jogo for de **duelo**, as migrações `20261035000000_duels.sql` a
`20261037000000_duels_realtime_cron.sql` precisam estar aplicadas, a Edge `play` publicada e o canal
privado do Realtime habilitado (policies em `realtime.messages`, criadas pela última migração). O
`pg_cron` roda `duel_cleanup` a cada 5 minutos; sem ele, a limpeza preguiçosa do `duel_state` ainda fecha
as salas quando alguém consulta.

---

## 9. Testes

```bash
npm test          # Node 20+, sem dependências
npm run test:db   # pgTAP (CLI do Supabase + Docker)
```

> **Ambiente com sandbox de processos** (ex.: DSH/agente de IA): o runner do `node --test` abre um
> subprocesso por arquivo com pipes e falha com `spawn EPERM`. Nesse caso rode arquivo por arquivo —
> `node tests/<jogo>.test.js` — e o resultado é o mesmo.

O que o `npm test` já cobre e você precisa manter verde:

- **paridade** entre `games/<id>/domain.js` e `_shared/<id>/domain.js` (comparação textual, com o caminho de
  `points.js` normalizado) — **edite sempre os dois**, ou copie o arquivo depois de mudar;
- catálogo SQL × `js/games.js` (id, título, ordem e `key`);
- visão pública **sem** `"solution"` nem `"path"`;
- validação server-side aceitando a solução e recusando tabuleiro inválido;
- RLS e `search_path` em toda função `security definer` das migrações listadas;
- duelos: contrato `DUEL` × catálogo (`tests/edge.test.js`), sessão/UI/hub (`tests/duel.test.js`) e o fluxo
  completo no banco (`supabase/tests/database/02_duelos.test.sql`: criar/entrar/pronto/largada, `first`,
  `words`, empate por tempo, desistência, limpeza, não-membro e exclusão de conta).

Teste novo do domínio (item 7 do checklist) deve, no mínimo: gerar cada um dos 4 níveis, provar que a
solução fornecida é aceita pelo próprio validador e que uma alteração mínima é recusada.

---

## 10. Armadilhas conhecidas

1. **`init.sql` não é só histórico.** `tests/supabase.test.js` extrai as linhas `('id', 'title', sort)` da
   migração inicial e compara com `js/games.js`. Registre o jogo nas **duas** (init + migração nova).
2. **Cópias de domínio divergem.** Mexeu em `games/<id>/domain.js`? Copie para `_shared/<id>/` na mesma hora.
3. **`GEN` esquecido.** Mudou o sorteio sem `GEN++` ⇒ fases locais salvas mostram tabuleiro inconsistente.
4. **`Math.random()`/`Date.now()` no domínio.** Quebra o determinismo e toda vitória na nuvem vira `invalid`.
5. **`Map`/`Set` no snapshot.** `JSON.stringify` os transforma em `{}`; sem `revive`, a validação estoura.
6. **Falta de `#board`/`#daily`.** O jogo funciona, mas troféus e painel do dia não aparecem.
7. **Falta `MOODS[<id>]`.** Jogo silencioso.
8. **Custo do cron.** `daily_generate` = `jogos × 4 níveis × slots`; com 8 jogos e 10 slots são 320 cenários.
9. **Jogo largo sem o ajuste de `body.ranking-open`.** O painel de ranking cobre o tabuleiro.
10. **Snapshot imutável.** Mudar o gerador no meio do dia não altera os cenários já criados: os jogadores
    continuam com o tabuleiro antigo até o dia virar.

### Sintoma → causa provável

| Sintoma | Causa |
|---|---|
| `unknown_game` no console / tela travada em "Preparando o cenário do dia…" | falta `GAME_IDS` ou o `case` no `board.js` |
| Ranking transparente, sem borda | faltam os tokens (`--cell`, `--grid`, `--bg`, `--fg`, `--muted`, `--accent`) |
| Troféus não aparecem | falta `#board` (ou o `#daily`) |
| Card no hub sem link / 404 | `path` errado em `js/games.js` |
| `npm test` falha em "paridade" | cópias de domínio divergentes |
| `npm test` falha em "os jogos cadastrados…" | `init.sql` sem a linha do jogo novo |
| Vitória recusada com `invalid` | gerador não determinístico ou `state` diferente do que o servidor espera |
| Vitória recusada com `too_fast` | ritmo anti-farm (`phase_min_seconds`, 3 s) — é retentável |

---

## 11. Passo a passo resumido

1. Definir as regras e os 4 níveis **antes** de codar (tamanho, dificuldade, condição de vitória, entrada).
2. Escrever `games/<id>/domain.js` + `tests/<id>.test.js` e rodar `npm test` até ficar verde.
3. Copiar o domínio para `_shared/<id>/domain.js`.
4. Escrever `index.html` + `style.css` e conferir os IDs da seção 5.
5. Escrever `ui.js` com os dois modos (local/aleatório e nuvem/diário).
6. (Opcional) Criar `tutorial.js` + `tutorial.css`, montar com `mountTutorial` e pôr o `?` de níveis com `mountLevelHelp` (seção 5.1).
7. Registrar o jogo: `js/games.js`, `init.sql`, migração nova, `board.js`, `index.ts`, `music.js`.
8. Atualizar os testes de integração que enumeram jogos.
9. Rodar `npm test`; abrir com `npm start` e jogar no modo local (fase aleatória, coins, reiniciar).
10. Com a nuvem ligada: `daily_status`, abrir ticket, vencer, conferir pontos, troféus e pódio.
11. Escrever a seção do jogo no `README.md` e no `docs/CONTINUAR.md`.

---

## 12. Prompt pronto para a próxima IA

> Estou continuando o desenvolvimento do WebMiniGames. Leia `docs/NOVO-JOGO.md`, `docs/CONTINUAR.md` e o
> `README.md` antes de responder. Vou adicionar um jogo novo (`<id>`), com estas regras: `<descreva>`.
> Siga o checklist do `docs/NOVO-JOGO.md`: domínio puro e determinístico, cópia em `_shared/`, catálogo em
> `js/games.js` + `init.sql` + migração, `board.js` com os quatro switches, `GAME_IDS`, `MOODS`, testes e
> documentação. Mantenha os textos em pt-BR e rode `npm test` depois de cada mudança.

---

## 13. Referência rápida: onde mexer para…

| Preciso… | Vá em |
|---|---|
| mudar a quantidade de cenários/dia | `admin.html` → "Desafio diário" (`set_coins_per_day`, 1–10) |
| dar tickets de teste a uma conta | `admin.html` → "Tickets de teste" (`admin_grant_coins`, por e-mail, em dias) |
| testar um nível específico | `admin.html` → Fácil/Médio/Difícil/Genius (`admin_set_level`, reinicia o diário do jogo) |
| ligar/desligar um jogo | `admin.html` (tabela `games.enabled`) |
| entender os troféus | `shared/daily-stats.js` (cálculo puro) + `shared/daily.js` (desenho) |
| ver o contrato da Edge | `supabase/functions/play/index.ts` + `_shared/board.js` |
| mudar o tempo por dica | `daily_hint_seconds()` (migração nova) |
| mudar o teto de acúmulo | `daily_backlog_days()` / `daily_backlog_start()` (migração nova) |
| criar o tutorial animado | `shared/tutorial.js` + `css/tutorial.css` (seção 5.1); modelos em qualquer um dos dez jogos (o Zip é o piloto) |
| explicar dificuldades e níveis | `shared/level-help.js` (`mountLevelHelp`) + `css/tutorial.css` (seção 5.1) |
