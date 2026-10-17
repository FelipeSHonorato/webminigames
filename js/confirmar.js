import "../shared/backend/boot.js";
import { Auth } from "./auth.js";
import { Cloud } from "../shared/backend/cloud.js";
import { readAuthRedirect, linkErrorMessage } from "../shared/backend/auth-redirect.js";

/* Página para onde o link do e-mail de confirmação leva. Ao abrir, confirma sozinho (sem um segundo clique):
   - link novo (?token_hash=...): valida o código e abre a sessão; em seguida mostra "E-mail confirmado!"
     com o botão "Ir para os jogos" (que entra já logado);
   - link antigo (tokens depois do #): o Supabase já abriu a sessão sozinho (boot.js);
   - erro (link expirado ou já usado): mensagem clara + pedido de novo e-mail;
   - nada: quem abriu a página sem link. */
const $ = id => document.getElementById(id);
const show = id => { for (const s of document.querySelectorAll(".state")) s.hidden = s.id !== id; $(id).querySelector("h1")?.focus({ preventScroll: true }); };
const showError = message => { $("errorText").textContent = message; show("s-error"); };
const showDone = () => show("s-ok");

$("resendForm").onsubmit = async e => {
  e.preventDefault();
  const btn = $("resendBtn"); btn.disabled = true; $("resendMsg").textContent = "";
  try {
    await Auth.resendConfirmation($("resendEmail").value);
    $("resendMsg").textContent = "Pronto! Enviamos um novo e-mail. Pode demorar alguns minutos; confira também o spam.";
  } catch (err) { $("resendMsg").textContent = err.message; }
  finally { btn.disabled = false; }
};

const link = readAuthRedirect(window.__authLink);
history.replaceState(null, "", location.pathname);                      // tira o código do endereço (não fica no histórico nem em capturas de tela)

if (!Cloud.active) location.replace("index.html");                     // modo local: não há e-mail de confirmação
else if (link.kind === "error") showError(link.message);
else if (link.kind === "session") showDone();                           // link antigo: o Supabase já abriu a sessão sozinho
else if (link.kind === "confirm") {
  show("s-wait");
  try { await Auth.confirmEmail(link); showDone(); }                    // confirma na hora e abre a sessão: o botão só leva aos jogos
  catch (err) { showError(linkErrorMessage(err.code)); }
}
else if (Cloud.uid) showDone();                                         // abriu a página já logado, sem link
else showError("Não encontramos um link de confirmação válido. Se você acabou de criar a conta, peça um novo e-mail abaixo; se já confirmou, volte e entre.");
