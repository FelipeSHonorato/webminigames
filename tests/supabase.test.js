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
const migrationNames = ["20261014000000_init.sql", "20261017000000_delete_account.sql", "20261018000000_phase_runs.sql", "20261019000000_serve_phase.sql", "20261020000000_admin_sem_pontos.sql", "20261021000000_desafio_diario.sql", "20261022000000_diario_configuravel.sql", "20261023000000_jogo_setas.sql", "20261024000000_trofeus_diarios.sql", "20261025000000_admin_coins.sql", "20261026000000_daily_tickets.sql", "20261026000001_daily_backlog_hoje.sql", "20261027000000_daily_fluxo.sql", "20261028000000_daily_top_times.sql", "20261029000000_admin_level_daily.sql", "20261030000000_jogo_queens.sql", "20261031000000_jogo_tango.sql", "20261032000000_jogo_texttwist.sql", "20261033000000_texttwist_trofeus.sql", "20261034000000_texttwist_inicio_rodada.sql"];
const migration = f => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), "utf8");
const migrations = migrationNames.map(migration);
const sql = migrations[0];                     // constantes, regiões e jogos vivem na migração inicial
const sqlAll = migrations.join("\n");          // estrutura (RLS, permissões, search_path): todas as migrações
const ticketSql = migration("20261026000000_daily_tickets.sql");
const flowSql = migration("20261027000000_daily_fluxo.sql");
const topTimesSql = migration("20261028000000_daily_top_times.sql");
const adminLevelDailySql = migration("20261029000000_admin_level_daily.sql");
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
  assert.equal(toAnon.length, 4, toAnon.join("\n"));   // o grant antigo do daily_leaderboard fica no histórico; a função antiga é dropada
  assert.ok(toAnon.some(g => /select on public\.games/.test(g)) && toAnon.some(g => /function public\.ranking/.test(g)) && toAnon.some(g => /function public\.daily_leaderboard\(text, int, text, int, date\)/.test(g)));
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
  for (const t of ["daily_coins", "daily_runs", "daily_results", "daily_tickets", "daily_grants", "daily_scenarios"]) {
    assert.match(sqlAll, new RegExp(`create table public\\.${t} \\(`), `${t} ausente`);
    assert.match(sqlAll, new RegExp(`alter table public\\.${t}\\s+enable row level security`), `${t} sem RLS`);
    assert.match(sqlAll, new RegExp(`revoke all on public\\.${t}`), `${t} sem revoke`);
  }
  for (const f of ["daily_open\\(uuid, text, int, date\\)", "daily_start\\(uuid, text, int, date\\)", "daily_hint\\(uuid, text, int, date\\)", "daily_finish\\(uuid, text, int, uuid, date, int, boolean\\)", "daily_run\\(uuid, text, int, date\\)"]) {
    assert.match(sqlAll, new RegExp(`revoke all on function public\\.${f}\\s+from public, anon, authenticated`), `${f} acessível ao cliente`);
    assert.match(sqlAll, new RegExp(`grant execute on function public\\.${f}\\s+to service_role`), `${f} deveria ser da Edge`);
  }
  for (const f of ["daily_open\\(uuid, text, int\\)", "daily_hint\\(uuid, text, int\\)", "daily_finish\\(uuid, text, int, uuid\\)", "daily_run\\(uuid, text, int\\)"])
    assert.match(sqlAll, new RegExp(`drop function if exists public\\.${f}`), `${f} antiga deveria sair`);
  assert.match(sqlAll, /America\/Sao_Paulo/);                       // o dia é o de Brasília
  assert.match(sqlAll, /daily_hint_seconds\(\)[^$]*\$\$ select 30/); // +30 s por dica
  assert.match(sqlAll, /day\s+date not null/);                       // o reset à meia-noite é por dia contado
  assert.match(sqlAll, /create table public\.daily_tickets[\s\S]*?primary key \(user_id, day, game_id, slot\)/); // fila por dia/slot
  assert.match(sqlAll, /create table public\.daily_scenarios[\s\S]*?public_view jsonb not null,[\s\S]*?full_puzzle jsonb not null/); // snapshot imutável
  assert.match(sqlAll, /daily_backlog_days\(\)[^$]*\$\$ select 30/); // teto de 30 dias de tickets
  assert.match(sqlAll, /create or replace function public\.daily_backlog_start\(\)[^$]*\$\$ select date '2026-10-20'/); // início do backlog no lançamento
});

test("SQL: coins por dia é configurável (settings) e manda no nº de cenários/cenários do dia", () => {
  assert.match(sqlAll, /create table public\.settings \(/);
  assert.match(sqlAll, /insert into public\.settings \(key, value\) values \('coins_per_day'/);
  assert.match(sqlAll, /alter table public\.settings\s+enable row level security/);
  assert.match(sqlAll, /create function public\.coins_cap\(\)/);                                        // valor efetivo (padrão = coins_per_day())
  assert.match(sqlAll, /coalesce\(\(select \(value\)::int from public\.settings where key = 'coins_per_day'\), public\.coins_per_day\(\)\)/);
  assert.match(sqlAll, /create function public\.set_coins_per_day\(p_n int\)/);
  assert.match(sqlAll, /grant execute on function public\.set_coins_per_day\(int\) to authenticated/);
  assert.match(sqlAll, /revoke all on function public\.coins_cap\(\)\s+from public, anon, authenticated/);
  assert.match(sqlAll, /slot <= public\.max_scenarios\(\)/);                                            // slots acompanham o máximo de cenários
  assert.match(sqlAll, /'config',\s+jsonb_build_object\('coinsPerDay', public\.coins_cap\(\)\)/);         // a tela recebe o valor
});

test("SQL: troféus do cenário diário (percentual, média e região) sem expor outros jogadores", () => {
  for (const f of ["daily_points\\(int, int\\)", "daily_scenario_stats\\(uuid, text, int, int, text, date\\)", "daily_my_stats\\(uuid, text, date\\)"]) {
    assert.match(sqlAll, new RegExp(`revoke all on function public\\.${f}\\s+from public, anon, authenticated`), `${f} acessível ao cliente`);
    assert.match(sqlAll, new RegExp(`grant execute on function public\\.${f}\\s+to service_role`), `${f} deveria ser interna`);
  }
  assert.match(sqlAll, /create index if not exists daily_results_scenario_idx on public\.daily_results \(day, game_id, level, slot\)/);
  assert.match(sqlAll, /'percentile', case when \(select players from tot\) <= 1 then 100/);             // sozinho = 100%
  assert.match(sqlAll, /'avgSeconds', round\(\(select avg_seconds from tot\)\)::int/);                    // média do mesmo cenário
  assert.match(sqlAll, /'regionRank',\s+case when p_region is null then null else \(select rank_region from mine\) end/);
  assert.match(sqlAll, /join public\.profiles p on p\.id = d\.user_id[\s\S]*?and p\.role <> 'admin'/);    // admin fica de fora, como no ranking
  assert.match(sqlAll, /'stats',\s+public\.daily_my_stats\(v_uid, g\.id, v_today\)/);                    // o dia já vem decorado
  assert.match(sqlAll, /'stats', public\.daily_scenario_stats\(p_uid, p_game, p_slot, v_run\.level/);      // e o fim devolve o troféu do slot
  assert.match(sqlAll, /row_number\(\) over \(order by f\.seconds asc, f\.points desc/);                   // ranking do dia com o mesmo desempate
  assert.match(sqlAll, /daily_scenario_stats\(p_uid, p_game, p_slot, v_level, \(select region from public\.profiles where id = p_uid\), v_day\)/); // reenvio do dia original
});

test("SQL: troféus trazem os três melhores tempos do cenário com foto", () => {
  assert.match(topTimesSql, /create or replace function public\.daily_scenario_stats\(p_uid uuid, p_game text, p_slot int, p_level int, p_region text, p_day date default null\)/);
  assert.match(topTimesSql, /coalesce\(p\.nickname, p\.name\) as name/);
  assert.match(topTimesSql, /'top', coalesce\(\(/);
  assert.match(topTimesSql, /jsonb_build_object\([\s\S]*?'id', b\.user_id,[\s\S]*?'name', b\.name,[\s\S]*?'avatar', b\.avatar,[\s\S]*?'seconds', b\.seconds/);
  assert.match(topTimesSql, /where b\.rank_global <= 3/);
  assert.match(topTimesSql, /and p\.role <> 'admin'/);
  assert.match(topTimesSql, /revoke all on function public\.daily_scenario_stats\(uuid, text, int, int, text, date\) from public, anon, authenticated/);
  assert.match(topTimesSql, /grant execute on function public\.daily_scenario_stats\(uuid, text, int, int, text, date\) to service_role/);
});

test("SQL: o administrador pode dar tickets diários a uma conta (por e-mail), só para teste", () => {
  assert.match(ticketSql, /create or replace function public\.admin_grant_coins\(p_email text, p_game text default null, p_coins int default 10\)/);
  assert.match(ticketSql, /revoke all on function public\.admin_grant_coins\(text, text, int\) from public, anon, authenticated;/);
  assert.match(ticketSql, /grant execute on function public\.admin_grant_coins\(text, text, int\)\s+to authenticated;/);
  assert.match(ticketSql, /where lower\(u\.email\) = v_email/);                                // o e-mail é resolvido em auth.users
  assert.match(ticketSql, /insert into public\.daily_tickets \(user_id, day, game_id, slot, level, seed\)/);
  assert.match(ticketSql, /least\(greatest\(coalesce\(p_coins, 0\), 0\), public\.daily_backlog_days\(\)\)/); // p_coins = dias
  assert.doesNotMatch(ticketSql, /insert into public\.daily_coins/);                           // não volta a escrever no saldo antigo
});

test("SQL: trocar o nível do administrador reinicia o diário do jogo no nível novo", () => {
  assert.match(adminLevelDailySql, /create or replace function public\.admin_set_level\(p_game text, p_level int\)/);
  assert.match(adminLevelDailySql, /delete from public\.daily_tickets where user_id = auth\.uid\(\) and game_id = p_game/);
  assert.match(adminLevelDailySql, /delete from public\.daily_runs\s+where user_id = auth\.uid\(\) and game_id = p_game/);
  assert.match(adminLevelDailySql, /delete from public\.daily_results\s+where user_id = auth\.uid\(\) and game_id = p_game and day = public\.daily_day\(\)/);
  assert.match(adminLevelDailySql, /revoke all on function public\.admin_set_level\(text, int\)\s+from public, anon, authenticated/);
  assert.match(adminLevelDailySql, /grant execute on function public\.admin_set_level\(text, int\)\s+to authenticated/);
});

test("SQL: o fluxo diário guarda no máximo 30 dias e informa o teto de coins", () => {
  assert.match(flowSql, /create or replace function public\.daily_grant/);
  assert.match(flowSql, /v_cutoff\s+date := public\.daily_day\(\) - \(public\.daily_backlog_days\(\) - 1\)/);
  assert.match(flowSql, /delete from public\.daily_tickets[\s\S]*?day < v_cutoff/);   // descarta a fila vencida
  assert.match(flowSql, /delete from public\.daily_runs[\s\S]*?day < v_cutoff/);      // tentativas antigas também expiram
  assert.match(flowSql, /delete from public\.daily_tickets[\s\S]*?slot > v_cap/);    // reduzir o limite remove slots que não existem mais
  assert.match(flowSql, /v_start\s*:= greatest\(v_last, public\.daily_backlog_start\(\), v_cutoff\)/);
  assert.match(flowSql, /'maxCoins', v_max/);
  assert.match(flowSql, /public\.daily_backlog_days\(\) \* v_cap/);
  assert.match(flowSql, /create or replace function public\.admin_grant_coins/);
  assert.match(flowSql, /grant execute on function public\.daily_seed\(date, text, int, int\) to service_role/);
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
