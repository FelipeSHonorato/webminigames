-- =====================================================================================================
-- WebMiniGames · fluxo diário: fila em sequência e teto real de 30 dias
--
-- Como aplicar: Supabase > SQL Editor > cole este arquivo inteiro > Run (ou `supabase db push`).
-- Rode DEPOIS de 20261026000001_daily_backlog_hoje.sql.
--
-- O que muda:
--   * O teto de 30 dias passa a valer também para tickets antigos que já estavam na fila: quem fica
--     muito tempo sem entrar perde os dias mais velhos e fica com, no máximo, 30 dias (2 por dia).
--   * `daily_status` informa `maxCoins` (30 × tickets por dia), para o selo do jogo mostrar o teto certo.
--   * A Edge pode ler `daily_seed` para pré-gerar os cenários do dia (todos os níveis e slots) sem
--     depender do ticket de um jogador.
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------------
-- 1. Concessão: descarta a fila mais velha que o teto e mantém a sequência dia → slot.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.daily_grant(p_uid uuid, p_game text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_today   date := public.daily_day();
  v_cap     int  := public.coins_cap();
  v_cutoff  date := public.daily_day() - (public.daily_backlog_days() - 1);
  v_start   date;
  v_last    date;
  v_level   smallint;
  v_created date;
begin
  if p_uid is null then return; end if;
  if not exists (select 1 from public.games where id = p_game) then return; end if;

  -- O teto é de 30 dias de cenários. Tentativas abertas também expiram: não adianta retomar um
  -- cenário de 40 dias atrás quando o jogador volta.
  delete from public.daily_tickets
   where user_id = p_uid and game_id = p_game and day < v_cutoff;
  delete from public.daily_runs
   where user_id = p_uid and game_id = p_game and day < v_cutoff;

  -- Se o administrador reduziu os tickets por dia, os slots que deixaram de existir também saem.
  delete from public.daily_tickets
   where user_id = p_uid and game_id = p_game and slot > v_cap;
  delete from public.daily_runs
   where user_id = p_uid and game_id = p_game and slot > v_cap;

  select last_day into v_last from public.daily_grants where user_id = p_uid and game_id = p_game;

  if v_last is null then
    select (p.created_at at time zone 'America/Sao_Paulo')::date into v_created
      from public.profiles p where p.id = p_uid;
    if v_created is null then return; end if;
    v_start := greatest(v_created, public.daily_backlog_start(), v_cutoff);
  else
    -- Repassa o último dia concedido para completar slots novos (se o limite diário aumentou).
    v_start := greatest(v_last, public.daily_backlog_start(), v_cutoff);
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
-- 2. Status: fila, tentativas abertas, histórico e o teto acumulável (30 dias × tickets/dia).
--    O navegador não vê seed nem o puzzle completo.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.daily_status() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_today   date := public.daily_day();
  v_cap     int  := public.coins_cap();
  v_cutoff  date := public.daily_day() - (public.daily_backlog_days() - 1);
  v_max     int  := public.daily_backlog_days() * v_cap;
  v_out     jsonb;
begin
  if v_uid is null then return '{}'::jsonb; end if;

  perform public.daily_grant(v_uid, g.id) from public.games g;

  select coalesce(jsonb_object_agg(g.id, jsonb_build_object(
    'day',     v_today,
    'slots',   v_cap,
    'maxCoins', v_max,
    'level',   least(array_length(public.points_per_level(), 1) - 1,
                     coalesce((select wins from public.game_progress where user_id = v_uid and game_id = g.id), 0) / public.wins_per_level()),
    'coins',   (select count(*)::int from public.daily_tickets t
                 where t.user_id = v_uid and t.game_id = g.id and t.day >= v_cutoff),
    'pending', coalesce((select jsonb_agg(jsonb_build_object('day', t.day, 'slot', t.slot, 'level', t.level) order by t.day, t.slot)
                          from public.daily_tickets t
                         where t.user_id = v_uid and t.game_id = g.id and t.day >= v_cutoff), '[]'::jsonb),
    'open',    coalesce((select jsonb_agg(jsonb_build_object('day', r.day, 'slot', r.slot, 'level', r.level) order by r.day, r.slot)
                          from public.daily_runs r
                         where r.user_id = v_uid and r.game_id = g.id and r.day >= v_cutoff), '[]'::jsonb),
    'results', coalesce((select jsonb_object_agg(d.slot::text, d.seconds)
                          from public.daily_results d
                         where d.user_id = v_uid and d.day = v_today and d.game_id = g.id), '{}'::jsonb),
    'history', coalesce((select jsonb_object_agg(x.day::text, x.slots)
                          from (select d.day, jsonb_object_agg(d.slot::text, d.seconds) as slots
                                  from public.daily_results d
                                 where d.user_id = v_uid and d.game_id = g.id
                                   and d.day >= v_cutoff
                                 group by d.day) x), '{}'::jsonb),
    'levels',  coalesce((select jsonb_object_agg(x.day::text, x.level)
                          from (select d.day, max(d.level) as level
                                  from public.daily_results d
                                 where d.user_id = v_uid and d.game_id = g.id
                                   and d.day >= v_cutoff
                                 group by d.day) x), '{}'::jsonb),
    'stats',   public.daily_my_stats(v_uid, g.id, v_today)
  )), '{}'::jsonb)
  into v_out
  from public.games g;

  return v_out;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 3. Ferramenta de teste: também respeita o teto de 30 dias.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.admin_grant_coins(p_email text, p_game text default null, p_coins int default 10)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_uid   uuid;
  v_name  text;
  v_today date := public.daily_day();
  v_cutoff date := public.daily_day() - (public.daily_backlog_days() - 1);
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

  delete from public.daily_tickets
   where user_id = v_uid and day < v_cutoff and (p_game is null or game_id = p_game);
  delete from public.daily_runs
   where user_id = v_uid and day < v_cutoff and (p_game is null or game_id = p_game);
  delete from public.daily_tickets
   where user_id = v_uid and slot > v_cap and (p_game is null or game_id = p_game);
  delete from public.daily_runs
   where user_id = v_uid and slot > v_cap and (p_game is null or game_id = p_game);

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
-- 4. A Edge precisa calcular a seed de qualquer nível/slot para pré-gerar o dia inteiro.
-- ---------------------------------------------------------------------------------------------------
revoke all on function public.daily_seed(date, text, int, int) from public, anon, authenticated;
grant execute on function public.daily_seed(date, text, int, int) to service_role;
