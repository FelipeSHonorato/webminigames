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
const migrations = ["20261014000000_init.sql", "20261017000000_delete_account.sql", "20261018000000_phase_runs.sql", "20261019000000_serve_phase.sql", "20261020000000_admin_sem_pontos.sql", "20261021000000_desafio_diario.sql"]
  .map(f => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), "utf8"));
const sql = migrations[0];                     // constantes, regiões e jogos vivem na migração inicial
const sqlAll = migrations.join("\n");          // estrutura (RLS, permissões, search_path): todas as migrações
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
  const tables = [...sqlAll.matchAll(/create table public\.(\w+)/g)].map(m => m[1]);
  assert.ok(tables.length >= 8);
  for (const t of tables) assert.match(sqlAll, new RegExp(`alter table public\\.${t}\\s+enable row level security`), `${t} sem RLS`);
});

test("SQL: funções security definer fixam o search_path (sem sequestro por esquema)", () => {
  const defs = sqlAll.match(/create function [\s\S]*?\$\$;?/g).filter(b => /security definer/.test(b));
  assert.ok(defs.length >= 8);
  for (const d of defs) assert.match(d, /set search_path = ''/, d.slice(0, 60));
});

test("SQL: o visitante (anon) só recebe a lista de jogos e o ranking; o papel (role) não é editável pelo cliente", () => {
  const toAnon = [...sqlAll.matchAll(/^grant [^;]* to ([^;]*anon[^;]*);/gm)].map(m => m[0]);
  assert.equal(toAnon.length, 3, toAnon.join("\n"));
  assert.ok(toAnon.some(g => /select on public\.games/.test(g)) && toAnon.some(g => /function public\.ranking/.test(g)) && toAnon.some(g => /function public\.daily_leaderboard/.test(g)));
  const upd = sql.match(/grant update \(([^)]*)\) on public\.profiles/)[1];
  assert.ok(!/\brole\b/.test(upd) && !/\bid\b/.test(upd), `colunas editáveis: ${upd}`);
});

test("SQL: pontos, coins e vitórias só mudam por função (nenhuma tabela dessas dá insert/update/delete ao cliente)", () => {
  const writes = [...sqlAll.matchAll(/^grant ((?:select, )?(?:insert|update|delete)[^;]*) on ([^;]*) to authenticated;/gm)].map(m => m[2].trim());
  assert.deepEqual(writes.sort(), ["public.games", "public.profiles", "public.runs"].sort());   // games só `enabled` (admin via RLS), profiles só colunas seguras, runs é do dono
});

test("SQL: a fase e os pontos são decididos no servidor (o cliente não pontua mais direto)", () => {
  const phase = sqlAll.match(/create table public\.phase_runs \([\s\S]*?\);/)?.[0] ?? "";
  assert.match(phase, /level\s+smallint not null/);
  assert.match(sqlAll, /add column hints\s+smallint not null default 0/);      // dicas contadas no servidor
  assert.match(sqlAll, /add column puzzle jsonb/);                            // puzzle público (sem a solução)
  assert.match(sqlAll, /drop function if exists public\.submit_win\(text, int, uuid\)/);   // a assinatura antiga (pontos do cliente) sai
  for (const f of ["new_run\\(text, bigint\\)", "submit_win\\(text, uuid, int\\)", "level_for\\(uuid, text\\)", "open_phase\\(uuid, text, bigint, jsonb\\)", "use_hint\\(uuid, text\\)", "finalize_win\\(uuid, text, uuid\\)"])
    assert.match(sqlAll, new RegExp(`revoke all on function public\\.${f}\\s+from public, anon, authenticated`), `${f} deveria estar revogada ao cliente`);
  for (const f of ["level_for\\(uuid, text\\)", "open_phase\\(uuid, text, bigint, jsonb\\)", "use_hint\\(uuid, text\\)", "finalize_win\\(uuid, text, uuid\\)"])
    assert.match(sqlAll, new RegExp(`grant execute on function public\\.${f}\\s+to service_role`), `${f} deveria ser exclusiva do service_role`);
  assert.match(sqlAll, /'phases',\s+coalesce\(\(select jsonb_object_agg\(game_id, jsonb_build_object\('level', level, 'hints', hints, 'puzzle', puzzle\)\)/);
});

test("SQL: o desafio diário tem tabelas, funções e só a Edge escreve a fase", () => {
  for (const t of ["daily_coins", "daily_runs", "daily_results"]) {
    assert.match(sqlAll, new RegExp(`create table public\\.${t} \\(`), `${t} ausente`);
    assert.match(sqlAll, new RegExp(`alter table public\\.${t}\\s+enable row level security`), `${t} sem RLS`);
    assert.match(sqlAll, new RegExp(`revoke all on public\\.${t}`), `${t} sem revoke`);
  }
  for (const f of ["daily_open\\(uuid, text, int\\)", "daily_hint\\(uuid, text, int\\)", "daily_finish\\(uuid, text, int, uuid\\)", "daily_run\\(uuid, text, int\\)"]) {
    assert.match(sqlAll, new RegExp(`revoke all on function public\\.${f}\\s+from public, anon, authenticated`), `${f} acessível ao cliente`);
    assert.match(sqlAll, new RegExp(`grant execute on function public\\.${f}\\s+to service_role`), `${f} deveria ser da Edge`);
  }
  assert.match(sqlAll, /America\/Sao_Paulo/);                       // o dia é o de Brasília
  assert.match(sqlAll, /daily_hint_seconds\(\)[^$]*\$\$ select 30/); // +30 s por dica
  assert.match(sqlAll, /day\s+date not null/);                       // o reset à meia-noite é por dia contado
});

test("a configuração do Supabase é válida quando preenchida (ou vazia, no modo local) e nunca leva chave secreta", () => {
  const src = readFileSync(new URL("../shared/backend/config.js", import.meta.url), "utf8");
  assert.equal(Boolean(SUPABASE_URL), Boolean(SUPABASE_ANON_KEY), "SUPABASE_URL e SUPABASE_ANON_KEY devem estar preenchidos juntos");
  if (SUPABASE_URL || SUPABASE_ANON_KEY) {
    assert.match(SUPABASE_URL, /^https:\/\/[a-z0-9]+\.supabase\.co$/, "URL do Supabase inesperada");
    assert.match(SUPABASE_ANON_KEY, /^(eyJ|sb_publishable_)/, "use a chave anon/publishable, nunca a secreta");
  }
  assert.doesNotMatch(src, /service_role[^"\n]*"[A-Za-z0-9._-]{20,}"/);
  assert.doesNotMatch(src, /sb_secret_[A-Za-z0-9_-]{20,}/);
});

test("a biblioteca do Supabase vem do repositório (vendor/), com versão fixa e a exportação que o site usa", () => {
  assert.match(SUPABASE_SDK, /\/vendor\/supabase-js\.mjs$/);
  const file = fileURLToPath(SUPABASE_SDK);
  assert.ok(existsSync(file), "vendor/supabase-js.mjs ausente");
  const src = readFileSync(file, "utf8");
  assert.match(src.slice(0, 200), /@supabase\/supabase-js \d+\.\d+\.\d+/);
  assert.match(src, /export const createClient = supabase\.createClient;\s*$/);
});
