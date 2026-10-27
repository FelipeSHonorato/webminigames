/* Passos do tutorial animado do Queens. As demos usam as classes de animação de
   css/tutorial.css e os estilos de games/queens/tutorial.css. */

const REGIONS = [
  "aabb",
  "aabc",
  "ddcc",
  "ddcc",
];

const GRID = (queens = [], marks = [], bad = []) => {
  const q = new Set(queens), m = new Set(marks), b = new Set(bad);
  return `<div class="qn-grid">${REGIONS.flatMap((row, r) =>
    [...row].map((region, c) => {
      const key = `${r + 1},${c + 1}`;
      const inner = q.has(key) ? `<span class="qn-q${b.has(key) ? " bad" : ""}">♛</span>`
        : m.has(key) ? `<span class="qn-x">×</span>` : "";
      return `<span class="qn-cell r${region}${b.has(key) ? " bad" : ""}">${inner}</span>`;
    })
  ).join("")}</div>`;
};

export const QUEENS_TUTORIAL = {
  title: "Como jogar · Queens",
  steps: [
    {
      title: "Uma rainha por linha, coluna e região",
      text: "Coloque uma rainha em cada linha, cada coluna e cada região colorida. Toque numa casa para pôr a rainha e toque de novo para tirar.",
      demo: `<div class="qn-stage">
        ${GRID(["1,3", "2,1", "3,4", "4,2"])}
        <span class="qn-note anim fade" style="--d:.9s">4 rainhas · 4 linhas · 4 colunas · 4 regiões</span>
      </div>`,
    },
    {
      title: "Elas não podem se tocar",
      text: "Duas rainhas nunca podem ficar nas 8 casas em volta uma da outra — nem na diagonal. Marque X nas casas descartadas para rascunhar.",
      demo: `<div class="qn-stage">
        ${GRID(["2,2"], ["1,1", "1,2", "1,3", "2,1", "2,3", "3,1", "3,2", "3,3"])}
        <span class="qn-note anim fade" style="--d:.9s">as 8 casas em volta ficam proibidas</span>
      </div>`,
    },
    {
      title: "Conflitos ficam vermelhos",
      text: "Se duas rainhas se atacam, elas ficam em vermelho. No computador, botão direito ou Shift + clique marca X; no teclado, Espaço põe a rainha, X marca e Backspace limpa.",
      demo: `<div class="qn-stage">
        ${GRID(["1,1", "2,2"], [], ["1,1", "2,2"])}
        <span class="qn-note">estas duas se atacam na diagonal</span>
      </div>`,
    },
  ],
};
