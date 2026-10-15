/** Progressão compartilhada: o nível sobe a cada WINS_PER_LEVEL vitórias, por jogo e por usuário. */
export const WINS_PER_LEVEL = 15;
export const LEVEL_NAMES = ["Fácil", "Médio", "Difícil", "Genius"];

import { store } from "./storage.js";

/** Id do usuário da sessão atual (gravada pelo site em "wmg.session"); "guest" se o jogo for aberto sozinho. */
export function currentUserId() {
  try { return JSON.parse(localStorage.getItem("wmg.session"))?.id || "guest"; } catch { return "guest"; }
}
export const winsKey = (gameKey, uid = currentUserId()) => `${gameKey}:${uid}`;
export const levelIndex = (wins, levels = LEVEL_NAMES.length) => Math.min(levels - 1, Math.floor(wins / WINS_PER_LEVEL));
/** Vitórias que colocam o jogador no INÍCIO do nível idx (0/15 de progresso nele). */
export const winsForLevel = (idx, levels = LEVEL_NAMES.length) => Math.max(0, Math.min(levels - 1, Math.trunc(idx) || 0)) * WINS_PER_LEVEL;

/** Vitórias e nível salvos de um jogo (gameKey = `key` do catálogo, p. ex. "zip.wins"). Local, como o resto: num backend, vira chamada ao servidor. */
export const Progress = {
  wins: (gameKey, uid = currentUserId()) => Math.max(0, parseInt(store.get(winsKey(gameKey, uid)), 10) || 0),
  level: (gameKey, uid = currentUserId()) => levelIndex(Progress.wins(gameKey, uid)),
};

/** Pontos por vitória, na ordem dos níveis: Fácil 5, Médio 10, Difícil 15, Genius 20. */
export const POINTS_PER_LEVEL = [5, 10, 15, 20];
export const pointsFor = levelIdx => POINTS_PER_LEVEL[Math.max(0, Math.min(levelIdx, POINTS_PER_LEVEL.length - 1))];

/** Texto da pontuação, exibido junto da explicação de cada jogo. */
export const pointsLegend = () =>
  "Pontos por vitória (só para quem tem conta): " + LEVEL_NAMES.map((n, i) => `${n} ${POINTS_PER_LEVEL[i]}`).join(" · ") + ".";
