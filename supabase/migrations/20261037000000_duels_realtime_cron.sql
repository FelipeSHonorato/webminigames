-- Duelos 1×1: canal Realtime privado + limpeza agendada.
--
-- O Realtime é só espelho visual (progresso do oponente e presença): a Edge valida o tabuleiro e o
-- Postgres decide o vencedor. Para um estranho não entrar no canal `duel:<id>`, o canal é privado e
-- as policies abaixo liberam leitura/escrita apenas para os dois jogadores da sala.
--
-- A limpeza preguiçosa do `duel_state` continua valendo; o cron é só a rede de segurança para salas
-- abandonadas (ninguém consultando). Sem cron, uma sala `words` esquecida só seria decidida quando
-- alguém abrisse o estado dela.

-- ----------------------------------------------------------------------------------------------------
-- 1. Id do duelo a partir do tópico, sem deixar um tópico malformado derrubar a policy
--    (`duel:abc` não pode virar cast inválido para uuid).
-- ----------------------------------------------------------------------------------------------------
create or replace function public.duel_topic_id(p_topic text) returns uuid
language sql immutable set search_path = public as $$
  select case
    when p_topic ~ '^duel:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then split_part(p_topic, ':', 2)::uuid
  end
$$;

revoke all on function public.duel_topic_id(text) from public, anon, authenticated;
grant execute on function public.duel_topic_id(text) to authenticated, service_role;

-- ----------------------------------------------------------------------------------------------------
-- 2. Policies do Realtime (canal privado `duel:<id>`)
--    `authenticated` precisa de EXECUTE em is_duel_member/duel_topic_id: a policy roda como o cliente.
--    A RLS de realtime.messages já vem ligada e a tabela pertence ao supabase_realtime_admin:
--    um `alter table ... enable row level security` falharia com "must be owner of table messages".
--    O supautils deixa o `postgres` criar/alterar/dropar policies nessa tabela — só isso.
-- ----------------------------------------------------------------------------------------------------
drop policy if exists duel_channel_read on realtime.messages;
create policy duel_channel_read on realtime.messages for select to authenticated
  using (
    public.duel_topic_id(realtime.topic()) is not null
    and public.is_duel_member(public.duel_topic_id(realtime.topic()))
  );

drop policy if exists duel_channel_write on realtime.messages;
create policy duel_channel_write on realtime.messages for insert to authenticated
  with check (
    public.duel_topic_id(realtime.topic()) is not null
    and public.is_duel_member(public.duel_topic_id(realtime.topic()))
  );

-- ----------------------------------------------------------------------------------------------------
-- 3. Limpeza agendada (a cada 5 minutos)
--    A função é security definer; o job roda como o dono do banco.
-- ----------------------------------------------------------------------------------------------------
create extension if not exists pg_cron;

-- Reaplicar a migração não pode duplicar o job.
select cron.unschedule(jobid) from cron.job where jobname = 'duel_cleanup';

select cron.schedule(
  'duel_cleanup',
  '*/5 * * * *',
  $$select public.duel_cleanup()$$
);

-- FIM DA MIGRAÇÃO 20261037000000_duels_realtime_cron.sql
