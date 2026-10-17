import "../shared/backend/boot.js";
import { Auth } from "./auth.js";
import { Cloud } from "../shared/backend/cloud.js";
import { readAuthRedirect } from "../shared/backend/auth-redirect.js";
import { mountPasswordRules } from "./password-rules.js";

/* Página para onde o link de redefinição de senha leva ("Esqueceu a senha?").
   - link novo (?token_hash=...&type=recovery): a nova senha é definida ao enviar o formulário (verifyOtp + updateUser);
   - link antigo (tokens no #): o Supabase já abriu a sessão sozinho (boot.js) e basta definir a senha;
   - erro, link sem validade ou conta fora da nuvem: mensagem clara, sem formulário. */
const $ = id => document.getElementById(id);
const show = id => { for (const s of document.querySelectorAll(".state")) s.hidden = s.id !== id; $(id).querySelector("h1")?.focus({ preventScroll: true }); };
const goToGames = () => location.replace("jogos.html");
const showError = message => { $("errorText").textContent = message; show("s-error"); };

const updateRules = mountPasswordRules($("novaSenha"), $("pwRules"));

const link = readAuthRedirect(window.__authLink);
history.replaceState(null, "", location.pathname);                       // tira o código do endereço (não fica no histórico nem em capturas de tela)

let tokenHash = null;
if (!Cloud.active) showError("A redefinição de senha por e-mail só está disponível com a conta na nuvem.");
else if (link.kind === "error") showError("Este link expirou ou já foi usado. Volte à entrada e peça um novo.");
else if (link.kind === "confirm" && link.type === "recovery") { tokenHash = link.tokenHash; show("s-form"); }
else if (link.kind === "session" && link.type === "recovery") show("s-form");   // link antigo: o Supabase já abriu a sessão
else showError("Não encontramos um link válido de redefinição de senha. Volte à entrada e peça um novo.");

$("resetForm").onsubmit = async e => {
  e.preventDefault();
  const pw = $("novaSenha").value, btn = $("resetBtn");
  if (pw !== $("repete").value) { $("formMsg").textContent = "As senhas não coincidem."; return; }
  btn.disabled = true; $("formMsg").textContent = "";
  try {
    await Auth.completeReset({ tokenHash, password: pw });
    $("resetForm").reset(); updateRules();
    show("s-ok"); setTimeout(goToGames, 2000);
  } catch (err) { $("formMsg").textContent = err.message; }
  finally { btn.disabled = false; }
};
