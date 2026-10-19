-- =====================================================================================================
-- WebMiniGames · troféus do cenário diário (percentual, média do dia e posição regional)
--
-- Como aplicar: Supabase > SQL Editor > cole este arquivo inteiro > Run (ou `supabase db push`).
-- Rode DEPOIS de 20261021000000_desafio_diario.sql e 20261022000000_diario_configuravel.sql.
--
-- O que muda:
--   * Depois de vencer um cenário do dia, o jogador vê "troféus": em que percentual de jogadores ele ficou,
--     se ficou acima/abaixo da média de tempo do dia e em que posição está na sua REGIÃO — sempre sobre o
--     MESMO cenário (dia, jogo, nível e slot), que é o mesmo tabuleiro para todos do mesmo nível.
--   * Critério: MENOR TEMPO; empate desempata por MAIS PONTOS (menos dicas) e, depois, por quem terminou antes.
--     Os pontos do cenário usam a mesma conta do `daily_finish` (base do nível − dicas, mínimo 1).
--   * Nada de novo é exposto ao cliente: só números agregados e os dados do próprio jogador (nunca a lista de
--     adversários). Administradores ficam de fora (sandbox), como no ranking.
--   * `daily_status` e `daily_finish` passam a devolver os troféus por slot; o ranking do dia ganha o desempate
--     por pontos para ficar igual ao critério dos troféus.
-- =====================================================================================================

-- Índice para montar as estatísticas de um cenário (dia, jogo, nível e slot).
create index if not exists daily_results_scenario_idx on public.daily_results (day, game_id, level, slot);

-- ---------------------------------------------------------------------------------------------------
-- 1. Pontos do cenário (mesma conta do daily_finish): base do nível − dicas, nunca menos que 1.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.daily_points(p_level int, p_hints int) returns int
language sql immutable set search_path = '' as $$
  with c as (
    select (public.points_per_level())[
             least(greatest(coalesce(p_level, 0), 0), array_length(public.points_per_level(), 1) - 1) + 1
           ] as cap
  )
  select greatest(1, cap - least(greatest(coalesce(p_hints, 0), 0), cap - 1)) from c
$$;

-- ---------------------------------------------------------------------------------------------------
-- 2. Estatísticas de UM cenário (dia, jogo, nível, slot) para um jogador:
--    posição global, percentual de quem ele superou, média de tempo do dia e posição na região dele.
--    Só números do próprio jogador e contagens/tempos agregados dos outros.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.daily_scenario_stats(p_uid uuid, p_game text, p_slot int, p_level int, p_region text)
returns jsonb language sql stable security definer set search_path = '' as $$
  with cfg as (select public.daily_day() as day),
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

-- Todos os troféus do jogador no dia, por slot ({ "1": {…}, "2": {…} }).
create or replace function public.daily_my_stats(p_uid uuid, p_game text) returns jsonb
language sql stable security definer set search_path = '' as $$
  with cfg as (select public.daily_day() as day),
  me as (
    select d.slot, d.level
    from public.daily_results d cross join cfg
    where d.user_id = p_uid and d.game_id = p_game and d.day = cfg.day
  ),
  reg as (select region from public.profiles where id = p_uid)
  select coalesce(jsonb_object_agg(m.slot::text,
           public.daily_scenario_stats(p_uid, p_game, m.slot, m.level, (select region from reg))), '{}'::jsonb)
  from me m
$$;

-- ---------------------------------------------------------------------------------------------------
-- 3. Status do dia: acrescenta os troféus (stats) por jogo, para o quadro do cenário já vir decorado.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.daily_status() returns jsonb language sql stable security definer set search_path = '' as $$
  with cfg as (select public.daily_day() as day, public.coins_cap() as cap)
  select coalesce(jsonb_object_agg(g.id, jsonb_build_object(
    'day',     cfg.day,
    'slots',   cfg.cap,
    'level',   least(array_length(public.points_per_level(), 1) - 1,
                     coalesce((select wins from public.game_progress where user_id = auth.uid() and game_id = g.id), 0) / public.wins_per_level()),
    'coins',   coalesce((select coins from public.daily_coins c where c.user_id = auth.uid() and c.day = cfg.day and c.game_id = g.id),
                        case when exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') then public.admin_coins() else cfg.cap end),
    'results', coalesce((select jsonb_object_agg(d.slot::text, d.seconds) from public.daily_results d
                         where d.user_id = auth.uid() and d.day = cfg.day and d.game_id = g.id), '{}'::jsonb),
    'open',    coalesce((select jsonb_agg(r.slot) from public.daily_runs r
                         where r.user_id = auth.uid() and r.day = cfg.day and r.game_id = g.id), '[]'::jsonb),
    'stats',   public.daily_my_stats(auth.uid(), g.id)
  )), '{}'::jsonb)
  from public.games g, cfg
  where auth.uid() is not null
$$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Concluir o cenário do dia: igual à versão anterior, agora devolvendo também os troféus do slot.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.daily_finish(p_uid uuid, p_game text, p_slot int, p_op uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_day      date := public.daily_day();
  v_run      public.daily_runs;
  v_seconds  int;
  v_coins    int;
  v_best     int;
  v_had      boolean;
  v_is_admin boolean;
  v_cap      int;
  v_points   int;
  v_wins     int;
  v_level    smallint;
  v_score    public.scores;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.games where id = p_game) then raise exception 'unknown_game' using errcode = '22023'; end if;

  select * into v_run from public.daily_runs where user_id = p_uid and day = v_day and game_id = p_game and slot = p_slot for update;
  if not found then
    -- Reenvio da mesma conclusão (fila/rede): devolve o que já está guardado para o slot.
    select seconds, level into v_seconds, v_level from public.daily_results where user_id = p_uid and day = v_day and game_id = p_game and slot = p_slot;
    if found then
      select min(seconds) into v_best from public.daily_results where user_id = p_uid and day = v_day and game_id = p_game;
      select coins into v_coins from public.daily_coins where user_id = p_uid and day = v_day and game_id = p_game;
      select * into v_score from public.scores where user_id = p_uid and game_id = p_game;
      return jsonb_build_object(
        'duplicate', true, 'seconds', v_seconds, 'best', v_best, 'coins', coalesce(v_coins, 0), 'slots', public.coins_cap(),
        'wins', coalesce((select wins from public.game_progress where user_id = p_uid and game_id = p_game), 0),
        'score', jsonb_build_object('points', coalesce(v_score.points, 0), 'wins', coalesce(v_score.wins, 0), 'updatedAt', (extract(epoch from coalesce(v_score.updated_at, now())) * 1000)::bigint),
        'stats', public.daily_scenario_stats(p_uid, p_game, p_slot, v_level, (select region from public.profiles where id = p_uid))
      );
    end if;
    raise exception 'no_phase' using errcode = '22023';                                    -- tentativa inexistente/já consumida
  end if;

  v_seconds := greatest(0, floor(extract(epoch from (now() - v_run.started_at)))::int + public.daily_hint_seconds() * v_run.hints);
  select exists (select 1 from public.daily_results where user_id = p_uid and day = v_day and game_id = p_game and slot = p_slot) into v_had;

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
    update public.game_progress set wins = wins + 1, updated_at = now() where user_id = p_uid and game_id = p_game returning wins into v_wins;
    if not v_is_admin then
      v_points := public.daily_points(v_run.level, v_run.hints);
      insert into public.scores (user_id, game_id, points, wins, updated_at) values (p_uid, p_game, v_points, 1, now())
        on conflict (user_id, game_id) do update
          set points = public.scores.points + excluded.points, wins = public.scores.wins + 1, updated_at = now();
    end if;
  end if;

  delete from public.daily_runs where user_id = p_uid and day = v_day and game_id = p_game and slot = p_slot;

  select min(seconds) into v_best from public.daily_results where user_id = p_uid and day = v_day and game_id = p_game;
  select coins into v_coins from public.daily_coins where user_id = p_uid and day = v_day and game_id = p_game;
  select * into v_score from public.scores where user_id = p_uid and game_id = p_game;
  return jsonb_build_object(
    'duplicate', false, 'seconds', v_seconds, 'best', v_best, 'coins', coalesce(v_coins, 0), 'slots', public.coins_cap(),
    'wins', coalesce(v_wins, (select wins from public.game_progress where user_id = p_uid and game_id = p_game), 0),
    'score', jsonb_build_object('points', coalesce(v_score.points, 0), 'wins', coalesce(v_score.wins, 0), 'updatedAt', (extract(epoch from coalesce(v_score.updated_at, now())) * 1000)::bigint),
    'stats', public.daily_scenario_stats(p_uid, p_game, p_slot, v_run.level, (select region from public.profiles where id = p_uid))
  );
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 5. Ranking por tempo do dia: mesmo critério dos troféus (menor tempo; desempate por mais pontos).
-- ---------------------------------------------------------------------------------------------------
create or replace function public.daily_leaderboard(p_game text, p_level int default null, p_scope text default 'global', p_limit int default 10) returns jsonb
language sql stable security definer set search_path = '' as $$
  with cfg as (
    select public.daily_day() as day,
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
    'top',   coalesce((select jsonb_agg(r.j || jsonb_build_object('rank', r.rank, 'isMe', r.user_id is not distinct from auth.uid()) order by r.rank)
                       from ranked r where r.rank <= least(greatest(coalesce(p_limit, 10), 1), 100)), '[]'::jsonb),
    'me',    (select r.j || jsonb_build_object('rank', r.rank, 'isMe', true) from ranked r where r.user_id = auth.uid()),
    'total', (select count(*) from ranked)
  )
$$;

-- ---------------------------------------------------------------------------------------------------
-- 6. Permissões: as funções de cálculo são internas (usadas dentro de security definer já autorizadas).
-- ---------------------------------------------------------------------------------------------------
revoke all on function public.daily_points(int, int) from public, anon, authenticated;
revoke all on function public.daily_scenario_stats(uuid, text, int, int, text) from public, anon, authenticated;
revoke all on function public.daily_my_stats(uuid, text) from public, anon, authenticated;
grant execute on function public.daily_points(int, int) to service_role;
grant execute on function public.daily_scenario_stats(uuid, text, int, int, text) to service_role;
grant execute on function public.daily_my_stats(uuid, text) to service_role;
