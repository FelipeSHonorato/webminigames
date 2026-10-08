import { Auth } from "./auth.js";
import { REGIONS } from "../shared/regions.js";

const $ = id => document.getElementById(id);
const goToGames = () => location.assign("jogos.html");
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
  try { await (mode === "register" ? Auth.register(data) : Auth.login(data)); goToGames(); }
  catch (err) { $("error").textContent = err.message; }
  finally { btn.disabled = false; }
});
$("google").onclick = () => { Auth.loginWithGoogle(); goToGames(); };
$("anon").onclick = () => { Auth.loginAnonymous(); goToGames(); };


/* Quem já tem sessão vai direto para a página de jogos; "Sair" volta para cá. */
if (new URLSearchParams(location.search).has("conta")) { Auth.logout(); setMode("register"); }   // vindo do aviso "Criar conta" (anônimo)
else if (Auth.current()) location.replace("jogos.html");
