/** Progressão compartilhada: o nível sobe a cada WINS_PER_LEVEL vitórias, por jogo e por usuário. */
export const WINS_PER_LEVEL = 15;
export const LEVEL_NAMES = ["Fácil", "Médio", "Difícil", "Genius"];

/** Id do usuário da sessão atual (gravada pelo site em "wmg.session"); "guest" se o jogo for aberto sozinho. */
export function currentUserId() {
  try { return JSON.parse(localStorage.getItem("wmg.session"))?.id || "guest"; } catch { return "guest"; }
}
export const winsKey = (gameKey, uid = currentUserId()) => `${gameKey}:${uid}`;
export const levelIndex = (wins, levels = LEVEL_NAMES.length) => Math.min(levels - 1, Math.floor(wins / WINS_PER_LEVEL));

/** Pontos por vitória, na ordem dos níveis: Fácil 5, Médio 10, Difícil 15, Genius 20. */
export const POINTS_PER_LEVEL = [5, 10, 15, 20];
export const pointsFor = levelIdx => POINTS_PER_LEVEL[Math.max(0, Math.min(levelIdx, POINTS_PER_LEVEL.length - 1))];

/** Texto da pontuação, exibido junto da explicação de cada jogo. */
export const pointsLegend = () =>
  "Pontos por vitória (só para quem tem conta): " + LEVEL_NAMES.map((n, i) => `${n} ${POINTS_PER_LEVEL[i]}`).join(" · ") + ".";
