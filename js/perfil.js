import { requireSession } from "../shared/session.js";
import { Profile, Activity } from "../shared/profile.js";
import { Scores } from "../shared/scores.js";
import { fileToAvatar, avatarNode } from "../shared/avatar.js";
import { regionName } from "../shared/regions.js";
import { GAMES } from "./games.js";
import { GameSwitch } from "../shared/game-switch.js";
import { isAdmin } from "../shared/roles.js";
import { Auth } from "./auth.js";
import { mountUserBar } from "./userbar.js";

const $ = id => document.getElementById(id);
const session = requireSession("index.html");
const PROVIDERS = { password: "Conta com e-mail e senha", "google-demo": "Google (simulação)", anonymous: "Anônimo" };
const say = (el, text, isError = false) => { el.textContent = text; el.classList.toggle("err", isError); };

function renderIdentity() {
  const p = Profile.get(session.id);
  $("avatarBox").replaceChildren(avatarNode(p.avatar));
  $("shownName").textContent = Profile.displayName(session);
  $("shownMeta").textContent = `${isAdmin(session) ? "Administrador" : PROVIDERS[session.provider]} · Região: ${regionName(session.region)}`;
  $("removePhoto").hidden = !p.avatar;
  $("nickname").value = p.nickname ?? "";
  mountUserBar($("userbar"));                    // a barra superior acompanha foto e apelido
}

function renderGames() {
  const activity = Activity.all(session.id), mine = Scores.mine(), list = $("myGames");
  list.replaceChildren();
  for (const [id, g] of Object.entries(GAMES)) {
    const li = document.createElement("li"), link = document.createElement("a");
    link.className = "t"; link.href = g.path; link.textContent = g.title + (GameSwitch.isOn(id) ? "" : " (desligado)");   // pontos continuam aqui mesmo com o jogo desligado
    const pts = document.createElement("span");
    pts.className = "pts"; pts.textContent = `${mine[id]?.points ?? 0} pts`;
    const meta = document.createElement("span"), last = activity[id]?.lastPlayedAt;
    meta.className = "meta";
    meta.textContent = last
      ? `Último jogo: ${new Date(last).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · ${mine[id]?.wins ?? 0} vitórias`
      : "Ainda não jogou";
    li.append(link, pts, meta);
    list.append(li);
  }
}

function init() {
  mountUserBar($("userbar"));
  if (session.provider === "anonymous") { $("guestNotice").hidden = false; return; }
  $("account").hidden = false;
  const hasPassword = session.provider === "password";
  $("pwForm").hidden = !hasPassword; $("pwInfo").hidden = hasPassword;
  renderIdentity(); renderGames();

  $("changePhoto").onclick = () => $("file").click();
  $("file").onchange = async e => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try { Profile.setAvatar(session.id, await fileToAvatar(file)); say($("photoMsg"), "Foto atualizada."); renderIdentity(); }
    catch (err) { say($("photoMsg"), err.message, true); }
  };
  $("removePhoto").onclick = () => { Profile.setAvatar(session.id, null); say($("photoMsg"), "Foto removida."); renderIdentity(); };

  $("nickForm").onsubmit = e => {
    e.preventDefault();
    try { const nick = Profile.setNickname(session.id, $("nickname").value); say($("nickMsg"), nick ? `Apelido salvo: ${nick}` : "Apelido removido."); renderIdentity(); }
    catch (err) { say($("nickMsg"), err.message, true); }
  };

  $("pwForm").onsubmit = async e => {
    e.preventDefault();
    const current = $("pwCurrent").value, next = $("pwNew").value, btn = $("pwSubmit");
    if (!current) return say($("pwMsg"), "Digite a senha atual.", true);
    if (next !== $("pwRepeat").value) return say($("pwMsg"), "As senhas novas não coincidem.", true);
    btn.disabled = true;
    try { await Auth.changePassword({ current, next }); $("pwForm").reset(); say($("pwMsg"), "Senha alterada com sucesso."); }
    catch (err) { say($("pwMsg"), err.message, true); }
    finally { btn.disabled = false; }
  };
}
if (session) { init(); $("profile-title").focus({ preventScroll: true }); }
