-- =====================================================================================================
-- WebMiniGames · desafio diário com tickets acumuláveis
--
-- Como aplicar: Supabase > SQL Editor > cole este arquivo inteiro > Run (ou `supabase db push`).
-- Rode DEPOIS de 20261025000000_admin_coins.sql.
--
-- O que muda:
--   * Os "coins do dia" viram TICKETS de cenário: cada ticket guarda dia, jogo, slot, nível e seed.
--     O nível é congelado na concessão do dia; jogar um cenário atrasado NÃO recalcula o nível.
--   * Um jogador que não entra durante alguns dias acumula os tickets desses dias. O limite de acúmulo
--     é de 30 dias. Ao abrir, o cenário mais antigo é escolhido (FIFO).
--   * O cenário é compartilhado e imutável em `daily_scenarios` (dia, jogo, nível, slot): a Edge gera
--     uma vez (visão pública + puzzle completo no servidor) e todos os jogadores do mesmo nível/slot usam
--     o mesmo tabuleiro, mesmo depois de um deploy do gerador.
--   * Resultados de tickets atrasados continuam pertencendo ao dia original e entram no ranking daquele
--     dia. `daily_finish`, dicas, troféus e `daily_leaderboard` passam a receber `p_day`.
--   * `daily_runs` continua sendo a tentativa aberta. `daily_tickets` é a fila de cenários ainda não abertos.
--   * A conta administradora continua podendo testar `admin_grant_coins` (a função agora concede tickets).
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------------
-- 1. Constantes e relógio do desafio
-- ---------------------------------------------------------------------------------------------------
create function public.daily_backlog_days() returns int language sql immutable set search_path = '' as $$ select 30 $$;
create function public.daily_backlog_start() returns date language sql immutable set search_path = '' as $$ select date '2026-10-26' $$;

-- ---------------------------------------------------------------------------------------------------
-- 2. Tabelas novas (só as funções/Edge escrevem: nenhum papel do navegador tem acesso)
-- ---------------------------------------------------------------------------------------------------

-- Fila de cenários pendentes. O nível e a seed são congelados quando o ticket é concedido.
create table public.daily_tickets (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  day        date not null,
  game_id    text not null references public.games (id),
  slot       smallint not null check (slot >= 1 and slot <= public.max_scenarios()),
  level      smallint not null check (level >= 0),
  seed       bigint not null check (seed >= 0 and seed < 4294967296),
  created_at timestamptz not null default now(),
  primary key (user_id, day, game_id, slot)
);
create index daily_tickets_queue_idx on public.daily_tickets (user_id, game_id, day, slot);

-- Último dia em que os tickets foram concedidos (idempotência da concessão).
create table public.daily_grants (
  user_id  uuid not null references public.profiles (id) on delete cascade,
  game_id  text not null references public.games (id),
  last_day date not null,
  primary key (user_id, game_id)
);

-- Cenário compartilhado e imutável. `full_puzzle` inclui a solução e nunca vai ao navegador.
create table public.daily_scenarios (
  day         date not null,
  game_id     text not null references public.games (id),
  level       smallint not null check (level >= 0),
  slot        smallint not null check (slot >= 1 and slot <= public.max_scenarios()),
  seed        bigint not null check (seed >= 0 and seed < 4294967296),
  gen         int not null default 1,
  public_view jsonb not null,
  full_puzzle jsonb not null,
  created_at  timestamptz not null default now(),
  primary key (day, game_id, level, slot)
);

alter table public.daily_tickets   enable row level security;
alter table public.daily_grants    enable row level security;
alter table public.daily_scenarios enable row level security;
revoke all on public.daily_tickets   from anon, authenticated;
revoke all on public.daily_grants    from anon, authenticated;
revoke all on public.daily_scenarios from anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 3. Concessão: cria os tickets de cada dia (inclusive os dias pulados), com o nível atual congelado.
--    Chamada por `daily_status`/`daily_open`; é idempotente.
-- ---------------------------------------------------------------------------------------------------
create function public.daily_grant(p_uid uuid, p_game text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_today   date := public.daily_day();
  v_cap     int  := public.coins_cap();
  v_start   date;
  v_last    date;
  v_level   smallint;
  v_created date;
begin
  if p_uid is null then return; end if;
  if not exists (select 1 from public.games where id = p_game) then return; end if;

  select last_day into v_last from public.daily_grants where user_id = p_uid and game_id = p_game;

  if v_last is null then
    select (p.created_at at time zone 'America/Sao_Paulo')::date into v_created
      from public.profiles p where p.id = p_uid;
    if v_created is null then return; end if;
    v_start := greatest(v_created, public.daily_backlog_start(), v_today - (public.daily_backlog_days() - 1));
  else
    -- Repassa o último dia concedido para completar slots novos (se o limite diário aumentou).
    v_start := greatest(v_last, public.daily_backlog_start(), v_today - (public.daily_backlog_days() - 1));
  end if;

  if v_start <= v_today then
    v_level := public.level_for(p_uid, p_game);
    insert into public.daily_tickets (user_id, day, game_id, slot, level, seed)
    select p_uid, v_start + i, p_game, s, v_level,
           public.daily_seed(v_start + i, p_game, v_level, s)
      from generate_series(0, v_today - v_start) as i
      cross join generate_series(1, v_cap) as s
     where not exists (
             select 1 from public.daily_results r
              where r.user_id = p_uid and r.day = v_start + i and r.game_id = p_game and r.slot = s)
       and not exists (
             select 1 from public.daily_runs r
              where r.user_id = p_uid and r.day = v_start + i and r.game_id = p_game and r.slot = s)
    on conflict (user_id, day, game_id, slot) do nothing;
  end if;

  insert into public.daily_grants (user_id, game_id, last_day)
    values (p_uid, p_game, v_today)
    on conflict (user_id, game_id) do update
      set last_day = greatest(public.daily_grants.last_day, excluded.last_day);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Abrir um ticket: consome o ticket, começa o relógio e devolve a seed secreta + nível/slot/dia.
--    Se já existe uma tentativa aberta para o mesmo dia/slot, retoma sem reiniciar o relógio.
-- ---------------------------------------------------------------------------------------------------
create function public.daily_open(p_uid uuid, p_game text, p_slot int, p_day date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_today  date := public.daily_day();
  v_day    date := coalesce(p_day, v_today);
  v_cap    int  := public.coins_cap();
  v_coins  int;
  v_level  smallint;
  v_seed   bigint;
  v_run    public.daily_runs;
  v_ticket public.daily_tickets;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.games where id = p_game) then raise exception 'unknown_game' using errcode = '22023'; end if;
  if v_day > v_today then raise exception 'future_day' using errcode = '22023'; end if;
  if p_slot is null or p_slot < 1 or p_slot > public.max_scenarios() then raise exception 'bad_slot' using errcode = '22023'; end if;

  perform public.daily_grant(p_uid, p_game);

  select * into v_run from public.daily_runs
    where user_id = p_uid and day = v_day and game_id = p_game and slot = p_slot;
  if found then
    select count(*)::int into v_coins from public.daily_tickets
      where user_id = p_uid and game_id = p_game;
    return jsonb_build_object(
      'day', v_run.day, 'level', v_run.level, 'slot', v_run.slot, 'slots', v_cap, 'seed', v_run.seed,
      'startedAt', (extract(epoch from v_run.started_at) * 1000)::bigint,
      'coins', v_coins, 'resumed', true
    );
  end if;

  select * into v_ticket from public.daily_tickets
    where user_id = p_uid and day = v_day and game_id = p_game and slot = p_slot
    for update;
  if not found then raise exception 'no_coins' using errcode = '22023'; end if;

  v_level := v_ticket.level;
  v_seed  := v_ticket.seed;
  delete from public.daily_tickets
    where user_id = p_uid and day = v_day and game_id = p_game and slot = p_slot;

  insert into public.daily_runs (user_id, day, game_id, slot, level, seed, hints, started_at)
    values (p_uid, v_day, p_game, p_slot, v_level, v_seed, 0, now())
    on conflict (user_id, day, game_id, slot) do nothing;

  select * into v_run from public.daily_runs
    where user_id = p_uid and day = v_day and game_id = p_game and slot = p_slot;
  select count(*)::int into v_coins from public.daily_tickets
    where user_id = p_uid and game_id = p_game;

  return jsonb_build_object(
    'day', v_run.day, 'level', v_run.level, 'slot', v_run.slot, 'slots', v_cap, 'seed', v_run.seed,
    'startedAt', (extract(epoch from v_run.started_at) * 1000)::bigint,
    'coins', v_coins, 'resumed', false
  );
end $$;

-- Dica: só conta (a Edge decide QUAL dica); +30 s cada ao concluir.
create function public.daily_hint(p_uid uuid, p_game text, p_slot int, p_day date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_day   date := coalesce(p_day, public.daily_day());
  v_hints smallint;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  update public.daily_runs set hints = hints + 1
    where user_id = p_uid and day = v_day and game_id = p_game and slot = p_slot
    returning hints into v_hints;
  if v_hints is null then raise exception 'no_phase' using errcode = '22023'; end if;
  return jsonb_build_object('hints', v_hints);
end $$;

-- Tentativa aberta de um dia/slot (com a seed): só a Edge lê, para decidir a dica e validar o tabuleiro.
create function public.daily_run(p_uid uuid, p_game text, p_slot int, p_day date default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(r) from public.daily_runs r
  where r.user_id = p_uid and r.game_id = p_game and r.slot = p_slot
    and r.day = coalesce(p_day, public.daily_day())
$$;

-- ---------------------------------------------------------------------------------------------------
-- 5. Concluir um ticket: mede o tempo (+30 s por dica) e guarda o melhor por (dia, slot).
--    O resultado pertence ao dia do ticket/rascunho, não ao dia atual.
-- ---------------------------------------------------------------------------------------------------
create function public.daily_finish(p_uid uuid, p_game text, p_slot int, p_op uuid default null, p_day date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_day      date := coalesce(p_day, public.daily_day());
  v_run      public.daily_runs;
  v_seconds  int;
  v_level    smallint;
  v_coins    int;
  v_best     int;
  v_had      boolean;
  v_is_admin boolean;
  v_cap      int;
  v_points   int;
  v_wins     int;
  v_score    public.scores;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.games where id = p_game) then raise exception 'unknown_game' using errcode = '22023'; end if;

  select * into v_run from public.daily_runs
    where user_id = p_uid and day = v_day and game_id = p_game and slot = p_slot for update;

  if not found then
    -- Reenvio da mesma conclusão (fila/rede): devolve o que já está guardado para o dia/slot.
    select seconds, level into v_seconds, v_level
      from public.daily_results
     where user_id = p_uid and day = v_day and game_id = p_game and slot = p_slot;
    if found then
      select min(seconds) into v_best from public.daily_results
        where user_id = p_uid and day = v_day and game_id = p_game;
      select count(*)::int into v_coins from public.daily_tickets
        where user_id = p_uid and game_id = p_game;
      select * into v_score from public.scores where user_id = p_uid and game_id = p_game;
      return jsonb_build_object(
        'day', v_day, 'duplicate', true, 'seconds', v_seconds, 'best', v_best, 'coins', v_coins,
        'slots', public.coins_cap(),
        'wins', coalesce((select wins from public.game_progress where user_id = p_uid and game_id = p_game), 0),
        'score', jsonb_build_object('points', coalesce(v_score.points, 0), 'wins', coalesce(v_score.wins, 0), 'updatedAt', (extract(epoch from coalesce(v_score.updated_at, now())) * 1000)::bigint),
        'stats', public.daily_scenario_stats(p_uid, p_game, p_slot, v_level, (select region from public.profiles where id = p_uid), v_day)
      );
    end if;
    raise exception 'no_phase' using errcode = '22023';
  end if;

  v_seconds := greatest(0, floor(extract(epoch from (now() - v_run.started_at)))::int + public.daily_hint_seconds() * v_run.hints);
  select exists (
    select 1 from public.daily_results
     where user_id = p_uid and day = v_day and game_id = p_game and slot = p_slot
  ) into v_had;

  insert into public.daily_results (user_id, day, game_id, slot, level, hints, seconds, op_id, finished_at)
    values (p_uid, v_day, p_game, p_slot, v_run.level, v_run.hints, v_seconds, coalesce(p_op, gen_random_uuid()), now())
    on conflict (user_id, day, game_id, slot) do update
      set seconds     = least(public.daily_results.seconds, excluded.seconds),
          hints       = case when excluded.seconds < public.daily_results.seconds then excluded.hints else public.daily_results.hints end,
          level       = case when excluded.seconds < public.daily_results.seconds then excluded.level else public.daily_results.level end,
          op_id       = case when excluded.seconds < public.daily_results.seconds then excluded.op_id else public.daily_results.op_id end,
          finished_at = case when excluded.seconds < public.daily_results.seconds then now() else public.daily_results.finished_at end;

  -- Pontuação/progressão só na PRIMEIRA conclusão do slot no dia (reabrir para melhorar o tempo não pontua de novo).
  select exists (select 1 from public.profiles where id = p_uid and role = 'admin') into v_is_admin;
  if not v_had then
    insert into public.game_progress (user_id, game_id) values (p_uid, p_game) on conflict do nothing;
    update public.game_progress set wins = wins + 1, updated_at = now()
      where user_id = p_uid and game_id = p_game returning wins into v_wins;
    if not v_is_admin then
      v_points := public.daily_points(v_run.level, v_run.hints);
      insert into public.scores (user_id, game_id, points, wins, updated_at) values (p_uid, p_game, v_points, 1, now())
        on conflict (user_id, game_id) do update
          set points = public.scores.points + excluded.points, wins = public.scores.wins + 1, updated_at = now();
    end if;
  end if;

  delete from public.daily_runs where user_id = p_uid and day = v_day and game_id = p_game and slot = p_slot;

  select min(seconds) into v_best from public.daily_results
    where user_id = p_uid and day = v_day and game_id = p_game;
  select count(*)::int into v_coins from public.daily_tickets
    where user_id = p_uid and game_id = p_game;
  select * into v_score from public.scores where user_id = p_uid and game_id = p_game;
  return jsonb_build_object(
    'day', v_day, 'duplicate', false, 'seconds', v_seconds, 'best', v_best, 'coins', v_coins,
    'slots', public.coins_cap(),
    'wins', coalesce(v_wins, (select wins from public.game_progress where user_id = p_uid and game_id = p_game), 0),
    'score', jsonb_build_object('points', coalesce(v_score.points, 0), 'wins', coalesce(v_score.wins, 0), 'updatedAt', (extract(epoch from coalesce(v_score.updated_at, now())) * 1000)::bigint),
    'stats', public.daily_scenario_stats(p_uid, p_game, p_slot, v_run.level, (select region from public.profiles where id = p_uid), v_day)
  );
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 6. Troféus: estatísticas do cenário agora recebem o dia (o resultado pode ser de um ticket atrasado).
-- ---------------------------------------------------------------------------------------------------
create or replace function public.daily_scenario_stats(p_uid uuid, p_game text, p_slot int, p_level int, p_region text, p_day date default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  with cfg as (select coalesce(p_day, public.daily_day()) as day),
  base as (
    select d.user_id, d.seconds, d.hints, d.finished_at,
           public.daily_points(d.level, d.hints) as points,
           p.region,
           row_number() over (order by d.seconds asc, public.daily_points(d.level, d.hints) desc, d.finished_at asc, d.user_id) as rank_global,
           row_number() over (partition by case when p_region is not null and p.region = p_region then 1 else 0 end
                              order by d.seconds asc, public.daily_points(d.level, d.hints) desc, d.finished_at asc, d.user_id) as rank_region
    from public.daily_results d
    join public.profiles p on p.id = d.user_id
    cross join cfg
    where d.game_id = p_game and d.day = cfg.day and d.slot = p_slot and d.level = p_level
      and p.role <> 'admin'
  ),
  tot as (select count(*)::int as players, avg(seconds)::numeric as avg_seconds from base),
  mine as (select * from base where user_id = p_uid),
  reg as (select count(*)::int as players from base where p_region is not null and region = p_region)
  select case
    when (select players from tot) = 0 or not exists (select 1 from mine) then null
    else jsonb_build_object(
      'slot', p_slot,
      'level', p_level,
      'day', (select day from cfg),
      'seconds', (select seconds from mine),
      'hints',   (select hints from mine),
      'points',  (select points from mine),
      'players', (select players from tot),
      'avgSeconds', round((select avg_seconds from tot))::int,
      'rank', (select rank_global from mine),
      'percentile', case when (select players from tot) <= 1 then 100
                         else round(100.0 * ((select players from tot) - (select rank_global from mine)) / (select players from tot))::int end,
      'region', p_region,
      'regionPlayers', case when p_region is null then null else (select players from reg) end,
      'regionRank',    case when p_region is null then null else (select rank_region from mine) end
    )
  end
$$;

create or replace function public.daily_my_stats(p_uid uuid, p_game text, p_day date default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  with cfg as (select coalesce(p_day, public.daily_day()) as day),
  me as (
    select d.slot, d.level
    from public.daily_results d cross join cfg
    where d.user_id = p_uid and d.game_id = p_game and d.day = cfg.day
  ),
  reg as (select region from public.profiles where id = p_uid)
  select coalesce(jsonb_object_agg(m.slot::text,
           public.daily_scenario_stats(p_uid, p_game, m.slot, m.level, (select region from reg), (select day from cfg))), '{}'::jsonb)
  from me m
$$;

-- ---------------------------------------------------------------------------------------------------
-- 7. Status para o navegador: tickets pendentes, tentativas abertas, resultados de hoje e histórico.
--    Não expõe seed nem o puzzle completo.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.daily_status() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_today date := public.daily_day();
  v_cap   int  := public.coins_cap();
  v_out   jsonb;
begin
  if v_uid is null then return '{}'::jsonb; end if;

  perform public.daily_grant(v_uid, g.id) from public.games g;

  select coalesce(jsonb_object_agg(g.id, jsonb_build_object(
    'day',     v_today,
    'slots',   v_cap,
    'level',   least(array_length(public.points_per_level(), 1) - 1,
                     coalesce((select wins from public.game_progress where user_id = v_uid and game_id = g.id), 0) / public.wins_per_level()),
    'coins',   (select count(*)::int from public.daily_tickets t
                 where t.user_id = v_uid and t.game_id = g.id),
    'pending', coalesce((select jsonb_agg(jsonb_build_object('day', t.day, 'slot', t.slot, 'level', t.level) order by t.day, t.slot)
                          from public.daily_tickets t
                         where t.user_id = v_uid and t.game_id = g.id), '[]'::jsonb),
    'open',    coalesce((select jsonb_agg(jsonb_build_object('day', r.day, 'slot', r.slot, 'level', r.level) order by r.day, r.slot)
                          from public.daily_runs r
                         where r.user_id = v_uid and r.game_id = g.id), '[]'::jsonb),
    'results', coalesce((select jsonb_object_agg(d.slot::text, d.seconds)
                          from public.daily_results d
                         where d.user_id = v_uid and d.day = v_today and d.game_id = g.id), '{}'::jsonb),
    'history', coalesce((select jsonb_object_agg(x.day::text, x.slots)
                          from (select d.day, jsonb_object_agg(d.slot::text, d.seconds) as slots
                                  from public.daily_results d
                                 where d.user_id = v_uid and d.game_id = g.id
                                   and d.day >= v_today - (public.daily_backlog_days() - 1)
                                 group by d.day) x), '{}'::jsonb),
    'levels',  coalesce((select jsonb_object_agg(x.day::text, x.level)
                          from (select d.day, max(d.level) as level
                                  from public.daily_results d
                                 where d.user_id = v_uid and d.game_id = g.id
                                   and d.day >= v_today - (public.daily_backlog_days() - 1)
                                 group by d.day) x), '{}'::jsonb),
    'stats',   public.daily_my_stats(v_uid, g.id, v_today)
  )), '{}'::jsonb)
  into v_out
  from public.games g;

  return v_out;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 8. Ranking por tempo de (dia, jogo, nível). `p_day` é o dia do cenário (pode ser um ticket atrasado).
-- ---------------------------------------------------------------------------------------------------
create or replace function public.daily_leaderboard(p_game text, p_level int default null, p_scope text default 'global', p_limit int default 10, p_day date default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  with cfg as (
    select coalesce(p_day, public.daily_day()) as day,
           coalesce(p_level, least(array_length(public.points_per_level(), 1) - 1,
                    coalesce((select wins from public.game_progress where user_id = auth.uid() and game_id = p_game), 0) / public.wins_per_level())) as level
  ),
  best as (
    select d.user_id, d.seconds, d.hints, d.finished_at,
           public.daily_points(d.level, d.hints) as points,
           row_number() over (partition by d.user_id order by d.seconds asc, public.daily_points(d.level, d.hints) desc, d.finished_at asc) as rn
    from public.daily_results d, cfg
    where d.game_id = p_game and d.day = cfg.day and d.level = cfg.level
  ),
  filtered as (
    select b.user_id, coalesce(p.nickname, p.name) as name, p.avatar, p.region, b.seconds, b.hints, b.points, b.finished_at
    from best b join public.profiles p on p.id = b.user_id
    where b.rn = 1 and p.role <> 'admin'
      and (p_scope is distinct from 'region'
           or (p.region is not null and p.region = (select region from public.profiles where id = auth.uid())))
  ),
  ranked as (
    select f.*, row_number() over (order by f.seconds asc, f.points desc, f.finished_at asc, f.user_id) as rank,
           jsonb_build_object('id', f.user_id, 'name', f.name, 'avatar', f.avatar, 'region', f.region,
                              'seconds', f.seconds, 'hints', f.hints) as j
    from filtered f
  )
  select jsonb_build_object(
    'day', cfg.day,
    'top',   coalesce((select jsonb_agg(r.j || jsonb_build_object('rank', r.rank, 'isMe', r.user_id is not distinct from auth.uid()) order by r.rank)
                       from ranked r where r.rank <= least(greatest(coalesce(p_limit, 10), 1), 100)), '[]'::jsonb),
    'me',    (select r.j || jsonb_build_object('rank', r.rank, 'isMe', true) from ranked r where r.user_id = auth.uid()),
    'total', (select count(*) from ranked)
  )
  from cfg
$$;

-- ---------------------------------------------------------------------------------------------------
-- 9. Compatibilidade: o administrador continua com a ferramenta de teste, agora concedendo tickets.
--    p_coins vira a quantidade de dias de backlog (limitada ao teto de 30) a conceder.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.admin_grant_coins(p_email text, p_game text default null, p_coins int default 10)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_uid   uuid;
  v_name  text;
  v_today date := public.daily_day();
  v_days  int  := least(greatest(coalesce(p_coins, 0), 0), public.daily_backlog_days());
  v_cap   int  := public.coins_cap();
  v_games jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_email = '' then raise exception 'invalid_email' using errcode = '22023'; end if;
  if p_coins is null or p_coins < 0 or p_coins > 99999 then raise exception 'invalid_coins' using errcode = '22023'; end if;
  if p_game is not null and not exists (select 1 from public.games where id = p_game) then raise exception 'unknown_game' using errcode = '22023'; end if;

  select u.id, coalesce(p.nickname, p.name) into v_uid, v_name
    from auth.users u left join public.profiles p on p.id = u.id
   where lower(u.email) = v_email;
  if v_uid is null then raise exception 'unknown_user' using errcode = '22023'; end if;

  insert into public.daily_grants (user_id, game_id, last_day)
    select v_uid, g.id, v_today from public.games g where p_game is null or g.id = p_game
    on conflict (user_id, game_id) do update set last_day = greatest(public.daily_grants.last_day, excluded.last_day);

  insert into public.daily_tickets (user_id, day, game_id, slot, level, seed)
    select v_uid, v_today - i, g.id, s,
           public.level_for(v_uid, g.id),
           public.daily_seed(v_today - i, g.id, public.level_for(v_uid, g.id), s)
      from public.games g
      cross join generate_series(0, v_days - 1) as i
      cross join generate_series(1, v_cap) as s
     where (p_game is null or g.id = p_game)
       and not exists (select 1 from public.daily_results r
                        where r.user_id = v_uid and r.day = v_today - i and r.game_id = g.id and r.slot = s)
       and not exists (select 1 from public.daily_runs r
                        where r.user_id = v_uid and r.day = v_today - i and r.game_id = g.id and r.slot = s)
    on conflict (user_id, day, game_id, slot) do nothing;

  select jsonb_agg(g.id order by g.sort) into v_games
    from public.games g where p_game is null or g.id = p_game;

  return jsonb_build_object('email', v_email, 'name', v_name, 'day', v_today, 'coins', v_days, 'games', v_games);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 10. Cutover: converte os coins restantes de HOJE em tickets, sem retroagir dias antigos.
-- ---------------------------------------------------------------------------------------------------
insert into public.daily_grants (user_id, game_id, last_day)
  select user_id, game_id, public.daily_day()
    from public.daily_coins
   where day = public.daily_day()
  on conflict (user_id, game_id) do update
    set last_day = greatest(public.daily_grants.last_day, excluded.last_day);

insert into public.daily_tickets (user_id, day, game_id, slot, level, seed)
  select c.user_id, c.day, c.game_id, s.slot,
         public.level_for(c.user_id, c.game_id),
         public.daily_seed(c.day, c.game_id, public.level_for(c.user_id, c.game_id), s.slot)
    from public.daily_coins c
    cross join lateral (
      select x.slot
        from generate_series(1, public.coins_cap()) as x(slot)
       where not exists (select 1 from public.daily_results r
                          where r.user_id = c.user_id and r.day = c.day and r.game_id = c.game_id and r.slot = x.slot)
         and not exists (select 1 from public.daily_runs r
                          where r.user_id = c.user_id and r.day = c.day and r.game_id = c.game_id and r.slot = x.slot)
       order by x.slot
       limit c.coins
    ) s
   where c.day = public.daily_day()
  on conflict (user_id, day, game_id, slot) do nothing;

-- ---------------------------------------------------------------------------------------------------
-- 11. Permissões: tabelas só pela Edge; funções internas revogadas.
-- ---------------------------------------------------------------------------------------------------
revoke all on function public.daily_backlog_days() from public, anon, authenticated;
revoke all on function public.daily_backlog_start() from public, anon, authenticated;
revoke all on function public.daily_grant(uuid, text) from public, anon, authenticated;
revoke all on function public.daily_open(uuid, text, int, date) from public, anon, authenticated;
revoke all on function public.daily_hint(uuid, text, int, date) from public, anon, authenticated;
revoke all on function public.daily_finish(uuid, text, int, uuid, date) from public, anon, authenticated;
revoke all on function public.daily_run(uuid, text, int, date) from public, anon, authenticated;
revoke all on function public.daily_leaderboard(text, int, text, int, date) from public, anon, authenticated;
revoke all on function public.daily_scenario_stats(uuid, text, int, int, text, date) from public, anon, authenticated;
revoke all on function public.daily_my_stats(uuid, text, date) from public, anon, authenticated;
revoke all on function public.daily_status() from public, anon, authenticated;
revoke all on function public.admin_grant_coins(text, text, int) from public, anon, authenticated;

grant execute on function public.daily_open(uuid, text, int, date)          to service_role;
grant execute on function public.daily_hint(uuid, text, int, date)          to service_role;
grant execute on function public.daily_finish(uuid, text, int, uuid, date)  to service_role;
grant execute on function public.daily_run(uuid, text, int, date)           to service_role;
grant execute on function public.daily_grant(uuid, text)                    to service_role;
grant execute on function public.daily_scenario_stats(uuid, text, int, int, text, date) to service_role;
grant execute on function public.daily_my_stats(uuid, text, date)           to service_role;
grant execute on function public.daily_leaderboard(text, int, text, int, date) to anon, authenticated;
grant execute on function public.daily_status()                             to authenticated;
grant execute on function public.admin_grant_coins(text, text, int)          to authenticated;

-- As assinaturas antigas saem para não ficarem acessíveis/ambíguas.
drop function if exists public.daily_open(uuid, text, int);
drop function if exists public.daily_hint(uuid, text, int);
drop function if exists public.daily_finish(uuid, text, int, uuid);
drop function if exists public.daily_run(uuid, text, int);
drop function if exists public.daily_leaderboard(text, int, text, int);
drop function if exists public.daily_my_stats(uuid, text);
drop function if exists public.daily_scenario_stats(uuid, text, int, int, text);
