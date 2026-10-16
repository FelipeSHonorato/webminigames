import { readJSON, store } from "./storage.js";
import { isAdmin } from "./roles.js";
import { Cloud } from "./backend/cloud.js";

/* Liga/desliga de cada jogo, controlado pelo administrador. Desligar NÃO apaga nada: pontos, rankings, coins
   e progresso continuam salvos e contando (a chave só controla o acesso ao jogo).
   Local: vale só para este navegador. Com Supabase, o estado fica na tabela games e vale para todos (só o administrador altera). */
const KEY = "wmg.games";   // { [gameId]: false } — ausente = ligado

export const GameSwitch = {
  isOn: gameId => (Cloud.active ? Cloud.gameOn(gameId) : readJSON(KEY, {})[gameId] !== false),
  /** Na nuvem devolve uma Promise (use `await`). */
  set(gameId, on) {
    if (Cloud.active) return Cloud.setGameEnabled(gameId, on);
    const all = readJSON(KEY, {});
    if (on) delete all[gameId]; else all[gameId] = false;
    store.set(KEY, JSON.stringify(all));
  },
};

/** Jogadores só entram em jogos ligados; o administrador entra sempre (para testar). */
export const gameAllowed = (gameId, session) => GameSwitch.isOn(gameId) || isAdmin(session);
