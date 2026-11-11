import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { listPresetAvatars, AVATAR_FILE_RE, AVATAR_MANIFEST } from "../shared/avatar.js";

const dir = fileURLToPath(new URL("../assets/avatars/", import.meta.url));
const base = new URL("https://site.test/assets/avatars/");
const reply = (body, ok = true) => async () => ({ ok, json: async () => body });

test("avatares: só aceita nomes de imagem simples, sem subpastas nem \"..\"", () => {
  for (const ok of ["avatar_01.png", "gato-2.JPG", "a.webp", "x.y.gif", "Raposa.svg", "01.jpeg"]) assert.ok(AVATAR_FILE_RE.test(ok), ok);
  for (const bad of ["../x.png", "a/b.png", "a\\b.png", ".png", ".oculto.png", "a.txt", "a.png.exe", "avatars.json", "https://x/y.png", "com espaço.png", ""]) assert.ok(!AVATAR_FILE_RE.test(bad), bad);
});

test("avatares: a lista vem do manifesto, sem repetidos e ignorando nomes perigosos", async () => {
  const list = await listPresetAvatars(reply(["avatar_01.png", "../segredo.png", "avatar_01.png", 7, null, "http://x/y.png", "avatar_02.webp", "nota.txt"]), base);
  assert.deepEqual(list, [
    { name: "avatar_01.png", url: "https://site.test/assets/avatars/avatar_01.png" },
    { name: "avatar_02.webp", url: "https://site.test/assets/avatars/avatar_02.webp" },
  ]);
  assert.deepEqual(await listPresetAvatars(reply({ nao: "lista" }), base), []);
  assert.deepEqual(await listPresetAvatars(reply([]), base), []);
});

test("avatares: pede o avatars.json da pasta e falha com mensagem clara se ele não existir", async () => {
  let asked;
  await listPresetAvatars(async url => { asked = String(url); return { ok: true, json: async () => [] }; }, base);
  assert.equal(asked, "https://site.test/assets/avatars/avatars.json");
  await assert.rejects(listPresetAvatars(reply(null, false), base), /carregar os avatares/);
});

test("avatares: assets/avatars/avatars.json lista exatamente as imagens da pasta (rode `npm run avatars`)", () => {
  assert.ok(existsSync(dir + AVATAR_MANIFEST), "falta assets/avatars/avatars.json — rode `npm run avatars`");
  const listed = JSON.parse(readFileSync(dir + AVATAR_MANIFEST, "utf8"));
  const inFolder = readdirSync(dir).filter(f => AVATAR_FILE_RE.test(f));
  assert.deepEqual([...listed].sort(), [...inFolder].sort(), "o avatars.json está desatualizado — rode `npm run avatars`");
  for (const name of listed) assert.ok(existsSync(dir + name), `${name} está no avatars.json mas não existe`);
});
