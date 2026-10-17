import { PASSWORD_RULES } from "../shared/password.js";

/** Lista de requisitos que vai ficando marcada enquanto a pessoa digita a senha. */
export function mountPasswordRules(input, list) {
  list.replaceChildren(...PASSWORD_RULES.map(r => Object.assign(document.createElement("li"), { textContent: r.text, id: `${list.id}-${r.id}` })));
  const update = () => PASSWORD_RULES.forEach(r => { document.getElementById(`${list.id}-${r.id}`).dataset.ok = String(r.test(input.value)); });
  input.addEventListener("input", update);
  update();
  return update;
}
