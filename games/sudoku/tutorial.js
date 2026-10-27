/* Passos do tutorial animado do Sudoku. As demos usam as classes de animação de
   css/tutorial.css e os estilos de games/sudoku/tutorial.css. */

const PUZZLE = [
  "53..7....",
  "6..195...",
  ".98....6.",
  "8...6...3",
  "4..8.3..1",
  "7...2...6",
  ".6....28.",
  "...419..5",
  "....8..79",
];

const GRID = ({ row, col, block, sel, user = {}, bad = [] } = {}) => {
  const b = new Set(bad);
  const blockOn = block != null
    ? (r, c) => Math.floor(r / 3) === block[0] && Math.floor(c / 3) === block[1]
    : () => false;
  return `<div class="sd-grid">${PUZZLE.flatMap((line, r) => [...line].map((ch, c) => {
    const key = `${r},${c}`;
    const cls = ["sd-cell", `r${r}`, `c${c}`];
    if (ch !== ".") cls.push("given");
    if (user[key] != null) cls.push("user");
    if (sel === key) cls.push("sel");
    if (row === r || col === c) cls.push("hl");
    if (blockOn(r, c)) cls.push("blk");
    if (b.has(key)) cls.push("bad");
    return `<span class="${cls.join(" ")}">${user[key] ?? (ch === "." ? "" : ch)}</span>`;
  })).join("")}</div>`;
};

export const SUDOKU_TUTORIAL = {
  title: "Como jogar · Sudoku",
  steps: [
    {
      title: "1 a 9 sem repetir",
      text: "Cada linha, cada coluna e cada bloco 3×3 precisa ter os números de 1 a 9, sem repetir nenhum.",
      demo: `<div class="sd-stage">
        ${GRID({ row: 4, col: 4, block: [1, 1] })}
        <span class="sd-note anim fade" style="--d:.9s">linha · coluna · bloco 3×3</span>
      </div>`,
    },
    {
      title: "Escolha o número",
      text: "Toque numa célula e escolha um número no teclado. Repetidos ficam em vermelho; se precisar, use “Apagar”.",
      demo: `<div class="sd-stage">
        ${GRID({ sel: "4,4", user: { "4,4": "5" } })}
        <div class="sd-pad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n =>
            `<span class="sd-key${n === 5 ? " on" : ""}">${n}</span>`
          ).join("")}
        </div>
      </div>`,
    },
    {
      title: "Anote os candidatos",
      text: "Com “Anotações” ligado, os números viram rascunhos dentro da célula. Use para testar possibilidades sem preencher de vez.",
      demo: `<div class="sd-notesstage">
        <div class="sd-bigcell">
          <div class="sd-notes">
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n =>
              `<span class="${n === 1 || n === 3 || n === 7 ? "on" : ""}">${n}</span>`
            ).join("")}
          </div>
        </div>
        <span class="sd-toggle anim pop" style="--d:.4s">Anotações</span>
        <span class="sd-note anim fade" style="--d:.8s">1, 3 e 7 são candidatos</span>
      </div>`,
    },
    {
      title: "Repetidos ficam vermelhos",
      text: "Se o mesmo número aparecer duas vezes na linha, na coluna ou no bloco, as células ficam em vermelho para você corrigir.",
      demo: `<div class="sd-stage">
        ${GRID({ user: { "0,2": "5" }, bad: ["0,0", "0,2"] })}
        <span class="sd-note">o 5 não pode repetir na linha</span>
      </div>`,
    },
  ],
};
