import { GAMES } from "./games.js";

/* Vitrine da página inicial: os mesmos jogos do hub (catálogo em js/games.js), sem placar nem rankings.
   Visitante sem sessão: tocar num jogo abre a janela de acesso. Os dados vêm do catálogo do projeto (estático), não do usuário. */
const $ = id => document.getElementById(id);
const dlg = $("authDialog");

/* Miniaturas: capturas do tabuleiro real de cada jogo (assets/thumbs), uma para cada tema. */
const card = ([id, g], dup) =>
  `<button type="button" class="game" data-open="login"${dup ? ' aria-hidden="true" tabindex="-1"' : ""}>` +
  `<span class="thumb"><img class="th-l" src="assets/thumbs/${id}-light.webp" alt="" width="360" height="360">` +
  `<img class="th-d" src="assets/thumbs/${id}-dark.webp" alt="" width="360" height="360"></span>` +
  `<h3>${g.title}</h3><p>${g.desc}</p><span class="play">Jogar</span></button>`;
const entries = Object.entries(GAMES);
/* Carrossel contínuo: a lista aparece duas vezes e a animação CSS desloca metade da faixa, voltando sem emenda. */
$("games").innerHTML = entries.map(e => card(e, false)).join("") + entries.map(e => card(e, true)).join("");

document.addEventListener("click", e => {
  const trigger = e.target.closest("[data-open]");
  if (!trigger) return;
  $(trigger.dataset.open === "register" ? "tab-register" : "tab-login").click();   // js/login.js cuida da troca de modo
  if (!dlg.open) dlg.showModal();
});
$("dlgClose").onclick = () => dlg.close();
dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); });       // clique no fundo escuro fecha

/* js/login.js roda antes: se a URL pediu ?modo=entrar|conta, ou se voltou do e-mail com erro, já abre a janela. */
const q = new URLSearchParams(location.search);
if (q.has("modo") || q.has("conta") || $("error").textContent) dlg.showModal();
