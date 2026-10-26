-- =====================================================================================================
-- WebMiniGames · troféus por palavras + tempo (Text Twist) e fim de rodada sem vitória
--
-- Como aplicar: Supabase > SQL Editor > cole este arquivo inteiro > Run (ou `supabase db push`).
-- Rode DEPOIS de 20261032000000_jogo_texttwist.sql.
--
-- O que muda:
--   * `daily_results` ganha `words` (quantas palavras o jogador achou) e `won` (se fechou a rodada
--     vencendo). Outros jogos continuam gravando `words = 0` e `won = true`, então nada muda para eles.
--   * `daily_finish` recebe `p_words` e `p_won`. Uma rodada que terminou pelo TEMPO entra no resultado
--     com `won = false` e NÃO pontua: só a vitória credita pontos/progressão.
--   * `daily_scenario_stats` ordena os troféus por `won`, depois `words` e só então `seconds` — o
--     "melhor do cenário" passa a ser quem venceu com mais palavras (e, no empate, em menos tempo).
--     O pódio (`top`) e a média também trazem as palavras.
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------------
-- 1. Colunas novas em daily_results
-- ---------------------------------------------------------------------------------------------------
alter table public.daily_results add column if not exists words smallint not null default 0 check (words >= 0);
alter table public.daily_results add column if not exists won   boolean  not null default true;

-- ---------------------------------------------------------------------------------------------------
-- 2. Concluir o ticket: mede o tempo, guarda palavras/vitória e só pontua quando venceu
-- ---------------------------------------------------------------------------------------------------
drop function if exists public.daily_finish(uuid, text, int, uuid, date);

create function public.daily_finish(
  p_uid uuid, p_game text, p_slot int,
  p_op uuid default null, p_day date default null,
  p_words int default 0, p_won boolean default true
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_day      date := coalesce(p_day, public.daily_day());
  v_run      public.daily_runs;
  v_old      public.daily_results;
  v_seconds  int;
  v_level    smallint;
  v_coins    int;
  v_best     int;
  v_had      boolean;
  v_is_admin boolean;
  v_points   int;
  v_wins     int;
  v_score    public.scores;
  v_words    smallint := greatest(0, coalesce(p_words, 0));
  v_won      boolean  := coalesce(p_won, true);
  v_better   boolean;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.games where id = p_game) then raise exception 'unknown_game' using errcode = '22023'; end if;

  select * into v_run from public.daily_runs
    where user_id = p_uid and day = v_day and game_id = p_game and slot = p_slot for update;

  if not found then
    -- Reenvio da mesma conclusão (fila/rede): devolve o que já está guardado para o dia/slot.
    select * into v_old from public.daily_results
      where user_id = p_uid and day = v_day and game_id = p_game and slot = p_slot;
    if found then
      select min(seconds) into v_best from public.daily_results
        where user_id = p_uid and day = v_day and game_id = p_game;
      select count(*)::int into v_coins from public.daily_tickets
        where user_id = p_uid and game_id = p_game;
      select * into v_score from public.scores where user_id = p_uid and game_id = p_game;
      return jsonb_build_object(
        'day', v_day, 'duplicate', true, 'seconds', v_old.seconds, 'best', v_best, 'coins', v_coins,
        'slots', public.coins_cap(), 'words', v_old.words, 'won', v_old.won,
        'wins', coalesce((select wins from public.game_progress where user_id = p_uid and game_id = p_game), 0),
        'score', jsonb_build_object('points', coalesce(v_score.points, 0), 'wins', coalesce(v_score.wins, 0), 'updatedAt', (extract(epoch from coalesce(v_score.updated_at, now())) * 1000)::bigint),
        'stats', public.daily_scenario_stats(p_uid, p_game, p_slot, v_old.level, (select region from public.profiles where id = p_uid), v_day)
      );
    end if;
    raise exception 'no_phase' using errcode = '22023';
  end if;

  v_seconds := greatest(0, floor(extract(epoch from (now() - v_run.started_at)))::int + public.daily_hint_seconds() * v_run.hints);

  select * into v_old from public.daily_results
    where user_id = p_uid and day = v_day and game_id = p_game and slot = p_slot;
  v_had := found;
  -- "Melhor" = venceu > achou mais palavras > terminou em menos tempo.
  v_better := not v_had or (v_won, v_words, -v_seconds) > (v_old.won, v_old.words, -v_old.seconds);

  insert into public.daily_results (user_id, day, game_id, slot, level, hints, seconds, words, won, op_id, finished_at)
    values (p_uid, v_day, p_game, p_slot, v_run.level, v_run.hints, v_seconds, v_words, v_won, coalesce(p_op, gen_random_uuid()), now())
  on conflict (user_id, day, game_id, slot) do update
    set seconds     = case when v_better then excluded.seconds else public.daily_results.seconds end,
        words       = case when v_better then excluded.words else public.daily_results.words end,
        won         = case when v_better then excluded.won else public.daily_results.won end,
        hints       = case when v_better then excluded.hints else public.daily_results.hints end,
        level       = case when v_better then excluded.level else public.daily_results.level end,
        op_id       = case when v_better then excluded.op_id else public.daily_results.op_id end,
        finished_at = case when v_better then now() else public.daily_results.finished_at end;

  -- Pontuação/progressão só na PRIMEIRA conclusão do slot E quando a rodada foi vencida.
  select exists (select 1 from public.profiles where id = p_uid and role = 'admin') into v_is_admin;
  if not v_had and v_won then
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
    'slots', public.coins_cap(), 'words', v_words, 'won', v_won,
    'wins', coalesce(v_wins, (select wins from public.game_progress where user_id = p_uid and game_id = p_game), 0),
    'score', jsonb_build_object('points', coalesce(v_score.points, 0), 'wins', coalesce(v_score.wins, 0), 'updatedAt', (extract(epoch from coalesce(v_score.updated_at, now())) * 1000)::bigint),
    'stats', public.daily_scenario_stats(p_uid, p_game, p_slot, v_run.level, (select region from public.profiles where id = p_uid), v_day)
  );
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 3. Troféus do cenário: ranking por vitória → palavras → tempo, com palavras na média e no pódio
-- ---------------------------------------------------------------------------------------------------
create or replace function public.daily_scenario_stats(p_uid uuid, p_game text, p_slot int, p_level int, p_region text, p_day date default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  with cfg as (select coalesce(p_day, public.daily_day()) as day),
  base as (
    select d.user_id, d.seconds, d.hints, d.words, d.won, d.finished_at,
           public.daily_points(d.level, d.hints) as points,
           p.region,
           coalesce(p.nickname, p.name) as name,
           p.avatar,
           row_number() over (order by d.won desc, d.words desc, d.seconds asc, public.daily_points(d.level, d.hints) desc, d.finished_at asc, d.user_id) as rank_global,
           row_number() over (partition by case when p_region is not null and p.region = p_region then 1 else 0 end
                              order by d.won desc, d.words desc, d.seconds asc, public.daily_points(d.level, d.hints) desc, d.finished_at asc, d.user_id) as rank_region
    from public.daily_results d
    join public.profiles p on p.id = d.user_id
    cross join cfg
    where d.game_id = p_game and d.day = cfg.day and d.slot = p_slot and d.level = p_level
      and p.role <> 'admin'
  ),
  tot as (select count(*)::int as players, avg(seconds)::numeric as avg_seconds,
                 avg(case when p_game = 'texttwist' then words end)::numeric as avg_words from base),
  mine as (select * from base where user_id = p_uid),
  reg as (select count(*)::int as players from base where p_region is not null and region = p_region)
  select case
    when (select players from tot) = 0 or not exists (select 1 from mine) then null
    else jsonb_build_object(
      'slot', p_slot,
      'level', p_level,
      'day', (select day from cfg),
      'seconds', (select seconds from mine),
      'words',   (select words from mine),
      'won',     (select won from mine),
      'hints',   (select hints from mine),
      'points',  (select points from mine),
      'players', (select players from tot),
      'avgSeconds', round((select avg_seconds from tot))::int,
      'avgWords',   round((select avg_words from tot))::int,
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
          'seconds', b.seconds,
          'words', b.words,
          'won', b.won
        ) order by b.rank_global)
        from base b
        where b.rank_global <= 3
      ), '[]'::jsonb)
    )
  end
$$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Permissões (só a Edge escreve; as leituras continuam como estavam)
-- ---------------------------------------------------------------------------------------------------
revoke all on function public.daily_finish(uuid, text, int, uuid, date, int, boolean) from public, anon, authenticated;
grant execute on function public.daily_finish(uuid, text, int, uuid, date, int, boolean) to service_role;
revoke all on function public.daily_scenario_stats(uuid, text, int, int, text, date) from public, anon, authenticated;
grant execute on function public.daily_scenario_stats(uuid, text, int, int, text, date) to service_role;
