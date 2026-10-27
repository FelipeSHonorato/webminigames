/* Ajuda compartilhada de dificuldades e níveis: um <dialog> aberto pelo "?" ao lado da
   dificuldade do jogo. O conteúdo é montado a partir das constantes de shared/progress.js,
   então pontos e vitórias por nível não ficam duplicados no texto.

   Uso em um jogo:
     import { mountLevelHelp } from "../../shared/level-help.js";
     mountLevelHelp({ trigger: "levelHelp", getLevel: () => levelOf(wins) });

   `getLevel` é consultado a cada abertura para destacar o nível atual. O diálogo não tem
   persistência: é só uma explicação, disponível quando o jogador quiser. */

import { LEVEL_NAMES, POINTS_PER_LEVEL, WINS_PER_LEVEL } from "./progress.js";

/** Linhas exibidas no diálogo: nome do nível, pontos por vitória e vitórias para subir. */
export const levelHelpRows = () => LEVEL_NAMES.map((name, i) => ({
  name,
  points: POINTS_PER_LEVEL[i],
  wins: WINS_PER_LEVEL,
}));

/**
 * Monta o diálogo de ajuda e liga o botão.
 * @param {object} options
 * @param {string|HTMLElement} options.trigger id (ou elemento) do botão "?".
 * @param {() => number} [options.getLevel] nível atual (0–3), destacado ao abrir.
 * @returns {{dialog: HTMLDialogElement, open: Function, close: Function}|null}
 */
export function mountLevelHelp({ trigger, getLevel = () => -1 } = {}) {
  if (typeof document === "undefined") return null;
  const button = typeof trigger === "string" ? document.getElementById(trigger) : trigger;
  if (!button) return null;

  const rows = levelHelpRows();
  const dialog = document.createElement("dialog");
  dialog.className = "tut level-help-dialog";
  dialog.setAttribute("aria-labelledby", "level-help-title");
  dialog.innerHTML = `
    <div class="tut-head">
      <h2 id="level-help-title"></h2>
      <button type="button" class="tut-close" aria-label="Fechar ajuda de níveis">×</button>
    </div>
    <div class="tut-body level-help-body">
      <p class="level-help-intro">Cada jogo tem <b>4 níveis</b>. Você começa no <b>Fácil</b> e sobe um nível a cada <b>${WINS_PER_LEVEL} vitórias</b> naquele jogo.</p>
      <ol class="level-help-list">
        ${rows.map((row, i) => `
          <li class="level-help-item" data-level="${i}">
            <span class="level-help-label">
              <span class="level-help-name">${row.name}</span>
              <span class="level-help-current" hidden>atual</span>
            </span>
            <span class="level-help-points">${row.points} pts por vitória</span>
          </li>`).join("")}
      </ol>
      <p class="level-help-note">A barra ao lado mostra o progresso dentro do nível (x/${WINS_PER_LEVEL}). No <b>Genius</b>, ela mostra o total de vitórias.</p>
      <p class="level-help-note">O nível é independente por jogo: as vitórias em um jogo não contam nos outros. Os pontos só entram no ranking para quem tem conta.</p>
      <p class="level-help-note">O que muda em cada nível depende do jogo: tamanho do tabuleiro, tempo, quantidade de pistas e outras regras.</p>
    </div>
    <div class="tut-actions">
      <div class="tut-nav"><button type="button" class="tut-next primary">Entendi</button></div>
    </div>`;
  document.body.append(dialog);
  dialog.querySelector("#level-help-title").textContent = "Dificuldades e níveis";

  const items = [...dialog.querySelectorAll(".level-help-item")];
  const next = dialog.querySelector(".tut-next");
  const close = () => dialog.close();

  const open = () => {
    const level = Math.trunc(Number(getLevel()));
    items.forEach((item, i) => {
      const on = i === level;
      item.classList.toggle("on", on);
      item.querySelector(".level-help-current").hidden = !on;
    });
    if (!dialog.open) dialog.showModal();
    next.focus();
  };

  dialog.querySelector(".tut-close").addEventListener("click", close);
  next.addEventListener("click", close);
  dialog.addEventListener("click", event => {
    if (event.target === dialog) close();
  });
  // O jogo atrás do diálogo não pode receber as teclas (o Text Twist escuta no document).
  dialog.addEventListener("keydown", event => event.stopPropagation());
  dialog.addEventListener("close", () => setTimeout(() => button.focus(), 0));

  // Enter/Backspace no próprio botão também não devem chegar ao jogo.
  button.addEventListener("keydown", event => event.stopPropagation());
  button.addEventListener("click", open);

  return { dialog, open, close };
}
