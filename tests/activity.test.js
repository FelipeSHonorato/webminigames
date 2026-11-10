import test from "node:test";
import assert from "node:assert/strict";
import { Idle, IDLE_LIMIT_MS } from "../shared/activity.js";
import { store } from "../shared/storage.js";

const NOW = 1_800_000_000_000;
const startSession = () => store.set("wmg.session", JSON.stringify({ id: "u-1", provider: "password" }));
const wipe = () => { for (const k of store.keys()) store.remove(k); };

test("sessão parada há um dia expira; dentro do prazo, não", () => {
  wipe(); startSession();
  Idle.touch(NOW - IDLE_LIMIT_MS - 1);
  assert.equal(Idle.expired(NOW), true);
  Idle.touch(NOW - IDLE_LIMIT_MS + 1);
  assert.equal(Idle.expired(NOW), false);
});

test("sem registro de atividade não expira (site atualizado agora ou primeira visita)", () => {
  wipe(); startSession();
  assert.equal(Idle.last(NOW), null);
  assert.equal(Idle.expired(NOW), false, "o prazo começa no primeiro acesso");
});

test("sem sessão não expira nem grava atividade", () => {
  wipe();
  Idle.touch(NOW);
  assert.equal(store.get("wmg.lastSeen"), null);
  assert.equal(Idle.expired(NOW), false);
});

test("abrir uma página (touch) renova o prazo", () => {
  wipe(); startSession();
  Idle.touch(NOW - IDLE_LIMIT_MS - 1);
  Idle.touch(NOW);
  assert.equal(Idle.expired(NOW + IDLE_LIMIT_MS - 1), false);
  assert.equal(Idle.expired(NOW + IDLE_LIMIT_MS), true);
});

test("clearSession encerra a sessão e esquece a atividade", () => {
  wipe(); startSession(); Idle.touch(NOW);
  Idle.clearSession();
  assert.equal(store.get("wmg.session"), "null");
  assert.equal(store.get("wmg.lastSeen"), null);
  assert.equal(Idle.expired(NOW + IDLE_LIMIT_MS * 10), false);
});

test("logout comum (clear) apaga só o prazo", () => {
  wipe(); startSession(); Idle.touch(NOW);
  Idle.clear();
  assert.equal(store.get("wmg.lastSeen"), null);
  assert.equal(JSON.parse(store.get("wmg.session")).id, "u-1");
});

test("relógio para trás (registro no futuro) não expira", () => {
  wipe(); startSession(); Idle.touch(NOW + 60_000);
  assert.equal(Idle.last(NOW), null);
  assert.equal(Idle.expired(NOW), false);
});

test("justExpired é ligado por markExpired (aviso na tela de login)", () => {
  wipe();
  Idle.markExpired();
  assert.equal(Idle.justExpired(), true);
});
