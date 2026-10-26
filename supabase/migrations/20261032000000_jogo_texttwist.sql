-- =====================================================================================================
-- Jogo "Text Twist" (id `texttwist`): só registra o jogo no catálogo — não há tabela nova. A fase é
-- servida e validada pela Edge Function `play`, como os demais jogos. Instalações novas já nascem com ele
-- na migração inicial (`20261014000000_init.sql`); este arquivo cobre bancos que já existiam.
-- =====================================================================================================

insert into public.games (id, title, sort) values ('texttwist', 'Text Twist', 10)
on conflict (id) do update set title = excluded.title, sort = excluded.sort;
