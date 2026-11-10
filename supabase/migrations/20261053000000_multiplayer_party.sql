-- ====================================================================================================
-- WebMiniGames · Partidas com 2 ou mais jogadores ("party") — estrutura reutilizável
--
-- Rode DEPOIS de 20261052000000_onitama_duel.sql. Rode uma vez (cria a tabela `party_games`); as funções
-- usam `create or replace`.
-- NÃO edita migrações antigas e NÃO redefine as funções do fluxo 1×1 (duel_create/join/seat/ready/leave/
-- state/finish): o 1×1 continua como está. Únicas exceções, todas de leitura/auxiliar: `duel_gen_code` (bug do
-- alfabeto, seção 0), `duel_open_rooms` e `duel_invites` (assumiam 2 jogadores).
--
-- Ideia: a sala continua sendo `duels`/`duel_players` (código, aberta/fechada, presença, Realtime,
-- Salas Online, expiração em 15 min). O que muda é o TIPO da sala: `kind = 'party'`, com
-- `min_players`..`max_players` jogadores. O estado da partida vive em `party_games` (jsonb genérico,
-- versão otimista e vez), e quem despacha para as funções `party_*` é a Edge, pelo `kind` da sala.
--
-- Regras da estrutura:
--   * Assentos: cada jogador tem um `seat` (1..max); quem sai da espera libera o assento.
--   * Início: o criador é "pronto" desde a criação. A partida larga quando há >= min jogadores e TODOS
--     estão prontos, por duas vias: sala lotada (largada automática) ou o criador clica em Iniciar.
--     No lançamento os assentos viram 1..n sem buracos e a Edge entrega o estado inicial (sorteios aqui).
--   * Vez: `order_mode = 'turns'` (vez a vez, com tempo por jogada opcional) ou `'free'` (simultâneo).
--     Estourar o tempo da vez: `on_timeout = 'skip'` passa a vez; `'out'` elimina o jogador.
--   * Fim: o domínio manda o `ranking` (grupos de assentos, melhor primeiro; empate = mesmo grupo).
--     Desistir/sair em jogo ELIMINA o jogador (colocação = quantos ainda estavam na partida);
--     sobrou um só, ele vence. O Postgres decide e grava `placement` de cada jogador.
--   * Sem Elo por enquanto: o gatilho de rating do 1×1 não roda em salas `party`.
--
-- Segurança: RLS ligado e sem policy; só a Edge (service_role) executa as funções.
-- ====================================================================================================

-- ----------------------------------------------------------------------------------------------------
-- 0. Correção do gerador de código de sala (vale para duelos 1×1 e para party)
--    O alfabeto tem 31 caracteres, mas o sorteio usava `random() * 32`: no índice 32 o `substr` devolvia vazio
--    e ~17% dos códigos saíam com menos de 6 letras (alguns com 3). Agora o sorteio usa o tamanho real.
--    Códigos já criados não mudam.
-- ----------------------------------------------------------------------------------------------------
create or replace function public.duel_gen_code() returns text
language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    if not exists (select 1 from public.duels where code = v_code) then
      return v_code;
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 1. `duels`: tipo "party" e limites de jogadores
--    Fora do tipo party a sala continua 2×2 (a restrição impede um 1×1 com vagas diferentes).
-- ----------------------------------------------------------------------------------------------------
alter table public.duels add column if not exists min_players smallint not null default 2;
alter table public.duels add column if not exists max_players smallint not null default 2;

alter table public.duels drop constraint if exists duels_players_check;
alter table public.duels add constraint duels_players_check
  check (min_players >= 2 and max_players >= min_players and max_players <= 12
         and (kind = 'party' or (min_players = 2 and max_players = 2)));

alter table public.duels drop constraint if exists duels_kind_check;
alter table public.duels add constraint duels_kind_check check (kind in ('race', 'turn', 'party'));

alter table public.duels drop constraint if exists duels_puzzle_check;
alter table public.duels add constraint duels_puzzle_check
  check (kind in ('turn', 'party') or (public_view is not null and full_puzzle is not null));

alter table public.duels drop constraint if exists duels_rule_check;
alter table public.duels add constraint duels_rule_check check (rule in ('first', 'words', 'turn', 'party'));

-- ----------------------------------------------------------------------------------------------------
-- 2. `duel_players`: assento, eliminação e colocação final
-- ----------------------------------------------------------------------------------------------------
alter table public.duel_players add column if not exists seat      smallint check (seat between 1 and 12);
alter table public.duel_players add column if not exists out_at    timestamptz;
alter table public.duel_players add column if not exists placement smallint check (placement >= 1);

create unique index if not exists duel_players_seat_uniq
  on public.duel_players (duel_id, seat) where seat is not null;

-- ----------------------------------------------------------------------------------------------------
-- 3. Estado da partida (uma linha por sala party; `state` só existe depois do lançamento)
--    `state` é do jogo (jsonb) e NUNCA sai do servidor: a Edge devolve só a visão de cada jogador.
-- ----------------------------------------------------------------------------------------------------
create table public.party_games (
  duel_id         uuid primary key references public.duels (id) on delete cascade,
  state           jsonb,
  version         int not null default 0,
  order_mode      text not null default 'turns' check (order_mode in ('turns', 'free')),
  turn_seat       smallint,
  turn_seconds    int check (turn_seconds is null or turn_seconds between 5 and 3600),
  on_timeout      text not null default 'skip' check (on_timeout in ('skip', 'out')),
  turn_started_at timestamptz,
  moves           int not null default 0,
  last_move       jsonb,
  ranking         jsonb,                      -- [[seat, ...], ...] melhor primeiro; empate = mesmo grupo
  reason          text,
  updated_at      timestamptz not null default now()
);

alter table public.party_games enable row level security;
revoke all on public.party_games from anon, authenticated;

-- ----------------------------------------------------------------------------------------------------
-- 4. Auxiliares internos (chamados por outras funções security definer; ninguém de fora executa)
-- ----------------------------------------------------------------------------------------------------

-- Próximo assento ATIVO depois de `p_from` (circular). Null se não houver nenhum.
create or replace function public.party_next_seat(p_duel uuid, p_from smallint) returns smallint
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select min(seat) from public.duel_players
      where duel_id = p_duel and out_at is null and seat > coalesce(p_from, 0)),
    (select min(seat) from public.duel_players
      where duel_id = p_duel and out_at is null)
  )::smallint;
$$;

-- Fecha a partida: grava colocações e o vencedor (só se o 1º lugar for um único jogador).
-- `p_ranking`: grupos de assentos ATIVOS, melhor primeiro. Quem já saiu mantém a colocação em que saiu.
create or replace function public.party_finish(p_duel uuid, p_ranking jsonb, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_place int := 1;
  v_group jsonb;
  v_winner uuid;
  v_first int;
begin
  for v_group in select * from jsonb_array_elements(p_ranking) loop
    update public.duel_players
       set placement = v_place
     where duel_id = p_duel and seat in (select jsonb_array_elements_text(v_group)::int);
    if v_place = 1 and jsonb_array_length(v_group) = 1 then
      v_first := (v_group ->> 0)::int;
      select user_id into v_winner from public.duel_players where duel_id = p_duel and seat = v_first;
    end if;
    v_place := v_place + jsonb_array_length(v_group);
  end loop;

  update public.party_games
     set ranking = p_ranking, reason = p_reason, turn_seat = null, turn_started_at = null, updated_at = now()
   where duel_id = p_duel;
  update public.duels
     set status = 'finished', winner_id = v_winner, finished_at = now()
   where id = p_duel;
end $$;

-- Elimina um jogador em partida (desistência, saída ou estouro de tempo com on_timeout = 'out').
create or replace function public.party_eliminate(p_duel uuid, p_uid uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_g public.party_games;
  v_seat smallint;
  v_active int;
  v_left smallint;
begin
  select * into v_g from public.party_games where duel_id = p_duel for update;
  select seat into v_seat from public.duel_players where duel_id = p_duel and user_id = p_uid and out_at is null;
  if v_seat is null then return; end if;

  select count(*) into v_active from public.duel_players where duel_id = p_duel and out_at is null;
  update public.duel_players set out_at = now(), placement = v_active
   where duel_id = p_duel and user_id = p_uid;

  if v_active - 1 <= 1 then
    -- sobrou um só: ele vence (colocação 1)
    select seat into v_left from public.duel_players where duel_id = p_duel and out_at is null;
    perform public.party_finish(p_duel, case when v_left is null then '[]'::jsonb else jsonb_build_array(jsonb_build_array(v_left)) end, p_reason);
    return;
  end if;

  if v_g.order_mode = 'turns' and v_g.turn_seat = v_seat then
    update public.party_games
       set turn_seat = public.party_next_seat(p_duel, v_seat),
           turn_started_at = now(), version = version + 1, updated_at = now()
     where duel_id = p_duel;
  else
    update public.party_games set version = version + 1, updated_at = now() where duel_id = p_duel;
  end if;
end $$;

-- Aplica, de forma preguiçosa, o estouro do tempo da vez (a cada consulta de estado e a cada lance).
-- Recupera vários estouros seguidos (andando `turn_started_at` pelo tempo da vez, não por now()).
create or replace function public.party_apply_timeout(p_duel uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_d public.duels;
  v_g public.party_games;
  v_uid uuid;
  v_guard int := 0;
begin
  select * into v_d from public.duels where id = p_duel for update;
  if not found or v_d.kind <> 'party' or v_d.status <> 'running' then return; end if;

  loop
    select * into v_g from public.party_games where duel_id = p_duel for update;
    exit when not found or v_g.order_mode <> 'turns' or v_g.turn_seconds is null
              or v_g.turn_seat is null or v_g.turn_started_at is null
              or now() <= v_g.turn_started_at + make_interval(secs => v_g.turn_seconds);
    v_guard := v_guard + 1;
    exit when v_guard > 24;

    if v_g.on_timeout = 'out' then
      select user_id into v_uid from public.duel_players where duel_id = p_duel and seat = v_g.turn_seat;
      perform public.party_eliminate(p_duel, v_uid, 'timeout');
      select * into v_d from public.duels where id = p_duel;
      exit when v_d.status <> 'running';
    else
      update public.party_games
         set turn_seat = public.party_next_seat(p_duel, v_g.turn_seat),
             turn_started_at = v_g.turn_started_at + make_interval(secs => v_g.turn_seconds),
             version = version + 1, updated_at = now()
       where duel_id = p_duel;
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 5. JSON da sala (o que o navegador recebe). Nunca inclui `state`: a Edge junta a visão do jogador.
-- ----------------------------------------------------------------------------------------------------
create or replace function public.party_json(p_uid uuid, p_duel uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_d public.duels;
  v_g public.party_games;
  v_n int;
  v_ready int;
  v_me smallint;
begin
  select * into v_d from public.duels where id = p_duel;
  if not found or v_d.kind <> 'party' then raise exception 'duel_not_found' using errcode = '22023'; end if;
  select * into v_g from public.party_games where duel_id = p_duel;

  select count(*), count(*) filter (where ready), max(seat) filter (where user_id = p_uid)
    into v_n, v_ready, v_me
    from public.duel_players where duel_id = p_duel;

  return jsonb_build_object(
    'id', v_d.id, 'code', v_d.code, 'gameId', v_d.game_id, 'kind', v_d.kind,
    'status', v_d.status, 'startsAt', v_d.starts_at, 'finishedAt', v_d.finished_at,
    'expiresAt', v_d.expires_at, 'serverNow', now(), 'maxSeconds', v_d.max_seconds,
    'open', v_d.is_open, 'createdBy', v_d.created_by, 'cancelReason', v_d.cancel_reason,
    'minPlayers', v_d.min_players, 'maxPlayers', v_d.max_players,
    'full', v_n >= v_d.max_players,
    'canLaunch', v_d.status = 'waiting' and v_n >= v_d.min_players and v_ready = v_n,
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
        'away', v_d.status = 'waiting' and coalesce(dp.last_seen_at, dp.joined_at) < now() - interval '90 seconds'
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
-- 6. Criar sala. Limites e regras vêm do contrato PARTY do domínio (a Edge valida antes de chamar).
--    Uma sala em espera por usuário (mesmo limite dos duelos 1×1).
-- ----------------------------------------------------------------------------------------------------
create or replace function public.party_create(
  p_uid uuid, p_game text, p_min int, p_max int, p_open boolean,
  p_order text, p_turn_seconds int, p_on_timeout text, p_max_seconds int
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.games where id = p_game) then
    raise exception 'unknown_game' using errcode = '22023';
  end if;
  if p_min is null or p_max is null or p_min < 2 or p_max < p_min or p_max > 12 then
    raise exception 'bad_players' using errcode = '22023';
  end if;
  if p_order is null or p_order not in ('turns', 'free') then raise exception 'bad_order' using errcode = '22023'; end if;
  if p_on_timeout is null or p_on_timeout not in ('skip', 'out') then raise exception 'bad_timeout' using errcode = '22023'; end if;
  if p_turn_seconds is not null and (p_turn_seconds < 5 or p_turn_seconds > 3600) then
    raise exception 'bad_turn_seconds' using errcode = '22023';
  end if;
  if p_max_seconds is null or p_max_seconds < 30 or p_max_seconds > 3600 then
    raise exception 'bad_max_seconds' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('duel_open:' || p_uid::text, 0));
  if (select count(*) from public.duels
      where created_by = p_uid and status = 'waiting' and expires_at > now()) >= 1 then
    raise exception 'too_many_open' using errcode = '55000';
  end if;

  insert into public.duels (
    code, game_id, level, seed, gen, public_view, full_puzzle, rule, kind, max_seconds,
    created_by, is_open, min_players, max_players
  ) values (
    public.duel_gen_code(), p_game, 0, 0, 1, null, null, 'party', 'party', p_max_seconds,
    p_uid, coalesce(p_open, true), p_min, p_max
  ) returning * into v_duel;

  -- O criador ocupa o assento 1 e já está pronto: só os convidados precisam clicar em "Estou pronto".
  insert into public.duel_players (duel_id, user_id, ready, seat, last_seen_at)
  values (v_duel.id, p_uid, true, 1, now());

  insert into public.party_games (duel_id, order_mode, turn_seconds, on_timeout)
  values (v_duel.id, p_order, p_turn_seconds, p_on_timeout);

  return public.party_json(p_uid, v_duel.id);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 7. Entrar: assento livre mais baixo, sem estar pronto. Cada entrada estende a espera da sala.
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
    update public.duels set expires_at = greatest(expires_at, now() + interval '10 minutes') where id = p_duel.id;
  end if;

  return public.party_json(p_uid, p_duel.id);
end $$;

create or replace function public.party_join(p_uid uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into v_duel from public.duels where code = p_code for update;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;
  return public.party_seat(p_uid, v_duel);
end $$;

create or replace function public.party_join_open(p_uid uuid, p_duel uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into v_duel from public.duels where id = p_duel for update;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if not v_duel.is_open then raise exception 'closed_room' using errcode = '55000'; end if;
  return public.party_seat(p_uid, v_duel);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 8. Pronto / não pronto (o criador é sempre pronto). Devolve `canLaunch` e `full`: a Edge decide se larga.
-- ----------------------------------------------------------------------------------------------------
create or replace function public.party_ready(p_uid uuid, p_duel uuid, p_ready boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into v_duel from public.duels where id = p_duel for update;
  if not found or v_duel.kind <> 'party' then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if not exists (select 1 from public.duel_players where duel_id = p_duel and user_id = p_uid) then
    raise exception 'not_member' using errcode = '55000';
  end if;
  if v_duel.status <> 'waiting' then raise exception 'bad_status' using errcode = '55000'; end if;
  if v_duel.expires_at < now() then raise exception 'expired' using errcode = '55000'; end if;

  update public.duel_players
     set ready = (user_id = v_duel.created_by) or coalesce(p_ready, true), last_seen_at = now()
   where duel_id = p_duel and user_id = p_uid;

  return public.party_json(p_uid, p_duel);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 9. Lançamento. A Edge lê o elenco (`party_roster`), sorteia/monta o estado inicial com o domínio e
--    chama `party_launch` com o MESMO elenco: se alguém entrou/saiu no meio, volta `roster_changed`.
--    Quem pode lançar: o criador, ou qualquer membro quando a sala está lotada e todos prontos.
-- ----------------------------------------------------------------------------------------------------
create or replace function public.party_roster(p_duel uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_d public.duels;
  v_g public.party_games;
begin
  select * into v_d from public.duels where id = p_duel;
  if not found or v_d.kind <> 'party' then raise exception 'duel_not_found' using errcode = '22023'; end if;
  select * into v_g from public.party_games where duel_id = p_duel;
  return jsonb_build_object(
    'status', v_d.status, 'gameId', v_d.game_id, 'createdBy', v_d.created_by,
    'minPlayers', v_d.min_players, 'maxPlayers', v_d.max_players,
    'order', v_g.order_mode,
    'roster', coalesce((select jsonb_agg(user_id order by seat) from public.duel_players where duel_id = p_duel), '[]'::jsonb),
    'ready', coalesce((select bool_and(ready) from public.duel_players where duel_id = p_duel), false)
  );
end $$;

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
         updated_at = now()
   where duel_id = p_duel;

  return public.party_json(p_uid, p_duel);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 10. Estado (reconexão/polling). Carimba presença na espera e aplica expiração/estouro de tempo.
-- ----------------------------------------------------------------------------------------------------
create or replace function public.party_state(p_uid uuid, p_duel uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_d public.duels;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into v_d from public.duels where id = p_duel for update;
  if not found or v_d.kind <> 'party' then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if not exists (select 1 from public.duel_players where duel_id = p_duel and user_id = p_uid) then
    raise exception 'not_member' using errcode = '55000';
  end if;

  if v_d.status = 'waiting' then
    update public.duel_players set last_seen_at = now() where duel_id = p_duel and user_id = p_uid;
    if v_d.expires_at < now() then
      update public.duels set status = 'cancelled', cancel_reason = 'expired' where id = p_duel;
    end if;
  elsif v_d.status = 'running' and v_d.starts_at is not null and now() >= v_d.starts_at then
    perform public.party_apply_timeout(p_duel);
  end if;

  return public.party_json(p_uid, p_duel);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 11. Lance. A Edge já validou com o domínio e mandou o estado novo, a próxima vez e o ranking (se acabou).
--     Aqui conferimos assento, vez, versão e se a vez não estourou.
-- ----------------------------------------------------------------------------------------------------
create or replace function public.party_move(
  p_uid uuid, p_duel uuid, p_version int, p_state jsonb, p_turn int,
  p_move jsonb, p_ranking jsonb, p_reason text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_d public.duels;
  v_g public.party_games;
  v_seat smallint;
  v_total int;
  v_flat int;
  v_distinct int;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' then raise exception 'bad_state' using errcode = '22023'; end if;
  if p_ranking is not null and jsonb_typeof(p_ranking) <> 'array' then raise exception 'bad_state' using errcode = '22023'; end if;

  select * into v_d from public.duels where id = p_duel for update;
  if not found or v_d.kind <> 'party' then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if v_d.status <> 'running' then raise exception 'bad_status' using errcode = '55000'; end if;
  if v_d.starts_at is null or now() < v_d.starts_at then raise exception 'not_started' using errcode = '55000'; end if;

  perform public.party_apply_timeout(p_duel);
  select * into v_d from public.duels where id = p_duel;
  if v_d.status <> 'running' then raise exception 'bad_status' using errcode = '55000'; end if;

  select * into v_g from public.party_games where duel_id = p_duel for update;
  select seat into v_seat from public.duel_players where duel_id = p_duel and user_id = p_uid and out_at is null;
  if v_seat is null then raise exception 'not_member' using errcode = '55000'; end if;
  if v_g.order_mode = 'turns' and v_g.turn_seat is distinct from v_seat then
    raise exception 'not_your_turn' using errcode = '55000';
  end if;
  if p_version is null or p_version <> v_g.version then raise exception 'stale' using errcode = '55000'; end if;

  if p_ranking is null then
    -- partida segue: em vez a vez tem de ir para um assento ainda ativo
    if v_g.order_mode = 'turns' and not exists (
      select 1 from public.duel_players where duel_id = p_duel and seat = p_turn and out_at is null
    ) then
      raise exception 'bad_state' using errcode = '22023';
    end if;
  else
    -- partida acabou: o ranking cobre exatamente os assentos ainda ativos, cada um uma vez
    select count(*), count(distinct s) into v_flat, v_distinct
      from (select jsonb_array_elements_text(g)::int as s from jsonb_array_elements(p_ranking) g) x;
    select count(*) into v_total from public.duel_players where duel_id = p_duel and out_at is null;
    if v_flat <> v_total or v_distinct <> v_total or exists (
      select 1 from (select jsonb_array_elements_text(g)::int as s from jsonb_array_elements(p_ranking) g) x
       where not exists (select 1 from public.duel_players where duel_id = p_duel and seat = x.s and out_at is null)
    ) then
      raise exception 'bad_state' using errcode = '22023';
    end if;
  end if;

  update public.party_games
     set state = p_state, version = version + 1,
         turn_seat = case when p_ranking is null and order_mode = 'turns' then p_turn::smallint end,
         turn_started_at = case when p_ranking is null and order_mode = 'turns' then now() end,
         moves = moves + 1, last_move = p_move, updated_at = now()
   where duel_id = p_duel;

  if p_ranking is not null then
    perform public.party_finish(p_duel, p_ranking, coalesce(p_reason, 'ended'));
  end if;

  return public.party_json(p_uid, p_duel);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 12. Sair, desistir, expulsar e cancelar
-- ----------------------------------------------------------------------------------------------------

-- Sair. Espera: libera o assento; se era o criador e há mais gente, a sala passa para o próximo assento
-- (se não há ninguém, cancela). Em jogo: equivale a desistir (eliminação).
create or replace function public.party_leave(p_uid uuid, p_duel uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_d public.duels;
  v_next uuid;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into v_d from public.duels where id = p_duel for update;
  if not found or v_d.kind <> 'party' then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if not exists (select 1 from public.duel_players where duel_id = p_duel and user_id = p_uid) then
    raise exception 'not_member' using errcode = '55000';
  end if;

  if v_d.status = 'waiting' then
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

create or replace function public.party_resign(p_uid uuid, p_duel uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return public.party_leave(p_uid, p_duel);
end $$;

-- Expulsar um convidado (só o criador, só na espera).
create or replace function public.party_kick(p_uid uuid, p_duel uuid, p_target uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_d public.duels;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into v_d from public.duels where id = p_duel for update;
  if not found or v_d.kind <> 'party' then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if v_d.created_by is distinct from p_uid then raise exception 'not_creator' using errcode = '55000'; end if;
  if v_d.status <> 'waiting' then raise exception 'bad_status' using errcode = '55000'; end if;
  if p_target is null or p_target = p_uid then raise exception 'bad_target' using errcode = '22023'; end if;

  delete from public.duel_players where duel_id = p_duel and user_id = p_target;
  return public.party_json(p_uid, p_duel);
end $$;

-- Cancelar a sala inteira (só o criador, só na espera). Ninguém é afetado em ranking.
create or replace function public.party_cancel(p_uid uuid, p_duel uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_d public.duels;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into v_d from public.duels where id = p_duel for update;
  if not found or v_d.kind <> 'party' then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if v_d.created_by is distinct from p_uid then raise exception 'not_creator' using errcode = '55000'; end if;
  if v_d.status <> 'waiting' then raise exception 'bad_status' using errcode = '55000'; end if;

  update public.duels set status = 'cancelled', cancel_reason = 'declined', finished_at = now() where id = p_duel;
  return jsonb_build_object('status', 'cancelled', 'cancelReason', 'declined', 'code', v_d.code, 'gameId', v_d.game_id);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 13. Limpeza: partida em andamento abandonada (sem lance nem consulta por `max_seconds`) é cancelada.
--     A espera expirada já é cancelada pelo `duel_cleanup` (ele não olha o `kind`).
-- ----------------------------------------------------------------------------------------------------
create or replace function public.party_cleanup() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  update public.duels d
     set status = 'cancelled', cancel_reason = 'abandoned', finished_at = now()
   where d.kind = 'party' and d.status = 'running' and d.starts_at is not null
     and now() > greatest(d.starts_at, coalesce((select g.updated_at from public.party_games g where g.duel_id = d.id), d.starts_at))
                 + make_interval(secs => d.max_seconds);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

select cron.unschedule(jobid) from cron.job where jobname = 'party_cleanup';
select cron.schedule('party_cleanup', '*/5 * * * *', $$select public.party_cleanup()$$);

-- ----------------------------------------------------------------------------------------------------
-- 14. Leitura que assumia 2 jogadores (substitui as versões 20261043/20261046; só mudam as linhas marcadas)
-- ----------------------------------------------------------------------------------------------------

-- Lista de salas: "ainda cabe gente" agora é `< max_players`, e a lista informa as vagas.
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
               'players',    (select count(*) from public.duel_players dp where dp.duel_id = d.id),   -- novo
               'minPlayers', d.min_players,                                                           -- novo
               'maxPlayers', d.max_players,                                                           -- novo
               'host',       jsonb_build_object('nickname', coalesce(p.nickname, p.name), 'avatar', p.avatar,
                                'rating', case when d.kind = 'party' then null else coalesce(dr.rating, 1500) end)  -- party não tem Elo
             ) as room
        from public.duels d
        left join public.profiles p on p.id = d.created_by
        left join public.duel_ratings dr on dr.game_id = d.game_id and dr.user_id = d.created_by
       where d.status = 'waiting'
         and d.expires_at > now()
         and (d.is_open or d.created_by = p_uid)
         and (select count(*) from public.duel_players dp where dp.duel_id = d.id) < d.max_players   -- era `< 2`
       order by d.created_at desc
       limit v_limit
    ) q
  ), '[]'::jsonb);
end $$;

-- Aviso de desafiante: é do 1×1 ("X entrou e está pronto"). Salas party têm o lobby próprio.
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
       and d.kind <> 'party'                                                                  -- novo
       and d.status = 'waiting'
       and d.expires_at > now()
       and (select count(*) from public.duel_players dp where dp.duel_id = d.id) = 2
       and exists (select 1 from public.duel_players dp
                    where dp.duel_id = d.id and dp.user_id <> p_uid and dp.ready)
     order by d.created_at desc
     limit 5
  ) q;

  return coalesce(v_invites, '[]'::jsonb);
end $$;

-- Elo é do 1×1: o gatilho não dispara em salas party (uma party com 2 jogadores cairia no Elo de 2).
drop trigger if exists duel_rating_finish on public.duels;
create trigger duel_rating_finish
after update of status on public.duels
for each row when (new.kind <> 'party')
execute function public.duel_rating_on_finish();

-- ----------------------------------------------------------------------------------------------------
-- 15. Permissões (só a Edge, com service_role). Auxiliares internos: ninguém de fora executa.
-- ----------------------------------------------------------------------------------------------------
revoke all on function public.party_next_seat(uuid, smallint) from public, anon, authenticated;
revoke all on function public.party_finish(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.party_eliminate(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.party_apply_timeout(uuid) from public, anon, authenticated;
revoke all on function public.party_seat(uuid, public.duels) from public, anon, authenticated;

revoke all on function public.party_json(uuid, uuid) from public, anon, authenticated;
grant execute on function public.party_json(uuid, uuid) to service_role;
revoke all on function public.party_create(uuid, text, int, int, boolean, text, int, text, int) from public, anon, authenticated;
grant execute on function public.party_create(uuid, text, int, int, boolean, text, int, text, int) to service_role;
revoke all on function public.party_join(uuid, text) from public, anon, authenticated;
grant execute on function public.party_join(uuid, text) to service_role;
revoke all on function public.party_join_open(uuid, uuid) from public, anon, authenticated;
grant execute on function public.party_join_open(uuid, uuid) to service_role;
revoke all on function public.party_ready(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.party_ready(uuid, uuid, boolean) to service_role;
revoke all on function public.party_roster(uuid) from public, anon, authenticated;
grant execute on function public.party_roster(uuid) to service_role;
revoke all on function public.party_launch(uuid, uuid, jsonb, jsonb, int) from public, anon, authenticated;
grant execute on function public.party_launch(uuid, uuid, jsonb, jsonb, int) to service_role;
revoke all on function public.party_state(uuid, uuid) from public, anon, authenticated;
grant execute on function public.party_state(uuid, uuid) to service_role;
revoke all on function public.party_move(uuid, uuid, int, jsonb, int, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.party_move(uuid, uuid, int, jsonb, int, jsonb, jsonb, text) to service_role;
revoke all on function public.party_leave(uuid, uuid) from public, anon, authenticated;
grant execute on function public.party_leave(uuid, uuid) to service_role;
revoke all on function public.party_resign(uuid, uuid) from public, anon, authenticated;
grant execute on function public.party_resign(uuid, uuid) to service_role;
revoke all on function public.party_kick(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.party_kick(uuid, uuid, uuid) to service_role;
revoke all on function public.party_cancel(uuid, uuid) from public, anon, authenticated;
grant execute on function public.party_cancel(uuid, uuid) to service_role;
revoke all on function public.party_cleanup() from public, anon, authenticated;
grant execute on function public.party_cleanup() to service_role;

revoke all on function public.duel_open_rooms(uuid, int) from public, anon, authenticated;
grant execute on function public.duel_open_rooms(uuid, int) to service_role;
revoke all on function public.duel_invites(uuid) from public, anon, authenticated;
grant execute on function public.duel_invites(uuid) to service_role;

-- FIM DA MIGRAÇÃO 20261053000000_multiplayer_party.sql
