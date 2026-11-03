-- ====================================================================================================
-- WebMiniGames · Duelos 1×1 — conserto do "Estou pronto" (duel_ready) e da presença do desafiante
--
-- Rode DEPOIS de 20261047000000_dama_duel.sql. Idempotente (pode rodar de novo).
-- NÃO edita migrações antigas: o que já foi aplicado no banco não é reexecutado pelo `db push`.
--
-- O que muda:
--   1. `duel_ready`: volta a ser a da 20261045 (guarda `opponent_away` incluída). Se a versão quebrada do
--      commit c0a6a59 (que lia `nickname` de duel_players, coluna que não existe) foi colada no banco,
--      esta migração a substitui. Agora a resposta traz `players` lido de `profiles`, do jeito certo.
--   2. `dama_state` e `chess_state` carimbam `last_seen_at` do próprio consultante enquanto a sala está
--      `waiting`. Antes só a Edge fazia isso (e ignorava erros em silêncio): se falhasse, o criador, que
--      sempre clica por último, recebia `opponent_away` e o "Estou pronto" parecia não funcionar.
-- ====================================================================================================

-- ----------------------------------------------------------------------------------------------------
-- 1. Pronto
-- ----------------------------------------------------------------------------------------------------
create or replace function public.duel_ready(p_uid uuid, p_duel uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
  v_ready int;
  v_players jsonb;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into v_duel from public.duels where id = p_duel for update;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if not exists (select 1 from public.duel_players where duel_id = p_duel and user_id = p_uid) then
    raise exception 'not_member' using errcode = '55000';
  end if;
  if v_duel.status <> 'waiting' then raise exception 'bad_status' using errcode = '55000'; end if;

  if exists (
    select 1 from public.duel_players o
     where o.duel_id = p_duel and o.user_id <> p_uid and o.ready
       and coalesce(o.last_seen_at, o.joined_at) < now() - interval '90 seconds'
  ) then
    raise exception 'opponent_away' using errcode = '55000';
  end if;

  update public.duel_players set ready = true, last_seen_at = now()
   where duel_id = p_duel and user_id = p_uid;

  select count(*) into v_ready from public.duel_players where duel_id = p_duel and ready = true;
  if v_ready = 2 then
    update public.duels
       set status = 'running', starts_at = now() + interval '4 seconds'
     where id = p_duel
     returning * into v_duel;
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
  where dp.duel_id = p_duel;

  return jsonb_build_object(
    'status', v_duel.status,
    'startsAt', v_duel.starts_at,
    'serverNow', now(),
    'players', v_players
  );
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 2. Presença dentro do estado da sala (dama e xadrez)
-- ----------------------------------------------------------------------------------------------------
create or replace function public.dama_state(p_uid uuid, p_duel uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
  v_dama public.dama_games;
  v_elapsed numeric;
  v_remaining int;
  v_winner uuid;
  v_result text;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into v_duel from public.duels where id = p_duel for update;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if not exists (select 1 from public.duel_players where duel_id = p_duel and user_id = p_uid) then
    raise exception 'not_member' using errcode = '55000';
  end if;

  -- Presença: quem consulta a sala de espera está na página. Carimbar aqui (e não só na Edge) garante que o
  -- `opponent_away` do duel_ready nunca dispare por um carimbo que a Edge deixou de gravar.
  if v_duel.status = 'waiting' then
    update public.duel_players set last_seen_at = now()
     where duel_id = p_duel and user_id = p_uid;
  end if;

  select * into v_dama from public.dama_games where duel_id = p_duel for update;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;

  -- Sala waiting expirada (o criador não achou adversário).
  if v_duel.status = 'waiting' and v_duel.expires_at < now() then
    update public.duels set status = 'cancelled', cancel_reason = 'expired' where id = p_duel;
    select * into v_duel from public.duels where id = p_duel;
  end if;

  if v_duel.status = 'running' then
    -- Antes da largada: mostra o tabuleiro e a contagem; nenhum relógio corre ainda.
    if v_duel.starts_at is null or now() < v_duel.starts_at then
      return public.dama_json(p_uid, p_duel, v_dama.white_ms, v_dama.black_ms);
    end if;

    -- Primeira consulta depois da largada: o relógio começou em starts_at, não agora.
    if v_dama.last_at is null then
      update public.dama_games set last_at = v_duel.starts_at where duel_id = p_duel;
      v_dama.last_at := v_duel.starts_at;
    end if;

    v_elapsed := extract(epoch from (now() - v_dama.last_at)) * 1000;
    v_remaining := floor(
      (case when v_dama.turn = 'w' then v_dama.white_ms else v_dama.black_ms end) - v_elapsed
    )::int;

    if v_remaining <= 0 then
      if v_dama.turn = 'w' then
        v_winner := v_dama.black_id; v_result := 'black';
      else
        v_winner := v_dama.white_id; v_result := 'white';
      end if;

      update public.dama_games
         set white_ms = case when turn = 'w' then 0 else white_ms end,
             black_ms = case when turn = 'b' then 0 else black_ms end,
             result = v_result, reason = 'timeout', last_at = null, updated_at = now()
       where duel_id = p_duel;
      update public.duels
         set status = 'finished', winner_id = v_winner, finished_at = now()
       where id = p_duel;

      select * into v_dama from public.dama_games where duel_id = p_duel;
      return public.dama_json(p_uid, p_duel, v_dama.white_ms, v_dama.black_ms);
    end if;

    if v_dama.turn = 'w' then
      return public.dama_json(p_uid, p_duel, v_remaining, v_dama.black_ms);
    end if;
    return public.dama_json(p_uid, p_duel, v_dama.white_ms, v_remaining);
  end if;

  return public.dama_json(p_uid, p_duel, v_dama.white_ms, v_dama.black_ms);
end $$;

create or replace function public.chess_state(p_uid uuid, p_duel uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
  v_chess public.chess_games;
  v_elapsed numeric;
  v_remaining int;
  v_winner uuid;
  v_result text;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into v_duel from public.duels where id = p_duel for update;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if not exists (select 1 from public.duel_players where duel_id = p_duel and user_id = p_uid) then
    raise exception 'not_member' using errcode = '55000';
  end if;

  -- Presença: quem consulta a sala de espera está na página. Carimbar aqui (e não só na Edge) garante que o
  -- `opponent_away` do duel_ready nunca dispare por um carimbo que a Edge deixou de gravar.
  if v_duel.status = 'waiting' then
    update public.duel_players set last_seen_at = now()
     where duel_id = p_duel and user_id = p_uid;
  end if;

  select * into v_chess from public.chess_games where duel_id = p_duel for update;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;

  -- Sala waiting expirada (o criador não achou adversário).
  if v_duel.status = 'waiting' and v_duel.expires_at < now() then
    update public.duels set status = 'cancelled' where id = p_duel;
    select * into v_duel from public.duels where id = p_duel;
  end if;

  if v_duel.status = 'running' then
    -- Antes da largada: mostra o tabuleiro e a contagem; nenhum relógio corre ainda.
    if v_duel.starts_at is null or now() < v_duel.starts_at then
      return public.chess_json(p_uid, p_duel, v_chess.white_ms, v_chess.black_ms);
    end if;

    -- Primeira consulta depois da largada: o relógio começou em starts_at, não agora.
    if v_chess.last_at is null then
      update public.chess_games set last_at = v_duel.starts_at where duel_id = p_duel;
      v_chess.last_at := v_duel.starts_at;
    end if;

    v_elapsed := extract(epoch from (now() - v_chess.last_at)) * 1000;
    v_remaining := floor(
      (case when v_chess.turn = 'w' then v_chess.white_ms else v_chess.black_ms end) - v_elapsed
    )::int;

    if v_remaining <= 0 then
      -- FIDE 6.9: quem estourou perde, a não ser que o adversário não consiga dar mate.
      if v_chess.turn = 'w' and v_chess.black_can_mate then
        v_winner := v_chess.black_id; v_result := 'black';
      elsif v_chess.turn = 'b' and v_chess.white_can_mate then
        v_winner := v_chess.white_id; v_result := 'white';
      else
        v_winner := null; v_result := 'draw';
      end if;

      update public.chess_games
         set white_ms = case when turn = 'w' then 0 else white_ms end,
             black_ms = case when turn = 'b' then 0 else black_ms end,
             result = v_result, reason = 'timeout', last_at = null, updated_at = now()
       where duel_id = p_duel;
      update public.duels
         set status = 'finished', winner_id = v_winner, finished_at = now()
       where id = p_duel;

      select * into v_chess from public.chess_games where duel_id = p_duel;
      return public.chess_json(p_uid, p_duel, v_chess.white_ms, v_chess.black_ms);
    end if;

    if v_chess.turn = 'w' then
      return public.chess_json(p_uid, p_duel, v_remaining, v_chess.black_ms);
    end if;
    return public.chess_json(p_uid, p_duel, v_chess.white_ms, v_remaining);
  end if;

  return public.chess_json(p_uid, p_duel, v_chess.white_ms, v_chess.black_ms);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 3. Permissões (só a Edge com service_role executa)
-- ----------------------------------------------------------------------------------------------------
revoke all on function public.duel_ready(uuid, uuid)  from public, anon, authenticated;
grant execute on function public.duel_ready(uuid, uuid)  to service_role;
revoke all on function public.dama_state(uuid, uuid)  from public, anon, authenticated;
grant execute on function public.dama_state(uuid, uuid)  to service_role;
revoke all on function public.chess_state(uuid, uuid) from public, anon, authenticated;
grant execute on function public.chess_state(uuid, uuid) to service_role;

-- FIM DA MIGRAÇÃO 20261048000000_duel_ready_fix.sql
