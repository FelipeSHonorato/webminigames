-- ====================================================================================================
-- WebMiniGames · Duelos 1×1 (infraestrutura reutilizável)
--
-- Como aplicar: Supabase > SQL Editor > cole este arquivo inteiro > Run
--   ou `supabase db push` (linked project).
--
-- O que cria:
--   * Tabelas: duels, duel_players  (RLS ligado, sem policy: só funções escrevem)
--   * Funções security definer (EXECUTE apenas para service_role):
--       duel_create, duel_join, duel_ready, duel_start, duel_state,
--       duel_finish, duel_leave, duel_cleanup, duel_settle, is_duel_member
--   * Policies do Realtime (comentadas — confirme a sintaxe na versão atual do Supabase).
--
-- Princípio: Edge + Postgres = autoridade; Realtime = espelho visual (progress + presence).
-- ====================================================================================================

-- ----------------------------------------------------------------------------------------------------
-- 1. Tabelas
-- ----------------------------------------------------------------------------------------------------

create table public.duels (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,                    -- 6 chars, sem 0/O/1/I
  game_id       text not null references public.games (id),
  level         smallint not null check (level >= 0),
  seed          bigint not null check (seed >= 0 and seed < 4294967296),
  gen           int not null,                            -- versão do gerador (deve bater com o jogo)
  public_view   jsonb not null,                          -- o que o navegador recebe
  full_puzzle   jsonb not null,                          -- com solução: NUNCA sai do servidor
  rule          text not null default 'first'
                  check (rule in ('first', 'words')),
  max_seconds   int not null check (max_seconds between 30 and 3600),
  status        text not null default 'waiting'
                  check (status in ('waiting', 'running', 'finished', 'cancelled')),
  created_by    uuid not null references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  starts_at     timestamptz,
  finished_at   timestamptz,
  expires_at    timestamptz not null default now() + interval '15 minutes',  -- expiração de sala waiting
  winner_id     uuid references public.profiles (id) on delete set null
);

create table public.duel_players (
  duel_id       uuid not null references public.duels (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  ready         boolean not null default false,
  joined_at     timestamptz not null default now(),
  finished_at   timestamptz,
  seconds       numeric,                                 -- medido no servidor a partir de starts_at
  words         int,                                     -- só regra 'words'
  op_id         uuid,                                    -- idempotência do reenvio
  primary key (duel_id, user_id)
);

alter table public.duels        enable row level security;
alter table public.duel_players enable row level security;

create index on public.duels (status, created_at);
create index on public.duels (code);
create index on public.duel_players (user_id);

-- ----------------------------------------------------------------------------------------------------
-- 2. Funções auxiliares
-- ----------------------------------------------------------------------------------------------------

-- Gera código de 6 chars (base32 sem 0/O/1/I/L para evitar confusão visual)
create or replace function public.duel_gen_code() returns text
language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- 32 chars
  v_code text;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * 32)::int, 1);
    end loop;
    if not exists (select 1 from public.duels where code = v_code) then
      return v_code;
    end if;
  end loop;
end $$;

-- Verifica se o usuário é membro da sala (usada pela policy do Realtime)
create or replace function public.is_duel_member(p_duel uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.duel_players
    where duel_id = p_duel and user_id = auth.uid()
  );
$$;

-- ----------------------------------------------------------------------------------------------------
-- 3. Funções principais (todas security definer, EXECUTE só para service_role)
-- ----------------------------------------------------------------------------------------------------

-- 3.1 Criar sala: valida jogo, nível, gen; sorteia seed; gera puzzle; insere sala + criador
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
    'id', v_duel.id, 'code', v_duel.code, 'level', v_duel.level,
    'maxSeconds', v_duel.max_seconds, 'rule', v_duel.rule
  );
end $$;

-- 3.2 Entrar na sala por código
create or replace function public.duel_join(p_uid uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
  v_opp  record;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into v_duel from public.duels where code = p_code for update;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;
  if v_duel.status <> 'waiting' then raise exception 'bad_status' using errcode = '55000'; end if;
  if v_duel.expires_at < now() then raise exception 'expired' using errcode = '55000'; end if;

  if exists (select 1 from public.duel_players where duel_id = v_duel.id and user_id = p_uid) then
    -- já está na sala: devolve estado atual
    select p.nickname, p.avatar_url into v_opp
      from public.duel_players dp
      join public.profiles p on p.id = dp.user_id
      where dp.duel_id = v_duel.id and dp.user_id <> p_uid;
    return jsonb_build_object(
      'id', v_duel.id, 'level', v_duel.level, 'rule', v_duel.rule,
      'opponent', jsonb_build_object('nickname', v_opp.nickname, 'avatar_url', v_opp.avatar_url)
    );
  end if;

  if (select count(*) from public.duel_players where duel_id = v_duel.id) >= 2 then
    raise exception 'duel_full' using errcode = '55000';
  end if;

  insert into public.duel_players (duel_id, user_id, ready) values (v_duel.id, p_uid, false);

  select p.nickname, p.avatar_url into v_opp
    from public.duel_players dp
    join public.profiles p on p.id = dp.user_id
    where dp.duel_id = v_duel.id and dp.user_id <> p_uid;

  return jsonb_build_object(
    'id', v_duel.id, 'level', v_duel.level, 'rule', v_duel.rule,
    'opponent', jsonb_build_object('nickname', v_opp.nickname, 'avatar_url', v_opp.avatar_url)
  );
end $$;

-- 3.3 Marcar pronto; se os 2 prontos, inicia contagem regressiva (4s)
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

  update public.duel_players set ready = true where duel_id = p_duel and user_id = p_uid;

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

-- 3.4 Entregar o puzzle (somente quando status = running, após starts_at)
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

  return jsonb_build_object(
    'puzzle', v_duel.public_view,
    'startsAt', v_duel.starts_at,
    'serverNow', now(),
    'maxSeconds', v_duel.max_seconds,
    'rule', v_duel.rule
  );
end $$;

-- 3.5 Estado para reconexão / polling
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

  select jsonb_agg(jsonb_build_object(
    'user_id', dp.user_id,
    'nickname', p.nickname,
    'avatar_url', p.avatar_url,
    'ready', dp.ready,
    'finished_at', dp.finished_at,
    'seconds', dp.seconds,
    'words', dp.words
  )) into v_players
  from public.duel_players dp
  join public.profiles p on p.id = dp.user_id
  where dp.duel_id = p_duel;

  if v_duel.winner_id is not null then
    select jsonb_build_object('user_id', p.id, 'nickname', p.nickname, 'avatar_url', p.avatar_url)
      into v_winner from public.profiles p where p.id = v_duel.winner_id;
  end if;

  return jsonb_build_object(
    'id', v_duel.id, 'status', v_duel.status, 'startsAt', v_duel.starts_at,
    'finishedAt', v_duel.finished_at, 'serverNow', now(),
    'players', v_players, 'winner', v_winner
  );
end $$;

-- 3.6 Finalizar (registra fim do jogador; se regra 'first', decide vencedor na hora)
create or replace function public.duel_finish(p_uid uuid, p_duel uuid, p_op uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
  v_me   public.duel_players;
  v_sec  numeric;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into v_duel from public.duels where id = p_duel for update;
  if not found then raise exception 'duel_not_found' using errcode = '22023'; end if;

  select * into v_me from public.duel_players where duel_id = p_duel and user_id = p_uid;
  if not found then raise exception 'not_member' using errcode = '55000'; end if;

  -- Idempotência: mesmo op_id = reenvio, devolve o mesmo resultado
  if v_me.op_id = p_op then
    return jsonb_build_object('won', v_duel.winner_id = p_uid, 'seconds', v_me.seconds, 'winner', v_duel.winner_id);
  end if;

  if v_duel.status = 'finished' then
    return jsonb_build_object('won', false, 'winner', v_duel.winner_id);
  end if;
  if v_duel.status <> 'running' or now() < v_duel.starts_at then
    raise exception 'bad_status' using errcode = '55000';
  end if;
  if now() > v_duel.starts_at + make_interval(secs => v_duel.max_seconds) then
    raise exception 'expired' using errcode = '55000';
  end if;

  v_sec := extract(epoch from now() - v_duel.starts_at);

  update public.duel_players
     set finished_at = now(), op_id = p_op, seconds = v_sec
   where duel_id = p_duel and user_id = p_uid;

  -- Regra 'first': quem chega primeiro vence
  if v_duel.rule = 'first' then
    update public.duels
       set winner_id = p_uid, status = 'finished', finished_at = now()
     where id = p_duel and status = 'running';
    return jsonb_build_object('won', true, 'winner', p_uid, 'seconds', v_sec);
  end if;

  -- Regra 'words': só registra; vencedor será decidido por duel_settle
  return jsonb_build_object('won', null, 'seconds', v_sec);
end $$;

-- 3.7 Decide vencedor na regra 'words' (chamado no 2º finish OU no cleanup após tempo)
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
  if v_duel.status = 'finished' then
    return jsonb_build_object('winner', v_duel.winner_id);
  end if;

  select * into v_p1 from public.duel_players where duel_id = p_duel limit 1;
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
   where id = p_duel;

  return jsonb_build_object('winner', v_winner);
end $$;

-- 3.8 Sair / desistir
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
    update public.duels set status = 'cancelled' where id = p_duel;
    return jsonb_build_object('status', 'cancelled');
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

-- 3.9 Limpeza: cancela waiting expiradas e finaliza running sem vencedor (empate)
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

  -- Running expiradas sem vencedor -> empate
  update public.duels
     set status = 'finished', finished_at = now()
   where status = 'running'
     and starts_at is not null
     and now() > starts_at + make_interval(secs => max_seconds)
     and winner_id is null;
  get diagnostics v_row_count = row_count;
  v_count := v_count + v_row_count;

  -- Para as running expiradas com regra 'words', chama duel_settle
  -- (feito em loop porque duel_settle trava a linha)
  for v_duel in select id from public.duels
                where status = 'running'
                  and rule = 'words'
                  and starts_at is not null
                  and now() > starts_at + make_interval(secs => max_seconds)
                  and winner_id is null
  loop
    perform public.duel_settle(v_duel.id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;

-- ----------------------------------------------------------------------------------------------------
-- 4. Revoke / Grant (apenas service_role executa)
-- ----------------------------------------------------------------------------------------------------

revoke all on public.duels from anon, authenticated;
revoke all on public.duel_players from anon, authenticated;

revoke all on function public.duel_create(uuid, text, int, bigint, int, jsonb, jsonb, text, int) from public, anon, authenticated;
grant execute on function public.duel_create(uuid, text, int, bigint, int, jsonb, jsonb, text, int) to service_role;

revoke all on function public.duel_join(uuid, text) from public, anon, authenticated;
grant execute on function public.duel_join(uuid, text) to service_role;

revoke all on function public.duel_ready(uuid, uuid) from public, anon, authenticated;
grant execute on function public.duel_ready(uuid, uuid) to service_role;

revoke all on function public.duel_start(uuid, uuid) from public, anon, authenticated;
grant execute on function public.duel_start(uuid, uuid) to service_role;

revoke all on function public.duel_state(uuid, uuid) from public, anon, authenticated;
grant execute on function public.duel_state(uuid, uuid) to service_role;

revoke all on function public.duel_finish(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.duel_finish(uuid, uuid, uuid) to service_role;

revoke all on function public.duel_settle(uuid) from public, anon, authenticated;
grant execute on function public.duel_settle(uuid) to service_role;

revoke all on function public.duel_leave(uuid, uuid) from public, anon, authenticated;
grant execute on function public.duel_leave(uuid, uuid) to service_role;

revoke all on function public.duel_cleanup() from public, anon, authenticated;
grant execute on function public.duel_cleanup() to service_role;

revoke all on function public.is_duel_member(uuid) from public, anon, authenticated;
grant execute on function public.is_duel_member(uuid) to service_role;

-- ----------------------------------------------------------------------------------------------------
-- 5. Policies do Realtime (CANAL PRIVADO: duel:<id>)
--    ⚠️ CONFIRME A SINTAXE NA VERSÃO ATUAL DO SUPABASE ANTES DE DESCOMENTAR.
--    A sintaxe muda entre versões (realtime.messages vs realtime.channels, topic() vs channel()).
-- ----------------------------------------------------------------------------------------------------

/*
create policy duel_channel_read on realtime.messages for select to authenticated
  using (
    realtime.topic() like 'duel:%'
    and public.is_duel_member( (split_part(realtime.topic(), ':', 2))::uuid )
  );

create policy duel_channel_write on realtime.messages for insert to authenticated
  with check (
    realtime.topic() like 'duel:%'
    and public.is_duel_member( (split_part(realtime.topic(), ':', 2))::uuid )
  );
*/

-- FIM DA MIGRAÇÃO 20261035000000_duels.sql