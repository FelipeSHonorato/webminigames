import "../shared/backend/boot.js";
import { Auth } from "./auth.js";
import { Cloud } from "../shared/backend/cloud.js";
import { REGIONS } from "../shared/regions.js";
import { themeSwitch } from "../shared/theme.js";

const $ = id => document.getElementById(id);
const goToGames = () => location.assign("jogos.html");
$("themeHost").append(themeSwitch());
let mode = "login";
$("region").append(new Option("Selecione…", ""), ...REGIONS.map(r => new Option(r.name, r.id)));

function setMode(next) {
  mode = next;
  const reg = mode === "register";
  $("tab-login").setAttribute("aria-selected", String(!reg));
  $("tab-register").setAttribute("aria-selected", String(reg));
  $("nameField").hidden = !reg;
  $("regionField").hidden = !reg;
  $("password").autocomplete = reg ? "new-password" : "current-password";
  $("submit").textContent = reg ? "Criar conta" : "Entrar";
  $("error").textContent = "";
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
      $("info").textContent = `Enviamos um e-mail de confirmação para ${result.email}. Abra o link e depois entre pela aba Entrar.`;
      $("info").hidden = false; setMode("login");
      return;
    }
    goToGames();
  }
  catch (err) { $("error").textContent = err.message; }
  finally { btn.disabled = false; }
});
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
