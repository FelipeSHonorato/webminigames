/* Passos do tutorial animado da Fuga das Setas. As demos usam as classes de animação de
   css/tutorial.css e os estilos de games/arrows/tutorial.css. */

const GRID = `
  <rect class="ar-board" x="80" y="26" width="160" height="128" rx="8"/>
  <path class="ar-lines" d="M112 26V154M144 26V154M176 26V154M208 26V154M80 58H240M80 90H240M80 122H240"/>`;

const RIGHT = (x, y, color = "#23b3a4") => `
  <g class="ar-piece anim pop" style="--c:${color}">
    <path d="M${x - 11} ${y}H${x + 4}"/>
    <polygon points="${x + 4},${y - 6} ${x + 16},${y} ${x + 4},${y + 6}"/>
  </g>`;

export const ARROWS_TUTORIAL = {
  title: "Como jogar · Fuga das Setas",
  steps: [
    {
      title: "Liberte as setas",
      text: "Clique numa seta quando o caminho à frente estiver livre. Ela escoa pelo próprio corpo e sai pela ponta.",
      demo: `<svg viewBox="0 0 320 180" aria-hidden="true">
        <g class="anim fade">${GRID}</g>
        <path class="ar-free anim draw" style="--d:.35s" pathLength="1" d="M108 90H232"/>
        ${RIGHT(96, 90)}
        <g class="ar-check anim pop" style="--d:1s"><circle cx="252" cy="90" r="12"/><path d="M246 90l4 4 8-9"/></g>
        <text class="ar-caption" x="160" y="170">caminho livre até a borda</text>
      </svg>`,
    },
    {
      title: "Desviadores mudam a direção",
      text: "Os blocos com uma seta dentro não são peças: a seta que entra neles continua na direção indicada, podendo atravessar vários em corrente.",
      demo: `<svg viewBox="0 0 320 180" aria-hidden="true">
        <g class="anim fade">${GRID}</g>
        <rect class="ar-redirect anim fade" style="--d:.2s" x="112" y="74" width="32" height="32" rx="6"/>
        <path class="ar-redir-arrow" d="M128 98V84M123 89l5-6 5 6"/>
        <path class="ar-flow anim draw" style="--d:.5s" pathLength="1" d="M86 90H128V154"/>
        <polygon class="ar-head anim fade" style="--d:1.15s" points="122,150 128,162 134,150"/>
        <text class="ar-caption" x="160" y="170">entra à esquerda e sai para baixo</text>
      </svg>`,
    },
    {
      title: "Cada saída gira os desviadores",
      text: "Quando uma seta sai do tabuleiro, todos os desviadores giram 90° no sentido horário. Planeje a ordem das saídas.",
      demo: `<div class="ar-rot">
        <div class="ar-tile anim pop" style="--d:.1s"><span>↑</span></div>
        <span class="ar-rot-arrow anim pop" style="--d:.45s">↻<small>90°</small></span>
        <div class="ar-tile anim pop" style="--d:.8s"><span>→</span></div>
        <span class="ar-rot-note anim fade" style="--d:1.1s">todos giram juntos</span>
      </div>`,
    },
    {
      title: "Três travadas e o tabuleiro volta",
      text: "Bater numa seta travada custa uma vida (♥). Ao perder as três, o tabuleiro recomeça — mas o cronômetro continua correndo.",
      demo: `<div class="ar-stage">
        <div class="ar-lives">
          <span class="ar-heart on">♥</span><span class="ar-heart on">♥</span><span class="ar-heart">♥</span>
        </div>
        <div class="ar-bump">
          <span class="ar-bump-arrow">→</span><span class="ar-bump-wall"></span><span class="ar-bump-x">×</span>
        </div>
        <span class="ar-rot-note anim fade" style="--d:.6s">caminho bloqueado = −1 vida</span>
      </div>`,
    },
  ],
};
