-- Testes dos duelos 1×1 (pgTAP). Rodam com `supabase test db` e não deixam nada no banco: tudo é
-- desfeito no fim. As funções recebem o uid explicitamente (a Edge é quem o injeta), então a maior
-- parte dos testes roda como `postgres`; só a policy do Realtime precisa "entrar" como `authenticated`.
begin;
select no_plan();

-- ---------- ajudas do teste ----------
create table public.duel_tap (k text primary key, v jsonb);              -- respostas das funções
create table public.duel_tap_ids (k text primary key, v uuid);           -- ids das salas criadas
grant all on public.duel_tap, public.duel_tap_ids to public;

create function public.duel_tap_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function public.duel_tap_super() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ---------- contas de teste ----------
insert into auth.users (id, email, raw_user_meta_data) values
  ('d1000000-0000-4000-8000-000000000001', 'duel-ana@teste.com',   '{"name":"Ana"}'),
  ('d1000000-0000-4000-8000-000000000002', 'duel-bob@teste.com',   '{"name":"Bob"}'),
  ('d1000000-0000-4000-8000-000000000003', 'duel-carol@teste.com', '{"name":"Carol"}');
update public.profiles set nickname = 'Ana'   where id = 'd1000000-0000-4000-8000-000000000001';
update public.profiles set nickname = 'Bob'   where id = 'd1000000-0000-4000-8000-000000000002';
update public.profiles set nickname = 'Carol' where id = 'd1000000-0000-4000-8000-000000000003';

-- ---------- 1. criar e entrar ----------
insert into public.duel_tap
values ('create', public.duel_create(
  'd1000000-0000-4000-8000-000000000001', 'zip', 2, 42, 1,
  '{"cells":[]}'::jsonb, '{"solution":[]}'::jsonb, 'first', 120));
insert into public.duel_tap_ids select 'd1', id from public.duels;

select is((select count(*) from public.duels), 1::bigint, 'criar sala grava o duelo');
select is((select status from public.duels), 'waiting', 'a sala nasce esperando o amigo');
select is((select level from public.duels), 2::smallint, 'o nível pedido é guardado');
select ok((select code from public.duels) ~ '^[A-Z0-9]{6}$', 'o código tem 6 caracteres fáceis de digitar');
select is((select count(*) from public.duel_players), 1::bigint, 'o criador já ocupa a primeira vaga');
select is((select v->>'code' from public.duel_tap where k = 'create'), (select code from public.duels),
  'o retorno traz o código do convite');

insert into public.duel_tap
values ('join', public.duel_join('d1000000-0000-4000-8000-000000000002',
  (select code from public.duels where id = (select v from public.duel_tap_ids where k = 'd1'))));
select is((select count(*) from public.duel_players), 2::bigint, 'entrar ocupa a segunda vaga');
select is((select v->'opponent'->>'nickname' from public.duel_tap where k = 'join'), 'Ana',
  'quem entra vê o apelido do criador');
select throws_ok(
  format('select public.duel_join(%L, %L)', 'd1000000-0000-4000-8000-000000000003',
    (select code from public.duels where id = (select v from public.duel_tap_ids where k = 'd1'))),
  '55000', 'duel_full', 'sala cheia recusa o terceiro');
select throws_ok($$select public.duel_join('d1000000-0000-4000-8000-000000000003', 'ZZZZZZ')$$,
  '22023', 'duel_not_found', 'código desconhecido não abre sala');
select throws_ok(
  format('select public.duel_ready(%L, %L)', 'd1000000-0000-4000-8000-000000000003',
    (select v from public.duel_tap_ids where k = 'd1')),
  '55000', 'not_member', 'quem não está na sala não marca pronto');

-- ---------- 2. pronto, contagem e largada ----------
select is((public.duel_ready('d1000000-0000-4000-8000-000000000001',
  (select v from public.duel_tap_ids where k = 'd1')))->>'status', 'waiting',
  'um pronto ainda não começa a contagem');
select is((select starts_at from public.duels where id = (select v from public.duel_tap_ids where k = 'd1')),
  null, 'sem largada antes dos dois marcarem');
select is((public.duel_ready('d1000000-0000-4000-8000-000000000002',
  (select v from public.duel_tap_ids where k = 'd1')))->>'status', 'running',
  'os dois prontos iniciam o duelo');
select ok((select starts_at from public.duels where id = (select v from public.duel_tap_ids where k = 'd1'))
  > now() + interval '3 seconds', 'a largada tem contagem regressiva');
select throws_ok(
  format('select public.duel_start(%L, %L)', 'd1000000-0000-4000-8000-000000000001',
    (select v from public.duel_tap_ids where k = 'd1')),
  '55000', 'not_started', 'o puzzle não sai durante a contagem');

update public.duels set starts_at = now() - interval '10 seconds'
 where id = (select v from public.duel_tap_ids where k = 'd1');
select is((public.duel_start('d1000000-0000-4000-8000-000000000001',
  (select v from public.duel_tap_ids where k = 'd1')))->'puzzle', '{"cells":[]}'::jsonb,
  'depois da largada o servidor entrega o puzzle');

-- ---------- 3. regra `first`: quem chega primeiro vence ----------
select is((public.duel_finish('d1000000-0000-4000-8000-000000000001',
  (select v from public.duel_tap_ids where k = 'd1'), 'e0000000-0000-4000-8000-000000000001'))->>'won', 'true',
  'quem termina primeiro vence');
select is((select status from public.duels where id = (select v from public.duel_tap_ids where k = 'd1')),
  'finished', 'a sala fecha assim que alguém termina');
select is((select winner_id from public.duels where id = (select v from public.duel_tap_ids where k = 'd1')),
  'd1000000-0000-4000-8000-000000000001'::uuid, 'o vencedor é gravado no servidor');
select ok((select seconds from public.duel_players
            where duel_id = (select v from public.duel_tap_ids where k = 'd1')
              and user_id = 'd1000000-0000-4000-8000-000000000001') >= 10,
  'o tempo é medido no servidor a partir da largada');
select is((public.duel_finish('d1000000-0000-4000-8000-000000000001',
  (select v from public.duel_tap_ids where k = 'd1'), 'e0000000-0000-4000-8000-000000000001'))->>'won', 'true',
  'reenviar com o mesmo op devolve o mesmo resultado');
select is((select count(*) from public.duel_players
            where duel_id = (select v from public.duel_tap_ids where k = 'd1') and finished_at is not null),
  1::bigint, 'o reenvio não conta duas vezes');
select is((public.duel_finish('d1000000-0000-4000-8000-000000000002',
  (select v from public.duel_tap_ids where k = 'd1'), gen_random_uuid()))->>'won', 'false',
  'quem chega depois perde');
select is((public.duel_state('d1000000-0000-4000-8000-000000000001',
  (select v from public.duel_tap_ids where k = 'd1')))->'winner'->>'user_id',
  'd1000000-0000-4000-8000-000000000001', 'o estado devolve o vencedor para a reconexão');

-- ---------- 4. regra `words`: mais palavras vence; empate decide no menor tempo ----------
insert into public.duel_tap
values ('words', public.duel_create(
  'd1000000-0000-4000-8000-000000000001', 'zip', 0, 7, 1,
  '{"words":[]}'::jsonb, '{"solution":[]}'::jsonb, 'words', 120));
insert into public.duel_tap_ids select 'd2', id from public.duels
 where code = (select v->>'code' from public.duel_tap where k = 'words');
select public.duel_join('d1000000-0000-4000-8000-000000000002',
  (select code from public.duels where id = (select v from public.duel_tap_ids where k = 'd2')));
select public.duel_ready('d1000000-0000-4000-8000-000000000001',
  (select v from public.duel_tap_ids where k = 'd2'));
select public.duel_ready('d1000000-0000-4000-8000-000000000002',
  (select v from public.duel_tap_ids where k = 'd2'));
update public.duels set starts_at = now() - interval '20 seconds'
 where id = (select v from public.duel_tap_ids where k = 'd2');

select is((public.duel_finish('d1000000-0000-4000-8000-000000000001',
  (select v from public.duel_tap_ids where k = 'd2'), gen_random_uuid(), 5))->>'waiting', 'true',
  'na regra words o primeiro a terminar espera o oponente');
select is((select winner_id from public.duels where id = (select v from public.duel_tap_ids where k = 'd2')),
  null, 'ainda não há vencedor com um só resultado');
select is((public.duel_finish('d1000000-0000-4000-8000-000000000002',
  (select v from public.duel_tap_ids where k = 'd2'), gen_random_uuid(), 3))->>'winner',
  'd1000000-0000-4000-8000-000000000001', 'quem fez mais palavras vence');
select is((select words from public.duel_players
            where duel_id = (select v from public.duel_tap_ids where k = 'd2')
              and user_id = 'd1000000-0000-4000-8000-000000000001'), 5,
  'o placar de palavras fica guardado');
select is((select status from public.duels where id = (select v from public.duel_tap_ids where k = 'd2')),
  'finished', 'o segundo resultado decide na hora');

-- empate em palavras: vence quem terminou em menos tempo
insert into public.duel_tap
values ('tie', public.duel_create(
  'd1000000-0000-4000-8000-000000000001', 'zip', 0, 9, 1,
  '{"words":[]}'::jsonb, '{"solution":[]}'::jsonb, 'words', 120));
insert into public.duel_tap_ids select 'd3', id from public.duels
 where code = (select v->>'code' from public.duel_tap where k = 'tie');
select public.duel_join('d1000000-0000-4000-8000-000000000002',
  (select code from public.duels where id = (select v from public.duel_tap_ids where k = 'd3')));
select public.duel_ready('d1000000-0000-4000-8000-000000000001',
  (select v from public.duel_tap_ids where k = 'd3'));
select public.duel_ready('d1000000-0000-4000-8000-000000000002',
  (select v from public.duel_tap_ids where k = 'd3'));
update public.duels set starts_at = now() - interval '10 seconds'
 where id = (select v from public.duel_tap_ids where k = 'd3');
select public.duel_finish('d1000000-0000-4000-8000-000000000001',
  (select v from public.duel_tap_ids where k = 'd3'), gen_random_uuid(), 4);
update public.duels set starts_at = now() - interval '5 seconds'
 where id = (select v from public.duel_tap_ids where k = 'd3');
select is((public.duel_finish('d1000000-0000-4000-8000-000000000002',
  (select v from public.duel_tap_ids where k = 'd3'), gen_random_uuid(), 4))->>'winner',
  'd1000000-0000-4000-8000-000000000002', 'no empate de palavras vence o menor tempo');

-- ---------- 5. sair: criador cancela, convidado libera a vaga, corredor desiste ----------
insert into public.duel_tap
values ('leave', public.duel_create(
  'd1000000-0000-4000-8000-000000000001', 'zip', 0, 11, 1,
  '{}'::jsonb, '{}'::jsonb, 'first', 120));
insert into public.duel_tap_ids select 'd4', id from public.duels
 where code = (select v->>'code' from public.duel_tap where k = 'leave');
select is((public.duel_leave('d1000000-0000-4000-8000-000000000001',
  (select v from public.duel_tap_ids where k = 'd4')))->>'status', 'cancelled',
  'o criador cancela a sala enquanto espera');

insert into public.duel_tap
values ('guest', public.duel_create(
  'd1000000-0000-4000-8000-000000000001', 'zip', 0, 12, 1,
  '{}'::jsonb, '{}'::jsonb, 'first', 120));
insert into public.duel_tap_ids select 'd5', id from public.duels
 where code = (select v->>'code' from public.duel_tap where k = 'guest');
select public.duel_join('d1000000-0000-4000-8000-000000000002',
  (select code from public.duels where id = (select v from public.duel_tap_ids where k = 'd5')));
select is((public.duel_leave('d1000000-0000-4000-8000-000000000002',
  (select v from public.duel_tap_ids where k = 'd5')))->>'status', 'waiting',
  'o convidado que sai devolve a vaga');
select is((select count(*) from public.duel_players
            where duel_id = (select v from public.duel_tap_ids where k = 'd5')), 1::bigint,
  'a vaga liberada some da sala');

insert into public.duel_tap
values ('forfeit', public.duel_create(
  'd1000000-0000-4000-8000-000000000001', 'zip', 0, 13, 1,
  '{}'::jsonb, '{}'::jsonb, 'first', 120));
insert into public.duel_tap_ids select 'd6', id from public.duels
 where code = (select v->>'code' from public.duel_tap where k = 'forfeit');
select public.duel_join('d1000000-0000-4000-8000-000000000002',
  (select code from public.duels where id = (select v from public.duel_tap_ids where k = 'd6')));
select public.duel_ready('d1000000-0000-4000-8000-000000000001',
  (select v from public.duel_tap_ids where k = 'd6'));
select public.duel_ready('d1000000-0000-4000-8000-000000000002',
  (select v from public.duel_tap_ids where k = 'd6'));
update public.duels set starts_at = now() - interval '1 second'
 where id = (select v from public.duel_tap_ids where k = 'd6');
select is((public.duel_leave('d1000000-0000-4000-8000-000000000001',
  (select v from public.duel_tap_ids where k = 'd6')))->>'winner',
  'd1000000-0000-4000-8000-000000000002', 'quem sai no meio entrega a vitória ao oponente');

-- ---------- 6. limpeza: salas esquecidas não ficam presas ----------
insert into public.duel_tap
values ('stale', public.duel_create(
  'd1000000-0000-4000-8000-000000000001', 'zip', 0, 15, 1,
  '{}'::jsonb, '{}'::jsonb, 'first', 120));
insert into public.duel_tap_ids select 'd7', id from public.duels
 where code = (select v->>'code' from public.duel_tap where k = 'stale');
update public.duels set expires_at = now() - interval '1 second'
 where id = (select v from public.duel_tap_ids where k = 'd7');

insert into public.duel_tap
values ('slow', public.duel_create(
  'd1000000-0000-4000-8000-000000000001', 'zip', 0, 16, 1,
  '{}'::jsonb, '{}'::jsonb, 'first', 120));
insert into public.duel_tap_ids select 'd8', id from public.duels
 where code = (select v->>'code' from public.duel_tap where k = 'slow');
select public.duel_join('d1000000-0000-4000-8000-000000000002',
  (select code from public.duels where id = (select v from public.duel_tap_ids where k = 'd8')));
select public.duel_ready('d1000000-0000-4000-8000-000000000001',
  (select v from public.duel_tap_ids where k = 'd8'));
select public.duel_ready('d1000000-0000-4000-8000-000000000002',
  (select v from public.duel_tap_ids where k = 'd8'));
update public.duels set starts_at = now() - interval '200 seconds'
 where id = (select v from public.duel_tap_ids where k = 'd8');

select ok(public.duel_cleanup() >= 2, 'a limpeza alcança as salas vencidas');
select is((select status from public.duels where id = (select v from public.duel_tap_ids where k = 'd7')),
  'cancelled', 'sala waiting expirada é cancelada');
select is((select status from public.duels where id = (select v from public.duel_tap_ids where k = 'd8')),
  'finished', 'corrida expirada sem vencedor vira empate');

-- ---------- 7. policy do Realtime: só os dois jogadores entram no canal ----------
select public.duel_tap_as('d1000000-0000-4000-8000-000000000001');
select is(public.is_duel_member((select v from public.duel_tap_ids where k = 'd1')), true,
  'o jogador enxerga o canal do próprio duelo');
select public.duel_tap_super();
select public.duel_tap_as('d1000000-0000-4000-8000-000000000003');
select is(public.is_duel_member((select v from public.duel_tap_ids where k = 'd1')), false,
  'um estranho não enxerga o canal');
select public.duel_tap_super();

-- ---------- 8. limites e exclusão de conta (LGPD) ----------
select lives_ok(
  $$select public.duel_create('d1000000-0000-4000-8000-000000000003', 'zip', 0, 21, 1,
      '{}'::jsonb, '{}'::jsonb, 'first', 120)$$, 'Carol abre a primeira sala');
select lives_ok(
  $$select public.duel_create('d1000000-0000-4000-8000-000000000003', 'zip', 0, 22, 1,
      '{}'::jsonb, '{}'::jsonb, 'first', 120)$$, 'Carol abre a segunda sala');
select lives_ok(
  $$select public.duel_create('d1000000-0000-4000-8000-000000000003', 'zip', 0, 23, 1,
      '{}'::jsonb, '{}'::jsonb, 'first', 120)$$, 'Carol abre a terceira sala');
select throws_ok(
  $$select public.duel_create('d1000000-0000-4000-8000-000000000003', 'zip', 0, 24, 1,
      '{}'::jsonb, '{}'::jsonb, 'first', 120)$$,
  '55000', 'too_many_open', 'a quarta sala aberta é recusada');

insert into public.duel_tap_ids
select 'lgpd', id from public.duels
 where created_by = 'd1000000-0000-4000-8000-000000000003'
 order by created_at limit 1;
delete from auth.users where id = 'd1000000-0000-4000-8000-000000000003';
select is((select created_by from public.duels where id = (select v from public.duel_tap_ids where k = 'lgpd')),
  null, 'excluir a conta não derruba a sala (created_by vira nulo)');
select is((select count(*) from public.duel_players
            where duel_id = (select v from public.duel_tap_ids where k = 'lgpd')), 0::bigint,
  'a vaga do jogador excluído sai junto');

select * from finish();
rollback;
