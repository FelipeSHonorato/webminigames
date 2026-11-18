/* Templates visuais dos jogos de duelo (1×1) e multijogador.

   Um template é só APRESENTAÇÃO: nunca mexe no `domain.js` (que é copiado para a Edge e precisa
   ficar idêntico). Cada jogo tem "espaços" (slots) independentes e combináveis:

     board  → tabuleiro / mesa
     pieces → peças (Xadrez, Dama, Gamão, Go, Onitama)
     cards  → cartas (Onitama, Truco, UNO)

   Hoje cada espaço só tem a opção "Default" (o visual original do jogo, que é o padrão a seguir
   pelos próximos: a pasta `cards/` do UNO, com um arquivo por carta). Para registrar um template novo,
   acrescente um item em `TEMPLATES[jogo][espaço]`; o seletor (`template-picker.js`) já lista tudo.

   Este arquivo não tem DOM: é testado no Node (`tests/templates.test.js`). */

import { store, readJSON } from "./storage.js";

export const DEFAULT_ID = "default";
export const STORAGE_KEY = "wmg.templates";   // { [jogo]: { [espaço]: id } }
export const CHANGE_EVENT = "wmg:template-change";

export const SLOT_LABELS = Object.freeze({
  board: "Tabuleiro",
  table: "Mesa",
  pieces: "Peças",
  stones: "Pedras",
  cards: "Cartas",
});

const DEFAULT_OPTION = Object.freeze({
  id: DEFAULT_ID,
  name: "Default",
  description: "Visual original do jogo.",
});

/** Espaços de cada jogo, na ordem em que aparecem no pop-up. `kind` escolhe a prévia. */
export const TEMPLATE_GAMES = Object.freeze({
  chess: { title: "Xadrez", slots: [
    { id: "board", kind: "board", label: "Tabuleiro" },
    { id: "pieces", kind: "pieces", label: "Peças" },
  ] },
  dama: { title: "Dama", slots: [
    { id: "board", kind: "board", label: "Tabuleiro" },
    { id: "pieces", kind: "pieces", label: "Peças" },
  ] },
  gamao: { title: "Gamão", slots: [
    { id: "board", kind: "board", label: "Tabuleiro" },
    { id: "pieces", kind: "pieces", label: "Peças" },
  ] },
  go: { title: "Go", slots: [
    { id: "board", kind: "board", label: "Tabuleiro" },
    { id: "pieces", kind: "pieces", label: "Pedras" },
  ] },
  onitama: { title: "Onitama", slots: [
    { id: "board", kind: "board", label: "Tabuleiro" },
    { id: "pieces", kind: "pieces", label: "Peças" },
    { id: "cards", kind: "cards", label: "Cartas" },
  ] },
  truco: { title: "Truco Paulista", slots: [
    { id: "board", kind: "board", label: "Mesa" },
    { id: "cards", kind: "cards", label: "Cartas" },
  ] },
  uno: { title: "UNO", slots: [
    { id: "board", kind: "board", label: "Mesa" },
    { id: "cards", kind: "cards", label: "Cartas" },
  ] },
  domino: { title: "Dominó", slots: [
    { id: "board", kind: "board", label: "Mesa" },
    { id: "pieces", kind: "pieces", label: "Pedras" },
  ] },
});

export const templateGameIds = () => Object.keys(TEMPLATE_GAMES);
export const slotsOf = game => TEMPLATE_GAMES[game]?.slots ?? [];

/** Opções de um espaço: por enquanto só a Default. Um jogo/espaço desconhecido devolve []. */
export const TEMPLATES = Object.freeze(Object.fromEntries(Object.entries(TEMPLATE_GAMES).map(([game, cfg]) => [
  game,
  Object.freeze(Object.fromEntries(cfg.slots.map(slot => [slot.id, Object.freeze([DEFAULT_OPTION])]))),
])));

export const listTemplates = (game, slot) => TEMPLATES[game]?.[slot] ?? [];

/* ---------- Seleção do jogador ---------- */

const readAll = () => {
  const all = readJSON(STORAGE_KEY, {});
  return all && typeof all === "object" && !Array.isArray(all) ? all : {};
};

/** Template escolhido para o espaço. Id desconhecido (ex.: template removido) volta para a Default. */
export function getSelected(game, slot) {
  const id = readAll()[game]?.[slot];
  return listTemplates(game, slot).some(option => option.id === id) ? id : DEFAULT_ID;
}

/** Seleção completa do jogo: { board: "default", pieces: "default", ... }. */
export const selectionOf = game => Object.fromEntries(slotsOf(game).map(slot => [slot.id, getSelected(game, slot.id)]));

/** Grava a escolha. Devolve false se o jogo, o espaço ou o template não existem. */
export function setSelected(game, slot, id) {
  if (!listTemplates(game, slot).some(option => option.id === id)) return false;
  const all = readAll();
  all[game] = { ...(all[game] ?? {}), [slot]: id };
  store.set(STORAGE_KEY, JSON.stringify(all));
  if (typeof window !== "undefined" && typeof CustomEvent === "function") {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { game, slot, id } }));
  }
  return true;
}
