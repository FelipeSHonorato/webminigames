/* Passos do tutorial animado do Tango. As demos usam as classes de animação de
   css/tutorial.css e os estilos de games/tango/tutorial.css. */

const SUN = "☀";
const MOON = "☾";

const GRID = rows => `<div class="tg-grid">${rows.flatMap((row, r) =>
  [...row].map((v, c) => `<span class="tg-cell ${v === SUN ? "sun" : "moon"}">${v}</span>`)
).join("")}</div>`;

const ROW = (cells, extra = "") => `<div class="tg-row${extra ? ` ${extra}` : ""}">${cells.map(v =>
  `<span class="tg-cell ${v === SUN ? "sun" : "moon"}">${v}</span>`
).join("")}</div>`;

export const TANGO_TUTORIAL = {
  title: "Como jogar · Tango",
  steps: [
    {
      title: "Sol e lua, metade de cada",
      text: "Preencha a grade com sóis e luas. Cada linha e cada coluna precisa ter a mesma quantidade dos dois.",
      demo: `<div class="tg-stage">
        ${GRID([
          [SUN, SUN, MOON, MOON],
          [MOON, MOON, SUN, SUN],
          [SUN, MOON, SUN, MOON],
          [MOON, SUN, MOON, SUN],
        ])}
        <span class="tg-note anim fade" style="--d:.9s">2 sóis e 2 luas em cada linha e coluna</span>
      </div>`,
    },
    {
      title: "Nunca três iguais seguidos",
      text: "Três símbolos iguais em sequência não valem — nem na horizontal, nem na vertical.",
      demo: `<div class="tg-stage">
        <div class="tg-pair">
          ${ROW([SUN, SUN, SUN], "bad")}
          <span class="tg-caption bad"><b>×</b> não pode</span>
        </div>
        <div class="tg-pair">
          ${ROW([SUN, SUN, MOON], "ok")}
          <span class="tg-caption ok"><b>✓</b> pode</span>
        </div>
      </div>`,
    },
    {
      title: "Sinais = e ≠",
      text: "Os sinais entre as casas mandam o que fazer: = pede símbolos iguais e ≠ pede símbolos diferentes.",
      demo: `<div class="tg-stage">
        <div class="tg-signrow">
          <span class="tg-cell sun">${SUN}</span><span class="tg-sign">=</span>
          <span class="tg-cell sun">${SUN}</span><span class="tg-sign">≠</span>
          <span class="tg-cell moon">${MOON}</span>
        </div>
        <span class="tg-note">= iguais · ≠ diferentes</span>
      </div>`,
    },
    {
      title: "Toque para alternar",
      text: "Toque numa casa para alternar vazio → sol → lua → vazio. As casas mais escuras já vêm prontas e não mudam; conflitos ficam em vermelho.",
      demo: `<div class="tg-stage">
        <div class="tg-cycle">
          <span class="tg-cell empty">·</span><span class="tg-arrow">→</span>
          <span class="tg-cell sun">${SUN}</span><span class="tg-arrow">→</span>
          <span class="tg-cell moon">${MOON}</span>
        </div>
        <span class="tg-cell given sun tg-given-demo">${SUN}<i>fixo</i></span>
        <span class="tg-note">a casa escura não muda</span>
      </div>`,
    },
  ],
};
