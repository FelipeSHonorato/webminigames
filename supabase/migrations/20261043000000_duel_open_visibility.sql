-- ====================================================================================================
-- WebMiniGames · Duelos 1×1 — sala aberta ou fechada
--
-- Rode DEPOIS de 20261042000000_duel_open_rooms_rating.sql.
--
-- Antes: toda sala esperando desafiante aparecia em "Salas Online", mas só quem tinha o código
--        conseguia entrar (a lista não tinha como assentar o clicante).
-- Agora: quem cria escolhe a visibilidade.
--   * `is_open = true` (padrão) — sala ABERTA: aparece na lista para os outros e o clique no card
--     entra direto (`duel_join_open`), sem código.
--   * `is_open = false` — sala FECHADA: só entra com o código do convite (`duel_join`). Ela continua
--     aparecendo na lista para o próprio criador ("Sua sala"), que assim consegue reabrir a tela do código.
--
-- O que muda:
--   1. coluna `duels.is_open` (default true: salas antigas continuam abertas);
--   2. `duel_create` e `chess_create` recebem `p_open` (assinaturas antigas saem);
--   3. `duel_open_rooms` devolve `open` e filtra as fechadas para os outros jogadores;
--   4. `duel_join_open` assenta quem clicou numa sala aberta (mesmo assento do `duel_join`);
--   5. `chess_json` devolve `open`, para o lobby mostrar a visibilidade.
--
-- Segurança: continuam só a Edge Function `play` (service_role) podendo executar as funções.
-- ====================================================================================================

alter table public.duels add column if not exists is_open boolean not null default true;

-- ----------------------------------------------------------------------------------------------------
-- 1. Criar sala de corrida: agora com visibilidade
-- ----------------------------------------------------------------------------------------------------
drop function if exists public.duel_create(uuid, text, int, bigint, int, jsonb, jsonb, text, int);

create or replace function public.duel_create(
  p_uid uuid, p_game text, p_level int,
  p_seed bigint, p_gen int,
  p_public jsonb, p_full jsonb,
  p_rule text, p_max_seconds int, p_open boolean default true
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_duel public.duels;
  v_cap int := 1;  -- UMA sala aberta por vez ('waiting' e ainda não expirada)
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.games where id = p_game) then
    raise exception 'unknown_game' using errcode = '22023';
  end if;
  if p_level is null or p_level < 0 then
    raise exception 'bad_level' using errcode = '22023';
  end if;
  if p_seed is null or p_seed < 0 or p_seed >= 4294967296 then
    raise exception 'bad_seed' using errcode = '22023';
  end if;
  if p_gen is null or p_gen < 0 then
    raise exception 'bad_gen' using errcode = '22023';
  end if;
  if p_rule is null or p_rule not in ('first', 'words') then
    raise exception 'bad_rule' using errcode = '22023';
  end if;
  if p_max_seconds is null or p_max_seconds < 30 or p_max_seconds > 3600 then
    raise exception 'bad_max_seconds' using errcode = '22023';
  end if;

  -- Limite de salas abertas por usuário
  perform pg_advisory_xact_lock(hashtextextended('duel_open:' || p_uid::text, 0));   -- duas criações simultâneas do mesmo usuário não furam o limite
  if (select count(*) from public.duels
      where created_by = p_uid and status = 'waiting' and expires_at > now()) >= v_cap then
    raise exception 'too_many_open' using errcode = '55000';
  end if;

  v_code := public.duel_gen_code();

  insert into public.duels (code, game_id, level, seed, gen, public_view, full_puzzle, rule, max_seconds, created_by, is_open)
  values (v_code, p_game, p_level, p_seed, p_gen, p_public, p_full, p_rule, p_max_seconds, p_uid, coalesce(p_open, true))
  returning * into v_duel;

  insert into public.duel_players (duel_id, user_id, ready)
  values (v_duel.id, p_uid, false);

  return jsonb_build_object(
    'id', v_duel.id, 'code', v_duel.code, 'gameId', v_duel.game_id,
    'level', v_duel.level, 'maxSeconds', v_duel.max_seconds,
    'rule', v_duel.rule, 'expiresAt', v_duel.expires_at, 'open', v_duel.is_open
  );
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 2. Criar sala de xadrez: ritmo, cor e visibilidade
-- ----------------------------------------------------------------------------------------------------
drop function if exists public.chess_create(uuid, int, text, text, text);

create or replace function public.chess_create(
  p_uid uuid, p_minutes int, p_color text, p_fen text, p_key text, p_open boolean default true
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_duel public.duels;
  v_ms int;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_minutes is null or p_minutes not in (3, 10, 30, 60) then
    raise exception 'bad_minutes' using errcode = '22023';
  end if;
  if p_color is null or p_color not in ('w', 'b') then
    raise exception 'bad_color' using errcode = '22023';
  end if;
  if p_fen is null or p_key is null then
    raise exception 'bad_state' using errcode = '22023';
  end if;
  -- UMA sala aberta por vez ('waiting' e ainda não expirada)
  perform pg_advisory_xact_lock(hashtextextended('duel_open:' || p_uid::text, 0));   -- duas criações simultâneas do mesmo usuário não furam o limite
  if (select count(*) from public.duels
      where created_by = p_uid and status = 'waiting' and expires_at > now()) >= 1 then
    raise exception 'too_many_open' using errcode = '55000';
  end if;

  v_ms := p_minutes * 60000;
  v_code := public.duel_gen_code();

  insert into public.duels (
    code, game_id, level, seed, gen, public_view, full_puzzle, rule, kind, max_seconds, created_by, is_open
  ) values (
    v_code, 'chess', 0, 0, 1, null, null, 'turn', 'turn', p_minutes * 60, p_uid, coalesce(p_open, true)
  ) returning * into v_duel;

  insert into public.duel_players (duel_id, user_id, ready)
  values (v_duel.id, p_uid, false);

  insert into public.chess_games (
    duel_id, fen, turn, keys, white_id, black_id, white_ms, black_ms
  ) values (
    v_duel.id, p_fen, 'w', jsonb_build_array(p_key),
    case when p_color = 'w' then p_uid end,
    case when p_color = 'b' then p_uid end,
    v_ms, v_ms
  );

  return public.chess_json(p_uid, v_duel.id, v_ms, v_ms);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 3. `chess_json` devolve a visibilidade (o lobby mostra "aberta" ou "fechada")
-- ----------------------------------------------------------------------------------------------------
create or replace function public.chess_json(
  p_uid uuid, p_duel uuid, p_white_ms int, p_black_ms int
) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', d.id,
    'code', d.code,
    'gameId', d.game_id,
    'kind', d.kind,
    'status', d.status,
    'startsAt', d.starts_at,
    'finishedAt', d.finished_at,
    'expiresAt', d.expires_at,
    'serverNow', now(),
    'maxSeconds', d.max_seconds,
    'open', d.is_open,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', dp.user_id,
        'nickname', coalesce(p.nickname, p.name),
        'avatar', p.avatar,
        'ready', dp.ready,
        'is_me', dp.user_id = p_uid
      ) order by dp.joined_at)
      from public.duel_players dp
      join public.profiles p on p.id = dp.user_id
      where dp.duel_id = d.id
    ), '[]'::jsonb),
    'winner', (
      select jsonb_build_object(
        'user_id', p.id,
        'nickname', coalesce(p.nickname, p.name),
        'avatar', p.avatar
      )
      from public.profiles p where p.id = d.winner_id
    ),
    'chess', jsonb_build_object(
      'fen', c.fen,
      'turn', c.turn,
      'version', c.version,
      'keys', c.keys,
      'moves', c.moves,
      'last', c.last_move,
      'clocks', jsonb_build_object('w', p_white_ms, 'b', p_black_ms),
      'colors', jsonb_build_object('white', c.white_id, 'black', c.black_id),
      'result', c.result,
      'reason', c.reason
    )
  )
  from public.duels d
  join public.chess_games c on c.duel_id = d.id
  where d.id = p_duel;
$$;

-- ----------------------------------------------------------------------------------------------------
-- 4. Assento compartilhado: entra (ou reentra) na sala JÁ travada pelo chamador.
--    `duel_join` (código) e `duel_join_open` (clique na lista) terminam no mesmo lugar.
-- ----------------------------------------------------------------------------------------------------
create or replace function public.duel_seat(p_uid uuid, p_duel public.duels) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_players jsonb;
  v_opp jsonb;
  v_new boolean := false;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_duel.status <> 'waiting' then raise exception 'bad_status' using errcode = '55000'; end if;
  if p_duel.expires_at < now() then raise exception 'expired' using errcode = '55000'; end if;

  if not exists (select 1 from public.duel_players where duel_id = p_duel.id and user_id = p_uid) then
    if (select count(*) from public.duel_players where duel_id = p_duel.id) >= 2 then
      raise exception 'duel_full' using errcode = '55000';
    end if;
    insert into public.duel_players (duel_id, user_id, ready)
    values (p_duel.id, p_uid, false);
    v_new := true;
  end if;

  -- Xadrez: quem entrou pega a cor que o criador não escolheu.
  if v_new and p_duel.kind = 'turn' then
    update public.chess_games
       set white_id = coalesce(white_id, p_uid),
           black_id = coalesce(black_id, p_uid),
           updated_at = now()
     where duel_id = p_duel.id;
  end if;

  select jsonb_agg(jsonb_build_object(
    'user_id', dp.user_id,
    'nickname', coalesce(p.nickname, p.name),
    'avatar', p.avatar,
    'ready', dp.ready,
    'is_me', dp.user_id = p_uid
  ) order by dp.joined_at) into v_players
  from public.duel_players dp
  join public.profiles p on p.id = dp.user_id
  where dp.duel_id = p_duel.id;

  select jsonb_build_object(
    'user_id', dp.user_id,
    'nickname', coalesce(p.nickname, p.name),
    'avatar', p.avatar,
    'ready', dp.ready
  ) into v_opp
  from public.duel_players dp
  join public.profiles p on p.id = dp.user_id
  where dp.duel_id = p_duel.id and dp.user_id <> p_uid
  limit 1;

  return jsonb_build_object(
    'id', p_duel.id, 'code', p_duel.code, 'gameId', p_duel.game_id,
    'kind', p_duel.kind, 'level', p_duel.level, 'rule', p_duel.rule,
    'maxSeconds', p_duel.max_seconds, 'open', p_duel.is_open,
    'players', v_players, 'opponent', v_opp
  );
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 5. Entrar por código: sala aberta OU fechada (o código é o convite)
-- ----------------------------------------------------------------------------------------------------
create or replace function public.duel_join(p_uid uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into v_duel from public.duels where code = p_code for update;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;

  return public.duel_seat(p_uid, v_duel);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 6. Entrar pelo id (clique na lista): só vale sala ABERTA. Fechada devolve 'closed_room' e o cliente
--    pede o código — a lista nem mostra a fechada para quem não é o criador.
-- ----------------------------------------------------------------------------------------------------
create or replace function public.duel_join_open(p_uid uuid, p_duel uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into v_duel from public.duels where id = p_duel for update;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if not v_duel.is_open then raise exception 'closed_room' using errcode = '55000'; end if;

  return public.duel_seat(p_uid, v_duel);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 7. Lista de salas: abertas para todos; fechadas só para o criador (para reabrir a tela do código)
-- ----------------------------------------------------------------------------------------------------
create or replace function public.duel_open_rooms(p_uid uuid, p_limit int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  return coalesce((
    select jsonb_agg(q.room order by q.created_at desc)
    from (
      select d.created_at,
             jsonb_build_object(
               'id',         d.id,
               'gameId',     d.game_id,
               'kind',       d.kind,
               'rule',       d.rule,
               'level',      d.level,
               'maxSeconds', d.max_seconds,
               'createdAt',  d.created_at,
               'expiresAt',  d.expires_at,
               'open',       d.is_open,
               'mine',       d.created_by = p_uid,
               'host',       jsonb_build_object('nickname', coalesce(p.nickname, p.name), 'avatar', p.avatar,
                                'rating', coalesce(dr.rating, 1500))
             ) as room
        from public.duels d
        left join public.profiles p on p.id = d.created_by
        left join public.duel_ratings dr on dr.game_id = d.game_id and dr.user_id = d.created_by
       where d.status = 'waiting'
         and d.expires_at > now()
         and (d.is_open or d.created_by = p_uid)
         and (select count(*) from public.duel_players dp where dp.duel_id = d.id) < 2
       order by d.created_at desc
       limit v_limit
    ) q
  ), '[]'::jsonb);
end $$;

revoke all on function public.duel_create(uuid, text, int, bigint, int, jsonb, jsonb, text, int, boolean) from public, anon, authenticated;
grant execute on function public.duel_create(uuid, text, int, bigint, int, jsonb, jsonb, text, int, boolean) to service_role;
revoke all on function public.chess_create(uuid, int, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.chess_create(uuid, int, text, text, text, boolean) to service_role;
revoke all on function public.duel_seat(uuid, public.duels) from public, anon, authenticated;
revoke all on function public.duel_join_open(uuid, uuid) from public, anon, authenticated;
grant execute on function public.duel_join_open(uuid, uuid) to service_role;
revoke all on function public.duel_open_rooms(uuid, int) from public, anon, authenticated;
grant execute on function public.duel_open_rooms(uuid, int) to service_role;

-- FIM DA MIGRAÇÃO 20261043000000_duel_open_visibility.sql
