-- =====================================================================================================
-- WebMiniGames · ficha pública do jogador (pop-up do ranking)
--
-- O ranking só devolve nome/apelido, foto, região e pontos. Ao clicar num nome, o site pede esta
-- função para completar a ficha: quando a conta foi criada, o jogo favorito (mais partidas) e o
-- último jogo jogado. Nada de e-mail, senha ou outra informação da conta sai daqui.
-- =====================================================================================================
create or replace function public.player_card(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id',        p.id,
    'name',      coalesce(p.nickname, p.name),
    'avatar',    p.avatar,
    'region',    p.region,
    'createdAt', (extract(epoch from p.created_at) * 1000)::bigint,
    'favorite',  (
      select jsonb_build_object('game', a.game_id, 'plays', a.plays)
      from public.activity a
      where a.user_id = p.id
      order by a.plays desc, a.last_played_at desc, a.game_id
      limit 1
    ),
    'last',      (
      select jsonb_build_object('game', a.game_id, 'at', (extract(epoch from a.last_played_at) * 1000)::bigint)
      from public.activity a
      where a.user_id = p.id
      order by a.last_played_at desc, a.game_id
      limit 1
    )
  )
  from public.profiles p
  where p.id = p_user
$$;

-- A ficha é pública (o ranking também é): qualquer visitante pode abrir o pop-up.
revoke all on function public.player_card(uuid) from public, anon, authenticated;
grant execute on function public.player_card(uuid) to anon, authenticated;
