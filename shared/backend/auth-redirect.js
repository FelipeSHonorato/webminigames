/* O que o endereço da página diz sobre um link enviado por e-mail do Supabase (confirmação de conta etc.).
   Só devolve mensagens FIXAS: o texto da URL nunca é mostrado na tela (qualquer um pode montar um link com o texto que quiser). */
const MESSAGES = {
  otp_expired: "Este link expirou ou já foi usado. Peça um novo e-mail de confirmação abaixo.",
  access_denied: "Este link não é mais válido. Peça um novo e-mail de confirmação abaixo.",
  identity_already_exists: "Esta conta Google já está ligada a outro usuário.",
};
const GENERIC = "Não foi possível validar o link. Peça um novo e-mail de confirmação abaixo e tente de novo.";
const TYPES = ["signup", "email", "recovery"];   // tipos de link que pedem um clique: confirmação de conta e redefinição de senha

export const linkErrorMessage = code => MESSAGES[code] ?? GENERIC;

/** raw: o `location.hash` (ou `location.search`) da página. Devolve:
    { kind: "error", code, message }   o Supabase mandou um erro (link expirado, usado…)
    { kind: "confirm", tokenHash, type }   link do e-mail novo (?token_hash=...&type=email|signup|recovery): falta o clique
    { kind: "session", type }   o Supabase já abriu a sessão (link antigo, tokens no #)
    { kind: "none" }            nada de link */
export function readAuthRedirect(raw) {
  const p = new URLSearchParams(String(raw ?? "").replace(/^[#?]/, ""));
  if (p.has("error") || p.has("error_code")) { const code = p.get("error_code") ?? p.get("error"); return { kind: "error", code, message: linkErrorMessage(code) }; }
  if (p.get("token_hash") && TYPES.includes(p.get("type"))) return { kind: "confirm", tokenHash: p.get("token_hash"), type: p.get("type") };
  if (p.has("access_token")) return { kind: "session", type: p.get("type") ?? "signup" };
  return { kind: "none" };
}
