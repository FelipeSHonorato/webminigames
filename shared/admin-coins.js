import { isAdmin } from "./roles.js";
import { Cloud } from "./backend/cloud.js";

/* Tickets de uma conta específica, para o administrador testar o backlog sem esperar a virada do dia.
   Só funciona no modo nuvem: o servidor resolve o e-mail em auth.users e grava em daily_tickets
   (função admin_grant_coins, restrita ao administrador). Não mexe em pontos, nível nem vitórias. */
export const MIN_GRANT_DAYS = 1;
export const MAX_GRANT_DAYS = 30;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const AdminCoins = {
  /** Só o administrador. Devolve { email, name, day, coins: dias concedidos, games: [ids] }. */
  grant(session, email, game, days) {
    if (!isAdmin(session)) return Promise.reject(new Error("Só o administrador pode dar tickets."));
    if (!Cloud.owns(session.id)) return Promise.reject(new Error("Dar tickets só funciona com a nuvem ligada."));
    const value = Number(days);
    if (!Number.isInteger(value) || value < MIN_GRANT_DAYS || value > MAX_GRANT_DAYS) return Promise.reject(new Error(`Escolha de ${MIN_GRANT_DAYS} a ${MAX_GRANT_DAYS} dias.`));
    const mail = String(email ?? "").trim();
    if (!EMAIL.test(mail)) return Promise.reject(new Error("Informe o e-mail da conta."));
    return Cloud.adminGrantCoins(mail, game || null, value);
  },
};
