-- =====================================================================================================
-- WebMiniGames · conta administradora não pontua nem concorre em rankings
--
-- Como aplicar: Supabase > SQL Editor > cole este arquivo inteiro > Run (ou `supabase db push`).
-- Rode DEPOIS de 20261019000000_serve_phase.sql.
--
-- O que muda:
--   * A vitória de uma conta com profiles.role = 'admin' vira um "sandbox": consome a fase (a fase
--     resolvida não volta no snapshot) e conta a progressão (wins), mas NÃO grava em `scores`
--     (ranking de pontuação) nem em `win_log` (histórico, base do ranking de tempo). Sem ritmo
--     anti-farm, para o administrador poder testar rápido. Os coins seguem cobrados ao abrir a fase
--     (a conta admin tem 99999 e recarrega todo dia).
--   * `ranking` exclui administradores (defesa em profundidade): mesmo que alguma conta promovida
--     depois já tivesse pontuação antiga, ela não aparece em nenhum ranking.
-- =====================================================================================================

create or replace function public.finalize_win(p_uid uuid, p_game text, p_op uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_op       uuid := coalesce(p_op, gen_random_uuid());
  v_min      interval := make_interval(secs => public.phase_min_seconds());
  v_phase    public.phase_runs;
  v_wins     int;
  v_cap      int;
  v_points   int;
  v_inserted int;
  v_is_admin boolean;
  v_score    public.scores;
  v_coins    public.coins;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.games where id = p_game) then raise exception 'unknown_game' using errcode = '22023'; end if;

  -- Reenvio da mesma vitória (fila/instabilidade): devolve o estado, sem contar de novo nem esbarrar no ritmo.
  if exists (select 1 from public.win_log where user_id = p_uid and op_id = v_op) then
    select * into v_score from public.scores where user_id = p_uid and game_id = p_game;
    v_coins := public.coins_apply(p_uid, p_game, false);
    return jsonb_build_object(
      'duplicate', true,
      'wins', coalesce((select wins from public.game_progress where user_id = p_uid and game_id = p_game), 0),
      'score', jsonb_build_object('points', coalesce(v_score.points, 0), 'wins', coalesce(v_score.wins, 0), 'updatedAt', (extract(epoch from coalesce(v_score.updated_at, now())) * 1000)::bigint),
      'coins', jsonb_build_object('coins', v_coins.coins, 'anchor', (extract(epoch from v_coins.anchor) * 1000)::bigint)
    );
  end if;

  -- Conta administradora: sandbox. Consome a fase e conta a progressão, mas NÃO pontua e NÃO entra em
  -- ranking (nada em `scores`/`win_log`). Sem ritmo anti-farm, para poder testar à vontade.
  select exists (select 1 from public.profiles where id = p_uid and role = 'admin') into v_is_admin;
  if v_is_admin then
    select * into v_phase from public.phase_runs where user_id = p_uid and game_id = p_game for update;
    if not found then raise exception 'no_phase' using errcode = '22023'; end if;         -- só pontua fase aberta
    insert into public.game_progress (user_id, game_id) values (p_uid, p_game) on conflict do nothing;
    update public.game_progress set wins = wins + 1, updated_at = now() where user_id = p_uid and game_id = p_game returning wins into v_wins;
    delete from public.phase_runs where user_id = p_uid and game_id = p_game;             -- fase consumida
    select * into v_score from public.scores where user_id = p_uid and game_id = p_game;  -- pontuação própria (se houver, antiga)
    v_coins := public.coins_apply(p_uid, p_game, false);
    return jsonb_build_object(
      'duplicate', false,
      'admin', true,
      'wins', v_wins,
      'score', jsonb_build_object('points', coalesce(v_score.points, 0), 'wins', coalesce(v_score.wins, 0), 'updatedAt', (extract(epoch from coalesce(v_score.updated_at, now())) * 1000)::bigint),
      'coins', jsonb_build_object('coins', v_coins.coins, 'anchor', (extract(epoch from v_coins.anchor) * 1000)::bigint)
    );
  end if;

  -- Ritmo: uma vitória por jogo a cada phase_min_seconds (anti-farm). Erro retentável (P0001).
  if exists (select 1 from public.win_log where user_id = p_uid and game_id = p_game and created_at > now() - v_min) then
    raise exception 'too_fast';
  end if;

  select * into v_phase from public.phase_runs where user_id = p_uid and game_id = p_game for update;
  if not found then raise exception 'no_phase' using errcode = '22023'; end if;          -- fase inexistente/já consumida
  if now() - v_phase.started_at < v_min then raise exception 'too_fast'; end if;        -- fase recém-aberta: ainda não dá (anti-farm)

  insert into public.game_progress (user_id, game_id) values (p_uid, p_game) on conflict do nothing;
  v_cap := (public.points_per_level())[v_phase.level + 1];
  v_points := greatest(1, v_cap - least(greatest(coalesce(v_phase.hints, 0), 0), v_cap - 1));

  insert into public.win_log (user_id, op_id, game_id, level, points) values (p_uid, v_op, p_game, v_phase.level, v_points)
    on conflict (user_id, op_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then                                                               -- corrida: mesma vitória em paralelo
    select * into v_score from public.scores where user_id = p_uid and game_id = p_game;
    v_coins := public.coins_apply(p_uid, p_game, false);
    return jsonb_build_object(
      'duplicate', true,
      'wins', coalesce((select wins from public.game_progress where user_id = p_uid and game_id = p_game), 0),
      'score', jsonb_build_object('points', coalesce(v_score.points, 0), 'wins', coalesce(v_score.wins, 0), 'updatedAt', (extract(epoch from coalesce(v_score.updated_at, now())) * 1000)::bigint),
      'coins', jsonb_build_object('coins', v_coins.coins, 'anchor', (extract(epoch from v_coins.anchor) * 1000)::bigint)
    );
  end if;

  update public.game_progress set wins = wins + 1, updated_at = now() where user_id = p_uid and game_id = p_game returning wins into v_wins;
  insert into public.scores (user_id, game_id, points, wins, updated_at) values (p_uid, p_game, v_points, 1, now())
    on conflict (user_id, game_id) do update
    set points = public.scores.points + excluded.points, wins = public.scores.wins + 1, updated_at = now();
  delete from public.phase_runs where user_id = p_uid and game_id = p_game;              -- fase consumida

  select * into v_score from public.scores where user_id = p_uid and game_id = p_game;
  v_coins := public.coins_apply(p_uid, p_game, false);
  return jsonb_build_object(
    'duplicate', false,
    'wins', v_wins,
    'score', jsonb_build_object('points', v_score.points, 'wins', v_score.wins, 'updatedAt', (extract(epoch from v_score.updated_at) * 1000)::bigint),
    'coins', jsonb_build_object('coins', v_coins.coins, 'anchor', (extract(epoch from v_coins.anchor) * 1000)::bigint)
  );
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Ranking: administradores ficam de fora, mesmo que tenham pontuação antiga (promovidos depois).
-- ---------------------------------------------------------------------------------------------------
create or replace function public.ranking(p_game text default null, p_scope text default 'global', p_limit int default 10) returns jsonb
language sql stable security definer set search_path = '' as $$
  with base as (
    select s.user_id, sum(s.points)::int as points, sum(s.wins)::int as wins, max(s.updated_at) as updated_at
    from public.scores s
    join public.profiles pr on pr.id = s.user_id
    where (p_game is null or s.game_id = p_game)
      and pr.role <> 'admin'
    group by s.user_id
    having sum(s.points) > 0
  ),
  filtered as (
    select b.user_id, coalesce(p.nickname, p.name) as name, p.avatar, p.region, b.points, b.wins, b.updated_at
    from base b join public.profiles p on p.id = b.user_id
    where p_scope is distinct from 'region'
       or (p.region is not null and p.region = (select region from public.profiles where id = auth.uid()))
  ),
  ranked as (
    select f.*, row_number() over (order by f.points desc, f.updated_at asc, f.user_id) as rank,
           jsonb_build_object('id', f.user_id, 'name', f.name, 'avatar', f.avatar, 'region', f.region, 'points', f.points, 'wins', f.wins,
                              'updatedAt', (extract(epoch from f.updated_at) * 1000)::bigint) as j
    from filtered f
  )
  select jsonb_build_object(
    'top',   coalesce((select jsonb_agg(r.j || jsonb_build_object('rank', r.rank, 'isMe', r.user_id is not distinct from auth.uid()) order by r.rank)
                       from ranked r where r.rank <= least(greatest(coalesce(p_limit, 10), 1), 100)), '[]'::jsonb),
    'me',    (select r.j || jsonb_build_object('rank', r.rank, 'isMe', true) from ranked r where r.user_id = auth.uid()),
    'total', (select count(*) from ranked)
  )
$$;

-- Permissões preservadas pelo CREATE OR REPLACE; reafirmadas por clareza (só a Edge Function escreve).
revoke all on function public.finalize_win(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.finalize_win(uuid, text, uuid) to service_role;
