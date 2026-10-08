import { store, readJSON } from "../shared/storage.js";
import { REGIONS } from "../shared/regions.js";

/* ===================== AUTENTICAÇÃO (local, só protótipo) =====================
   Esta interface é o ponto de troca: para um backend real (Firebase Auth, Supabase, Auth0…),
   basta reimplementar estes métodos mantendo as mesmas assinaturas. */
const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const randomHex = n => toHex(crypto.getRandomValues(new Uint8Array(n)));
async function hashPassword(password, saltHex) {
  if (!crypto?.subtle) throw new Error("Este navegador não suporta criação segura de conta.");
  const salt = Uint8Array.from(saltHex.match(/../g), h => parseInt(h, 16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return toHex(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256));
}
const users = () => readJSON("wmg.users", {});
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const Auth = {
  current: () => readJSON("wmg.session", null),
  start(user) { store.set("wmg.session", JSON.stringify(user)); return user; },
  validate({ email, password }) {
    if (!EMAIL_RE.test(email)) throw new Error("Digite um e-mail válido.");
    if (password.length < 6) throw new Error("A senha precisa ter pelo menos 6 caracteres.");
  },
  async register({ name, email, password, region }) {
    if (!name.trim()) throw new Error("Digite seu nome.");
    if (!REGIONS.some(r => r.id === region)) throw new Error("Selecione sua região.");
    this.validate({ email, password });
    const all = users(), key = email.trim().toLowerCase();
    if (all[key]) throw new Error("Já existe uma conta com este e-mail. Use a aba Entrar.");
    const salt = randomHex(16), id = "u-" + randomHex(8);
    all[key] = { id, name: name.trim(), region, salt, hash: await hashPassword(password, salt) };
    store.set("wmg.users", JSON.stringify(all));
    return this.start({ id, name: name.trim(), provider: "password", region });
  },
  async login({ email, password }) {
    this.validate({ email, password });
    const u = users()[email.trim().toLowerCase()];
    if (!u || u.hash !== (await hashPassword(password, u.salt))) throw new Error("E-mail ou senha incorretos.");
    return this.start({ id: u.id, name: u.name, provider: "password", region: u.region ?? null });
  },
  loginWithGoogle() {                                  // SIMULAÇÃO: não fala com o Google
    return this.start({ id: "g-demo", name: "Jogador Google", provider: "google-demo", region: null });
  },
  loginAnonymous() {
    let id = store.get("wmg.anonId");
    if (!id) { id = "a-" + randomHex(8); store.set("wmg.anonId", id); }
    return this.start({ id, name: "Visitante", provider: "anonymous" });
  },
  logout() { store.set("wmg.session", "null"); },
};
