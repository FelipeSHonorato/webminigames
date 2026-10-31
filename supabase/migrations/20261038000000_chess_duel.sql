-- ====================================================================================================
-- WebMiniGames · Xadrez 1×1 (duelo por TURNOS)
--
-- Como aplicar: Supabase > SQL Editor > cole este arquivo inteiro > Run
--   ou `supabase db push` (linked project).
--
-- O xadrez não é uma corrida no mesmo puzzle: os jogadores alternam lances e cada um tem o próprio
-- relógio. Por isso a sala ganhou `kind = 'turn'` e uma tabela própria (`chess_games`) com FEN, vez,
-- relógios e histórico. O relógio é do POSTGRES (`now()`): a Edge só valida o lance com o domínio puro
-- e manda o novo estado; quem decide vez, tempo e vencedor é este arquivo.
--
-- Funções novas: chess_create, chess_start, chess_state, chess_move, chess_resign, chess_json.
-- Reaproveitadas: duel_join (assenta a 2ª cor), duel_ready, duel_leave.
-- ====================================================================================================

-- ----------------------------------------------------------------------------------------------------
-- 1. Jogo no catálogo (o hub lê `duel: true` de js/games.js; a Edge valida pelo DUEL do domínio)
-- ----------------------------------------------------------------------------------------------------
insert into public.games (id, title, sort) values ('chess', 'Xadrez', 11)
on conflict (id) do update set title = excluded.title, sort = excluded.sort;

-- ----------------------------------------------------------------------------------------------------
-- 2. Tipo do duelo: corrida (puzzle compartilhado) ou turnos (xadrez)
-- ----------------------------------------------------------------------------------------------------
alter table public.duels add column if not exists kind text not null default 'race';
alter table public.duels drop constraint if exists duels_kind_check;
alter table public.duels add constraint duels_kind_check check (kind in ('race', 'turn'));

-- Em corrida o puzzle é obrigatório; em turnos o estado vive em chess_games.
alter table public.duels alter column public_view drop not null;
alter table public.duels alter column full_puzzle drop not null;
alter table public.duels drop constraint if exists duels_puzzle_check;
alter table public.duels add constraint duels_puzzle_check
  check (kind = 'turn' or (public_view is not null and full_puzzle is not null));

alter table public.duels drop constraint if exists duels_rule_check;
alter table public.duels add constraint duels_rule_check check (rule in ('first', 'words', 'turn'));

-- ----------------------------------------------------------------------------------------------------
-- 3. Estado do xadrez (um por sala)
--    `white_id`/`black_id`: o criador escolhe a cor; o convidado fica com a outra no duel_join.
--    `white_ms`/`black_ms`: relógio de cada jogador; `last_at` marca quando o relógio da vez começou.
--    `white_can_mate`/`black_can_mate`: FIDE 6.9 — tempo esgotado só perde quem ainda pode dar mate.
-- ----------------------------------------------------------------------------------------------------
create table public.chess_games (
  duel_id         uuid primary key references public.duels (id) on delete cascade,
  fen             text not null,
  turn            text not null check (turn in ('w', 'b')),
  version         int not null default 0,
  keys            jsonb not null default '[]'::jsonb,     -- chaves de repetição tripla
  moves           jsonb not null default '[]'::jsonb,     -- [{ uci, san }]
  last_move       jsonb,
  white_id        uuid references public.profiles (id) on delete cascade,
  black_id        uuid references public.profiles (id) on delete cascade,
  white_ms        int not null check (white_ms >= 0),
  black_ms        int not null check (black_ms >= 0),
  white_can_mate  boolean not null default true,
  black_can_mate  boolean not null default true,
  last_at         timestamptz,
  result          text check (result in ('white', 'black', 'draw')),
  reason          text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (white_id is null or black_id is null or white_id <> black_id)
);

alter table public.chess_games enable row level security;

create index if not exists chess_games_white_idx on public.chess_games (white_id);
create index if not exists chess_games_black_idx on public.chess_games (black_id);

-- ----------------------------------------------------------------------------------------------------
-- 4. Payload único (sala + jogadores + estado do xadrez) com os relógios já ajustados
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
-- 5. Criar sala: ritmo (minutos POR JOGADOR) + cor do criador; o estado inicial vem do domínio
-- ----------------------------------------------------------------------------------------------------
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
  if (select count(*) from public.duels
      where created_by = p_uid and status = 'waiting') >= 3 then
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

-- ----------------------------------------------------------------------------------------------------
-- 6. Entrar por código: o convidado ocupa a cor vazia (a outra é a do criador)
--    Mesma função do duelo de corrida, com o assento do xadrez quando `kind = 'turn'`.
-- ----------------------------------------------------------------------------------------------------
create or replace function public.duel_join(p_uid uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
  v_players jsonb;
  v_opp jsonb;
  v_new boolean := false;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into v_duel from public.duels where code = p_code for update;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if v_duel.status <> 'waiting' then raise exception 'bad_status' using errcode = '55000'; end if;
  if v_duel.expires_at < now() then raise exception 'expired' using errcode = '55000'; end if;

  if not exists (select 1 from public.duel_players where duel_id = v_duel.id and user_id = p_uid) then
    if (select count(*) from public.duel_players where duel_id = v_duel.id) >= 2 then
      raise exception 'duel_full' using errcode = '55000';
    end if;
    insert into public.duel_players (duel_id, user_id, ready)
    values (v_duel.id, p_uid, false);
    v_new := true;
  end if;

  -- Xadrez: quem entrou pega a cor que o criador não escolheu.
  if v_new and v_duel.kind = 'turn' then
    update public.chess_games
       set white_id = coalesce(white_id, p_uid),
           black_id = coalesce(black_id, p_uid),
           updated_at = now()
     where duel_id = v_duel.id;
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
  where dp.duel_id = v_duel.id;

  select jsonb_build_object(
    'user_id', dp.user_id,
    'nickname', coalesce(p.nickname, p.name),
    'avatar', p.avatar,
    'ready', dp.ready
  ) into v_opp
  from public.duel_players dp
  join public.profiles p on p.id = dp.user_id
  where dp.duel_id = v_duel.id and dp.user_id <> p_uid
  limit 1;

  return jsonb_build_object(
    'id', v_duel.id, 'code', v_duel.code, 'gameId', v_duel.game_id,
    'kind', v_duel.kind, 'level', v_duel.level, 'rule', v_duel.rule,
    'maxSeconds', v_duel.max_seconds,
    'players', v_players, 'opponent', v_opp
  );
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 7. Estado / reconexão. O relógio anda só no turno de quem joga; o estouro é decidido aqui.
-- ----------------------------------------------------------------------------------------------------
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
-- 8. Largada explícita (o cliente pode chamar quando a contagem chega a zero)
-- ----------------------------------------------------------------------------------------------------
create or replace function public.chess_start(p_uid uuid, p_duel uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into v_duel from public.duels where id = p_duel;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if v_duel.kind <> 'turn' then raise exception 'not_chess_duel' using errcode = '22023'; end if;
  if v_duel.status <> 'running' then raise exception 'bad_status' using errcode = '55000'; end if;
  if v_duel.starts_at is null or now() < v_duel.starts_at then
    raise exception 'not_started' using errcode = '55000';
  end if;

  return public.chess_state(p_uid, p_duel);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 9. Lance: a Edge já validou com o domínio; aqui conferimos a vez, a versão e o relógio.
--    Se o tempo estourou antes do lance, o lance é ignorado e o resultado é o do estouro.
-- ----------------------------------------------------------------------------------------------------
create or replace function public.chess_move(
  p_uid uuid, p_duel uuid, p_version int,
  p_fen text, p_turn text, p_keys jsonb, p_moves jsonb, p_last jsonb,
  p_result text, p_reason text,
  p_white_can_mate boolean, p_black_can_mate boolean
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
  v_chess public.chess_games;
  v_color text;
  v_elapsed numeric;
  v_remaining int;
  v_winner uuid;
  v_timeout_result text;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into v_duel from public.duels where id = p_duel for update;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if v_duel.kind <> 'turn' then raise exception 'not_chess_duel' using errcode = '22023'; end if;
  if v_duel.status <> 'running' then raise exception 'bad_status' using errcode = '55000'; end if;
  if v_duel.starts_at is null or now() < v_duel.starts_at then
    raise exception 'not_started' using errcode = '55000';
  end if;

  select * into v_chess from public.chess_games where duel_id = p_duel for update;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;

  v_color := case
    when v_chess.white_id = p_uid then 'w'
    when v_chess.black_id = p_uid then 'b'
  end;
  if v_color is null then raise exception 'not_member' using errcode = '55000'; end if;
  if v_chess.turn <> v_color then raise exception 'not_your_turn' using errcode = '55000'; end if;
  if p_version is null or p_version <> v_chess.version then
    raise exception 'stale' using errcode = '55000';
  end if;

  if v_chess.last_at is null then
    v_chess.last_at := v_duel.starts_at;
  end if;
  v_elapsed := extract(epoch from (now() - v_chess.last_at)) * 1000;
  v_remaining := floor(
    (case when v_color = 'w' then v_chess.white_ms else v_chess.black_ms end) - v_elapsed
  )::int;

  if v_remaining <= 0 then
    if v_color = 'w' and v_chess.black_can_mate then
      v_winner := v_chess.black_id; v_timeout_result := 'black';
    elsif v_color = 'b' and v_chess.white_can_mate then
      v_winner := v_chess.white_id; v_timeout_result := 'white';
    else
      v_winner := null; v_timeout_result := 'draw';
    end if;

    update public.chess_games
       set white_ms = case when v_color = 'w' then 0 else white_ms end,
           black_ms = case when v_color = 'b' then 0 else black_ms end,
           result = v_timeout_result, reason = 'timeout', last_at = null, updated_at = now()
     where duel_id = p_duel;
    update public.duels
       set status = 'finished', winner_id = v_winner, finished_at = now()
     where id = p_duel;

    select * into v_chess from public.chess_games where duel_id = p_duel;
    return public.chess_json(p_uid, p_duel, v_chess.white_ms, v_chess.black_ms);
  end if;

  update public.chess_games
     set fen = p_fen,
         turn = p_turn,
         version = version + 1,
         keys = coalesce(p_keys, keys),
         moves = coalesce(p_moves, moves),
         last_move = p_last,
         white_ms = case when v_color = 'w' then v_remaining else white_ms end,
         black_ms = case when v_color = 'b' then v_remaining else black_ms end,
         white_can_mate = coalesce(p_white_can_mate, white_can_mate),
         black_can_mate = coalesce(p_black_can_mate, black_can_mate),
         result = p_result,
         reason = p_reason,
         last_at = now(),
         updated_at = now()
   where duel_id = p_duel;

  if p_result is not null then
    v_winner := case p_result
      when 'white' then v_chess.white_id
      when 'black' then v_chess.black_id
    end;
    update public.duels
       set status = 'finished', winner_id = v_winner, finished_at = now()
     where id = p_duel;
  end if;

  select * into v_chess from public.chess_games where duel_id = p_duel;
  return public.chess_json(p_uid, p_duel, v_chess.white_ms, v_chess.black_ms);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 10. Desistir (em waiting, é o mesmo que sair; em running, o adversário vence)
-- ----------------------------------------------------------------------------------------------------
create or replace function public.chess_resign(p_uid uuid, p_duel uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
  v_chess public.chess_games;
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

  select * into v_chess from public.chess_games where duel_id = p_duel for update;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;

  if v_duel.status = 'finished' then
    return public.chess_json(p_uid, p_duel, v_chess.white_ms, v_chess.black_ms);
  end if;
  if v_duel.status <> 'running' then raise exception 'bad_status' using errcode = '55000'; end if;

  v_color := case
    when v_chess.white_id = p_uid then 'w'
    when v_chess.black_id = p_uid then 'b'
  end;
  if v_color is null then raise exception 'not_member' using errcode = '55000'; end if;

  v_winner := case when v_color = 'w' then v_chess.black_id else v_chess.white_id end;

  update public.chess_games
     set result = case when v_color = 'w' then 'black' else 'white' end,
         reason = 'resign', last_at = null, updated_at = now()
   where duel_id = p_duel;
  update public.duels
     set status = 'finished', winner_id = v_winner, finished_at = now()
   where id = p_duel;

  select * into v_chess from public.chess_games where duel_id = p_duel;
  return public.chess_json(p_uid, p_duel, v_chess.white_ms, v_chess.black_ms);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 11. duel_leave: em xadrez running, sair também conta como desistência (grava o motivo)
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
    -- Xadrez: libera a cor de quem saiu para o próximo convidado ocupar o lugar.
    if v_duel.kind = 'turn' then
      update public.chess_games
         set white_id = case when white_id = p_uid then null else white_id end,
             black_id = case when black_id = p_uid then null else black_id end,
             updated_at = now()
       where duel_id = p_duel;
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
      update public.chess_games
         set result = case when white_id = p_uid then 'black' else 'white' end,
             reason = 'resign', last_at = null, updated_at = now()
       where duel_id = p_duel;
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
-- 12. Limpeza: o corte por `max_seconds` só vale para CORRIDA. No xadrez, quem encerra é o relógio
--     de cada jogador (chess_state), que pode durar até 2× o ritmo.
-- ----------------------------------------------------------------------------------------------------
create or replace function public.duel_cleanup() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int := 0;
  v_row_count int;
  v_duel record;
begin
  update public.duels
     set status = 'cancelled'
   where status = 'waiting' and expires_at < now();
  get diagnostics v_row_count = row_count;
  v_count := v_count + v_row_count;

  for v_duel in select id from public.duels
                where status = 'running'
                  and kind = 'race'
                  and rule = 'words'
                  and starts_at is not null
                  and now() > starts_at + make_interval(secs => max_seconds)
  loop
    perform public.duel_settle(v_duel.id);
    v_count := v_count + 1;
  end loop;

  update public.duels
     set status = 'finished', finished_at = now()
   where status = 'running'
     and kind = 'race'
     and starts_at is not null
     and now() > starts_at + make_interval(secs => max_seconds)
     and winner_id is null;
  get diagnostics v_row_count = row_count;
  v_count := v_count + v_row_count;

  return v_count;
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 13. Permissões (só a Edge com service_role executa; o navegador nunca lê chess_games direto)
-- ----------------------------------------------------------------------------------------------------
revoke all on public.chess_games from anon, authenticated;

revoke all on function public.chess_json(uuid, uuid, int, int) from public, anon, authenticated;
grant execute on function public.chess_json(uuid, uuid, int, int) to service_role;

revoke all on function public.chess_create(uuid, int, text, text, text) from public, anon, authenticated;
grant execute on function public.chess_create(uuid, int, text, text, text) to service_role;

revoke all on function public.chess_start(uuid, uuid) from public, anon, authenticated;
grant execute on function public.chess_start(uuid, uuid) to service_role;

revoke all on function public.chess_state(uuid, uuid) from public, anon, authenticated;
grant execute on function public.chess_state(uuid, uuid) to service_role;

revoke all on function public.chess_move(uuid, uuid, int, text, text, jsonb, jsonb, jsonb, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.chess_move(uuid, uuid, int, text, text, jsonb, jsonb, jsonb, text, text, boolean, boolean) to service_role;

revoke all on function public.chess_resign(uuid, uuid) from public, anon, authenticated;
grant execute on function public.chess_resign(uuid, uuid) to service_role;

-- ====================================================================================================
-- FIM — 20261038000000_chess_duel.sql
-- ====================================================================================================
