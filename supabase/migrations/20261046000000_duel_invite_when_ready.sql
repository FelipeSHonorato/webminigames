-- ====================================================================================================
-- WebMiniGames · Duelos 1×1 — o criador só é avisado quando o desafiante clica em "Estou pronto"
--
-- Rode DEPOIS de 20261045000000_duel_resume_presence.sql (e, antes dela, da 20261044).
--
-- Fluxo correto:
--   1. A cria a sala (pode navegar pelo site);
--   2. B entra pela lista de Salas Online (sem código) e cai na sala NÃO pronto;
--   3. B clica em "Estou pronto";
--   4. só então A recebe o pop-up em qualquer página: "Entrar na sala" ou "Desistir".
--
-- A 20261044 fazia o desafiante entrar já pronto (e o aviso aparecia na hora da entrada), o que deixava o
-- botão "Estou pronto" desabilitado e o aviso disparando cedo demais. Aqui:
--   * `duel_seat`: o desafiante entra com ready = false;
--   * `duel_invites`: só lista a sala quando o desafiante já está PRONTO.
-- O resto (duel_decline, duel_ready, duel_mine, presença) continua como está. Idempotente.
-- ====================================================================================================

create or replace function public.duel_seat(p_uid uuid, p_duel public.duels) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_players jsonb;
  v_opp jsonb;
  v_new boolean := false;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_duel.status <> 'waiting' then raise exception 'bad_status' using errcode = '55000'; end if;
  if p_duel.expires_at < now() then raise exception 'expired' using errcode = '55000'; end if;

  if not exists (select 1 from public.duel_players where duel_id = p_duel.id and user_id = p_uid) then
    if (select count(*) from public.duel_players where duel_id = p_duel.id) >= 2 then
      raise exception 'duel_full' using errcode = '55000';
    end if;
    -- Quem entra pela lista (ou pelo código) NÃO entra pronto: clica em "Estou pronto" e só então o criador é avisado.
    insert into public.duel_players (duel_id, user_id, ready)
    values (p_duel.id, p_uid, false);
    v_new := true;
  end if;

  -- Xadrez: quem entrou pega a cor que o criador não escolheu.
  if v_new and p_duel.kind = 'turn' then
    update public.chess_games
       set white_id = coalesce(white_id, p_uid),
           black_id = coalesce(black_id, p_uid),
           updated_at = now()
     where duel_id = p_duel.id;
  end if;

  select jsonb_agg(jsonb_build_object(
    'user_id', dp.user_id,
    'nickname', coalesce(p.nickname, p.name),
    'avatar', p.avatar,
    'ready', dp.ready,
    'is_me', dp.user_id = p_uid
  ) order by dp.joined_at) into v_players
  from public.duel_players dp
  join public.profiles p on p.id = dp.user_id
  where dp.duel_id = p_duel.id;

  select jsonb_build_object(
    'user_id', dp.user_id,
    'nickname', coalesce(p.nickname, p.name),
    'avatar', p.avatar,
    'ready', dp.ready
  ) into v_opp
  from public.duel_players dp
  join public.profiles p on p.id = dp.user_id
  where dp.duel_id = p_duel.id and dp.user_id <> p_uid
  limit 1;

  return jsonb_build_object(
    'id', p_duel.id, 'code', p_duel.code, 'gameId', p_duel.game_id,
    'kind', p_duel.kind, 'level', p_duel.level, 'rule', p_duel.rule,
    'maxSeconds', p_duel.max_seconds, 'open', p_duel.is_open,
    'createdBy', p_duel.created_by,
    'players', v_players, 'opponent', v_opp
  );
end $$;

create or replace function public.duel_invites(p_uid uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_invites jsonb;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select jsonb_agg(q.invite order by q.created_at desc) into v_invites
  from (
    select d.created_at,
           jsonb_build_object(
             'id',         d.id,
             'code',       d.code,
             'gameId',     d.game_id,
             'kind',       d.kind,
             'level',      d.level,
             'maxSeconds', d.max_seconds,
             'createdAt',  d.created_at,
             'expiresAt',  d.expires_at,
             'opponent',   (
               select jsonb_build_object(
                 'nickname', coalesce(p.nickname, p.name),
                 'avatar',   p.avatar,
                 'ready',    dp.ready,
                 'away',     coalesce(dp.last_seen_at, dp.joined_at) < now() - interval '90 seconds'
               )
               from public.duel_players dp
               join public.profiles p on p.id = dp.user_id
               where dp.duel_id = d.id and dp.user_id <> p_uid
               limit 1
             )
           ) as invite
      from public.duels d
     where d.created_by = p_uid
       and d.status = 'waiting'
       and d.expires_at > now()
       and (select count(*) from public.duel_players dp where dp.duel_id = d.id) = 2
       and exists (select 1 from public.duel_players dp
                    where dp.duel_id = d.id and dp.user_id <> p_uid and dp.ready)
     order by d.created_at desc
     limit 5
  ) q;

  return coalesce(v_invites, '[]'::jsonb);
end $$;

revoke all on function public.duel_seat(uuid, public.duels) from public, anon, authenticated;
revoke all on function public.duel_invites(uuid) from public, anon, authenticated;
grant execute on function public.duel_invites(uuid) to service_role;

-- FIM DA MIGRAÇÃO 20261046000000_duel_invite_when_ready.sql
