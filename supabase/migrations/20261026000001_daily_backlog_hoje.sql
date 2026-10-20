-- =====================================================================================================
-- WebMiniGames · início do backlog de tickets diários
--
-- O lançamento passa a contar a partir de 20/10/2026: os tickets deixam de esperar até 26/10.
-- Dias anteriores a esta data continuam sem retroação; o teto de 30 dias segue valendo.
-- =====================================================================================================

create or replace function public.daily_backlog_start() returns date
language sql immutable set search_path = '' as $$ select date '2026-10-20' $$;

revoke all on function public.daily_backlog_start() from public, anon, authenticated;
