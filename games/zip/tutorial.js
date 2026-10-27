/* Passos do tutorial animado do Zip. As demos usam as classes de animação de css/tutorial.css
   e os estilos de games/zip/tutorial.css. */

const GRID = `
  <rect class="zp-board" x="94" y="24" width="132" height="132" rx="10"/>
  <path class="zp-lines" d="M138 24V156M182 24V156M94 68H226M94 112H226"/>`;

const SNAKE = "M116 46H204V90H116V134H204";

export const ZIP_TUTORIAL = {
  title: "Como jogar · Zip",
  steps: [
    {
      title: "Ligue os números em ordem",
      text: "Comece no 1 e arraste até o último número. O caminho precisa passar por eles na sequência certa.",
      demo: `<svg viewBox="0 0 320 180" aria-hidden="true">
        <g class="anim fade">${GRID}</g>
        <path class="zp-path anim draw" style="--d:.8s;animation-duration:1.2s" pathLength="1" d="${SNAKE}"/>
        <g class="anim pop" style="--d:.15s"><circle class="zp-node" cx="116" cy="46" r="13"/><text class="zp-num" x="116" y="46">1</text></g>
        <g class="anim pop" style="--d:.45s"><circle class="zp-node" cx="160" cy="90" r="13"/><text class="zp-num" x="160" y="90">2</text></g>
        <g class="anim pop" style="--d:.75s"><circle class="zp-node" cx="204" cy="134" r="13"/><text class="zp-num" x="204" y="134">3</text></g>
      </svg>`,
    },
    {
      title: "Passe por todas as células",
      text: "O caminho tem de cobrir o tabuleiro inteiro, sem repetir nenhuma célula.",
      demo: `<svg viewBox="0 0 320 180" aria-hidden="true">
        <g class="anim fade">${GRID}</g>
        <path class="zp-trail anim draw" style="--d:.2s;animation-duration:1.4s" pathLength="1" d="${SNAKE}"/>
        <path class="zp-path anim draw" style="--d:.35s;animation-duration:1.4s" pathLength="1" d="${SNAKE}"/>
        <text class="zp-count anim fade" style="--d:1.5s" x="160" y="172">9 / 9 células</text>
      </svg>`,
    },
    {
      title: "Paredes bloqueiam",
      text: "As paredes grossas não podem ser cruzadas. Se o caminho bater numa parede, tente outro desvio.",
      demo: `<svg viewBox="0 0 320 180" aria-hidden="true">
        <g class="anim fade">${GRID}</g>
        <path class="zp-wall anim draw" style="--d:.2s" pathLength="1" d="M182 24V112"/>
        <path class="zp-attempt" d="M160 46H204"/>
        <text class="zp-x" x="192" y="46">×</text>
        <path class="zp-path anim draw" style="--d:1.5s;animation-duration:1.1s" pathLength="1" d="M116 46H160V134H204"/>
        <g class="anim pop" style="--d:.15s"><circle class="zp-node" cx="116" cy="46" r="13"/><text class="zp-num" x="116" y="46">1</text></g>
        <g class="anim pop" style="--d:.45s"><circle class="zp-node" cx="160" cy="90" r="13"/><text class="zp-num" x="160" y="90">2</text></g>
        <g class="anim pop" style="--d:.75s"><circle class="zp-node" cx="204" cy="134" r="13"/><text class="zp-num" x="204" y="134">3</text></g>
      </svg>`,
    },
    {
      title: "Atalhos",
      text: "No teclado, use as setas para mover e Backspace para voltar. Desfazer e Reiniciar ajudam a refazer o trajeto.",
      demo: `<div class="zp-stage">
        <div class="zp-keys">
          <div class="zp-keyrow"><span class="zp-key">↑</span></div>
          <div class="zp-keyrow"><span class="zp-key">←</span><span class="zp-key anim press loop" style="--d:.2s">↓</span><span class="zp-key">→</span></div>
          <div class="zp-keyrow"><span class="zp-key zp-wide">Backspace</span></div>
        </div>
        <div class="zp-btns"><span class="zp-btn">Desfazer</span><span class="zp-btn">Reiniciar</span></div>
      </div>`,
    },
  ],
};
