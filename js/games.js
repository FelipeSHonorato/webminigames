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
};
