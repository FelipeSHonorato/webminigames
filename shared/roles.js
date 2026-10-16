/** Conta administradora (criada automaticamente em js/auth.js). */
export const ADMIN_ID = "u-admin";
export const ADMIN_EMAIL = "administrador@administrador.com.br";
export const ADMIN_COINS = 99999;
/** Administrador: a conta local semeada (id fixo) ou, com Supabase, a conta com role = "admin" em profiles. Isto só decide o que a tela mostra:
    quem barra de verdade é o banco (RLS e funções em supabase/migrations). */
export const isAdmin = session => session?.role === "admin" || session?.id === ADMIN_ID;
