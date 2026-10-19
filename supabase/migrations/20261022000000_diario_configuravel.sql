-- =====================================================================================================
-- WebMiniGames · desafio diário configurável: coins por dia (global) = nº de cenários diários
--
-- Como aplicar: Supabase > SQL Editor > cole este arquivo inteiro > Run (ou `supabase db push`).
-- Rode DEPOIS de 20261021000000_desafio_diario.sql.
--
-- O que muda:
--   * O desafio diário passa a ser o ÚNICO modo na nuvem (a fase aleatória sai do jogo): cada jogador recebe,
--     por jogo, `coins do dia` cenários do dia — um por coin. Os cenários são derivados (dia|jogo|nível|slot),
--     então mudar a quantidade NÃO precisa gerar/guardar nada: basta liberar mais slots.
--   * `coins_per_day()` continua sendo a constante PADRÃO (espelhada em shared/coins.js). O valor EFETIVO vem da
--     tabela `settings` (chave 'coins_per_day'), lido por `coins_cap()`. O administrador muda pelo painel
--     (`set_coins_per_day`), e vale para todos os jogos.
--   * Concluir um cenário do dia também pontua e sobe a progressão (uma vez por slot/dia) — assim os DOIS
--     rankings continuam: o de TEMPO do dia e o de PONTOS. A conta administradora segue sem pontuar (sandbox).
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------------
-- 1. Configuração (valor efetivo de coins/cenários por dia)
-- ---------------------------------------------------------------------------------------------------
create table public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.settings (key, value) values ('coins_per_day', '2'::jsonb) on conflict (key) do nothing;

alter table public.settings enable row level security;
revoke all on public.settings from anon, authenticated;

-- Teto de cenários por dia (limite de sanidade; o administrador escolhe de 1 até aqui).
create function public.max_scenarios() returns int language sql immutable set search_path = '' as $$ select 10 $$;

-- Valor efetivo: a configuração do administrador, limitada a [1, max_scenarios()], com a constante como padrão.
create function public.coins_cap() returns int language sql stable set search_path = '' as $$
  select least(public.max_scenarios(), greatest(1,
    coalesce((select (value)::int from public.settings where key = 'coins_per_day'), public.coins_per_day())))
$$;

-- Recria coins_apply usando o valor efetivo (a constante coins_per_day() deixa de ser lida direto).
create or replace function public.coins_apply(p_uid uuid, p_game text, p_spend boolean) returns public.coins
language plpgsql security definer set search_path = '' as $$
declare
  v_cap     int := case when exists (select 1 from public.profiles where id = p_uid and role = 'admin') then public.admin_coins() else public.coins_cap() end;
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

-- Administrador: define quantos coins (e cenários) por dia. Vale para todos os jogos.
create function public.set_coins_per_day(p_n int) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_n is null or p_n < 1 or p_n > public.max_scenarios() then raise exception 'invalid_coins' using errcode = '22023'; end if;
  insert into public.settings (key, value, updated_at) values ('coins_per_day', to_jsonb(p_n), now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('coinsPerDay', public.coins_cap());
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 2. Slots viram 1..max_scenarios() (a quantidade do dia é decidida em daily_open, não pelo CHECK)
-- ---------------------------------------------------------------------------------------------------
alter table public.daily_runs drop constraint if exists daily_runs_slot_check;
alter table public.daily_runs add constraint daily_runs_slot_check check (slot >= 1 and slot <= public.max_scenarios());
alter table public.daily_results drop constraint if exists daily_results_slot_check;
alter table public.daily_results add constraint daily_results_slot_check check (slot >= 1 and slot <= public.max_scenarios());

-- ---------------------------------------------------------------------------------------------------
-- 3. Abrir o cenário do dia: cobra 1 coin, começa o relógio e devolve a seed secreta + a quantidade de cenários.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.daily_open(p_uid uuid, p_game text, p_slot int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_day   date := public.daily_day();
  v_cap   int;
  v_coins int;
  v_level smallint;
  v_seed  bigint;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.games where id = p_game) then raise exception 'unknown_game' using errcode = '22023'; end if;
  v_cap := public.coins_cap();
  if p_slot is null or p_slot < 1 or p_slot > v_cap then raise exception 'bad_slot' using errcode = '22023'; end if;

  insert into public.daily_coins (user_id, day, game_id, coins)
    values (p_uid, v_day, p_game, case when exists (select 1 from public.profiles where id = p_uid and role = 'admin') then public.admin_coins() else v_cap end)
    on conflict do nothing;
  select coins into v_coins from public.daily_coins where user_id = p_uid and day = v_day and game_id = p_game for update;
  if v_coins <= 0 then raise exception 'no_coins' using errcode = '22023'; end if;

  v_level := public.level_for(p_uid, p_game);
  v_seed  := public.daily_seed(v_day, p_game, v_level, p_slot);

  update public.daily_coins set coins = coins - 1 where user_id = p_uid and day = v_day and game_id = p_game;
  insert into public.daily_runs (user_id, day, game_id, slot, level, seed, hints, started_at)
    values (p_uid, v_day, p_game, p_slot, v_level, v_seed, 0, now())
    on conflict (user_id, day, game_id, slot) do update
      set level = excluded.level, seed = excluded.seed, hints = 0, started_at = now();

  return jsonb_build_object(
    'day', v_day, 'level', v_level, 'slot', p_slot, 'slots', v_cap, 'seed', v_seed,
    'startedAt', (extract(epoch from now()) * 1000)::bigint,
    'coins', (select coins from public.daily_coins where user_id = p_uid and day = v_day and game_id = p_game)
  );
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Concluir o cenário do dia (já validado pela Edge): mede o tempo (+30 s por dica), guarda o melhor por
--    slot, PONTUA e sobe a progressão (uma vez por slot/dia; a conta administradora não pontua).
-- ---------------------------------------------------------------------------------------------------
create or replace function public.daily_finish(p_uid uuid, p_game text, p_slot int, p_op uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_day      date := public.daily_day();
  v_run      public.daily_runs;
  v_seconds  int;
  v_coins    int;
  v_best     int;
  v_had      boolean;
  v_is_admin boolean;
  v_cap      int;
  v_points   int;
  v_wins     int;
  v_score    public.scores;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.games where id = p_game) then raise exception 'unknown_game' using errcode = '22023'; end if;

  select * into v_run from public.daily_runs where user_id = p_uid and day = v_day and game_id = p_game and slot = p_slot for update;
  if not found then
    -- Reenvio da mesma conclusão (fila/rede): devolve o que já está guardado para o slot.
    select seconds into v_seconds from public.daily_results where user_id = p_uid and day = v_day and game_id = p_game and slot = p_slot;
    if found then
      select min(seconds) into v_best from public.daily_results where user_id = p_uid and day = v_day and game_id = p_game;
      select coins into v_coins from public.daily_coins where user_id = p_uid and day = v_day and game_id = p_game;
      select * into v_score from public.scores where user_id = p_uid and game_id = p_game;
      return jsonb_build_object(
        'duplicate', true, 'seconds', v_seconds, 'best', v_best, 'coins', coalesce(v_coins, 0), 'slots', public.coins_cap(),
        'wins', coalesce((select wins from public.game_progress where user_id = p_uid and game_id = p_game), 0),
        'score', jsonb_build_object('points', coalesce(v_score.points, 0), 'wins', coalesce(v_score.wins, 0), 'updatedAt', (extract(epoch from coalesce(v_score.updated_at, now())) * 1000)::bigint)
      );
    end if;
    raise exception 'no_phase' using errcode = '22023';                                    -- tentativa inexistente/já consumida
  end if;

  v_seconds := greatest(0, floor(extract(epoch from (now() - v_run.started_at)))::int + public.daily_hint_seconds() * v_run.hints);
  select exists (select 1 from public.daily_results where user_id = p_uid and day = v_day and game_id = p_game and slot = p_slot) into v_had;

  insert into public.daily_results (user_id, day, game_id, slot, level, hints, seconds, op_id, finished_at)
    values (p_uid, v_day, p_game, p_slot, v_run.level, v_run.hints, v_seconds, coalesce(p_op, gen_random_uuid()), now())
    on conflict (user_id, day, game_id, slot) do update
      set seconds     = least(public.daily_results.seconds, excluded.seconds),
          hints       = case when excluded.seconds < public.daily_results.seconds then excluded.hints else public.daily_results.hints end,
          level       = case when excluded.seconds < public.daily_results.seconds then excluded.level else public.daily_results.level end,
          op_id       = case when excluded.seconds < public.daily_results.seconds then excluded.op_id else public.daily_results.op_id end,
          finished_at = case when excluded.seconds < public.daily_results.seconds then now() else public.daily_results.finished_at end;

  -- Pontuação/progressão só na PRIMEIRA conclusão do slot no dia (reabrir para melhorar o tempo não pontua de novo).
  select exists (select 1 from public.profiles where id = p_uid and role = 'admin') into v_is_admin;
  if not v_had then
    insert into public.game_progress (user_id, game_id) values (p_uid, p_game) on conflict do nothing;
    update public.game_progress set wins = wins + 1, updated_at = now() where user_id = p_uid and game_id = p_game returning wins into v_wins;
    if not v_is_admin then
      v_cap    := (public.points_per_level())[v_run.level + 1];
      v_points := greatest(1, v_cap - least(greatest(coalesce(v_run.hints, 0), 0), v_cap - 1));
      insert into public.scores (user_id, game_id, points, wins, updated_at) values (p_uid, p_game, v_points, 1, now())
        on conflict (user_id, game_id) do update
          set points = public.scores.points + excluded.points, wins = public.scores.wins + 1, updated_at = now();
    end if;
  end if;

  delete from public.daily_runs where user_id = p_uid and day = v_day and game_id = p_game and slot = p_slot;

  select min(seconds) into v_best from public.daily_results where user_id = p_uid and day = v_day and game_id = p_game;
  select coins into v_coins from public.daily_coins where user_id = p_uid and day = v_day and game_id = p_game;
  select * into v_score from public.scores where user_id = p_uid and game_id = p_game;
  return jsonb_build_object(
    'duplicate', false, 'seconds', v_seconds, 'best', v_best, 'coins', coalesce(v_coins, 0), 'slots', public.coins_cap(),
    'wins', coalesce(v_wins, (select wins from public.game_progress where user_id = p_uid and game_id = p_game), 0),
    'score', jsonb_build_object('points', coalesce(v_score.points, 0), 'wins', coalesce(v_score.wins, 0), 'updatedAt', (extract(epoch from coalesce(v_score.updated_at, now())) * 1000)::bigint)
  );
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 5. Status do dia para o navegador (não expõe seed): coins, quantidade de cenários, resultados e abertos.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.daily_status() returns jsonb language sql stable security definer set search_path = '' as $$
  with cfg as (select public.daily_day() as day, public.coins_cap() as cap)
  select coalesce(jsonb_object_agg(g.id, jsonb_build_object(
    'day',     cfg.day,
    'slots',   cfg.cap,
    'level',   least(array_length(public.points_per_level(), 1) - 1,
                     coalesce((select wins from public.game_progress where user_id = auth.uid() and game_id = g.id), 0) / public.wins_per_level()),
    'coins',   coalesce((select coins from public.daily_coins c where c.user_id = auth.uid() and c.day = cfg.day and c.game_id = g.id),
                        case when exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') then public.admin_coins() else cfg.cap end),
    'results', coalesce((select jsonb_object_agg(d.slot::text, d.seconds) from public.daily_results d
                         where d.user_id = auth.uid() and d.day = cfg.day and d.game_id = g.id), '{}'::jsonb),
    'open',    coalesce((select jsonb_agg(r.slot) from public.daily_runs r
                         where r.user_id = auth.uid() and r.day = cfg.day and r.game_id = g.id), '[]'::jsonb)
  )), '{}'::jsonb)
  from public.games g, cfg
  where auth.uid() is not null
$$;

-- ---------------------------------------------------------------------------------------------------
-- 6. Snapshot: acrescenta a configuração (coins/cenários por dia) para a tela montar o painel do dia.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.my_snapshot() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'profile', (select jsonb_build_object('id', p.id, 'name', p.name, 'nickname', p.nickname, 'region', p.region, 'avatar', p.avatar, 'role', p.role)
                from public.profiles p where p.id = auth.uid()),
    'config',  jsonb_build_object('coinsPerDay', public.coins_cap()),
    'wins',     coalesce((select jsonb_object_agg(game_id, wins) from public.game_progress where user_id = auth.uid()), '{}'::jsonb),
    'runs',     coalesce((select jsonb_object_agg(game_id, state) from public.runs where user_id = auth.uid()), '{}'::jsonb),
    'phases',   coalesce((select jsonb_object_agg(game_id, jsonb_build_object('level', level, 'hints', hints, 'puzzle', puzzle))
                          from public.phase_runs where user_id = auth.uid()), '{}'::jsonb),
    'coins',    coalesce((select jsonb_object_agg(game_id, jsonb_build_object('coins', coins, 'anchor', (extract(epoch from anchor) * 1000)::bigint))
                          from public.coins where user_id = auth.uid()), '{}'::jsonb),
    'scores',   coalesce((select jsonb_object_agg(game_id, jsonb_build_object('points', points, 'wins', wins, 'updatedAt', (extract(epoch from updated_at) * 1000)::bigint))
                          from public.scores where user_id = auth.uid()), '{}'::jsonb),
    'activity', coalesce((select jsonb_object_agg(game_id, jsonb_build_object('plays', plays, 'lastPlayedAt', (extract(epoch from last_played_at) * 1000)::bigint))
                          from public.activity where user_id = auth.uid()), '{}'::jsonb)
  )
$$;

-- ---------------------------------------------------------------------------------------------------
-- 7. Permissões: só o administrador muda a configuração; o resto é interno (funções security definer).
-- ---------------------------------------------------------------------------------------------------
revoke all on function public.max_scenarios()   from public, anon, authenticated;
revoke all on function public.coins_cap()        from public, anon, authenticated;
revoke all on function public.set_coins_per_day(int) from public, anon, authenticated;
grant execute on function public.set_coins_per_day(int) to authenticated;
