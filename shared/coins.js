import { readJSON, store } from "./storage.js";
import { ADMIN_ID, ADMIN_COINS } from "./roles.js";

/* Coins por jogo: cada jogador recebe COINS_PER_DAY a cada 24 h, sem acumular (o máximo é COINS_PER_DAY).
   Um coin só é gasto quando a fase é concluída. Implementação LOCAL (localStorage), com o mesmo ponto de troca
   dos demais serviços: num backend real, a recarga e o gasto devem ser calculados no servidor. */
const KEY = "wmg.coins";   // { [userId]: { [gameId]: { coins, anchor } } }
export const COINS_PER_DAY = 2;
const capFor = uid => (uid === ADMIN_ID ? ADMIN_COINS : COINS_PER_DAY);   // a conta administradora tem 99999 e também gasta ao concluir fases
export const DAY_MS = 24 * 60 * 60 * 1000;

export const Coins = {
  /** Saldo atual, já com a recarga aplicada. nextRefillAt = quando chegam os próximos coins. */
  get(uid, gameId, now = Date.now()) {
    const all = readJSON(KEY, {});
    const mine = (all[uid] ??= {});
    let g = mine[gameId];
    if (!g) g = mine[gameId] = { coins: capFor(uid), anchor: now };           // primeiro acesso: já começa com o máximo
    const periods = Math.floor((now - g.anchor) / DAY_MS);
    if (periods >= 1) { g.coins = capFor(uid); g.anchor += periods * DAY_MS; }   // recarga: volta ao máximo, nunca passa dele
    store.set(KEY, JSON.stringify(all));
    return { coins: g.coins, max: capFor(uid), nextRefillAt: g.anchor + DAY_MS };
  },

  /** Gasta 1 coin (chamado só ao concluir a fase). Devolve false se não havia coin. */
  spend(uid, gameId, now = Date.now()) {
    if (this.get(uid, gameId, now).coins <= 0) return false;
    const all = readJSON(KEY, {});
    all[uid][gameId].coins -= 1;
    store.set(KEY, JSON.stringify(all));
    return true;
  },
};
