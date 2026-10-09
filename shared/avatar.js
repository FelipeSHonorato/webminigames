/** Converte a imagem escolhida em um avatar quadrado 192x192 (JPEG) pronto para guardar. */
export const AVATAR_SIZE = 192;
const TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_BYTES = 5 * 1024 * 1024;

export async function fileToAvatar(file) {
  if (!TYPES.includes(file.type)) throw new Error("Use uma imagem PNG, JPG, WEBP ou GIF.");
  if (file.size > MAX_BYTES) throw new Error("A imagem deve ter no máximo 5 MB.");
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error("Não foi possível ler essa imagem."); }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);          // PNG transparente não vira fundo preto
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", 0.85);
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
