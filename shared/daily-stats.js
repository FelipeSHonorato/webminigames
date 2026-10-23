/* Cálculos dos "troféus" do cenário diário. Módulo puro (sem DOM e sem rede): é testável no Node e usado
   tanto pelo painel dos cenários quanto pelos cartões de vitória (shared/daily.js). */

/** Percentual de jogadores que o tempo do jogador superou. Sozinho no cenário, ele fica com 100%. */
export function betterThanPercent(rank, players) {
  if (!Number.isFinite(rank) || !Number.isFinite(players) || rank < 1 || players < 1) return null;
  if (players <= 1) return 100;
  return Math.max(0, Math.min(100, Math.round(((players - rank) * 100) / players)));
}

/** Compara o tempo do jogador com a média do dia: "above" (mais rápido), "below" (mais lento) ou "even" (na média). */
export function averageStatus(seconds, avgSeconds, players) {
  if (!Number.isFinite(seconds) || !Number.isFinite(avgSeconds) || !Number.isFinite(players) || players <= 1) return "even";
  if (seconds < avgSeconds) return "above";
  if (seconds > avgSeconds) return "below";
  return "even";
}

const MEDALS = ["gold", "silver", "bronze"];

/** Os três melhores tempos do cenário, na ordem, com a medalha que a tela desenha. */
export function podiumTimes(stats) {
  return (Array.isArray(stats?.top) ? stats.top : [])
    .map(p => ({ name: typeof p?.name === "string" ? p.name : "", avatar: typeof p?.avatar === "string" ? p.avatar : null, seconds: Number(p?.seconds) }))
    .filter(p => Number.isFinite(p.seconds))
    .slice(0, 3)
    .map((p, i) => ({ ...p, medal: MEDALS[i] }));
}

/** Normaliza o que veio do servidor (daily_my_stats) para o que a tela mostra. `null` quando não há dados. */
export function scenarioTrophies(stats) {
  if (!stats) return null;
  const players = Math.max(0, Number(stats.players) || 0);
  const rank = Math.max(0, Number(stats.rank) || 0);
  const seconds = Number(stats.seconds);
  const avgSeconds = Number(stats.avgSeconds);
  return {
    players,
    rank,
    percent: betterThanPercent(rank, players),
    average: averageStatus(seconds, avgSeconds, players),
    seconds: Number.isFinite(seconds) ? seconds : null,
    avgSeconds: Number.isFinite(avgSeconds) ? avgSeconds : null,
    points: Math.max(0, Number(stats.points) || 0),
    hints: Math.max(0, Number(stats.hints) || 0),
    region: stats.region ?? null,
    regionRank: stats.regionRank == null ? null : Number(stats.regionRank),
    regionPlayers: stats.regionPlayers == null ? null : Number(stats.regionPlayers),
  };
}
