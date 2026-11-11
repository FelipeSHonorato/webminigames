-- =====================================================================================================
-- Jogo "UNO" (id `uno`): só registra o jogo no catálogo — não há tabela nova. A partida usa a estrutura
-- de salas multijogador de `20261053000000_multiplayer_party.sql` (`duels` kind 'party' + `party_games`),
-- e o estado é servido/validado pela Edge Function `play`. Instalações novas aplicam esta migração
-- depois da inicial (`20261014000000_init.sql`), como todas as demais.
-- Entra no FIM do catálogo (sort 17) para não mexer na ordem dos jogos que já estavam cadastrados.
-- =====================================================================================================

insert into public.games (id, title, sort) values ('uno', 'UNO', 17)
on conflict (id) do update set title = excluded.title, sort = excluded.sort;
