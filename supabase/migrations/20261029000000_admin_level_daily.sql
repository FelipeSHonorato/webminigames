-- =====================================================================================================
-- WebMiniGames · troca de nível do administrador reinicia o desafio diário do jogo
--
-- Como aplicar: Supabase > SQL Editor > cole este arquivo inteiro > Run (ou `supabase db push`).
-- Rode DEPOIS de 20261028000000_daily_top_times.sql.
--
-- O nível e a seed dos tickets diários são congelados na concessão. Sem limpar a fila, o administrador
-- continua recebendo cenários do nível antigo depois de trocar o nível no painel. Os tickets e as
-- tentativas abertas do jogo saem, e os resultados de hoje também, para `daily_status`/`daily_grant`
-- recriarem os cenários do dia no nível novo. O histórico dos dias anteriores é preservado.
-- =====================================================================================================

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
  delete from public.runs         where user_id = auth.uid() and game_id = p_game;
  delete from public.phase_runs   where user_id = auth.uid() and game_id = p_game;
  delete from public.daily_tickets where user_id = auth.uid() and game_id = p_game;
  delete from public.daily_runs    where user_id = auth.uid() and game_id = p_game;
  delete from public.daily_results
    where user_id = auth.uid() and game_id = p_game and day = public.daily_day();
  return jsonb_build_object('wins', v_wins);
end $$;

revoke all on function public.admin_set_level(text, int)     from public, anon, authenticated;
grant execute on function public.admin_set_level(text, int)    to authenticated;
