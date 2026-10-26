-- =====================================================================================================
-- Jogo "Queens" (id `queens`): só registra o jogo no catálogo — não há tabela nova. A fase é servida e
-- validada pela Edge Function `play`, como os demais jogos. Instalações novas já nascem com ele na migração
-- inicial (`20261014000000_init.sql`); este arquivo cobre bancos que já existiam.
-- =====================================================================================================

insert into public.games (id, title, sort) values ('queens', 'Queens', 8)
on conflict (id) do update set title = excluded.title, sort = excluded.sort;
