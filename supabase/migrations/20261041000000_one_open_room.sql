-- ====================================================================================================
-- WebMiniGames · Duelos 1×1 — UMA sala aberta por vez
--
-- Rode DEPOIS de 20261040000000_duel_open_rooms.sql.
--
-- Antes: cada usuário podia ter até 3 salas esperando desafiante. Agora só 1.
--
-- O que muda (em duel_create e chess_create — as duas formas de abrir sala):
--   * o limite cai de 3 para 1;
--   * só conta sala que AINDA vale: 'waiting' e não expirada (`expires_at > now()`). Antes contava
--     toda 'waiting', então uma sala vencida que a limpeza (duel_cleanup) ainda não cancelou
--     bloqueava o criador à toa;
--   * um lock por usuário (pg_advisory_xact_lock) faz duas criações ao mesmo tempo, em abas diferentes,
--     passarem pela contagem uma de cada vez — sem ele as duas poderiam ver "0 salas" e criar 2.
--
-- O corpo das funções é o mesmo de antes (20261036 e 20261038); só essas linhas mudaram.
-- Para sair da sala e poder abrir outra: o criador usa "Sair" na tela da sala (cancela) ou espera ela expirar.
-- ====================================================================================================

create or replace function public.duel_create(
  p_uid uuid, p_game text, p_level int,
  p_seed bigint, p_gen int,
  p_public jsonb, p_full jsonb,
  p_rule text, p_max_seconds int
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

  insert into public.duels (code, game_id, level, seed, gen, public_view, full_puzzle, rule, max_seconds, created_by)
  values (v_code, p_game, p_level, p_seed, p_gen, p_public, p_full, p_rule, p_max_seconds, p_uid)
  returning * into v_duel;

  insert into public.duel_players (duel_id, user_id, ready)
  values (v_duel.id, p_uid, false);

  return jsonb_build_object(
    'id', v_duel.id, 'code', v_duel.code, 'gameId', v_duel.game_id,
    'level', v_duel.level, 'maxSeconds', v_duel.max_seconds,
    'rule', v_duel.rule, 'expiresAt', v_duel.expires_at
  );
end $$;

create or replace function public.chess_create(
  p_uid uuid, p_minutes int, p_color text, p_fen text, p_key text
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
    code, game_id, level, seed, gen, public_view, full_puzzle, rule, kind, max_seconds, created_by
  ) values (
    v_code, 'chess', 0, 0, 1, null, null, 'turn', 'turn', p_minutes * 60, p_uid
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

revoke all on function public.duel_create(uuid, text, int, bigint, int, jsonb, jsonb, text, int) from public, anon, authenticated;
grant execute on function public.duel_create(uuid, text, int, bigint, int, jsonb, jsonb, text, int) to service_role;
revoke all on function public.chess_create(uuid, int, text, text, text) from public, anon, authenticated;
grant execute on function public.chess_create(uuid, int, text, text, text) to service_role;

-- FIM DA MIGRAÇÃO 20261041000000_one_open_room.sql
