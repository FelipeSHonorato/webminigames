/* Passos do tutorial animado do CrossMath. As demos usam as classes de animação de
   css/tutorial.css e os estilos de games/crossmath/tutorial.css. */

const CELL = (v, cls = "") => `<span class="cx-cell${cls ? ` ${cls}` : ""}">${v}</span>`;
const OP = v => `<span class="cx-op">${v}</span>`;
const EQ = (parts, extra = "") => `<div class="cx-eq${extra ? ` ${extra}` : ""}">${parts.join("")}</div>`;

export const CROSSMATH_TUTORIAL = {
  title: "Como jogar · CrossMath",
  steps: [
    {
      title: "Contas cruzadas",
      text: "A grade tem equações na horizontal e na vertical. Elas se cruzam: o número de um cruzamento vale para as duas contas ao mesmo tempo.",
      demo: `<div class="cx-stage">
        ${EQ([CELL(4, "given"), OP("+"), CELL(2, "shared anim pop"), OP("="), CELL(6, "given")])}
        ${EQ([CELL(2, "shared anim pop"), OP("+"), CELL(3, "given"), OP("="), CELL(5, "given")])}
        <span class="cx-note anim fade" style="--d:.6s">o 2 do cruzamento aparece nas duas equações</span>
      </div>`,
    },
    {
      title: "Da esquerda para a direita",
      text: "As contas são lidas na ordem em que aparecem, sem preferência por × ou ÷. Primeiro 8 − 3 = 5; depois 5 + 1 = 6.",
      demo: `<div class="cx-stage">
        ${EQ([CELL(8, "given"), OP("−"), CELL(3, "given"), OP("+"), CELL(1, "given"), OP("="), CELL(6, "anim pop")])}
        <div class="cx-steps">
          <span class="cx-step anim rise" style="--d:.2s">8 − 3 = 5</span>
          <span class="cx-step anim rise" style="--d:.5s">5 + 1 = 6</span>
        </div>
      </div>`,
    },
    {
      title: "Preencha os buracos",
      text: "As casas tracejadas são buracos. Escolha um número do banco e toque na casa; as casas escuras já vêm prontas e não mudam.",
      demo: `<div class="cx-stage">
        ${EQ([CELL(3, "given"), OP("+"), CELL("·", "hole anim press loop"), OP("="), CELL(7, "given")])}
        <div class="cx-bank anim fade" style="--d:.5s">
          <span class="cx-chip">4</span><span class="cx-chip">6</span><span class="cx-chip">7</span>
          <span class="cx-arrow">→</span>
          ${CELL(4, "filled anim pop")}
        </div>
        <span class="cx-note">toque no número do banco, depois na casa</span>
      </div>`,
    },
    {
      title: "Cada número uma vez",
      text: "O banco é a lista de números que faltam. Cada ficha é usada uma única vez; quando uma equação fica completa e não fecha, ela fica vermelha.",
      demo: `<div class="cx-stage">
        <div class="cx-bank">
          <span class="cx-chip used">4</span><span class="cx-chip sel">2</span><span class="cx-chip">2</span><span class="cx-chip">5</span>
        </div>
        ${EQ([CELL(4, "filled"), OP("+"), CELL(2, "shared filled"), OP("="), CELL(6, "given")])}
        ${EQ([CELL(2, "shared filled"), OP("+"), CELL(3, "given"), OP("="), CELL(5, "given")])}
        <span class="cx-note">as duas fichas “2” são números diferentes</span>
      </div>`,
    },
    {
      title: "Ganhe quando tudo fechar",
      text: "A fase termina quando todos os buracos estão preenchidos e todas as equações, nas duas direções, estão corretas. Backspace devolve o número ao banco.",
      demo: `<div class="cx-stage">
        ${EQ([CELL(5, "filled"), OP("+"), CELL(4, "filled"), OP("="), CELL(9, "given")], "ok")}
        ${EQ([CELL(5, "filled"), OP("−"), CELL(2, "filled"), OP("="), CELL(3, "given")], "ok")}
        <span class="cx-note anim pop" style="--d:.4s">✓ todas as contas fecham</span>
      </div>`,
    },
  ],
};
