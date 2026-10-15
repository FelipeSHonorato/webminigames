import { readJSON, store } from "./storage.js";

/* Fase atual de cada jogador em cada jogo: { seed, level, solved }.
   Como a fase nasce de uma seed, recarregar a página devolve a MESMA fase (não dá para trocar de fase sem concluí-la). */
const KEY = "wmg.run";

export const Run = {
  get: (uid, gameId) => readJSON(KEY, {})[uid]?.[gameId] ?? null,
  set(uid, gameId, run) {
    const all = readJSON(KEY, {});
    (all[uid] ??= {})[gameId] = run;
    store.set(KEY, JSON.stringify(all));
  },
  /** Descarta a fase salva: a próxima abertura do jogo sorteia uma fase nova (no nível atual do jogador). */
  clear(uid, gameId) {
    const all = readJSON(KEY, {});
    if (!all[uid] || !(gameId in all[uid])) return;
    delete all[uid][gameId];
    store.set(KEY, JSON.stringify(all));
  },
};
