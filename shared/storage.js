/** localStorage com fallback em memória (modo privado / armazenamento bloqueado). */
/* ===================== ARMAZENAMENTO ===================== */
const memory = {};
export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return memory[k] ?? null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { memory[k] = v; } },
  remove(k) { try { localStorage.removeItem(k); } catch { delete memory[k]; } },
  /** Chaves guardadas (usado para limpar tudo de um usuário ao excluir a conta). */
  keys() { try { return Object.keys(localStorage); } catch { return Object.keys(memory); } },
};
export const readJSON = (k, fallback) => { try { return JSON.parse(store.get(k)) ?? fallback; } catch { return fallback; } };
