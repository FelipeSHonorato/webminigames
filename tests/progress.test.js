import test from "node:test";
import assert from "node:assert/strict";
import { levelIndex, winsKey } from "../shared/progress.js";

test("o nível sobe a cada 15 vitórias e trava no Genius", () => {
  const got = [0, 14, 15, 29, 30, 44, 45, 999].map(w => levelIndex(w));
  assert.deepEqual(got, [0, 0, 1, 1, 2, 2, 3, 3]);
});
test("a chave de progresso é separada por usuário", () => {
  assert.equal(winsKey("zip.wins", "u1"), "zip.wins:u1");
  assert.notEqual(winsKey("zip.wins", "u1"), winsKey("zip.wins", "u2"));
});
