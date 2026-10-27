/* Passos do tutorial animado da Sopa de Letras. As demos usam as classes de animação de
   css/tutorial.css e os estilos de games/sopa/tutorial.css. */

const LETTERS = [
  ["S", "O", "L", "A", "R", "X"],
  ["C", "A", "S", "A", "M", "E"],
  ["R", "I", "O", "P", "A", "T"],
  ["P", "A", "T", "O", "L", "A"],
  ["M", "A", "R", "E", "S", "O"],
  ["L", "U", "A", "C", "A", "S"],
];

const GRID = (found = [], edge = []) => {
  const f = new Set(found), e = new Set(edge);
  return `<div class="sp-grid">${LETTERS.flatMap((row, r) =>
    row.map((letter, c) => {
      const key = `${r},${c}`;
      const cls = ["sp-cell"];
      if (f.has(key)) cls.push("found");
      if (e.has(key)) cls.push("edge");
      return `<span class="${cls.join(" ")}">${letter}</span>`;
    })
  ).join("")}</div>`;
};

const LIST = (done = []) => {
  const d = new Set(done);
  return `<ul class="sp-list">${["SOL", "CASA", "RIO", "PATO", "MARE", "LUA"].map(word =>
    `<li class="${d.has(word) ? "done" : ""}">${word}</li>`
  ).join("")}</ul>`;
};

export const SOPA_TUTORIAL = {
  title: "Como jogar · Sopa de Letras",
  steps: [
    {
      title: "Ache todas as palavras",
      text: "As palavras da lista estão escondidas na horizontal, na vertical e na diagonal. Encontre todas para vencer.",
      demo: `<div class="sp-stage">
        ${GRID(["0,0", "0,1", "0,2"], ["0,0", "0,2"])}
        ${LIST(["SOL"])}
      </div>`,
    },
    {
      title: "Arraste do começo ao fim",
      text: "Clique e arraste (ou deslize o dedo) da primeira à última letra da palavra. As casas ficam coloridas e a palavra é marcada na lista.",
      demo: `<div class="sp-stage">
        ${GRID(["1,0", "1,1", "1,2", "1,3"], ["1,0", "1,3"])}
        ${LIST(["SOL", "CASA"])}
        <span class="sp-note anim fade" style="--d:.9s">a palavra inteira precisa estar na linha</span>
      </div>`,
    },
    {
      title: "Vale de trás para frente",
      text: "A mesma palavra pode aparecer de trás para frente. Aqui, RIO começa no O e termina no R.",
      demo: `<div class="sp-stage">
        ${GRID(["2,2", "2,1", "2,0"], ["2,2", "2,0"])}
        ${LIST(["SOL", "CASA", "RIO"])}
        <span class="sp-note anim slide" style="--d:.7s">← RIO · de trás para frente</span>
      </div>`,
    },
    {
      title: "A dica revela letras",
      text: "Cada “Dica” revela mais uma letra de cada palavra que falta e custa 1 ponto da fase (a fase nunca vale menos que 1).",
      demo: `<div class="sp-hintstage">
        <div class="sp-masks">
          <span class="sp-mask"><b>S</b><i>_</i><b>L</b></span>
          <span class="sp-mask"><b>C</b><i>_</i><b>S</b><i>_</i></span>
          <span class="sp-mask"><b>R</b><b>I</b><i>_</i></span>
        </div>
        <span class="sp-hint anim pop" style="--d:.4s">Dica <small>−1 ponto</small></span>
        <span class="sp-note anim fade" style="--d:.9s">uma letra nova em cada palavra</span>
      </div>`,
    },
  ],
};
