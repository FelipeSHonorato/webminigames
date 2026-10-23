import test from "node:test";
import assert from "node:assert/strict";
import { betterThanPercent, averageStatus, scenarioTrophies } from "../shared/daily-stats.js";
import { nextTicket } from "../shared/daily.js";

test("troféus: percentual de jogadores superados (e sozinho = 100%)", () => {
  assert.equal(betterThanPercent(1, 1), 100);
  assert.equal(betterThanPercent(1, 4), 75);
  assert.equal(betterThanPercent(2, 4), 50);
  assert.equal(betterThanPercent(4, 4), 0);
  assert.equal(betterThanPercent(1, 3), 67);
  assert.equal(betterThanPercent(0, 4), null);
  assert.equal(betterThanPercent(1, 0), null);
  assert.equal(betterThanPercent(NaN, 4), null);
  assert.equal(betterThanPercent(1, NaN), null);
});

test("troféus: acima/abaixo da média (sozinho ou empatado = na média)", () => {
  assert.equal(averageStatus(10, 20, 5), "above");
  assert.equal(averageStatus(30, 20, 5), "below");
  assert.equal(averageStatus(20, 20, 5), "even");
  assert.equal(averageStatus(20, 20, 1), "even");
  assert.equal(averageStatus(NaN, 20, 5), "even");
  assert.equal(averageStatus(20, NaN, 5), "even");
});

test("troféus: normaliza os dados do servidor", () => {
  assert.deepEqual(
    scenarioTrophies({ seconds: 17, avgSeconds: 19, rank: 1, players: 4, points: 15, hints: 0, region: "sudeste", regionRank: 1, regionPlayers: 2 }),
    { players: 4, rank: 1, percent: 75, average: "above", seconds: 17, avgSeconds: 19, points: 15, hints: 0, region: "sudeste", regionRank: 1, regionPlayers: 2 },
  );
  assert.equal(scenarioTrophies(null), null);
  assert.deepEqual(
    scenarioTrophies({}),
    { players: 0, rank: 0, percent: null, average: "even", seconds: null, avgSeconds: null, points: 0, hints: 0, region: null, regionRank: null, regionPlayers: null },
  );
  assert.deepEqual(scenarioTrophies({ players: 1, rank: 1, seconds: 12, avgSeconds: 12 }).percent, 100);
});

test("fila diária: o dia mais antigo vem antes, mesmo que uma tentativa mais nova esteja aberta", () => {
  const open = [{ day: "2026-10-22", slot: 2 }];
  const pending = [{ day: "2026-10-21", slot: 1 }, { day: "2026-10-22", slot: 1 }];
  assert.deepEqual(nextTicket(open, pending), { day: "2026-10-21", slot: 1 });
  assert.deepEqual(nextTicket([{ day: "2026-10-21", slot: 2 }], [{ day: "2026-10-21", slot: 1 }]), { day: "2026-10-21", slot: 1 });
  assert.equal(nextTicket([], []), null);
});
