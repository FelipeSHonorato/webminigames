/* Botão "Template" + pop-up de escolha do visual (tabuleiro/mesa, peças, cartas).

   Uso numa página de jogo (duelo ou multijogador), logo depois de montar a tela de setup:

     import { mountTemplatePicker } from "../../shared/template-picker.js";
     mountTemplatePicker({ game: GAME_ID });          // liga o botão #templateBtn

   O `index.html` do jogo tem o botão ao lado de "Criar sala online":
     <button id="templateBtn" class="secondary" type="button" aria-haspopup="dialog">Template</button>

   O pop-up lista, por espaço (`TEMPLATE_GAMES[jogo].slots`), as opções de `shared/templates.js` com uma
   prévia de cada uma. Escolher grava a seleção (`setSelected`) e dispara `wmg:template-change`; quem
   desenha o jogo escuta o evento (ou lê `selectionOf(jogo)`) para aplicar o template. */

import { getSelected, listTemplates, setSelected, slotsOf, TEMPLATE_GAMES } from "./templates.js";
import { renderPreview } from "./template-previews.js";

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/**
 * @param {object} options
 * @param {string} options.game id do jogo (chave de `TEMPLATE_GAMES`).
 * @param {string|HTMLElement} [options.trigger] id (ou elemento) do botão "Template".
 * @param {string} [options.base] caminho das imagens do jogo, relativo à página (UNO: `./`).
 * @param {(change: {game: string, slot: string, id: string}) => void} [options.onChange]
 * @returns {{dialog: HTMLDialogElement, open: Function, close: Function, refresh: Function}|null}
 */
export function mountTemplatePicker({ game, trigger = "templateBtn", base = "./", onChange } = {}) {
  if (typeof document === "undefined") return null;
  const config = TEMPLATE_GAMES[game];
  const button = typeof trigger === "string" ? document.getElementById(trigger) : trigger;
  if (!config || !button) return null;

  const titleId = `tpl-title-${game}`;
  const dialog = el("dialog", "tpl-dialog");
  dialog.setAttribute("aria-labelledby", titleId);

  const head = el("div", "tpl-head");
  const title = el("h2", "", `Template · ${config.title}`);
  title.id = titleId;
  const close = el("button", "tpl-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Fechar escolha de template");
  head.append(title, close);

  const body = el("div", "tpl-body");
  body.append(el("p", "tpl-intro",
    "Escolha como o jogo aparece para você. Só muda o visual: as regras e a partida são as mesmas para todos."));

  const options = [];   // { slot, id, node }
  for (const slot of slotsOf(game)) {
    const section = el("section", "tpl-section");
    const headingId = `tpl-${game}-${slot.id}`;
    const heading = el("h3", "tpl-heading", slot.label);
    heading.id = headingId;
    const list = el("div", "tpl-list");
    list.setAttribute("role", "radiogroup");
    list.setAttribute("aria-labelledby", headingId);

    for (const option of listTemplates(game, slot.id)) {
      const node = el("button", "tpl-option");
      node.type = "button";
      node.setAttribute("role", "radio");
      node.dataset.slot = slot.id;
      node.dataset.id = option.id;
      const preview = el("span", "tpl-preview");
      preview.dataset.kind = slot.kind;
      const meta = el("span", "tpl-meta");
      meta.append(el("b", "", option.name), el("small", "", option.description));
      const mark = el("span", "tpl-check", "✓");
      mark.setAttribute("aria-hidden", "true");
      node.append(preview, meta, mark);
      node.addEventListener("click", () => choose(slot.id, option.id));
      list.append(node);
      options.push({ slot, id: option.id, node, preview });
    }
    section.append(heading, list);
    body.append(section);
  }

  const foot = el("div", "tpl-foot");
  foot.append(el("p", "tpl-note", "Novos templates de tabuleiro e de peças vão aparecer aqui."));
  const done = el("button", "tpl-done", "Concluir");
  done.type = "button";
  foot.append(done);

  dialog.append(head, body, foot);
  document.body.append(dialog);

  let drawn = false;
  /** As prévias só são montadas na 1ª abertura: o UNO não baixa as cartas antes de alguém pedir. */
  function drawPreviews() {
    if (drawn) return;
    drawn = true;
    for (const { slot, id, preview } of options) preview.innerHTML = renderPreview(game, slot.kind, id, { base });
  }

  function refresh() {
    for (const { slot, id, node } of options) {
      const on = getSelected(game, slot.id) === id;
      node.setAttribute("aria-checked", String(on));
      node.tabIndex = on ? 0 : -1;
      node.classList.toggle("on", on);
    }
  }

  function choose(slotId, id) {
    if (!setSelected(game, slotId, id)) return;
    refresh();
    onChange?.({ game, slot: slotId, id });
  }

  /* Setas movem a escolha dentro do mesmo espaço (padrão de radiogroup). */
  dialog.addEventListener("keydown", event => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    const current = event.target.closest?.(".tpl-option");
    if (!step || !current) return;
    const group = options.filter(o => o.slot.id === current.dataset.slot);
    const index = group.findIndex(o => o.node === current);
    const next = group[(index + step + group.length) % group.length];
    event.preventDefault();
    next.node.focus();
    choose(next.slot.id, next.id);
  });

  const open = () => {
    drawPreviews();
    refresh();
    if (!dialog.open) dialog.showModal();
    (options.find(o => o.node.getAttribute("aria-checked") === "true") ?? { node: done }).node.focus();
  };
  const shut = () => dialog.close();

  button.addEventListener("click", open);
  close.addEventListener("click", shut);
  done.addEventListener("click", shut);
  dialog.addEventListener("click", event => { if (event.target === dialog) shut(); });   // clique no fundo

  refresh();
  return { dialog, open, close: shut, refresh };
}
