-- =====================================================================================================
-- WebMiniGames · coins de teste por conta (painel do administrador)
--
-- Como aplicar: Supabase > SQL Editor > cole este arquivo inteiro > Run (ou `supabase db push`).
-- Rode DEPOIS de 20261021000000_desafio_diario.sql e 20261022000000_diario_configuravel.sql.
--
-- O que muda:
--   * O administrador pode recarregar os COINS DO DIA de uma conta qualquer (pelo e-mail do login) para testar
--     sem esperar a virada do dia. Não toca em pontos, nível, vitórias nem no resultado dos cenários: mexe só
--     no saldo do dia (`daily_coins`), em um jogo ou em todos.
--   * O e-mail é resolvido em auth.users (o `profiles` não guarda e-mail). Só o administrador executa, checado
--     no servidor. O saldo pode passar do limite normal; quem decide quantos cenários existem é `coins_cap()`.
-- =====================================================================================================

-- Recarrega os coins do dia de uma conta (p_email) em um jogo (p_game) — ou em todos, se p_game for null.
-- Devolve o nome, o e-mail, o dia, o valor dado e a lista de jogos alterados. Uso: teste do administrador.
create function public.admin_grant_coins(p_email text, p_game text default null, p_coins int default 10)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_uid   uuid;
  v_name  text;
  v_day   date := public.daily_day();
  v_games jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_email = '' then raise exception 'invalid_email' using errcode = '22023'; end if;
  if p_coins is null or p_coins < 0 or p_coins > 99999 then raise exception 'invalid_coins' using errcode = '22023'; end if;
  if p_game is not null and not exists (select 1 from public.games where id = p_game) then raise exception 'unknown_game' using errcode = '22023'; end if;

  select u.id, coalesce(p.nickname, p.name) into v_uid, v_name
    from auth.users u left join public.profiles p on p.id = u.id
   where lower(u.email) = v_email;
  if v_uid is null then raise exception 'unknown_user' using errcode = '22023'; end if;

  insert into public.daily_coins (user_id, day, game_id, coins)
    select v_uid, v_day, g.id, p_coins from public.games g where p_game is null or g.id = p_game
    on conflict (user_id, day, game_id) do update set coins = excluded.coins;

  select jsonb_agg(g.id order by g.sort) into v_games
    from public.games g where p_game is null or g.id = p_game;

  return jsonb_build_object('email', v_email, 'name', v_name, 'day', v_day, 'coins', p_coins, 'games', v_games);
end $$;

revoke all on function public.admin_grant_coins(text, text, int) from public, anon, authenticated;
grant execute on function public.admin_grant_coins(text, text, int) to authenticated;
