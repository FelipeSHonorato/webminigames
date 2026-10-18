-- =====================================================================================================
-- WebMiniGames · fase servida pelo servidor + validação de tabuleiro (Edge Function "play")
--
-- Como aplicar: Supabase > SQL Editor > cole este arquivo inteiro > Run (ou `supabase db push`).
-- Rode DEPOIS de 20261014000000_init.sql, 20261017000000_delete_account.sql e 20261018000000_phase_runs.sql.
--
-- O que muda:
--   * O SERVIDOR passa a "servir" a fase: a Edge Function gera a SEED (que NUNCA vai ao cliente) e o PUZZLE
--     PÚBLICO (sem a solução), guarda os dois em `phase_runs` (seed só no servidor; puzzle para o cliente
--     renderizar) e cobra 1 coin ao abrir. Sem a seed, o cliente não consegue derivar a solução.
--   * Ao concluir, o cliente manda o TABULEIRO; a Edge Function regenera o puzzle a partir da seed guardada,
--     valida e, se for solução legítima, chama `finalize_win` (que pontua, sobe progressão e apaga a fase).
--     As dicas também são decididas no servidor (`use_hint`).
--   * O navegador NÃO chama mais `submit_win` nem `new_run`: as funções de escrita desta etapa só podem ser
--     chamadas pela Edge Function, com a chave service_role. `finalize_win`/`open_phase`/`use_hint` não têm
--     EXECUTE para anon/authenticated.
--
-- Passo a passo de deploy (CLI): `supabase functions deploy play` e defina o segredo
--   `supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...` (a URL do projeto é injetada automaticamente).
-- =====================================================================================================

-- A fase guardada ganha o contador de dicas (decidido no servidor) e o puzzle público (sem solução).
alter table public.phase_runs add column hints  smallint not null default 0;
alter table public.phase_runs add column puzzle jsonb;

-- Nível atual do jogador num jogo (garante a linha de progressão). Usado pela Edge Function para montar o puzzle.
create function public.level_for(p_uid uuid, p_game text) returns smallint
language plpgsql security definer set search_path = '' as $$
declare v_wins int;
begin
  if not exists (select 1 from public.games where id = p_game) then raise exception 'unknown_game' using errcode = '22023'; end if;
  insert into public.game_progress (user_id, game_id) values (p_uid, p_game) on conflict do nothing;
  select wins into v_wins from public.game_progress where user_id = p_uid and game_id = p_game;
  return least(array_length(public.points_per_level(), 1) - 1, v_wins / public.wins_per_level());
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Abre (serve) a fase: cobra 1 coin, calcula o nível, guarda a SEED (secreta) e o PUZZLE PÚBLICO.
-- Só a Edge Function chama (service_role). O cliente recebe de volta { level, hints, puzzle, coins } — nunca a seed.
-- ---------------------------------------------------------------------------------------------------
create function public.open_phase(p_uid uuid, p_game text, p_seed bigint, p_puzzle jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_level  smallint;
  v_coins  public.coins;
  v_before int;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.games where id = p_game) then raise exception 'unknown_game' using errcode = '22023'; end if;

  perform public.coins_apply(p_uid, p_game, false);                                       -- materializa a recarga do dia
  select coins into v_before from public.coins where user_id = p_uid and game_id = p_game;
  if v_before <= 0 then raise exception 'no_coins' using errcode = '22023'; end if;       -- sem coin não abre fase (o cheater não vence de graça)

  v_level := public.level_for(p_uid, p_game);
  perform public.coins_apply(p_uid, p_game, true);                                        -- gasta 1 coin ao abrir

  insert into public.phase_runs (user_id, game_id, seed, level, hints, puzzle, started_at)
    values (p_uid, p_game, greatest(coalesce(p_seed, 0), 0), v_level, 0, p_puzzle, now())
    on conflict (user_id, game_id) do update
      set seed = excluded.seed, level = excluded.level, hints = 0, puzzle = excluded.puzzle, started_at = now();

  select * into v_coins from public.coins where user_id = p_uid and game_id = p_game;
  return jsonb_build_object(
    'level', v_level, 'hints', 0, 'puzzle', p_puzzle,
    'coins', jsonb_build_object('coins', v_coins.coins, 'anchor', (extract(epoch from v_coins.anchor) * 1000)::bigint)
  );
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Dica: incrementa e devolve o novo contador. A Edge Function decide QUAL é a dica (com a lógica do jogo);
-- aqui só contamos, para a pontuação (o cliente não consegue "esconder" dicas usadas).
-- ---------------------------------------------------------------------------------------------------
create function public.use_hint(p_uid uuid, p_game text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_hints smallint;
begin
  update public.phase_runs set hints = hints + 1 where user_id = p_uid and game_id = p_game returning hints into v_hints;
  if v_hints is null then raise exception 'no_phase' using errcode = '22023'; end if;
  return jsonb_build_object('hints', v_hints);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Vitória JÁ VALIDADA pela Edge Function (o tabuleiro confere com a seed guardada). Pontua, sobe a
-- progressão e apaga a fase (consumida). NÃO gasta coin: o coin já foi cobrado ao abrir a fase.
-- ---------------------------------------------------------------------------------------------------
create function public.finalize_win(p_uid uuid, p_game text, p_op uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_op       uuid := coalesce(p_op, gen_random_uuid());
  v_min      interval := make_interval(secs => public.phase_min_seconds());
  v_phase    public.phase_runs;
  v_wins     int;
  v_cap      int;
  v_points   int;
  v_inserted int;
  v_score    public.scores;
  v_coins    public.coins;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.games where id = p_game) then raise exception 'unknown_game' using errcode = '22023'; end if;

  -- Reenvio da mesma vitória (fila/instabilidade): devolve o estado, sem contar de novo nem esbarrar no ritmo.
  if exists (select 1 from public.win_log where user_id = p_uid and op_id = v_op) then
    select * into v_score from public.scores where user_id = p_uid and game_id = p_game;
    v_coins := public.coins_apply(p_uid, p_game, false);
    return jsonb_build_object(
      'duplicate', true,
      'wins', coalesce((select wins from public.game_progress where user_id = p_uid and game_id = p_game), 0),
      'score', jsonb_build_object('points', coalesce(v_score.points, 0), 'wins', coalesce(v_score.wins, 0), 'updatedAt', (extract(epoch from coalesce(v_score.updated_at, now())) * 1000)::bigint),
      'coins', jsonb_build_object('coins', v_coins.coins, 'anchor', (extract(epoch from v_coins.anchor) * 1000)::bigint)
    );
  end if;

  -- Ritmo: uma vitória por jogo a cada phase_min_seconds (anti-farm). Erro retentável (P0001).
  if exists (select 1 from public.win_log where user_id = p_uid and game_id = p_game and created_at > now() - v_min) then
    raise exception 'too_fast';
  end if;

  select * into v_phase from public.phase_runs where user_id = p_uid and game_id = p_game for update;
  if not found then raise exception 'no_phase' using errcode = '22023'; end if;          -- fase inexistente/já consumida
  if now() - v_phase.started_at < v_min then raise exception 'too_fast'; end if;        -- fase recém-aberta: ainda não dá (anti-farm)

  insert into public.game_progress (user_id, game_id) values (p_uid, p_game) on conflict do nothing;
  v_cap := (public.points_per_level())[v_phase.level + 1];
  v_points := greatest(1, v_cap - least(greatest(coalesce(v_phase.hints, 0), 0), v_cap - 1));

  insert into public.win_log (user_id, op_id, game_id, level, points) values (p_uid, v_op, p_game, v_phase.level, v_points)
    on conflict (user_id, op_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then                                                               -- corrida: mesma vitória em paralelo
    select * into v_score from public.scores where user_id = p_uid and game_id = p_game;
    v_coins := public.coins_apply(p_uid, p_game, false);
    return jsonb_build_object(
      'duplicate', true,
      'wins', coalesce((select wins from public.game_progress where user_id = p_uid and game_id = p_game), 0),
      'score', jsonb_build_object('points', coalesce(v_score.points, 0), 'wins', coalesce(v_score.wins, 0), 'updatedAt', (extract(epoch from coalesce(v_score.updated_at, now())) * 1000)::bigint),
      'coins', jsonb_build_object('coins', v_coins.coins, 'anchor', (extract(epoch from v_coins.anchor) * 1000)::bigint)
    );
  end if;

  update public.game_progress set wins = wins + 1, updated_at = now() where user_id = p_uid and game_id = p_game returning wins into v_wins;
  insert into public.scores (user_id, game_id, points, wins, updated_at) values (p_uid, p_game, v_points, 1, now())
    on conflict (user_id, game_id) do update
    set points = public.scores.points + excluded.points, wins = public.scores.wins + 1, updated_at = now();
  delete from public.phase_runs where user_id = p_uid and game_id = p_game;              -- fase consumida

  select * into v_score from public.scores where user_id = p_uid and game_id = p_game;
  v_coins := public.coins_apply(p_uid, p_game, false);
  return jsonb_build_object(
    'duplicate', false,
    'wins', v_wins,
    'score', jsonb_build_object('points', v_score.points, 'wins', v_score.wins, 'updatedAt', (extract(epoch from v_score.updated_at) * 1000)::bigint),
    'coins', jsonb_build_object('coins', v_coins.coins, 'anchor', (extract(epoch from v_coins.anchor) * 1000)::bigint)
  );
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Snapshot: inclui a fase servida (sem a seed!) para o jogo reconstruir a fase ao recarregar a página.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.my_snapshot() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'profile', (select jsonb_build_object('id', p.id, 'name', p.name, 'nickname', p.nickname, 'region', p.region, 'avatar', p.avatar, 'role', p.role)
                from public.profiles p where p.id = auth.uid()),
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
-- Permissões: o navegador NÃO pontua mais direto. Só a Edge Function (service_role) escreve a fase.
-- ---------------------------------------------------------------------------------------------------
revoke all on function public.new_run(text, bigint)               from public, anon, authenticated;
revoke all on function public.submit_win(text, uuid, int)         from public, anon, authenticated;   -- aposentada: o tabuleiro precisa ser validado antes
revoke all on function public.level_for(uuid, text)               from public, anon, authenticated;
revoke all on function public.open_phase(uuid, text, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.use_hint(uuid, text)                from public, anon, authenticated;
revoke all on function public.finalize_win(uuid, text, uuid)      from public, anon, authenticated;
grant execute on function public.level_for(uuid, text)               to service_role;
grant execute on function public.open_phase(uuid, text, bigint, jsonb) to service_role;
grant execute on function public.use_hint(uuid, text)                to service_role;
grant execute on function public.finalize_win(uuid, text, uuid)      to service_role;
