import { Auth } from "./auth.js";
import { getSession } from "../shared/session.js";
import { Profile } from "../shared/profile.js";
import { themeSwitch } from "../shared/theme.js";

const DEFAULT_AVATAR = `<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="15" r="7" fill="currentColor"/><path d="M6 36c1-8 7-12 14-12s13 4 14 12z" fill="currentColor"/></svg>`;
const GEAR = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" stroke="currentColor" stroke-width="1" stroke-linejoin="round" d="M9.78 4.73 L10.37 1.73 L13.63 1.73 L14.22 4.73 L15.57 5.29 L18.11 3.59 L20.41 5.89 L18.71 8.43 L19.27 9.78 L22.27 10.37 L22.27 13.63 L19.27 14.22 L18.71 15.57 L20.41 18.11 L18.11 20.41 L15.57 18.71 L14.22 19.27 L13.63 22.27 L10.37 22.27 L9.78 19.27 L8.43 18.71 L5.89 20.41 L3.59 18.11 L5.29 15.57 L4.73 14.22 L1.73 13.63 L1.73 10.37 L4.73 9.78 L5.29 8.43 L3.59 5.89 L5.89 3.59 L8.43 5.29 Z M12 8.6a3.4 3.4 0 1 0 0 6.8a3.4 3.4 0 1 0 0-6.8Z"/></svg>`;

/** Foto do usuário ou, sem foto, o avatar padrão. */
export function avatarNode(dataUrl) {
  if (typeof dataUrl === "string" && dataUrl.startsWith("data:image/")) {
    const img = new Image();
    img.className = "avatar"; img.alt = ""; img.src = dataUrl;
    return img;
  }
  const span = document.createElement("span");
  span.className = "avatar"; span.innerHTML = DEFAULT_AVATAR;
  return span;
}

/** Barra do usuário: avatar + nome (link para o perfil), engrenagem (configurações), switch do modo escuro e Deslogar. `base` = caminho até a raiz do site. */
export function mountUserBar(host, { base = "" } = {}) {
  host.replaceChildren(); host.classList.add("userbar");
  const session = getSession();
  if (!session) return;
  const account = session.provider !== "anonymous";

  const me = document.createElement(account ? "a" : "span");
  me.className = "me";
  if (account) { me.href = base + "perfil.html"; me.title = "Meu perfil"; }
  const name = document.createElement("span");
  name.className = "nm"; name.textContent = Profile.displayName(session);
  me.append(avatarNode(Profile.get(session.id).avatar), name);
  host.append(me);

  if (account) {
    const gear = document.createElement("a");
    gear.className = "icon-btn"; gear.href = base + "perfil.html";
    gear.title = "Configurações"; gear.setAttribute("aria-label", "Configurações");
    gear.innerHTML = GEAR;
    host.append(gear);
  }
  host.append(themeSwitch());                     // sempre depois da engrenagem (ou do nome, em anônimos) e antes de Deslogar
  if (!account) {                                 // anônimo: em vez de Deslogar, volta para a entrada já na aba escolhida
    const link = (label, mode, primary) => {
      const a = document.createElement("a");
      a.className = "out" + (primary ? " primary" : ""); a.textContent = label;
      a.href = `${base}index.html?modo=${mode}`;
      return a;
    };
    host.append(link("Entrar", "entrar"), link("Criar conta", "conta", true));
    return;
  }
  const out = document.createElement("button");
  out.type = "button"; out.className = "out"; out.textContent = "Deslogar";
  out.onclick = () => { Auth.logout(); location.assign(base + "index.html"); };
  host.append(out);
}
