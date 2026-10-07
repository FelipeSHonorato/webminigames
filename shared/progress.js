/** Progressão compartilhada: o nível sobe a cada WINS_PER_LEVEL vitórias, por jogo e por usuário. */
export const WINS_PER_LEVEL = 15;
export const LEVEL_NAMES = ["Fácil", "Médio", "Difícil", "Genius"];

/** Id do usuário da sessão atual (gravada pelo site em "wmg.session"); "guest" se o jogo for aberto sozinho. */
export function currentUserId() {
  try { return JSON.parse(localStorage.getItem("wmg.session"))?.id || "guest"; } catch { return "guest"; }
}
export const winsKey = (gameKey, uid = currentUserId()) => `${gameKey}:${uid}`;
export const levelIndex = (wins, levels = LEVEL_NAMES.length) => Math.min(levels - 1, Math.floor(wins / WINS_PER_LEVEL));
