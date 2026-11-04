/* Menu lateral do hub (jogos.html): Todos / Solo / Duelos 1×1.
   Só funções puras — contagem, filtro, hash e textos. O DOM fica em `js/hub.js`.
   Um jogo entra em "Duelos" quando o catálogo marca `duel: true`, o mesmo contrato que a Edge
   confere no `DUEL` do domínio (`tests/edge.test.js` garante a paridade). */

export const MODES = ["all", "solo", "duel"];
export const DEFAULT_MODE = "all";

/** `duel: true` no catálogo = jogo criado para o 1×1 (nenhum jogo antigo é convertido). */
export const isDuel = game => game?.duel === true;

/** Modo válido; qualquer outra coisa cai em "Todos". */
export const normalizeMode = mode => (MODES.includes(mode) ? mode : DEFAULT_MODE);

/** Itens da lateral, sempre nesta ordem, com o contador de cada modo. */
export function navItems(games = {}) {
  const all = Object.values(games);
  const duels = all.filter(isDuel).length;
  return [
    { mode: "all", label: "Todos", count: all.length },
    { mode: "solo", label: "Solo", count: all.length - duels },
    { mode: "duel", label: "Duelos 1×1", count: duels },
  ];
}

/** Jogos de um modo, preservando a ordem do catálogo. */
export function filterGames(games = {}, mode = DEFAULT_MODE) {
  const entries = Object.entries(games);
  if (mode === "duel") return entries.filter(([, game]) => isDuel(game));
  if (mode === "solo") return entries.filter(([, game]) => !isDuel(game));
  return entries;
}

/** Modo a partir do endereço (`#solo`, `#duelos`); qualquer outro valor cai em "Todos". */
export function modeFromHash(hash = "") {
  const value = String(hash).replace(/^#/, "").toLowerCase();
  if (value === "solo") return "solo";
  if (value === "duelos" || value === "duel") return "duel";
  return DEFAULT_MODE;
}

/** Hash do modo (vazio em "Todos", para não sujar o endereço). */
export function hashFor(mode) {
  if (mode === "solo") return "#solo";
  if (mode === "duel") return "#duelos";
  return "";
}

/** Painéis do ranking lateral: fora dos duelos é sempre o "Ranking Geral - Solo";
    no modo Duelos há um painel por jogo (o hub.js alterna em carrossel). */
export function rankingPanels(games = {}, mode = DEFAULT_MODE) {
  if (mode !== "duel") {
    return [{ gameId: null, title: "Ranking Geral - Solo", sub: "Soma da pontuação de todos os jogos." }];
  }
  return filterGames(games, "duel").map(([id, game]) => ({
    gameId: id,
    title: `Ranking Geral ${game.title}`,
    sub: id === "go"
      ? "Sistema Kyu/Dan · handicap automático pela diferença de grau."
      : "Sistema Elo · vitórias e derrotas ajustam o rating.",
  }));
}

/** Título e subtítulo da seção, trocados ao filtrar. */
export function modeText(mode) {
  if (mode === "solo") {
    return {
      title: "Jogos solo",
      sub: "Desafio do dia, com nível, tickets e ranking próprios de cada jogo.",
    };
  }
  if (mode === "duel") {
    return {
      title: "Duelos 1×1",
      sub: "Jogos com duelos jogador x jogador. Jogue com um adversário valendo pontuação no ranking ou somente por diversão.",
    };
  }
  return {
    title: "Todos os jogos",
    sub: "Solo e duelos no mesmo lugar. Cada jogo tem seu nível, seus tickets e seu ranking.",
  };
}
