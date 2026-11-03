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
const migrationNames = ["20261014000000_init.sql", "20261017000000_delete_account.sql", "20261018000000_phase_runs.sql", "20261019000000_serve_phase.sql", "20261020000000_admin_sem_pontos.sql", "20261021000000_desafio_diario.sql", "20261022000000_diario_configuravel.sql", "20261023000000_jogo_setas.sql", "20261024000000_trofeus_diarios.sql", "20261025000000_admin_coins.sql", "20261026000000_daily_tickets.sql", "20261026000001_daily_backlog_hoje.sql", "20261027000000_daily_fluxo.sql", "20261028000000_daily_top_times.sql", "20261029000000_admin_level_daily.sql", "20261030000000_jogo_queens.sql", "20261031000000_jogo_tango.sql", "20261032000000_jogo_texttwist.sql", "20261033000000_texttwist_trofeus.sql", "20261034000000_texttwist_inicio_rodada.sql", "20261035000000_duels.sql", "20261036000000_duels_ajustes.sql", "20261037000000_duels_realtime_cron.sql", "20261038000000_chess_duel.sql", "20261039000000_duel_ratings.sql", "20261040000000_duel_open_rooms.sql", "20261041000000_one_open_room.sql", "20261042000000_duel_open_rooms_rating.sql", "20261043000000_duel_open_visibility.sql", "20261044000000_duel_invite_flow.sql", "20261045000000_duel_resume_presence.sql", "20261046000000_duel_invite_when_ready.sql", "20261047000000_dama_duel.sql", "20261048000000_duel_ready_fix.sql", "20261049000000_dama_valida_posicao.sql", "20261050000000_gamao_duel.sql"];
const migration = f => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), "utf8");
const migrations = migrationNames.map(migration);
const sql = migrations[0];                     // constantes, regiões e jogos vivem na migração inicial
const sqlAll = migrations.join("\n");          // estrutura (RLS, permissões, search_path): todas as migrações
const ticketSql = migration("20261026000000_daily_tickets.sql");
const flowSql = migration("20261027000000_daily_fluxo.sql");
const topTimesSql = migration("20261028000000_daily_top_times.sql");
const adminLevelDailySql = migration("20261029000000_admin_level_daily.sql");
const duelsFixSql = migration("20261036000000_duels_ajustes.sql");
const duelsRealtimeSql = migration("20261037000000_duels_realtime_cron.sql");
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
  /* Os jogos novos entram por migrações próprias; por isso a lista é lida de TODOS os inserts em public.games.
     Migrações antigas repetem o insert com `on conflict` para atualizar título/ordem — a primeira posição manda. */
  const rows = [];
  for (const block of sqlAll.matchAll(/insert into public\.games \(id, title, sort\) values([\s\S]*?);/g)) {
    for (const m of block[1].matchAll(/\('([a-z]+)', '([^']+)', (\d+)\)/g)) {
      const row = [m[1], m[2], Number(m[3])];
      const at = rows.findIndex(r => r[0] === row[0]);
      if (at >= 0) rows[at] = row; else rows.push(row);
    }
  }
  assert.deepEqual(rows, Object.entries(GAMES).map(([id, g], i) => [id, g.title, i + 1]));
  for (const [id, g] of Object.entries(GAMES)) {
    if (g.key) assert.equal(g.key, `${id}.wins`, `${id}: a chave de vitórias vira o id do jogo`);
    else assert.equal(g.duel, true, `${id}: jogo sem chave precisa ser só de duelo`);
  }
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
  assert.equal(toAnon.length, 5, toAnon.join("\n"));   // o grant antigo do daily_leaderboard fica no histórico; a função antiga é dropada
  assert.ok(toAnon.some(g => /select on public\.games/.test(g)) && toAnon.some(g => /function public\.ranking/.test(g)) && toAnon.some(g => /function public\.daily_leaderboard\(text, int, text, int, date\)/.test(g)) && toAnon.some(g => /function public\.duel_ranking\(text, text, int\)/.test(g)));
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

test("SQL: duelos 1x1 — tabelas, funções, RLS e grants", () => {
  for (const t of ["duels", "duel_players"]) {
    assert.match(sqlAll, new RegExp(`create table public\\.${t} \\(`), `${t} ausente`);
    assert.match(sqlAll, new RegExp(`alter table public\\.${t}\\s+enable row level security`), `${t} sem RLS`);
    assert.match(sqlAll, new RegExp(`revoke all on public\\.${t}`), `${t} sem revoke`);
  }
  for (const f of [
    "duel_create\\(uuid, text, int, bigint, int, jsonb, jsonb, text, int\\)",
    "duel_create\\(uuid, text, int, bigint, int, jsonb, jsonb, text, int, boolean\\)",
    "duel_join\\(uuid, text\\)",
    "duel_join_open\\(uuid, uuid\\)",
    "duel_ready\\(uuid, uuid\\)",
    "duel_start\\(uuid, uuid\\)",
    "duel_state\\(uuid, uuid\\)",
    "duel_finish\\(uuid, uuid, uuid, int\\)",
    "duel_settle\\(uuid\\)",
    "duel_leave\\(uuid, uuid\\)",
    "duel_cleanup\\(\\)",
    "duel_gen_code\\(\\)",
    "duel_open_rooms\\(uuid, int\\)"
  ]) {
    assert.match(sqlAll, new RegExp(`revoke all on function public\\.${f}\\s+from public, anon, authenticated`), `${f} acessivel ao cliente`);
    assert.match(sqlAll, new RegExp(`grant execute on function public\\.${f}\\s+to service_role`), `${f} deveria ser da Edge`);
  }
  // A policy do Realtime roda como `authenticated`; por isso is_duel_member é a exceção.
  assert.match(duelsFixSql, /grant execute on function public\.is_duel_member\(uuid\) to authenticated/);
  assert.match(sqlAll, /create or replace function public\.duel_gen_code\(\) returns text/);
  assert.match(sqlAll, /create or replace function public\.is_duel_member\(p_duel uuid\) returns boolean/);
  assert.match(sqlAll, /code\s+text\s+not\s+null\s+unique/);
  assert.match(sqlAll, /expires_at.*default now\(\) \+ interval '15 minutes'/);
  assert.match(sqlAll, /duel_players[\s\S]*primary key \(duel_id, user_id\)/);
  assert.match(sqlAll, /duel_finish[\s\S]*for update/);
  assert.match(sqlAll, /duel_settle[\s\S]*for update/);
  assert.match(sqlAll, /rule in \('first'\s*,\s*'words'\)/);
  assert.match(sqlAll, /status in \('waiting'\s*,\s*'running'\s*,\s*'finished'\s*,\s*'cancelled'\)/);
});

test("SQL: lista de salas abertas — só a Edge executa e nada de código, seed ou puzzle no resultado", () => {
  const roomsSql = migration("20261040000000_duel_open_rooms.sql");
  const code = roomsSql.replace(/--.*$/gm, "");   // sem os comentários
  assert.match(code, /create or replace function public\.duel_open_rooms\(p_uid uuid, p_limit int default 30\)/);
  assert.match(code, /security definer set search_path = public/);
  assert.match(code, /d\.status = 'waiting'/, "só salas esperando");
  assert.match(code, /d\.expires_at > now\(\)/, "salas expiradas não entram");
  assert.match(code, /count\(\*\) from public\.duel_players[^)]*\) < 2/, "sala com 2 jogadores não espera desafiante");
  for (const secret of [/d\.code\b/, /d\.seed\b/, /d\.gen\b/, /public_view/, /full_puzzle/]) {
    assert.doesNotMatch(code, secret, `a lista não pode expor ${secret}`);
  }
});

test("SQL: uma sala aberta por vez (duel_create e chess_create), sem contar sala expirada", () => {
  const code = migration("20261041000000_one_open_room.sql").replace(/--.*$/gm, "");
  for (const fn of ["duel_create", "chess_create"]) {
    const body = code.match(new RegExp(`create or replace function public\\.${fn}\\(.*?\\n\\s*end \\$\\$;`, "s"))?.[0];
    assert.ok(body, `${fn} não foi redefinida`);
    assert.match(body, /pg_advisory_xact_lock\(hashtextextended\('duel_open:' \|\| p_uid::text, 0\)\)/, `${fn}: lock por usuário`);
    assert.match(body, /status = 'waiting' and expires_at > now\(\)\) >= (v_cap|1) then\s*raise exception 'too_many_open'/, `${fn}: conta só sala viva`);
  }
  assert.match(code, /v_cap int := 1;/, "duel_create: limite 1");
  assert.doesNotMatch(code, /v_cap int := 3|>= 3 then/, "nenhum limite de 3 sobrou");
  assert.match(code, /grant execute on function public\.duel_create\(uuid, text, int, bigint, int, jsonb, jsonb, text, int\) to service_role/);
  assert.match(code, /grant execute on function public\.chess_create\(uuid, int, text, text, text\) to service_role/);
});

test("SQL: a lista de salas traz o rating do criador NAQUELE jogo (1500 para quem nunca jogou) e continua sem segredos", () => {
  const code = migration("20261042000000_duel_open_rooms_rating.sql").replace(/--.*$/gm, "");
  assert.match(code, /create or replace function public\.duel_open_rooms\(p_uid uuid, p_limit int default 30\)/);
  assert.match(code, /left join public\.duel_ratings dr on dr\.game_id = d\.game_id and dr\.user_id = d\.created_by/, "rating do jogo da sala, do criador");
  assert.match(code, /'rating', coalesce\(dr\.rating, 1500\)/, "sem linha em duel_ratings = 1500 (igual ao chess_json)");
  assert.match(code, /d\.status = 'waiting'/);
  assert.match(code, /d\.expires_at > now\(\)/);
  for (const secret of [/d\.code\b/, /d\.seed\b/, /public_view/, /full_puzzle/]) assert.doesNotMatch(code, secret);
  assert.match(code, /grant execute on function public\.duel_open_rooms\(uuid, int\) to service_role/);
  assert.doesNotMatch(code, /to (anon|authenticated)/, "só a Edge executa");
});

test("SQL: sala aberta ou fechada — coluna is_open, criação com p_open e lista sem as fechadas", () => {
  const code = migration("20261043000000_duel_open_visibility.sql").replace(/--.*$/gm, "");
  assert.match(code, /alter table public\.duels add column if not exists is_open boolean not null default true/,
    "salas antigas continuam abertas");
  assert.match(code, /drop function if exists public\.duel_create\(uuid, text, int, bigint, int, jsonb, jsonb, text, int\)/,
    "a assinatura antiga de duel_create sai");
  assert.match(code, /p_rule text, p_max_seconds int, p_open boolean default true/, "duel_create recebe a visibilidade");
  assert.match(code, /drop function if exists public\.chess_create\(uuid, int, text, text, text\)/,
    "a assinatura antiga de chess_create sai");
  assert.match(code, /p_fen text, p_key text, p_open boolean default true/, "chess_create recebe a visibilidade");
  assert.match(code, /coalesce\(p_open, true\)/, "sem escolha explícita, a sala nasce aberta");
  assert.match(code, /d\.is_open or d\.created_by = p_uid/, "fechada só aparece para o criador");
  assert.match(code, /'open', d\.is_open/, "a lista informa a visibilidade");
  assert.match(code, /create or replace function public\.duel_join_open\(p_uid uuid, p_duel uuid\)/);
  assert.match(code, /if not v_duel\.is_open then raise exception 'closed_room'/, "entrar por id exige sala aberta");
  assert.match(code, /create or replace function public\.duel_seat\(p_uid uuid, p_duel public\.duels\)/,
    "código e clique usam o mesmo assento");
  assert.match(code, /grant execute on function public\.duel_create\(uuid, text, int, bigint, int, jsonb, jsonb, text, int, boolean\) to service_role/);
  assert.match(code, /grant execute on function public\.chess_create\(uuid, int, text, text, text, boolean\) to service_role/);
  assert.match(code, /grant execute on function public\.duel_join_open\(uuid, uuid\) to service_role/);
  assert.doesNotMatch(code, /to (anon|authenticated)/, "só a Edge executa");
});

test("SQL: xadrez 1x1 — duelo por turnos, chess_games e funções exclusivas da Edge", () => {
  assert.match(sqlAll, /insert into public\.games \(id, title, sort\) values \('chess', 'Xadrez', 11\)/);
  assert.match(sqlAll, /add column if not exists kind text not null default 'race'/);
  assert.match(sqlAll, /duels_kind_check check \(kind in \('race', 'turn'\)\)/);
  assert.match(sqlAll, /kind = 'turn' or \(public_view is not null and full_puzzle is not null\)/, "turn não exige puzzle");
  assert.match(sqlAll, /duels_rule_check check \(rule in \('first', 'words', 'turn'\)\)/);

  assert.match(sqlAll, /create table public\.chess_games \(/);
  for (const col of ["fen", "turn", "version", "keys", "moves", "white_id", "black_id", "white_ms", "black_ms", "white_can_mate", "black_can_mate", "last_at", "result", "reason"])
    assert.match(sqlAll, new RegExp(`\\b${col}\\b`), `chess_games sem ${col}`);
  assert.match(sqlAll, /white_id is null or black_id is null or white_id <> black_id/);

  for (const f of [
    "chess_json\\(uuid, uuid, int, int\\)",
    "chess_create\\(uuid, int, text, text, text\\)",
    "chess_start\\(uuid, uuid\\)",
    "chess_state\\(uuid, uuid\\)",
    "chess_move\\(uuid, uuid, int, text, text, jsonb, jsonb, jsonb, text, text, boolean, boolean\\)",
    "chess_resign\\(uuid, uuid\\)",
  ]) {
    assert.match(sqlAll, new RegExp(`revoke all on function public\\.${f}\\s+from public, anon, authenticated`), `${f} acessível ao cliente`);
    assert.match(sqlAll, new RegExp(`grant execute on function public\\.${f}\\s+to service_role`), `${f} deveria ser da Edge`);
  }

  // O relógio é do Postgres; o estouro e a desistência decidem ali, não no cliente.
  assert.match(sqlAll, /reason = 'timeout'/);
  assert.match(sqlAll, /reason = 'resign'/);
  assert.match(sqlAll, /extract\(epoch from \(now\(\) - v_chess\.last_at\)\) \* 1000/);
  assert.match(sqlAll, /white_can_mate/, "FIDE 6.9: o estouro precisa saber quem ainda pode dar mate");
  assert.match(sqlAll, /white_id = case when white_id = p_uid then null else white_id end/, "sair do lobby libera a cor");
  assert.match(sqlAll, /kind = 'race'/, "a limpeza por max_seconds não pode encerrar xadrez");
});

test("SQL: dama 1x1 — duelo por turnos, dama_games e ranking Elo próprio", () => {
  const damaSql = migration("20261047000000_dama_duel.sql");
  assert.match(damaSql, /insert into public\.games \(id, title, sort\) values \('dama', 'Dama', 12\)/);
  assert.match(damaSql, /create table public\.dama_games \(/);
  for (const col of ["position", "turn", "version", "keys", "moves", "white_id", "black_id", "white_ms", "black_ms", "last_at", "result", "reason"])
    assert.match(damaSql, new RegExp(`\\b${col}\\b`), `dama_games sem ${col}`);
  assert.match(damaSql, /white_id is null or black_id is null or white_id <> black_id/);
  assert.match(damaSql, /revoke all on public\.dama_games from anon, authenticated/);
  assert.match(damaSql, /alter table public\.dama_games\s+enable row level security/);

  for (const f of [
    "dama_json\\(uuid, uuid, int, int\\)",
    "dama_create\\(uuid, int, text, text, text, boolean\\)",
    "dama_start\\(uuid, uuid\\)",
    "dama_state\\(uuid, uuid\\)",
    "dama_move\\(uuid, uuid, int, text, text, jsonb, jsonb, jsonb, text, text\\)",
    "dama_resign\\(uuid, uuid\\)",
  ]) {
    assert.match(damaSql, new RegExp(`revoke all on function public\\.${f}\\s+from public, anon, authenticated`), `${f} acessível ao cliente`);
    assert.match(damaSql, new RegExp(`grant execute on function public\\.${f}\\s+to service_role`), `${f} deveria ser da Edge`);
  }

  // Relógio e resultado no Postgres; na dama, estourar o tempo é derrota sempre (sem FIDE 6.9).
  assert.match(damaSql, /if v_duel\.game_id <> 'dama' then raise exception 'not_dama_duel'/);
  assert.match(damaSql, /reason = 'timeout'/);
  assert.match(damaSql, /reason = 'resign'/);
  assert.match(damaSql, /if v_dama\.turn = 'w' then\s*v_winner := v_dama\.black_id; v_result := 'black';/);
  assert.doesNotMatch(damaSql, /can_mate/, "a dama não usa a exceção de material do xadrez");

  // Assento e saída escolhem a tabela pelo game_id (xadrez continua funcionando).
  assert.match(damaSql, /if p_duel\.game_id = 'dama' then\s*update public\.dama_games/);
  assert.match(damaSql, /if v_duel\.game_id = 'dama' then\s*update public\.dama_games/);
  assert.match(damaSql, /else\s*update public\.chess_games/, "xadrez continua no mesmo fluxo");

  // O gatilho do ranking lê o resultado da tabela certa e usa o mesmo Elo de duel_ratings.
  assert.match(damaSql, /if new\.game_id = 'dama' then[\s\S]*?from public\.dama_games/);
  assert.match(damaSql, /perform public\.duel_rating_record\(new\.game_id, v_players\[1\], v_players\[2\], v_score\)/);
  assert.match(damaSql, /'rating', coalesce\(dr\.rating, 1500\)/);
});

test("SQL: gamão 1x1 — duelo por turnos, gamao_games e ranking Elo próprio", () => {
  const gamaoSql = migration("20261050000000_gamao_duel.sql");
  assert.match(gamaoSql, /insert into public\.games \(id, title, sort\) values \('gamao', 'Gamão', 13\)/);
  assert.match(gamaoSql, /create table public\.gamao_games \(/);
  for (const col of ["state", "turn", "version", "keys", "moves", "white_id", "black_id", "white_ms", "black_ms", "last_at", "result", "reason"])
    assert.match(gamaoSql, new RegExp(`\\b${col}\\b`), `gamao_games sem ${col}`);
  assert.match(gamaoSql, /white_id is null or black_id is null or white_id <> black_id/);
  assert.match(gamaoSql, /revoke all on public\.gamao_games from anon, authenticated/);
  assert.match(gamaoSql, /alter table public\.gamao_games\s+enable row level security/);

  for (const f of [
    "gamao_json\\(uuid, uuid, int, int\\)",
    "gamao_create\\(uuid, int, text, jsonb, text, boolean\\)",
    "gamao_start\\(uuid, uuid\\)",
    "gamao_state\\(uuid, uuid\\)",
    "gamao_move\\(uuid, uuid, int, jsonb, text, jsonb, jsonb, jsonb, text, text\\)",
    "gamao_resign\\(uuid, uuid\\)",
  ]) {
    assert.match(gamaoSql, new RegExp(`revoke all on function public\\.${f}\\s+from public, anon, authenticated`), `${f} acessível ao cliente`);
    assert.match(gamaoSql, new RegExp(`grant execute on function public\\.${f}\\s+to service_role`), `${f} deveria ser da Edge`);
  }

  // Relógio e resultado no Postgres; no gamão, estourar o tempo é derrota sempre (não há empate).
  assert.match(gamaoSql, /if v_duel\.game_id <> 'gamao' then raise exception 'not_gamao_duel'/);
  assert.match(gamaoSql, /reason = 'timeout'/);
  assert.match(gamaoSql, /reason = 'resign'/);
  assert.match(gamaoSql, /if v_gamao\.turn = 'w' then\s*v_winner := v_gamao\.black_id; v_result := 'black';/);
  assert.doesNotMatch(gamaoSql, /can_mate/, "o gamão não usa a exceção de material do xadrez");

  // Estado jsonb validado na criação e no lance (não aceita tabuleiro de outro jogo).
  assert.match(gamaoSql, /p_state->>'game' is distinct from 'gamao'/);
  assert.match(gamaoSql, /jsonb_array_length\(p_state->'points'\)/);

  // Assento e saída escolhem a tabela pelo game_id (xadrez/dama continuam funcionando).
  assert.match(gamaoSql, /if p_duel\.game_id = 'gamao' then\s*update public\.gamao_games/);
  assert.match(gamaoSql, /if v_duel\.game_id = 'gamao' then\s*update public\.gamao_games/);
  assert.match(gamaoSql, /elsif v_duel\.game_id = 'dama' then\s*update public\.dama_games/);
  assert.match(gamaoSql, /else\s*update public\.chess_games/, "xadrez continua no mesmo fluxo");

  // O gatilho do ranking lê o resultado da tabela certa e usa o mesmo Elo de duel_ratings.
  assert.match(gamaoSql, /if new\.game_id = 'gamao' then[\s\S]*?from public\.gamao_games/);
  assert.match(gamaoSql, /perform public\.duel_rating_record\(new\.game_id, v_players\[1\], v_players\[2\], v_score\)/);
  assert.match(gamaoSql, /'rating', coalesce\(dr\.rating, 1500\)/);
});

test("SQL: ranking dos duelos 1x1 — Elo por jogo, gatilho de fim e leitura pública", () => {
  const ratingSql = migration("20261039000000_duel_ratings.sql");
  assert.match(ratingSql, /create table public\.duel_ratings \(/);
  for (const col of ["game_id", "user_id", "rating", "peak", "wins", "losses", "draws", "games", "updated_at"])
    assert.match(ratingSql, new RegExp(`\\b${col}\\b`), `duel_ratings sem ${col}`);
  assert.match(ratingSql, /primary key \(game_id, user_id\)/);
  assert.match(ratingSql, /alter table public\.duel_ratings\s+enable row level security/);
  assert.match(ratingSql, /revoke all on public\.duel_ratings from anon, authenticated/);

  // Elo: provisório (K=40) nas 10 primeiras e 32 depois; o cálculo é puro.
  assert.match(ratingSql, /coalesce\(p_games, 0\) < 10 then 40 else 32/);
  assert.match(ratingSql, /power\(10\.0, \(p_opponent - p_rating\) \/ 400\.0\)/);

  // O gatilho roda em qualquer forma de encerrar e não pontua duas vezes.
  assert.match(ratingSql, /create trigger duel_rating_finish[\s\S]*after update of status on public\.duels/);
  assert.match(ratingSql, /old\.status is not distinct from new\.status/);
  assert.match(ratingSql, /new\.kind = 'turn'[\s\S]*from public\.chess_games/);
  assert.match(ratingSql, /when v_winner is null then 0\.5/);

  // Leitura pública no mesmo formato de public.ranking; o rating vira `points`.
  assert.match(ratingSql, /create or replace function public\.duel_ranking\(/);
  assert.match(ratingSql, /'points', f\.rating/);
  assert.match(ratingSql, /grant execute on function public\.duel_ranking\(text, text, int\) to anon, authenticated/);

  // A barra do tabuleiro recebe o rating real (1500 para quem ainda não jogou).
  assert.match(ratingSql, /'rating', coalesce\(dr\.rating, 1500\)/);
});

test("SQL: ajustes dos duelos corrigem avatar, LGPD, regra words e Realtime", () => {
  assert.match(duelsFixSql, /alter column created_by drop not null/);              // exclusão de conta
  assert.match(duelsFixSql, /p\.avatar/);                                          // coluna real de profiles
  assert.doesNotMatch(duelsFixSql, /p\.avatar_url/);
  assert.match(duelsFixSql, /drop function if exists public\.duel_finish\(uuid, uuid, uuid\)/);
  assert.match(duelsFixSql, /duel_finish\([\s\S]*p_words int default null/);       // grava words
  assert.match(duelsFixSql, /perform public\.duel_settle\(p_duel\)/);              // decide no 2º fim
  assert.match(duelsFixSql, /revoke all on function public\.duel_gen_code\(\)/);
  assert.match(duelsFixSql, /grant execute on function public\.is_duel_member\(uuid\) to authenticated/);
  assert.match(duelsFixSql, /if v_duel\.status <> 'running' then[\s\S]*return jsonb_build_object\('winner', v_duel\.winner_id, 'status', v_duel\.status\)/);
  // O settle das words precisa vir antes do empate genérico.
  const settleIdx = duelsFixSql.indexOf("for v_duel in select id from public.duels");
  const tieIdx = duelsFixSql.indexOf("-- Demais running expiradas sem vencedor");
  assert.ok(settleIdx > -1 && tieIdx > settleIdx, "settle das words deve vir antes do empate");
});

test("SQL: canal Realtime privado do duelo e limpeza agendada", () => {
  // A tabela é do supabase_realtime_admin: ALTER TABLE falharia e derrubaria a migração inteira.
  assert.doesNotMatch(duelsRealtimeSql, /alter table realtime\.messages/i);
  assert.match(duelsRealtimeSql, /RLS de realtime\.messages já vem ligada/);

  // Tópico malformado não pode virar cast inválido: o parse é guardado por regex dentro de CASE.
  assert.match(duelsRealtimeSql, /create or replace function public\.duel_topic_id\(p_topic text\) returns uuid/);
  assert.match(duelsRealtimeSql, /when p_topic ~ '\^duel:\[0-9a-fA-F\]\{8\}/);
  assert.match(duelsRealtimeSql, /grant execute on function public\.duel_topic_id\(text\) to authenticated/);

  // Leitura e escrita liberadas só para os dois jogadores da sala.
  assert.match(duelsRealtimeSql, /create policy duel_channel_read on realtime\.messages for select to authenticated[\s\S]*public\.is_duel_member\(public\.duel_topic_id\(realtime\.topic\(\)\)\)/);
  assert.match(duelsRealtimeSql, /create policy duel_channel_write on realtime\.messages for insert to authenticated[\s\S]*public\.is_duel_member\(public\.duel_topic_id\(realtime\.topic\(\)\)\)/);

  // Cron como rede de segurança (a limpeza preguiçosa continua valendo).
  assert.match(duelsRealtimeSql, /create extension if not exists pg_cron/);
  assert.match(duelsRealtimeSql, /select cron\.unschedule\(jobid\) from cron\.job where jobname = 'duel_cleanup'/);
  assert.match(duelsRealtimeSql, /cron\.schedule\(\s*'duel_cleanup',\s*'\*\/5 \* \* \* \*',\s*\$\$select public\.duel_cleanup\(\)\$\$/);
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

test("SQL: aviso de desafiante — entra pronto, só o criador aceita ou desiste, cancelar não mexe em rating", () => {
  const code = migration("20261044000000_duel_invite_flow.sql").replace(/--.*$/gm, "");
  assert.match(code, /alter table public\.duels add column if not exists cancel_reason text/);

  // Quem entra na sala já está pronto; o criador é quem aceita.
  const seat = code.match(/function public\.duel_seat[\s\S]*?end \$\$;/)[0];
  assert.match(seat, /insert into public\.duel_players \(duel_id, user_id, ready\)\s*values \(p_duel\.id, p_uid, true\)/);

  // O aviso só mostra MINHAS salas esperando, já com os dois jogadores.
  const invites = code.match(/function public\.duel_invites[\s\S]*?end \$\$;/)[0];
  assert.match(invites, /d\.created_by = p_uid/);
  assert.match(invites, /d\.status = 'waiting'/);
  assert.match(invites, /d\.expires_at > now\(\)/);
  assert.match(invites, /count\(\*\) from public\.duel_players dp where dp\.duel_id = d\.id\) = 2/);

  // Desistir: só o criador, só em waiting, cancela sem vencedor.
  const decline = code.match(/function public\.duel_decline[\s\S]*?end \$\$;/)[0];
  assert.match(decline, /v_duel\.created_by <> p_uid then\s*raise exception 'not_creator'/);
  assert.match(decline, /v_duel\.status <> 'waiting' then raise exception 'bad_status'/);
  assert.match(decline, /set status = 'cancelled', cancel_reason = 'declined'/);
  assert.doesNotMatch(decline, /winner_id|'finished'|duel_ratings|duel_rating_record/, "desistir não decide vencedor nem mexe em rating");

  // O rating só muda quando a partida TERMINA; cancelada nunca conta.
  const ratings = migration("20261039000000_duel_ratings.sql");
  assert.match(ratings, /if new\.status <> 'finished' or old\.status is not distinct from new\.status then\s*return new;/);

  // O desafiante descobre o motivo.
  assert.match(code, /'cancelReason', v_duel\.cancel_reason/);
  assert.match(code, /'cancelReason', d\.cancel_reason/);
  assert.match(code, /'createdBy', d\.created_by/);

  for (const f of ["duel_invites\\(uuid\\)", "duel_decline\\(uuid, uuid\\)"]) {
    assert.match(code, new RegExp(`grant execute on function public\\.${f} to service_role`), f);
  }
  assert.doesNotMatch(code, /to (anon|authenticated)/, "só a Edge executa");
});

test("SQL: retomar a sala e presença do desafiante (migração 45)", () => {
  const code = migration("20261045000000_duel_resume_presence.sql").replace(/--.*$/gm, "");
  assert.match(code, /alter table public\.duel_players add column if not exists last_seen_at timestamptz/);

  // duel_mine: só duelos DO usuário naquele jogo, esperando (não expirado) ou em andamento.
  const mine = code.match(/function public\.duel_mine[\s\S]*?end \$\$;/)[0];
  assert.match(mine, /dp\.user_id = p_uid/);
  assert.match(mine, /d\.game_id = p_game/);
  assert.match(mine, /d\.status = 'running' or \(d\.status = 'waiting' and d\.expires_at > now\(\)\)/);
  assert.match(mine, /jsonb_build_object\('duel', v_duel\)/, "sem duelo ativo: { duel: null }");

  // Presença: só carimba quem é jogador da sala e só enquanto ela espera.
  const touch = code.match(/function public\.duel_touch[\s\S]*?end \$\$;/)[0];
  assert.match(touch, /dp\.user_id = p_uid/);
  assert.match(touch, /d\.status = 'waiting'/);

  // Guarda: iniciar contra desafiante pronto que sumiu há mais de 90 s é recusado.
  const ready = code.match(/function public\.duel_ready[\s\S]*?end \$\$;/)[0];
  assert.match(ready, /o\.user_id <> p_uid and o\.ready/);
  assert.match(ready, /coalesce\(o\.last_seen_at, o\.joined_at\) < now\(\) - interval '90 seconds'/);
  assert.match(ready, /raise exception 'opponent_away'/);
  assert.match(ready, /v_ready = 2 then[\s\S]*?status = 'running', starts_at = now\(\) \+ interval '4 seconds'/, "a largada continua com os dois prontos");
  assert.match(code, /'away',\s+coalesce\(dp\.last_seen_at, dp\.joined_at\) < now\(\) - interval '90 seconds'/, "o aviso informa o desafiante ausente");

  for (const f of ["duel_touch\\(uuid, uuid\\)", "duel_mine\\(uuid, text\\)", "duel_invites\\(uuid\\)", "duel_ready\\(uuid, uuid\\)"]) {
    assert.match(code, new RegExp(`revoke all on function public\\.${f} from public, anon, authenticated`), f);
    assert.match(code, new RegExp(`grant execute on function public\\.${f} to service_role`), f);
  }
  assert.doesNotMatch(code, /to (anon|authenticated)/, "só a Edge executa");
});

test("SQL: o criador só é avisado depois que o desafiante clica em \"Estou pronto\" (migração 46)", () => {
  const code = migration("20261046000000_duel_invite_when_ready.sql").replace(/--.*$/gm, "");
  const seat = code.match(/function public\.duel_seat[\s\S]*?end \$\$;/)[0];
  assert.match(seat, /insert into public\.duel_players \(duel_id, user_id, ready\)\s*values \(p_duel\.id, p_uid, false\)/, "o desafiante entra NÃO pronto");
  const invites = code.match(/function public\.duel_invites[\s\S]*?end \$\$;/)[0];
  assert.match(invites, /dp\.user_id <> p_uid and dp\.ready\)/, "só avisa com o desafiante pronto");
  assert.match(invites, /d\.created_by = p_uid/);
  assert.match(invites, /'away',\s+coalesce\(dp\.last_seen_at, dp\.joined_at\)/, "mantém a informação de ausência");
  assert.match(code, /grant execute on function public\.duel_invites\(uuid\) to service_role/);
  assert.doesNotMatch(code, /to (anon|authenticated)/);
});


test("SQL: migração 48 conserta duel_ready e carimba a presença dentro do banco", () => {
  const code = migration("20261048000000_duel_ready_fix.sql").replace(/--.*$/gm, "");

  // duel_ready: declara v_players, lê o apelido de profiles (duel_players não tem `nickname`) e mantém a guarda.
  const ready = code.match(/function public\.duel_ready[\s\S]*?end \$\$;/)[0];
  assert.match(ready, /v_players jsonb;/, "a variável precisa estar declarada");
  assert.match(ready, /join public\.profiles p on p\.id = dp\.user_id/, "o apelido vem de profiles");
  assert.doesNotMatch(ready, /'nickname', nickname/, "duel_players não tem a coluna nickname");
  assert.match(ready, /raise exception 'opponent_away'/);
  assert.match(ready, /v_ready = 2 then[\s\S]*?status = 'running', starts_at = now\(\) \+ interval '4 seconds'/);

  // dama_state e chess_state carimbam a presença sem depender da Edge.
  for (const fn of ["dama_state", "chess_state"]) {
    const body = code.match(new RegExp(`function public\\.${fn}[\\s\\S]*?end \\$\\$;`))[0];
    assert.match(body, /v_duel\.status = 'waiting' then\s+update public\.duel_players set last_seen_at = now\(\)/, fn);
  }
  assert.doesNotMatch(code, /to (anon|authenticated)/, "só a Edge executa");
});


test("SQL: migração 49 recusa posição que não seja de Dama e cancela salas criadas com tabuleiro errado", () => {
  const code = migration("20261049000000_dama_valida_posicao.sql").replace(/--.*$/gm, "");
  const create = code.match(/function public\.dama_create[\s\S]*?end \$\$;/)[0];
  assert.match(create, /p_position !~ '\^\[\.pPdD-\]\{8\}\(\/\[\.pPdD-\]\{8\}\)\{7\}\$'/, "valida 8×8 com P/D/p/d");
  assert.match(create, /raise exception 'bad_state'/);
  assert.match(code, /update public\.duels d\s+set status = 'cancelled', cancel_reason = 'bad_position'/, "limpa salas contaminadas");
  assert.match(code, /d\.status in \('waiting', 'running'\)/, "só mexe em salas ativas");
  assert.match(code, /grant execute on function public\.dama_create\(uuid, int, text, text, text, boolean\) to service_role/);
  assert.doesNotMatch(code, /to (anon|authenticated)/);
});
