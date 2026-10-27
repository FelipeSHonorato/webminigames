/* Passos do tutorial animado do Patches. As demos usam as classes de animação de css/tutorial.css
   e os estilos de games/patches/tutorial.css. */

const CELLS = Array.from({ length: 25 }, () => `<i class="pt-cell"></i>`).join("");

export const PATCHES_TUTORIAL = {
  title: "Como jogar · Patches",
  steps: [
    {
      title: "Desenhe retângulos",
      text: "Arraste de um canto ao outro para criar um patch. Ele precisa encaixar na grade, sem sair do tabuleiro.",
      demo: `<div class="pt-stage">
        <div class="pt-grid">
          ${CELLS}
          <span class="pt-patch anim grow" style="grid-area:2/2/4/5"></span>
          <b class="pt-clue anim pop" style="grid-area:2/2/4/5;--d:.75s">6</b>
        </div>
        <span class="pt-tip anim fade" style="--d:1s">arraste de um canto ao outro</span>
      </div>`,
    },
    {
      title: "A pista manda no formato",
      text: "Cada patch tem exatamente uma pista. O número é a área e a forma colorida é o formato: quadrado, largo, alto ou qualquer.",
      demo: `<div class="pt-stage">
        <div class="pt-examples">
          <div class="pt-ex anim rise" style="--d:.1s"><span class="pt-shape square">4</span><small>quadrado</small></div>
          <div class="pt-ex anim rise" style="--d:.25s"><span class="pt-shape wide">3</span><small>largo</small></div>
          <div class="pt-ex anim rise" style="--d:.4s"><span class="pt-shape tall">3</span><small>alto</small></div>
          <div class="pt-ex anim rise" style="--d:.55s"><span class="pt-shape any">?</span><small>qualquer</small></div>
        </div>
        <span class="pt-tip anim fade" style="--d:.9s">o número é a área; a forma é o formato</span>
      </div>`,
    },
    {
      title: "Cubra a grade inteira",
      text: "Os patches não podem se sobrepor nem deixar buracos. Toque em um patch para removê-lo e desenhar de novo.",
      demo: `<div class="pt-stage">
        <div class="pt-grid">
          ${CELLS}
          <span class="pt-patch p1 anim fade" style="grid-area:1/1/3/4;--d:.1s"></span>
          <span class="pt-patch p2 anim fade" style="grid-area:1/4/4/6;--d:.25s"></span>
          <span class="pt-patch p3 anim fade" style="grid-area:3/1/6/4;--d:.4s"></span>
          <span class="pt-patch p4 anim fade" style="grid-area:4/4/6/6;--d:.55s"></span>
        </div>
        <span class="pt-tip anim fade" style="--d:.9s">sem espaços nem sobreposição</span>
      </div>`,
    },
  ],
};
