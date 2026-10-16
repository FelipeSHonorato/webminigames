-- =====================================================================================================
-- WebMiniGames · esquema inicial (Supabase / PostgreSQL)
--
-- Como aplicar: Supabase > SQL Editor > cole este arquivo inteiro > Run (ou `supabase db push` com a CLI).
-- Detalhes e passo a passo: docs/SUPABASE.md.
--
-- Princípios:
--   * As CONTAS ficam no Supabase Auth (auth.users). Aqui só há dados do jogo, ligados ao id da conta.
--   * RLS (Row Level Security) ligado em TODAS as tabelas: cada jogador só lê/escreve o que é dele.
--   * Pontos, vitórias, nível e coins são calculados AQUI (funções abaixo), não no navegador: o cliente
--     não tem permissão de escrever nessas tabelas, só de chamar as funções, que validam tudo.
--   * Constantes espelhadas de shared/progress.js, shared/coins.js, shared/roles.js e shared/regions.js
--     (tests/supabase.test.js falha se elas divergirem).
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------------
-- 1. Constantes do jogo (funções imutáveis: um só lugar para mudar)
-- ---------------------------------------------------------------------------------------------------
create function public.wins_per_level() returns int language sql immutable set search_path = '' as $$ select 15 $$;
create function public.points_per_level() returns int[] language sql immutable set search_path = '' as $$ select array[5, 10, 15, 20] $$;
create function public.coins_per_day() returns int language sql immutable set search_path = '' as $$ select 2 $$;
create function public.admin_coins() returns int language sql immutable set search_path = '' as $$ select 99999 $$;

-- ---------------------------------------------------------------------------------------------------
-- 2. Tabelas
-- ---------------------------------------------------------------------------------------------------

-- Catálogo de jogos + liga/desliga do administrador (substitui o "wmg.games" do navegador).
create table public.games (
  id      text primary key check (id ~ '^[a-z][a-z0-9_-]{1,29}$'),
  title   text not null,
  enabled boolean not null default true,
  sort    smallint not null default 0
);
insert into public.games (id, title, sort) values
  ('zip', 'Zip', 1), ('patches', 'Patches', 2), ('sudoku', 'Sudoku', 3),
  ('sopa', 'Sopa de Letras', 4), ('cruzadas', 'Palavras Cruzadas', 5), ('canos', 'Conexão de Canos', 6);

-- Perfil público da conta (criado sozinho quando alguém se cadastra, pelo gatilho da seção 4).
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  nickname   text check (nickname is null or nickname ~ '^[^[:cntrl:]<>]{3,20}$'),
  region     text check (region is null or region in ('norte', 'nordeste', 'centro-oeste', 'sudeste', 'sul', 'exterior')),
  avatar     text check (avatar is null or (avatar like 'data:image/%' and char_length(avatar) <= 100000)),
  role       text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Apelido único sem diferenciar maiúsculas (NULL não conflita).
create unique index profiles_nickname_key on public.profiles (lower(nickname));

-- Progressão: vitórias por jogador e jogo (o nível sobe a cada 15). Só as funções escrevem aqui.
create table public.game_progress (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  game_id    text not null references public.games (id),
  wins       int  not null default 0 check (wins >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, game_id)
);

-- Pontuação do ranking. Só a função submit_win escreve aqui.
create table public.scores (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  game_id    text not null references public.games (id),
  points     int  not null default 0 check (points >= 0),
  wins       int  not null default 0 check (wins >= 0),
  updated_at timestamptz not null default now(),   -- momento do último ponto: desempata o ranking (quem chegou primeiro)
  primary key (user_id, game_id)
);
create index scores_ranking_idx on public.scores (game_id, points desc, updated_at);

-- Histórico de vitórias. Também garante que reenviar a mesma vitória (rede instável) não conta duas vezes.
create table public.win_log (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  op_id      uuid not null,
  game_id    text not null references public.games (id),
  level      smallint not null,
  points     int  not null,
  created_at timestamptz not null default now(),
  primary key (user_id, op_id)
);
create index win_log_user_idx on public.win_log (user_id, created_at desc);

-- Fase atual de cada jogador em cada jogo (seed, nível, tabuleiro em andamento...): recarregar devolve a MESMA fase.
create table public.runs (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  game_id    text not null references public.games (id),
  state      jsonb not null check (octet_length(state::text) <= 200000),
  updated_at timestamptz not null default now(),
  primary key (user_id, game_id)
);

-- Coins por jogo (2 a cada 24 h, sem acumular). Só as funções escrevem aqui.
create table public.coins (
  user_id uuid not null references public.profiles (id) on delete cascade,
  game_id text not null references public.games (id),
  coins   int  not null check (coins >= 0),
  anchor  timestamptz not null,                    -- início do período de 24 h atual
  primary key (user_id, game_id)
);

-- Atividade: "último jogo" e número de fases abertas, mostrados no perfil.
create table public.activity (
  user_id        uuid not null references public.profiles (id) on delete cascade,
  game_id        text not null references public.games (id),
  plays          int  not null default 0 check (plays >= 0),
  last_played_at timestamptz not null default now(),
  primary key (user_id, game_id)
);

-- ---------------------------------------------------------------------------------------------------
-- 3. Funções auxiliares
-- ---------------------------------------------------------------------------------------------------
create function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger runs_touch     before update on public.runs     for each row execute function public.touch_updated_at();

-- A conta logada é administradora? (security definer: lê profiles sem esbarrar na própria RLS)
create function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
$$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Cadastro: cada nova conta do Supabase Auth ganha um perfil
--    (nome e região vêm de options.data no signUp; no Google, do nome da conta Google).
-- ---------------------------------------------------------------------------------------------------
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name   text;
  v_region text := new.raw_user_meta_data ->> 'region';
begin
  v_name := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'full_name', '')), '');
  if v_name is null then v_name := nullif(btrim(split_part(coalesce(new.email, ''), '@', 1)), ''); end if;
  v_name := left(coalesce(v_name, 'Jogador'), 60);
  if v_region is not null and v_region not in ('norte', 'nordeste', 'centro-oeste', 'sudeste', 'sul', 'exterior') then v_region := null; end if;
  insert into public.profiles (id, name, region) values (new.id, v_name, v_region);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------------------------------
-- 5. Coins: recarga preguiçosa + gasto. Interna: só as funções abaixo a chamam (ninguém tem EXECUTE).
-- ---------------------------------------------------------------------------------------------------
create function public.coins_apply(p_uid uuid, p_game text, p_spend boolean) returns public.coins
language plpgsql security definer set search_path = '' as $$
declare
  v_cap     int := case when exists (select 1 from public.profiles where id = p_uid and role = 'admin') then public.admin_coins() else public.coins_per_day() end;
  v_row     public.coins;
  v_periods int;
begin
  insert into public.coins (user_id, game_id, coins, anchor) values (p_uid, p_game, v_cap, now()) on conflict do nothing;
  select * into v_row from public.coins where user_id = p_uid and game_id = p_game for update;
  v_periods := floor(extract(epoch from (now() - v_row.anchor)) / 86400);
  if v_periods >= 1 then
    v_row.coins  := v_cap;                                              -- recarga: volta ao máximo, nunca passa dele
    v_row.anchor := v_row.anchor + v_periods * interval '1 day';
  end if;
  v_row.coins := least(v_row.coins, v_cap);
  if p_spend and v_row.coins > 0 then v_row.coins := v_row.coins - 1; end if;
  update public.coins set coins = v_row.coins, anchor = v_row.anchor where user_id = p_uid and game_id = p_game;
  return v_row;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 6. Vitória: valida, pontua, sobe a progressão e gasta 1 coin, tudo numa transação.
--    p_op = identificador único da vitória gerado no navegador; reenviar o mesmo não conta de novo.
-- ---------------------------------------------------------------------------------------------------
create function public.submit_win(p_game text, p_points int, p_op uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := auth.uid();
  v_op       uuid := coalesce(p_op, gen_random_uuid());
  v_wins     int;
  v_level    int;
  v_inserted int;
  v_score    public.scores;
  v_coins    public.coins;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.games where id = p_game) then raise exception 'unknown_game' using errcode = '22023'; end if;

  insert into public.game_progress (user_id, game_id) values (v_uid, p_game) on conflict do nothing;
  select wins into v_wins from public.game_progress where user_id = v_uid and game_id = p_game for update;   -- serializa vitórias simultâneas
  v_level := least(array_length(public.points_per_level(), 1) - 1, v_wins / public.wins_per_level());

  -- Pontos de uma vitória: de 1 até o máximo do nível atual (a dica reduz os pontos, nunca abaixo de 1).
  if p_points is null or p_points < 1 or p_points > (public.points_per_level())[v_level + 1] then
    raise exception 'invalid_points' using errcode = '22023';
  end if;

  insert into public.win_log (user_id, op_id, game_id, level, points) values (v_uid, v_op, p_game, v_level, p_points)
    on conflict (user_id, op_id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 1 then
    update public.game_progress set wins = wins + 1, updated_at = now() where user_id = v_uid and game_id = p_game returning wins into v_wins;
    insert into public.scores (user_id, game_id, points, wins, updated_at) values (v_uid, p_game, p_points, 1, now())
      on conflict (user_id, game_id) do update
      set points = public.scores.points + excluded.points, wins = public.scores.wins + 1, updated_at = now();
    v_coins := public.coins_apply(v_uid, p_game, true);
  else
    v_coins := public.coins_apply(v_uid, p_game, false);                  -- vitória repetida: só devolve o estado atual
  end if;

  select * into v_score from public.scores where user_id = v_uid and game_id = p_game;
  return jsonb_build_object(
    'duplicate', v_inserted = 0,
    'wins', v_wins,
    'score', jsonb_build_object('points', v_score.points, 'wins', v_score.wins, 'updatedAt', (extract(epoch from v_score.updated_at) * 1000)::bigint),
    'coins', jsonb_build_object('coins', v_coins.coins, 'anchor', (extract(epoch from v_coins.anchor) * 1000)::bigint)
  );
end $$;

-- "Último jogo" do perfil: chamada quando o jogador abre uma fase.
create function public.record_play(p_game text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.games where id = p_game) then raise exception 'unknown_game' using errcode = '22023'; end if;
  insert into public.activity (user_id, game_id, plays, last_played_at) values (auth.uid(), p_game, 1, now())
    on conflict (user_id, game_id) do update set plays = public.activity.plays + 1, last_played_at = now();
end $$;

-- Administrador: coloca o jogo, para a conta dele, no início de um nível (0 a 3) e descarta a fase salva.
create function public.admin_set_level(p_game text, p_level int) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_wins int;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.games where id = p_game) then raise exception 'unknown_game' using errcode = '22023'; end if;
  if p_level is null or p_level < 0 or p_level >= array_length(public.points_per_level(), 1) then raise exception 'invalid_level' using errcode = '22023'; end if;
  v_wins := p_level * public.wins_per_level();
  insert into public.game_progress (user_id, game_id, wins) values (auth.uid(), p_game, v_wins)
    on conflict (user_id, game_id) do update set wins = excluded.wins, updated_at = now();
  delete from public.runs where user_id = auth.uid() and game_id = p_game;
  return jsonb_build_object('wins', v_wins);
end $$;

-- Promove uma conta a administradora (rode no SQL Editor: select public.promote_admin('seu@email.com');).
-- Só o dono do projeto consegue chamar (nenhum papel do navegador tem EXECUTE). Zera os coins da conta para ela
-- recomeçar com o limite do administrador (99999), em vez de esperar a próxima recarga.
create function public.promote_admin(p_email text) returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(btrim(p_email));
  if v_id is null then raise exception 'Nenhuma conta com o e-mail %', p_email using errcode = 'P0002'; end if;
  update public.profiles set role = 'admin' where id = v_id;
  delete from public.coins where user_id = v_id;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 7. Leitura: tudo do jogador numa só chamada (carregada uma vez, ao abrir qualquer página)
-- ---------------------------------------------------------------------------------------------------
create function public.my_snapshot() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'profile', (select jsonb_build_object('id', p.id, 'name', p.name, 'nickname', p.nickname, 'region', p.region, 'avatar', p.avatar, 'role', p.role)
                from public.profiles p where p.id = auth.uid()),
    'wins',     coalesce((select jsonb_object_agg(game_id, wins) from public.game_progress where user_id = auth.uid()), '{}'::jsonb),
    'runs',     coalesce((select jsonb_object_agg(game_id, state) from public.runs where user_id = auth.uid()), '{}'::jsonb),
    'coins',    coalesce((select jsonb_object_agg(game_id, jsonb_build_object('coins', coins, 'anchor', (extract(epoch from anchor) * 1000)::bigint))
                          from public.coins where user_id = auth.uid()), '{}'::jsonb),
    'scores',   coalesce((select jsonb_object_agg(game_id, jsonb_build_object('points', points, 'wins', wins, 'updatedAt', (extract(epoch from updated_at) * 1000)::bigint))
                          from public.scores where user_id = auth.uid()), '{}'::jsonb),
    'activity', coalesce((select jsonb_object_agg(game_id, jsonb_build_object('plays', plays, 'lastPlayedAt', (extract(epoch from last_played_at) * 1000)::bigint))
                          from public.activity where user_id = auth.uid()), '{}'::jsonb)
  )
$$;

-- Ranking de um jogo (p_game) ou geral (p_game nulo). p_scope: 'global' ou 'region' (a região de quem pergunta).
-- Devolve { top, me, total }: top = os p_limit primeiros; me = a linha de quem pergunta (mesmo fora do top).
-- Empate: quem chegou primeiro. Só expõe nome/apelido, foto, região e pontos: nunca o e-mail.
create function public.ranking(p_game text default null, p_scope text default 'global', p_limit int default 10) returns jsonb
language sql stable security definer set search_path = '' as $$
  with base as (
    select s.user_id, sum(s.points)::int as points, sum(s.wins)::int as wins, max(s.updated_at) as updated_at
    from public.scores s
    where p_game is null or s.game_id = p_game
    group by s.user_id
    having sum(s.points) > 0
  ),
  filtered as (
    select b.user_id, coalesce(p.nickname, p.name) as name, p.avatar, p.region, b.points, b.wins, b.updated_at
    from base b join public.profiles p on p.id = b.user_id
    where p_scope is distinct from 'region'
       or (p.region is not null and p.region = (select region from public.profiles where id = auth.uid()))
  ),
  ranked as (
    select f.*, row_number() over (order by f.points desc, f.updated_at asc, f.user_id) as rank,
           jsonb_build_object('id', f.user_id, 'name', f.name, 'avatar', f.avatar, 'region', f.region, 'points', f.points, 'wins', f.wins,
                              'updatedAt', (extract(epoch from f.updated_at) * 1000)::bigint) as j
    from filtered f
  )
  select jsonb_build_object(
    'top',   coalesce((select jsonb_agg(r.j || jsonb_build_object('rank', r.rank, 'isMe', r.user_id is not distinct from auth.uid()) order by r.rank)
                       from ranked r where r.rank <= least(greatest(coalesce(p_limit, 10), 1), 100)), '[]'::jsonb),
    'me',    (select r.j || jsonb_build_object('rank', r.rank, 'isMe', true) from ranked r where r.user_id = auth.uid()),
    'total', (select count(*) from ranked)
  )
$$;

-- ---------------------------------------------------------------------------------------------------
-- 8. Segurança: RLS em tudo + permissões mínimas
--    (o Supabase concede tudo a anon/authenticated por padrão; aqui tiramos e devolvemos só o necessário)
-- ---------------------------------------------------------------------------------------------------
alter table public.games         enable row level security;
alter table public.profiles      enable row level security;
alter table public.game_progress enable row level security;
alter table public.scores        enable row level security;
alter table public.win_log       enable row level security;
alter table public.runs          enable row level security;
alter table public.coins         enable row level security;
alter table public.activity      enable row level security;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- games: qualquer um lê (o hub precisa saber o que está ligado); só o administrador liga/desliga.
grant select on public.games to anon, authenticated;
grant update (enabled) on public.games to authenticated;
create policy games_read   on public.games for select using (true);
create policy games_toggle on public.games for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- profiles: cada um vê e edita o próprio (o administrador vê todos). Papel (role) NÃO é editável pelo cliente.
grant select on public.profiles to authenticated;
grant update (name, nickname, region, avatar) on public.profiles to authenticated;
create policy profiles_read   on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Dados só de leitura para o dono: quem escreve são as funções da seção 6.
grant select on public.game_progress, public.scores, public.win_log, public.coins, public.activity to authenticated;
create policy progress_read on public.game_progress for select to authenticated using (user_id = auth.uid());
create policy scores_read   on public.scores        for select to authenticated using (user_id = auth.uid());
create policy win_log_read  on public.win_log       for select to authenticated using (user_id = auth.uid());
create policy coins_read    on public.coins         for select to authenticated using (user_id = auth.uid());
create policy activity_read on public.activity      for select to authenticated using (user_id = auth.uid());

-- runs: o próprio jogador salva, lê e apaga a sua fase.
grant select, insert, update, delete on public.runs to authenticated;
create policy runs_read   on public.runs for select to authenticated using (user_id = auth.uid());
create policy runs_insert on public.runs for insert to authenticated with check (user_id = auth.uid());
create policy runs_update on public.runs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy runs_delete on public.runs for delete to authenticated using (user_id = auth.uid());

-- Funções chamáveis pelo navegador.
grant execute on function public.is_admin()                        to authenticated;
grant execute on function public.my_snapshot()                     to authenticated;
grant execute on function public.submit_win(text, int, uuid)       to authenticated;
grant execute on function public.record_play(text)                 to authenticated;
grant execute on function public.admin_set_level(text, int)        to authenticated;
grant execute on function public.ranking(text, text, int)          to anon, authenticated;
-- (coins_apply, promote_admin, handle_new_user, touch_updated_at e as constantes: nunca pelo navegador.)
