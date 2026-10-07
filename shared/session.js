import { readJSON } from "./storage.js";

/** Sessão gravada pelo login em "wmg.session" ({ id, name, provider }) ou null. */
export const getSession = () => readJSON("wmg.session", null);

/** Protege uma página: sem sessão, redireciona para o login e devolve null. */
export function requireSession(loginUrl) {
  const session = getSession();
  if (!session) { location.replace(loginUrl); return null; }
  return session;
}
