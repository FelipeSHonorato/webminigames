/** Catálogo de jogos exibido no hub. Para adicionar um jogo: crie games/<nome>/ e registre aqui. */
export const GAMES = {
  zip: {
    title: "Zip", key: "zip.wins", path: "games/zip/",
    desc: "Trace um único caminho pelos números, em ordem, passando por todas as células.",
    preview: `<svg viewBox="0 0 160 100" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-opacity=".18" stroke-width="1.5"><path d="M40 10V90M80 10V90M120 10V90M0 25H160M0 50H160M0 75H160"/></g><path d="M20 12H100V37H60V62H140V87" fill="none" stroke="#19a79a" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/><circle cx="20" cy="12" r="9" fill="#14213d"/><text x="20" y="13" text-anchor="middle" dominant-baseline="central" font-size="10" font-weight="700" fill="#fff">1</text><circle cx="140" cy="87" r="9" fill="#14213d"/><text x="140" y="88" text-anchor="middle" dominant-baseline="central" font-size="10" font-weight="700" fill="#fff">4</text></svg>`,
  },
  patches: {
    title: "Patches", key: "patches.wins", path: "games/patches/",
    desc: "Divida a grade em retângulos: cada um com uma pista de área e formato.",
    preview: `<svg viewBox="0 0 160 100" aria-hidden="true"><rect x="6" y="6" width="68" height="46" rx="8" fill="#8e7cf0" opacity=".55"/><rect x="80" y="6" width="74" height="46" rx="8" fill="#2cc4b6" opacity=".55"/><rect x="6" y="58" width="40" height="36" rx="8" fill="#f2b134" opacity=".6"/><rect x="52" y="58" width="102" height="36" rx="8" fill="#4aa3df" opacity=".55"/><g font-size="15" font-weight="700" fill="#fff" text-anchor="middle" dominant-baseline="central"><text x="40" y="29">6</text><text x="117" y="29">6</text><text x="26" y="76">4</text><text x="103" y="76">6</text></g></svg>`,
  },
  sudoku: {
    title: "Sudoku", key: "sudoku.wins", path: "games/sudoku/",
    desc: "Preencha a grade 9×9 para que cada linha, coluna e bloco tenha de 1 a 9, sem repetir.",
    preview: `<svg viewBox="0 0 160 100" aria-hidden="true"><rect x="45" y="15" width="10" height="10" fill="#2cc4b6" opacity=".45"/><g fill="none" stroke="currentColor" stroke-opacity=".18" stroke-width="1"><path d="M45 5V95M55 5V95M75 5V95M85 5V95M105 5V95M115 5V95M35 15H125M35 25H125M35 45H125M35 55H125M35 75H125M35 85H125"/></g><g fill="none" stroke="currentColor" stroke-opacity=".55" stroke-width="2"><rect x="35" y="5" width="90" height="90" rx="2"/><path d="M65 5V95M95 5V95M35 35H125M35 65H125"/></g><g font-size="8" font-weight="700" fill="currentColor" text-anchor="middle" dominant-baseline="central"><text x="40" y="10.5">5</text><text x="60" y="10.5">3</text><text x="50" y="20.5">7</text><text x="40" y="30.5">9</text><text x="60" y="30.5">2</text><text x="50" y="40.5">6</text><text x="40" y="50.5">4</text><text x="60" y="50.5">1</text><text x="50" y="60.5">8</text><text x="40" y="70.5">1</text><text x="60" y="80.5">6</text><text x="50" y="90.5">3</text><text x="80" y="10.5">1</text></g></svg>`,
  },
};
