/* Botão "olhinho" nos campos de senha: o campo continua mascarado (type="password") e o usuário pode revelar.
   Adiciona o botão em cada <input type="password"> da página, sem mudar o HTML dos formulários.
   Uso: import { attachPasswordToggles } from "../shared/password-toggle.js"; attachPasswordToggles(); */
const EYE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

function attach(input) {
  if (!input || input.dataset.pwEye) return;
  input.dataset.pwEye = "1";
  const wrap = document.createElement("div");
  wrap.className = "pw-field";
  input.replaceWith(wrap);
  wrap.append(input);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pw-toggle";
  btn.setAttribute("aria-pressed", "false");
  btn.setAttribute("aria-label", "Mostrar senha");
  btn.title = "Mostrar senha";
  btn.innerHTML = EYE;
  btn.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    const label = show ? "Ocultar senha" : "Mostrar senha";
    btn.innerHTML = show ? EYE_OFF : EYE;
    btn.setAttribute("aria-pressed", String(show));
    btn.setAttribute("aria-label", label);
    btn.title = label;
    input.focus();
  });
  wrap.append(btn);
}

export function attachPasswordToggles(root = document) {
  root.querySelectorAll('input[type="password"]').forEach(attach);
}
