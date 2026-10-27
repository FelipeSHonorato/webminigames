-- =====================================================================================================
-- WebMiniGames · Text Twist: o relógio do desafio só começa no primeiro movimento
--
-- Como aplicar: Supabase > SQL Editor > cole este arquivo inteiro > Run (ou `supabase db push`).
-- Rode DEPOIS de 20261033000000_texttwist_trofeus.sql.
--
-- O que muda:
--   * `daily_runs` ganha `started`: abrir o cenário NÃO conta como jogar. O relógio do servidor
--     (`started_at`) passa a começar no primeiro movimento, pela nova função `daily_start`.
--   * `daily_open` devolve `started` para o cliente saber se retoma com o tempo que sobrou (rodada já
--     começada) ou se espera o primeiro movimento com o tempo cheio (jogador só abriu a página).
--   * Sem isso, abrir o Text Twist e sair "queimava" o cenário: o relógio de 120 s corria com a página
--     fechada e, ao voltar, o cliente registrava uma derrota (0 palavras) sem o jogador ter jogado.
--
-- Os outros jogos continuam iguais: só o Text Twist lê `started` (é o único com contagem regressiva).
-- =====================================================================================================

alter table public.daily_runs add column if not exists started boolean not null default false;

-- ---------------------------------------------------------------------------------------------------
-- 1. Primeiro movimento: liga a rodada e começa o relógio do servidor (só na primeira vez).
-- ---------------------------------------------------------------------------------------------------
create or replace function public.daily_start(p_uid uuid, p_game text, p_slot int, p_day date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_day date := coalesce(p_day, public.daily_day());
  v_run public.daily_runs;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  update public.daily_runs
     set started    = true,
         started_at = case when started then started_at else now() end
   where user_id = p_uid and day = v_day and game_id = p_game and slot = p_slot
   returning * into v_run;
  if not found then raise exception 'no_phase' using errcode = '22023'; end if;
  return jsonb_build_object(
    'startedAt', (extract(epoch from v_run.started_at) * 1000)::bigint,
    'started', v_run.started
  );
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 2. `daily_open` também informa se a rodada já começou (mantém todo o resto do fluxo).
-- ---------------------------------------------------------------------------------------------------
create or replace function public.daily_open(p_uid uuid, p_game text, p_slot int, p_day date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_today  date := public.daily_day();
  v_day    date := coalesce(p_day, v_today);
  v_cap    int  := public.coins_cap();
  v_coins  int;
  v_level  smallint;
  v_seed   bigint;
  v_run    public.daily_runs;
  v_ticket public.daily_tickets;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.games where id = p_game) then raise exception 'unknown_game' using errcode = '22023'; end if;
  if v_day > v_today then raise exception 'future_day' using errcode = '22023'; end if;
  if p_slot is null or p_slot < 1 or p_slot > public.max_scenarios() then raise exception 'bad_slot' using errcode = '22023'; end if;

  perform public.daily_grant(p_uid, p_game);

  select * into v_run from public.daily_runs
    where user_id = p_uid and day = v_day and game_id = p_game and slot = p_slot;
  if found then
    select count(*)::int into v_coins from public.daily_tickets
      where user_id = p_uid and game_id = p_game;
    return jsonb_build_object(
      'day', v_run.day, 'level', v_run.level, 'slot', v_run.slot, 'slots', v_cap, 'seed', v_run.seed,
      'startedAt', (extract(epoch from v_run.started_at) * 1000)::bigint,
      'started', v_run.started,
      'coins', v_coins, 'resumed', true
    );
  end if;

  select * into v_ticket from public.daily_tickets
    where user_id = p_uid and day = v_day and game_id = p_game and slot = p_slot
    for update;
  if not found then raise exception 'no_coins' using errcode = '22023'; end if;

  v_level := v_ticket.level;
  v_seed  := v_ticket.seed;
  delete from public.daily_tickets
    where user_id = p_uid and day = v_day and game_id = p_game and slot = p_slot;

  insert into public.daily_runs (user_id, day, game_id, slot, level, seed, hints, started_at)
    values (p_uid, v_day, p_game, p_slot, v_level, v_seed, 0, now())
    on conflict (user_id, day, game_id, slot) do nothing;

  select * into v_run from public.daily_runs
    where user_id = p_uid and day = v_day and game_id = p_game and slot = p_slot;
  select count(*)::int into v_coins from public.daily_tickets
    where user_id = p_uid and game_id = p_game;

  return jsonb_build_object(
    'day', v_run.day, 'level', v_run.level, 'slot', v_run.slot, 'slots', v_cap, 'seed', v_run.seed,
    'startedAt', (extract(epoch from v_run.started_at) * 1000)::bigint,
    'started', v_run.started,
    'coins', v_coins, 'resumed', false
  );
end $$;

revoke all on function public.daily_start(uuid, text, int, date) from public, anon, authenticated;
grant execute on function public.daily_start(uuid, text, int, date) to service_role;
