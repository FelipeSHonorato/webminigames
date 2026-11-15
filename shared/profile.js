import { readJSON, store } from "./storage.js";
import { Cloud } from "./backend/cloud.js";
import { REGIONS } from "./regions.js";

const PROFILES = "wmg.profiles";   // { [userId]: { nickname?, avatar? } }
const ACTIVITY = "wmg.activity";   // { [userId]: { [gameId]: { lastPlayedAt, plays } } }
const NICK_RE = /^[\p{L}\p{N}_. -]{3,20}$/u;

/** Resume a atividade do jogador para a ficha: jogo favorito (mais partidas) e último jogo jogado.
    Tudo puro, a partir de `{ [gameId]: { plays, lastPlayedAt } }`. */
export function summarizeActivity(activity = {}) {
  const rows = Object.entries(activity ?? {})
    .map(([game, a]) => ({ game, plays: Number(a?.plays) || 0, at: Number(a?.lastPlayedAt) || 0 }))
    .filter(r => r.at > 0);
  const favorite = rows.filter(r => r.plays > 0)
    .sort((a, b) => b.plays - a.plays || b.at - a.at || a.game.localeCompare(b.game))[0] ?? null;
  const last = rows.sort((a, b) => b.at - a.at || a.game.localeCompare(b.game))[0] ?? null;
  return {
    favorite: favorite ? { game: favorite.game, plays: favorite.plays } : null,
    last: last ? { game: last.game, at: last.at } : null,
  };
}

export const Profile = {
  get: uid => (Cloud.owns(uid) ? Cloud.profile() : readJSON(PROFILES, {})[uid] ?? {}),
  /** Apelido (se houver) ou o nome do cadastro. É o nome exibido no ranking e na barra. */
  displayName(session) {
    if (session.provider === "anonymous") return "Anônimo";          // vale também para sessões antigas ("Visitante")
    return this.get(session.id).nickname || session.name;
  },

  /** Ficha pública exibida ao clicar num nome do ranking. Na nuvem vem do servidor (`player_card`);
      no modo local, do cadastro (`wmg.users`), do perfil e da atividade guardados neste navegador.
      `fallback` são os dados que o ranking já tinha (nome, foto e região), usados se algo faltar. */
  async card(uid, fallback = {}) {
    if (Cloud.active) {
      const data = await Cloud.playerCard(uid);
      if (data) return data;
    }
    const profiles = readJSON(PROFILES, {}), users = readJSON("wmg.users", {});
    const profile = profiles[uid] ?? {};
    const account = Object.values(users).find(u => u.id === uid) ?? null;
    const { favorite, last } = summarizeActivity(readJSON(ACTIVITY, {})[uid] ?? {});
    return {
      id: uid,
      name: profile.nickname || account?.name || fallback.name || "Jogador",
      avatar: profile.avatar ?? fallback.avatar ?? null,
      region: account?.region ?? fallback.region ?? null,
      createdAt: account?.createdAt ?? fallback.createdAt ?? null,
      favorite, last,
    };
  },

  /** Define o apelido; texto vazio remove. Único (sem diferenciar maiúsculas). Na nuvem devolve uma Promise (use `await`): quem garante a unicidade é o banco. */
  setNickname(uid, raw) {
    const nick = raw.trim().replace(/\s+/g, " "), all = readJSON(PROFILES, {});
    if (nick && !NICK_RE.test(nick)) throw new Error("O apelido deve ter de 3 a 20 caracteres: letras, números, espaço, _ . ou -");
    if (Cloud.owns(uid)) return Cloud.setProfile({ nickname: nick || null }).then(() => nick);
    if (nick) {
      if (Object.entries(all).some(([id, p]) => id !== uid && p.nickname?.toLowerCase() === nick.toLowerCase())) throw new Error("Esse apelido já está em uso.");
    }
    all[uid] = { ...all[uid] };
    if (nick) all[uid].nickname = nick; else delete all[uid].nickname;
    store.set(PROFILES, JSON.stringify(all));
    return nick;
  },
  setAvatar(uid, dataUrl) {
    if (Cloud.owns(uid)) return Cloud.setProfile({ avatar: dataUrl || null });
    const all = readJSON(PROFILES, {});
    all[uid] = { ...all[uid] };
    if (dataUrl) all[uid].avatar = dataUrl; else delete all[uid].avatar;
    store.set(PROFILES, JSON.stringify(all));
  },

  /** Define a região (ranking "Minha região"). Serve para qualquer conta — inclusive as criadas no Google, que entram sem região. Na nuvem devolve uma Promise (use `await`). */
  setRegion(uid, region) {
    if (!REGIONS.some(r => r.id === region)) throw new Error("Selecione sua região.");
    if (Cloud.owns(uid)) return Cloud.setProfile({ region }).then(() => region);
    const mirror = readJSON("wmg.session", null);
    if (mirror?.id === uid) store.set("wmg.session", JSON.stringify({ ...mirror, region }));
    const users = readJSON("wmg.users", {});
    const account = Object.values(users).find(u => u.id === uid);
    if (account) { account.region = region; store.set("wmg.users", JSON.stringify(users)); }
    const scores = readJSON("wmg.scores", {});
    if (scores[uid]) { scores[uid].region = region; store.set("wmg.scores", JSON.stringify(scores)); }
    return region;
  },
};

export const Activity = {
  /** Registra que o usuário começou a jogar uma fase agora. */
  played(uid, gameId) {
    if (Cloud.owns(uid)) return Cloud.recordPlay(gameId);
    const all = readJSON(ACTIVITY, {}), mine = (all[uid] ??= {});
    const g = (mine[gameId] ??= { lastPlayedAt: 0, plays: 0 });
    g.lastPlayedAt = Date.now(); g.plays += 1;
    store.set(ACTIVITY, JSON.stringify(all));
  },
  all: uid => (Cloud.owns(uid) ? Cloud.activity() : readJSON(ACTIVITY, {})[uid] ?? {}),
};
