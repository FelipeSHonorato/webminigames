/* Gera assets/avatars/avatars.json, a lista dos avatares que aparecem em "Usar avatar" (Meu perfil).
   O site é estático e o navegador não consegue listar uma pasta, então esta lista precisa existir como arquivo.

   Como adicionar avatares:
     1. solte as imagens (PNG, JPG, WEBP, GIF ou SVG, de preferência quadradas) em assets/avatars/
     2. rode:  npm run avatars      (o `npm start` e o `npm test` já rodam isso sozinhos)
     3. faça commit das imagens e do avatars.json (o deploy no GitHub Pages também regenera a lista)

   A ordem é a dos nomes, com números em ordem natural (avatar_2 antes de avatar_10). */
import { readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AVATAR_FILE_RE, AVATAR_MANIFEST } from "../shared/avatar.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "avatars");
mkdirSync(dir, { recursive: true });

const files = readdirSync(dir).filter(f => AVATAR_FILE_RE.test(f)).sort(new Intl.Collator("pt-BR", { numeric: true }).compare);
const ignored = readdirSync(dir).filter(f => f !== AVATAR_MANIFEST && !AVATAR_FILE_RE.test(f) && !/\.md$/i.test(f));

writeFileSync(join(dir, AVATAR_MANIFEST), JSON.stringify(files, null, 2) + "\n");
console.log(`avatars.json: ${files.length} avatar(es)${files.length ? " — " + files.join(", ") : ""}`);
if (ignored.length) console.warn(`Ignorados (nome ou formato inválido; use letras, números, _ . - e PNG/JPG/WEBP/GIF/SVG): ${ignored.join(", ")}`);
