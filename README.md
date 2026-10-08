# WebMiniGames

Site de mini-games de lógica que roda direto no navegador, sem build e sem dependências. Reúne dois jogos inspirados nos puzzles diários do LinkedIn:

- **Zip:** trace um único caminho passando pelos números em ordem e por todas as células. Paredes bloqueiam a passagem.
- **Patches:** divida a grade em retângulos; cada um tem exatamente uma pista, com a área (número) e o formato (quadrado, largo, alto ou qualquer).

Os dois têm quatro níveis (Fácil, Médio, Difícil e Genius). O nível sobe a cada 15 vitórias, por jogo e por usuário, e as fases são geradas na hora, sempre com solução única.

## Pontuação e ranking

Cada partida vencida vale pontos conforme o nível em que a fase foi gerada: **Fácil 5, Médio 10, Difícil 15, Genius 20**. Os pontos só são gravados quando o cenário é concluído (reiniciar a fase e vencer de novo não soma outra vez). Só contas pontuam; jogadores anônimos veem o ranking, mas não aparecem nele.

Cada jogo tem um painel lateral de ranking, aberto ao entrar (em telas largas) e recolhível pela aba "Ranking". Ele tem duas visões: **Geral** e **Minha região** (a região é escolhida no cadastro). Empates são resolvidos por quem chegou primeiro à pontuação.

## Perfil

Depois do login, a barra superior mostra a foto do usuário (ou um avatar padrão), um link com engrenagem para as configurações um **switch de modo escuro** (sol e lua) e o botão **Deslogar**. Em `perfil.html` a conta pode definir um **apelido** (único, 3 a 20 caracteres, usado no ranking), enviar uma **foto** (recortada e reduzida no navegador), **trocar a senha** (informando a atual) e ver a lista de jogos com o **último horário jogado** e a **pontuação** de cada um. Anônimos não têm perfil: a barra deles mostra "Anônimo" e, no lugar de Deslogar, os botões **Entrar** e **Criar conta**, que voltam à tela de entrada já na aba escolhida (`index.html?modo=entrar` ou `?modo=conta`), sem perder a sessão anônima até o login.

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
npm test
```

Cobrem regras, solver e gerador dos dois jogos (cada nível precisa gerar fase de solução única) e a progressão de níveis.

## Publicando no GitHub Pages

1. Crie o repositório, envie o código para a branch `main` e vá em **Settings → Pages**.
2. Em **Source**, escolha **GitHub Actions**.
3. A cada push na `main`, o workflow `.github/workflows/pages.yml` roda os testes e publica o site.

Todos os caminhos são relativos, então o site funciona em `https://<usuario>.github.io/<repositorio>/`.

## Estrutura

```
index.html            página de entrada (criar conta, Google simulado, anônimo)
jogos.html            página com os jogos disponíveis (exige sessão)
perfil.html           perfil: apelido, foto, senha e meus jogos (exige conta)
css/                  site.css, gamebar.css (barra dos jogos), ranking.css (painel lateral)
js/                   login.js, hub.js, perfil.js (uma por página), auth.js (contas), userbar.js, games.js (catálogo)
shared/               theme.js e theme-init.js (modo escuro), rng.js, storage.js, session.js, progress.js (níveis e pontos), regions.js,
                      scores.js (pontuação e ranking), ranking-panel.js (painel lateral),
                      profile.js (apelido, foto, atividade), avatar.js (redimensiona a foto)
games/<jogo>/
  domain.js           regras, solver e gerador (puro, sem DOM)
  ui.js               renderização e entrada (Pointer Events)
  index.html, style.css
tests/                testes com o runner nativo do Node
```

Fluxo: `index.html` (entrada) → `jogos.html` (lista de jogos) → `games/<jogo>/` (cada jogo é uma página própria, com o botão "← Jogos"). O login grava a sessão em `localStorage` (`wmg.session`); as páginas de jogos e a lista exigem essa sessão e o progresso é gravado por usuário.

## Como os jogos funcionam

- **Zip:** o solver é um DFS com poda (conectividade das células livres, becos sem saída e ordem dos números). O gerador cria um caminho hamiltoniano aleatório (heurística de Warnsdorff), espalha os números ao longo dele e adiciona paredes até a solução ser única.
- **Patches:** o solver faz cobertura exata por backtracking, sempre escolhendo a pista com menos retângulos possíveis. O gerador particiona a grade em retângulos, sorteia as pistas e só aceita a fase se a solução for única. Níveis mais altos têm mais pistas incompletas (ícone "qualquer" ou sem número).
- Os dois usam um orçamento de nós no solver: fases cuja unicidade não é provada a tempo são descartadas.

## Limitações conhecidas

- **O ranking ainda é local:** `shared/scores.js` guarda tudo no `localStorage`, então só compara contas criadas no mesmo navegador. Um ranking global e regional de verdade exige um backend: reimplemente `submit` e `leaderboard` desse arquivo (Firebase, Supabase…) e valide as vitórias no servidor, já que pontos no navegador podem ser editados por quem souber como.
- Contas criadas antes do campo de região não têm região e não aparecem no ranking regional.

- **Contas são um protótipo local:** ficam no `localStorage` do navegador (senha com PBKDF2 + salt) e não sincronizam entre dispositivos. O botão do Google é uma simulação. Para produção, reimplemente os métodos de `js/auth.js` com um provedor real (Firebase Auth, Supabase, Auth0) e leve o progresso para o servidor.
- A geração dos níveis altos roda na thread principal e pode levar alguns segundos no Zip Genius; um Web Worker resolveria.
- Sem suporte a teclado no Patches.

## Licença

MIT. Veja [LICENSE](LICENSE).
