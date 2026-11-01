-- ====================================================================================================
-- WebMiniGames · Salas Online — pontuação do criador ao lado do nome
--
-- Rode DEPOIS de 20261041000000_one_open_room.sql.
--
-- A lista de salas abertas passa a devolver, em `host.rating`, a pontuação do criador NAQUELE jogo
-- (a mesma do ranking de duelos: `duel_ratings`, um rating por jogo). Quem ainda não disputou o jogo
-- não tem linha em `duel_ratings` e aparece com 1500, o valor inicial — igual à barra do tabuleiro (chess_json).
--
-- É só `create or replace` da função da migração 20261040: o resto (filtros, o que NÃO é devolvido, grants)
-- continua igual. Não devolve código do convite, seed nem puzzle.
-- ====================================================================================================

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
               'mine',       d.created_by = p_uid,
               'host',       jsonb_build_object('nickname', coalesce(p.nickname, p.name), 'avatar', p.avatar,
                                'rating', coalesce(dr.rating, 1500))
             ) as room
        from public.duels d
        left join public.profiles p on p.id = d.created_by
        left join public.duel_ratings dr on dr.game_id = d.game_id and dr.user_id = d.created_by
       where d.status = 'waiting'
         and d.expires_at > now()
         and (select count(*) from public.duel_players dp where dp.duel_id = d.id) < 2
       order by d.created_at desc
       limit v_limit
    ) q
  ), '[]'::jsonb);
end $$;

revoke all on function public.duel_open_rooms(uuid, int) from public, anon, authenticated;
grant execute on function public.duel_open_rooms(uuid, int) to service_role;

-- FIM DA MIGRAÇÃO 20261042000000_duel_open_rooms_rating.sql
