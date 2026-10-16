import { readJSON, store } from "./storage.js";
import { Cloud } from "./backend/cloud.js";

const PROFILES = "wmg.profiles";   // { [userId]: { nickname?, avatar? } }
const ACTIVITY = "wmg.activity";   // { [userId]: { [gameId]: { lastPlayedAt, plays } } }
const NICK_RE = /^[\p{L}\p{N}_. -]{3,20}$/u;

export const Profile = {
  get: uid => (Cloud.owns(uid) ? Cloud.profile() : readJSON(PROFILES, {})[uid] ?? {}),
  /** Apelido (se houver) ou o nome do cadastro. É o nome exibido no ranking e na barra. */
  displayName(session) {
    if (session.provider === "anonymous") return "Anônimo";          // vale também para sessões antigas ("Visitante")
    return this.get(session.id).nickname || session.name;
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
