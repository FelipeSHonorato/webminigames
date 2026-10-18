/** Progressão compartilhada: o nível sobe a cada WINS_PER_LEVEL vitórias, por jogo e por usuário. */
export const WINS_PER_LEVEL = 15;
export const LEVEL_NAMES = ["Fácil", "Médio", "Difícil", "Genius"];

import { store } from "./storage.js";
import { Cloud } from "./backend/cloud.js";

/** Id do usuário da sessão atual (gravada pelo site em "wmg.session"); "guest" se o jogo for aberto sozinho. */
export function currentUserId() {
  try { return JSON.parse(localStorage.getItem("wmg.session"))?.id || "guest"; } catch { return "guest"; }
}
export const winsKey = (gameKey, uid = currentUserId()) => `${gameKey}:${uid}`;
export const levelIndex = (wins, levels = LEVEL_NAMES.length) => Math.min(levels - 1, Math.floor(wins / WINS_PER_LEVEL));
/** Vitórias que colocam o jogador no INÍCIO do nível idx (0/15 de progresso nele). */
export const winsForLevel = (idx, levels = LEVEL_NAMES.length) => Math.max(0, Math.min(levels - 1, Math.trunc(idx) || 0)) * WINS_PER_LEVEL;

/** "zip.wins" -> "zip" (a chave do catálogo vira o id do jogo na nuvem). */
export const gameIdOf = gameKey => gameKey.replace(/\.wins$/, "");

/** Vitórias e nível salvos de um jogo (gameKey = `key` do catálogo, p. ex. "zip.wins"). Contas na nuvem leem do cache do Supabase; anônimos, do navegador. */
export const Progress = {
  wins: (gameKey, uid = currentUserId()) => (Cloud.owns(uid) ? Cloud.wins(gameIdOf(gameKey)) : Math.max(0, parseInt(store.get(winsKey(gameKey, uid)), 10) || 0)),
  /** Guarda as vitórias. Na nuvem só atualiza a tela: quem soma vitória de verdade é o servidor (Scores.submit -> Cloud.finish). */
  setWins(gameKey, n, uid = currentUserId()) { if (Cloud.owns(uid)) Cloud.setWins(gameIdOf(gameKey), n); else store.set(winsKey(gameKey, uid), String(n)); },
  level: (gameKey, uid = currentUserId()) => levelIndex(Progress.wins(gameKey, uid)),
};

/** Pontos por vitória, na ordem dos níveis: Fácil 5, Médio 10, Difícil 15, Genius 20.
    Vêm de shared/points.js (módulo puro), para o mesmo valor valer no jogo e na Edge Function. */
import { POINTS_PER_LEVEL } from "./points.js";
export { POINTS_PER_LEVEL };
export const pointsFor = levelIdx => POINTS_PER_LEVEL[Math.max(0, Math.min(levelIdx, POINTS_PER_LEVEL.length - 1))];

/** Texto da pontuação, exibido junto da explicação de cada jogo. */
export const pointsLegend = () =>
  "Pontos por vitória (só para quem tem conta): " + LEVEL_NAMES.map((n, i) => `${n} ${POINTS_PER_LEVEL[i]}`).join(" · ") + ".";
