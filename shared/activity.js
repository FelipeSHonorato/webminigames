import { store, readJSON } from "./storage.js";

/* ===================== EXPIRAÇÃO POR INATIVIDADE =====================
   A sessão fica no localStorage (sem prazo próprio: fechar o navegador não desloga). Aqui ela ganha um
   prazo: depois de um dia sem NENHUMA atividade no site, o usuário precisa entrar de novo.
   - Abrir uma página conta como atividade (Cloud.loadUser e Auth.start chamam `touch`).
   - Com a página aberta, clique/tecla/rolagem renovam o prazo (no máximo uma gravação por minuto).
   - `track` também encerra a sessão se a aba voltar depois do prazo (o callback faz o logout). */

export const IDLE_LIMIT_MS = 24 * 60 * 60 * 1000;          // 1 dia sem atividade
const KEY = "wmg.lastSeen", SESSION_KEY = "wmg.session", TOUCH_MS = 60 * 1000;

let expiredNow = false, wired = false, lastWrite = 0, leaving = false;

const logged = () => Boolean(readJSON(SESSION_KEY, null));

export const Idle = {
  /** Marca `now` como a última atividade (só vale se existe sessão). */
  touch(now = Date.now()) {
    if (logged()) store.set(KEY, String(now));
  },
  /** Última atividade em ms; null quando não há registro (conta nova ou site atualizado agora). */
  last(now = Date.now()) {
    const n = Number(store.get(KEY));
    return Number.isFinite(n) && n > 0 && n <= now ? n : null;
  },
  /** Passou de um dia sem atividade? Sem sessão ou sem registro, não expira (o prazo começa no primeiro acesso). */
  expired(now = Date.now()) {
    if (!logged()) return false;
    const last = this.last(now);
    return last !== null && now - last >= IDLE_LIMIT_MS;
  },
  /** Apaga o registro de atividade (logout comum). */
  clear() { store.remove(KEY); },
  /** Encerra a sessão local: espelho do login + registro de atividade. A nuvem fica a cargo de Cloud.expire(). */
  clearSession() { store.set(SESSION_KEY, "null"); store.remove(KEY); },
  /** A sessão desta visita foi encerrada por inatividade (a tela de login avisa o usuário). */
  justExpired: () => expiredNow,
  markExpired() { expiredNow = true; },
  /** Renova o prazo enquanto a página é usada. `onExpire` roda quando a aba volta depois do prazo. */
  track(onExpire) {
    if (wired || typeof window === "undefined" || !logged()) return;
    wired = true;
    const mark = force => {
      const now = Date.now();
      if (!force && now - lastWrite < TOUCH_MS) return;
      lastWrite = now;
      Idle.touch(now);
    };
    const fire = () => {
      if (leaving) return;
      leaving = true;
      onExpire?.();
    };
    const check = () => {
      if (!Idle.expired()) return mark(true);
      fire();
    };
    for (const e of ["pointerdown", "keydown", "wheel", "touchstart", "scroll"]) addEventListener(e, () => mark(false), { passive: true });
    addEventListener("pagehide", () => mark(true));
    addEventListener("pageshow", check);
    addEventListener("online", () => mark(true));
    document.addEventListener("visibilitychange", () => (document.visibilityState === "visible" ? check() : mark(true)));
    setInterval(() => { if (Idle.expired()) fire(); }, TOUCH_MS);   // aba aberta e parada: encerra sozinho depois do prazo
    check();                                               // abrir a página conta como atividade
  },
};
