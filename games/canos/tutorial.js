/* Passos do tutorial animado da Conexão de Canos. As demos usam as classes de animação de
   css/tutorial.css e os estilos de games/canos/tutorial.css. */

const TILES = [
  [94, 24], [138, 24], [182, 24],
  [94, 68], [138, 68], [182, 68],
  [94, 112], [138, 112], [182, 112],
].map(([x, y]) => `<rect class="cp-tile" x="${x}" y="${y}" width="44" height="44"/>`).join("");

const GRID = `<rect class="cp-board" x="94" y="24" width="132" height="132" rx="10"/>${TILES}`;

const PIPE = (d, extra = "") => `
  <path class="cp-pipe" d="${d}"/>
  <path class="cp-bore" d="${d}" ${extra}/>`;

export const CANOS_TUTORIAL = {
  title: "Como jogar · Conexão de Canos",
  steps: [
    {
      title: "Gire os canos até ligar",
      text: "Toque num quadrado para girar 90°. No computador, o botão direito ou Shift + clique gira para o outro lado. A contagem só começa no primeiro giro.",
      demo: `<svg viewBox="0 0 320 180" aria-hidden="true">
        <g class="anim fade">${GRID}</g>
        ${PIPE("M94 90H226")}
        <circle class="cp-in anim pop" style="--d:.2s" cx="88" cy="90" r="8"/>
        <circle class="cp-out anim pop" style="--d:.35s" cx="232" cy="90" r="8"/>
        <g class="cp-turn anim pop" style="--d:.55s">
          <circle cx="160" cy="90" r="17"/>
          <path d="M154 84a9 9 0 1 1-2 10"/>
          <polygon points="149,84 157,86 152,93"/>
        </g>
        <text class="cp-caption" x="160" y="171">clique para girar</text>
      </svg>`,
    },
    {
      title: "Leve a água a todas as saídas",
      text: "Ligue todas as entradas azuis a todas as saídas laranja. O T e a cruz espalham a água para todos os lados quando há mais de uma saída.",
      demo: `<svg viewBox="0 0 320 180" aria-hidden="true">
        <g class="anim fade">${GRID}</g>
        ${PIPE("M94 90H226")}
        ${PIPE("M160 90V156")}
        <path class="cp-flow anim draw" style="--d:.35s;animation-duration:1.1s" pathLength="1" d="M94 90H226"/>
        <path class="cp-flow anim draw" style="--d:.9s;animation-duration:.8s" pathLength="1" d="M160 90V156"/>
        <circle class="cp-in anim pop" style="--d:.2s" cx="88" cy="90" r="8"/>
        <circle class="cp-out anim pop" style="--d:.75s" cx="232" cy="90" r="8"/>
        <circle class="cp-out anim pop" style="--d:1.25s" cx="160" cy="162" r="8"/>
        <text class="cp-caption" x="160" y="14">a água se divide no T</text>
      </svg>`,
    },
    {
      title: "Ponta aberta vaza",
      text: "Cada ponta de cano sem ligação deixa a água vazar. Se isso acontecer, o jogo termina e você tenta o mesmo cenário de novo, sem gastar coin.",
      demo: `<svg viewBox="0 0 320 180" aria-hidden="true">
        <g class="anim fade">${GRID}</g>
        ${PIPE("M94 90H160V46")}
        <path class="cp-flow anim draw" style="--d:.35s" pathLength="1" d="M94 90H160V52"/>
        <circle class="cp-in anim pop" style="--d:.2s" cx="88" cy="90" r="8"/>
        <g class="cp-leak anim pop" style="--d:.95s">
          <circle class="cp-leak-ring" cx="160" cy="46" r="13"/>
          <circle class="cp-leak-dot" cx="160" cy="46" r="8"/>
          <path class="cp-x" d="M156 42l8 8M164 42l-8 8"/>
        </g>
        <text class="cp-caption" x="160" y="171">vazou: tente de novo</text>
      </svg>`,
    },
    {
      title: "Soltar água corre na hora",
      text: "Estude a grade à vontade. Quando terminar de girar, o botão “Soltar água” faz a água correr na hora e encerra a contagem.",
      demo: `<div class="cp-stage">
        <div class="cp-clock anim pop"><span>⏱</span><b>01:00</b></div>
        <div class="cp-bar"><i class="anim grow" style="--d:.4s"></i></div>
        <span class="cp-btn anim pop" style="--d:.7s">Soltar água</span>
        <span class="cp-note anim fade" style="--d:1s">a contagem só começa no primeiro giro</span>
      </div>`,
    },
  ],
};
