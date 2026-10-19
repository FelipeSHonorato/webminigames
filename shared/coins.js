import { readJSON, store } from "./storage.js";
import { ADMIN_ID, ADMIN_COINS } from "./roles.js";
import { Cloud } from "./backend/cloud.js";

/* Coins por jogo: cada jogador recebe COINS_PER_DAY a cada 24 h, sem acumular (o máximo é COINS_PER_DAY).
   No modo local, um coin só é gasto quando a fase é concluída. Na nuvem o gasto real é do SERVIDOR, ao SERVIR a fase
   (`open_phase`, chamado por `Cloud.open`); aqui só mexemos na tela. Implementação LOCAL (localStorage), com o mesmo
   ponto de troca dos demais serviços. */
const KEY = "wmg.coins";   // { [userId]: { [gameId]: { coins, anchor } } }
export const COINS_PER_DAY = 2;   // padrão/fallback (espelhado no SQL e usado no modo local); na nuvem vale a configuração do administrador
const coinsPerDay = uid => (Cloud.owns(uid) ? (Cloud.config()?.coinsPerDay ?? COINS_PER_DAY) : COINS_PER_DAY);
const capFor = uid => (uid === ADMIN_ID || (Cloud.owns(uid) && Cloud.role() === "admin") ? ADMIN_COINS : coinsPerDay(uid));   // a conta administradora tem 99999 e também gasta ao concluir fases
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Recarga (pura): sem registro, já começa com o máximo; a cada 24 h inteiras o saldo volta ao máximo e a âncora avança em dias inteiros. */
export function settle(entry, cap, now) {
  let { coins, anchor } = entry ?? { coins: cap, anchor: now };
  const periods = Math.floor((now - anchor) / DAY_MS);
  if (periods >= 1) { coins = cap; anchor += periods * DAY_MS; }
  return { coins: Math.min(coins, cap), anchor };
}
const view = (uid, e) => ({ coins: e.coins, max: capFor(uid), nextRefillAt: e.anchor + DAY_MS });

export const Coins = {
  /** Saldo atual, já com a recarga aplicada. nextRefillAt = quando chegam os próximos coins. */
  get(uid, gameId, now = Date.now()) {
    if (Cloud.owns(uid)) {                                                     // nuvem: o saldo vem do servidor e a recarga é recalculada aqui
      const e = settle(Cloud.coinEntry(gameId), capFor(uid), now);
      Cloud.setCoinEntry(gameId, e);
      return view(uid, e);
    }
    const all = readJSON(KEY, {});
    const mine = (all[uid] ??= {});
    const g = mine[gameId] = settle(mine[gameId], capFor(uid), now);          // primeiro acesso: máximo; depois, recarga sem passar dele
    store.set(KEY, JSON.stringify(all));
    return view(uid, g);
  },

  /** Gasta 1 coin (chamado só ao concluir a fase). Devolve false se não havia coin. */
  spend(uid, gameId, now = Date.now()) {
    if (this.get(uid, gameId, now).coins <= 0) return false;
    if (Cloud.owns(uid)) {                                                     // só a tela: na nuvem o servidor desconta o coin ao SERVIR a fase (Cloud.open -> open_phase)
      const e = Cloud.coinEntry(gameId);
      Cloud.setCoinEntry(gameId, { ...e, coins: e.coins - 1 });
      return true;
    }
    const all = readJSON(KEY, {});
    all[uid][gameId].coins -= 1;
    store.set(KEY, JSON.stringify(all));
    return true;
  },
};
