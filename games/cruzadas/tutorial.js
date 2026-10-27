/* Passos do tutorial animado das Palavras Cruzadas. As demos usam as classes de animação de
   css/tutorial.css e os estilos de games/cruzadas/tutorial.css. */

const CELL = (area, cls = "block", inner = "") =>
  `<span class="cz-cell ${cls}" style="grid-area:${area}">${inner}</span>`;

const BOARD = `
  <div class="cz-grid" style="--n:5">
    ${CELL("1/1", "clue sel", "SOL<i class=\"cz-arrow dr\">↳</i>")}
    ${CELL("1/2")}
    ${CELL("1/3", "clue", "LUAR<i class=\"cz-arrow d\">↓</i>")}
    ${CELL("1/4")}
    ${CELL("1/5")}
    ${CELL("2/1", "letter on", "S")}
    ${CELL("2/2", "letter on", "O")}
    ${CELL("2/3", "letter on", "L")}
    ${CELL("2/4")}
    ${CELL("2/5")}
    ${CELL("3/1")}
    ${CELL("3/2")}
    ${CELL("3/3", "letter on", "U")}
    ${CELL("3/4")}
    ${CELL("3/5")}
    ${CELL("4/1")}
    ${CELL("4/2")}
    ${CELL("4/3", "letter on", "A")}
    ${CELL("4/4")}
    ${CELL("4/5")}
    ${CELL("5/1")}
    ${CELL("5/2")}
    ${CELL("5/3", "letter on", "R")}
    ${CELL("5/4")}
    ${CELL("5/5")}
  </div>`;

const MINI = `
  <div class="cz-grid" style="--n:4">
    ${CELL("1/1", "clue sel", "SOL<i class=\"cz-arrow r\">→</i>")}
    ${CELL("1/2", "letter on", "S")}
    ${CELL("1/3", "letter on", "O")}
    ${CELL("1/4", "letter on", "L")}
    ${CELL("2/1")}${CELL("2/2")}${CELL("2/3")}${CELL("2/4")}
    ${CELL("3/1")}${CELL("3/2")}${CELL("3/3")}${CELL("3/4")}
  </div>`;

export const CRUZADAS_TUTORIAL = {
  title: "Como jogar · Palavras Cruzadas",
  steps: [
    {
      title: "Siga a seta da dica",
      text: "Cada casa amarela traz uma dica e uma seta. A seta mostra onde a resposta começa e para onde ela segue: → ou ↳ na horizontal, ↓ ou ↴ na vertical.",
      demo: `<div class="cz-stage">
        ${BOARD}
        <span class="cz-note anim fade" style="--d:.9s">amarelo = dica · seta = início da resposta</span>
      </div>`,
    },
    {
      title: "Leia a dica inteira ao lado",
      text: "O texto na grade é pequeno. Toque na dica para vê-la inteira no painel e destacar a linha da resposta. Toque de novo numa letra que cruza duas palavras para trocar o sentido.",
      demo: `<div class="cz-panel">
        ${MINI}
        <div class="cz-cluebox anim rise" style="--d:.4s">
          <span class="cz-dir">→ Horizontal · 3 letras</span>
          <b>Astro que ilumina o dia</b>
        </div>
      </div>`,
    },
    {
      title: "Casas com diagonal têm duas letras",
      text: "A diagonal divide a casa em duas letras, como CH, LH ou NH. Digite uma de cada vez; a dica revela só a primeira e você completa a outra.",
      demo: `<div class="cz-stage">
        <div class="cz-diag">
          <span class="cz-cell dbl anim pop"><i class="d1">C</i><i class="d2">H</i></span>
          <span class="cz-diag-label">duas letras na mesma casa</span>
        </div>
        <span class="cz-note">1ª letra: dica · 2ª letra: você digita</span>
      </div>`,
    },
    {
      title: "Dica e teclado",
      text: "“Dica” preenche a próxima letra da resposta e custa 1 ponto da fase. No teclado, use as letras, Backspace, as setas e Espaço para trocar o sentido.",
      demo: `<div class="cz-stage">
        <div class="cz-tools">
          <span class="cz-hint anim pop">Dica <small>−1 ponto</small></span>
          <span class="cz-keys">
            <i class="cz-key anim press">C</i><i class="cz-key">H</i><i class="cz-key wide">Espaço</i>
          </span>
        </div>
        <span class="cz-note anim fade" style="--d:.8s">setas ← → trocam de dica · Espaço troca o sentido</span>
      </div>`,
    },
  ],
};
