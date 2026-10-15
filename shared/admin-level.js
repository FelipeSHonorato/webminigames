import { isAdmin } from "./roles.js";
import { Progress, winsForLevel, winsKey, LEVEL_NAMES } from "./progress.js";
import { store } from "./storage.js";
import { Run } from "./run.js";

/* Nível de cada jogo para o ADMINISTRADOR testar sem jogar até lá. Só mexe na conta do próprio administrador:
   as vitórias dele no jogo passam a ser as do início do nível escolhido, e a fase salva é descartada (senão a fase
   em andamento continuaria no nível antigo). Os outros jogadores, os pontos e os rankings não são tocados.
   Implementação LOCAL; num backend real, a checagem de administrador e a gravação ficam no servidor. */
export const AdminLevel = {
  levels: LEVEL_NAMES,
  get: (session, gameKey) => Progress.level(gameKey, session?.id),
  /** session: sessão atual (precisa ser a do administrador). gameId: id do jogo ("zip"); gameKey: chave de vitórias ("zip.wins"). */
  set(session, gameId, gameKey, levelIdx) {
    if (!isAdmin(session)) throw new Error("Só o administrador pode escolher o nível.");
    if (!Number.isInteger(levelIdx) || levelIdx < 0 || levelIdx >= LEVEL_NAMES.length) throw new Error("Nível inválido.");
    store.set(winsKey(gameKey, session.id), String(winsForLevel(levelIdx)));
    Run.clear(session.id, gameId);
    return levelIdx;
  },
};
