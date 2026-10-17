/* Regras da senha de uma conta NOVA (cadastro e troca de senha): mínimo de 8 caracteres, com pelo menos 1 número e 1 letra maiúscula.
   O LOGIN não usa estas regras: quem criou a conta com a regra antiga continua entrando com a senha que tem. */
export const PASSWORD_MIN = 8;
export const PASSWORD_RULES = [
  { id: "length", text: `Pelo menos ${PASSWORD_MIN} caracteres`, test: p => [...p].length >= PASSWORD_MIN },
  { id: "digit", text: "Pelo menos 1 número", test: p => /[0-9]/.test(p) },
  { id: "upper", text: "Pelo menos 1 letra maiúscula", test: p => /\p{Lu}/u.test(p) },   // aceita acentuadas (É, Ç…)
];
export const PASSWORD_HINT = `A senha precisa ter pelo menos ${PASSWORD_MIN} caracteres, um número e uma letra maiúscula.`;

/** Ids das regras que a senha NÃO cumpre ([] = senha válida). */
export const passwordProblems = password => PASSWORD_RULES.filter(r => !r.test(String(password ?? ""))).map(r => r.id);
/** Mensagem de erro, ou null se a senha é válida. */
export const passwordError = password => (passwordProblems(password).length ? PASSWORD_HINT : null);
