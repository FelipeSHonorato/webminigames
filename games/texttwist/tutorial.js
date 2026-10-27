/* Passos do tutorial animado do Text Twist. As demos usam as classes de animação de css/tutorial.css
   e os estilos de games/texttwist/tutorial.css. */

const tiles = (letters, selected = [], used = [], offset = 0) => letters.map((letter, i) => {
  const classes = ["tw-tile", "anim", "pop"];
  if (selected.includes(i)) classes.push("sel");
  if (used.includes(i)) classes.push("used", "tw-dim");
  const delay = used.includes(i) ? 1.2 + i * 0.1 : offset + i * 0.08;
  return `<span class="${classes.join(" ")}" style="--d:${delay.toFixed(2)}s">${letter}</span>`;
}).join("");

const slots = (letters, total = 6, delay = 1.0) => Array.from({ length: total }, (_, i) => {
  const letter = letters[i];
  return letter
    ? `<span class="tw-slot on"><b class="anim fade" style="--d:${(delay + i * 0.15).toFixed(2)}s">${letter}</b></span>`
    : `<span class="tw-slot"></span>`;
}).join("");

export const TEXTTWIST_TUTORIAL = {
  title: "Como jogar · Text Twist",
  steps: [
    {
      title: "Monte palavras",
      text: "Toque nas letras (ou digite) para formar palavras de 3 letras ou mais. Enter envia e Backspace apaga.",
      demo: `<div class="tw-stage">
        <div class="tw-tiles">${tiles([..."OSCEUL"], [0, 1, 5])}</div>
        <div class="tw-slots">${slots([..."SOL"], 6, 1.1)}</div>
      </div>`,
    },
    {
      title: "Cada letra conta",
      text: "Você só pode usar cada letra tantas vezes quanto ela aparece. Se há dois A, pode usar os dois — mas não três.",
      demo: `<div class="tw-stage">
        <div class="tw-tiles">${tiles([..."CASACO"], [0, 1, 2, 3], [0, 1, 2, 3], 0)}</div>
        <div class="tw-slots">${slots([..."CASA"], 6, 1.5)}</div>
      </div>`,
    },
    {
      title: "Ache a palavra que usa todas",
      text: "A rodada termina quando você forma uma palavra com todas as letras do tabuleiro. Ela vale o “twist”.",
      demo: `<div class="tw-stage">
        <div class="tw-tiles">${tiles([..."CASULO"], [0, 1, 2, 3, 4, 5])}</div>
        <div class="tw-slots win">${slots([..."CASULO"], 6, 1.0)}</div>
        <div class="tw-badge anim pop" style="--d:1.9s">TWIST!</div>
      </div>`,
    },
    {
      title: "Acompanhe as lacunas",
      text: "O painel à direita mostra quantas palavras existem em cada tamanho e quais você já achou.",
      demo: `<div class="tw-stage">
        <div class="tw-panel">
          <div class="tw-row">
            <span class="tw-len">3 letras · 2/5</span>
            <span class="tw-chips">
              <i class="tw-chip ok anim pop" style="--d:.2s">SOL</i>
              <i class="tw-chip ok anim pop" style="--d:.4s">RIO</i>
              <i class="tw-chip anim pop" style="--d:.6s">•••</i>
              <i class="tw-chip anim pop" style="--d:.7s">•••</i>
              <i class="tw-chip anim pop" style="--d:.8s">•••</i>
            </span>
          </div>
          <div class="tw-row">
            <span class="tw-len">4 letras · 1/3</span>
            <span class="tw-chips">
              <i class="tw-chip ok anim pop" style="--d:1s">CASA</i>
              <i class="tw-chip anim pop" style="--d:1.2s">•••</i>
              <i class="tw-chip anim pop" style="--d:1.3s">•••</i>
            </span>
          </div>
          <div class="tw-row">
            <span class="tw-len">6 letras · 0/1</span>
            <span class="tw-chips"><i class="tw-chip anim pop" style="--d:1.5s">•••</i></span>
          </div>
        </div>
      </div>`,
    },
  ],
};
