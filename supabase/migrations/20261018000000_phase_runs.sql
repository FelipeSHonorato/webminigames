-- =====================================================================================================
-- WebMiniGames · fase autoritativa + pontos e ritmo decididos no servidor (anti-farm)
--
-- Como aplicar: Supabase > SQL Editor > cole este arquivo inteiro > Run (ou `supabase db push` com a CLI).
-- Rode DEPOIS das migrações 20261014000000_init.sql e 20261017000000_delete_account.sql.
--
-- O que muda:
--   * O cliente NÃO escolhe mais os pontos. `submit_win` calcula os pontos a partir do NÍVEL (o teto do
--     nível é a pontuação cheia; a dica só reduz, nunca abaixo de 1). Antes o navegador enviava os pontos
--     e o servidor apenas limitava ao teto — quem editava o JavaScript podia se dar o teto sempre. Isso
--     acabou: o servidor decide.
--   * Ritmo: no máximo UMA vitória por jogo a cada `phase_min_seconds`. Sem isso, uma pessoa podia chamar
--     `submit_win` em série (editando o JS) e farmar o ranking. As vitórias reenviadas (mesmo `p_op`) são
--     reconhecidas antes do ritmo, para a fila offline continuar funcionando.
--   * Fase aberta (`phase_runs`): o cliente registra a fase em `new_run` (seed e nível) e o servidor guarda.
--     Serve de base para, numa próxima etapa, validar a jogada de verdade (Edge Function). Enquanto a fase
--     estiver aberta, a vitória também precisa respeitar o tempo desde o início dela.
--
-- O navegador continua sem permissão de escrever nessas tabelas: só chama as funções.
-- =====================================================================================================

-- Ritmo mínimo entre vitórias seguidas num jogo (segundos). Mantenha pequeno: é uma trava anti-farm, não
-- o tempo esperado de jogo (a fase real é resolvida em bem mais que isto).
create function public.phase_min_seconds() returns int language sql immutable set search_path = '' as $$ select 3 $$;

-- Fase aberta de cada jogador em cada jogo: só o servidor escreve (nenhum papel do navegador tem acesso).
create table public.phase_runs (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  game_id    text not null references public.games (id),
  seed       bigint not null default 0 check (seed >= 0 and seed < 4294967296),
  level      smallint not null check (level >= 0),
  started_at timestamptz not null default now(),
  primary key (user_id, game_id)
);
alter table public.phase_runs enable row level security;
revoke all on public.phase_runs from anon, authenticated;

-- Abre (ou mantém) a fase atual. O nível é decidido pelo servidor. Chamar de novo para a MESMA fase não
-- reinicia o relógio do ritmo: só atualiza a seed guardada. A fase é consumida ao vencer.
create function public.new_run(p_game text, p_seed bigint default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_wins  int;
  v_level smallint;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.games where id = p_game) then raise exception 'unknown_game' using errcode = '22023'; end if;

  insert into public.game_progress (user_id, game_id) values (v_uid, p_game) on conflict do nothing;
  select wins into v_wins from public.game_progress where user_id = v_uid and game_id = p_game;
  v_level := least(array_length(public.points_per_level(), 1) - 1, v_wins / public.wins_per_level());

  insert into public.phase_runs (user_id, game_id, seed, level)
    values (v_uid, p_game, greatest(coalesce(p_seed, 0), 0), v_level)
    on conflict (user_id, game_id) do update set seed = excluded.seed;   -- mantém started_at (não reinicia o ritmo)

  return jsonb_build_object('level', v_level);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Vitória: valida, pontua (o SERVIDOR decide), sobe a progressão e gasta 1 coin, tudo numa transação.
--   p_op    = id único da vitória (renviar o mesmo não conta de novo);
--   p_hints = dicas usadas (só reduz os pontos; o cliente não escolhe os pontos).
-- ---------------------------------------------------------------------------------------------------
drop function if exists public.submit_win(text, int, uuid);
create function public.submit_win(p_game text, p_op uuid default null, p_hints int default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_op     uuid := coalesce(p_op, gen_random_uuid());
  v_min    interval := make_interval(secs => public.phase_min_seconds());
  v_wins   int;
  v_level  smallint;
  v_cap    int;
  v_points int;
  v_inserted int;
  v_phase  public.phase_runs;
  v_score  public.scores;
  v_coins  public.coins;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.games where id = p_game) then raise exception 'unknown_game' using errcode = '22023'; end if;

  -- Reenvio da MESMA vitória (rede instável): devolve o estado, sem contar de novo nem esbarrar no ritmo.
  if exists (select 1 from public.win_log where user_id = v_uid and op_id = v_op) then
    select * into v_score from public.scores where user_id = v_uid and game_id = p_game;
    v_coins := public.coins_apply(v_uid, p_game, false);
    return jsonb_build_object(
      'duplicate', true,
      'wins', coalesce((select wins from public.game_progress where user_id = v_uid and game_id = p_game), 0),
      'score', jsonb_build_object('points', coalesce(v_score.points, 0), 'wins', coalesce(v_score.wins, 0), 'updatedAt', (extract(epoch from coalesce(v_score.updated_at, now())) * 1000)::bigint),
      'coins', jsonb_build_object('coins', v_coins.coins, 'anchor', (extract(epoch from v_coins.anchor) * 1000)::bigint)
    );
  end if;

  -- Ritmo: no máximo uma vitória por jogo a cada phase_min_seconds (impede farmar pontos em série).
  -- Erro RETENTÁVEL (P0001, não 22023): vitórias legítimas jogadas offline chegam juntas na fila; o cliente
  -- deve reenviar com calma, uma de cada vez, em vez de descartar.
  if exists (select 1 from public.win_log where user_id = v_uid and game_id = p_game and created_at > now() - v_min) then
    raise exception 'too_fast';
  end if;

  insert into public.game_progress (user_id, game_id) values (v_uid, p_game) on conflict do nothing;
  select wins into v_wins from public.game_progress where user_id = v_uid and game_id = p_game for update;   -- serializa vitórias simultâneas
  v_level := least(array_length(public.points_per_level(), 1) - 1, v_wins / public.wins_per_level());

  -- Fase aberta (se houver): o relógio dela e o nível em que a fase nasceu (a pontuação acompanha a fase).
  select * into v_phase from public.phase_runs where user_id = v_uid and game_id = p_game for update;
  if found then
    if now() - v_phase.started_at < v_min then raise exception 'too_fast'; end if;
    v_level := v_phase.level;
  end if;

  -- Pontos: o teto do nível é a pontuação cheia; cada dica tira 1 ponto, nunca abaixo de 1.
  v_cap := (public.points_per_level())[v_level + 1];
  v_points := greatest(1, v_cap - least(greatest(coalesce(p_hints, 0), 0), v_cap - 1));

  insert into public.win_log (user_id, op_id, game_id, level, points) values (v_uid, v_op, p_game, v_level, v_points)
    on conflict (user_id, op_id) do nothing;                              -- corrida: a MESMA vitória registrada em paralelo
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    select * into v_score from public.scores where user_id = v_uid and game_id = p_game;
    v_coins := public.coins_apply(v_uid, p_game, false);
    return jsonb_build_object(
      'duplicate', true,
      'wins', coalesce((select wins from public.game_progress where user_id = v_uid and game_id = p_game), 0),
      'score', jsonb_build_object('points', coalesce(v_score.points, 0), 'wins', coalesce(v_score.wins, 0), 'updatedAt', (extract(epoch from coalesce(v_score.updated_at, now())) * 1000)::bigint),
      'coins', jsonb_build_object('coins', v_coins.coins, 'anchor', (extract(epoch from v_coins.anchor) * 1000)::bigint)
    );
  end if;

  update public.game_progress set wins = wins + 1, updated_at = now() where user_id = v_uid and game_id = p_game returning wins into v_wins;
  insert into public.scores (user_id, game_id, points, wins, updated_at) values (v_uid, p_game, v_points, 1, now())
    on conflict (user_id, game_id) do update
    set points = public.scores.points + excluded.points, wins = public.scores.wins + 1, updated_at = now();
  delete from public.phase_runs where user_id = v_uid and game_id = p_game;   -- a fase foi resolvida
  v_coins := public.coins_apply(v_uid, p_game, true);

  select * into v_score from public.scores where user_id = v_uid and game_id = p_game;
  return jsonb_build_object(
    'duplicate', false,
    'wins', v_wins,
    'score', jsonb_build_object('points', v_score.points, 'wins', v_score.wins, 'updatedAt', (extract(epoch from v_score.updated_at) * 1000)::bigint),
    'coins', jsonb_build_object('coins', v_coins.coins, 'anchor', (extract(epoch from v_coins.anchor) * 1000)::bigint)
  );
end $$;

-- Administrador: além da fase salva (public.runs), descarta a fase aberta da nuvem, para o relógio do
-- ritmo não sobrar de uma fase antiga quando ele troca de nível.
create or replace function public.admin_set_level(p_game text, p_level int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_wins int;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.games where id = p_game) then raise exception 'unknown_game' using errcode = '22023'; end if;
  if p_level is null or p_level < 0 or p_level >= array_length(public.points_per_level(), 1) then raise exception 'invalid_level' using errcode = '22023'; end if;
  v_wins := p_level * public.wins_per_level();
  insert into public.game_progress (user_id, game_id, wins) values (auth.uid(), p_game, v_wins)
    on conflict (user_id, game_id) do update set wins = excluded.wins, updated_at = now();
  delete from public.runs       where user_id = auth.uid() and game_id = p_game;
  delete from public.phase_runs where user_id = auth.uid() and game_id = p_game;
  return jsonb_build_object('wins', v_wins);
end $$;

-- Permissões mínimas: só o próprio jogador (autenticado) chama; visitante e anônimo não têm EXECUTE.
revoke all on function public.new_run(text, bigint)          from public, anon, authenticated;
grant execute on function public.new_run(text, bigint)         to authenticated;
revoke all on function public.submit_win(text, uuid, int)    from public, anon, authenticated;
grant execute on function public.submit_win(text, uuid, int)   to authenticated;
revoke all on function public.admin_set_level(text, int)     from public, anon, authenticated;
grant execute on function public.admin_set_level(text, int)    to authenticated;
