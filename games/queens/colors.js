/* Cores das regiões do Queens — paleta fixa do jogo (12 cores).

   Como o tabuleiro tem até 14 regiões, a distribuição é feita por um "coloring" guloso sobre a vizinhança
   real das regiões: cada região recebe a cor MENOS usada no tabuleiro que ainda não esteja numa vizinha
   (e, entre as candidatas, a mais distante em CIELAB). Até 12 regiões, todas as cores são diferentes; no
   Genius (14) só duas se repetem, e nunca em regiões encostadas.

   `inkFor` escolhe a cor da coroa/X (branco ou azul-escuro) pelo contraste com a cor da casa — a paleta
   mistura tons muito claros e muito escuros, então uma cor fixa sumiria em parte do tabuleiro.

   Código puro (sem DOM): a UI aplica os valores e as miniaturas da landing usam as mesmas funções. */

export const PALETTE = [
  { name: "Vermelho escarlate", hex: "#ED2939" },
  { name: "Laranja abóbora", hex: "#FF7518" },
  { name: "Amarelo girassol", hex: "#FFC30B" },
  { name: "Verde grama", hex: "#4F7942" },
  { name: "Verde mar escuro", hex: "#3F888F" },
  { name: "Ciano pastel", hex: "#B5EAD7" },
  { name: "Azul cobalto", hex: "#0047AB" },
  { name: "Roxo ametista", hex: "#9966CC" },
  { name: "Magenta suave", hex: "#E1AFE9" },
  { name: "Rosa chiclete", hex: "#FF69B4" },
  { name: "Dourado queimado", hex: "#A67C00" },
  { name: "Azul água profunda", hex: "#0073CF" },
];

const DARK_INK = "#14213d";   // mesma tinta do tema claro (contraste alto nas casas claras)
const rgbOf = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
const linear = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** Luminância relativa (WCAG) de uma cor #rrggbb. */
export function luminance(hex) {
  const [r, g, b] = rgbOf(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Cor da coroa/X sobre `hex`: a que tiver maior contraste (WCAG) — branco ou azul-escuro. */
export function inkFor(hex) {
  const l = luminance(hex);
  const withWhite = 1.05 / (l + 0.05);
  const withDark = (l + 0.05) / (luminance(DARK_INK) + 0.05);
  return withWhite >= withDark ? "#ffffff" : DARK_INK;
}

const toRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const toHex = rgb => "#" + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Três tons da cor da região — topo mais claro, base e fundo mais escuro. É o relevo de cada casa:
    sem ele o tabuleiro fica "chapado", com manchas de cor sólida. O quanto clareia/escurece depende da
    própria cor: tom claro ganha sombra (senão "estoura" no branco) e tom escuro ganha brilho. */
export function regionShades(hex) {
  const c = toRgb(hex), l = luminance(hex);
  return {
    hi: toHex(mix(c, [255, 255, 255], 0.06 + 0.14 * (1 - l))),
    base: hex,
    lo: toHex(mix(c, [0, 0, 0], 0.06 + 0.14 * l)),
  };
}

/** #rrggbb → CIELAB, para medir a diferença como o olho vê. */
export function toLab(hex) {
  const [R, G, B] = rgbOf(hex).map(linear);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Vizinhança entre regiões (compartilham uma aresta), como um array de Set por região. */
export function adjacencyOf(regions, n) {
  const adj = Array.from({ length: n }, () => new Set());
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const i = r * n + c, g = regions[i];
      if (c + 1 < n && regions[i + 1] !== g) { adj[g].add(regions[i + 1]); adj[regions[i + 1]].add(g); }
      if (r + 1 < n && regions[i + n] !== g) { adj[g].add(regions[i + n]); adj[regions[i + n]].add(g); }
    }
  }
  return adj;
}

/** Cor de cada região (`#rrggbb`), uma entrada por região. */
export function assignColors(n, adjacency) {
  const labs = PALETTE.map(p => toLab(p.hex));
  const chosen = new Array(n).fill(-1);
  const uses = new Array(PALETTE.length).fill(0);

  /* Regiões com mais vizinhas primeiro: são as mais restritas e definem o resto. */
  const order = [...Array(n).keys()].sort((a, b) => adjacency[b].size - adjacency[a].size || a - b);
  for (const g of order) {
    const near = [...adjacency[g]].filter(v => chosen[v] >= 0);
    const taken = new Set(near.map(v => chosen[v]));

    /* Candidatas: cores que nenhuma vizinha usa. Entre elas, a MENOS usada no tabuleiro (espalha a
       variedade); no empate, a mais distante das vizinhas (CIELAB). */
    let pool = PALETTE.map((_, c) => c).filter(c => !taken.has(c));
    if (!pool.length) pool = PALETTE.map((_, c) => c);        // caso extremo: todas as cores cercadas
    const minUse = Math.min(...pool.map(c => uses[c]));
    const shortlist = pool.filter(c => uses[c] === minUse);

    let best = shortlist[0], bestScore = -1;
    for (const c of shortlist) {
      let score = Infinity;
      for (const v of near) {
        const d = distance(labs[c], labs[chosen[v]]);
        if (d < score) score = d;
      }
      if (!near.length) score = 1000 - c;                     // sem vizinha colorida: ordem estável
      if (score > bestScore) { bestScore = score; best = c; }
    }
    chosen[g] = best;
    uses[best]++;
  }

  /* Melhoria local: troca a cor de duas regiões quando isso aumenta a soma de log(1 + distância) dos
     pares vizinhos — um objetivo que penaliza forte qualquer par próximo. Corrige o caso de duas cores
     da mesma família (dois azuis, dois rosas…) acabarem encostadas. */
  const pairs = [];
  for (let g = 0; g < n; g++) for (const v of adjacency[g]) if (v > g) pairs.push([g, v]);
  const valid = () => {
    for (let g = 0; g < n; g++) for (const v of adjacency[g]) if (chosen[g] === chosen[v]) return false;
    return true;
  };
  const score = () => pairs.reduce((s, [a, b]) => s + Math.log1p(distance(labs[chosen[a]], labs[chosen[b]])), 0);
  for (let pass = 0; pass < 20; pass++) {
    let improved = false;
    for (let g = 0; g < n; g++) {
      for (let h = g + 1; h < n; h++) {
        if (chosen[g] === chosen[h]) continue;
        const before = score();
        [chosen[g], chosen[h]] = [chosen[h], chosen[g]];
        if (valid() && score() > before + 1e-9) improved = true;
        else [chosen[g], chosen[h]] = [chosen[h], chosen[g]];
      }
    }
    if (!improved) break;
  }

  return chosen.map(c => PALETTE[c].hex);
}
