import "../shared/backend/boot.js";
import { mountPasswordRules } from "./password-rules.js";
import { requireSession } from "../shared/session.js";
import { Profile, Activity } from "../shared/profile.js";
import { Scores } from "../shared/scores.js";
import { fileToAvatar, avatarNode, listPresetAvatars, presetToAvatar } from "../shared/avatar.js";
import { REGIONS, regionName } from "../shared/regions.js";
import { GAMES } from "./games.js";
import { GameSwitch } from "../shared/game-switch.js";
import { isAdmin } from "../shared/roles.js";
import { Auth } from "./auth.js";
import { mountUserBar } from "./userbar.js";
import { attachPasswordToggles } from "../shared/password-toggle.js";

const $ = id => document.getElementById(id);
const session = requireSession("index.html");
const PROVIDERS = { password: "Conta com e-mail e senha", "google-demo": "Google (simulação)", google: "Conta Google", anonymous: "Anônimo" };
const say = (el, text, isError = false) => { el.textContent = text; el.classList.toggle("err", isError); };

function renderIdentity() {
  const p = Profile.get(session.id);
  $("avatarBox").replaceChildren(avatarNode(p.avatar));
  $("shownName").textContent = Profile.displayName(session);
  $("shownMeta").textContent = `${isAdmin(session) ? "Administrador" : PROVIDERS[session.provider]} · Região: ${regionName(session.region)}`;
  $("removePhoto").hidden = !p.avatar;
  $("nickname").value = p.nickname ?? "";
  $("region").value = session.region ?? "";
  mountUserBar($("userbar"));                    // a barra superior acompanha foto e apelido
}

/* Avatares prontos (pasta assets/avatars): a lista é lida uma vez e o popup só monta os botões. */
let presets = null;
async function openAvatarPicker() {
  const dialog = $("avatarDialog"), grid = $("avatarGrid");
  say($("avatarMsg"), "");
  dialog.showModal();
  if (!presets) {
    grid.setAttribute("aria-busy", "true");
    say($("avatarMsg"), "Carregando avatares…");
    try { presets = await listPresetAvatars(); say($("avatarMsg"), ""); }
    catch (err) { say($("avatarMsg"), err.message, true); grid.setAttribute("aria-busy", "false"); return; }
    grid.replaceChildren(...presets.map((a, i) => {
      const btn = document.createElement("button"), img = new Image();
      btn.type = "button"; btn.className = "avatar-opt"; btn.dataset.url = a.url;
      btn.setAttribute("aria-label", `Usar o avatar ${i + 1}`);
      img.src = a.url; img.alt = ""; img.loading = "lazy"; img.decoding = "async";
      btn.append(img);
      return btn;
    }));
    if (!presets.length) say($("avatarMsg"), "Ainda não há avatares disponíveis.");
  }
  grid.setAttribute("aria-busy", "false");
  grid.querySelector(".avatar-opt")?.focus();
}
async function chooseAvatar(btn) {
  const grid = $("avatarGrid");
  grid.querySelectorAll(".avatar-opt").forEach(b => { b.disabled = true; });
  say($("avatarMsg"), "Salvando…");
  try {
    await Profile.setAvatar(session.id, await presetToAvatar(btn.dataset.url));
    $("avatarDialog").close();
    say($("photoMsg"), "Avatar atualizado."); renderIdentity();
  } catch (err) { say($("avatarMsg"), err.message, true); }
  finally { grid.querySelectorAll(".avatar-opt").forEach(b => { b.disabled = false; }); }
}

function renderGames() {
  const activity = Activity.all(session.id), mine = Scores.mine(), list = $("myGames");
  list.replaceChildren();
  for (const [id, g] of Object.entries(GAMES)) {
    const li = document.createElement("li"), link = document.createElement("a");
    link.className = "t"; link.href = g.path; link.textContent = g.title + (GameSwitch.isOn(id) ? "" : " (desligado)");   // pontos continuam aqui mesmo com o jogo desligado
    const pts = document.createElement("span");
    pts.className = "pts"; pts.textContent = g.key ? `${mine[id]?.points ?? 0} pts` : "1×1";
    const meta = document.createElement("span"), last = activity[id]?.lastPlayedAt;
    meta.className = "meta";
    meta.textContent = !g.key
      ? "Duelo por código, sem pontos nem níveis"
      : last
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
  $("region").append(new Option("Selecione…", ""), ...REGIONS.map(r => new Option(r.name, r.id)));
  renderIdentity(); renderGames();

  $("changePhoto").onclick = () => $("file").click();
  $("file").onchange = async e => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try { await Profile.setAvatar(session.id, await fileToAvatar(file)); say($("photoMsg"), "Foto atualizada."); renderIdentity(); }
    catch (err) { say($("photoMsg"), err.message, true); }
  };
  $("useAvatar").onclick = openAvatarPicker;
  $("avatarGrid").onclick = e => { const btn = e.target.closest(".avatar-opt"); if (btn && !btn.disabled) chooseAvatar(btn); };
  $("removePhoto").onclick = async () => {
    try { await Profile.setAvatar(session.id, null); say($("photoMsg"), "Foto removida."); renderIdentity(); }
    catch (err) { say($("photoMsg"), err.message, true); }
  };

  $("nickForm").onsubmit = async e => {
    e.preventDefault();
    try { const nick = await Profile.setNickname(session.id, $("nickname").value); say($("nickMsg"), nick ? `Apelido salvo: ${nick}` : "Apelido removido."); renderIdentity(); }
    catch (err) { say($("nickMsg"), err.message, true); }
  };

  $("regionForm").onsubmit = async e => {
    e.preventDefault();
    try { session.region = await Profile.setRegion(session.id, $("region").value); say($("regionMsg"), "Região atualizada."); renderIdentity(); }
    catch (err) { say($("regionMsg"), err.message, true); }
  };

  const updateRules = mountPasswordRules($("pwNew"), $("pwRules"));
  $("pwForm").onsubmit = async e => {
    e.preventDefault();
    const current = $("pwCurrent").value, next = $("pwNew").value, btn = $("pwSubmit");
    if (!current) return say($("pwMsg"), "Digite a senha atual.", true);
    if (next !== $("pwRepeat").value) return say($("pwMsg"), "As senhas novas não coincidem.", true);
    btn.disabled = true;
    try { await Auth.changePassword({ current, next }); $("pwForm").reset(); updateRules(); say($("pwMsg"), "Senha alterada com sucesso."); }
    catch (err) { say($("pwMsg"), err.message, true); }
    finally { btn.disabled = false; }
  };

  /* Excluir conta (LGPD): o popup pede a senha atual e apaga a conta e todos os dados dela. Contas sem
     senha (Google) confirmam só no popup: a sessão já autentica. */
  $("deleteAccount").onclick = () => {
    $("deleteForm").reset(); say($("deleteMsg"), "");
    $("deletePwField").hidden = !hasPassword;
    $("deleteDialog").showModal();
  };
  $("deleteCancel").onclick = () => $("deleteDialog").close();
  $("deleteForm").onsubmit = async e => {
    e.preventDefault();
    const btn = $("deleteConfirm"); btn.disabled = true; say($("deleteMsg"), "");
    try {
      await Auth.deleteAccount({ password: hasPassword ? $("deletePassword").value : undefined });
      $("deleteDialog").close();
      location.replace("index.html");
    } catch (err) { say($("deleteMsg"), err.message, true); btn.disabled = false; }
  };
}
attachPasswordToggles();
if (session) { init(); $("profile-title").focus({ preventScroll: true }); }
