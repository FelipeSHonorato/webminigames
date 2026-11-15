import { Profile } from "./profile.js";
import { avatarNode } from "./avatar.js";
import { regionName } from "./regions.js";
import { GAMES } from "../js/games.js";

/* ===================== FICHA DO JOGADOR =====================
   Janela aberta ao clicar num nome do ranking: foto, nome/apelido, data da conta, jogo favorito
   (o que ele mais jogou) e o último jogo (com data e hora). Os dados vêm de Profile.card — do
   servidor quando a nuvem está ligada e do próprio navegador no modo local. */

const node = (tag, cls = "", text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;   // nomes de usuário nunca viram HTML
  return n;
};

export const gameTitle = id => (id ? GAMES[id]?.title ?? id : "—");

export function formatAccountDate(ms) {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n).toLocaleDateString("pt-BR") : "Não registrada";
}

export function formatPlayedAt(ms) {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "";
}

export const playsLabel = n => `${n} ${n === 1 ? "partida" : "partidas"}`;

let dialog = null, nameEl = null, avatarBox = null, regionEl = null, statusEl = null;
let facts = null, token = 0;

function fact(label) {
  const row = node("div", "player-card-fact");
  const term = node("dt", "", label);
  const desc = node("dd");
  row.append(term, desc);
  facts.append(row);
  return desc;
}

function build() {
  if (dialog) return dialog;
  dialog = node("dialog", "player-card");
  dialog.setAttribute("aria-labelledby", "player-card-name");

  const close = node("button", "player-card-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Fechar");

  const body = node("div", "player-card-body");
  const head = node("div", "player-card-head");
  avatarBox = node("div", "player-card-avatar");
  const identity = node("div", "player-card-identity");
  nameEl = node("h2", "player-card-name");
  nameEl.id = "player-card-name";
  regionEl = node("p", "player-card-region");
  identity.append(nameEl, regionEl);
  head.append(avatarBox, identity);

  facts = node("dl", "player-card-facts");
  const created = fact("Conta criada em");
  const favorite = fact("Jogo favorito");
  const last = fact("Último jogo");
  statusEl = node("p", "player-card-status");
  statusEl.setAttribute("aria-live", "polite");

  body.append(head, facts, statusEl);
  dialog.append(close, body);
  document.body.append(dialog);

  close.onclick = () => dialog.close();
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => { token++; });
  dialog.facts = { created, favorite, last };
  return dialog;
}

function paintHeader(player) {
  nameEl.textContent = player.name || "Jogador";
  avatarBox.replaceChildren(avatarNode(player.avatar));
  regionEl.textContent = player.region ? `Região: ${regionName(player.region)}` : "";
  regionEl.hidden = !player.region;
}

function paintLoading() {
  statusEl.textContent = "Carregando informações…";
  for (const dd of Object.values(dialog.facts)) dd.textContent = "…";
}

function paintValue(desc, title, sub = "") {
  desc.replaceChildren(node("b", "", title));
  if (sub) desc.append(node("span", "player-card-sub", `· ${sub}`));
}

function paintCard(card) {
  nameEl.textContent = card.name || nameEl.textContent || "Jogador";
  avatarBox.replaceChildren(avatarNode(card.avatar));
  regionEl.textContent = card.region ? `Região: ${regionName(card.region)}` : "";
  regionEl.hidden = !card.region;

  dialog.facts.created.textContent = formatAccountDate(card.createdAt);
  if (card.favorite) paintValue(dialog.facts.favorite, gameTitle(card.favorite.game), playsLabel(card.favorite.plays));
  else dialog.facts.favorite.textContent = "Ainda não jogou";
  if (card.last) paintValue(dialog.facts.last, gameTitle(card.last.game), formatPlayedAt(card.last.at));
  else dialog.facts.last.textContent = "Ainda não jogou";
  statusEl.textContent = "";
}

/** Abre (ou atualiza) a ficha do jogador. `player` é a linha do ranking: { id, name, avatar, region }. */
export async function openPlayerCard(player = {}) {
  build();
  const my = ++token;
  paintHeader(player);
  paintLoading();
  if (!dialog.open) dialog.showModal();

  if (!player.id) {
    statusEl.textContent = "Não foi possível carregar as informações deste jogador.";
    return;
  }
  try {
    const card = await Profile.card(player.id, player);
    if (my !== token) return;                       // fechou ou abriu outro jogador enquanto carregava
    paintCard(card ?? { ...player, createdAt: null, favorite: null, last: null });
  } catch {
    if (my !== token) return;
    statusEl.textContent = "Não foi possível carregar as informações deste jogador.";
    for (const dd of Object.values(dialog.facts)) dd.textContent = "—";
  }
}
