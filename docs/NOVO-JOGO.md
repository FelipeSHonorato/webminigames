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

Há **dois arquétipos** de duelo, e um jogo novo escolhe um deles antes de codar:

| Arquétipo | `DUEL` | Como o vencedor é decidido | Referência |
|---|---|---|---|
| **Corrida** (`race`) | `{ rule: "first" \| "words", maxSeconds, progressOf }` | os dois recebem o **mesmo puzzle** e jogam em paralelo; vence quem termina primeiro (`first`) ou quem faz mais palavras, com desempate por tempo (`words`) | este documento, seções 3.1 e 8 |
| **Turnos** (`turn`) | `{ kind: "turn", times: [minutos por jogador] }` | os jogadores **alternam jogadas** no mesmo estado; cada um tem o próprio relógio; vence quem encerra a partida pelas regras do jogo (mate, tempo, desistência etc.) | **Xadrez** (`games/chess/`, seção 3.2) |

O padrão completo de um duelo **por turnos** — catálogo, domínio, sessão, sala, largada, lances, ranking e
testes — está na **seção 3.2**. O fluxo de corrida continua resumido aqui:

Fluxo de corrida: o criador abre a sala (`duel_create`) escolhendo entre **aberta** (entra pela lista de
Salas Online, `duel_join_open`) ou **fechada** (só com o código, `duel_join`) e recebe um código de 6
caracteres; o amigo entra; os dois marcam "pronto" (`duel_ready`) e o servidor fixa `starts_at` (~4 s). O
puzzle só é entregue por `duel_start` **depois** de `starts_at`. A cada jogada a UI chama
`session.progress(0..1)` e o oponente vê a barra pelo Realtime (canal privado `duel:<id>`); ao concluir, o
jogo manda o tabuleiro em `session.finish(state)` e a Edge valida com o `domain.js` antes de o Postgres
decidir. O polling de `duel_state` cobre reconexão e a decisão final.

Regras de corrida: `first` = quem termina primeiro vence; `words` = mais palavras vence, empate no menor
tempo. O duelo **não** dá pontos, coins nem progressão solo. Sem dicas. Salas `waiting` expiram em 15 min;
o cron `duel_cleanup` (a cada 5 min) é a rede de segurança para salas abandonadas. O ranking é **por jogo**
(`duel_ratings`, seção 3.2.7), mesmo nos duelos de corrida.

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

### 3.2 Jogos de duelo por turnos — o padrão do Xadrez

O **Xadrez** (`games/chess/`, `shared/chess-session.js`, migração `20261038000000_chess_duel.sql`) é a
referência de duelo por **turnos**: os dois jogadores não correm no mesmo tabuleiro; eles alternam lances e
cada um tem o próprio relógio. Use esta seção quando o jogo novo for desse tipo. Para duelo de **corrida**
(mesmo puzzle para os dois), valem as seções 2.5, 3.1 e 8.1.

> **Não existe um "modo duelo" genérico para ligar em jogo existente.** Um jogo de turnos novo precisa de
> domínio, sessão, RPCs e tabela de estado próprios, como o Xadrez. O que é reutilizado é a infraestrutura
> de sala (`duels`, `duel_players`, `duel_ready`, `duel_leave`, `duel_ratings`, Realtime e Edge `play`).

#### 3.2.1 Catálogo, hub e Salas Online

O jogo entra no modo Duelos pelo catálogo, sem lista fixa em nenhum outro lugar:

```js
// js/games.js
chess: {
  title: "Xadrez", duel: true, path: "games/chess/",
  desc: "O clássico com regras de torneio: cada jogador tem o próprio relógio, que corre só no seu turno.",
  preview: `<svg …>`,
},
```

- `duel: true` é o **mesmo contrato** que a Edge confere no `DUEL` do domínio. `tests/edge.test.js` falha se
  o catálogo e o domínio divergirem.
- Jogo **só de duelo** não tem `key` (`chess.wins`): não há vitórias solo, níveis, coins nem desafio diário.
  Se o jogo também tiver modo solo, ele é um jogo solo normal **e** declara `DUEL`; a UI decide qual fluxo
  abrir pelo endereço/`Cloud`.
- Cadastre o jogo em `public.games` na **migração nova** (o Xadrez faz isso em
  `20261038000000_chess_duel.sql`; o teste lê todos os `insert into public.games`). Não é preciso duplicar
  a linha em `init.sql`.
- `shared/hub-nav.js`, `shared/rooms.js`, `shared/duel-hub.js` e `js/salas.js` já iteram `duel: true`; não
  precisam de código novo. O card do hub ganha o selo `1×1` e o link "Desafiar amigo" só aparece no modo
  Duelos.
- `tests/duel.test.js` e `tests/hub-nav.test.js` enumeram os jogos de duelo: atualize o esperado.

#### 3.2.2 Contrato do domínio de turnos

Além do contrato geral da seção 3, o domínio de turnos precisa expor as funções que a Edge usa para
**revalidar cada jogada**:

```js
// games/<id>/domain.js — nomes reais do Xadrez; use o equivalente no jogo novo
export const DUEL = { kind: "turn", times: [3, 10, 30, 60] };  // minutos POR JOGADOR

export function newGame() { /* { state, keys, moves, last, result } */ }
export function findMove(state, input) { /* lance legal ou null */ }
export function applyMove(state, move) { /* novo estado imutável */ }
export function playMove(game, input) { /* estado + histórico + resultado */ }
export function legalMoves(state) { /* lances legais */ }
export function outcome(state, keys) { /* { over, winner, reason } */ }
export function positionKey(state) { /* chave p/ repetição tripla, se o jogo tiver */ }
export function canMate(board, side) { /* adjudicação de tempo (FIDE 6.9) */ }
export function toFen(state) { /* persistência: JSON pequeno p/ o banco */ }
export function fromFen(fen) { /* reconstrói o estado a partir do banco */ }
```

`serialize`/`revive` são os nomes genéricos desse par de persistência; no Xadrez ele é `toFen`/`fromFen`.
Se o estado tiver `Map`/`Set`, converta para array em `serialize` e reconstrua em `revive`.

Regras de ouro:

1. **Puro e determinístico**: sem DOM, `fetch`, `Date.now()` ou `Math.random()`. O relógio é do Postgres.
2. **Estado imutável**: cada lance devolve um estado novo; a UI pode guardar a versão anterior para animar
   e desfazer o lance otimista.
3. **Estado pequeno e serializável**: o Xadrez guarda `{ fen, turn, version, keys, moves, last }`; um jogo
   novo guarda o equivalente (`board`, `order`, `placed`, …). `Map`/`Set` precisam de `serialize`/`revive`.
4. **Resultado calculado no domínio, aplicado no banco**: o domínio diz `over/winner/reason`; a Edge manda;
   o Postgres decide se a partida realmente acabou (vez, relógio, versão).
5. **Sem dicas**: `hasHints` não é consultado no duelo.

#### 3.2.3 Criação de sala (Edge + Postgres)

O criador escolhe o **ritmo** (validado contra `DUEL.times`), o **lado/cor** e a **visibilidade**. A Edge
não recebe o tabuleiro pronto do cliente: ela monta o estado inicial com o domínio.

```js
// supabase/functions/play/index.ts — ação <id>_create (modelo: chess_create)
const duel = duelOf(game);
if (!duel || duel.kind !== "turn") return json({ error: "not_duel_game" }, 400);
const minutes = Number(body?.minutes);
if (!duel.times.includes(minutes)) return json({ error: "bad_minutes" }, 400);
const side = body?.side;                       // "w"/"b" ou o equivalente do jogo
if (!validSide(side)) return json({ error: "bad_side" }, 400);
const start = newGame();                       // domínio puro
await svc.rpc("<id>_create", {
  p_uid: uid, p_minutes: minutes, p_side: side,
  p_state: toFen(start.state), p_key: start.keys[0],   // no Xadrez: p_fen/p_key
  p_open: body?.open !== false,
});
```

Troque `p_state`/`toFen` pelos nomes do domínio novo (`p_fen` no Xadrez); o importante é que o **servidor**
monte o estado inicial, não o cliente. No Postgres, a criação repete o padrão do `chess_create`:

| Passo | Regra |
|---|---|
| Catálogo | `games.id` precisa existir |
| Ritmo | minutos inteiros da lista `DUEL.times`; `max_seconds = minutos * 60` |
| Sala | `duels.kind = 'turn'`, `duels.rule = 'turn'`, `public_view` e `full_puzzle` **nulos** |
| Salas abertas | **1 por usuário** (`pg_advisory_xact_lock` + `count … waiting and expires_at > now()`); sem o lock, duas abas furam o limite |
| Criador | `duel_players` com `ready = false` |
| Estado | tabela própria do jogo (`chess_games` no Xadrez), uma linha por `duel_id` |
| Código | `duel_gen_code()` (6 chars, sem 0/O/1/I) |
| Expiração | `waiting` expira em 15 min; `duel_cleanup` é a rede de segurança |
| Visibilidade | `is_open` (aberta na lista) ou fechada (só com código/link) |

Tabela de estado mínima (modelo `chess_games`):

```sql
create table public.<id>_games (
  duel_id    uuid primary key references public.duels (id) on delete cascade,
  state      jsonb not null,                 -- estado serializado do domínio
  version    int not null default 0,         -- concorrência otimista
  side_a     uuid references public.profiles (id) on delete cascade,
  side_b     uuid references public.profiles (id) on delete cascade,
  clock_a_ms int not null check (clock_a_ms >= 0),
  clock_b_ms int not null check (clock_b_ms >= 0),
  last_at    timestamptz,                    -- quando o relógio do lado da vez começou
  result     text,                           -- 'a' | 'b' | 'draw'
  reason     text,
  updated_at timestamptz not null default now(),
  check (side_a is null or side_b is null or side_a <> side_b)
);
alter table public.<id>_games enable row level security;
revoke all on public.<id>_games from anon, authenticated;   -- só a Edge (service_role) acessa
```

**Atenção ao segundo jogo de turnos:** o `duel_seat`/`duel_join` atuais atribuem a cor do Xadrez com um
`update public.chess_games`. Para um jogo novo, generalise o assento (dispatch por `game_id` ou uma tabela
genérica de assentos) — copiar o `chess_games` sem ajustar deixa o convidado sem lado. O `chess_json`
também é específico do Xadrez; crie o payload do jogo novo (ou um `duel_json` genérico).

#### 3.2.4 Entrada, pronto e largada

O caminho é o mesmo dos duelos de corrida, com duas diferenças: o assento define o **lado** e o início é
por **turnos**.

1. O amigo entra por `duel_join` (código/link) ou `duel_join_open` (card de Salas Online). Os dois terminam
   em `duel_seat`, que:
   - recusa sala cheia, expirada ou já iniciada (`duel_full`, `expired`, `bad_status`);
   - insere o jogador com `ready = false`;
   - atribui o lado vazio (no Xadrez, a cor que o criador não escolheu);
   - devolve `players`, `opponent`, `createdBy`, `open` e os campos do lobby.
2. O convidado clica em **"Estou pronto"** (`duel_ready`). Só então o criador é avisado em qualquer página
   por `duel_invites` e pelo pop-up de `shared/duel-invites.js`.
3. O criador clica em **"Entrar na sala"**: a página abre com `?duelo=<id>&aceitar=1`, chama `duel_mine` se
   não houver sala no endereço e marca `duel_ready`. Com os dois prontos, o servidor grava
   `status = 'running'` e `starts_at = now() + 4 s`.
4. Enquanto `now() < starts_at`, `<id>_start`/`<id>_state` **não** entregam jogada nem mexem no relógio: só
   contagem. O cliente usa `serverNow` para corrigir o relógio local.
5. Presença: `last_seen_at` é carimbado a cada consulta de estado enquanto a sala está `waiting` — pelo
   próprio `<id>_state` no banco (migração 48) e, redundantemente, por `duel_touch` na Edge. `duel_ready`
   recusa com `opponent_away` se o desafiante está pronto mas sumiu há > 90 s. Detalhes em 3.2.12.
6. O criador pode **desistir** (`duel_decline`): cancela com `cancel_reason = 'declined'`, o desafiante vê
   o motivo e **ninguém ganha nem perde rating**. Em `waiting`, sair sem desafiante é `duel_leave`; sair
   como desafiante libera a vaga/lado.

Endereços que a página precisa entender: `?duelo=novo` (criar), `?duelo=<código>` (entrar por código),
`?duelo=<uuid>` (retomar/abrir sala) e `?aceitar=1` (aceite vindo do aviso global). Sem `?duelo=`, chame
`Cloud.duelMine(GAME_ID)` e retome a sala ativa em vez de oferecer outra.

#### 3.2.5 Relógio e lance

O relógio é **do Postgres**, nunca do cliente:

- `last_at` marca quando o relógio do lado da vez começou a correr.
- `clocksAt` do cliente é só exibição: desconta o tempo desde o último `serverNow` recebido; quando a
  resposta chega, o valor do servidor manda.
- Na largada, `last_at` recebe `starts_at` (a contagem de 4 s não consome tempo).
- No lance, o relógio do jogador que jogou é debitado até `now()`; o do oponente fica parado.

Fluxo de um lance:

```text
UI (otimista) → Edge <id>_move
  ├─ valida tipo de duelo, status 'running' e que é o jogo certo
  ├─ carrega o estado + version do banco
  ├─ findMove/playMove do domínio (lance legal? resultado?)
  ├─ canStillWin dos dois lados (no Xadrez, canMate; adjudicação de tempo)
  └─ RPC <id>_move(uid, duelo, version, estado_novo, resultado, …)
        ├─ confere membro, lado/vez, version e relógio (for update)
        ├─ se o tempo estourou antes do lance: ignora o lance e finaliza por timeout
        ├─ grava estado, version + 1, relógio debitado, last_at = now()
        └─ se o domínio encerrou: duels.status = 'finished', winner_id, finished_at
```

Erros que a UI precisa distinguir: `invalid_move` (lance ilegal), `not_your_turn` (não é a vez),
`stale` (outra aba/polling já mudou o tabuleiro → `refresh`), `not_started`, `bad_status` e `expired`.
A posição do servidor é a verdade: depois de cada lance (mesmo recusado) a UI reaplica o estado recebido.

#### 3.2.6 Fim de jogo, desistência e limpeza

| Evento | Quem decide | Efeito |
|---|---|---|
| Mate/afogamento/regra do jogo | domínio → Edge → RPC | `duels.status = 'finished'`, `winner_id` (ou nulo em empate), `result/reason` no estado |
| Tempo esgotado | RPC (`now()` vs `last_at`) | vence o adversário, **salvo** se ele não puder mais vencer (`canStillWin`); senão empate |
| Desistir em `running` (`<id>_resign` ou `duel_leave`) | RPC | adversário vence; `reason = 'resign'` |
| Sair em `waiting` | `duel_leave` | criador cancela a sala; convidado libera vaga/lado |
| Criador desiste com desafiante | `duel_decline` | `cancelled`, `cancel_reason = 'declined'`, **sem rating** |
| Sala abandonada | `duel_cleanup` (pg_cron a cada 5 min) | cancela `waiting` expirada; em `turn`, **não** usa `max_seconds` para encerrar — quem encerra é o relógio por jogador |

O `duel_rating_finish` só reage à transição para `finished`; `cancelled` **nunca** altera rating.

#### 3.2.7 Ranking por jogo (Elo)

O ranking não é o ranking de pontos do modo solo. Cada jogo de duelo tem o próprio **rating**:

| Peça | Onde | Regra |
|---|---|---|
| Tabela | `public.duel_ratings` (PK `game_id, user_id`) | rating/peak 1500, wins/losses/draws/games; leitura só pela função |
| Cálculo | `duel_elo_delta` (SQL puro) | Elo; K = 40 nas 10 primeiras partidas, 32 depois; rating entre 100 e 4000 |
| Aplicação | trigger `duel_rating_finish` em `duels` | quando `status` vira `finished` e há 2 jogadores: vitória 1, empate 0.5, derrota 0; usa `chess_games.result` no Xadrez e `winner_id` nos demais |
| Leitura | `duel_ranking(game, scope, limit)` | devolve `{ top, me, total }`, `points = rating`; exclui admin e quem tem `games = 0`; filtra região |
| Jogador | payload da sala (`players[].rating`) e `host.rating` nas salas | mostra o rating real; sem linha ainda, 1500 |
| Hub/Salas | `Scores.duelLeaderboard` + `renderLeaderboard` | sufixo **"Elo"**, um painel por jogo no modo Duelos; em Salas Online, carrossel de 3 s |

Regras de ouro do ranking:

1. **Nunca no cliente**: rating é escrito só pelo trigger/RPC com `service_role`; a UI apenas lê.
2. **Cancelar não pontua**: declínio, sala expirada e saída em `waiting` não passam por `finished`.
3. **Empate existe**: `winner_id = null` + `status = 'finished'` = 0.5 para os dois.
4. **Jogo novo não precisa de código de ranking** se usar `duel_ratings` e o trigger; só precisa devolver o
   `rating` no payload da sala e registrar o jogo em `games`.
5. Se a fórmula for diferente do Elo, mude **o SQL** (`duel_elo_delta`/trigger), não a UI.

#### 3.2.8 Cliente: sessão e UI

Para turnos, **não** use `shared/duel-session.js` sozinho: ele é a máquina de estados de **corrida**
(puzzle + barra de progresso + `finish`). O Xadrez tem `shared/chess-session.js`, que é o modelo para um
jogo de turnos novo (`shared/<id>-session.js`):

- sem DOM; `Cloud` injetável para os testes;
- `create/join/attach/ready/refresh/move/resign/leave`;
- eventos `lobby`, `ready`, `state`, `move`, `resign`, `finished`, `left`;
- polling (`CHESS_POLL_MS = 1500`) e canal privado `duel:<id>` como **espelho** (avisa o oponente para
  atualizar; não decide nada);
- getters de relógio (`clocks()`, `msToStart()`, `isMyTurn()`), `myColor`, `outcome`;
- `serverOffset = Date.parse(serverNow) − Date.now()` para a contagem e os relógios não adiantarem.

Na `ui.js`:

- um **único tabuleiro** serve ao modo local (hot-seat, relógio no navegador) e ao online (servidor);
- o modo online bloqueia cliques fora da vez, durante o lance em trânsito e antes da largada;
- o lance é otimista na tela e confirmado/desfeito pelo estado do servidor;
- a UI trata `?duelo=novo|código|uuid`, `?aceitar=1`, `duel_mine`, o evento `wmg:duel-accept`
  (`ACCEPT_EVENT` de `shared/duel-invites.js`) e a mensagem de cancelamento (`declined`/`expired`);
- mostra nomes, avatares, rating, relógios, lances e o resultado, mas **nunca** calcula vencedor.

Para corrida, o par é `shared/duel-session.js` + `shared/duel-ui.js` (lobby, contagem, barras, resultado);
o jogo só monta o tabuleiro quando `onStart` entrega o puzzle.

#### 3.2.9 Checklist de arquivos — jogo de duelo por turnos

| # | Arquivo | Conteúdo |
|---|---|---|
| 1 | `games/<id>/domain.js` | contrato de turnos: `DUEL`, estado, lances, resultado, serialização |
| 2 | `games/<id>/ui.js` | modo local + online, lobby, relógios, lances, URL do duelo |
| 3 | `games/<id>/index.html` | IDs do contrato da seção 5 + `style.css` com tokens |
| 4 | `games/<id>/style.css` | tabuleiro, relógios, lobby, responsivo |
| 5 | `shared/<id>-session.js` | sessão sem DOM (modelo `shared/chess-session.js`) |
| 6 | `supabase/functions/play/_shared/<id>/domain.js` | **cópia idêntica** do item 1 |
| 7 | `supabase/migrations/<timestamp>_<id>_duel.sql` | catálogo, tabela de estado, funções `<id>_*` e grants |
| 8 | `tests/<id>.test.js` | regras, lances legais/ilegais, resultados, casos de timeout |
| 9 | `tests/<id>-session.test.js` | relógio, polling, pronto, resultado e cancelamento (sem DOM) |
| 10 | `assets/thumbs/<id>-light.webp` e `-dark.webp` | miniatura do card (360×360) |
| 11 | `games/<id>/tutorial.js` / `tutorial.css` | opcional, se o jogo tiver "Como jogar" |

A migração `20261039000000_duel_ratings.sql` já é **global**: o trigger `duel_rating_finish` aplica Elo a
qualquer duelo `finished` com dois jogadores (no Xadrez lê `chess_games.result`; nos demais usa
`duels.winner_id`). Só altere essa migração se a fórmula ou a forma de decidir o vencedor do jogo novo forem
diferentes. Não crie um trigger de rating por jogo.

Arquivos alterados: `js/games.js`, `public.games` na migração nova,
`supabase/functions/play/_shared/board.js` (`import`, `GAMES`, `SOLO_GAMES` se não gera fase, `GENS`),
`supabase/functions/play/index.ts` (`DUEL_ACTIONS`, roteador `duel_*`/`<id>_*`, ação
`<id>_create/move/state/resign`), `shared/music.js`, `tests/edge.test.js`, `tests/duel.test.js`,
`tests/hub-nav.test.js`, `tests/theme.test.js`, `tests/supabase.test.js`, `README.md` e `docs/CONTINUAR.md`.

#### 3.2.10 Testes mínimos de um duelo por turnos

- **Domínio**: estado inicial, lances legais/ilegais, imutabilidade, resultado (vitória/empate), serialização
  ida e volta, `canStillWin` nos casos de tempo. No Xadrez, `perft` prova as regras objetivamente.
- **Sessão**: `clocksAt` só desconta o lado da vez e nada antes da largada; `msToStart` usa o
  `serverOffset`; `outcome` do ponto de vista de quem vê; lance manda só o input; `resign/leave` encerram
  uma única vez; attach não ocupa vaga.
- **Edge**: catálogo × `DUEL`; `_shared` idêntico ao `games/`; `<id>_move` valida com o domínio e recusa
  lance ilegal; `duel_create` recusa jogo sem `DUEL`; ação de turno não cai em `unknown_game`.
- **Banco (pgTAP)**: criar/entrar/pronto/largada, lance fora da vez, `stale`, timeout, desistência,
  cancelamento sem rating, cleanup, não-membro e exclusão de conta.
- **Manual**: criar sala aberta/fechada, entrar pela lista e por código, aviso global, `?aceitar=1`,
  recarregar (retomar), duas abas (uma recusa `stale`), tempo estourando e ranking mudando.

#### 3.2.11 Armadilhas específicas de turnos

1. **Copiar o Xadrez sem generalizar o assento.** `duel_seat`/`duel_join` só sabem preencher
   `chess_games`; um segundo jogo de turnos precisa de dispatch por `game_id` ou tabela de assentos.
2. **Deixar o cliente decidir o vencedor.** A UI só envia o lance; Edge valida e Postgres decide.
3. **Esquecer `version`.** Sem concorrência otimista, duas abas aplicam lances na mesma posição.
4. **Relógio no cliente.** `setInterval` é só pintura; quem debita e encerra é o `now()` do Postgres.
5. **Esquecer `serverNow`.** A contagem e o relógio local adiantam/atrasam; o adversário vê tempo errado.
6. **Ação `_` fora do roteador.** O `handleDuel` só recebe `duel_*` e `chess_*`; registre `<id>_*` no
   `DUEL_ACTIONS` e no `if` do roteador, senão volta `unknown_game`.
7. **Esquecer o deploy da Edge.** Banco/migração atualizados sem `functions deploy play` = `unknown_game`.
8. **Rating em cancelamento.** O trigger só dispara em `finished`; não crie caminho paralelo que pontue
   `cancelled`/`declined`.
9. **Sala aberta duplicada.** Use o advisory lock e conte só `waiting` não expirada.
10. **Deixar sala fechada vazar.** `duel_open_rooms` mostra fechada só para o criador; o join por id recusa
    com `closed_room`.
11. **Misturar com o desafio diário.** Jogo só de duelo não tem `generatePuzzle`/`LEVELS`; fique fora de
    `SOLO_GAMES`, de `daily_generate` e do painel `#daily`.
12. **Duplicar regra.** A validação do lance existe uma vez no domínio, usada pela UI, pela Edge e pelos
    testes; não reimplemente no `ui.js`.

#### 3.2.12 Lições do bug "Estou pronto" da Dama (leia antes de entregar o próximo duelo)

Na Dama, o criador não conseguia marcar "Estou pronto" e a partida nunca começava, enquanto o desafiante
funcionava. O Xadrez, com o mesmo código, estava certo. Os pontos abaixo evitam repetir isso.

**A) O contrato do "pronto" tem uma assimetria embutida.** A UI só habilita o botão do criador depois que
o desafiante marcou pronto (`isCreator() && !opponent().ready` ⇒ `disabled`). Logo, **o criador é sempre o
segundo a clicar**, e só o segundo a clicar passa pela guarda `opponent_away` do `duel_ready` (desafiante
pronto, mas sem presença há > 90 s). Qualquer falha de presença do desafiante aparece **só** no botão do
criador. Quando o relato for "funciona para um lado e não para o outro", comece por aqui.

**B) Presença é responsabilidade do banco, não só da Edge.** A Edge chamava `duel_touch` após cada
`<id>_state` e **engolia qualquer erro** (`try/catch` vazio; o `rpc` do supabase-js nem lança, devolve
`{ error }`). Se o carimbo falhar, ou a Edge em produção for mais antiga que o repositório, o desafiante
parece "ausente". Por isso a migração `20261048` carimba `last_seen_at` **dentro** de `dama_state` e
`chess_state` enquanto a sala está `waiting`. Todo `<id>_state` novo deve fazer o mesmo.

**C) Nunca edite uma migração já aplicada.** O banco é atualizado colando SQL no SQL Editor; o
`supabase db push` não reexecuta o que já rodou. Um commit que editou a `20261045` não mudou o banco e, pior,
trazia uma função inválida (`v_players` sem `declare`; depois, `nickname` lido de `duel_players`, que não
tem essa coluna). Correção de função existente = **migração nova**, idempotente (`create or replace`),
numerada depois da última e com `revoke`/`grant` repetidos no fim.

**D) `nickname`/`avatar` vivem em `profiles`.** `duel_players` só tem `duel_id`, `user_id`, `ready`,
`joined_at`, `last_seen_at`. Para devolver `players`, faça `join public.profiles p on p.id = dp.user_id`.

**E) Erro de ação do lobby não pode desaparecer sozinho.** `flash()` some em ~1,5 s e o polling re-renderiza
o lobby a cada ciclo, apagando a mensagem: o usuário vê "nada acontece". Guarde o erro em uma variável
(`lobbyError`) e o `renderLobby()` o reexibe até a próxima tentativa ou até `me.ready`. Vale para
"Estou pronto", "Entrar na sala" e qualquer botão do lobby.

**F) Não existe "duelo que só o Xadrez testou".** `duel_ready`, `duel_seat`, `duel_touch`, `duel_invites`,
`duel_leave` e `duel_decline` são compartilhados: alterar um deles para o jogo novo muda o Xadrez em
produção. Mexa neles apenas em migração nova e rode o fluxo abaixo **nos dois jogos**.

**G) Mantenha Edge e banco em sincronia.** Depois de rodar a migração, faça o deploy da Edge
(`functions deploy play`, manual via workflow) e confira no painel do Supabase se a versão publicada é a
do commit. Banco novo + Edge velha (ou o inverso) é fonte de bugs que não aparecem nos testes unitários.

##### Teste de fumaça do lobby (rode antes de liberar um duelo novo)

No SQL Editor de um projeto de teste (ou em um Postgres local com as migrações), troque `<jogo>_create` e
os dois UUIDs de usuários reais de `auth.users`:

```sql
-- 1. criador cria sala aberta
select (public.<jogo>_create('<CRIADOR>', 10, 'w', '<posição inicial>', '<chave inicial>', true))->>'id' as duel \gset
-- 2. desafiante entra e marca pronto
select public.duel_join_open('<DESAFIANTE>', :'duel'::uuid);
select public.duel_ready('<DESAFIANTE>', :'duel'::uuid)->>'status';      -- esperado: waiting
-- 3. o criador enxerga o desafiante pronto e é avisado
select jsonb_pretty((public.<jogo>_state('<CRIADOR>', :'duel'::uuid))->'players');   -- opponent.ready = true
select public.duel_invites('<CRIADOR>');                                  -- traz a sala
-- 4. presença antiga do desafiante (simula Edge que não carimbou): o estado tem de renová-la
update public.duel_players set last_seen_at = now() - interval '100 seconds' where user_id = '<DESAFIANTE>';
select 1 from (select public.<jogo>_state('<DESAFIANTE>', :'duel'::uuid)) x;
-- 5. criador marca pronto: não pode dar opponent_away
select public.duel_ready('<CRIADOR>', :'duel'::uuid)->>'status';          -- esperado: running
```

Repita com o criador nas duas cores, sala aberta (lista) e fechada (código). Se qualquer passo falhar, não
libere o jogo. Para cobrir também o cliente, rode `createXSession` dos dois lados contra o banco local,
como em `tests/*-session.test.js`, mas com um `cloud` que chama as RPCs de verdade.

##### Checklist de regressão do lobby

- [ ] O botão do criador habilita quando o desafiante marca pronto (sem recarregar a página).
- [ ] Criador e desafiante conseguem marcar pronto, em qualquer ordem permitida pela UI, e a partida vai a `running`.
- [ ] O criador marca pronto mesmo se a Edge não carimbou a presença (passo 4 do teste).
- [ ] Erro em "Estou pronto" fica visível na tela e não some no polling.
- [ ] Nenhuma migração antiga foi editada; há uma migração nova com o conserto.
- [ ] `duel_*` compartilhados continuam funcionando no Xadrez (rode o teste de fumaça nos dois jogos).
- [ ] Edge publicada com o commit atual (`functions deploy play`) e `npm test` verde.

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

**Jogo de duelo por turnos:** o checklist de arquivos novos é o da **seção 3.2.9** (inclui sessão própria,
tabela de estado e migração específica). Ele **não** tem os quatro níveis, o desafio diário nem a migração
mínima acima: o registro em `games` continua necessário, mas a migração também cria a tabela
`<id>_games`, as funções `<id>_*` e os grants.

---

## 7. Checklist — arquivos ALTERADOS

| # | Arquivo | Alteração |
|---|---|---|
| 1 | `js/games.js` | entrada `{ title, key: "<id>.wins", path: "games/<id>/", desc, preview }` — o `preview` (SVG) só aparece se faltar a miniatura |
| 2 | migração nova (e/ou `supabase/migrations/20261014000000_init.sql` se for o caso) | linha em `insert into public.games` — o teste lê **todos** os inserts; jogos novos entram pela migração própria |
| 3 | `supabase/functions/play/_shared/board.js` | `import`, `GAMES`, `GENS` e os switches de `viewOf`, `serialize`, `revive`, `validatePuzzle` |
| 4 | `supabase/functions/play/index.ts` | `GAME_IDS` é derivado de `SOLO_GAMES`; se o jogo for duelo, registre as ações em `DUEL_ACTIONS` e no roteador |
| 5 | `shared/music.js` | entrada em `MOODS` (sem ela o jogo fica **mudo**) |
| 6 | `tests/edge.test.js` | listas de paridade, de visão pública, casos de snapshot e `Object.keys(GAMES)` |
| 7 | `tests/theme.test.js` | id no laço de contraste |
| 8 | `tests/supabase.test.js` | `migrationNames` (varreduras de RLS/`search_path`) |
| 9 | `README.md` | descrição do jogo na lista e na tabela de estrutura |
| 10 | `docs/CONTINUAR.md` | regras, decisões e sutilezas (é o que a próxima IA lê primeiro) |
| 11 | `jogos.html` + CSS do hub | o grid é `auto-fit, minmax(200px, 1fr)` (3 colunas em telas largas, ao lado da lateral de modos): um jogo novo muda o número de linhas — conferir no navegador |

`js/hub.js`, `js/perfil.js`, `js/admin.js` e `js/landing.js` **já iteram `GAMES`** e não precisam de código
novo — mas entram no teste visual (card, painel do admin, lista do perfil, landing).

**Jogo de duelo por turnos:** além dos itens acima, altere `supabase/functions/play/index.ts`
(`DUEL_ACTIONS` + roteador `<id>_*`), `tests/duel.test.js` e `tests/hub-nav.test.js` (enumeram os duelos) e
crie `shared/<id>-session.js`. Em `_shared/board.js`, importe o domínio e inclua-o em `GAMES`; como ele não
tem `generatePuzzle`, fica automaticamente fora de `SOLO_GAMES` e do desafio diário. O checklist completo
está em **3.2.9**.

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

Duelos de **corrida** não têm switch novo: `DUELS`/`duelOf(game)` são derivados de `GAMES[game].DUEL`. Ao
criar a sala, a Edge usa `snapshot()` (puzzle completo + visão pública) e, ao finalizar, valida com
`validateSnapshot()` (ou `validatePartial()` na regra `words`) e conta as palavras com `countWords()` antes
de chamar `duel_finish`.

Duelos **por turnos** (Xadrez) só precisam do `import` + entrada em `GAMES`: sem `LEVELS`/`generatePuzzle`,
o jogo não entra em `SOLO_GAMES`, e `viewOf`/`serialize`/`validatePuzzle` nunca são chamados para ele. Quem
valida o lance é o domínio diretamente na Edge (`findMove`/`playMove`), e o estado fica na tabela própria do
jogo. Não acrescente um `case` de turnos nesses switches “para completar”: ele só criaria um caminho falso
para um jogo que não gera fase.

Detalhes que mordem:

- A visão pública é serializada em JSON: `Map` e `Set` viram `{}` — converta para array e reconstrua no
  `revive` (como `arrows` e `zip` fazem).
- `validatePuzzle` recebe o puzzle **completo**: pode usar `p.solution`, mas nunca confie em `data` cru —
  valide tipos e faixas (o Canos usa `ints(arr, n*n, 0, 3)`).
- Só há **um** lugar com as regras de validação, usado pela UI e pela Edge. Duplicar é criar divergência.

### 8.2 `index.ts`

A Edge aceita **todos os jogos solo** de `_shared/board.js`: `const GAME_IDS = new Set(Object.keys(SOLO_GAMES))`,
e `SOLO_GAMES` é derivado de quem tem `generatePuzzle`. O Xadrez fica de fora (é só duelo) e entra pelo
roteador `handleDuel`, não por `GAME_IDS`. `generateDayScenarios` percorre `SOLO_GAMES` e usa
`LEVELS.length` — mais um jogo solo aumenta o custo da pré-geração e do cron.

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
`20261046000000_duel_invite_when_ready.sql` precisam estar aplicadas (a base de salas é 35–37; rating em 39;
salas abertas/convite/presença em 40–46), além da migração própria do jogo (ex.:
`20261038000000_chess_duel.sql`). A Edge `play` publicada e o canal privado do Realtime habilitado (policies
em `realtime.messages`) são obrigatórios. O `pg_cron` roda `duel_cleanup` a cada 5 minutos; sem ele, a
limpeza preguiçosa do `duel_state` ainda fecha as salas quando alguém consulta — mas não substitui o relógio
por jogador de um duelo de turnos.

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
- duelo por turnos: regras e imutabilidade do domínio (`tests/chess.test.js`), sessão sem DOM
  (`tests/chess-session.test.js`: relógios, `serverOffset`, pronto, resultado, desistência) e paridade
  catálogo × `DUEL` no `tests/edge.test.js`. O Xadrez é o modelo; o jogo novo precisa do equivalente
  `tests/<id>.test.js` + `tests/<id>-session.test.js`.

Teste novo do domínio (item 7 do checklist solo) deve, no mínimo: gerar cada um dos 4 níveis, provar que a
solução fornecida é aceita pelo próprio validador e que uma alteração mínima é recusada. Para duelo por
turnos, o mínimo é o da **seção 3.2.10** — as regras de lance/resultado substituem os 4 níveis.

---

## 10. Armadilhas conhecidas

1. **`public.games` não é opcional.** `tests/supabase.test.js` lê os `insert into public.games` de **todas**
   as migrações e compara com `js/games.js`. Jogos novos entram na própria migração (modelo: `chess`);
   instalações antigas não precisam de uma segunda linha em `init.sql`.
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
| `unknown_game` no console / tela travada em "Preparando o cenário do dia…" | falta `generatePuzzle` (o jogo fica fora de `SOLO_GAMES`) ou o `case` no `board.js` |
| Ranking transparente, sem borda | faltam os tokens (`--cell`, `--grid`, `--bg`, `--fg`, `--muted`, `--accent`) |
| Troféus não aparecem | falta `#board` (ou o `#daily`) |
| Card no hub sem link / 404 | `path` errado em `js/games.js` |
| `npm test` falha em "paridade" | cópias de domínio divergentes |
| `npm test` falha em "os jogos cadastrados…" | a migração não tem a linha em `public.games` (ou o título/ordem divergem de `js/games.js`) |
| Vitória recusada com `invalid` | gerador não determinístico ou `state` diferente do que o servidor espera |
| Vitória recusada com `too_fast` | ritmo anti-farm (`phase_min_seconds`, 3 s) — é retentável |
| "Estou pronto" funciona para o desafiante mas não para o criador | o criador é o 2º a clicar e cai na guarda `opponent_away`: presença do desafiante antiga (ver 3.2.12-A/B); ou o erro some do lobby (3.2.12-E) |
| "Estou pronto" falha para todos, em todos os jogos | `duel_ready` quebrada no banco (coluna/variável inexistente) por migração antiga editada ou colada errada (3.2.12-C/D) |
| Correção "não pega" em produção | editou migração já aplicada, ou faltou rodar o SQL no SQL Editor / publicar a Edge (3.2.12-C/G) |

---

## 11. Passo a passo resumido

1. Definir as regras e os 4 níveis **antes** de codar (tamanho, dificuldade, condição de vitória, entrada).
2. Escrever `games/<id>/domain.js` + `tests/<id>.test.js` e rodar `npm test` até ficar verde.
3. Copiar o domínio para `_shared/<id>/domain.js`.
4. Escrever `index.html` + `style.css` e conferir os IDs da seção 5.
5. Escrever `ui.js` com os dois modos (local/aleatório e nuvem/diário).
6. (Opcional) Criar `tutorial.js` + `tutorial.css`, montar com `mountTutorial` e pôr o `?` de níveis com `mountLevelHelp` (seção 5.1).
7. Registrar o jogo: `js/games.js`, migração nova (`public.games`), `board.js`, `index.ts`, `music.js`.
8. Atualizar os testes de integração que enumeram jogos.
9. Rodar `npm test`; abrir com `npm start` e jogar no modo local (fase aleatória, coins, reiniciar).
10. Com a nuvem ligada: `daily_status`, abrir ticket, vencer, conferir pontos, troféus e pódio.
11. Escrever a seção do jogo no `README.md` e no `docs/CONTINUAR.md`.

**Se o jogo for um duelo por turnos**, o roteiro muda: não há 4 níveis, `daily_*` nem modo aleatório. Siga a
seção **3.2** (catálogo → domínio → migração/tabela → Edge → sessão → UI → ranking → testes) e use
`games/chess/` + `shared/chess-session.js` como modelo. Para duelo de **corrida**, siga 3.1 + 8.1.

---

## 12. Prompt pronto para a próxima IA

> Estou continuando o desenvolvimento do WebMiniGames. Leia `docs/NOVO-JOGO.md`, `docs/CONTINUAR.md` e o
> `README.md` antes de responder. Vou adicionar um jogo novo (`<id>`), com estas regras: `<descreva>`.
> Siga o checklist do `docs/NOVO-JOGO.md`: domínio puro e determinístico, cópia em `_shared/`, catálogo em
> `js/games.js` + migração nova, `board.js` com os quatro switches, `GAME_IDS`, `MOODS`, testes e
> documentação. Se o jogo for um duelo 1×1, diga se é de **corrida** ou de **turnos**: para turnos, leia a
> seção 3.2 e use `games/chess/` + `shared/chess-session.js` como referência (sem níveis nem desafio diário).
> Mantenha os textos em pt-BR e rode `npm test` depois de cada mudança.

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
| criar um duelo por turnos | seção 3.2; modelo em `games/chess/` (`domain.js`, `ui.js`) + `shared/chess-session.js` |
| ranking de duelo (Elo) | `duel_ratings` + `duel_ranking()` (migração `20261039000000_duel_ratings.sql`) |
| sala, convite e código | `duels` + `duel_seat`/`duel_ready` + `shared/duel-invites.js` (migrações `20261035000000_*` a `20261046000000_*`) |
| relógio e lance do Xadrez | `chess_games` + `chess_move`/`chess_state` (migração `20261038000000_chess_duel.sql`) |
| mudar o tempo por dica | `daily_hint_seconds()` (migração nova) |
| mudar o teto de acúmulo | `daily_backlog_days()` / `daily_backlog_start()` (migração nova) |
| criar o tutorial animado | `shared/tutorial.js` + `css/tutorial.css` (seção 5.1); modelos em qualquer um dos dez jogos (o Zip é o piloto) |
| explicar dificuldades e níveis | `shared/level-help.js` (`mountLevelHelp`) + `css/tutorial.css` (seção 5.1) |
