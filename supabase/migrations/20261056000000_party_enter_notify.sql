-- ====================================================================================================
-- Partidas com 2+ jogadores: aviso de sala completa, espera de todos DENTRO do jogo e desistência
--
-- Rode DEPOIS de 20261055000000_uno_party.sql. Não edita migrações antigas: só redefine, com
-- `create or replace`, funções da estrutura party (`party_json`, `party_seat`, `party_launch`,
-- `party_leave` e `duel_invites`). O fluxo 1×1 não muda.
--
-- Regras novas:
--   * Presença: `last_seen_at` é o batimento de quem está na página do jogo (party_state/party_ready).
--     `party_json` devolve `inside` por jogador e `allInside` na sala. A contagem de largada só começa
--     quando TODOS os jogadores estão dentro — quem estiver navegando em outra página recebe um aviso
--     global e entra por ele.
--   * Aviso global (`duel_invites`):
--       - 1×1 continua igual; salas party de 2 jogadores usam o mesmo texto ("X entrou na sua sala");
--       - party de 3+ jogadores: quando a sala lota e todos ficam prontos, avisa quem ainda não abriu o
--         jogo ("A sala criada do game X está completa");
--       - desistência na espera: avisa quem ficou ("X desistiu" / "O criador da sala desistiu").
--   * `party_leave` guarda o último evento da espera em `party_games.last_event` antes de liberar a
--     vaga: a sala continua aberta esperando outro jogador.
-- ====================================================================================================

alter table public.party_games add column if not exists last_event jsonb;

-- ----------------------------------------------------------------------------------------------------
-- 1. JSON da sala: além de `away` (90 s), informa `inside` (20 s) por jogador e `allInside` na sala.
--    `inside` só importa na espera; em jogo/fim todos contam como dentro.
-- ----------------------------------------------------------------------------------------------------
create or replace function public.party_json(p_uid uuid, p_duel uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_d public.duels;
  v_g public.party_games;
  v_n int;
  v_ready int;
  v_inside int;
  v_me smallint;
begin
  select * into v_d from public.duels where id = p_duel;
  if not found or v_d.kind <> 'party' then raise exception 'duel_not_found' using errcode = '22023'; end if;
  select * into v_g from public.party_games where duel_id = p_duel;

  select count(*), count(*) filter (where ready), max(seat) filter (where user_id = p_uid),
         count(*) filter (where coalesce(last_seen_at, joined_at) >= now() - interval '20 seconds')
    into v_n, v_ready, v_me, v_inside
    from public.duel_players where duel_id = p_duel;

  return jsonb_build_object(
    'id', v_d.id, 'code', v_d.code, 'gameId', v_d.game_id, 'kind', v_d.kind,
    'status', v_d.status, 'startsAt', v_d.starts_at, 'finishedAt', v_d.finished_at,
    'expiresAt', v_d.expires_at, 'serverNow', now(), 'maxSeconds', v_d.max_seconds,
    'open', v_d.is_open, 'createdBy', v_d.created_by, 'cancelReason', v_d.cancel_reason,
    'minPlayers', v_d.min_players, 'maxPlayers', v_d.max_players,
    'full', v_n >= v_d.max_players,
    'canLaunch', v_d.status = 'waiting' and v_n >= v_d.min_players and v_ready = v_n,
    'allInside', v_d.status = 'waiting' and v_n > 0 and v_inside = v_n,
    'mySeat', v_me,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', dp.user_id,
        'nickname', coalesce(p.nickname, p.name),
        'avatar', p.avatar,
        'seat', dp.seat,
        'ready', dp.ready,
        'out', dp.out_at is not null,
        'placement', dp.placement,
        'is_me', dp.user_id = p_uid,
        'host', dp.user_id = v_d.created_by,
        'away', v_d.status = 'waiting' and coalesce(dp.last_seen_at, dp.joined_at) < now() - interval '90 seconds',
        'inside', v_d.status <> 'waiting'
                  or coalesce(dp.last_seen_at, dp.joined_at) >= now() - interval '20 seconds'
      ) order by dp.seat, dp.joined_at)
      from public.duel_players dp
      join public.profiles p on p.id = dp.user_id
      where dp.duel_id = p_duel
    ), '[]'::jsonb),
    'winner', (
      select jsonb_build_object('user_id', p.id, 'nickname', coalesce(p.nickname, p.name), 'avatar', p.avatar)
        from public.profiles p where p.id = v_d.winner_id
    ),
    'party', jsonb_build_object(
      'version', v_g.version,
      'order', v_g.order_mode,
      'turnSeat', v_g.turn_seat,
      'turnSeconds', v_g.turn_seconds,
      'onTimeout', v_g.on_timeout,
      'turnEndsAt', case when v_d.status = 'running' and v_g.turn_seconds is not null
                          and v_g.turn_seat is not null and v_g.turn_started_at is not null
                         then v_g.turn_started_at + make_interval(secs => v_g.turn_seconds) end,
      'moves', v_g.moves,
      'last', v_g.last_move,
      'ranking', v_g.ranking,
      'reason', v_g.reason
    )
  );
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 2. Entrar: ao ocupar uma vaga nova, o recado de desistência anterior deixa de valer (a sala voltou a
--    se completar). Continua sem marcar o convidado como pronto.
-- ----------------------------------------------------------------------------------------------------
create or replace function public.party_seat(p_uid uuid, p_duel public.duels) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_seat smallint;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_duel.kind <> 'party' then raise exception 'not_party_duel' using errcode = '22023'; end if;
  if p_duel.status <> 'waiting' then raise exception 'bad_status' using errcode = '55000'; end if;
  if p_duel.expires_at < now() then raise exception 'expired' using errcode = '55000'; end if;

  if not exists (select 1 from public.duel_players where duel_id = p_duel.id and user_id = p_uid) then
    if (select count(*) from public.duel_players where duel_id = p_duel.id) >= p_duel.max_players then
      raise exception 'duel_full' using errcode = '55000';
    end if;
    select min(s) into v_seat
      from generate_series(1, p_duel.max_players) s
     where not exists (select 1 from public.duel_players where duel_id = p_duel.id and seat = s);
    insert into public.duel_players (duel_id, user_id, ready, seat, last_seen_at)
    values (p_duel.id, p_uid, false, v_seat, now());
    update public.party_games set last_event = null where duel_id = p_duel.id;
    update public.duels set expires_at = greatest(expires_at, now() + interval '10 minutes') where id = p_duel.id;
  end if;

  return public.party_json(p_uid, p_duel.id);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 3. Lançamento: além de lotada e pronta, a sala exige todos DENTRO do jogo (heartbeat recente).
--    Sem isso, quem ainda está em outra página perderia o início da partida.
-- ----------------------------------------------------------------------------------------------------
create or replace function public.party_launch(
  p_uid uuid, p_duel uuid, p_roster jsonb, p_state jsonb, p_turn int
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_d public.duels;
  v_g public.party_games;
  v_n int;
  v_ready int;
  v_current jsonb;
  v_i smallint;
  v_row record;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' then raise exception 'bad_state' using errcode = '22023'; end if;

  select * into v_d from public.duels where id = p_duel for update;
  if not found or v_d.kind <> 'party' then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if not exists (select 1 from public.duel_players where duel_id = p_duel and user_id = p_uid) then
    raise exception 'not_member' using errcode = '55000';
  end if;
  if v_d.status <> 'waiting' then raise exception 'bad_status' using errcode = '55000'; end if;
  if v_d.expires_at < now() then raise exception 'expired' using errcode = '55000'; end if;

  select count(*), count(*) filter (where ready) into v_n, v_ready from public.duel_players where duel_id = p_duel;
  if v_n < v_d.min_players or v_ready <> v_n then raise exception 'not_ready' using errcode = '55000'; end if;
  if p_uid <> v_d.created_by and v_n < v_d.max_players then raise exception 'not_creator' using errcode = '55000'; end if;
  if exists (
    select 1 from public.duel_players
     where duel_id = p_duel
       and coalesce(last_seen_at, joined_at) < now() - interval '20 seconds'
  ) then
    raise exception 'not_all_inside' using errcode = '55000';
  end if;

  select jsonb_agg(user_id order by seat) into v_current from public.duel_players where duel_id = p_duel;
  if p_roster is distinct from v_current then raise exception 'roster_changed' using errcode = '55000'; end if;

  select * into v_g from public.party_games where duel_id = p_duel for update;
  if v_g.order_mode = 'turns' then
    if p_turn is null or p_turn < 1 or p_turn > v_n then raise exception 'bad_state' using errcode = '22023'; end if;
  else
    p_turn := null;
  end if;

  -- assentos 1..n sem buracos. Em ordem crescente cada jogador só desce (ou fica), e o assento de destino
  -- já foi liberado por quem veio antes: o índice único nunca vê dois jogadores no mesmo assento.
  v_i := 0;
  for v_row in select user_id from public.duel_players where duel_id = p_duel order by seat loop
    v_i := v_i + 1;
    update public.duel_players set seat = v_i where duel_id = p_duel and user_id = v_row.user_id;
  end loop;

  update public.duels
     set status = 'running', starts_at = now() + interval '4 seconds', max_players = v_n
   where id = p_duel
   returning * into v_d;

  update public.party_games
     set state = p_state, version = 0, turn_seat = p_turn, moves = 0, last_move = null,
         turn_started_at = case when p_turn is null then null else v_d.starts_at end,
         last_event = null, updated_at = now()
   where duel_id = p_duel;

  return public.party_json(p_uid, p_duel);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 4. Sair/desistir: na espera, registra o evento ANTES de liberar a vaga. Se era o criador, o evento é
--    `host_left` (o aviso diz que o criador desistiu); a sala continua aberta e passa para o próximo.
-- ----------------------------------------------------------------------------------------------------
create or replace function public.party_leave(p_uid uuid, p_duel uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_d public.duels;
  v_next uuid;
  v_nickname text;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into v_d from public.duels where id = p_duel for update;
  if not found or v_d.kind <> 'party' then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if not exists (select 1 from public.duel_players where duel_id = p_duel and user_id = p_uid) then
    raise exception 'not_member' using errcode = '55000';
  end if;

  if v_d.status = 'waiting' then
    select coalesce(p.nickname, p.name) into v_nickname from public.profiles p where p.id = p_uid;
    update public.party_games
       set last_event = jsonb_build_object(
             'kind',   case when v_d.created_by = p_uid then 'host_left' else 'left' end,
             'userId', p_uid,
             'nickname', v_nickname,
             'at',     now()
           )
     where duel_id = p_duel;

    delete from public.duel_players where duel_id = p_duel and user_id = p_uid;
    select user_id into v_next from public.duel_players where duel_id = p_duel order by seat, joined_at limit 1;
    if v_next is null then
      update public.duels set status = 'cancelled', cancel_reason = 'empty' where id = p_duel;
      return jsonb_build_object('status', 'cancelled');
    end if;
    if v_d.created_by = p_uid then
      update public.duels set created_by = v_next where id = p_duel;
      update public.duel_players set ready = true where duel_id = p_duel and user_id = v_next;
    end if;
    return jsonb_build_object('status', 'waiting');
  end if;

  if v_d.status = 'running' then
    perform public.party_eliminate(p_duel, p_uid, 'resign');
    return public.party_json(p_uid, p_duel);
  end if;

  return jsonb_build_object('status', v_d.status);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 5. Aviso global: devolve convites (1×1, party de 2 e party cheia de 3+) e recados de desistência.
--    priority só ordena: convite primeiro; o cliente mostra o recado na mesma rodada.
-- ----------------------------------------------------------------------------------------------------
create or replace function public.duel_invites(p_uid uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  return coalesce((
    select jsonb_agg(q.invite order by q.priority, q.created_at desc)
    from (
      -- 1×1 e party de 2 jogadores: o criador recebe o aviso clássico ("X entrou na sua sala").
      select 0 as priority, d.created_at,
             jsonb_build_object(
               'id',         d.id,
               'code',       d.code,
               'gameId',     d.game_id,
               'kind',       d.kind,
               'level',      d.level,
               'maxSeconds', d.max_seconds,
               'createdAt',  d.created_at,
               'expiresAt',  d.expires_at,
               'maxPlayers', d.max_players,
               'opponent',   (
                 select jsonb_build_object(
                   'nickname', coalesce(p.nickname, p.name),
                   'avatar',   p.avatar,
                   'ready',    dp.ready,
                   'away',     coalesce(dp.last_seen_at, dp.joined_at) < now() - interval '90 seconds'
                 )
                 from public.duel_players dp
                 join public.profiles p on p.id = dp.user_id
                 where dp.duel_id = d.id and dp.user_id <> p_uid
                 limit 1
               )
             ) as invite
        from public.duels d
       where d.created_by = p_uid
         and (d.kind <> 'party' or d.max_players = 2)
         and d.status = 'waiting'
         and d.expires_at > now()
         and (select count(*) from public.duel_players dp where dp.duel_id = d.id) = 2
         and exists (select 1 from public.duel_players dp
                      where dp.duel_id = d.id and dp.user_id <> p_uid and dp.ready)

      union all

      -- Party de 3+ jogadores: sala cheia e todos prontos. Só avisa quem ainda NÃO está no jogo.
      select 1 as priority, d.created_at,
             jsonb_build_object(
               'id',         d.id,
               'code',       d.code,
               'gameId',     d.game_id,
               'kind',       d.kind,
               'level',      d.level,
               'maxSeconds', d.max_seconds,
               'createdAt',  d.created_at,
               'expiresAt',  d.expires_at,
               'maxPlayers', d.max_players,
               'party',      jsonb_build_object(
                               'players',    (select count(*) from public.duel_players dp where dp.duel_id = d.id),
                               'maxPlayers', d.max_players
                             ),
               'opponent',   (
                 select jsonb_build_object(
                   'nickname', coalesce(p.nickname, p.name),
                   'avatar',   p.avatar,
                   'ready',    true,
                   'away',     false
                 )
                 from public.profiles p where p.id = d.created_by
               )
             ) as invite
        from public.duels d
       where d.kind = 'party'
         and d.max_players > 2
         and d.status = 'waiting'
         and d.expires_at > now()
         and exists (select 1 from public.duel_players dp
                      where dp.duel_id = d.id and dp.user_id = p_uid
                        and coalesce(dp.last_seen_at, dp.joined_at) < now() - interval '20 seconds')
         and (select count(*) from public.duel_players dp where dp.duel_id = d.id) = d.max_players
         and not exists (select 1 from public.duel_players dp where dp.duel_id = d.id and not dp.ready)

      union all

      -- Desistência na espera: quem ficou recebe o último evento (uma vez só, o cliente deduplica).
      select 2 as priority, d.created_at,
             jsonb_build_object(
               'id',         d.id,
               'code',       d.code,
               'gameId',     d.game_id,
               'kind',       d.kind,
               'level',      d.level,
               'maxSeconds', d.max_seconds,
               'createdAt',  d.created_at,
               'expiresAt',  d.expires_at,
               'maxPlayers', d.max_players,
               'notice',     g.last_event,
               'opponent',   jsonb_build_object(
                               'nickname', g.last_event->>'nickname',
                               'avatar',   (select p.avatar from public.profiles p
                                             where p.id = (g.last_event->>'userId')::uuid),
                               'ready',    false,
                               'away',     false
                             )
             ) as invite
        from public.duels d
        join public.party_games g on g.duel_id = d.id
       where d.kind = 'party'
         and d.status = 'waiting'
         and d.expires_at > now()
         and g.last_event is not null
         and (g.last_event->>'at')::timestamptz > now() - interval '60 seconds'
         and (g.last_event->>'userId')::uuid <> p_uid
         and exists (select 1 from public.duel_players dp where dp.duel_id = d.id and dp.user_id = p_uid)
    ) q
  ), '[]'::jsonb);
end $$;
