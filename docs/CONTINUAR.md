# Continuando o desenvolvimento do WebMiniGames

Resumo do estado do projeto para retomar o trabalho em outro chat (ou com outra pessoa).

## O que existe

Site de mini-games de lógica, em HTML/CSS/JS puro (módulos ES, sem build e sem dependências), com dois jogos inspirados nos puzzles do LinkedIn:

- **Zip:** um único caminho passando pelos números em ordem e por todas as células; paredes bloqueiam.
- **Patches:** dividir a grade em retângulos; cada um tem uma pista (área e formato: quadrado, largo, alto ou qualquer).

Funcionalidades prontas: entrada (criar conta, Google **simulado**, anônimo), página de jogos, perfil (apelido, foto, senha, meus jogos), 4 níveis por jogo (sobe a cada 15 vitórias), pontuação (Fácil 5, Médio 10, Difícil 15, Genius 20), ranking por jogo em painel lateral recolhível, ranking geral na página de jogos (soma de todos os jogos, em janela fixa), regiões, modo escuro, coins (2 por jogo a cada 24 h, sem acumular, gastos só ao concluir a fase), fase salva por seed, conta administradora com liga/desliga dos jogos.

## Como rodar e testar

```bash
npm start     # servidor local (usa serve.json); não abra o index.html com duplo clique
npm test      # 35 testes, Node 20+
```

## Estrutura e decisões importantes

- `games/<jogo>/domain.js` é **código puro** (regras, solver, gerador), testado no Node. `ui.js` cuida de tela e entrada.
- `shared/` guarda os serviços: `scores.js`, `coins.js`, `run.js`, `game-switch.js`, `profile.js`, `progress.js`, `theme.js`, `ranking-list.js`.
- **Tudo é local (`localStorage`).** Esses serviços são os pontos de troca para um backend real: mantenha as assinaturas e o resto do site não muda. `js/auth.js` é o ponto de troca da autenticação.
- Coins: `shared/coins.js` (teto 2 por jogo; administrador 99999). A fase atual fica em `shared/run.js` (seed), para não dar para trocar de fase sem concluir.
- Pontos só são gravados ao concluir a fase (`creditWin` em cada `ui.js`); reiniciar e vencer de novo não pontua nem gasta coin.
- Desligar um jogo (admin) **não apaga nada**: pontos, rankings e perfis continuam iguais.
- Nomes de usuário sempre entram na tela via `textContent` (nunca `innerHTML`).
- Geração de fases: o solver tem orçamento de nós; fases sem unicidade provada são descartadas.

## Conta administradora

`administrador@administrador.com.br` / `administrador` (criada automaticamente). A senha está no código-fonte: serve só para o protótipo.

## Limitações e próximos passos sugeridos

1. **Backend real** (Firebase/Supabase/outro): contas, Google de verdade, ranking global e regional, coins e liga/desliga no servidor, validação das vitórias no servidor (hoje dá para burlar editando o `localStorage` ou o relógio).
2. Gerar as fases do Zip nos níveis altos num **Web Worker** (pode levar alguns segundos no Genius).
3. Suporte a **teclado** no Patches.
4. Centralizar as cores (tokens) num `tokens.css` compartilhado (hoje cada jogo repete os seus).
5. Ideias já levantadas: mostrar pontos nos cards da página de jogos; o administrador ajustar coins e ver a lista de contas; recarga de coins à meia-noite em vez de 24 h depois do primeiro acesso.

## Prompt sugerido para abrir o novo chat

> Estou continuando o desenvolvimento do projeto WebMiniGames (arquivos anexados). Leia `docs/CONTINUAR.md` e o `README.md` antes de responder. Mantenha as convenções do projeto (domínio puro e testado, serviços em `shared/` como pontos de troca, textos em pt-BR) e rode `npm test` depois de cada mudança. Quero agora: [descreva a próxima tarefa].
