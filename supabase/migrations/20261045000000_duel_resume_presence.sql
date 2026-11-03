-- ====================================================================================================
-- WebMiniGames · Duelos 1×1 — retomar a sala ativa e presença do desafiante
--
-- Rode DEPOIS de 20261044000000_duel_invite_flow.sql.
--
-- Problemas que esta migração resolve:
--
--   1. O criador abria a sala, alguém entrava e, ao clicar no jogo no hub, caía na tela de CRIAR sala
--      (a sala com 2 jogadores some da lista de Salas Online e a página do jogo não sabia procurar a
--      sala em andamento do próprio usuário). Agora `duel_mine` devolve o duelo ativo do usuário naquele
--      jogo e a página o retoma (sala esperando, com ou sem desafiante, ou partida em andamento).
--
--   2. O desafiante entra já PRONTO (20261044) e o criador aceita depois. Se o desafiante fechou a página
--      nesse meio-tempo, aceitar iniciaria uma partida contra alguém que não está lá e o relógio dele
--      correria sozinho. Agora a sala de espera registra presença (`last_seen_at`, carimbada a cada
--      consulta de estado enquanto a sala está `waiting`) e:
--        * `duel_ready` do criador recusa com `opponent_away` quando o desafiante, que já está pronto,
--          some há mais de 90 s (o limite cobre abas em segundo plano, que o navegador desacelera);
--        * `duel_invites` informa `opponent.away` para o aviso mostrar o estado real.
--
-- O que muda:
--   1. coluna `duel_players.last_seen_at`;
--   2. `duel_touch(uid, duelo)`: carimba a presença (só `waiting`);
--   3. `duel_mine(uid, jogo)`: duelo ativo do usuário naquele jogo (`waiting` não expirado ou `running`);
--   4. `duel_invites`: o desafiante ganha `away`;
--   5. `duel_ready`: guarda `opponent_away` (e carimba a presença de quem marca pronto).
--
-- Segurança: continuam só a Edge Function `play` (service_role) executando as funções.
-- Idempotente: pode ser rodada de novo.
-- ====================================================================================================

-- ----------------------------------------------------------------------------------------------------
-- 1. Presença na sala de espera
-- ----------------------------------------------------------------------------------------------------
alter table public.duel_players add column if not exists last_seen_at timestamptz;

create or replace function public.duel_touch(p_uid uuid, p_duel uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  update public.duel_players dp
     set last_seen_at = now()
   where dp.duel_id = p_duel
     and dp.user_id = p_uid
     and exists (select 1 from public.duels d where d.id = p_duel and d.status = 'waiting');
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 2. Duelo ativo do usuário num jogo (para a página retomar em vez de oferecer "criar sala")
--    Devolve { duel: null } quando não há nenhum.
-- ----------------------------------------------------------------------------------------------------
create or replace function public.duel_mine(p_uid uuid, p_game text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_duel jsonb;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select jsonb_build_object(
           'id',        d.id,
           'code',      d.code,
           'gameId',    d.game_id,
           'status',    d.status,
           'createdBy', d.created_by
         ) into v_duel
    from public.duels d
    join public.duel_players dp on dp.duel_id = d.id and dp.user_id = p_uid
   where d.game_id = p_game
     and (d.status = 'running' or (d.status = 'waiting' and d.expires_at > now()))
   order by d.created_at desc
   limit 1;

  return jsonb_build_object('duel', v_duel);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 3. Aviso de desafiante: igual à 20261044, mais `opponent.away`
-- ----------------------------------------------------------------------------------------------------
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
     order by d.created_at desc
     limit 5
  ) q;

  return coalesce(v_invites, '[]'::jsonb);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 4. Pronto: igual à 20261035, mais a guarda do desafiante ausente
--    Só barra quando ESTA chamada iniciaria o duelo (o outro jogador já está pronto) e ele sumiu.
-- ----------------------------------------------------------------------------------------------------
create or replace function public.duel_ready(p_uid uuid, p_duel uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
  v_ready int;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into v_duel from public.duels where id = p_duel for update;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if not exists (select 1 from public.duel_players where duel_id = p_duel and user_id = p_uid) then
    raise exception 'not_member' using errcode = '55000';
  end if;
  if v_duel.status <> 'waiting' then raise exception 'bad_status' using errcode = '55000'; end if;

  if exists (
    select 1 from public.duel_players o
     where o.duel_id = p_duel and o.user_id <> p_uid and o.ready
       and coalesce(o.last_seen_at, o.joined_at) < now() - interval '90 seconds'
  ) then
    raise exception 'opponent_away' using errcode = '55000';
  end if;

  update public.duel_players set ready = true, last_seen_at = now()
   where duel_id = p_duel and user_id = p_uid;

  select count(*) into v_ready from public.duel_players where duel_id = p_duel and ready = true;
  if v_ready = 2 then
    update public.duels
       set status = 'running', starts_at = now() + interval '4 seconds'
     where id = p_duel
     returning * into v_duel;
  end if;

  return jsonb_build_object(
    'status', v_duel.status,
    'startsAt', v_duel.starts_at,
    'serverNow', now()
  );
end $$;

revoke all on function public.duel_touch(uuid, uuid) from public, anon, authenticated;
grant execute on function public.duel_touch(uuid, uuid) to service_role;
revoke all on function public.duel_mine(uuid, text) from public, anon, authenticated;
grant execute on function public.duel_mine(uuid, text) to service_role;
revoke all on function public.duel_invites(uuid) from public, anon, authenticated;
grant execute on function public.duel_invites(uuid) to service_role;
revoke all on function public.duel_ready(uuid, uuid) from public, anon, authenticated;
grant execute on function public.duel_ready(uuid, uuid) to service_role;

-- FIM DA MIGRAÇÃO 20261045000000_duel_resume_presence.sql
