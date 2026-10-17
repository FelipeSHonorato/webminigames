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

O link do botão é `{{ .SiteURL }}/confirmar.html?token_hash=...&type=email`. A página `confirmar.html` mostra um botão **Confirmar meu e-mail**, e só o clique valida o código. Isso evita um problema comum: antivírus e leitores de e-mail (Outlook, Gmail com verificação de links) abrem os links sozinhos para checá-los e "gastam" o código antes da pessoa clicar, que então vê "link expirado". Com o clique, esses robôs não confirmam nada. Se o link vencer (por padrão vale 1 hora) ou já tiver sido usado, a própria página explica e pede outro e-mail.

Qualquer e-mail enviado **antes** de trocar o modelo continua com o link antigo (passa pelo Supabase e volta para o site): a página `confirmar.html` também sabe tratar esse formato, desde que a *Site URL* e as *Redirect URLs* da seção 3 estejam corretas.

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
