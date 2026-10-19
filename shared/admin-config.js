import { isAdmin } from "./roles.js";
import { readJSON, store } from "./storage.js";
import { Cloud } from "./backend/cloud.js";

/* Configuração global do desafio diário: quantos coins (e, portanto, quantos cenários por nível) cada jogador
   recebe por dia. Vale para todos os jogos. No modo local é só um valor de protótipo (não há servidor de desafio). */
const KEY = "wmg.config";
export const DEFAULT_COINS_PER_DAY = 2;
export const MIN_COINS_PER_DAY = 1;
export const MAX_COINS_PER_DAY = 10;

export const AdminConfig = {
  /** Quantos coins/cenários por dia (atual). */
  coinsPerDay(session) {
    if (Cloud.owns(session?.id)) return Cloud.config()?.coinsPerDay ?? DEFAULT_COINS_PER_DAY;
    return readJSON(KEY, {})?.coinsPerDay ?? DEFAULT_COINS_PER_DAY;
  },
  /** Só o administrador muda; na nuvem grava no servidor (set_coins_per_day). Devolve o novo valor. */
  setCoinsPerDay(session, n) {
    if (!isAdmin(session)) throw new Error("Só o administrador pode mudar os coins por dia.");
    if (!Number.isInteger(n) || n < MIN_COINS_PER_DAY || n > MAX_COINS_PER_DAY) throw new Error(`Escolha um valor de ${MIN_COINS_PER_DAY} a ${MAX_COINS_PER_DAY}.`);
    if (Cloud.owns(session.id)) return Cloud.setCoinsPerDay(n);
    store.set(KEY, JSON.stringify({ ...readJSON(KEY, {}), coinsPerDay: n }));
    return n;
  },
};
