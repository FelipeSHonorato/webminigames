-- ====================================================================================================
-- WebMiniGames · Ranking dos duelos 1×1 (um rating por jogo)
--
-- Como aplicar: Supabase > SQL Editor > cole este arquivo inteiro > Run
--   ou `supabase db push` (linked project).
--
-- Cada jogo de duelo tem o próprio ranking. O xadrez usa o sistema Elo: o resultado da partida
-- (vitória/derrota/empate) é aplicado quando a sala passa para `status = 'finished'`, seja por
-- xeque-mate, estouro de tempo, desistência ou saída. O cálculo fica no Postgres, nunca no cliente.
--
-- Funções novas: duel_elo_delta, duel_rating_record, duel_rating_on_finish, duel_ranking.
-- `chess_json` passa a devolver o rating de cada jogador (a barra do tabuleiro mostra o valor real).
-- ====================================================================================================

-- ----------------------------------------------------------------------------------------------------
-- 1. Ratings: uma linha por (jogo, jogador). Todo mundo começa em 1500.
-- ----------------------------------------------------------------------------------------------------
create table public.duel_ratings (
  game_id    text not null references public.games (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  rating     int  not null default 1500 check (rating between 100 and 4000),
  peak       int  not null default 1500 check (peak between 100 and 4000),
  wins       int  not null default 0 check (wins >= 0),
  losses     int  not null default 0 check (losses >= 0),
  draws      int  not null default 0 check (draws >= 0),
  games      int  not null default 0 check (games >= 0),
  updated_at timestamptz not null default now(),
  primary key (game_id, user_id)
);

alter table public.duel_ratings enable row level security;

-- A leitura pública passa por public.duel_ranking() (security definer); o cliente não lê a tabela direto.
revoke all on public.duel_ratings from anon, authenticated;

create index duel_ratings_game_rating_idx on public.duel_ratings (game_id, rating desc);

-- ----------------------------------------------------------------------------------------------------
-- 2. Elo: K = 40 nas 10 primeiras partidas (rating provisório) e 32 depois.
--    A função é pura para o mesmo cálculo valer no servidor e nos testes.
-- ----------------------------------------------------------------------------------------------------
create or replace function public.duel_elo_delta(
  p_rating int, p_opponent int, p_score numeric, p_games int
) returns int language sql immutable set search_path = '' as $$
  select round(
    (case when coalesce(p_games, 0) < 10 then 40 else 32 end)
    * (p_score - 1.0 / (1.0 + power(10.0, (p_opponent - p_rating) / 400.0)))
  )::int;
$$;

-- ----------------------------------------------------------------------------------------------------
-- 3. Aplica o resultado aos DOIS jogadores. Os ratings usados no cálculo são os de ANTES da partida;
--    as linhas são travadas na mesma ordem para dois duelos simultâneos não travarem entre si.
-- ----------------------------------------------------------------------------------------------------
create or replace function public.duel_rating_record(
  p_game text, p_uid uuid, p_opponent uuid, p_score numeric
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me   public.duel_ratings;
  v_opp  public.duel_ratings;
  v_next int;
begin
  if p_uid is null or p_opponent is null or p_uid = p_opponent then
    return;
  end if;

  insert into public.duel_ratings (game_id, user_id)
  values (p_game, p_uid), (p_game, p_opponent)
  on conflict (game_id, user_id) do nothing;

  -- Trava as duas linhas na ordem do UUID: evita deadlock entre partidas simultâneas.
  perform 1 from public.duel_ratings
   where game_id = p_game and user_id in (p_uid, p_opponent)
   order by user_id
   for update;

  select * into v_me  from public.duel_ratings where game_id = p_game and user_id = p_uid;
  select * into v_opp from public.duel_ratings where game_id = p_game and user_id = p_opponent;

  v_next := greatest(100, least(4000,
    v_me.rating + public.duel_elo_delta(v_me.rating, v_opp.rating, p_score, v_me.games)));
  update public.duel_ratings
     set rating = v_next,
         peak = greatest(v_me.peak, v_next),
         wins = v_me.wins + case when p_score > 0.5 then 1 else 0 end,
         losses = v_me.losses + case when p_score < 0.5 then 1 else 0 end,
         draws = v_me.draws + case when p_score = 0.5 then 1 else 0 end,
         games = v_me.games + 1,
         updated_at = now()
   where game_id = p_game and user_id = p_uid;

  v_next := greatest(100, least(4000,
    v_opp.rating + public.duel_elo_delta(v_opp.rating, v_me.rating, 1 - p_score, v_opp.games)));
  update public.duel_ratings
     set rating = v_next,
         peak = greatest(v_opp.peak, v_next),
         wins = v_opp.wins + case when p_score < 0.5 then 1 else 0 end,
         losses = v_opp.losses + case when p_score > 0.5 then 1 else 0 end,
         draws = v_opp.draws + case when p_score = 0.5 then 1 else 0 end,
         games = v_opp.games + 1,
         updated_at = now()
   where game_id = p_game and user_id = p_opponent;
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 4. Gatilho no fim do duelo: vale para TODAS as formas de encerrar (mate, tempo, desistência,
--    saída, settle). `winner_id` decide os duelos de corrida; no xadrez o `result` manda (e o
--    `winner_id` cobre o caso de empate/estado incompleto).
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

  if new.kind = 'turn' then
    select case c.result
             when 'white' then c.white_id
             when 'black' then c.black_id
           end
      into v_winner
      from public.chess_games c
     where c.duel_id = new.id;
    if v_winner is null then
      v_winner := new.winner_id;
    end if;
  else
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

drop trigger if exists duel_rating_finish on public.duels;
create trigger duel_rating_finish
after update of status on public.duels
for each row execute function public.duel_rating_on_finish();

-- ----------------------------------------------------------------------------------------------------
-- 5. `chess_json` devolve o rating de cada jogador (1500 para quem ainda não disputou).
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

-- ----------------------------------------------------------------------------------------------------
-- 6. Leitura pública: ranking de UM jogo de duelo (mesmo formato de public.ranking).
--    `points` recebe o rating para a lista existente funcionar sem mudanças.
-- ----------------------------------------------------------------------------------------------------
create or replace function public.duel_ranking(
  p_game text, p_scope text default 'global', p_limit int default 10
) returns jsonb
language sql stable security definer set search_path = '' as $$
  with base as (
    select r.user_id, r.rating, r.peak, r.wins, r.losses, r.draws, r.games, r.updated_at
    from public.duel_ratings r
    join public.profiles pr on pr.id = r.user_id
    where r.game_id = p_game
      and pr.role <> 'admin'
      and r.games > 0
  ),
  filtered as (
    select b.*, coalesce(p.nickname, p.name) as name, p.avatar, p.region
    from base b
    join public.profiles p on p.id = b.user_id
    where p_scope is distinct from 'region'
       or (p.region is not null and p.region = (select region from public.profiles where id = auth.uid()))
  ),
  ranked as (
    select f.*, row_number() over (order by f.rating desc, f.wins desc, f.updated_at asc, f.user_id) as rank,
           jsonb_build_object(
             'id', f.user_id, 'name', f.name, 'avatar', f.avatar, 'region', f.region,
             'points', f.rating, 'rating', f.rating, 'peak', f.peak,
             'wins', f.wins, 'losses', f.losses, 'draws', f.draws, 'games', f.games,
             'updatedAt', (extract(epoch from f.updated_at) * 1000)::bigint
           ) as j
    from filtered f
  )
  select jsonb_build_object(
    'top',   coalesce((select jsonb_agg(r.j || jsonb_build_object('rank', r.rank, 'isMe', r.user_id is not distinct from auth.uid()) order by r.rank)
                       from ranked r where r.rank <= least(greatest(coalesce(p_limit, 10), 1), 100)), '[]'::jsonb),
    'me',    (select r.j || jsonb_build_object('rank', r.rank, 'isMe', true) from ranked r where r.user_id = auth.uid()),
    'total', (select count(*) from ranked)
  )
$$;

-- ----------------------------------------------------------------------------------------------------
-- 7. Permissões: o cliente só lê o ranking; quem escreve é o gatilho (service_role / dono da tabela).
-- ----------------------------------------------------------------------------------------------------
revoke all on function public.duel_elo_delta(int, int, numeric, int) from public, anon, authenticated;
grant execute on function public.duel_elo_delta(int, int, numeric, int) to service_role;

revoke all on function public.duel_rating_record(text, uuid, uuid, numeric) from public, anon, authenticated;
grant execute on function public.duel_rating_record(text, uuid, uuid, numeric) to service_role;

revoke all on function public.duel_rating_on_finish() from public, anon, authenticated;
grant execute on function public.duel_rating_on_finish() to service_role;

revoke all on function public.duel_ranking(text, text, int) from public, anon, authenticated;
grant execute on function public.duel_ranking(text, text, int) to anon, authenticated;

-- ====================================================================================================
-- FIM — 20261039000000_duel_ratings.sql
-- ====================================================================================================
