/** Converte a imagem escolhida em um avatar quadrado 192x192 (JPEG) pronto para guardar. */
export const AVATAR_SIZE = 192;
const TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_BYTES = 5 * 1024 * 1024;

/** Desenha a imagem (recortada ao centro, quadrada) em 192x192 e devolve o JPEG como data URL. */
function drawAvatar(source, width, height) {
  const side = Math.min(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);          // PNG transparente não vira fundo preto
  ctx.drawImage(source, (width - side) / 2, (height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  return canvas.toDataURL("image/jpeg", 0.85);
}

export async function fileToAvatar(file) {
  if (!TYPES.includes(file.type)) throw new Error("Use uma imagem PNG, JPG, WEBP ou GIF.");
  if (file.size > MAX_BYTES) throw new Error("A imagem deve ter no máximo 5 MB.");
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error("Não foi possível ler essa imagem."); }
  const dataUrl = drawAvatar(bitmap, bitmap.width, bitmap.height);
  bitmap.close?.();
  return dataUrl;
}

/* ---------- Avatares prontos (pasta assets/avatars) ----------
   O site é estático (GitHub Pages não lista pastas), então `assets/avatars/avatars.json` guarda os nomes dos arquivos.
   Ele é gerado por `npm run avatars` (scripts/gen-avatars.mjs): basta soltar as imagens na pasta e rodar o comando. */
export const AVATARS_DIR = new URL("../assets/avatars/", import.meta.url);
export const AVATAR_MANIFEST = "avatars.json";
/** Nome de arquivo aceito na pasta: sem subpastas nem "..", só extensões de imagem. */
export const AVATAR_FILE_RE = /^[\w][\w.-]*\.(png|jpe?g|webp|gif|svg)$/i;

/** Lê o manifesto e devolve [{ name, url }] só com nomes válidos e sem repetição. */
export async function listPresetAvatars(fetcher = fetch, base = AVATARS_DIR) {
  const res = await fetcher(new URL(AVATAR_MANIFEST, base));
  if (!res.ok) throw new Error("Não foi possível carregar os avatares.");
  const names = await res.json();
  if (!Array.isArray(names)) return [];
  return [...new Set(names)]
    .filter(n => typeof n === "string" && AVATAR_FILE_RE.test(n))
    .map(name => ({ name, url: new URL(name, base).href }));
}

/** Converte um avatar da pasta no mesmo formato da foto enviada (192x192, data URL), então ranking, duelos e banco não mudam. */
export async function presetToAvatar(url) {
  const img = new Image();
  img.decoding = "async";
  const loaded = new Promise((ok, fail) => { img.onload = ok; img.onerror = () => fail(new Error("Não foi possível ler esse avatar.")); });
  img.src = url;
  await loaded;
  return drawAvatar(img, img.naturalWidth || AVATAR_SIZE, img.naturalHeight || AVATAR_SIZE);
}

const DEFAULT_AVATAR = `<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="15" r="7" fill="currentColor"/><path d="M6 36c1-8 7-12 14-12s13 4 14 12z" fill="currentColor"/></svg>`;

/** Foto do usuário ou, sem foto, o avatar padrão (silhueta). */
export function avatarNode(dataUrl) {
  if (typeof dataUrl === "string" && dataUrl.startsWith("data:image/")) {
    const img = new Image();
    img.className = "avatar"; img.alt = ""; img.src = dataUrl;
    return img;
  }
  const span = document.createElement("span");
  span.className = "avatar"; span.innerHTML = DEFAULT_AVATAR;
  return span;
}
