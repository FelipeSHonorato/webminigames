import { readJSON, store } from "./storage.js";
import { isAdmin } from "./roles.js";

/* Liga/desliga de cada jogo, controlado pelo administrador. Desligar NÃO apaga nada: pontos, rankings, coins
   e progresso continuam salvos e contando (a chave só controla o acesso ao jogo).
   Implementação LOCAL: vale só para este navegador; num backend real, o estado fica no servidor. */
const KEY = "wmg.games";   // { [gameId]: false } — ausente = ligado

export const GameSwitch = {
  isOn: gameId => readJSON(KEY, {})[gameId] !== false,
  set(gameId, on) {
    const all = readJSON(KEY, {});
    if (on) delete all[gameId]; else all[gameId] = false;
    store.set(KEY, JSON.stringify(all));
  },
};

/** Jogadores só entram em jogos ligados; o administrador entra sempre (para testar). */
export const gameAllowed = (gameId, session) => GameSwitch.isOn(gameId) || isAdmin(session);
