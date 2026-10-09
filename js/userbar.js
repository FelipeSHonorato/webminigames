import { Auth } from "./auth.js";
import { getSession } from "../shared/session.js";
import { Profile } from "../shared/profile.js";
import { themeSwitch } from "../shared/theme.js";
import { avatarNode } from "../shared/avatar.js";
import { isAdmin } from "../shared/roles.js";

const GEAR = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" stroke="currentColor" stroke-width="1" stroke-linejoin="round" d="M9.78 4.73 L10.37 1.73 L13.63 1.73 L14.22 4.73 L15.57 5.29 L18.11 3.59 L20.41 5.89 L18.71 8.43 L19.27 9.78 L22.27 10.37 L22.27 13.63 L19.27 14.22 L18.71 15.57 L20.41 18.11 L18.11 20.41 L15.57 18.71 L14.22 19.27 L13.63 22.27 L10.37 22.27 L9.78 19.27 L8.43 18.71 L5.89 20.41 L3.59 18.11 L5.29 15.57 L4.73 14.22 L1.73 13.63 L1.73 10.37 L4.73 9.78 L5.29 8.43 L3.59 5.89 L5.89 3.59 L8.43 5.29 Z M12 8.6a3.4 3.4 0 1 0 0 6.8a3.4 3.4 0 1 0 0-6.8Z"/></svg>`;

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

  if (isAdmin(session)) {
    const panel = document.createElement("a");
    panel.className = "out"; panel.textContent = "Painel";
    panel.href = base + "admin.html"; panel.title = "Painel do administrador";
    host.append(panel);
  }

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
