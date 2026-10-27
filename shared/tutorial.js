/* Tutorial animado compartilhado: um <dialog> com passos e uma mini-demo em SVG/HTML.

   Uso em um jogo:
     import { mountTutorial } from "../../shared/tutorial.js";
     import { ZIP_TUTORIAL } from "./tutorial.js";
     mountTutorial({ trigger: "howto", ...ZIP_TUTORIAL });

   O botão com o id `trigger` abre o tutorial. Não há persistência: o tutorial só aparece quando
   o jogador pede, então ele pode ser revisto quantas vezes quiser. As animações são CSS/SVG e
   respeitam `prefers-reduced-motion` (veja css/tutorial.css). */

/** Limita o índice ao intervalo [0, total - 1]; total <= 0 vira 0. */
export const clampStep = (index, total) => {
  const n = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0;
  if (n === 0) return 0;
  const i = Number.isFinite(index) ? Math.trunc(index) : 0;
  return Math.max(0, Math.min(n - 1, i));
};

/** `true` quando o índice é o último passo (ou o único). */
export const isLastStep = (index, total) => clampStep(index, total) >= Math.max(0, (Number.isFinite(total) ? Math.trunc(total) : 0) - 1);

/** Rótulo acessível do passo, sempre começando em 1. */
export const stepLabel = (index, total) => {
  const n = Number.isFinite(total) ? Math.max(1, Math.trunc(total)) : 1;
  return `Passo ${clampStep(index, n) + 1} de ${n}`;
};

/**
 * Monta o diálogo do tutorial e liga o botão.
 * @param {object} options
 * @param {string|HTMLElement} options.trigger id (ou elemento) do botão "Como jogar".
 * @param {string} [options.title] título do diálogo (ex.: "Zip").
 * @param {Array<{title:string,text:string,demo:string}>} options.steps passos do tutorial.
 * @returns {{dialog: HTMLDialogElement, open: Function, close: Function}|null}
 */
export function mountTutorial({ trigger, title = "Como jogar", steps = [] } = {}) {
  if (typeof document === "undefined") return null;
  const button = typeof trigger === "string" ? document.getElementById(trigger) : trigger;
  if (!button || !Array.isArray(steps) || steps.length === 0) return null;

  const dialog = document.createElement("dialog");
  dialog.className = "tut";
  dialog.setAttribute("aria-labelledby", "tut-title");
  dialog.innerHTML = `
    <div class="tut-head">
      <h2 id="tut-title"></h2>
      <button type="button" class="tut-close" aria-label="Fechar tutorial">×</button>
    </div>
    <div class="tut-demo" aria-hidden="true"></div>
    <div class="tut-body">
      <p class="tut-count"></p>
      <h3 class="tut-step-title"></h3>
      <p class="tut-text" aria-live="polite"></p>
    </div>
    <div class="tut-dots" role="group" aria-label="Passos do tutorial"></div>
    <div class="tut-actions">
      <button type="button" class="tut-skip">Pular</button>
      <div class="tut-nav">
        <button type="button" class="tut-prev">Anterior</button>
        <button type="button" class="tut-next primary">Próximo</button>
      </div>
    </div>`;
  document.body.append(dialog);

  const demo = dialog.querySelector(".tut-demo");
  const count = dialog.querySelector(".tut-count");
  const stepTitle = dialog.querySelector(".tut-step-title");
  const text = dialog.querySelector(".tut-text");
  const dots = dialog.querySelector(".tut-dots");
  const prev = dialog.querySelector(".tut-prev");
  const next = dialog.querySelector(".tut-next");
  const closeBtn = dialog.querySelector(".tut-close");
  const skip = dialog.querySelector(".tut-skip");
  dialog.querySelector("#tut-title").textContent = title;

  let index = 0;

  function render() {
    const step = steps[index] ?? {};
    const total = steps.length;
    demo.innerHTML = step.demo ?? "";
    count.textContent = stepLabel(index, total);
    stepTitle.textContent = step.title ?? "";
    text.textContent = step.text ?? "";
    prev.disabled = index === 0;
    next.textContent = isLastStep(index, total) ? "Concluir" : "Próximo";
    dots.replaceChildren(...steps.map((_, i) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "tut-dot" + (i === index ? " on" : "");
      dot.setAttribute("aria-label", `Ir para o passo ${i + 1}`);
      dot.setAttribute("aria-current", i === index ? "step" : "false");
      dot.addEventListener("click", () => { index = i; render(); });
      return dot;
    }));
    // Força o layout para as animações recomeçarem quando o mesmo passo é redesenhado.
    demo.getBoundingClientRect();
  }

  const go = delta => {
    index = clampStep(index + delta, steps.length);
    render();
  };

  prev.addEventListener("click", () => go(-1));
  next.addEventListener("click", () => {
    if (isLastStep(index, steps.length)) dialog.close();
    else go(1);
  });
  skip.addEventListener("click", () => dialog.close());
  closeBtn.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("keydown", event => {
    // O jogo atrás do diálogo não pode receber as teclas (o Text Twist, por exemplo, escuta no document).
    event.stopPropagation();
    if (event.key === "ArrowLeft") { event.preventDefault(); go(-1); }
    else if (event.key === "ArrowRight") { event.preventDefault(); go(1); }
  });
  dialog.addEventListener("close", () => button.focus());

  const open = () => {
    index = 0;
    render();
    if (!dialog.open) dialog.showModal();
    next.focus();
  };

  // Enter/Backspace no próprio botão também não devem chegar ao jogo.
  button.addEventListener("keydown", event => event.stopPropagation());
  button.addEventListener("click", open);
  return { dialog, open, close: () => dialog.close() };
}
