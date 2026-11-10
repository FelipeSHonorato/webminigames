-- =====================================================================================================
-- Jogo "CrossMath" (id `crossmath`): só registra o jogo no catálogo — não há tabela nova. A fase é
-- servida e validada pela Edge Function `play`, como os demais jogos solo. Instalações novas já nascem
-- com ele na migração inicial (`20261014000000_init.sql`); este arquivo cobre bancos que já existiam.
-- Entra no FIM do catálogo (sort 16) para não mexer na ordem dos jogos que já estavam cadastrados.
-- =====================================================================================================

insert into public.games (id, title, sort) values ('crossmath', 'CrossMath', 16)
on conflict (id) do update set title = excluded.title, sort = excluded.sort;
