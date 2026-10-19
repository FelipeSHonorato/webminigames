# WebMiniGames

Site de mini-games de lógica que roda direto no navegador, sem build e sem dependências para instalar (módulos ES puros; a biblioteca do Supabase, quando usada, vem do próprio repositório em `vendor/`). Reúne sete jogos: dois inspirados nos puzzles diários do LinkedIn (Zip e Patches), os clássicos Sudoku, Sopa de Letras e Palavras Cruzadas, o Conexão de Canos e o Fuga das Setas:

- **Zip:** trace um único caminho passando pelos números em ordem e por todas as células. Paredes bloqueiam a passagem.
- **Patches:** divida a grade em retângulos; cada um tem exatamente uma pista, com a área (número) e o formato (quadrado, largo, alto ou qualquer).
- **Sudoku:** preencha a grade 9×9 para que cada linha, coluna e bloco 3×3 tenha os números de 1 a 9, sem repetir. Tem anotações, desfazer, destaque de repetidos e suporte a teclado.
- **Sopa de Letras:** ache todas as palavras da lista, escondidas na horizontal, vertical e diagonal, inclusive de trás para frente. Clique e arraste (ou deslize o dedo) do começo ao fim da palavra. A lista fica ao lado da grade, com as palavras ocultas. O botão **Dica** revela mais uma letra de cada palavra que falta e custa 1 ponto da fase (nunca menos que 1).
- **Palavras Cruzadas:** cruzadinha no estilo brasileiro, com as dicas dentro da grade, em casas amarelas (uma ou duas por casa) e uma seta que mostra onde a resposta começa (→ ↓ ↴ ↳). Como o texto fica pequeno, tocar na dica mostra o texto inteiro ao lado e destaca a linha da resposta. Com uma dica selecionada, o botão **Dica** preenche a próxima letra daquela resposta (da primeira à última) e custa 1 ponto da fase (nunca menos que 1). Casas divididas por uma diagonal (`\`) recebem **duas letras** (um dígrafo, como CH, LH ou NH), digitadas uma de cada vez. Tem teclado da tela no celular, ‹ › para trocar de dica e andamento salvo.
- **Conexão de Canos:** cada quadrado tem um cano (reto, curva, T ou cruz) e cada clique o gira 90° (botão direito ou Shift + clique gira para o outro lado). Ligue a entrada à saída, que ficam fora da grade. A contagem regressiva (1, 1,5, 2 e 3 minutos) começa no primeiro giro; quando acaba, a água corre casa por casa. Se uma ponta de cano ficar sem ligação antes de a água chegar à saída, ela vaza e o jogo termina: tenta-se o mesmo cenário de novo, sem gastar coin.
- **Fuga das Setas:** cada seta é uma **peça com curvas** que escoa pelo próprio caminho e sai na direção da ponta. Ela só sai se o **corredor da ponta** estiver livre — outra peça encostada no corpo não trava. Os **blocos escuros** são obstáculos fixos: nenhuma seta ocupa essas casas e quem aponta para elas fica travada. Tocar numa seta travada custa uma **vida** (são 3). Ao perder as três, o tabuleiro volta ao início — mas o **cronômetro continua correndo**. Tire todas as setas para vencer.

Os sete têm quatro níveis (Fácil, Médio, Difícil e Genius). O nível sobe a cada 15 vitórias, por jogo e por usuário, e as fases são geradas na hora, sempre com solução única.

Cada jogo tem um **som de fundo lo-fi próprio**, sintetizado no navegador (Web Audio, sem arquivos de áudio): pads suaves, baixo, melodia esparsa, percussão discreta e chiado de vinil. O som só começa depois do primeiro clique ou tecla e pode ser silenciado no **botão de alto-falante ao lado do tema**; passando o mouse (ou tocando no botão) abre o **regulador de volume**, e tanto o mudo quanto o volume ficam salvos.

## Pontuação e ranking

Cada partida vencida vale pontos conforme o nível em que a fase foi gerada: **Fácil 5, Médio 10, Difícil 15, Genius 20**. Os pontos só são gravados quando o cenário é concluído. Só contas pontuam; jogadores anônimos veem o ranking, mas não aparecem nele.

Cada jogo tem um painel lateral de ranking, aberto ao entrar (em telas largas) e recolhível pela aba "Ranking". No modo local ele tem duas visões: **Geral** e **Minha região** (a região é escolhida no cadastro e pode ser ajustada depois, no **Meu perfil**). Empates são resolvidos por quem chegou primeiro à pontuação. Cada linha mostra a posição, a foto do jogador (ou um avatar padrão), o nome e os pontos. Na página de jogos (`jogos.html`) há também o **Ranking geral**, que soma os pontos de todos os jogos, numa janela fixa ao lado dos jogos (sempre visível, sem opção de ocultar; em telas estreitas ela passa para baixo dos jogos). Com a **nuvem ligada**, o painel ganha ainda a visão **Tempo do dia** (veja [Desafio diário](#desafio-diário)).

## Desafio diário

Com o **Supabase ligado**, os jogos passam a ser **só o desafio do dia** (a fase aleatória continua no modo local/visitante). Todo mundo pega o **mesmo cenário do dia** — na verdade, o mesmo cenário **por nível**: a seed é derivada no servidor de `dia | jogo | nível | slot` e **nunca** chega ao navegador, então ninguém recebe a solução antes de jogar.

- **Coins do dia = cenários:** cada jogador recebe um número de coins por dia igual ao número de cenários daquele dia (**um coin abre um cenário**). O valor é **global e configurável pelo administrador**, no painel (`admin.html`, seção "Desafio diário"), de 1 a 10 — hoje o padrão é **2**. Os coins do dia zeram à **meia-noite de Brasília**. O **card de cada jogo** no hub mostra esse mesmo saldo do dia (o mesmo que aparece dentro do jogo), atualizado ao carregar e quando o dia vira.
- **Sem escolher cenário:** ao entrar, o servidor serve **sozinho** o próximo cenário que ainda falta (gastando o coin na hora) e o botão do jogo vira **"Próximo cenário"**, que avança para o próximo não concluído. O painel ao lado mostra, por cenário, `pendente` / `jogando` / o tempo, e o melhor tempo do dia.
- **Ranking por tempo:** o tempo é medido no **servidor** (`now() − started_at`), e cada dica soma **+30 s**. Vale o **melhor tempo** entre os cenários concluídos. Abandonar (fechar antes de concluir) **perde o coin e não entra no ranking** — reabrir consome outro coin.
- **Troféus do cenário:** ao vencer, os troféus aparecem **no meio do tabuleiro**, que fica coberto por uma cor translúcida, num cartão de **fundo opaco** (só o véu sobre o tabuleiro é translúcido) — em que percentual você ficou (**melhor que X%** dos jogadores), se ficou **acima/abaixo da média** de tempo do dia e a sua **posição na região** — sempre comparando apenas quem jogou **o mesmo cenário** (mesmo nível e slot); quem jogou sozinho aparece na média. Os troféus **permanecem na tela até você fechar no × (ou no Esc)**: clicar em outro lugar do site não os tira. Tocar num cenário já vencido reabre os troféus. O critério é o **menor tempo**; empates desempatam por **mais pontos** (menos dicas).
- **Dois rankings:** concluir também **pontua e sobe a progressão** (uma vez por cenário/dia), então o painel alterna entre **Tempo do dia** e **Pontos** (o de pontos é o mesmo de sempre). A conta administradora progride, mas não entra em ranking nenhum.

## Reiniciar

Zip, Patches, Sudoku e Conexão de Canos têm o botão **Reiniciar**. Ele só funciona enquanto o cenário **não foi concluído**: com a fase vencida (ou ao recarregar uma fase já concluída) o botão fica desabilitado e só resta **Nova fase**. Reiniciar limpa o tabuleiro **sem zerar o cronômetro**: nos três jogos de contagem crescente o tempo segue de onde estava; no Canos, com a contagem regressiva em andamento, os canos voltam à posição inicial e o relógio continua correndo. No Canos, depois que a água vaza, o botão vira **Tentar de novo** e abre uma tentativa nova, com o relógio cheio (a contagem recomeça no primeiro giro). Sopa de Letras e Palavras Cruzadas não têm Reiniciar. Com o **Supabase** ligado a fase aleatória dá lugar ao **Desafio diário** (veja acima).

## Coins

**No modo local**, cada jogador recebe **2 coins por jogo a cada 24 horas**; não acumulam (o saldo nunca passa de 2). **O coin só é gasto quando a fase é concluída.** O botão **Nova fase** só habilita com a fase atual concluída e pelo menos 1 coin; sem coins, o saldo mostra quando chegam os próximos. O saldo aparece como `[moeda] x 2` ao lado do nome do jogo, nos cards de `jogos.html` e na barra superior de cada jogo.

A fase atual é salva por seed (`shared/run.js`): recarregar a página devolve a mesma fase, e uma fase concluída volta mostrando a solução, sem pontuar nem gastar coin de novo. A lógica fica em `shared/coins.js`. No **modo local** os coins ficam no `localStorage` — mudar o relógio ou o `localStorage` burla o limite.

Com o **Supabase** ligado, o jogo é o **desafio do dia** e a regra muda: valem os **coins do dia** (um coin abre um cenário, valor global configurável, zeram à meia-noite de Brasília) — veja [Desafio diário](#desafio-diário). Recarga, gasto, tempo e validação das jogadas são calculados no servidor.

## Conta administradora

No **modo local** existe uma conta administradora, criada automaticamente na primeira tentativa de login ou cadastro: nome `administrador`, e-mail `administrador@administrador.com.br` e senha `administrador`. Ela tem **99999 coins por jogo** (gasta ao concluir fases, como as demais, e a recarga de 24 h devolve o saldo a 99999) e acessa o **Painel** (`admin.html`, link na barra superior), com uma chave liga/desliga para cada jogo. Com o **Supabase** ligado, essa conta de protótipo não vale: crie uma conta normal e rode `select public.promote_admin('seu@email.com');` no SQL Editor ([docs/SUPABASE.md](docs/SUPABASE.md)).

- **Jogo desligado:** os jogadores não entram nele (o card fica como "Desligado" e a página redireciona); o administrador continua entrando.
- **Pontos preservados:** desligar não remove nada. Os pontos continuam no ranking do jogo, no ranking geral e no perfil de cada jogador.
- **Nível para testar:** em cada jogo da lista há os botões Fácil · Médio · Difícil · Genius. Escolher um nível coloca o jogo, **só para a conta do administrador**, no início desse nível (0/15) e descarta a fase salva dela; ao abrir o jogo, nasce uma fase nova nesse nível. Assim dá para testar todos os níveis sem jogar até lá. Jogadores, pontos e rankings não mudam (`shared/admin-level.js`).
- **Desafio diário:** a seção "Desafio diário" do painel define quantos **coins (e cenários) por dia** cada jogador recebe, de 1 a 10 — vale para todos os jogos. É o mesmo valor global que aparece em `shared/admin-config.js` e no snapshot da nuvem.
- **Coins de teste:** a seção "Coins de teste" recarrega os **coins do dia** de uma conta, pelo e-mail do login (só com a nuvem ligada), em um jogo ou em todos. Usa a função `admin_grant_coins` (restrita ao administrador, migração `20261025000000_admin_coins.sql`): mexe só no saldo do dia (`daily_coins`), sem tocar em pontos, nível, vitórias nem no resultado dos cenários — útil para testar sem esperar a virada do dia (`shared/admin-coins.js`).
- **Atenção:** a senha está no código-fonte (`js/auth.js`) e a chave fica no `localStorage` de quem a mudou, então só vale neste navegador. Em produção, crie o administrador no servidor com senha forte e guarde o estado dos jogos no servidor.

## Backend (Supabase)

As contas e os registros podem ficar no **Supabase** (Postgres + login): preencha `SUPABASE_URL` e `SUPABASE_ANON_KEY` em `shared/backend/config.js` e rode no SQL Editor os arquivos de `supabase/migrations/` na ordem, do `20261014000000_init.sql` ao `20261025000000_admin_coins.sql`. Vazio, o site continua no **modo local** (tudo no navegador). Com a nuvem ligada: contas reais (e-mail/senha e Google), progresso, pontos, **coins do dia**, o **desafio diário**, rankings e liga/desliga de jogos compartilhados por todos; o **servidor** decide pontos, nível e coins, e a **Edge Function `play`** serve e valida cada jogada. Passo a passo e funcionamento: [docs/SUPABASE.md](docs/SUPABASE.md). O e-mail de confirmação em português está em `supabase/templates/` (como colar e como trocar o remetente: mesma doc). Senha de conta nova: mínimo de 8 caracteres, com 1 número e 1 letra maiúscula.

## Perfil

Depois do login, a barra superior mostra a foto do usuário (ou um avatar padrão), um link com engrenagem para as configurações um **switch de modo escuro** (sol e lua) e o botão **Deslogar**. Em `perfil.html` a conta pode definir um **apelido** (único, 3 a 20 caracteres, usado no ranking), enviar uma **foto** (recortada e reduzida no navegador), **trocar a senha** (informando a atual) e ver a lista de jogos com o **último horário jogado** e a **pontuação** de cada um. Os campos de senha (entrada, perfil e nova senha) têm um botão de **olho** para mostrar ou ocultar o que foi digitado. No fim da página fica **Excluir conta**: um popup pede a senha atual e apaga a conta e **todos** os dados dela. Anônimos não têm perfil: a barra deles mostra "Anônimo" e, no lugar de Deslogar, os botões **Entrar** e **Criar conta**, que voltam à tela de entrada já na aba escolhida (`index.html?modo=entrar` ou `?modo=conta`), sem perder a sessão anônima até o login.

## Recuperar senha

Na tela de entrada, o link **Esqueceu a senha?** pede o e-mail e o Supabase envia um link para a pessoa criar uma nova senha (`redefinir.html`). A senha nunca é enviada por e-mail: o sistema guarda só o hash, então o caminho é sempre definir uma nova. Isso depende da conta estar na nuvem (Supabase); no modo local a tela explica que a recuperação por e-mail não existe. Passo a passo do modelo de e-mail e do link: [docs/SUPABASE.md](docs/SUPABASE.md).

## Excluir conta

**Excluir conta** (LGPD), no fim do perfil, abre um popup que pede a **senha atual**; ao confirmar, a conta e todo o seu rastro são apagados. Na nuvem, o navegador confirma a senha e o banco apaga a linha da conta no servidor (função `delete_my_account`, migração `supabase/migrations/20261017000000_delete_account.sql`): o perfil, a progressão, os pontos, as fases, os coins e a atividade caem por cascata. No modo local, a conta sai do `localStorage` e tudo o que era dela é limpo. Contas sem senha (Google) confirmam só no popup — a sessão já autentica — e a conta administradora do protótipo não pode ser excluída.


## Modo escuro

O switch de sol e lua na barra superior (também na tela de entrada) liga e desliga o tema escuro. Sem escolha salva, o site segue o tema do sistema. A preferência fica em `localStorage` (`wmg.theme`) e é aplicada por `shared/theme-init.js` no `<head>`, antes da primeira pintura, para a página não piscar no tema errado.

## Rodando localmente

**Não abra o `index.html` com duplo clique.** Os navegadores bloqueiam módulos ES em `file://`: a página aparece, mas nenhum botão funciona. Rode um servidor local na pasta do projeto:

```bash
npm start                       # requer Node (o serve.json evita os redirecionamentos de "clean URLs", que quebram os caminhos relativos)
python -m http.server 8000      # alternativa com Python (no Mac/Linux: python3)

# depois abra http://localhost:8000 (o npm start mostra a porta no terminal)
```

## Testes

Requer Node 20 ou superior. Não há dependências para instalar.

```bash
npm test                        # roda tudo com o runner nativo do Node
npm run test:db                 # opcional: pgTAP no Supabase local (precisa da CLI do Supabase e Docker)
```

`npm test` cobre as regras, o solver e o gerador dos sete jogos (cada nível precisa gerar fase de solução única), a progressão de níveis, coins, ranking, perfil, regra de senha, painel do administrador e o backend: `tests/supabase.test.js` falha se o SQL de `supabase/migrations` divergir do JavaScript (níveis, pontos, coins, regiões, jogos, RLS e permissões), e `tests/cloud.test.js` exercita o modo nuvem com um cliente simulado (cache, fila de vitórias, reenvio sem contar em dobro e modo degradado).

## Publicando no GitHub Pages

1. Crie o repositório, envie o código para a branch `main` e vá em **Settings → Pages**.
2. Em **Source**, escolha **GitHub Actions**.
3. A cada push na `main`, o workflow `.github/workflows/pages.yml` roda os testes e publica o site.

Todos os caminhos são relativos, então o site funciona em `https://<usuario>.github.io/<repositorio>/`.

Como no modo local não há backend, o site fica totalmente estático. O workflow também publica a pasta `vendor/`, de onde a biblioteca do Supabase é carregada quando a nuvem está ligada.

## Estrutura

```
index.html            página de entrada (criar conta, Google simulado, anônimo, "Esqueceu a senha?")
jogos.html            página com os jogos disponíveis (exige sessão)
perfil.html           perfil: apelido, foto, senha, meus jogos e excluir conta (exige conta)
admin.html            painel do administrador: liga/desliga de cada jogo, nível de teste, desafio diário (coins/cenários por dia) e coins de teste por conta
confirmar.html        confirma o e-mail pelo link enviado e abre a sessão
redefinir.html        cria a nova senha, aberto pelo link do "Esqueceu a senha?"
assets/               favicon.svg e email-logo.png (ícones e logotipo dos e-mails)
css/                  site.css, gamebar.css (barra dos jogos), ranking.css (painel lateral) e ranking-list.css (linhas e abas do ranking), daily.css (painel do desafio diário), coins.css, userbar.css
js/                   login.js, hub.js, perfil.js, admin.js, confirmar.js e redefinir.js (uma por página), auth.js (contas), password-rules.js (requisitos da senha), userbar.js, games.js (catálogo)
shared/               roles.js, game-switch.js (liga/desliga dos jogos), coins.js, run.js, coin-badge.js (coins e fase atual), theme.js e theme-init.js (modo escuro), rng.js, storage.js, session.js, progress.js (níveis e pontos), admin-level.js (nível de teste do administrador), regions.js, ranking-list.js (linhas e abas do ranking),
                      scores.js (pontuação e ranking), ranking-panel.js (painel lateral),
                      profile.js (apelido, foto, atividade), avatar.js (redimensiona a foto), password.js (regra de senha), password-toggle.js (botão de mostrar/ocultar senha), admin-config.js (config do desafio diário no painel), admin-coins.js (coins de teste por conta no painel), capture-auth-hash.js (guarda o "#" do link), file-warning.js (aviso no file://)
  backend/            config.js (URL/chave do Supabase; vazio = modo local), boot.js (carrega a conta), cloud.js (acesso ao Supabase), auth-redirect.js (lê o link do e-mail)
games/<jogo>/
  domain.js           regras, solver e gerador (puro, sem DOM)
  ui.js               renderização e entrada (Pointer Events)
  index.html, style.css
  words.js            vocabulário de Sopa de Letras e Palavras Cruzadas
supabase/             migrations/ (esquema do banco), functions/play/ (Edge Function que serve e valida as fases e o desafio do dia), templates/ (e-mails em pt-BR) e tests/database/ (pgTAP)
vendor/               supabase-js.mjs (biblioteca do Supabase, versão fixa, sem CDN)
tests/                testes com o runner nativo do Node
docs/                 CONTINUAR.md (estado e próximos passos) e SUPABASE.md (passo a passo do backend)
```

Fluxo: `index.html` (entrada) → `jogos.html` (lista de jogos) → `games/<jogo>/` (cada jogo é uma página própria, com o botão "← Jogos"). O login grava a sessão em `localStorage` (`wmg.session`); as páginas de jogos e a lista exigem essa sessão e o progresso é gravado por usuário.

## Como os jogos funcionam

- **Zip:** o solver é um DFS com poda (conectividade das células livres, becos sem saída e ordem dos números). O gerador cria um caminho hamiltoniano aleatório (heurística de Warnsdorff), espalha os números ao longo dele e adiciona paredes até a solução ser única.
- **Patches:** o solver faz cobertura exata por backtracking, sempre escolhendo a pista com menos retângulos possíveis. O gerador particiona a grade em retângulos, sorteia as pistas e só aceita a fase se a solução for única. Níveis mais altos têm mais pistas incompletas (ícone "qualquer" ou sem número).
- **Sudoku:** o solver é um backtracking com bitmasks que sempre escolhe a célula com menos candidatos. O gerador sorteia uma grade completa e tira pistas em ordem aleatória, mantendo só as retiradas que preservam a solução única. O nível define quantas pistas sobram: Fácil 40, Médio 34, Difícil 30 e Genius 26 (a dificuldade é medida só por esse número, não pelas técnicas necessárias). Gera em poucos milissegundos, sem precisar de Web Worker.
- **Patches e pista "1":** só o Fácil tem patches de uma célula (pista "1"); do Médio em diante a partição nunca sorteia retângulos 1×1.
- **Sopa de Letras:** grades 5×5, 10×10, 15×15 e 20×20 (Fácil a Genius), com 4–5, 6–8, 9–12 e 13–16 palavras; o tamanho máximo de palavra é o lado da grade (Fácil: até 5 letras). O gerador sorteia as palavras de um vocabulário pt-BR (`games/sopa/words.js`, sem acento na grade) e as posiciona por backtracking nas 8 direções, cruzando só onde a letra coincide. **Toda fase tem palavras na diagonal desde o Fácil** (mínimo garantido de 1, 2, 3 e 4 por nível; no total ficam em torno de 25%, 36%, 37% e 39% das palavras), nos dois sentidos de cada diagonal; duas palavras nunca são iguais nem uma está dentro da outra. A grade é preenchida com letras na frequência do português. Qualquer ocorrência de uma palavra na grade vale na seleção. **Dicas:** até N−1 por fase (Fácil 4, Médio 9, Difícil 14, Genius 19), cada uma custa 1 ponto e mostra mais uma letra de cada palavra que falta, sem nunca revelar a palavra inteira; como os pontos são 5/10/15/20, o piso é sempre 1. As dicas gastas e as palavras achadas ficam salvas na fase, então recarregar a página não zera o custo.
- **Palavras Cruzadas:** grades 7×7, 9×9, 11×11 e 13×13 (Fácil a Genius), com ~9, 13, 18 e 24 respostas. O vocabulário (`games/cruzadas/words.js`, cerca de 590 respostas com dica, escritas sem acento) é a parte a ampliar. O gerador começa por uma resposta no miolo e vai acrescentando as que cruzam, onde cada nova resposta precisa de uma casa de dica livre na posição da seta e não pode criar sequência de letras sem dica; uma casa de dica aceita uma segunda dica da outra metade. **Casas de duas letras:** cada resposta com dígrafo (CH, LH, NH, RR, SS, QU, GU) pode ocupar uma casa a menos, com o dígrafo numa casa só, marcada com a diagonal `\`; toda fase tem ao menos uma (Fácil 1–2, Médio 1–3, Difícil 2–4, Genius 3–6), e elas nunca são cruzamento. A 1ª letra fica no triângulo mais perto da casa anterior da resposta. Em **nenhuma** casa dupla a dica preenche as duas letras (nem `R\R` e `S\S`, nem CH, LH, NH, QU ou GU): ela revela só a **primeira** (1 ponto) e a outra o jogador digita. A casa não trava, o cursor fica nela, e a dica não revela a segunda letra (se só ela faltar, o botão fica indisponível). Casas sem uso são pretas (`#000000`), nos dois temas. Casas sem uso são só cor. Limites por fase de respostas de 2 letras e de siglas evitam grades repetitivas, e o gerador refaz a grade até ter ≥46% de letras (e as casas de duas letras do nível). Um validador independente (`validatePuzzle`) reanalisa cada grade nos testes. Dicas: até pontos-do-nível − 1 por fase (Fácil 4, Médio 9, Difícil 14, Genius 19); a dica preenche a primeira letra da resposta que ainda não está certa, então não gasta ponto onde o jogador já acertou.
- **Fuga das Setas:** grades 8×8, 10×10, 12×12 e 14×14 (Fácil a Genius), com peças (polilinhas) de até 2/3/4/5 casas e 0/1/2/3 dobras, mais **obstáculos fixos** (4/6/8/12 casas bloqueadas). A meta é o **dobro de setas** do desenho anterior (~40/56/64/80). Como peças sorteadas ao acaso quase nunca têm solução, o gerador **constrói** a fase da última removida para a primeira (de dentro para fora): só aceita uma peça cujo **corredor da ponta** (a cabeça até fora do tabuleiro, na direção apontada) esteja livre das já colocadas, então a ordem inversa da montagem é sempre solução. Uma seta só fica travada por outra peça ou por um obstáculo no corredor da ponta — peça encostada no corpo não trava (o corpo escoa por dentro da própria peça). Depois uma **busca local** vira a ponta de algumas peças para **reduzir o número de setas livres** no início (Fácil ~6, Médio ~7, Difícil ~11, Genius ~14), sem nunca perder a solução. A ordem vencedora é achada removendo repetidamente qualquer peça com o corredor da ponta livre; o servidor confere a ordem enviada (índices de peça) com `isSolved`. `LIVES = 3`; ao zerar, o cliente reinicia o mesmo tabuleiro mantendo o tempo.
- **Conexão de Canos:** grades 5×5, 10×10, 15×15 e 20×20, com 60, 90, 120 e 180 segundos. O gerador planta um caminho da entrada à saída (só retos e curvas) que serpenteia por pontos de passagem, preenche o resto com retos, curvas, T e cruz (armadilhas) e embaralha os giros, garantindo que a fase não começa resolvida e que, resolvida, a água vence. A água é simulada por ondas (`simulate`): espalha-se por todos os ramos ligados, e vence quem chega à saída antes de qualquer vazamento (empate: vazamento). O tamanho do caminho (7–11, 18–28, 32–46 e 48–68 casas) foi calibrado para sobrar de ~2,2 a ~6 segundos por giro necessário.
- Os sete usam um orçamento no gerador: os jogos de unicidade descartam fases que não provam isso a tempo (limite de nós no solver), e o Fuga das Setas constrói a fase já solucionável e depois ajusta as pontas com uma busca local, dentro de um limite de tentativas (desistindo se não fechar).

## Limitações conhecidas

Estas valem para o **modo local** (padrão, com `shared/backend/config.js` vazio). Com o Supabase ligado, contas, progresso, coins, fases, rankings **e a validação das jogadas** passam a ficar no servidor e são compartilhados entre navegadores.

- **No modo local, o ranking é local:** `shared/scores.js` guarda tudo no `localStorage`, então só compara contas criadas no mesmo navegador.
- **Contas são um protótipo local:** ficam no `localStorage` do navegador (senha com PBKDF2 + salt) e não sincronizam entre dispositivos. O botão do Google é uma simulação neste modo; na nuvem ele usa o OAuth real do Supabase.
- **No modo local, o navegador decide a vitória:** sem servidor, o próprio jogo decide que a fase foi concluída. Na **nuvem** a jogada é validada de verdade: a Edge Function `play` regenera a fase a partir da seed secreta (que nunca vai ao cliente) e confere o tabuleiro antes de pontuar — um tabuleiro inválido é recusado. Coins e nível só mudam por função no banco.
- Contas criadas antes do campo de região e as contas Google entram **sem região** e ficam fora do ranking regional até definir uma — dá para escolher ou trocar a região a qualquer momento no **Meu perfil**.
- A geração dos níveis altos roda na thread principal e pode levar alguns segundos no Zip Genius; um Web Worker resolveria.
- Sem suporte a teclado no Patches.

## Continuando o desenvolvimento

Veja [docs/CONTINUAR.md](docs/CONTINUAR.md): estado atual, decisões, limitações e próximos passos.

## Licença

MIT. Veja [LICENSE](LICENSE).
