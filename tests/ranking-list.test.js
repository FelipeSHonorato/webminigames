import test from "node:test";
import assert from "node:assert/strict";

/* DOM mínimo: o ranking só precisa criar elementos, definir texto/atributos e anexar filhos. */
class FakeNode {
  constructor(tag) {
    this.tagName = tag;
    this.className = "";
    this.textContent = "";
    this.innerHTML = "";
    this.attributes = {};
    this.children = [];
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren() { this.children = []; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
}

globalThis.document = { createElement: tag => new FakeNode(tag) };
const { rankingRow, renderLeaderboard } = await import("../shared/ranking-list.js");

const row = (extra = {}) => ({ id: "u1", name: "Ana", points: 30, rank: 1, isMe: false, region: null, avatar: null, ...extra });

test("ranking sem formatador usa 'pts' e não confunde com Object.prototype.valueOf", () => {
  const list = new FakeNode("ol"), note = new FakeNode("p");
  renderLeaderboard({ list, note, data: { top: [row()], me: null }, scope: "global", loginUrl: "index.html" });

  assert.equal(list.children.length, 1);
  const li = list.children[0];
  assert.equal(li.children.at(-1).textContent, "30 pts");
});

test("rankingRow aceita um formatador próprio (Go mostra o grau Kyu/Dan no lugar do Elo)", () => {
  const li = rankingRow(row({ points: 1650 }), "Elo", r => `${r.points} → 15 kyu`);
  assert.equal(li.children.at(-1).textContent, "1650 → 15 kyu");
});

test("renderLeaderboard repassa o formatador também para a linha do usuário fora do top", () => {
  const list = new FakeNode("ol"), note = new FakeNode("p");
  const me = row({ id: "u2", name: "Bia", points: 1200, rank: 11, isMe: true });
  renderLeaderboard({
    list, note, data: { top: [row()], me }, scope: "global", loginUrl: "index.html",
    suffix: "Elo", formatValue: r => `rating ${r.points}`,
  });

  assert.equal(list.children.length, 3);                       // top + "…" + eu
  assert.equal(list.children[2].children.at(-1).textContent, "rating 1200");
});
