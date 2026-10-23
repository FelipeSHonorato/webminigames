-- =====================================================================================================
-- WebMiniGames · troféus do cenário: os três melhores tempos com foto
--
-- Como aplicar: Supabase > SQL Editor > cole este arquivo inteiro > Run (ou `supabase db push`).
-- Rode DEPOIS de 20261027000000_daily_fluxo.sql.
--
-- O que muda:
--   * `daily_scenario_stats` passa a devolver `top`: os três melhores tempos do mesmo cenário
--     (dia, jogo, nível e slot), com id, apelido, avatar e segundos. O administrador continua fora.
--   * A janela de troféus usa essa lista para o pódio dourado/prata/bronze abaixo dos três cartões.
-- =====================================================================================================

create or replace function public.daily_scenario_stats(p_uid uuid, p_game text, p_slot int, p_level int, p_region text, p_day date default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  with cfg as (select coalesce(p_day, public.daily_day()) as day),
  base as (
    select d.user_id, d.seconds, d.hints, d.finished_at,
           public.daily_points(d.level, d.hints) as points,
           p.region,
           coalesce(p.nickname, p.name) as name,
           p.avatar,
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
      'regionRank',    case when p_region is null then null else (select rank_region from mine) end,
      'top', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', b.user_id,
          'name', b.name,
          'avatar', b.avatar,
          'seconds', b.seconds
        ) order by b.rank_global)
        from base b
        where b.rank_global <= 3
      ), '[]'::jsonb)
    )
  end
$$;

revoke all on function public.daily_scenario_stats(uuid, text, int, int, text, date) from public, anon, authenticated;
grant execute on function public.daily_scenario_stats(uuid, text, int, int, text, date) to service_role;
