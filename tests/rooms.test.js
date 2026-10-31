import test from "node:test";
import assert from "node:assert/strict";
import { GAMES } from "../js/games.js";
import {
  ALL, duelIds, cleanRooms, filterItems, roomsOf, filterFromHash, hashForFilter, filterText, openedAgo, durationLabel,
} from "../shared/rooms.js";

const room = (id, gameId, createdAt, extra = {}) => ({ id, gameId, createdAt, maxSeconds: 600, mine: false, host: { nickname: "Ana", avatar: null }, ...extra });
const GAMES_FAKE = {
  zip: { title: "Zip" },
  chess: { title: "Xadrez", duel: true },
  dama: { title: "Dama", duel: true },
};

test("os jogos de duelo vêm do catálogo (duel: true), na ordem do catálogo", () => {
  assert.deepEqual(duelIds(GAMES_FAKE), ["chess", "dama"]);
  assert.deepEqual(duelIds(GAMES), Object.entries(GAMES).filter(([, g]) => g.duel).map(([id]) => id));
  assert.ok(duelIds(GAMES).includes("chess"));
  assert.deepEqual(duelIds({}), []);
});

test("cleanRooms descarta jogo desconhecido ou sem duelo e ordena da mais nova para a mais antiga", () => {
  const raw = [
    room("a", "chess", "2026-10-31T10:00:00Z"),
    room("b", "zip", "2026-10-31T11:00:00Z"),          // zip não é jogo de duelo
    room("c", "fantasma", "2026-10-31T11:30:00Z"),     // o catálogo não conhece
    room("d", "dama", "2026-10-31T12:00:00Z"),
    null, { gameId: "chess" },                          // lixo
  ];
  assert.deepEqual(cleanRooms(raw, GAMES_FAKE).map(r => r.id), ["d", "a"]);
  assert.deepEqual(cleanRooms(undefined, GAMES_FAKE), []);
  assert.deepEqual(cleanRooms({ rooms: [] }, GAMES_FAKE), []);
});

test("a lateral tem 'Todos' e um item por jogo de duelo, com a contagem de salas", () => {
  const rooms = [room("1", "chess", "2026-10-31T10:00:00Z"), room("2", "chess", "2026-10-31T10:01:00Z"), room("3", "dama", "2026-10-31T10:02:00Z")];
  assert.deepEqual(filterItems(GAMES_FAKE, rooms), [
    { id: ALL, label: "Todos", count: 3 },
    { id: "chess", label: "Xadrez", count: 2 },
    { id: "dama", label: "Dama", count: 1 },
  ]);
  assert.deepEqual(filterItems(GAMES_FAKE, []).map(i => i.count), [0, 0, 0], "sem salas, os itens continuam na lateral");
  assert.deepEqual(filterItems({}, []).map(i => i.id), [ALL]);
});

test("roomsOf mostra só as salas do jogo clicado (e todas em 'Todos')", () => {
  const rooms = [room("1", "chess", "x"), room("2", "dama", "x"), room("3", "chess", "x")];
  assert.deepEqual(roomsOf(rooms, "chess").map(r => r.id), ["1", "3"]);
  assert.deepEqual(roomsOf(rooms, "dama").map(r => r.id), ["2"]);
  assert.deepEqual(roomsOf(rooms, ALL).map(r => r.id), ["1", "2", "3"]);
  assert.deepEqual(roomsOf(rooms, "outro"), []);
});

test("o filtro vai para o endereço (#chess) e volta; valor estranho cai em Todos", () => {
  assert.equal(filterFromHash("#chess", GAMES_FAKE), "chess");
  assert.equal(filterFromHash("#CHESS", GAMES_FAKE), "chess");
  assert.equal(filterFromHash("#zip", GAMES_FAKE), ALL, "zip não é jogo de duelo");
  assert.equal(filterFromHash("", GAMES_FAKE), ALL);
  assert.equal(filterFromHash("#__proto__", GAMES_FAKE), ALL);
  assert.equal(hashForFilter(ALL), "");
  assert.equal(hashForFilter("chess"), "#chess");
  for (const id of duelIds(GAMES)) assert.equal(filterFromHash(hashForFilter(id), GAMES), id);
});

test("título e subtítulo mudam com o filtro", () => {
  assert.equal(filterText(ALL, GAMES_FAKE).title, "Salas online");
  assert.equal(filterText("chess", GAMES_FAKE).title, "Salas de Xadrez");
  assert.match(filterText("chess", GAMES_FAKE).sub, /Xadrez/);
  assert.equal(filterText("desconhecido", GAMES_FAKE).title, "Salas online");
});

test("openedAgo e durationLabel", () => {
  const now = Date.parse("2026-10-31T12:00:00Z");
  assert.equal(openedAgo("2026-10-31T12:00:00Z", now), "agora");
  assert.equal(openedAgo("2026-10-31T11:59:30Z", now), "agora");
  assert.equal(openedAgo("2026-10-31T11:55:00Z", now), "há 5 min");
  assert.equal(openedAgo("2026-10-31T10:30:00Z", now), "há 1 h");
  assert.equal(openedAgo("2026-10-31T12:05:00Z", now), "agora", "relógio adiantado não vira número negativo");
  assert.equal(openedAgo("lixo", now), "");
  assert.equal(durationLabel({ maxSeconds: 600 }), "10 min");
  assert.equal(durationLabel({ maxSeconds: 180 }), "3 min");
  assert.equal(durationLabel({ maxSeconds: 45 }), "45 s");
  assert.equal(durationLabel({}), "");
  assert.equal(durationLabel(null), "");
});
