import { store, readJSON } from "../shared/storage.js";
import { REGIONS } from "../shared/regions.js";
import { ADMIN_ID, ADMIN_EMAIL } from "../shared/roles.js";
import { Cloud, authErrorMessage } from "../shared/backend/cloud.js";

/* ===================== AUTENTICAÇÃO =====================
   Dois modos, escolhidos por shared/backend/config.js:
   - Supabase configurado: contas reais no Supabase Auth (e-mail e senha, Google). As senhas nunca passam por aqui.
   - Vazio: contas locais de protótipo (só neste navegador, senha com PBKDF2).
   O anônimo é sempre local (nunca cria conta na nuvem). Os métodos assíncronos devem ser usados com `await`. */
const needClient = () => {
  if (!Cloud.client()) throw new Error("Sem conexão com o servidor. Verifique a internet e tente de novo.");
  return Cloud.client();
};
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

/* Conta administradora semeada automaticamente (nome, e-mail e senha definidos pelo dono do site).
   ATENÇÃO: como este protótipo roda só no navegador, a senha fica visível no código-fonte. Em produção,
   crie o administrador no servidor com uma senha própria e forte. */
const ADMIN_NAME = "administrador", ADMIN_PASSWORD = "administrador";
async function ensureAdmin() {
  const all = users();
  if (all[ADMIN_EMAIL]) return;
  const salt = randomHex(16);
  all[ADMIN_EMAIL] = { id: ADMIN_ID, name: ADMIN_NAME, region: null, role: "admin", salt, hash: await hashPassword(ADMIN_PASSWORD, salt) };
  store.set("wmg.users", JSON.stringify(all));
}

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
    if (Cloud.active) {
      const { data, error } = await needClient().auth.signUp({ email: email.trim(), password, options: { data: { name: name.trim(), region } } });
      if (error) throw new Error(authErrorMessage(error));
      if (data.user && data.user.identities?.length === 0) throw new Error(authErrorMessage({ code: "user_already_exists" }));   // e-mail já cadastrado (o Supabase não avisa de outro jeito)
      if (!data.session) return { needsConfirmation: true, email: email.trim() };                                            // o projeto exige confirmar o e-mail antes do primeiro acesso
      return Cloud.adopt(data.user);
    }
    await ensureAdmin();                                  // garante que ninguém registre o e-mail do administrador
    const all = users(), key = email.trim().toLowerCase();
    if (all[key]) throw new Error("Já existe uma conta com este e-mail. Use a aba Entrar.");
    const salt = randomHex(16), id = "u-" + randomHex(8);
    all[key] = { id, name: name.trim(), region, salt, hash: await hashPassword(password, salt) };
    store.set("wmg.users", JSON.stringify(all));
    return this.start({ id, name: name.trim(), provider: "password", region });
  },
  async login({ email, password }) {
    this.validate({ email, password });
    if (Cloud.active) {
      const { data, error } = await needClient().auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw new Error(authErrorMessage(error));
      return Cloud.adopt(data.user);
    }
    await ensureAdmin();
    const u = users()[email.trim().toLowerCase()];
    if (!u || u.hash !== (await hashPassword(password, u.salt))) throw new Error("E-mail ou senha incorretos.");
    return this.start({ id: u.id, name: u.name, provider: "password", region: u.region ?? null, role: u.role ?? "user" });
  },
  /** Troca a senha exigindo a atual. Só contas com e-mail e senha. */
  async changePassword({ current, next }) {
    const s = this.current();
    if (s?.provider !== "password") throw new Error("Esta conta não usa senha.");
    if (next.length < 6) throw new Error("A nova senha precisa ter pelo menos 6 caracteres.");
    if (Cloud.active) {
      const sb = needClient();
      if (!s.email) throw new Error("Entre de novo para trocar a senha.");
      if (next === current) throw new Error("A nova senha deve ser diferente da atual.");
      const check = await sb.auth.signInWithPassword({ email: s.email, password: current });          // confirma a senha atual
      if (check.error) throw new Error(check.error.code === "invalid_credentials" ? "A senha atual está incorreta." : authErrorMessage(check.error));
      const { error } = await sb.auth.updateUser({ password: next });
      if (error) throw new Error(authErrorMessage(error));
      return;
    }
    const all = users(), u = Object.values(all).find(x => x.id === s.id);
    if (!u || u.hash !== (await hashPassword(current, u.salt))) throw new Error("A senha atual está incorreta.");
    if (next === current) throw new Error("A nova senha deve ser diferente da atual.");
    u.salt = randomHex(16);
    u.hash = await hashPassword(next, u.salt);
    store.set("wmg.users", JSON.stringify(all));
  },
  /** Com Supabase: abre o login do Google e a página recarrega ao voltar (devolve null). Sem Supabase: SIMULAÇÃO, não fala com o Google. */
  async loginWithGoogle() {
    if (Cloud.active) {
      const { error } = await needClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo: new URL("index.html", location.href).href } });
      if (error) throw new Error(authErrorMessage(error));
      return null;
    }
    return this.start({ id: "g-demo", name: "Jogador Google", provider: "google-demo", region: null });
  },
  async loginAnonymous() {
    if (Cloud.active) await Cloud.dropSession();     // se havia uma conta da nuvem neste navegador, ela sai: o anônimo é local
    let id = store.get("wmg.anonId");
    if (!id) { id = "a-" + randomHex(8); store.set("wmg.anonId", id); }
    return this.start({ id, name: "Anônimo", provider: "anonymous" });
  },
  async logout() {
    if (Cloud.active && Cloud.uid) await Cloud.signOut();    // envia o que faltar e encerra a sessão no Supabase
    else store.set("wmg.session", "null");
  },
};
