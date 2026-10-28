-- ====================================================================================================
-- WebMiniGames · Duelos 1×1 — ajustes da infraestrutura
--
-- Rode DEPOIS de 20261035000000_duels.sql. Corrige problemas encontrados na revisão:
--   1. `profiles` usa `avatar`, não `avatar_url` (duel_join/duel_state quebravam na 1ª chamada).
--   2. `created_by NOT NULL` + `ON DELETE SET NULL` impedia excluir a conta (LGPD).
--   3. `duel_join` usava record genérico e quebrava quando o criador reentrava sozinho.
--   4. Regra `words`: `duel_finish` não gravava `words` nem chamava `duel_settle` no 2º fim.
--   5. `duel_cleanup` marcava as salas `words` como empate antes do settle (loop morto).
--   6. `is_duel_member` precisa de EXECUTE para `authenticated` (policy do Realtime);
--      `duel_gen_code` estava aberto para anon/authenticated.
--   7. `duel_start` não checava expiração; `duel_state` não devolvia os campos do lobby.
--
-- Nada aqui depende de jogo existente: a base serve para jogos novos feitos para duelo.
-- ====================================================================================================

-- ----------------------------------------------------------------------------------------------------
-- 1. LGPD: permitir que a exclusão da conta anonimize o criador (FK ON DELETE SET NULL)
-- ----------------------------------------------------------------------------------------------------
alter table public.duels alter column created_by drop not null;

-- Limites de tamanho (defesa em profundidade, como em `runs.state`)
alter table public.duels
  add constraint duels_public_view_size check (octet_length(public_view::text) <= 200000),
  add constraint duels_full_puzzle_size check (octet_length(full_puzzle::text) <= 400000);

-- O índice explícito em `code` é redundante: o UNIQUE já cria `duels_code_key`.
drop index if exists public.duels_code_idx;

-- ----------------------------------------------------------------------------------------------------
-- 2. Criar sala: validações explícitas + campos úteis no lobby
-- ----------------------------------------------------------------------------------------------------
create or replace function public.duel_create(
  p_uid uuid, p_game text, p_level int,
  p_seed bigint, p_gen int,
  p_public jsonb, p_full jsonb,
  p_rule text, p_max_seconds int
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_duel public.duels;
  v_cap int := 3;  -- máximo de salas 'waiting' por usuário
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.games where id = p_game) then
    raise exception 'unknown_game' using errcode = '22023';
  end if;
  if p_level is null or p_level < 0 then
    raise exception 'bad_level' using errcode = '22023';
  end if;
  if p_seed is null or p_seed < 0 or p_seed >= 4294967296 then
    raise exception 'bad_seed' using errcode = '22023';
  end if;
  if p_gen is null or p_gen < 0 then
    raise exception 'bad_gen' using errcode = '22023';
  end if;
  if p_rule is null or p_rule not in ('first', 'words') then
    raise exception 'bad_rule' using errcode = '22023';
  end if;
  if p_max_seconds is null or p_max_seconds < 30 or p_max_seconds > 3600 then
    raise exception 'bad_max_seconds' using errcode = '22023';
  end if;

  -- Limite de salas abertas por usuário
  if (select count(*) from public.duels
      where created_by = p_uid and status = 'waiting') >= v_cap then
    raise exception 'too_many_open' using errcode = '55000';
  end if;

  v_code := public.duel_gen_code();

  insert into public.duels (code, game_id, level, seed, gen, public_view, full_puzzle, rule, max_seconds, created_by)
  values (v_code, p_game, p_level, p_seed, p_gen, p_public, p_full, p_rule, p_max_seconds, p_uid)
  returning * into v_duel;

  insert into public.duel_players (duel_id, user_id, ready)
  values (v_duel.id, p_uid, false);

  return jsonb_build_object(
    'id', v_duel.id, 'code', v_duel.code, 'gameId', v_duel.game_id,
    'level', v_duel.level, 'maxSeconds', v_duel.max_seconds,
    'rule', v_duel.rule, 'expiresAt', v_duel.expires_at
  );
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 3. Entrar na sala: usa `avatar`, devolve jogadores e aceita reentrada do criador sozinho
-- ----------------------------------------------------------------------------------------------------
create or replace function public.duel_join(p_uid uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
  v_players jsonb;
  v_opp jsonb;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into v_duel from public.duels where code = p_code for update;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if v_duel.status <> 'waiting' then raise exception 'bad_status' using errcode = '55000'; end if;
  if v_duel.expires_at < now() then raise exception 'expired' using errcode = '55000'; end if;

  if not exists (select 1 from public.duel_players where duel_id = v_duel.id and user_id = p_uid) then
    if (select count(*) from public.duel_players where duel_id = v_duel.id) >= 2 then
      raise exception 'duel_full' using errcode = '55000';
    end if;
    insert into public.duel_players (duel_id, user_id, ready)
    values (v_duel.id, p_uid, false);
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
  where dp.duel_id = v_duel.id;

  select jsonb_build_object(
    'user_id', dp.user_id,
    'nickname', coalesce(p.nickname, p.name),
    'avatar', p.avatar,
    'ready', dp.ready
  ) into v_opp
  from public.duel_players dp
  join public.profiles p on p.id = dp.user_id
  where dp.duel_id = v_duel.id and dp.user_id <> p_uid
  limit 1;

  return jsonb_build_object(
    'id', v_duel.id, 'code', v_duel.code, 'gameId', v_duel.game_id,
    'level', v_duel.level, 'rule', v_duel.rule, 'maxSeconds', v_duel.max_seconds,
    'players', v_players, 'opponent', v_opp
  );
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 4. Entregar o puzzle: recusa depois do tempo e devolve os campos do cenário
-- ----------------------------------------------------------------------------------------------------
create or replace function public.duel_start(p_uid uuid, p_duel uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into v_duel from public.duels where id = p_duel;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if not exists (select 1 from public.duel_players where duel_id = p_duel and user_id = p_uid) then
    raise exception 'not_member' using errcode = '55000';
  end if;
  if v_duel.status <> 'running' then raise exception 'bad_status' using errcode = '55000'; end if;
  if now() < v_duel.starts_at then raise exception 'not_started' using errcode = '55000'; end if;
  if now() > v_duel.starts_at + make_interval(secs => v_duel.max_seconds) then
    raise exception 'expired' using errcode = '55000';
  end if;

  return jsonb_build_object(
    'puzzle', v_duel.public_view,
    'code', v_duel.code, 'gameId', v_duel.game_id, 'level', v_duel.level,
    'startsAt', v_duel.starts_at, 'serverNow', now(),
    'maxSeconds', v_duel.max_seconds, 'rule', v_duel.rule
  );
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 5. Estado: campos completos + settle/limpeza preguiçosa (funciona sem cron)
-- ----------------------------------------------------------------------------------------------------
create or replace function public.duel_state(p_uid uuid, p_duel uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
  v_players jsonb;
  v_winner jsonb;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into v_duel from public.duels where id = p_duel;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if not exists (select 1 from public.duel_players where duel_id = p_duel and user_id = p_uid) then
    raise exception 'not_member' using errcode = '55000';
  end if;

  -- Limpeza preguiçosa: sala waiting expirada vira cancelled.
  if v_duel.status = 'waiting' and v_duel.expires_at < now() then
    update public.duels set status = 'cancelled' where id = p_duel;
    select * into v_duel from public.duels where id = p_duel;
  end if;

  -- Limpeza preguiçosa: running expirada. `words` decide pelo placar; `first` empata.
  if v_duel.status = 'running' and v_duel.starts_at is not null
     and now() > v_duel.starts_at + make_interval(secs => v_duel.max_seconds) then
    if v_duel.rule = 'words' then
      perform public.duel_settle(p_duel);
    elsif v_duel.winner_id is null then
      update public.duels set status = 'finished', finished_at = now() where id = p_duel;
    end if;
    select * into v_duel from public.duels where id = p_duel;
  end if;

  select jsonb_agg(jsonb_build_object(
    'user_id', dp.user_id,
    'nickname', coalesce(p.nickname, p.name),
    'avatar', p.avatar,
    'ready', dp.ready,
    'finished_at', dp.finished_at,
    'seconds', dp.seconds,
    'words', dp.words,
    'is_me', dp.user_id = p_uid
  ) order by dp.joined_at) into v_players
  from public.duel_players dp
  join public.profiles p on p.id = dp.user_id
  where dp.duel_id = p_duel;

  if v_duel.winner_id is not null then
    select jsonb_build_object(
      'user_id', p.id,
      'nickname', coalesce(p.nickname, p.name),
      'avatar', p.avatar
    ) into v_winner
    from public.profiles p where p.id = v_duel.winner_id;
  end if;

  return jsonb_build_object(
    'id', v_duel.id, 'code', v_duel.code, 'gameId', v_duel.game_id,
    'level', v_duel.level, 'rule', v_duel.rule, 'maxSeconds', v_duel.max_seconds,
    'status', v_duel.status, 'startsAt', v_duel.starts_at,
    'finishedAt', v_duel.finished_at, 'expiresAt', v_duel.expires_at,
    'serverNow', now(), 'players', v_players, 'winner', v_winner
  );
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 6. Finalizar: grava `words` e decide a regra `words` quando os dois terminam
--    (assinatura nova de 4 args; a antiga de 3 é removida)
-- ----------------------------------------------------------------------------------------------------
drop function if exists public.duel_finish(uuid, uuid, uuid);

create or replace function public.duel_finish(
  p_uid uuid, p_duel uuid, p_op uuid, p_words int default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
  v_me   public.duel_players;
  v_sec  numeric;
  v_words int;
  v_finished int;
  v_winner uuid;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into v_duel from public.duels where id = p_duel for update;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;

  select * into v_me from public.duel_players where duel_id = p_duel and user_id = p_uid;
  if not found then raise exception 'not_member' using errcode = '55000'; end if;

  -- Idempotência: mesmo op_id = reenvio, devolve o mesmo resultado
  if v_me.op_id = p_op then
    return jsonb_build_object(
      'won', case when v_duel.status = 'finished' then v_duel.winner_id = p_uid else null end,
      'seconds', v_me.seconds, 'words', v_me.words, 'winner', v_duel.winner_id
    );
  end if;

  if v_duel.status = 'finished' then
    return jsonb_build_object(
      'won', v_duel.winner_id = p_uid, 'winner', v_duel.winner_id,
      'seconds', v_me.seconds, 'words', v_me.words
    );
  end if;
  if v_duel.status <> 'running' or now() < v_duel.starts_at then
    raise exception 'bad_status' using errcode = '55000';
  end if;
  if now() > v_duel.starts_at + make_interval(secs => v_duel.max_seconds) then
    raise exception 'expired' using errcode = '55000';
  end if;

  v_sec := extract(epoch from now() - v_duel.starts_at);
  v_words := case when v_duel.rule = 'words' then greatest(0, coalesce(p_words, 0)) else null end;

  update public.duel_players
     set finished_at = now(), op_id = p_op, seconds = v_sec, words = v_words
   where duel_id = p_duel and user_id = p_uid;

  -- Regra 'first': quem chega primeiro vence
  if v_duel.rule = 'first' then
    update public.duels
       set winner_id = p_uid, status = 'finished', finished_at = now()
     where id = p_duel and status = 'running';
    return jsonb_build_object('won', true, 'winner', p_uid, 'seconds', v_sec, 'words', null);
  end if;

  -- Regra 'words': quando os dois terminaram, decide na hora; senão, espera o oponente.
  select count(*) into v_finished
    from public.duel_players
   where duel_id = p_duel and finished_at is not null;

  if v_finished >= 2 then
    perform public.duel_settle(p_duel);
    select winner_id into v_winner from public.duels where id = p_duel;
    return jsonb_build_object('won', v_winner = p_uid, 'winner', v_winner, 'seconds', v_sec, 'words', v_words);
  end if;

  return jsonb_build_object('won', null, 'winner', null, 'seconds', v_sec, 'words', v_words, 'waiting', true);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 7. Settle: só decide se a sala ainda está running; devolve status
-- ----------------------------------------------------------------------------------------------------
create or replace function public.duel_settle(p_duel uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
  v_p1   public.duel_players;
  v_p2   public.duel_players;
  v_winner uuid;
begin
  select * into v_duel from public.duels where id = p_duel for update;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if v_duel.rule <> 'words' then raise exception 'bad_rule' using errcode = '55000'; end if;
  if v_duel.status <> 'running' then
    return jsonb_build_object('winner', v_duel.winner_id, 'status', v_duel.status);
  end if;

  select * into v_p1 from public.duel_players where duel_id = p_duel order by joined_at limit 1;
  select * into v_p2 from public.duel_players where duel_id = p_duel and user_id <> v_p1.user_id;

  -- Critério: mais palavras > menos tempo (empate = winner_id NULL)
  if v_p1.words is not null and v_p2.words is not null then
    if v_p1.words > v_p2.words then v_winner := v_p1.user_id;
    elsif v_p2.words > v_p1.words then v_winner := v_p2.user_id;
    elsif v_p1.seconds < v_p2.seconds then v_winner := v_p1.user_id;
    elsif v_p2.seconds < v_p1.seconds then v_winner := v_p2.user_id;
    else v_winner := null; end if;
  elsif v_p1.words is not null then v_winner := v_p1.user_id;
  elsif v_p2.words is not null then v_winner := v_p2.user_id;
  else v_winner := null; end if;

  update public.duels
     set winner_id = v_winner, status = 'finished', finished_at = now()
   where id = p_duel and status = 'running';

  return jsonb_build_object('winner', v_winner, 'status', 'finished');
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 8. Sair: criador cancela waiting; convidado só remove a própria vaga
-- ----------------------------------------------------------------------------------------------------
create or replace function public.duel_leave(p_uid uuid, p_duel uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
  v_other uuid;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into v_duel from public.duels where id = p_duel for update;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if not exists (select 1 from public.duel_players where duel_id = p_duel and user_id = p_uid) then
    raise exception 'not_member' using errcode = '55000';
  end if;

  if v_duel.status = 'waiting' then
    if p_uid = v_duel.created_by then
      update public.duels set status = 'cancelled' where id = p_duel;
      return jsonb_build_object('status', 'cancelled');
    end if;
    delete from public.duel_players where duel_id = p_duel and user_id = p_uid;
    if not exists (select 1 from public.duel_players where duel_id = p_duel) then
      update public.duels set status = 'cancelled' where id = p_duel;
      return jsonb_build_object('status', 'cancelled');
    end if;
    return jsonb_build_object('status', 'waiting');
  end if;

  if v_duel.status = 'running' then
    select user_id into v_other from public.duel_players where duel_id = p_duel and user_id <> p_uid;
    update public.duels
       set winner_id = v_other, status = 'finished', finished_at = now()
     where id = p_duel;
    update public.duel_players set finished_at = now() where duel_id = p_duel and user_id = p_uid;
    return jsonb_build_object('status', 'forfeited', 'winner', v_other);
  end if;

  return jsonb_build_object('status', v_duel.status);
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 9. Limpeza: settle das `words` ANTES de empatar as demais (ordem corrigida)
-- ----------------------------------------------------------------------------------------------------
create or replace function public.duel_cleanup() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int := 0;
  v_row_count int;
  v_duel record;
begin
  -- Waiting expiradas (código velho ou criador não marcou pronto)
  update public.duels
     set status = 'cancelled'
   where status = 'waiting' and expires_at < now();
  get diagnostics v_row_count = row_count;
  v_count := v_count + v_row_count;

  -- Running expiradas com regra 'words': decide pelo placar
  for v_duel in select id from public.duels
                where status = 'running'
                  and rule = 'words'
                  and starts_at is not null
                  and now() > starts_at + make_interval(secs => max_seconds)
  loop
    perform public.duel_settle(v_duel.id);
    v_count := v_count + 1;
  end loop;

  -- Demais running expiradas sem vencedor -> empate
  update public.duels
     set status = 'finished', finished_at = now()
   where status = 'running'
     and starts_at is not null
     and now() > starts_at + make_interval(secs => max_seconds)
     and winner_id is null;
  get diagnostics v_row_count = row_count;
  v_count := v_count + v_row_count;

  return v_count;
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 10. Permissões
-- ----------------------------------------------------------------------------------------------------
revoke all on function public.duel_finish(uuid, uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.duel_finish(uuid, uuid, uuid, int) to service_role;

revoke all on function public.duel_gen_code() from public, anon, authenticated;
grant execute on function public.duel_gen_code() to service_role;

-- A policy do Realtime roda como `authenticated`: ela precisa poder chamar is_duel_member.
grant execute on function public.is_duel_member(uuid) to authenticated;

-- ====================================================================================================
-- FIM — 20261036000000_duels_ajustes.sql
-- ====================================================================================================
