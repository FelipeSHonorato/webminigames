-- ====================================================================================================
-- WebMiniGames · Go 1×1 (duelo por TURNOS) — ranking Kyu/Dan e handicap automático
--
-- Rode DEPOIS de 20261050000000_gamao_duel.sql.
--
-- O Go usa o MESMO mecanismo de duelo por turnos do xadrez/dama/gamão (sala `kind = 'turn'`, relógio do
-- Postgres, ranking por jogo em `duel_ratings`), mas:
--   • guarda o estado numa tabela própria (`go_games`) com tamanho, tabuleiro em jsonb, vez, relógios,
--     histórico e o resultado da contagem chinesa;
--   • calcula o handicap na hora do "pronto" (`go_ready`): a diferença de graus entre os ratings vira
--     pedras iniciais para o jogador mais fraco, e o komi cai de 6,5 para 0,5;
--   • mostra o rating como grau tradicional (Kyu/Dan) no site, mas o número em `duel_ratings` continua
--     sendo o mesmo Elo por jogo usado pelos outros duelos.
--
-- Funções novas: go_rank_level, go_rank_label, go_handicap, go_handicap_points, go_json, go_create,
-- go_ready, go_start, go_state, go_move, go_resign.
-- Funções generalizadas: duel_seat, duel_leave, duel_rating_on_finish (escolhem a tabela pelo `game_id`).
-- ====================================================================================================

-- ----------------------------------------------------------------------------------------------------
-- 1. Jogo no catálogo (o hub lê `duel: true` de js/games.js; a Edge valida pelo DUEL do domínio)
-- ----------------------------------------------------------------------------------------------------
insert into public.games (id, title, sort) values ('go', 'Go', 14)
on conflict (id) do update set title = excluded.title, sort = excluded.sort;

-- ----------------------------------------------------------------------------------------------------
-- 2. Estado do Go (um por sala)
--    `state`: posição completa do domínio (size/board/turn/captures/ko/passes/handicap/komi/handicapColor).
--    `turn`: cópia da vez, para o relógio e as guardas SQL não dependerem do jsonb.
--    `handicap`/`komi`: calculados no go_ready a partir do ranking (0 pedras = partida equilibrada).
--    `result`: 'white' | 'black' (a contagem chinesa nunca empata por causa do komi .5).
-- ----------------------------------------------------------------------------------------------------
create table public.go_games (
  duel_id         uuid primary key references public.duels (id) on delete cascade,
  size            smallint not null check (size in (9, 13, 19)),
  state           jsonb not null,
  turn            text not null check (turn in ('w', 'b')),
  version         int not null default 0,
  keys            jsonb not null default '[]'::jsonb,
  moves           jsonb not null default '[]'::jsonb,
  last_move       jsonb,
  white_id        uuid references public.profiles (id) on delete cascade,
  black_id        uuid references public.profiles (id) on delete cascade,
  white_ms        int not null check (white_ms >= 0),
  black_ms        int not null check (black_ms >= 0),
  last_at         timestamptz,
  handicap        smallint not null default 0 check (handicap between 0 and 9),
  komi            numeric not null default 6.5,
  result          text check (result in ('white', 'black')),
  reason          text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (white_id is null or black_id is null or white_id <> black_id)
);

alter table public.go_games enable row level security;

create index if not exists go_games_white_idx on public.go_games (white_id);
create index if not exists go_games_black_idx on public.go_games (black_id);

-- ----------------------------------------------------------------------------------------------------
-- 3. Ranking Kyu/Dan (o rating continua sendo o Elo de duel_ratings; o grau é só a leitura)
--    Base: 1500 = 15 kyu. Cada 100 pontos = 1 grau. 0 = 30k, 29 = 1k, 30 = 1d, 38 = 9d.
-- ----------------------------------------------------------------------------------------------------
create or replace function public.go_rank_level(p_rating int) returns int
language sql immutable set search_path = '' as $$
  select greatest(0, least(38, 15 + round((coalesce(p_rating, 1500) - 1500) / 100.0)::int))
$$;

create or replace function public.go_rank_label(p_rating int) returns text
language sql immutable set search_path = '' as $$
  select case
    when public.go_rank_level(p_rating) <= 29
      then (30 - public.go_rank_level(p_rating))::text || ' kyu'
    else (public.go_rank_level(p_rating) - 29)::text || ' dan'
  end
$$;

-- Diferença de graus, limitada a 9 pedras. 1 grau de diferença ainda é partida equilibrada (0 pedras).
create or replace function public.go_handicap(p_rating_a int, p_rating_b int) returns int
language sql immutable set search_path = '' as $$
  select case
    when abs(public.go_rank_level(p_rating_a) - public.go_rank_level(p_rating_b)) < 2 then 0
    else least(9, abs(public.go_rank_level(p_rating_a) - public.go_rank_level(p_rating_b)))
  end
$$;

-- Pontos de handicap na ordem em que são entregues (mesma ordem de games/go/domain.js).
create or replace function public.go_handicap_points(p_size int) returns int[]
language sql immutable set search_path = '' as $$
  select case p_size
    when 9  then array[20, 60, 56, 24, 40, 38, 42, 22, 58]
    when 13 then array[42, 126, 120, 48, 84, 81, 87, 45, 123]
    when 19 then array[60, 300, 288, 72, 180, 174, 186, 66, 294]
    else array[]::int[]
  end
$$;

-- ----------------------------------------------------------------------------------------------------
-- 4. Payload único (sala + jogadores + estado do Go) com os relógios já ajustados
-- ----------------------------------------------------------------------------------------------------
create or replace function public.go_json(
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
    'go', jsonb_build_object(
      'size', g.size,
      'state', g.state,
      'turn', g.turn,
      'version', g.version,
      'keys', g.keys,
      'moves', g.moves,
      'last', g.last_move,
      'handicap', g.handicap,
      'komi', g.komi,
      'clocks', jsonb_build_object('w', p_white_ms, 'b', p_black_ms),
      'colors', jsonb_build_object('white', g.white_id, 'black', g.black_id),
      'result', g.result,
      'reason', g.reason
    )
  )
  from public.duels d
  join public.go_games g on g.duel_id = d.id
  where d.id = p_duel;
$$;

-- ----------------------------------------------------------------------------------------------------
-- 5. Criar sala: tamanho do tabuleiro + ritmo (minutos POR JOGADOR) + cor do criador.
--    O estado inicial vem do domínio SEM handicap: as pedras entram no go_ready, quando os dois
--    ratings já são conhecidos.
-- ----------------------------------------------------------------------------------------------------
create or replace function public.go_create(
  p_uid uuid, p_size int, p_minutes int, p_color text, p_state jsonb, p_key text, p_open boolean default true
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_duel public.duels;
  v_ms int;
  v_turn text;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_size is null or p_size not in (9, 13, 19) then
    raise exception 'bad_size' using errcode = '22023';
  end if;
  if p_minutes is null or p_minutes not in (3, 10, 30, 60) then
    raise exception 'bad_minutes' using errcode = '22023';
  end if;
  if p_color is null or p_color not in ('w', 'b') then
    raise exception 'bad_color' using errcode = '22023';
  end if;
  if p_state is null
     or jsonb_typeof(p_state) is distinct from 'object'
     or (p_state->>'size')::int is distinct from p_size
     or jsonb_typeof(p_state->'board') is distinct from 'array'
     or (case when jsonb_typeof(p_state->'board') = 'array' then jsonb_array_length(p_state->'board') else -1 end) <> p_size * p_size
     or p_key is null then
    raise exception 'bad_state' using errcode = '22023';
  end if;
  v_turn := p_state->>'turn';
  if v_turn is null or v_turn not in ('w', 'b') then
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
    v_code, 'go', 0, 0, 1, null, null, 'turn', 'turn', p_minutes * 60, p_uid, coalesce(p_open, true)
  ) returning * into v_duel;

  insert into public.duel_players (duel_id, user_id, ready)
  values (v_duel.id, p_uid, false);

  insert into public.go_games (
    duel_id, size, state, turn, keys, white_id, black_id, white_ms, black_ms
  ) values (
    v_duel.id, p_size, p_state, v_turn, jsonb_build_array(p_key),
    case when p_color = 'w' then p_uid end,
    case when p_color = 'b' then p_uid end,
    v_ms, v_ms
  );

  return public.go_json(p_uid, v_duel.id, v_ms, v_ms);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 6. Pronto: quando os DOIS marcam, o rating decide o handicap e a partida larga.
--    O jogador mais fraco ganha as pedras (e começa); o komi cai para 0,5.
-- ----------------------------------------------------------------------------------------------------
create or replace function public.go_ready(p_uid uuid, p_duel uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
  v_go public.go_games;
  v_ready int;
  v_uids uuid[];
  v_ratings int[];
  v_levels int[];
  v_handicap int;
  v_komi numeric;
  v_handicap_color text;
  v_turn text;
  v_board jsonb;
  v_board_text text;
  v_key text;
  v_points int[];
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into v_duel from public.duels where id = p_duel for update;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if v_duel.game_id <> 'go' then raise exception 'not_go_duel' using errcode = '22023'; end if;
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
    select * into v_go from public.go_games where duel_id = p_duel for update;
    if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;

    select array_agg(dp.user_id order by dp.joined_at),
           array_agg(coalesce(dr.rating, 1500) order by dp.joined_at)
      into v_uids, v_ratings
      from public.duel_players dp
      left join public.duel_ratings dr on dr.game_id = 'go' and dr.user_id = dp.user_id
     where dp.duel_id = p_duel;

    if coalesce(array_length(v_uids, 1), 0) = 2 then
      v_levels := array[public.go_rank_level(v_ratings[1]), public.go_rank_level(v_ratings[2])];
      v_handicap := public.go_handicap(v_ratings[1], v_ratings[2]);

      if v_handicap > 0 then
        if v_levels[1] < v_levels[2] then
          v_handicap_color := case when v_go.white_id = v_uids[1] then 'w' else 'b' end;
        else
          v_handicap_color := case when v_go.white_id = v_uids[2] then 'w' else 'b' end;
        end if;
        v_turn := v_handicap_color;
      else
        v_handicap_color := null;
        v_turn := 'b';
      end if;

      v_komi := case when v_handicap >= 2 then 0.5 else 6.5 end;
      v_points := coalesce((public.go_handicap_points(v_go.size))[1:v_handicap], array[]::int[]);

      v_board := (
        select jsonb_agg(
          case
            when (i - 1) = any(v_points) then case when v_handicap_color = 'b' then 1 else 2 end
            else 0
          end order by i)
        from generate_series(1, v_go.size * v_go.size) as i
      );
      v_board_text := (
        select string_agg(
          case
            when (i - 1) = any(v_points) then case when v_handicap_color = 'b' then '1' else '2' end
            else '0'
          end, '' order by i)
        from generate_series(1, v_go.size * v_go.size) as i
      );
      v_key := v_go.size::text || ':' || v_board_text || ':' || v_turn;

      update public.go_games
         set state = jsonb_build_object(
               'size', v_go.size,
               'board', v_board,
               'turn', v_turn,
               'captures', jsonb_build_object('b', 0, 'w', 0),
               'ko', null,
               'passes', 0,
               'handicap', v_handicap,
               'komi', v_komi,
               'handicapColor', v_handicap_color
             ),
             turn = v_turn,
             version = 0,
             keys = jsonb_build_array(v_key),
             moves = '[]'::jsonb,
             last_move = null,
             handicap = v_handicap,
             komi = v_komi,
             last_at = null,
             updated_at = now()
       where duel_id = p_duel;
    end if;

    update public.duels
       set status = 'running', starts_at = now() + interval '4 seconds'
     where id = p_duel
     returning * into v_duel;
  end if;

  select * into v_go from public.go_games where duel_id = p_duel;
  return public.go_json(p_uid, p_duel, v_go.white_ms, v_go.black_ms);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 7. Estado / reconexão. O relógio anda só no turno de quem joga; o estouro é decidido aqui.
-- ----------------------------------------------------------------------------------------------------
create or replace function public.go_state(p_uid uuid, p_duel uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
  v_go public.go_games;
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

  -- Presença: quem consulta a sala de espera está na página.
  if v_duel.status = 'waiting' then
    update public.duel_players set last_seen_at = now()
     where duel_id = p_duel and user_id = p_uid;
  end if;

  select * into v_go from public.go_games where duel_id = p_duel for update;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;

  -- Sala waiting expirada (o criador não achou adversário).
  if v_duel.status = 'waiting' and v_duel.expires_at < now() then
    update public.duels set status = 'cancelled', cancel_reason = 'expired' where id = p_duel;
    select * into v_duel from public.duels where id = p_duel;
  end if;

  if v_duel.status = 'running' then
    -- Antes da largada: mostra o tabuleiro e a contagem; nenhum relógio corre ainda.
    if v_duel.starts_at is null or now() < v_duel.starts_at then
      return public.go_json(p_uid, p_duel, v_go.white_ms, v_go.black_ms);
    end if;

    -- Primeira consulta depois da largada: o relógio começou em starts_at, não agora.
    if v_go.last_at is null then
      update public.go_games set last_at = v_duel.starts_at where duel_id = p_duel;
      v_go.last_at := v_duel.starts_at;
    end if;

    v_elapsed := extract(epoch from (now() - v_go.last_at)) * 1000;
    v_remaining := floor(
      (case when v_go.turn = 'w' then v_go.white_ms else v_go.black_ms end) - v_elapsed
    )::int;

    if v_remaining <= 0 then
      if v_go.turn = 'w' then
        v_winner := v_go.black_id; v_result := 'black';
      else
        v_winner := v_go.white_id; v_result := 'white';
      end if;

      update public.go_games
         set white_ms = case when turn = 'w' then 0 else white_ms end,
             black_ms = case when turn = 'b' then 0 else black_ms end,
             result = v_result, reason = 'timeout', last_at = null, updated_at = now()
       where duel_id = p_duel;
      update public.duels
         set status = 'finished', winner_id = v_winner, finished_at = now()
       where id = p_duel;

      select * into v_go from public.go_games where duel_id = p_duel;
      return public.go_json(p_uid, p_duel, v_go.white_ms, v_go.black_ms);
    end if;

    if v_go.turn = 'w' then
      return public.go_json(p_uid, p_duel, v_remaining, v_go.black_ms);
    end if;
    return public.go_json(p_uid, p_duel, v_go.white_ms, v_remaining);
  end if;

  return public.go_json(p_uid, p_duel, v_go.white_ms, v_go.black_ms);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 8. Largada explícita (o cliente pode chamar quando a contagem chega a zero)
-- ----------------------------------------------------------------------------------------------------
create or replace function public.go_start(p_uid uuid, p_duel uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into v_duel from public.duels where id = p_duel;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if v_duel.game_id <> 'go' then raise exception 'not_go_duel' using errcode = '22023'; end if;
  if v_duel.status <> 'running' then raise exception 'bad_status' using errcode = '55000'; end if;
  if v_duel.starts_at is null or now() < v_duel.starts_at then
    raise exception 'not_started' using errcode = '55000';
  end if;

  return public.go_state(p_uid, p_duel);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 9. Lance: a Edge já validou com o domínio; aqui conferimos a vez, a versão e o relógio.
--    Se o tempo estourou antes do lance, o lance é ignorado e o resultado é o do estouro.
-- ----------------------------------------------------------------------------------------------------
create or replace function public.go_move(
  p_uid uuid, p_duel uuid, p_version int,
  p_state jsonb, p_turn text, p_keys jsonb, p_moves jsonb, p_last jsonb,
  p_result text, p_reason text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
  v_go public.go_games;
  v_color text;
  v_elapsed numeric;
  v_remaining int;
  v_winner uuid;
  v_timeout_result text;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_state is null
     or jsonb_typeof(p_state) is distinct from 'object'
     or jsonb_typeof(p_state->'board') is distinct from 'array'
     or (case when jsonb_typeof(p_state->'board') = 'array' then jsonb_array_length(p_state->'board') else -1 end)
        <> coalesce((p_state->>'size')::int, -1) * coalesce((p_state->>'size')::int, -1)
     or p_turn is null or p_turn not in ('w', 'b')
     or (p_result is not null and p_result not in ('white', 'black')) then
    raise exception 'bad_state' using errcode = '22023';
  end if;

  select * into v_duel from public.duels where id = p_duel for update;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if v_duel.game_id <> 'go' then raise exception 'not_go_duel' using errcode = '22023'; end if;
  if v_duel.status <> 'running' then raise exception 'bad_status' using errcode = '55000'; end if;
  if v_duel.starts_at is null or now() < v_duel.starts_at then
    raise exception 'not_started' using errcode = '55000';
  end if;

  select * into v_go from public.go_games where duel_id = p_duel for update;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if (p_state->>'size')::int is distinct from v_go.size then
    raise exception 'bad_state' using errcode = '22023';
  end if;

  v_color := case
    when v_go.white_id = p_uid then 'w'
    when v_go.black_id = p_uid then 'b'
  end;
  if v_color is null then raise exception 'not_member' using errcode = '55000'; end if;
  if v_go.turn <> v_color then raise exception 'not_your_turn' using errcode = '55000'; end if;
  if p_version is null or p_version <> v_go.version then
    raise exception 'stale' using errcode = '55000';
  end if;

  if v_go.last_at is null then
    v_go.last_at := v_duel.starts_at;
  end if;
  v_elapsed := extract(epoch from (now() - v_go.last_at)) * 1000;
  v_remaining := floor(
    (case when v_color = 'w' then v_go.white_ms else v_go.black_ms end) - v_elapsed
  )::int;

  if v_remaining <= 0 then
    -- Go: tempo esgotado é derrota de quem estourou.
    if v_color = 'w' then
      v_winner := v_go.black_id; v_timeout_result := 'black';
    else
      v_winner := v_go.white_id; v_timeout_result := 'white';
    end if;

    update public.go_games
       set white_ms = case when v_color = 'w' then 0 else white_ms end,
           black_ms = case when v_color = 'b' then 0 else black_ms end,
           result = v_timeout_result, reason = 'timeout', last_at = null, updated_at = now()
     where duel_id = p_duel;
    update public.duels
       set status = 'finished', winner_id = v_winner, finished_at = now()
     where id = p_duel;

    select * into v_go from public.go_games where duel_id = p_duel;
    return public.go_json(p_uid, p_duel, v_go.white_ms, v_go.black_ms);
  end if;

  update public.go_games
     set state = p_state,
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
      when 'white' then v_go.white_id
      when 'black' then v_go.black_id
    end;
    update public.duels
       set status = 'finished', winner_id = v_winner, finished_at = now()
     where id = p_duel;
  end if;

  select * into v_go from public.go_games where duel_id = p_duel;
  return public.go_json(p_uid, p_duel, v_go.white_ms, v_go.black_ms);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 10. Desistir (em waiting, é o mesmo que sair; em running, o adversário vence)
-- ----------------------------------------------------------------------------------------------------
create or replace function public.go_resign(p_uid uuid, p_duel uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
  v_go public.go_games;
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

  select * into v_go from public.go_games where duel_id = p_duel for update;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;

  if v_duel.status = 'finished' then
    return public.go_json(p_uid, p_duel, v_go.white_ms, v_go.black_ms);
  end if;
  if v_duel.status <> 'running' then raise exception 'bad_status' using errcode = '55000'; end if;

  v_color := case
    when v_go.white_id = p_uid then 'w'
    when v_go.black_id = p_uid then 'b'
  end;
  if v_color is null then raise exception 'not_member' using errcode = '55000'; end if;

  v_winner := case when v_color = 'w' then v_go.black_id else v_go.white_id end;

  update public.go_games
     set result = case when v_color = 'w' then 'black' else 'white' end,
         reason = 'resign', last_at = null, updated_at = now()
   where duel_id = p_duel;
  update public.duels
     set status = 'finished', winner_id = v_winner, finished_at = now()
   where id = p_duel;

  select * into v_go from public.go_games where duel_id = p_duel;
  return public.go_json(p_uid, p_duel, v_go.white_ms, v_go.black_ms);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 11. duel_seat: o assento escolhe a tabela do jogo de turnos pelo `game_id` (agora também o Go)
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
    if p_duel.game_id = 'go' then
      update public.go_games
         set white_id = coalesce(white_id, p_uid),
             black_id = coalesce(black_id, p_uid),
             updated_at = now()
       where duel_id = p_duel.id;
    elsif p_duel.game_id = 'gamao' then
      update public.gamao_games
         set white_id = coalesce(white_id, p_uid),
             black_id = coalesce(black_id, p_uid),
             updated_at = now()
       where duel_id = p_duel.id;
    elsif p_duel.game_id = 'dama' then
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
-- 12. duel_leave: em jogo de turnos, sair também conta como desistência (grava o motivo)
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
      if v_duel.game_id = 'go' then
        update public.go_games
           set white_id = case when white_id = p_uid then null else white_id end,
               black_id = case when black_id = p_uid then null else black_id end,
               updated_at = now()
         where duel_id = p_duel;
      elsif v_duel.game_id = 'gamao' then
        update public.gamao_games
           set white_id = case when white_id = p_uid then null else white_id end,
               black_id = case when black_id = p_uid then null else black_id end,
               updated_at = now()
         where duel_id = p_duel;
      elsif v_duel.game_id = 'dama' then
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
      if v_duel.game_id = 'go' then
        update public.go_games
           set result = case when white_id = p_uid then 'black' else 'white' end,
               reason = 'resign', last_at = null, updated_at = now()
         where duel_id = p_duel;
      elsif v_duel.game_id = 'gamao' then
        update public.gamao_games
           set result = case when white_id = p_uid then 'black' else 'white' end,
               reason = 'resign', last_at = null, updated_at = now()
         where duel_id = p_duel;
      elsif v_duel.game_id = 'dama' then
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
-- 13. Gatilho do ranking: no fim do duelo escolhe a tabela do jogo (go, gamão, dama ou xadrez).
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

  if new.game_id = 'go' then
    select case g.result
             when 'white' then g.white_id
             when 'black' then g.black_id
           end
      into v_winner
      from public.go_games g
     where g.duel_id = new.id;
  elsif new.game_id = 'gamao' then
    select case g.result
             when 'white' then g.white_id
             when 'black' then g.black_id
           end
      into v_winner
      from public.gamao_games g
     where g.duel_id = new.id;
  elsif new.game_id = 'dama' then
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
-- 14. Permissões (só a Edge com service_role executa; o navegador nunca lê go_games direto)
-- ----------------------------------------------------------------------------------------------------
revoke all on public.go_games from anon, authenticated;

revoke all on function public.go_rank_level(int) from public, anon, authenticated;
grant execute on function public.go_rank_level(int) to service_role;

revoke all on function public.go_rank_label(int) from public, anon, authenticated;
grant execute on function public.go_rank_label(int) to service_role;

revoke all on function public.go_handicap(int, int) from public, anon, authenticated;
grant execute on function public.go_handicap(int, int) to service_role;

revoke all on function public.go_handicap_points(int) from public, anon, authenticated;
grant execute on function public.go_handicap_points(int) to service_role;

revoke all on function public.go_json(uuid, uuid, int, int) from public, anon, authenticated;
grant execute on function public.go_json(uuid, uuid, int, int) to service_role;

revoke all on function public.go_create(uuid, int, int, text, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.go_create(uuid, int, int, text, jsonb, text, boolean) to service_role;

revoke all on function public.go_ready(uuid, uuid) from public, anon, authenticated;
grant execute on function public.go_ready(uuid, uuid) to service_role;

revoke all on function public.go_start(uuid, uuid) from public, anon, authenticated;
grant execute on function public.go_start(uuid, uuid) to service_role;

revoke all on function public.go_state(uuid, uuid) from public, anon, authenticated;
grant execute on function public.go_state(uuid, uuid) to service_role;

revoke all on function public.go_move(uuid, uuid, int, jsonb, text, jsonb, jsonb, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.go_move(uuid, uuid, int, jsonb, text, jsonb, jsonb, jsonb, text, text) to service_role;

revoke all on function public.go_resign(uuid, uuid) from public, anon, authenticated;
grant execute on function public.go_resign(uuid, uuid) to service_role;

revoke all on function public.duel_seat(uuid, public.duels) from public, anon, authenticated;
revoke all on function public.duel_leave(uuid, uuid) from public, anon, authenticated;
grant execute on function public.duel_leave(uuid, uuid) to service_role;
revoke all on function public.duel_rating_on_finish() from public, anon, authenticated;
grant execute on function public.duel_rating_on_finish() to service_role;

-- ====================================================================================================
-- FIM — 20261051000000_go_duel.sql
-- ====================================================================================================
