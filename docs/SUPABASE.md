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

### 3. Configurar o login (Authentication)
- **URL Configuration**
  - *Site URL*: `https://webminigames.vercel.app`
  - *Redirect URLs*: `https://webminigames.vercel.app/**` (e, se testar no seu computador, `http://localhost:3000/**`)
- **Sign In / Providers → Email**: já vem ligado.
  - **Confirm email**: ligado é o recomendado para produção (a pessoa recebe um link e confirma). O site já trata os dois casos. Para testar sem e-mail, desligue temporariamente.
  - O envio de e-mails do plano gratuito tem **limite baixo por hora**; para uso real, configure um SMTP próprio (Project Settings → Authentication → SMTP).
- **Google** (opcional): em *Providers → Google*, cole o *Client ID* e o *Client Secret* criados em [console.cloud.google.com](https://console.cloud.google.com) (APIs e serviços → Credenciais → ID do cliente OAuth, tipo "Aplicativo da Web"). Nele, em *URIs de redirecionamento autorizados*, coloque o endereço que o Supabase mostra na tela do provedor (`https://SEU-PROJETO.supabase.co/auth/v1/callback`). Sem isso, o botão do Google mostra um erro; o resto funciona.

### 4. Ligar o site ao projeto
**Project Settings → API**: copie a *Project URL* e a chave **anon** (ou *publishable*). Cole em `shared/backend/config.js`:

```js
export const SUPABASE_URL = "https://abcdefgh.supabase.co";
export const SUPABASE_ANON_KEY = "eyJ...";   // anon / publishable
```

Faça commit e push: a Vercel publica sozinha. Esses dois valores são **públicos por natureza** (qualquer navegador precisa deles); quem protege os dados são as regras do banco. **Nunca** coloque aqui a chave `service_role` / `secret`.

### 5. Criar o administrador
1. No site, **crie uma conta** normalmente (com o e-mail que será o do administrador).
2. No **SQL Editor**: `select public.promote_admin('seu@email.com');`
3. Saia e entre de novo: o link **Painel** aparece.

(A conta de administrador de protótipo que está no código, `administrador@administrador.com.br`, só existe no modo local e não vale nada na nuvem.)

### 6. Conferir
- Criar conta → o perfil aparece em **Table Editor → profiles**.
- Vencer uma fase → **scores**, **game_progress**, **win_log** e **coins** mudam.
- Recarregar a página, ou entrar em outro navegador → a fase, o nível, os coins e os pontos continuam.

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
| `profiles` | nome, apelido, região, foto, papel (`role`) | o próprio dono (menos o `role`); criado por gatilho no cadastro |
| `game_progress` | vitórias por jogo (o nível sobe a cada 15) | só funções |
| `scores` | pontos do ranking | só `submit_win` |
| `win_log` | histórico de vitórias (e anti-repetição) | só `submit_win` |
| `coins` | coins por jogo (2 a cada 24 h) | só funções |
| `runs` | a fase atual de cada jogo | o próprio dono |
| `activity` | último jogo e fases abertas | só `record_play` |

O navegador **não consegue** escrever pontos, vitórias ou coins: só chama funções, que validam tudo (`submit_win` confere o jogo, limita os pontos ao teto do nível, gasta 1 coin e ignora uma vitória reenviada). `ranking(...)` monta os rankings no servidor e nunca expõe e-mail.

**Site** (`shared/backend/`; a biblioteca do Supabase vem do próprio repositório, `vendor/supabase-js.mjs`, sem CDN):
- `boot.js` é importado como **primeira linha de cada página**. Ele carrega os dados da conta de uma vez para um cache em memória; os jogos continuam lendo coins, fase e nível de forma síncrona, e as escritas vão para o servidor em segundo plano.
- `cloud.js` concentra o acesso ao Supabase. Os serviços de `shared/` (`Coins`, `Run`, `Scores`, `Profile`, `GameSwitch`, `Progress`, `AdminLevel`) e `js/auth.js` escolhem sozinhos entre local e nuvem.
- **Vitórias** entram numa fila guardada no navegador, cada uma com um id único: sem internet, ficam esperando e são reenviadas depois **sem contar em dobro**.
- **Falha ao carregar a conta**: o site avisa numa faixa vermelha e usa o armazenamento local, **sem gravar** na nuvem (para nunca sobrescrever o que está no servidor com dados vazios).

**Regra para páginas e jogos novos**: importe `shared/backend/boot.js` primeiro, leia/grave vitórias por `Progress` (nunca direto no `localStorage`) e, no banco, cadastre o jogo em `games` e em `js/games.js` com a mesma id (`tests/supabase.test.js` confere).

## Testes
- `npm test`: inclui `tests/supabase.test.js` (o SQL e o JS precisam concordar em níveis, pontos, coins, regiões e jogos; RLS ligado em toda tabela; o visitante e o cliente só têm as permissões mínimas) e `tests/cloud.test.js` (modo nuvem com um cliente simulado: cache, fila, reenvio, modo degradado).
- `supabase test db` (CLI do Supabase, precisa de Docker): roda `supabase/tests/database/*.test.sql` (pgTAP) contra um banco local com a migração. Cobre RLS, permissões, cada função, idempotência, tetos de pontos, recarga de coins e ranking.

## Limites e próximos passos
1. **Pontos por vitória são pedidos pelo navegador** (o servidor só limita ao teto do nível). Quem editar o JavaScript consegue se dar o máximo do nível a cada vitória, mesmo sem jogar, mas não passa disso nem muda coins/nível de graça. Validar a vitória de verdade exigiria rodar a lógica de cada jogo no servidor (Edge Function).
2. **Foto de perfil** é guardada como imagem `data:` no próprio perfil (até 100 mil caracteres). Para muitos usuários, migrar para o **Storage** e guardar só a URL.
3. **Dados do protótipo local não migram** (contas e senhas locais ficam só no navegador antigo). Ao ligar a nuvem, a sessão local é descartada e a pessoa cria a conta de novo.
4. **Contas Google não têm região** (não há tela para escolher): ficam fora do ranking regional. A coluna `profiles.region` já permite gravar; falta o seletor no perfil.
5. Falta: excluir a própria conta (LGPD), recuperar senha ("esqueci a senha"), personalizar os e-mails do Supabase, listar contas no painel do administrador.
6. Índices extras no ranking só valem a pena com muitos jogadores.
