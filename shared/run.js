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
};
