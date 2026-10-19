# Backend com Supabase

O site funciona em dois modos, escolhidos por `shared/backend/config.js`:

| Modo | Quando | Onde ficam contas e registros |
|---|---|---|
| **Local** (padrão) | `SUPABASE_URL` e `SUPABASE_ANON_KEY` vazios | No navegador (`localStorage`), como no protótipo |
| **Nuvem** | os dois preenchidos | No Supabase: contas reais, progresso, pontos, coins, fases, ranking e liga/desliga de jogos compartilhados por todos |

Quem joga como **anônimo** continua local nos dois modos (não cria conta, não pontua, o progresso fica no navegador).

## Passo a passo (faça uma vez)

### 1. Criar o projeto
[supabase.com/dashboard](https://supabase.com/dashboard) → **New project**. Anote a senha do banco (você não vai precisar dela no site).

### 2. Criar as tabelas
**SQL Editor → New query** → cole **todo** o conteúdo de `supabase/migrations/20261014000000_init.sql` → **Run**. Deve terminar com "Success". Isso cria tabelas, regras de segurança (RLS) e as funções que decidem pontos, nível e coins. **Rode uma vez só** (rodar de novo dá erro de "já existe", sem estragar nada).

Depois rode, também no SQL Editor, as demais migrações, **nesta ordem**:

- `20261017000000_delete_account.sql`: cria `delete_my_account` (o jogador apaga a própria conta — LGPD).
- `20261018000000_phase_runs.sql`: fase aberta em `phase_runs`, pontos e coins decididos no servidor e ritmo anti-farm.
- `20261019000000_serve_phase.sql`: o **servidor passa a servir a fase** (seed secreta + puzzle público, sem a solução) e a **validar o tabuleiro** antes de pontuar.
- `20261020000000_admin_sem_pontos.sql`: a conta administradora não pontua nem entra em rankings.
- `20261021000000_desafio_diario.sql`: **desafio diário** — mesmo cenário do dia por nível, rankeado por tempo.
- `20261022000000_diario_configuravel.sql`: o **nº de cenários do dia = coins do dia** (configurável pelo administrador, global) e concluir o dia também **pontua**.
- `20261023000000_jogo_setas.sql`: registra o jogo **Fuga das Setas** (`arrows`) no catálogo (sem tabela nova; a fase é servida/validada pela Edge).
- `20261024000000_trofeus_diarios.sql`: **troféus do cenário** (percentual, média do dia e posição regional) — `daily_status`/`daily_finish` já devolvem os `stats` por slot.
- `20261025000000_admin_coins.sql`: **coins de teste por conta** no painel (`admin_grant_coins`, restrita ao administrador): recarrega os coins do dia de um jogador pelo e-mail do login, sem tocar em pontos/nível.

Para conferir o que já está aplicado:

```sql
select
  to_regclass('public.phase_runs')     as phase_runs,
  to_regproc('public.open_phase')      as open_phase,
  to_regproc('public.finalize_win')    as finalize_win,
  to_regproc('public.daily_open')      as daily_open,
  to_regproc('public.daily_finish')    as daily_finish,
  to_regproc('public.set_coins_per_day') as set_coins_per_day,
  to_regproc('public.admin_grant_coins') as admin_grant_coins;
```

O que der `null` ainda falta rodar (re-rodar é seguro: os arquivos são idempotentes). Com a CLI, `supabase db push` aplica todas na ordem.

### 2b. Publicar a Edge Function `play` (validação no servidor)
A validação do tabuleiro roda numa **Edge Function** — um código que roda nos servidores do Supabase: recebe o pedido do jogo (`open`/`hint`/`finish`), confere quem é o usuário, monta o puzzle a partir da **seed secreta**, valida e só então chama as funções do banco com a chave `service_role`. **Sem publicá-la, o modo nuvem não abre a fase** (as funções `open_phase`/`finalize_win` são exclusivas do `service_role`, então o navegador não consegue chamá-las direto).

**Pela CLI (recomendada — sobe o `index.ts` e a pasta `_shared/` de uma vez):** rode da **raiz do projeto** (a pasta que contém `supabase/`). De outra pasta o CLI falha com `Entrypoint path does not exist`:

```bash
supabase login
supabase functions deploy play --project-ref SEU_PROJECT_REF
```

- `SEU_PROJECT_REF` é o ref do projeto (aparece na URL do painel e no subdomínio de `shared/backend/config.js`). Se você já rodou `supabase link`, pode omitir o `--project-ref`.
- **Não** precisa configurar segredos: o Supabase injeta `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` automaticamente (`supabase secrets list` mostra os três). A `service_role` **nunca** vai para o site.
- O aviso `WARNING: Docker is not running` é **inofensivo** no deploy (Docker só é preciso para rodar o Supabase localmente).
- Para conferir que está no ar (deve responder `{"error":"not_authenticated"}` — é o nosso código rodando):

```bash
curl -s -X POST "https://SEU-PROJETO.supabase.co/functions/v1/play" \
  -H "apikey: SUA_ANON" -H "Authorization: Bearer SUA_ANON" \
  -d '{"action":"open","game":"zip"}'
```

**Pelo painel:** Edge Functions → **Deploy a new function** → nome **`play`** → cole `supabase/functions/play/index.ts` e recrie a pasta `_shared/` com os domínios (`_shared/board.js`, `_shared/rng.js`, `_shared/points.js`, `_shared/<jogo>/domain.js`, `_shared/cruzadas/words.js`, `_shared/sopa/words.js`); os caminhos têm que bater exatamente. Se o editor só aceitar um arquivo, use a CLI.

### 3. Configurar o login (Authentication)
- **URL Configuration**
  - *Site URL*: `https://webminigames.vercel.app` (exatamente o endereço do site publicado, sem barra no fim e sem caminho). **É daqui que o link do e-mail de confirmação é montado**: se ficar o valor padrão (`http://localhost:3000`), o link leva a uma página que não existe.
  - *Redirect URLs*: `https://webminigames.vercel.app/**` (e, se testar no seu computador, `http://localhost:3000/**`). Vale para o login com Google e para o modelo de e-mail padrão do Supabase.
- **Sign In / Providers → Email**: já vem ligado.
  - **Confirm email**: ligado é o recomendado para produção (a pessoa recebe um link e confirma). O site já trata os dois casos. Para testar sem e-mail, desligue temporariamente.
  - O envio de e-mails do plano gratuito tem **limite baixo por hora**; para uso real, configure um SMTP próprio (Project Settings → Authentication → SMTP).
- **Google** (opcional): em *Providers → Google*, cole o *Client ID* e o *Client Secret* criados em [console.cloud.google.com](https://console.cloud.google.com) (APIs e serviços → Credenciais → ID do cliente OAuth, tipo "Aplicativo da Web"). Nele, em *URIs de redirecionamento autorizados*, coloque o endereço que o Supabase mostra na tela do provedor (`https://SEU-PROJETO.supabase.co/auth/v1/callback`). Sem isso, o botão do Google mostra um erro; o resto funciona.

### 4. E-mails e senhas (faça antes de abrir para o público)
Detalhes na seção [E-mail de confirmação, remetente e senha](#e-mail-de-confirmação-remetente-e-senha) abaixo. Resumo: cole o modelo de `supabase/templates/confirmacao.html`, configure um SMTP próprio (é o que troca o remetente "Supabase Auth") e defina o mínimo de 8 caracteres.

### 5. Ligar o site ao projeto
**Project Settings → API**: copie a *Project URL* e a chave **anon** (ou *publishable*). Cole em `shared/backend/config.js`:

```js
export const SUPABASE_URL = "https://abcdefgh.supabase.co";
export const SUPABASE_ANON_KEY = "eyJ...";   // anon / publishable
```

Faça commit e push: a Vercel publica sozinha. Esses dois valores são **públicos por natureza** (qualquer navegador precisa deles); quem protege os dados são as regras do banco. **Nunca** coloque aqui a chave `service_role` / `secret`.

### 6. Criar o administrador
1. No site, **crie uma conta** normalmente (com o e-mail que será o do administrador).
2. No **SQL Editor**: `select public.promote_admin('seu@email.com');`
3. Saia e entre de novo: o link **Painel** aparece.

A conta administradora **não pontua nem concorre em rankings** (migração `20261020000000_admin_sem_pontos.sql`): ao vencer, `finalize_win` consome a fase e conta a progressão, mas não grava em `scores` nem em `win_log`, e `ranking(...)` exclui `role = 'admin'`. Serve para testar os jogos à vontade — os coins continuam sendo cobrados (99999, recarregados por dia).

No painel, a seção **"Coins de teste"** (migração `20261025000000_admin_coins.sql`) recarrega os **coins do dia** de qualquer conta pelo e-mail do login, em um jogo ou em todos (`admin_grant_coins`): útil para testar uma conta normal sem esperar a virada do dia. Mexe só em `daily_coins`; pontos, nível e rankings não mudam. Sozinho, isso não cria cenários novos — o nº de cenários do dia continua sendo `coins_per_day`.

Para dar coins de teste pelo **SQL Editor** (sem passar pelo painel): `select public.admin_grant_coins('jogador@exemplo.com', null, 10);` (o 2º argumento é o jogo, ou `null` para todos).

(A conta de administrador de protótipo que está no código, `administrador@administrador.com.br`, só existe no modo local e não vale nada na nuvem.)

### 7. Conferir
- Criar conta → o perfil aparece em **Table Editor → profiles**.
- Vencer uma fase → **scores**, **game_progress**, **win_log** e **coins** mudam.
- Recarregar a página, ou entrar em outro navegador → a fase, o nível, os coins e os pontos continuam.

## E-mail de confirmação, remetente e senha

### Regra de senha do site
Contas novas (cadastro e troca de senha) precisam de **no mínimo 8 caracteres, com 1 número e 1 letra maiúscula** (`shared/password.js`; a tela mostra os requisitos sendo cumpridos enquanto a pessoa digita). O **login** não aplica essa regra, para quem criou conta antes continuar entrando.

O servidor também deve ter um piso: **Authentication → Sign In / Providers → Email** (o nome do menu varia um pouco com a versão do painel) → *Minimum password length* = **8**. As opções de "caracteres obrigatórios" do Supabase não têm "só maiúscula": a mais próxima, *Lowercase, uppercase letters and digits*, exige também minúscula. Se você escolher essa, o site continua com a regra acima e a conta cuja senha for rejeitada pelo servidor vê a mesma mensagem de regra. A regra exata da maiúscula é garantida pelo site, não pelo servidor.

### Modelo do e-mail de confirmação
O arquivo `supabase/templates/confirmacao.html` é o e-mail em português, com a marca do site, botão, endereço por extenso (caso o botão falhe) e versão para modo escuro.

1. **Authentication → Emails → Templates → Confirm sign up**.
2. *Subject*: `Confirme seu e-mail no WebMiniGames`.
3. *Message body*: apague o conteúdo e cole o arquivo inteiro. Salve.
4. Publique o site (o modelo usa o logotipo `assets/email-logo.png`, servido pelo seu próprio site).

O link do botão é `{{ .SiteURL }}/confirmar.html?token_hash=...&type=email`. A página `confirmar.html` valida o código **automaticamente ao abrir** (a validação é feita por JavaScript, então robôs que só baixam a página para checar o link não "gastam" o código), abre a sessão e mostra **"E-mail confirmado!"** com o botão **Ir para os jogos**, que entra já logado. Se o link vencer (por padrão vale 1 hora) ou já tiver sido usado, a própria página explica e pede outro e-mail.

Qualquer e-mail enviado **antes** de trocar o modelo continua com o link antigo (passa pelo Supabase e volta para o site): a página `confirmar.html` também sabe tratar esse formato, desde que a *Site URL* e as *Redirect URLs* da seção 3 estejam corretas.

### Modelo do e-mail de redefinição de senha
O arquivo `supabase/templates/redefinicao.html` é a versão em português do e-mail do "Esqueceu a senha?".

1. **Authentication → Emails → Templates → Reset password**.
2. *Subject*: `Crie uma nova senha no WebMiniGames`.
3. *Message body*: apague o conteúdo e cole o arquivo inteiro. Salve.

O link do botão é `{{ .SiteURL }}/redefinir.html?token_hash=...&type=recovery`, e a página `redefinir.html` abre a sessão e grava a nova senha. O `redirectTo` enviado pelo site também aponta para `redefinir.html`; como ele tem o formato `https://seu-site/redefinir.html`, a *Redirect URL* `https://webminigames.vercel.app/**` da seção 3 já cobre. Sem o modelo próprio, o e-mail padrão do Supabase (em inglês) também funciona, porque a página entende os dois formatos de link.

### Nome do remetente ("Supabase Auth")
O remetente padrão (`Supabase Auth`) **só muda com SMTP próprio**: o envio embutido do Supabase não deixa personalizar o nome, e além disso tem limite baixíssimo de e-mails por hora (serve só para testes).

1. Contrate um serviço de envio (Resend, Brevo, SendGrid, Mailgun, Amazon SES… qualquer um que dê um servidor SMTP).
2. **Authentication → Emails → SMTP Settings** (*Enable custom SMTP*): preencha *Sender email* (o endereço que aparece como remetente, p. ex. `nao-responda@seudominio.com.br`), **Sender name** (`WebMiniGames`) e os dados do SMTP (host, porta, usuário, senha) que o serviço fornece.
3. Para o e-mail chegar na caixa de entrada e não no spam, o serviço pede para você **verificar o domínio** (registros SPF/DKIM no DNS). Por isso o ideal é ter um domínio próprio (um `.com.br` é barato). Enviar "como" `@gmail.com` por serviço de terceiros costuma cair no spam.
4. Ajuste *Rate Limits* em Authentication se precisar de mais cadastros por hora.

Também vale ligar o **CAPTCHA** (Authentication → Attack Protection) e manter *Confirm email* ligado, para evitar contas falsas em massa.

### O link do e-mail leva a uma página que não existe?
1. Passe o mouse sobre o botão do e-mail (sem clicar) e olhe o endereço. Se começar com `http://localhost:3000`, a **Site URL** (seção 3) está com o valor padrão: corrija para `https://webminigames.vercel.app`.
2. Se o endereço for do Supabase (`...supabase.co/auth/v1/verify...`), é o modelo de e-mail antigo: o final `redirect_to=` mostra para onde ele volta. Se não for `https://webminigames.vercel.app/confirmar.html`, a URL não está em **Redirect URLs** (o Supabase então cai na Site URL).
3. Se o endereço for `https://webminigames.vercel.app/confirmar.html?token_hash=...` e mesmo assim der 404, o deploy da Vercel está sem o arquivo `confirmar.html`: confira se o último commit foi publicado.

## Contas criadas antes da migração
Contas que já existiam em **Authentication → Users** antes de rodar o SQL não têm perfil (o gatilho só vale para contas novas). Para criar os perfis delas:

```sql
insert into public.profiles (id, name)
select id, coalesce(nullif(split_part(email, '@', 1), ''), 'Jogador') from auth.users
on conflict do nothing;
```

## Como funciona

**Banco** (`supabase/migrations`). Tudo em `public`, com RLS ligado:

| Tabela | Guarda | Quem escreve |
|---|---|---|
| `games` | lista de jogos e se estão ligados | só o administrador (`enabled`) |
| `settings` | configuração global (hoje: `coins_per_day`) | só `set_coins_per_day` (administrador) |
| `profiles` | nome, apelido, região, foto, papel (`role`) | o próprio dono (menos o `role`); criado por gatilho no cadastro |
| `game_progress` | vitórias por jogo (o nível sobe a cada 15) | só funções |
| `scores` | pontos do ranking | só `finalize_win` |
| `win_log` | histórico de vitórias (e anti-repetição) | só `finalize_win` |
| `phase_runs` | a fase servida (seed secreta, nível, dicas e o puzzle público) | `open_phase`/`use_hint`/`finalize_win` (Edge Function) |
| `coins` | coins por jogo (2 a cada 24 h) | só funções |
| `daily_coins` | coins do **desafio do dia** (2 por dia, zerados à meia-noite de Brasília) | `daily_open` (Edge Function) |
| `daily_runs` | o tabuleiro do dia aberto (slot 1 ou 2, momento de início, dicas) | `daily_open`/`daily_hint` (Edge Function) |
| `daily_results` | o **tempo** de cada conclusão do dia, por jogador/nível/slot | `daily_finish` (Edge Function) |
| `runs` | a fase atual de cada jogo | o próprio dono |
| `activity` | último jogo e fases abertas | só `record_play` |

O navegador **não consegue** escrever pontos, vitórias nem coins — e nem servir a própria fase. Quem decide tudo é a **Edge Function `play`** (só ela tem a chave `service_role` e chama as funções exclusivas do servidor): `open_phase` cobra 1 coin, escolhe o nível e guarda a **seed** (que **nunca** vai ao cliente) junto do **puzzle público sem solução**; `use_hint` conta as dicas; e `finalize_win` recebe o tabuleiro já **validado** pela função (ela regenera a fase a partir da seed e confere), **decide os pontos** pelo nível (a dica só reduz, nunca abaixo de 1), exige uma vitória por jogo a cada `phase_min_seconds` (anti-farm), consome a fase e ignora um reenvio (mesmo id, para a fila offline). `ranking(...)` monta os rankings no servidor e nunca expõe e-mail.

**Desafio diário** (migrações `20261021000000_desafio_diario.sql` e `20261022000000_diario_configuravel.sql`). Na nuvem o jogo é **só o desafio do dia** (a fase aleatória saiu; no modo local/visitante ela continua). Todo mundo joga o **mesmo cenário do dia** por nível — a seed do dia é derivada de `dia + jogo + nível + slot` (nunca vai ao cliente) e o placar é o **tempo**, contado no servidor (`now() − started_at`). Cada jogador tem **coins do dia** (separados dos coins normais): **um coin abre um cenário** do dia, e a quantidade de cenários por nível é igual aos coins do dia. O valor é **global e configurável pelo administrador** (`settings.coins_per_day`, função `set_coins_per_day`, pelo painel) — hoje 2, de 1 a `max_scenarios()` (10); mudar o valor muda o nº de cenários sem gerar nada (são derivados). Vale o **melhor tempo** entre os cenários concluídos. Cada dica soma **+30 s** ao tempo daquele cenário. O dia (`daily_day()`) é o de **Brasília**, então os coins do dia zeram à meia-noite local. Abandonar (fechar sem concluir) **perde o coin e não entra no ranking** — reabrir consome outro coin. **Concluir também pontua e sobe a progressão** (uma vez por cenário/dia), então os DOIS rankings convivem: o de **tempo** do dia e o de **pontos** (a conta administradora segue sem pontuar). Vale para **todos os sete jogos** (o `daily_open` aceita qualquer jogo cadastrado em `games` e a geração/validação do tabuleiro do dia roda em `supabase/functions/play/_shared/board.js`). As ações `daily_open`/`daily_hint`/`daily_finish` rodam na Edge Function `play`; o cliente lê a situação com `daily_status()` (inclui `slots`) e o placar com `daily_leaderboard(jogo, nível)` (essa liberada ao `anon`, como o `ranking`). Cada UI serve o cenário do dia automaticamente (sem escolha) e usa `daily_hint` (sopa/cruzadas) quando o jogo tem dica. `delete_my_account()` (migração `20261017000000_delete_account.sql`) apaga a própria conta em `auth.users`; o `on delete cascade` leva embora, junto, todo o rastro do jogador.

**Site** (`shared/backend/`; a biblioteca do Supabase vem do próprio repositório, `vendor/supabase-js.mjs`, sem CDN):
- `boot.js` é importado como **primeira linha de cada página**. Ele carrega os dados da conta de uma vez para um cache em memória; os jogos continuam lendo coins, fase e nível de forma síncrona, e as escritas vão para o servidor em segundo plano.
- `cloud.js` concentra o acesso ao Supabase. Os serviços de `shared/` (`Coins`, `Run`, `Scores`, `Profile`, `GameSwitch`, `Progress`, `AdminLevel`) e `js/auth.js` escolhem sozinhos entre local e nuvem.
- **A fase é servida pelo servidor**: o jogo chama `Cloud.open` (Edge Function `play`) e recebe o puzzle **sem a solução**, pronto para desenhar; ao concluir, manda o **tabuleiro** em `Scores.submit`/`Cloud.finish` e o servidor só pontua se ele bater com a seed guardada. No modo local nada disso acontece: o puzzle é gerado no navegador, como antes.
- **Vitórias** entram numa fila guardada no navegador (com o tabuleiro e um id único): sem internet, ficam esperando e são reenviadas depois **sem contar em dobro**. Se o servidor recusar por ritmo (`too_fast`), a vitória **continua na fila** e é reenviada mais tarde (uma de cada vez) — terminar várias fases offline não perde nenhuma. Se recusar por tabuleiro inválido, sai da fila.
- **Falha ao carregar a conta**: o site avisa numa faixa vermelha e usa o armazenamento local, **sem gravar** na nuvem (para nunca sobrescrever o que está no servidor com dados vazios).

**Regra para páginas e jogos novos**: importe `shared/backend/boot.js` primeiro, leia/grave vitórias por `Progress` (nunca direto no `localStorage`) e, no banco, cadastre o jogo em `games` e em `js/games.js` com a mesma id (`tests/supabase.test.js` confere).

## Testes
- `npm test`: inclui `tests/supabase.test.js` (o SQL e o JS precisam concordar em níveis, pontos, coins, regiões e jogos; RLS ligado em toda tabela; o visitante e o cliente só têm as permissões mínimas), `tests/cloud.test.js` (modo nuvem com um cliente simulado: cache, fila, reenvio, modo degradado) e `tests/edge.test.js` (validação server-side de cada jogo + paridade das cópias dos domínios com `games/`).
- `supabase test db` (CLI do Supabase, precisa de Docker): roda `supabase/tests/database/*.test.sql` (pgTAP) contra um banco local com a migração. Cobre RLS, permissões, cada função, idempotência, tetos de pontos, recarga de coins e ranking.

## Limites e próximos passos
1. **Validação de jogada no servidor (todos os sete jogos).** A Edge Function `play` serve a fase (seed secreta + puzzle sem solução) e valida o tabuleiro antes de pontuar — ligada de ponta a ponta em **zip, patches, canos, sudoku, cruzadas, sopa e arrows**. Cada UI chama `Cloud.open`, desenha a visão pública e, ao concluir, manda o tabuleiro via `Scores.submit(game, points, { state })` → `Cloud.finish`; a validação de cada jogo está em `supabase/functions/play/_shared/board.js` (com testes em `tests/edge.test.js`). A visão pública **não** entrega a solução em jogo nenhum: em `sopa` as palavras vão só com o texto (sem as células) e o servidor confere a seleção do jogador; em `cruzadas` cada casa de letra vira `cap` (quantas letras cabem) e cada resposta vira `len` (o tamanho), de modo que a UI desenha e fecha a grade sem nunca receber as letras — quem diz se está certa é o servidor, pelo `Cloud.finishNow`. Andamento parcial (letras/palavras achadas) **não** é retomado após recarregar a página no modo nuvem: a fase e as dicas voltam do snapshot, mas o preenchimento recomeça.
2. **Foto de perfil** é guardada como imagem `data:` no próprio perfil (até 100 mil caracteres). Para muitos usuários, migrar para o **Storage** e guardar só a URL.
3. **Dados do protótipo local não migram** (contas e senhas locais ficam só no navegador antigo). Ao ligar a nuvem, a sessão local é descartada e a pessoa cria a conta de novo.
4. **Contas sem região** (Google, ou criadas antes do campo de região) ficam fora do ranking regional até escolherem uma. O seletor de região está no **Meu perfil** (`Profile.setRegion` → `profiles.region`) e vale para qualquer conta.
5. Falta: listar contas no painel do administrador (a exclusão da própria conta já existe: `delete_my_account`, no fim do perfil).
6. Índices extras no ranking só valem a pena com muitos jogadores.
