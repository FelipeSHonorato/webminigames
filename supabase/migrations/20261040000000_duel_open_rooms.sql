-- ====================================================================================================
-- WebMiniGames · Duelos 1×1 — lista de salas abertas (página "Salas Online")
--
-- Rode DEPOIS de 20261039000000_duel_ratings.sql.
--
-- O que cria:
--   * duel_open_rooms(p_uid, p_limit): as salas que esperam um desafiante (status 'waiting', não
--     expiradas e com UM só jogador), da mais nova para a mais antiga.
--
-- O que ela NÃO devolve de propósito: o `code` do convite, a seed e o puzzle (`public_view` /
-- `full_puzzle`). Quem vê a lista não pode entrar sem passar pelo fluxo de entrada, e o cenário só sai
-- do servidor depois da largada. As tabelas continuam fechadas ao navegador (RLS sem policy): só a
-- Edge Function `play` (service_role) executa esta função, igual às demais funções de duelo.
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
               'host',       jsonb_build_object('nickname', coalesce(p.nickname, p.name), 'avatar', p.avatar)
             ) as room
        from public.duels d
        left join public.profiles p on p.id = d.created_by
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

-- FIM DA MIGRAÇÃO 20261040000000_duel_open_rooms.sql
