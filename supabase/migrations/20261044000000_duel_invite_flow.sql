-- ====================================================================================================
-- WebMiniGames · Duelos 1×1 — aviso de desafiante e aceite do criador
--
-- Rode DEPOIS de 20261043000000_duel_open_visibility.sql.
--
-- Problema: o criador abre a sala e pode navegar no site. Quando alguém entra, ninguém avisa o
-- criador; se ele voltar pelo hub, cai na tela de criar sala. E o jogo só começava com os dois
-- marcando "pronto" na tela da sala.
--
-- Agora:
--   * quem ENTRA na sala (código ou clique na lista) já entra PRONTO (`duel_seat`);
--   * o criador é avisado em qualquer página (`duel_invites`) e escolhe:
--       - "Entrar na sala": abre o jogo, marca pronto e o duelo começa (contagem de 4 s);
--       - "Desistir": `duel_decline` cancela a sala com `cancel_reason = 'declined'`. O desafiante
--         recebe o cancelamento e NINGUÉM ganha/perde rating — o gatilho `duel_rating_finish` só age
--         quando o status vira 'finished', nunca em 'cancelled'.
--
-- O que muda:
--   1. coluna `duels.cancel_reason` (motivo do cancelamento, para a tela do desafiante);
--   2. `duel_seat` assenta o desafiante já pronto;
--   3. `duel_invites(uid)`: salas MINHAS esperando, com 2 jogadores, para o aviso global;
--   4. `duel_decline(uid, duelo)`: só o criador, só em `waiting`;
--   5. `duel_state` devolve `createdBy` e `cancelReason`;
--   6. `chess_json` devolve `createdBy`, `cancelReason` e — de novo — o `rating` de cada jogador
--      (a migração 20261043 redefiniu a função sem esse campo; aqui ele volta).
--
-- Segurança: continuam só a Edge Function `play` (service_role) executando as funções.
-- ====================================================================================================

alter table public.duels add column if not exists cancel_reason text;

-- ----------------------------------------------------------------------------------------------------
-- 1. Assento: quem ENTRA na sala já está pronto; o criador é quem aceita (duel_ready)
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
    -- Quem entra pela lista (ou pelo código) já está pronto: o criador só precisa aceitar.
    insert into public.duel_players (duel_id, user_id, ready)
    values (p_duel.id, p_uid, true);
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
    'createdBy', p_duel.created_by,
    'players', v_players, 'opponent', v_opp
  );
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 2. Aviso de desafiante: MINHAS salas esperando, já com os dois jogadores
--    Só o criador vê (é o uid dele que consulta), então pode devolver o código do convite.
-- ----------------------------------------------------------------------------------------------------
create or replace function public.duel_invites(p_uid uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_invites jsonb;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select jsonb_agg(q.invite order by q.created_at desc) into v_invites
  from (
    select d.created_at,
           jsonb_build_object(
             'id',         d.id,
             'code',       d.code,
             'gameId',     d.game_id,
             'kind',       d.kind,
             'level',      d.level,
             'maxSeconds', d.max_seconds,
             'createdAt',  d.created_at,
             'expiresAt',  d.expires_at,
             'opponent',   (
               select jsonb_build_object(
                 'nickname', coalesce(p.nickname, p.name),
                 'avatar',   p.avatar,
                 'ready',    dp.ready
               )
               from public.duel_players dp
               join public.profiles p on p.id = dp.user_id
               where dp.duel_id = d.id and dp.user_id <> p_uid
               limit 1
             )
           ) as invite
      from public.duels d
     where d.created_by = p_uid
       and d.status = 'waiting'
       and d.expires_at > now()
       and (select count(*) from public.duel_players dp where dp.duel_id = d.id) = 2
     order by d.created_at desc
     limit 5
  ) q;

  return coalesce(v_invites, '[]'::jsonb);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 3. Desistir: só o criador, só com a sala esperando. Cancela sem vencedor (nenhum rating muda).
-- ----------------------------------------------------------------------------------------------------
create or replace function public.duel_decline(p_uid uuid, p_duel uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
  v_opp uuid;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into v_duel from public.duels where id = p_duel for update;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if v_duel.created_by is null or v_duel.created_by <> p_uid then
    raise exception 'not_creator' using errcode = '55000';
  end if;
  if v_duel.status <> 'waiting' then raise exception 'bad_status' using errcode = '55000'; end if;

  update public.duels
     set status = 'cancelled', cancel_reason = 'declined', finished_at = now()
   where id = p_duel;

  select user_id into v_opp from public.duel_players where duel_id = p_duel and user_id <> p_uid limit 1;

  return jsonb_build_object(
    'status', 'cancelled', 'cancelReason', 'declined',
    'code', v_duel.code, 'gameId', v_duel.game_id, 'opponent', v_opp
  );
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 4. `duel_state` devolve quem criou a sala e o motivo do cancelamento
-- ----------------------------------------------------------------------------------------------------
create or replace function public.duel_state(p_uid uuid, p_duel uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
  v_players jsonb;
  v_winner jsonb;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into v_duel from public.duels where id = p_duel;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if not exists (select 1 from public.duel_players where duel_id = p_duel and user_id = p_uid) then
    raise exception 'not_member' using errcode = '55000';
  end if;

  -- Limpeza preguiçosa: sala waiting expirada vira cancelled.
  if v_duel.status = 'waiting' and v_duel.expires_at < now() then
    update public.duels set status = 'cancelled', cancel_reason = 'expired' where id = p_duel;
    select * into v_duel from public.duels where id = p_duel;
  end if;

  -- Limpeza preguiçosa: running expirada. `words` decide pelo placar; `first` empata.
  if v_duel.status = 'running' and v_duel.starts_at is not null
     and now() > v_duel.starts_at + make_interval(secs => v_duel.max_seconds) then
    if v_duel.rule = 'words' then
      perform public.duel_settle(p_duel);
    elsif v_duel.winner_id is null then
      update public.duels set status = 'finished', finished_at = now() where id = p_duel;
    end if;
    select * into v_duel from public.duels where id = p_duel;
  end if;

  select jsonb_agg(jsonb_build_object(
    'user_id', dp.user_id,
    'nickname', coalesce(p.nickname, p.name),
    'avatar', p.avatar,
    'ready', dp.ready,
    'finished_at', dp.finished_at,
    'seconds', dp.seconds,
    'words', dp.words,
    'is_me', dp.user_id = p_uid
  ) order by dp.joined_at) into v_players
  from public.duel_players dp
  join public.profiles p on p.id = dp.user_id
  where dp.duel_id = p_duel;

  if v_duel.winner_id is not null then
    select jsonb_build_object(
      'user_id', p.id,
      'nickname', coalesce(p.nickname, p.name),
      'avatar', p.avatar
    ) into v_winner
    from public.profiles p where p.id = v_duel.winner_id;
  end if;

  return jsonb_build_object(
    'id', v_duel.id, 'code', v_duel.code, 'gameId', v_duel.game_id,
    'level', v_duel.level, 'rule', v_duel.rule, 'maxSeconds', v_duel.max_seconds,
    'status', v_duel.status, 'startsAt', v_duel.starts_at,
    'finishedAt', v_duel.finished_at, 'expiresAt', v_duel.expires_at,
    'createdBy', v_duel.created_by, 'cancelReason', v_duel.cancel_reason,
    'open', v_duel.is_open,
    'serverNow', now(), 'players', v_players, 'winner', v_winner
  );
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 5. `chess_json`: createdBy/cancelReason + o rating de cada jogador (volta a valer o da 20261039)
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
    'createdBy', d.created_by,
    'cancelReason', d.cancel_reason,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', dp.user_id,
        'nickname', coalesce(p.nickname, p.name),
        'avatar', p.avatar,
        'ready', dp.ready,
        'is_me', dp.user_id = p_uid,
        'rating', coalesce(dr.rating, 1500)
      ) order by dp.joined_at)
      from public.duel_players dp
      join public.profiles p on p.id = dp.user_id
      left join public.duel_ratings dr on dr.game_id = d.game_id and dr.user_id = dp.user_id
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

revoke all on function public.duel_invites(uuid) from public, anon, authenticated;
grant execute on function public.duel_invites(uuid) to service_role;
revoke all on function public.duel_decline(uuid, uuid) from public, anon, authenticated;
grant execute on function public.duel_decline(uuid, uuid) to service_role;
revoke all on function public.duel_seat(uuid, public.duels) from public, anon, authenticated;

-- FIM DA MIGRAÇÃO 20261044000000_duel_invite_flow.sql
