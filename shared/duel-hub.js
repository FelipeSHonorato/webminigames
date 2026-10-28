/* Entrada dos duelos no hub: "Desafiar amigo" e "Entrar com código".
   Só aparece com a nuvem ligada (duelo exige conta) e quando existe algum jogo de duelo —
   hoje nenhum jogo declara `duel`, então a seção fica escondida até o primeiro jogo do modo. */
import { GAMES } from "../js/games.js";
import { Cloud } from "./backend/cloud.js";

/** Jogos do catálogo marcados como duelo (`duel: true`). */
export const duelGames = (games = GAMES) => Object.entries(games).filter(([, game]) => game.duel);

/** Código do convite: maiúsculas e só A-Z/0-9 (o servidor devolve 6 caracteres). */
export const normalizeCode = value => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const isDuelCode = value => { const code = normalizeCode(value); return code.length >= 4 && code.length <= 8; };

/** Endereço do jogo para o duelo: `?duelo=novo` (criar) ou `?duelo=<id>` (entrar). */
export function duelPage(game, duelId = "novo") {
  const sep = game.path.includes("?") ? "&" : "?";
  return `${game.path}${sep}duelo=${encodeURIComponent(duelId)}`;
}

const node = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};

const MESSAGES = {
  duel_not_found: "Código não encontrado. Confira com quem te convidou.",
  duel_full: "Essa sala já está cheia.",
  bad_code: "Digite o código do convite (4 a 8 letras ou números).",
  bad_status: "Esse duelo já começou ou terminou.",
  expired: "Esse convite expirou. Peça um novo.",
};

/**
 * Monta a seção de duelos em `host`. Devolve `null` quando não deve aparecer.
 * @param {HTMLElement} host
 * @param {{ games?: object, cloud?: object, navigate?: (url: string) => void }} opts
 */
export function mountDuelEntry(host, { games = GAMES, cloud = Cloud, navigate = url => { location.href = url; } } = {}) {
  if (!host) return null;
  const list = duelGames(games);
  if (!cloud?.active || !list.length) { host.replaceChildren(); host.hidden = true; return null; }
  host.hidden = false;

  const root = node("section", "duel-entry");
  root.append(node("h2", "duel-entry-title", "Duelos 1×1"));
  root.append(node("p", "sub", "Desafie um amigo: mesmo cenário e mesma largada. Quem terminar primeiro vence."));

  /* Desafiar: escolhe o jogo e abre a sala (o servidor gera o código). */
  const challengeRow = node("div", "duel-entry-row");
  const gameField = node("label", "duel-entry-field");
  gameField.append(node("span", "", "Jogo"));
  const select = node("select");
  select.id = "duelGame";
  for (const [id, game] of list) {
    const option = node("option", "", game.title ?? id);
    option.value = id;
    select.append(option);
  }
  gameField.append(select);
  const btnChallenge = node("button", "duel-btn duel-primary", "Desafiar amigo");
  btnChallenge.type = "button";
  challengeRow.append(gameField, btnChallenge);

  /* Entrar: o código identifica a sala; o servidor devolve o jogo para abrir a página certa. */
  const joinRow = node("form", "duel-entry-row");
  joinRow.noValidate = true;
  const codeField = node("label", "duel-entry-field");
  codeField.append(node("span", "", "Código do convite"));
  const input = node("input");
  input.id = "duelCode";
  input.maxLength = 8;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "ABC123";
  input.setAttribute("inputmode", "text");
  codeField.append(input);
  const btnJoin = node("button", "duel-btn", "Entrar com código");
  btnJoin.type = "submit";
  joinRow.append(codeField, btnJoin);

  const note = node("p", "duel-note");
  note.setAttribute("role", "status");
  note.hidden = true;
  root.append(challengeRow, joinRow, note);
  host.replaceChildren(root);

  const flash = message => { note.textContent = message; note.hidden = false; };

  btnChallenge.onclick = () => {
    const game = games[select.value];
    if (game) navigate(duelPage(game));
  };

  input.addEventListener("input", () => { input.value = normalizeCode(input.value); note.hidden = true; });

  joinRow.addEventListener("submit", async event => {
    event.preventDefault();
    const code = normalizeCode(input.value);
    if (!isDuelCode(code)) { flash(MESSAGES.bad_code); input.focus(); return; }
    btnJoin.disabled = true;
    try {
      const data = await cloud.duelJoin(code);
      const game = games[data?.gameId];
      if (!game) throw Object.assign(new Error("unknown_game"), { code: "unknown_game" });
      navigate(duelPage(game, data.id));
    } catch (e) {
      flash(MESSAGES[e?.code] ?? "Não foi possível entrar agora. Tente de novo.");
      btnJoin.disabled = false;
    }
  });

  return { destroy() { root.remove(); } };
}
