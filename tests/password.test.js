import test from "node:test";
import assert from "node:assert/strict";
import { PASSWORD_MIN, PASSWORD_RULES, PASSWORD_HINT, passwordProblems, passwordError } from "../shared/password.js";
import { Auth } from "../js/auth.js";
import { authErrorMessage } from "../shared/backend/cloud.js";

test("senha válida: 8+ caracteres, com número e letra maiúscula", () => {
  for (const ok of ["Abcdefg1", "Senha123", "A1bbbbbb", "minhaSenha9", "ÉcoSeguro9", "Ab1!@#$%", "Ab1😀😀😀😀😀"]) {
    assert.deepEqual(passwordProblems(ok), [], ok);
    assert.equal(passwordError(ok), null, ok);
  }
});

test("cada requisito é cobrado separadamente", () => {
  assert.deepEqual(passwordProblems("Abc1234"), ["length"], "7 caracteres");
  assert.deepEqual(passwordProblems("abcdefg1"), ["upper"], "sem maiúscula");
  assert.deepEqual(passwordProblems("Abcdefgh"), ["digit"], "sem número");
  assert.deepEqual(passwordProblems("12345678"), ["upper"], "só números");
  assert.deepEqual(passwordProblems("ABCDEFGH"), ["digit"], "só maiúsculas");
  assert.deepEqual(passwordProblems("abc"), ["length", "digit", "upper"]);
  assert.deepEqual(passwordProblems(""), ["length", "digit", "upper"]);
  assert.deepEqual(passwordProblems(null), ["length", "digit", "upper"]);
  assert.deepEqual(passwordProblems(undefined), ["length", "digit", "upper"]);
});

test("a antiga regra de 6 caracteres não basta mais, e espaços não contam como letra ou número", () => {
  assert.notEqual(passwordError("Abc123"), null);          // 6 caracteres
  assert.notEqual(passwordError("        "), null);        // 8 espaços
  assert.notEqual(passwordError("Abcdefgh "), null);       // 9 caracteres, sem número
  assert.deepEqual(passwordProblems("１２３４５６７Ａ"), ["digit"]);   // algarismos de largura total não contam como número (só 0-9)
});

test("a mensagem diz as três regras em português e vem do mesmo texto da lista", () => {
  assert.equal(PASSWORD_MIN, 8);
  assert.match(PASSWORD_HINT, /8 caracteres.*número.*maiúscula/);
  assert.equal(passwordError("fraca"), PASSWORD_HINT);
  assert.deepEqual(PASSWORD_RULES.map(r => r.id), ["length", "digit", "upper"]);
  assert.ok(PASSWORD_RULES.every(r => /^Pelo menos /.test(r.text)));
  assert.equal(authErrorMessage({ code: "weak_password" }), PASSWORD_HINT, "o erro do servidor usa a mesma mensagem");
});

/* ---------- contas locais: cadastro e troca exigem a regra nova; login NÃO ---------- */
test("cadastro recusa senha fraca e não cria a conta; aceita senha forte", async () => {
  const base = { name: "Ana", region: "sul" };
  for (const password of ["abc123", "abcdefgh", "ABCDEFGH1".slice(0, 7), "semnumeroA", "SEMMINUSCULA".toLowerCase()]) {
    await assert.rejects(Auth.register({ ...base, email: "fraca@t.com", password }), /8 caracteres, um número e uma letra maiúscula/, password);
  }
  await assert.rejects(Auth.login({ email: "fraca@t.com", password: "Qualquer1" }), /incorretos/, "a conta fraca não foi criada");
  const user = await Auth.register({ ...base, email: "forte@t.com", password: "Forte1234" });
  assert.equal(user.name, "Ana");
  await Auth.logout();
  assert.equal((await Auth.login({ email: "forte@t.com", password: "Forte1234" })).name, "Ana");
});

test("login não aplica a regra de senha forte (contas antigas continuam entrando)", async () => {
  await assert.rejects(Auth.login({ email: "forte@t.com", password: "abc" }), /incorretos/, "senha fraca e errada: erro de credencial, não de regra");
  await assert.rejects(Auth.login({ email: "forte@t.com", password: "" }), /Digite sua senha/);
  await assert.rejects(Auth.login({ email: "naoeemail", password: "x" }), /e-mail válido/);
});

test("trocar a senha também exige a regra nova", async () => {
  await Auth.login({ email: "forte@t.com", password: "Forte1234" });
  await assert.rejects(Auth.changePassword({ current: "Forte1234", next: "fraca" }), /A nova senha precisa ter pelo menos 8 caracteres/);
  await assert.rejects(Auth.changePassword({ current: "Forte1234", next: "semnumeroA" }), /número/);
  await Auth.changePassword({ current: "Forte1234", next: "NovaSenha99" });
  await Auth.logout();
  await assert.rejects(Auth.login({ email: "forte@t.com", password: "Forte1234" }), /incorretos/);
  assert.ok(await Auth.login({ email: "forte@t.com", password: "NovaSenha99" }));
});
