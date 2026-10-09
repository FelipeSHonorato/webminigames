/** Conta administradora (criada automaticamente em js/auth.js). */
export const ADMIN_ID = "u-admin";
export const ADMIN_EMAIL = "administrador@administrador.com.br";
export const ADMIN_COINS = 99999;
export const isAdmin = session => session?.id === ADMIN_ID;
