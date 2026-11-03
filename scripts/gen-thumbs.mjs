/* Gera as miniaturas assets/thumbs/<id>-light.webp e <id>-dark.webp (360×360) a partir do `preview` SVG de
   js/games.js. Use para jogos de tabuleiro SEM captura de tela (Xadrez, Dama e os próximos duelos).

   Uso (o `sharp` não é dependência do projeto, instale só para rodar):
     npm i --no-save sharp
     node scripts/gen-thumbs.mjs chess dama

   Requisitos do `preview`: viewBox QUADRADO (160×160), moldura `<rect width="160" height="160" rx="10" fill="#141c26"/>`
   como primeiro elemento e nenhum `url(#id)`/<defs> (referência dentro de SVG escondido falha em alguns navegadores).
   A versão clara troca só a cor da moldura; o tabuleiro fica igual nos dois temas. */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { GAMES } from "../js/games.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FRAME = '<rect width="160" height="160" rx="10" fill="#141c26"/>';
const THEMES = { light: "#e3e9f0", dark: "#141c26" };
const SIZE = 360;

const ids = process.argv.slice(2);
if (!ids.length) { console.error("Informe os ids dos jogos. Ex.: node scripts/gen-thumbs.mjs chess dama"); process.exit(1); }

for (const id of ids) {
  const preview = GAMES[id]?.preview;
  if (!preview) { console.error(`Jogo "${id}" sem preview em js/games.js`); process.exit(1); }
  if (!/viewBox="0 0 160 160"/.test(preview)) { console.error(`${id}: o preview precisa ter viewBox="0 0 160 160"`); process.exit(1); }
  if (!preview.includes(FRAME)) { console.error(`${id}: o preview precisa começar com a moldura padrão (${FRAME})`); process.exit(1); }
  if (/url\(#|<defs/.test(preview)) { console.error(`${id}: não use <defs>/url(#…) no preview`); process.exit(1); }
  for (const [theme, color] of Object.entries(THEMES)) {
    const svg = preview
      .replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ')
      .replace(FRAME, `<rect width="160" height="160" fill="${color}"/>`);   // a miniatura é recortada pelo CSS (.thumb)
    const file = join(root, "assets/thumbs", `${id}-${theme}.webp`);
    const buf = await sharp(Buffer.from(svg), { density: 300 }).resize(SIZE, SIZE).webp({ quality: 88 }).toBuffer();
    writeFileSync(file, buf);
    console.log(`${id}-${theme}.webp  ${(buf.length / 1024).toFixed(1)} KB`);
  }
}
