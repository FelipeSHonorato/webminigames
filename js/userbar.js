import { Auth } from "./auth.js";
import { getSession } from "../shared/session.js";
import { Profile } from "../shared/profile.js";
import { themeSwitch } from "../shared/theme.js";
import { avatarNode } from "../shared/avatar.js";
import { isAdmin } from "../shared/roles.js";

const GEAR = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" stroke="currentColor" stroke-width="1" stroke-linejoin="round" d="M9.78 4.73 L10.37 1.73 L13.63 1.73 L14.22 4.73 L15.57 5.29 L18.11 3.59 L20.41 5.89 L18.71 8.43 L19.27 9.78 L22.27 10.37 L22.27 13.63 L19.27 14.22 L18.71 15.57 L20.41 18.11 L18.11 20.41 L15.57 18.71 L14.22 19.27 L13.63 22.27 L10.37 22.27 L9.78 19.27 L8.43 18.71 L5.89 20.41 L3.59 18.11 L5.29 15.57 L4.73 14.22 L1.73 13.63 L1.73 10.37 L4.73 9.78 L5.29 8.43 L3.59 5.89 L5.89 3.59 L8.43 5.29 Z M12 8.6a3.4 3.4 0 1 0 0 6.8a3.4 3.4 0 1 0 0-6.8Z"/></svg>`;
const MENU = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 7h16M4 12h16M4 17h16"/></svg>`;

let teardown = null;   // remove os listeners do menu anterior quando a barra é remontada (perfil/painel)

/** Barra do usuário: avatar + nome (link para o perfil), engrenagem (configurações), switch do modo escuro e Deslogar.
    Em telas estreitas as ações se recolhem num menu sanduíche (`js/userbar.js` + `css/userbar.css`); o "← Jogos" e o
    saldo de coins continuam na barra. `base` = caminho até a raiz do site. */
export function mountUserBar(host, { base = "" } = {}) {
  teardown?.(); teardown = null;
  host.replaceChildren(); host.classList.add("userbar");
  const session = getSession();
  if (!session) return;
  const account = session.provider !== "anonymous";

  const menu = document.createElement("div");
  menu.className = "usermenu"; menu.id = "usermenu";

  const me = document.createElement(account ? "a" : "span");
  me.className = "me";
  if (account) { me.href = base + "perfil.html"; me.title = "Meu perfil"; }
  const name = document.createElement("span");
  name.className = "nm"; name.textContent = Profile.displayName(session);
  me.append(avatarNode(Profile.get(session.id).avatar), name);
  menu.append(me);

  if (isAdmin(session)) {
    const panel = document.createElement("a");
    panel.className = "out"; panel.textContent = "Painel";
    panel.href = base + "admin.html"; panel.title = "Painel do administrador";
    menu.append(panel);
  }

  if (account) {
    const gear = document.createElement("a");
    gear.className = "icon-btn"; gear.href = base + "perfil.html";
    gear.title = "Configurações"; gear.setAttribute("aria-label", "Configurações");
    gear.innerHTML = GEAR + `<span class="lbl">Configurações</span>`;   // o rótulo só aparece dentro do menu
    menu.append(gear);
  }
  menu.append(themeSwitch());                     // sempre depois da engrenagem (ou do nome, em anônimos) e antes de Deslogar
  if (!account) {                                 // anônimo: em vez de Deslogar, volta para a entrada já na aba escolhida
    const link = (label, mode, primary) => {
      const a = document.createElement("a");
      a.className = "out" + (primary ? " primary" : ""); a.textContent = label;
      a.href = `${base}index.html?modo=${mode}`;
      return a;
    };
    menu.append(link("Entrar", "entrar"), link("Criar conta", "conta", true));
  } else {
    const out = document.createElement("button");
    out.type = "button"; out.className = "out"; out.textContent = "Deslogar";
    out.onclick = async () => { out.disabled = true; await Auth.logout(); location.assign(base + "index.html"); };
    menu.append(out);
  }

  const toggle = document.createElement("button");
  toggle.type = "button"; toggle.className = "menu-toggle";
  toggle.setAttribute("aria-controls", "usermenu");
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-label", "Menu"); toggle.title = "Menu";
  toggle.innerHTML = MENU;

  const close = () => { menu.classList.remove("open"); toggle.setAttribute("aria-expanded", "false"); };
  toggle.onclick = () => { const open = menu.classList.toggle("open"); toggle.setAttribute("aria-expanded", String(open)); };
  menu.addEventListener("click", e => { if (e.target.closest("a")) close(); });   // ao navegar, fecha
  const onDoc = e => { if (!host.contains(e.target)) close(); };
  const onKey = e => { if (e.key === "Escape") close(); };
  document.addEventListener("click", onDoc);
  document.addEventListener("keydown", onKey);
  teardown = () => { document.removeEventListener("click", onDoc); document.removeEventListener("keydown", onKey); };

  host.append(toggle, menu);
}
