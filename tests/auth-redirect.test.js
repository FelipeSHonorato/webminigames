import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { readAuthRedirect, linkErrorMessage } from "../shared/backend/auth-redirect.js";

test("erro do Supabase (link expirado/usado): mensagem fixa em português, sem repetir o texto da URL", () => {
  const r = readAuthRedirect("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
  assert.equal(r.kind, "error"); assert.equal(r.code, "otp_expired");
  assert.match(r.message, /expirou ou já foi usado/);
  const evil = readAuthRedirect("#error=x&error_code=nova_coisa&error_description=%3Cscript%3Ealert(1)%3C%2Fscript%3E%20Ligue%20para%200800");
  assert.equal(evil.kind, "error"); assert.doesNotMatch(evil.message, /script|0800/); assert.equal(evil.message, linkErrorMessage("qualquer"));
  assert.equal(readAuthRedirect("?error=access_denied").code, "access_denied", "também vale no ?");
});

test("link novo do e-mail: ?token_hash e type=email|signup viram um pedido de clique", () => {
  assert.deepEqual(readAuthRedirect("?token_hash=abc123&type=email"), { kind: "confirm", tokenHash: "abc123", type: "email" });
  assert.deepEqual(readAuthRedirect("#token_hash=abc123&type=signup"), { kind: "confirm", tokenHash: "abc123", type: "signup" });
  for (const bad of ["?token_hash=abc&type=recovery", "?token_hash=abc&type=magiclink", "?token_hash=abc", "?type=email", "?token_hash=&type=email"]) assert.equal(readAuthRedirect(bad).kind, "none", bad);
});

test("link antigo (tokens no #) e página aberta sem link", () => {
  assert.deepEqual(readAuthRedirect("#access_token=a.b.c&refresh_token=r&expires_in=3600&token_type=bearer&type=signup"), { kind: "session", type: "signup" });
  assert.equal(readAuthRedirect("#access_token=a.b.c").type, "signup");
  for (const none of ["", "#", "?", null, undefined, "?modo=conta", "#qualquer"]) assert.deepEqual(readAuthRedirect(none), { kind: "none" }, String(none));
});

test("erro tem prioridade sobre o resto", () => {
  assert.equal(readAuthRedirect("#error=access_denied&error_code=otp_expired&access_token=x").kind, "error");
});

/* ---------- o modelo de e-mail e a página precisam combinar ---------- */
const tpl = readFileSync(new URL("../supabase/templates/confirmacao.html", import.meta.url), "utf8");

test("modelo de e-mail: o botão leva à página confirmar.html no formato que ela lê", () => {
  assert.ok(existsSync(new URL("../confirmar.html", import.meta.url)) && existsSync(new URL("../js/confirmar.js", import.meta.url)));
  const hrefs = [...tpl.matchAll(/href="([^"]*confirmar\.html[^"]*)"/g)].map(m => m[1].replaceAll("&amp;", "&"));
  assert.equal(hrefs.length, 2, "botão + endereço por extenso");
  for (const h of hrefs) {
    const url = new URL(h.replace("{{ .SiteURL }}", "https://webminigames.vercel.app").replace("{{ .TokenHash }}", "HASH123"));
    assert.equal(url.pathname, "/confirmar.html");
    assert.deepEqual(readAuthRedirect(url.search), { kind: "confirm", tokenHash: "HASH123", type: "email" });
  }
});

test("modelo de e-mail: só usa variáveis do Supabase conhecidas, sem script, com nome protegido e logotipo do próprio site", () => {
  const vars = new Set([...tpl.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].map(m => m[1]));
  const allowed = new Set([".SiteURL", ".TokenHash", ".Email", ".Data.name", "if .Data.name", "else", "end"]);
  for (const v of vars) assert.ok(allowed.has(v), `variável inesperada: ${v}`);
  assert.match(tpl, /\{\{ if \.Data\.name \}\}Olá, \{\{ \.Data\.name \}\}!\{\{ else \}\}Olá!\{\{ end \}\}/, "sem nome, não imprime <no value>");
  assert.doesNotMatch(tpl, /<script|javascript:|<form|<iframe/i);
  assert.match(tpl, /<html lang="pt-BR">/);
  const imgs = [...tpl.matchAll(/<img[^>]*src="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(imgs, ["{{ .SiteURL }}/assets/email-logo.png"]);
  assert.ok(existsSync(new URL("../assets/email-logo.png", import.meta.url)), "o logotipo precisa estar publicado em /assets");
  assert.match(tpl, /prefers-color-scheme: dark/);
});
