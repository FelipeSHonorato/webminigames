import { isAdmin } from "./roles.js";
import { Cloud } from "./backend/cloud.js";

/* Coins do dia de uma conta específica, para o administrador testar sem esperar a virada do dia.
   Só funciona no modo nuvem: o servidor resolve o e-mail em auth.users e grava em daily_coins
   (função admin_grant_coins, restrita ao administrador). Não mexe em pontos, nível nem vitórias. */
export const MIN_GRANT_COINS = 0;
export const MAX_GRANT_COINS = 99999;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const AdminCoins = {
  /** Só o administrador. Devolve { email, name, day, coins, games: [ids] }. */
  grant(session, email, game, coins) {
    if (!isAdmin(session)) return Promise.reject(new Error("Só o administrador pode dar coins."));
    if (!Cloud.owns(session.id)) return Promise.reject(new Error("Dar coins só funciona com a nuvem ligada."));
    const value = Number(coins);
    if (!Number.isInteger(value) || value < MIN_GRANT_COINS || value > MAX_GRANT_COINS) return Promise.reject(new Error(`Escolha de ${MIN_GRANT_COINS} a ${MAX_GRANT_COINS} coins.`));
    const mail = String(email ?? "").trim();
    if (!EMAIL.test(mail)) return Promise.reject(new Error("Informe o e-mail da conta."));
    return Cloud.adminGrantCoins(mail, game || null, value);
  },
};
