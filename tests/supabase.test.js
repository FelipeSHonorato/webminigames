import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WINS_PER_LEVEL, POINTS_PER_LEVEL, LEVEL_NAMES } from "../shared/progress.js";
import { COINS_PER_DAY } from "../shared/coins.js";
import { ADMIN_COINS } from "../shared/roles.js";
import { REGIONS } from "../shared/regions.js";
import { GAMES } from "../js/games.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SDK } from "../shared/backend/config.js";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* ---------- O esquema do banco (SQL) e o código do site precisam dizer a mesma coisa ---------- */
const sql = readFileSync(new URL("../supabase/migrations/20261014000000_init.sql", import.meta.url), "utf8");
const fn = name => sql.match(new RegExp(`function public\\.${name}\\(\\)[^$]*\\$\\$ select ([^$]*?) \\$\\$`))?.[1];

test("SQL: constantes do jogo iguais às do JS (nível, pontos, coins)", () => {
  assert.equal(Number(fn("wins_per_level")), WINS_PER_LEVEL);
  assert.equal(Number(fn("coins_per_day")), COINS_PER_DAY);
  assert.equal(Number(fn("admin_coins")), ADMIN_COINS);
  assert.deepEqual(fn("points_per_level").match(/\d+/g).map(Number), POINTS_PER_LEVEL);
  assert.equal(POINTS_PER_LEVEL.length, LEVEL_NAMES.length);
});

test("SQL: as regiões aceitas (tabela e gatilho de cadastro) são as de shared/regions.js", () => {
  const lists = [...sql.matchAll(/region (?:not )?in \(([^)]*)\)/g)].map(m => m[1].match(/'([^']+)'/g).map(x => x.slice(1, -1)));
  assert.equal(lists.length, 2, "tabela profiles + gatilho handle_new_user");
  for (const l of lists) assert.deepEqual(l, REGIONS.map(r => r.id));
});

test("SQL: os jogos cadastrados são os de js/games.js, na mesma ordem e com o mesmo título", () => {
  const rows = [...sql.matchAll(/\('([a-z]+)', '([^']+)', (\d+)\)/g)].map(m => [m[1], m[2], Number(m[3])]);
  assert.deepEqual(rows, Object.entries(GAMES).map(([id, g], i) => [id, g.title, i + 1]));
  for (const [id, g] of Object.entries(GAMES)) assert.equal(g.key, `${id}.wins`, `${id}: a chave de vitórias vira o id do jogo`);
});

test("SQL: RLS ligado em toda tabela do esquema public", () => {
  const tables = [...sql.matchAll(/create table public\.(\w+)/g)].map(m => m[1]);
  assert.ok(tables.length >= 8);
  for (const t of tables) assert.match(sql, new RegExp(`alter table public\\.${t}\\s+enable row level security`), `${t} sem RLS`);
});

test("SQL: funções security definer fixam o search_path (sem sequestro por esquema)", () => {
  const defs = sql.match(/create function [\s\S]*?\$\$;?/g).filter(b => /security definer/.test(b));
  assert.ok(defs.length >= 8);
  for (const d of defs) assert.match(d, /set search_path = ''/, d.slice(0, 60));
});

test("SQL: o visitante (anon) só recebe a lista de jogos e o ranking; o papel (role) não é editável pelo cliente", () => {
  const toAnon = [...sql.matchAll(/^grant [^;]* to ([^;]*anon[^;]*);/gm)].map(m => m[0]);
  assert.equal(toAnon.length, 2, toAnon.join("\n"));
  assert.ok(toAnon.some(g => /select on public\.games/.test(g)) && toAnon.some(g => /function public\.ranking/.test(g)));
  const upd = sql.match(/grant update \(([^)]*)\) on public\.profiles/)[1];
  assert.ok(!/\brole\b/.test(upd) && !/\bid\b/.test(upd), `colunas editáveis: ${upd}`);
});

test("SQL: pontos, coins e vitórias só mudam por função (nenhuma tabela dessas dá insert/update/delete ao cliente)", () => {
  const writes = [...sql.matchAll(/^grant ((?:select, )?(?:insert|update|delete)[^;]*) on ([^;]*) to authenticated;/gm)].map(m => m[2].trim());
  assert.deepEqual(writes.sort(), ["public.games", "public.profiles", "public.runs"].sort());   // games só `enabled` (admin via RLS), profiles só colunas seguras, runs é do dono
});

test("a configuração entregue está vazia (modo local) e não leva chave secreta", () => {
  assert.equal(SUPABASE_URL, ""); assert.equal(SUPABASE_ANON_KEY, "");
  assert.doesNotMatch(readFileSync(new URL("../shared/backend/config.js", import.meta.url), "utf8"), /service_role[^"\n]*"[A-Za-z0-9._-]{20,}"/);
});

test("a biblioteca do Supabase vem do repositório (vendor/), com versão fixa e a exportação que o site usa", () => {
  assert.match(SUPABASE_SDK, /\/vendor\/supabase-js\.mjs$/);
  const file = fileURLToPath(SUPABASE_SDK);
  assert.ok(existsSync(file), "vendor/supabase-js.mjs ausente");
  const src = readFileSync(file, "utf8");
  assert.match(src.slice(0, 200), /@supabase\/supabase-js \d+\.\d+\.\d+/);
  assert.match(src, /export const createClient = supabase\.createClient;\s*$/);
});
