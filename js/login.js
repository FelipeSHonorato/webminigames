import "../shared/backend/boot.js";
import { Auth } from "./auth.js";
import { Cloud } from "../shared/backend/cloud.js";
import { REGIONS } from "../shared/regions.js";
import { themeSwitch } from "../shared/theme.js";
import { mountPasswordRules } from "./password-rules.js";
import { readAuthRedirect } from "../shared/backend/auth-redirect.js";

const $ = id => document.getElementById(id);
const goToGames = () => location.assign("jogos.html");
$("themeHost").append(themeSwitch());
let mode = "login";
$("region").append(new Option("Selecione…", ""), ...REGIONS.map(r => new Option(r.name, r.id)));
mountPasswordRules($("password"), $("pwRules"));

function setMode(next) {
  mode = next;
  const reg = mode === "register";
  $("tab-login").setAttribute("aria-selected", String(!reg));
  $("tab-register").setAttribute("aria-selected", String(reg));
  $("nameField").hidden = !reg;
  $("regionField").hidden = !reg;
  $("password").autocomplete = reg ? "new-password" : "current-password";
  $("pwRules").hidden = !reg;                       // os requisitos só valem para criar conta (quem entra pode ter senha antiga)
  $("submit").textContent = reg ? "Criar conta" : "Entrar";
  $("error").textContent = "";
  $("resend").hidden = true;
}
$("tab-login").onclick = () => setMode("login");
$("tab-register").onclick = () => setMode("register");

$("form").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = $("submit"), data = { name: $("name").value, email: $("email").value, password: $("password").value, region: $("region").value };
  btn.disabled = true; $("error").textContent = "";
  $("info").hidden = true;
  try {
    const result = await (mode === "register" ? Auth.register(data) : Auth.login(data));
    if (result?.needsConfirmation) {                                   // o projeto pede para confirmar o e-mail antes do primeiro acesso
      setMode("login");
      $("info").textContent = `Enviamos um e-mail de confirmação para ${result.email}. Abra o link (confira também o spam) e você entra direto nos jogos.`;
      $("info").hidden = false; $("resend").hidden = false;
      return;
    }
    goToGames();
  }
  catch (err) {
    $("error").textContent = err.message;
    $("resend").hidden = err.code !== "email_not_confirmed";          // conta criada mas e-mail ainda não confirmado
  }
  finally { btn.disabled = false; }
});
$("resend").onclick = async () => {
  const btn = $("resend"); btn.disabled = true; $("error").textContent = "";
  try {
    await Auth.resendConfirmation($("email").value);
    $("info").textContent = `Reenviamos o e-mail de confirmação para ${$("email").value.trim()}. Pode demorar alguns minutos; confira também o spam.`;
    $("info").hidden = false;
  } catch (err) { $("error").textContent = err.message; }
  finally { btn.disabled = false; }
};
$("google").onclick = async () => {
  try { if (await Auth.loginWithGoogle()) goToGames(); }               // com Supabase a página sai para o Google e volta sozinha
  catch (err) { $("error").textContent = err.message; }
};
$("anon").onclick = async () => { await Auth.loginAnonymous(); goToGames(); };
for (const id of ["submit", "google", "anon"]) $(id).disabled = false;   // só liberados depois do boot: sem isso, um Enter antes da hora enviaria o formulário (e a senha) pela URL
$("modeNote").hidden = false;
$("modeNote").textContent = Cloud.active
  ? "Suas contas e registros ficam salvos na nuvem. Quem joga como anônimo não pontua e o progresso fica só neste navegador."
  : "Protótipo: as contas ficam salvas só neste navegador e o botão do Google é uma simulação, sem conexão real com o Google.";


/* ?modo=entrar | ?modo=conta (e o antigo ?conta) abrem a aba pedida, mesmo com sessão anônima ativa;
   ela só é trocada se o usuário concluir o login ou o cadastro. Sem parâmetro, quem já tem sessão vai direto aos jogos. */
const query = new URLSearchParams(location.search);
const wanted = query.get("modo") ?? (query.has("conta") ? "conta" : null);
if (wanted === "conta") setMode("register");
else if (wanted === "entrar") setMode("login");
else if (Auth.current()) location.replace("jogos.html");

// Voltou do Supabase com um erro (p. ex. link do e-mail expirado e a Site URL apontando para esta página): mensagem clara em vez de tela em branco.
const back = readAuthRedirect(window.__authLink);
if (back.kind === "error") $("error").textContent = ["otp_expired", "access_denied"].includes(back.code)
  ? "Este link expirou ou já foi usado. Entre com seu e-mail e senha para receber um novo e-mail de confirmação."
  : back.message.replace(" abaixo", "");
