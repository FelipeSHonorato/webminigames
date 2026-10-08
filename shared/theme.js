import { store } from "./storage.js";

const KEY = "wmg.theme";   // "dark" | "light"; sem valor, vale o tema do sistema
const systemDark = () => matchMedia("(prefers-color-scheme: dark)");

export const Theme = {
  current: () => document.documentElement.dataset.theme || (systemDark().matches ? "dark" : "light"),
  set(theme) {
    document.documentElement.dataset.theme = theme;
    store.set(KEY, theme);
    dispatchEvent(new CustomEvent("themechange", { detail: theme }));
  },
  toggle() { this.set(this.current() === "dark" ? "light" : "dark"); },
};

const ICONS = `
  <svg class="ico sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/></svg>
  <svg class="ico moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>
  <span class="knob" aria-hidden="true"></span>`;

/** Botão tipo switch (sol / lua) que liga e desliga o modo escuro. */
export function themeSwitch() {
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "theme-switch";
  btn.setAttribute("role", "switch");
  btn.setAttribute("aria-label", "Modo escuro"); btn.title = "Modo escuro";
  btn.innerHTML = ICONS;                          // ícones estáticos, sem dados do usuário
  const sync = () => btn.setAttribute("aria-checked", String(Theme.current() === "dark"));
  sync();
  btn.onclick = () => Theme.toggle();
  addEventListener("themechange", sync);
  systemDark().addEventListener?.("change", sync);
  return btn;
}
