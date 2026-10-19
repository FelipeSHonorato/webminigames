-- =====================================================================================================
-- WebMiniGames · desafio diário (mesmo cenário do dia para todos, ranking por TEMPO)
--
-- Como aplicar: Supabase > SQL Editor > cole este arquivo inteiro > Run (ou `supabase db push`).
-- Rode DEPOIS de 20261014000000_init.sql, 20261018000000_phase_runs.sql, 20261019000000_serve_phase.sql
-- e 20261020000000_admin_sem_pontos.sql.
--
-- Como funciona:
--   * O dia é o de Brasília: `daily_day()` = (now() at time zone 'America/Sao_Paulo')::date. À meia-noite o "dia" vira e os
--     2 coins do dia recomeçam sozinhos (não há cron: o placar do dia é contado por `day`).
--   * Cada jogo tem 2 tabuleiros por dia (`slot` 1 e 2), um por coin. O cenário é o MESMO para todos que estão no mesmo
--     NÍVEL: a seed deriva de (dia, jogo, nível, slot) e por isso não precisa ser guardada nem pré-gerada.
--   * `daily_open` cobra 1 coin, começa o relógio (started_at no SERVIDOR) e devolve a seed secreta para a Edge gerar o
--     PUZZLE PÚBLICO (sem solução). A seed nunca vai ao navegador.
--   * `daily_finish` mede o tempo no Postgres (now() − started_at) e soma 30 s por dica. Guarda o MELHOR tempo por slot;
--     o tempo do dia é o melhor entre os slots concluídos.
--   * Quem abre e não termina perde o coin: nada é registrado para o slot.
--   * O ranking é por (dia, jogo, nível) e por TEMPO (menor primeiro); o ranking por PONTOS continua igual (função ranking).
--
-- Deploy (CLI): `supabase functions deploy play`.
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------------
-- 1. Constantes e relógio do desafio
-- ---------------------------------------------------------------------------------------------------
create function public.daily_day() returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

-- Segundos somados ao tempo por cada dica usada.
create function public.daily_hint_seconds() returns int language sql immutable set search_path = '' as $$ select 30 $$;

-- Seed do cenário do dia: MESMA para todos os jogadores do mesmo nível (determinística, cabe num inteiro de 32 bits).
create function public.daily_seed(p_day date, p_game text, p_level int, p_slot int) returns bigint
language sql immutable set search_path = '' as $$
  select hashtextextended(p_day::text || '|' || p_game || '|' || p_level::text || '|' || p_slot::text, 0) & 4294967295
$$;

-- ---------------------------------------------------------------------------------------------------
-- 2. Tabelas (só as funções escrevem: nenhum papel do navegador tem acesso)
-- ---------------------------------------------------------------------------------------------------

-- Coins do dia (2, ou o limite do administrador), por jogo. A linha nasce no primeiro `daily_open` do dia.
create table public.daily_coins (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day     date not null,
  game_id text not null references public.games (id),
  coins   int  not null check (coins >= 0),
  primary key (user_id, day, game_id)
);

-- Tentativa aberta: guarda a seed secreta e o início do relógio. Reabrir o mesmo slot reinicia e cobra outro coin.
create table public.daily_runs (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  day        date not null,
  game_id    text not null references public.games (id),
  slot       smallint not null check (slot >= 1 and slot <= 2),
  level      smallint not null check (level >= 0),
  seed       bigint not null check (seed >= 0 and seed < 4294967296),
  hints      smallint not null default 0,
  started_at timestamptz not null default now(),
  primary key (user_id, day, game_id, slot)
);

-- Melhor resultado por slot: o tempo do dia é o menor entre os slots concluídos.
create table public.daily_results (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  day         date not null,
  game_id     text not null references public.games (id),
  slot        smallint not null check (slot >= 1 and slot <= 2),
  level       smallint not null check (level >= 0),
  hints       smallint not null default 0,
  seconds     int not null check (seconds >= 0),
  op_id       uuid not null default gen_random_uuid(),
  finished_at timestamptz not null default now(),
  primary key (user_id, day, game_id, slot)
);
create index daily_results_board_idx on public.daily_results (day, game_id, level, seconds);

alter table public.daily_coins   enable row level security;
alter table public.daily_runs    enable row level security;
alter table public.daily_results enable row level security;
revoke all on public.daily_coins   from anon, authenticated;
revoke all on public.daily_runs    from anon, authenticated;
revoke all on public.daily_results from anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 3. Abrir o tabuleiro do dia: cobra 1 coin e devolve a seed secreta (só a Edge vê) + nível/slot/coins.
-- ---------------------------------------------------------------------------------------------------
create function public.daily_open(p_uid uuid, p_game text, p_slot int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_day   date := public.daily_day();
  v_cap   int;
  v_coins int;
  v_level smallint;
  v_seed  bigint;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.games where id = p_game) then raise exception 'unknown_game' using errcode = '22023'; end if;
  if p_slot is null or p_slot < 1 or p_slot > 2 then raise exception 'bad_slot' using errcode = '22023'; end if;

  v_cap := case when exists (select 1 from public.profiles where id = p_uid and role = 'admin') then public.admin_coins() else public.coins_per_day() end;
  insert into public.daily_coins (user_id, day, game_id, coins) values (p_uid, v_day, p_game, v_cap) on conflict do nothing;
  select coins into v_coins from public.daily_coins where user_id = p_uid and day = v_day and game_id = p_game for update;
  if v_coins <= 0 then raise exception 'no_coins' using errcode = '22023'; end if;         -- acabaram os coins do dia

  v_level := public.level_for(p_uid, p_game);
  v_seed  := public.daily_seed(v_day, p_game, v_level, p_slot);

  update public.daily_coins set coins = coins - 1 where user_id = p_uid and day = v_day and game_id = p_game;
  insert into public.daily_runs (user_id, day, game_id, slot, level, seed, hints, started_at)
    values (p_uid, v_day, p_game, p_slot, v_level, v_seed, 0, now())
    on conflict (user_id, day, game_id, slot) do update
      set level = excluded.level, seed = excluded.seed, hints = 0, started_at = now();

  return jsonb_build_object(
    'day', v_day, 'level', v_level, 'slot', p_slot, 'seed', v_seed,
    'startedAt', (extract(epoch from now()) * 1000)::bigint,
    'coins', (select coins from public.daily_coins where user_id = p_uid and day = v_day and game_id = p_game)
  );
end $$;

-- Dica do dia: só conta (a Edge decide QUAL dica, com a lógica do jogo); +30 s cada ao concluir.
create function public.daily_hint(p_uid uuid, p_game text, p_slot int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_hints smallint;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  update public.daily_runs set hints = hints + 1
    where user_id = p_uid and day = public.daily_day() and game_id = p_game and slot = p_slot
    returning hints into v_hints;
  if v_hints is null then raise exception 'no_phase' using errcode = '22023'; end if;
  return jsonb_build_object('hints', v_hints);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Concluir o tabuleiro do dia (já validado pela Edge): mede o tempo (+30 s por dica) e guarda o melhor por slot.
--    Não gasta coin (o coin foi cobrado ao abrir) e NÃO mexe em pontos: é ranking por TEMPO.
-- ---------------------------------------------------------------------------------------------------
create function public.daily_finish(p_uid uuid, p_game text, p_slot int, p_op uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_day     date := public.daily_day();
  v_op      uuid := coalesce(p_op, gen_random_uuid());
  v_run     public.daily_runs;
  v_seconds int;
  v_coins   int;
  v_best    int;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.games where id = p_game) then raise exception 'unknown_game' using errcode = '22023'; end if;

  select * into v_run from public.daily_runs where user_id = p_uid and day = v_day and game_id = p_game and slot = p_slot for update;
  if not found then
    -- Reenvio da mesma vitória (fila/rede): devolve o que já está guardado para o slot.
    select seconds into v_seconds from public.daily_results where user_id = p_uid and day = v_day and game_id = p_game and slot = p_slot;
    if found then
      select min(seconds) into v_best from public.daily_results where user_id = p_uid and day = v_day and game_id = p_game;
      select coins into v_coins from public.daily_coins where user_id = p_uid and day = v_day and game_id = p_game;
      return jsonb_build_object('duplicate', true, 'seconds', v_seconds, 'best', v_best, 'coins', coalesce(v_coins, 0));
    end if;
    raise exception 'no_phase' using errcode = '22023';                                    -- tentativa inexistente/já consumida
  end if;

  v_seconds := greatest(0, floor(extract(epoch from (now() - v_run.started_at)))::int + public.daily_hint_seconds() * v_run.hints);

  insert into public.daily_results (user_id, day, game_id, slot, level, hints, seconds, op_id, finished_at)
    values (p_uid, v_day, p_game, p_slot, v_run.level, v_run.hints, v_seconds, v_op, now())
    on conflict (user_id, day, game_id, slot) do update
      set seconds     = least(public.daily_results.seconds, excluded.seconds),
          hints       = case when excluded.seconds < public.daily_results.seconds then excluded.hints else public.daily_results.hints end,
          level       = case when excluded.seconds < public.daily_results.seconds then excluded.level else public.daily_results.level end,
          op_id       = case when excluded.seconds < public.daily_results.seconds then excluded.op_id else public.daily_results.op_id end,
          finished_at = case when excluded.seconds < public.daily_results.seconds then now() else public.daily_results.finished_at end;

  delete from public.daily_runs where user_id = p_uid and day = v_day and game_id = p_game and slot = p_slot;

  select min(seconds) into v_best from public.daily_results where user_id = p_uid and day = v_day and game_id = p_game;
  select coins into v_coins from public.daily_coins where user_id = p_uid and day = v_day and game_id = p_game;
  return jsonb_build_object('duplicate', false, 'seconds', v_seconds, 'best', v_best, 'coins', coalesce(v_coins, 0));
end $$;

-- Tentativa aberta de HOJE deste slot (com a seed): só a Edge lê, para decidir a dica e validar o tabuleiro.
create function public.daily_run(p_uid uuid, p_game text, p_slot int) returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(r) from public.daily_runs r
  where r.user_id = p_uid and r.game_id = p_game and r.slot = p_slot and r.day = public.daily_day()
$$;

-- ---------------------------------------------------------------------------------------------------
-- 5. Status do dia para o navegador (não expõe seed): coins, resultados e slots já concluídos.
-- ---------------------------------------------------------------------------------------------------
create function public.daily_status() returns jsonb language sql stable security definer set search_path = '' as $$
  with cfg as (select public.daily_day() as day)
  select coalesce(jsonb_object_agg(g.id, jsonb_build_object(
    'day',     cfg.day,
    'level',   least(array_length(public.points_per_level(), 1) - 1,
                     coalesce((select wins from public.game_progress where user_id = auth.uid() and game_id = g.id), 0) / public.wins_per_level()),
    'coins',   coalesce((select coins from public.daily_coins c where c.user_id = auth.uid() and c.day = cfg.day and c.game_id = g.id),
                        case when exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') then public.admin_coins() else public.coins_per_day() end),
    'results', coalesce((select jsonb_object_agg(d.slot::text, d.seconds) from public.daily_results d
                         where d.user_id = auth.uid() and d.day = cfg.day and d.game_id = g.id), '{}'::jsonb),
    'open',    coalesce((select jsonb_agg(r.slot) from public.daily_runs r
                         where r.user_id = auth.uid() and r.day = cfg.day and r.game_id = g.id), '[]'::jsonb)
  )), '{}'::jsonb)
  from public.games g, cfg
  where auth.uid() is not null
$$;

-- ---------------------------------------------------------------------------------------------------
-- 6. Ranking por tempo de (dia, jogo, nível). Qualquer um vê (inclusive anônimo), como o ranking de pontos.
--    O nível é o de quem pergunta, se não vier p_level. Desempate: quem fez o tempo mais cedo. Sem administradores.
-- ---------------------------------------------------------------------------------------------------
create function public.daily_leaderboard(p_game text, p_level int default null, p_scope text default 'global', p_limit int default 10) returns jsonb
language sql stable security definer set search_path = '' as $$
  with cfg as (
    select public.daily_day() as day,
           coalesce(p_level, least(array_length(public.points_per_level(), 1) - 1,
                    coalesce((select wins from public.game_progress where user_id = auth.uid() and game_id = p_game), 0) / public.wins_per_level())) as level
  ),
  best as (
    select d.user_id, d.seconds, d.hints, d.finished_at,
           row_number() over (partition by d.user_id order by d.seconds asc, d.finished_at asc) as rn
    from public.daily_results d, cfg
    where d.game_id = p_game and d.day = cfg.day and d.level = cfg.level
  ),
  filtered as (
    select b.user_id, coalesce(p.nickname, p.name) as name, p.avatar, p.region, b.seconds, b.hints, b.finished_at
    from best b join public.profiles p on p.id = b.user_id
    where b.rn = 1 and p.role <> 'admin'
      and (p_scope is distinct from 'region'
           or (p.region is not null and p.region = (select region from public.profiles where id = auth.uid())))
  ),
  ranked as (
    select f.*, row_number() over (order by f.seconds asc, f.finished_at asc, f.user_id) as rank,
           jsonb_build_object('id', f.user_id, 'name', f.name, 'avatar', f.avatar, 'region', f.region,
                              'seconds', f.seconds, 'hints', f.hints) as j
    from filtered f
  )
  select jsonb_build_object(
    'top',   coalesce((select jsonb_agg(r.j || jsonb_build_object('rank', r.rank, 'isMe', r.user_id is not distinct from auth.uid()) order by r.rank)
                       from ranked r where r.rank <= least(greatest(coalesce(p_limit, 10), 1), 100)), '[]'::jsonb),
    'me',    (select r.j || jsonb_build_object('rank', r.rank, 'isMe', true) from ranked r where r.user_id = auth.uid()),
    'total', (select count(*) from ranked)
  )
$$;

-- ---------------------------------------------------------------------------------------------------
-- 7. Permissões: escrever a fase é só da Edge (service_role); ler o ranking/status é de todos.
-- ---------------------------------------------------------------------------------------------------
revoke all on function public.daily_open(uuid, text, int)          from public, anon, authenticated;
revoke all on function public.daily_hint(uuid, text, int)          from public, anon, authenticated;
revoke all on function public.daily_finish(uuid, text, int, uuid)  from public, anon, authenticated;
revoke all on function public.daily_run(uuid, text, int)           from public, anon, authenticated;
revoke all on function public.daily_leaderboard(text, int, text, int) from public, anon, authenticated;
revoke all on function public.daily_status()                       from public, anon, authenticated;
revoke all on function public.daily_day()                          from public, anon, authenticated;
revoke all on function public.daily_seed(date, text, int, int)     from public, anon, authenticated;
revoke all on function public.daily_hint_seconds()                 from public, anon, authenticated;

grant execute on function public.daily_open(uuid, text, int)          to service_role;
grant execute on function public.daily_hint(uuid, text, int)          to service_role;
grant execute on function public.daily_finish(uuid, text, int, uuid)  to service_role;
grant execute on function public.daily_run(uuid, text, int)           to service_role;
grant execute on function public.daily_leaderboard(text, int, text, int) to anon, authenticated;
grant execute on function public.daily_status()                       to authenticated;
