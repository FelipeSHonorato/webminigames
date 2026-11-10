import { readJSON } from "./storage.js";
import { Idle } from "./activity.js";

/** Sessão gravada pelo login em "wmg.session" ({ id, name, provider }) ou null. */
export const getSession = () => readJSON("wmg.session", null);

/** Protege uma página: sem sessão (ou com mais de um dia sem atividade), volta para o login e devolve null. */
export function requireSession(loginUrl) {
  const session = getSession();
  if (session && !Idle.expired()) return session;
  const url = new URL(loginUrl, location.href);
  if (Idle.justExpired()) url.searchParams.set("expirado", "1");   // a tela de login explica o motivo
  location.replace(url.href);
  return null;
}
