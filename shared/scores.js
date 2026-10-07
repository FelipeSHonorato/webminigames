import { readJSON, store } from "./storage.js";
import { getSession } from "./session.js";

/* Serviço de pontuação. Esta implementação é LOCAL (localStorage): só compara contas criadas neste navegador.
   Para um ranking real entre usuários, reimplemente estes três métodos com um backend (Firebase, Supabase…)
   mantendo as assinaturas: o resto do site não muda. */
const KEY = "wmg.scores";   // { [userId]: { name, region, games: { [gameId]: { points, wins, updatedAt } } } }

export const Scores = {
  /** Só contas (não anônimos) pontuam e aparecem no ranking. */
  canRank() {
    const s = getSession();
    return Boolean(s) && s.provider !== "anonymous";
  },

  /** Soma os pontos de UMA partida concluída. Chamado só quando o cenário é vencido. */
  async submit(gameId, points) {
    const s = getSession();
    if (!this.canRank() || !(points > 0)) return null;
    const all = readJSON(KEY, {});
    const row = (all[s.id] ??= { name: s.name, region: s.region ?? null, games: {} });
    row.name = s.name;
    row.region = s.region ?? row.region ?? null;
    const g = (row.games[gameId] ??= { points: 0, wins: 0, updatedAt: 0 });
    g.points += points; g.wins += 1; g.updatedAt = Date.now();
    store.set(KEY, JSON.stringify(all));
    return { ...g };
  },

  /** Ranking de um jogo. scope: "global" ou "region" (a região do usuário atual). Empate: quem chegou primeiro. */
  async leaderboard(gameId, { scope = "global", limit = 10 } = {}) {
    const s = getSession();
    let rows = Object.entries(readJSON(KEY, {}))
      .filter(([, r]) => r.games?.[gameId]?.points > 0)
      .map(([id, r]) => ({ id, name: r.name, region: r.region, ...r.games[gameId], isMe: id === s?.id }));
    if (scope === "region") rows = rows.filter(r => s?.region && r.region === s.region);
    rows.sort((a, b) => b.points - a.points || a.updatedAt - b.updatedAt);
    rows.forEach((r, i) => (r.rank = i + 1));
    return { top: rows.slice(0, limit), me: rows.find(r => r.isMe) ?? null, total: rows.length };
  },
};
