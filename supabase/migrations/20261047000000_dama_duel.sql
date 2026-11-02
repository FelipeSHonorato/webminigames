-- ====================================================================================================
-- WebMiniGames · Dama 1×1 (duelo por TURNOS)
--
-- Rode DEPOIS de 20261046000000_duel_invite_when_ready.sql.
--
-- A dama usa o MESMO mecanismo de duelo por turnos do xadrez (sala `kind = 'turn'`, relógio do
-- Postgres, ranking Elo por jogo), mas guarda o estado numa tabela própria (`dama_games`) com a
-- posição serializada em texto, a vez, o relógio de cada jogador e o histórico de caminhos.
--
-- Funções novas: dama_create, dama_start, dama_state, dama_move, dama_resign, dama_json.
-- Funções generalizadas: duel_seat, duel_leave, duel_rating_on_finish (agora escolhem a tabela
-- pelo `game_id`, sem misturar xadrez e dama).
--
-- O ranking é exclusivo da dama: `duel_ratings` já é por (game_id, user_id) e a dama entra com
-- game_id = 'dama' — nenhum rating do xadrez é afetado.
-- ====================================================================================================

-- ----------------------------------------------------------------------------------------------------
-- 1. Jogo no catálogo (o hub lê `duel: true` de js/games.js; a Edge valida pelo DUEL do domínio)
-- ----------------------------------------------------------------------------------------------------
insert into public.games (id, title, sort) values ('dama', 'Dama', 12)
on conflict (id) do update set title = excluded.title, sort = excluded.sort;

-- ----------------------------------------------------------------------------------------------------
-- 2. Estado da dama (um por sala)
--    `position`: 8 fileiras separadas por "/" (rank 7 → 0), P/D brancas e p/d pretas.
--    `white_id`/`black_id`: o criador escolhe a cor; o convidado fica com a outra no duel_seat.
--    `white_ms`/`black_ms`: relógio de cada jogador; `last_at` marca quando o relógio da vez começou.
--    Não existe "material insuficiente": no tempo esgotado, quem estourou perde.
-- ----------------------------------------------------------------------------------------------------
create table public.dama_games (
  duel_id         uuid primary key references public.duels (id) on delete cascade,
  position        text not null,
  turn            text not null check (turn in ('w', 'b')),
  version         int not null default 0,
  keys            jsonb not null default '[]'::jsonb,     -- chaves de repetição tripla
  moves           jsonb not null default '[]'::jsonb,     -- [{ path, captures, captureCount, promotion }]
  last_move       jsonb,
  white_id        uuid references public.profiles (id) on delete cascade,
  black_id        uuid references public.profiles (id) on delete cascade,
  white_ms        int not null check (white_ms >= 0),
  black_ms        int not null check (black_ms >= 0),
  last_at         timestamptz,
  result          text check (result in ('white', 'black', 'draw')),
  reason          text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (white_id is null or black_id is null or white_id <> black_id)
);

alter table public.dama_games enable row level security;

create index if not exists dama_games_white_idx on public.dama_games (white_id);
create index if not exists dama_games_black_idx on public.dama_games (black_id);

-- ----------------------------------------------------------------------------------------------------
-- 3. Payload único (sala + jogadores + estado da dama) com os relógios já ajustados
-- ----------------------------------------------------------------------------------------------------
create or replace function public.dama_json(
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
    'dama', jsonb_build_object(
      'position', g.position,
      'turn', g.turn,
      'version', g.version,
      'keys', g.keys,
      'moves', g.moves,
      'last', g.last_move,
      'clocks', jsonb_build_object('w', p_white_ms, 'b', p_black_ms),
      'colors', jsonb_build_object('white', g.white_id, 'black', g.black_id),
      'result', g.result,
      'reason', g.reason
    )
  )
  from public.duels d
  join public.dama_games g on g.duel_id = d.id
  where d.id = p_duel;
$$;

-- ----------------------------------------------------------------------------------------------------
-- 4. Criar sala: ritmo (minutos POR JOGADOR) + cor do criador; o estado inicial vem do domínio
-- ----------------------------------------------------------------------------------------------------
create or replace function public.dama_create(
  p_uid uuid, p_minutes int, p_color text, p_position text, p_key text, p_open boolean default true
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
  if p_position is null or p_key is null then
    raise exception 'bad_state' using errcode = '22023';
  end if;

  -- UMA sala aberta por vez ('waiting' e ainda não expirada), com lock por usuário.
  perform pg_advisory_xact_lock(hashtextextended('duel_open:' || p_uid::text, 0));
  if (select count(*) from public.duels
      where created_by = p_uid and status = 'waiting' and expires_at > now()) >= 1 then
    raise exception 'too_many_open' using errcode = '55000';
  end if;

  v_ms := p_minutes * 60000;
  v_code := public.duel_gen_code();

  insert into public.duels (
    code, game_id, level, seed, gen, public_view, full_puzzle, rule, kind, max_seconds, created_by, is_open
  ) values (
    v_code, 'dama', 0, 0, 1, null, null, 'turn', 'turn', p_minutes * 60, p_uid, coalesce(p_open, true)
  ) returning * into v_duel;

  insert into public.duel_players (duel_id, user_id, ready)
  values (v_duel.id, p_uid, false);

  insert into public.dama_games (
    duel_id, position, turn, keys, white_id, black_id, white_ms, black_ms
  ) values (
    v_duel.id, p_position, 'w', jsonb_build_array(p_key),
    case when p_color = 'w' then p_uid end,
    case when p_color = 'b' then p_uid end,
    v_ms, v_ms
  );

  return public.dama_json(p_uid, v_duel.id, v_ms, v_ms);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 5. Estado / reconexão. O relógio anda só no turno de quem joga; o estouro é decidido aqui.
--    Na dama não existe empate por material: quem estourou perde sempre.
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

-- ----------------------------------------------------------------------------------------------------
-- 6. Largada explícita (o cliente pode chamar quando a contagem chega a zero)
-- ----------------------------------------------------------------------------------------------------
create or replace function public.dama_start(p_uid uuid, p_duel uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into v_duel from public.duels where id = p_duel;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if v_duel.game_id <> 'dama' then raise exception 'not_dama_duel' using errcode = '22023'; end if;
  if v_duel.status <> 'running' then raise exception 'bad_status' using errcode = '55000'; end if;
  if v_duel.starts_at is null or now() < v_duel.starts_at then
    raise exception 'not_started' using errcode = '55000';
  end if;

  return public.dama_state(p_uid, p_duel);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 7. Lance: a Edge já validou com o domínio; aqui conferimos a vez, a versão e o relógio.
--    Se o tempo estourou antes do lance, o lance é ignorado e o resultado é o do estouro.
-- ----------------------------------------------------------------------------------------------------
create or replace function public.dama_move(
  p_uid uuid, p_duel uuid, p_version int,
  p_position text, p_turn text, p_keys jsonb, p_moves jsonb, p_last jsonb,
  p_result text, p_reason text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
  v_dama public.dama_games;
  v_color text;
  v_elapsed numeric;
  v_remaining int;
  v_winner uuid;
  v_timeout_result text;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into v_duel from public.duels where id = p_duel for update;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if v_duel.game_id <> 'dama' then raise exception 'not_dama_duel' using errcode = '22023'; end if;
  if v_duel.status <> 'running' then raise exception 'bad_status' using errcode = '55000'; end if;
  if v_duel.starts_at is null or now() < v_duel.starts_at then
    raise exception 'not_started' using errcode = '55000';
  end if;

  select * into v_dama from public.dama_games where duel_id = p_duel for update;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;

  v_color := case
    when v_dama.white_id = p_uid then 'w'
    when v_dama.black_id = p_uid then 'b'
  end;
  if v_color is null then raise exception 'not_member' using errcode = '55000'; end if;
  if v_dama.turn <> v_color then raise exception 'not_your_turn' using errcode = '55000'; end if;
  if p_version is null or p_version <> v_dama.version then
    raise exception 'stale' using errcode = '55000';
  end if;

  if v_dama.last_at is null then
    v_dama.last_at := v_duel.starts_at;
  end if;
  v_elapsed := extract(epoch from (now() - v_dama.last_at)) * 1000;
  v_remaining := floor(
    (case when v_color = 'w' then v_dama.white_ms else v_dama.black_ms end) - v_elapsed
  )::int;

  if v_remaining <= 0 then
    -- Dama: tempo esgotado é derrota de quem estourou, sem exceção de material.
    if v_color = 'w' then
      v_winner := v_dama.black_id; v_timeout_result := 'black';
    else
      v_winner := v_dama.white_id; v_timeout_result := 'white';
    end if;

    update public.dama_games
       set white_ms = case when v_color = 'w' then 0 else white_ms end,
           black_ms = case when v_color = 'b' then 0 else black_ms end,
           result = v_timeout_result, reason = 'timeout', last_at = null, updated_at = now()
     where duel_id = p_duel;
    update public.duels
       set status = 'finished', winner_id = v_winner, finished_at = now()
     where id = p_duel;

    select * into v_dama from public.dama_games where duel_id = p_duel;
    return public.dama_json(p_uid, p_duel, v_dama.white_ms, v_dama.black_ms);
  end if;

  update public.dama_games
     set position = p_position,
         turn = p_turn,
         version = version + 1,
         keys = coalesce(p_keys, keys),
         moves = coalesce(p_moves, moves),
         last_move = p_last,
         white_ms = case when v_color = 'w' then v_remaining else white_ms end,
         black_ms = case when v_color = 'b' then v_remaining else black_ms end,
         result = p_result,
         reason = p_reason,
         last_at = now(),
         updated_at = now()
   where duel_id = p_duel;

  if p_result is not null then
    v_winner := case p_result
      when 'white' then v_dama.white_id
      when 'black' then v_dama.black_id
    end;
    update public.duels
       set status = 'finished', winner_id = v_winner, finished_at = now()
     where id = p_duel;
  end if;

  select * into v_dama from public.dama_games where duel_id = p_duel;
  return public.dama_json(p_uid, p_duel, v_dama.white_ms, v_dama.black_ms);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 8. Desistir (em waiting, é o mesmo que sair; em running, o adversário vence)
-- ----------------------------------------------------------------------------------------------------
create or replace function public.dama_resign(p_uid uuid, p_duel uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
  v_dama public.dama_games;
  v_color text;
  v_winner uuid;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into v_duel from public.duels where id = p_duel for update;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if not exists (select 1 from public.duel_players where duel_id = p_duel and user_id = p_uid) then
    raise exception 'not_member' using errcode = '55000';
  end if;

  if v_duel.status = 'waiting' then
    return public.duel_leave(p_uid, p_duel);
  end if;

  select * into v_dama from public.dama_games where duel_id = p_duel for update;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;

  if v_duel.status = 'finished' then
    return public.dama_json(p_uid, p_duel, v_dama.white_ms, v_dama.black_ms);
  end if;
  if v_duel.status <> 'running' then raise exception 'bad_status' using errcode = '55000'; end if;

  v_color := case
    when v_dama.white_id = p_uid then 'w'
    when v_dama.black_id = p_uid then 'b'
  end;
  if v_color is null then raise exception 'not_member' using errcode = '55000'; end if;

  v_winner := case when v_color = 'w' then v_dama.black_id else v_dama.white_id end;

  update public.dama_games
     set result = case when v_color = 'w' then 'black' else 'white' end,
         reason = 'resign', last_at = null, updated_at = now()
   where duel_id = p_duel;
  update public.duels
     set status = 'finished', winner_id = v_winner, finished_at = now()
   where id = p_duel;

  select * into v_dama from public.dama_games where duel_id = p_duel;
  return public.dama_json(p_uid, p_duel, v_dama.white_ms, v_dama.black_ms);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 9. duel_seat: o assento escolhe a tabela do jogo de turnos pelo `game_id`
--    (mesmo corpo da 20261046, só o bloco de assento virou despacho).
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
    -- Quem entra pela lista (ou pelo código) NÃO entra pronto: clica em "Estou pronto".
    insert into public.duel_players (duel_id, user_id, ready)
    values (p_duel.id, p_uid, false);
    v_new := true;
  end if;

  -- Jogo de turnos: quem entrou pega a cor que o criador não escolheu.
  if v_new and p_duel.kind = 'turn' then
    if p_duel.game_id = 'dama' then
      update public.dama_games
         set white_id = coalesce(white_id, p_uid),
             black_id = coalesce(black_id, p_uid),
             updated_at = now()
       where duel_id = p_duel.id;
    else
      update public.chess_games
         set white_id = coalesce(white_id, p_uid),
             black_id = coalesce(black_id, p_uid),
             updated_at = now()
       where duel_id = p_duel.id;
    end if;
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
-- 10. duel_leave: em jogo de turnos, sair também conta como desistência (grava o motivo)
--     e libera a cor de quem saiu no lobby. A tabela muda conforme o jogo.
-- ----------------------------------------------------------------------------------------------------
create or replace function public.duel_leave(p_uid uuid, p_duel uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
  v_other uuid;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into v_duel from public.duels where id = p_duel for update;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if not exists (select 1 from public.duel_players where duel_id = p_duel and user_id = p_uid) then
    raise exception 'not_member' using errcode = '55000';
  end if;

  if v_duel.status = 'waiting' then
    if p_uid = v_duel.created_by then
      update public.duels set status = 'cancelled' where id = p_duel;
      return jsonb_build_object('status', 'cancelled');
    end if;
    -- Jogo de turnos: libera a cor de quem saiu para o próximo convidado ocupar o lugar.
    if v_duel.kind = 'turn' then
      if v_duel.game_id = 'dama' then
        update public.dama_games
           set white_id = case when white_id = p_uid then null else white_id end,
               black_id = case when black_id = p_uid then null else black_id end,
               updated_at = now()
         where duel_id = p_duel;
      else
        update public.chess_games
           set white_id = case when white_id = p_uid then null else white_id end,
               black_id = case when black_id = p_uid then null else black_id end,
               updated_at = now()
         where duel_id = p_duel;
      end if;
    end if;
    delete from public.duel_players where duel_id = p_duel and user_id = p_uid;
    if not exists (select 1 from public.duel_players where duel_id = p_duel) then
      update public.duels set status = 'cancelled' where id = p_duel;
      return jsonb_build_object('status', 'cancelled');
    end if;
    return jsonb_build_object('status', 'waiting');
  end if;

  if v_duel.status = 'running' then
    select user_id into v_other from public.duel_players where duel_id = p_duel and user_id <> p_uid;
    if v_duel.kind = 'turn' then
      if v_duel.game_id = 'dama' then
        update public.dama_games
           set result = case when white_id = p_uid then 'black' else 'white' end,
               reason = 'resign', last_at = null, updated_at = now()
         where duel_id = p_duel;
      else
        update public.chess_games
           set result = case when white_id = p_uid then 'black' else 'white' end,
               reason = 'resign', last_at = null, updated_at = now()
         where duel_id = p_duel;
      end if;
    end if;
    update public.duels
       set winner_id = v_other, status = 'finished', finished_at = now()
     where id = p_duel;
    update public.duel_players set finished_at = now() where duel_id = p_duel and user_id = p_uid;
    return jsonb_build_object('status', 'forfeited', 'winner', v_other);
  end if;

  return jsonb_build_object('status', v_duel.status);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 11. Gatilho do ranking: no fim do duelo escolhe a tabela do jogo (dama ou xadrez).
--     `winner_id` decide os duelos de corrida; nos jogos de turnos o `result` manda.
-- ----------------------------------------------------------------------------------------------------
create or replace function public.duel_rating_on_finish() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_players uuid[];
  v_winner  uuid;
  v_score   numeric;
begin
  if new.status <> 'finished' or old.status is not distinct from new.status then
    return new;
  end if;

  select array_agg(dp.user_id order by dp.user_id) into v_players
    from public.duel_players dp
   where dp.duel_id = new.id;

  if coalesce(array_length(v_players, 1), 0) <> 2 then
    return new;
  end if;

  if new.game_id = 'dama' then
    select case g.result
             when 'white' then g.white_id
             when 'black' then g.black_id
           end
      into v_winner
      from public.dama_games g
     where g.duel_id = new.id;
  elsif new.kind = 'turn' then
    select case c.result
             when 'white' then c.white_id
             when 'black' then c.black_id
           end
      into v_winner
      from public.chess_games c
     where c.duel_id = new.id;
  end if;

  if v_winner is null then
    v_winner := new.winner_id;
  end if;

  v_score := case
    when v_winner is null then 0.5
    when v_winner = v_players[1] then 1
    else 0
  end;

  perform public.duel_rating_record(new.game_id, v_players[1], v_players[2], v_score);
  return new;
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 12. Permissões (só a Edge com service_role executa; o navegador nunca lê dama_games direto)
-- ----------------------------------------------------------------------------------------------------
revoke all on public.dama_games from anon, authenticated;

revoke all on function public.dama_json(uuid, uuid, int, int) from public, anon, authenticated;
grant execute on function public.dama_json(uuid, uuid, int, int) to service_role;

revoke all on function public.dama_create(uuid, int, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.dama_create(uuid, int, text, text, text, boolean) to service_role;

revoke all on function public.dama_start(uuid, uuid) from public, anon, authenticated;
grant execute on function public.dama_start(uuid, uuid) to service_role;

revoke all on function public.dama_state(uuid, uuid) from public, anon, authenticated;
grant execute on function public.dama_state(uuid, uuid) to service_role;

revoke all on function public.dama_move(uuid, uuid, int, text, text, jsonb, jsonb, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.dama_move(uuid, uuid, int, text, text, jsonb, jsonb, jsonb, text, text) to service_role;

revoke all on function public.dama_resign(uuid, uuid) from public, anon, authenticated;
grant execute on function public.dama_resign(uuid, uuid) to service_role;

revoke all on function public.duel_seat(uuid, public.duels) from public, anon, authenticated;
revoke all on function public.duel_leave(uuid, uuid) from public, anon, authenticated;
grant execute on function public.duel_leave(uuid, uuid) to service_role;
revoke all on function public.duel_rating_on_finish() from public, anon, authenticated;
grant execute on function public.duel_rating_on_finish() to service_role;

-- ====================================================================================================
-- FIM — 20261047000000_dama_duel.sql
-- ====================================================================================================
