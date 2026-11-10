-- Testes das partidas com 2+ jogadores ("party", pgTAP). Rodam com `supabase test db` e desfazem tudo no fim.
-- As funções recebem o uid explicitamente (a Edge injeta), então quase tudo roda como `postgres`.
begin;
select no_plan();

-- ---------- contas ----------
insert into auth.users (id, email, raw_user_meta_data) values
  ('e1000000-0000-4000-8000-000000000001', 'party-ana@teste.com',   '{"name":"Ana"}'),
  ('e1000000-0000-4000-8000-000000000002', 'party-bob@teste.com',   '{"name":"Bob"}'),
  ('e1000000-0000-4000-8000-000000000003', 'party-carol@teste.com', '{"name":"Carol"}'),
  ('e1000000-0000-4000-8000-000000000004', 'party-dan@teste.com',   '{"name":"Dan"}'),
  ('e1000000-0000-4000-8000-000000000005', 'party-eva@teste.com',   '{"name":"Eva"}');
update public.profiles set nickname = 'Ana'   where id = 'e1000000-0000-4000-8000-000000000001';
update public.profiles set nickname = 'Bob'   where id = 'e1000000-0000-4000-8000-000000000002';
update public.profiles set nickname = 'Carol' where id = 'e1000000-0000-4000-8000-000000000003';
update public.profiles set nickname = 'Dan'   where id = 'e1000000-0000-4000-8000-000000000004';
update public.profiles set nickname = 'Eva'   where id = 'e1000000-0000-4000-8000-000000000005';
insert into public.games (id, title, sort) values ('partytest', 'Party Test', 99) on conflict (id) do nothing;

create table public.party_tap (k text primary key, v jsonb);
grant all on public.party_tap to public;

-- ---------- 0. gerador de código (regressão: o alfabeto tem 31 letras e o sorteio usava 32 => códigos curtos) ----------
select is((select count(*) from generate_series(1, 600) where public.duel_gen_code() !~ '^[A-Z2-9]{6}$'), 0::bigint, 'todo código de sala tem exatamente 6 caracteres');

-- ---------- 1. criar: 3 a 4 jogadores, vez a vez, 30 s por jogada ----------
insert into public.party_tap values ('c1', public.party_create(
  'e1000000-0000-4000-8000-000000000001', 'partytest', 3, 4, true, 'turns', 30, 'skip', 600));

select is((select v->>'status' from public.party_tap where k = 'c1'), 'waiting', 'a sala party nasce esperando');
select is((select (v->>'mySeat')::int from public.party_tap where k = 'c1'), 1, 'o criador ocupa o assento 1');
select is((select v->'players'->0->>'ready' from public.party_tap where k = 'c1'), 'true', 'o criador já está pronto');
select is((select v->>'canLaunch' from public.party_tap where k = 'c1'), 'false', 'com 1 jogador não dá para largar (mínimo 3)');
select is((select kind || ':' || min_players || '-' || max_players from public.duels), 'party:3-4', 'kind e limites gravados em duels');
select throws_ok($$select public.party_create('e1000000-0000-4000-8000-000000000001', 'partytest', 3, 4, true, 'turns', 30, 'skip', 600)$$,
  '55000', 'too_many_open', 'uma sala em espera por usuário');
select throws_ok($$select public.party_create('e1000000-0000-4000-8000-000000000002', 'partytest', 1, 4, true, 'turns', 30, 'skip', 600)$$,
  '22023', 'bad_players', 'mínimo de 2 jogadores');
select throws_ok($$select public.party_create('e1000000-0000-4000-8000-000000000002', 'partytest', 2, 13, true, 'turns', 30, 'skip', 600)$$,
  '22023', 'bad_players', 'máximo de 12 jogadores');

-- ---------- 2. entrar (código e lista), assentos ----------
create temp table ctx as select (v->>'id')::uuid as id, v->>'code' as code from public.party_tap where k = 'c1';
grant all on ctx to public;

select is((select (public.party_join('e1000000-0000-4000-8000-000000000002', (select code from ctx))->>'mySeat')::int), 2, 'Bob entra por código no assento 2');
select is((select (public.party_join_open('e1000000-0000-4000-8000-000000000003', (select id from ctx))->>'mySeat')::int), 3, 'Carol entra pela lista no assento 3');
select is((select ready from public.duel_players where user_id = 'e1000000-0000-4000-8000-000000000002'), false, 'quem entra não entra pronto');
select is((select count(*) from public.duel_players where duel_id = (select id from ctx)), 3::bigint, '3 jogadores na sala');

-- a sala aparece na lista com as vagas (3 de 4)
select is((select (r->>'players')::int || '/' || (r->>'maxPlayers')::int
             from jsonb_array_elements(public.duel_open_rooms('e1000000-0000-4000-8000-000000000005', 30)) r
            where r->>'id' = (select id::text from ctx)), '3/4', 'a lista mostra as vagas da sala party');
select is((select r->'host'->>'rating' from jsonb_array_elements(public.duel_open_rooms('e1000000-0000-4000-8000-000000000005', 30)) r
            where r->>'id' = (select id::text from ctx)), null, 'party não mostra Elo do criador');
select is(jsonb_array_length(public.duel_invites('e1000000-0000-4000-8000-000000000001')), 0, 'o aviso de desafiante do 1×1 ignora salas party');

-- ---------- 3. pronto e largada ----------
select throws_ok(format($$select public.party_launch('e1000000-0000-4000-8000-000000000002', %L, '[]'::jsonb, '{"x":1}'::jsonb, 1)$$, (select id from ctx)),
  '55000', 'not_ready', 'não larga com convidados não prontos');

select is((public.party_ready('e1000000-0000-4000-8000-000000000002', (select id from ctx)))->>'canLaunch', 'false', 'só Bob pronto: ainda falta Carol');
select is((public.party_ready('e1000000-0000-4000-8000-000000000003', (select id from ctx)))->>'canLaunch', 'true', 'todos prontos e 3 >= mínimo: pode largar');
select is((public.party_ready('e1000000-0000-4000-8000-000000000001', (select id from ctx), false))->'players'->0->>'ready', 'true', 'o criador não consegue desmarcar o próprio pronto');

create temp table roster as select public.party_roster((select id from ctx)) as r;
grant all on roster to public;
select is((select jsonb_array_length(r->'roster') from roster), 3, 'o elenco tem 3 jogadores');

select throws_ok(format($$select public.party_launch('e1000000-0000-4000-8000-000000000002', %L, %L::jsonb, '{"x":1}'::jsonb, 1)$$, (select id from ctx), (select r->'roster' from roster)),
  '55000', 'not_creator', 'convidado não larga sala que não está lotada');
select throws_ok(format($$select public.party_launch('e1000000-0000-4000-8000-000000000001', %L, '["e1000000-0000-4000-8000-000000000001"]'::jsonb, '{"x":1}'::jsonb, 1)$$, (select id from ctx)),
  '55000', 'roster_changed', 'elenco diferente do atual é recusado');
select throws_ok(format($$select public.party_launch('e1000000-0000-4000-8000-000000000001', %L, %L::jsonb, '{"x":1}'::jsonb, 9)$$, (select id from ctx), (select r->'roster' from roster)),
  '22023', 'bad_state', 'a vez inicial precisa ser um assento válido');

select is((public.party_launch('e1000000-0000-4000-8000-000000000001', (select id from ctx), (select r->'roster' from roster), '{"board":[]}'::jsonb, 2))->>'status', 'running', 'o criador larga a partida');
select is((select turn_seat::int from public.party_games where duel_id = (select id from ctx)), 2, 'a vez inicial é a que o domínio mandou');
select is((select max_players::int from public.duels where id = (select id from ctx)), 3, 'a sala fecha com o número de jogadores que largou');
select is((select state->>'board' from public.party_games where duel_id = (select id from ctx)), '[]', 'o estado inicial foi gravado');
select throws_ok(format($$select public.party_move('e1000000-0000-4000-8000-000000000002', %L, 0, '{"board":[1]}'::jsonb, 3, null, null, null)$$, (select id from ctx)),
  '55000', 'not_started', 'nenhum lance antes da largada (contagem de 4 s)');

-- ---------- 4. lances: vez, versão, tempo ----------
update public.duels set starts_at = now() - interval '1 second' where id = (select id from ctx);
update public.party_games set turn_started_at = now() where duel_id = (select id from ctx);

select throws_ok(format($$select public.party_move('e1000000-0000-4000-8000-000000000001', %L, 0, '{"board":[1]}'::jsonb, 3, null, null, null)$$, (select id from ctx)),
  '55000', 'not_your_turn', 'fora da vez (a vez é do assento 2)');
select throws_ok(format($$select public.party_move('e1000000-0000-4000-8000-000000000002', %L, 7, '{"board":[1]}'::jsonb, 3, null, null, null)$$, (select id from ctx)),
  '55000', 'stale', 'versão velha é recusada');
select throws_ok(format($$select public.party_move('e1000000-0000-4000-8000-000000000002', %L, 0, '{"board":[1]}'::jsonb, 9, null, null, null)$$, (select id from ctx)),
  '22023', 'bad_state', 'a próxima vez precisa ser um assento ativo');
select throws_ok(format($$select public.party_move('e1000000-0000-4000-8000-000000000004', %L, 0, '{"board":[1]}'::jsonb, 3, null, null, null)$$, (select id from ctx)),
  '55000', 'not_member', 'quem não está na partida não joga');

select is((public.party_move('e1000000-0000-4000-8000-000000000002', (select id from ctx), 0, '{"board":[1]}'::jsonb, 3, '{"m":"a"}'::jsonb, null, null))->'party'->>'turnSeat', '3', 'lance válido passa a vez para o assento 3');
select is((select version from public.party_games where duel_id = (select id from ctx)), 1, 'a versão sobe a cada lance');
select is((select moves from public.party_games where duel_id = (select id from ctx)), 1, 'contagem de lances');
select is((select jsonb_typeof(public.party_json('e1000000-0000-4000-8000-000000000001', (select id from ctx))->'party'->'state')), null, 'o estado do jogo nunca vai no JSON da sala');

-- estouro do tempo da vez (assento 3): passa a vez e recupera vários estouros seguidos
update public.party_games set turn_started_at = now() - interval '31 seconds' where duel_id = (select id from ctx);
select is((public.party_state('e1000000-0000-4000-8000-000000000001', (select id from ctx)))->'party'->>'turnSeat', '1', 'tempo estourado (skip): a vez passa do 3 para o 1');
update public.party_games set turn_started_at = now() - interval '95 seconds' where duel_id = (select id from ctx);
select is((public.party_state('e1000000-0000-4000-8000-000000000001', (select id from ctx)))->'party'->>'turnSeat', '1', 'três estouros seguidos dão a volta e a vez cai no mesmo assento');

-- ---------- 5. desistir e fim com ranking ----------
select is((public.party_resign('e1000000-0000-4000-8000-000000000003', (select id from ctx)))->>'status', 'running', 'desistir com 3 em jogo: a partida segue com 2');
select is((select placement::int from public.duel_players where user_id = 'e1000000-0000-4000-8000-000000000003'), 3, 'quem sai primeiro fica em 3º');
select is((select out_at is not null from public.duel_players where user_id = 'e1000000-0000-4000-8000-000000000003'), true, 'o jogador sai de jogo');

-- ranking que não cobre os ativos é recusado
update public.party_games set turn_seat = 1, turn_started_at = now() where duel_id = (select id from ctx);
select throws_ok(format($$select public.party_move('e1000000-0000-4000-8000-000000000001', %L, (select version from public.party_games where duel_id = %L), '{"board":[2]}'::jsonb, null, null, '[[1]]'::jsonb, 'x')$$, (select id from ctx), (select id from ctx)),
  '22023', 'bad_state', 'ranking incompleto (falta o assento 2)');
select throws_ok(format($$select public.party_move('e1000000-0000-4000-8000-000000000001', %L, (select version from public.party_games where duel_id = %L), '{"board":[2]}'::jsonb, null, null, '[[1],[3]]'::jsonb, 'x')$$, (select id from ctx), (select id from ctx)),
  '22023', 'bad_state', 'ranking com assento que já saiu é recusado');

select is((public.party_move('e1000000-0000-4000-8000-000000000001', (select id from ctx), (select version from public.party_games where duel_id = (select id from ctx)), '{"board":[2]}'::jsonb, null, '{"m":"fim"}'::jsonb, '[[1],[2]]'::jsonb, 'goal'))->>'status', 'finished', 'ranking completo encerra a partida');
select is((select winner_id::text from public.duels where id = (select id from ctx)), 'e1000000-0000-4000-8000-000000000001', 'o 1º lugar único vira o vencedor');
select is((select string_agg(placement::text, ',' order by seat) from public.duel_players where duel_id = (select id from ctx)), '1,2,3', 'colocações gravadas (1º, 2º e o 3º de quem saiu)');
select is((select count(*) from public.duel_ratings where game_id = 'partytest'), 0::bigint, 'party não mexe no Elo');
select throws_ok(format($$select public.party_move('e1000000-0000-4000-8000-000000000001', %L, 5, '{"board":[3]}'::jsonb, 1, null, null, null)$$, (select id from ctx)),
  '55000', 'bad_status', 'partida encerrada não aceita lance');

-- ---------- 6. empate no topo: sem vencedor único ----------
insert into public.party_tap values ('c2', public.party_create('e1000000-0000-4000-8000-000000000001', 'partytest', 2, 3, false, 'free', null, 'skip', 600));
create temp table ctx2 as select (v->>'id')::uuid as id, v->>'code' as code from public.party_tap where k = 'c2';
grant all on ctx2 to public;
select is((select is_open from public.duels where id = (select id from ctx2)), false, 'sala fechada');
select is((select count(*) from jsonb_array_elements(public.duel_open_rooms('e1000000-0000-4000-8000-000000000005', 30)) r where r->>'id' = (select id::text from ctx2)), 0::bigint, 'sala fechada não aparece para os outros');
select throws_ok(format($$select public.party_join_open('e1000000-0000-4000-8000-000000000005', %L)$$, (select id from ctx2)), '55000', 'closed_room', 'sala fechada não entra pela lista');
select ok(public.party_join('e1000000-0000-4000-8000-000000000002', (select code from ctx2)) is not null, 'preparação: party_join');
select ok(public.party_ready('e1000000-0000-4000-8000-000000000002', (select id from ctx2)) is not null, 'preparação: party_ready');
select is((public.party_state('e1000000-0000-4000-8000-000000000001', (select id from ctx2)))->>'canLaunch', 'true', 'mínimo 2: já pode largar com 2');
create temp table roster2 as select public.party_roster((select id from ctx2)) as r;
grant all on roster2 to public;
select is((public.party_launch('e1000000-0000-4000-8000-000000000001', (select id from ctx2), (select r->'roster' from roster2), '{"s":0}'::jsonb, null))->'party'->>'turnSeat', null, 'modo free não tem vez');
update public.duels set starts_at = now() - interval '1 second' where id = (select id from ctx2);
select is((public.party_move('e1000000-0000-4000-8000-000000000002', (select id from ctx2), 0, '{"s":1}'::jsonb, null, null, null, null))->>'status', 'running', 'modo free: qualquer um joga a qualquer momento');
select is((public.party_move('e1000000-0000-4000-8000-000000000001', (select id from ctx2), 1, '{"s":2}'::jsonb, null, null, '[[1,2]]'::jsonb, 'draw'))->>'status', 'finished', 'empate encerra com os dois no mesmo grupo');
select is((select winner_id from public.duels where id = (select id from ctx2)), null, 'empate no 1º lugar: sem vencedor único');
select is((select string_agg(placement::text, ',' order by seat) from public.duel_players where duel_id = (select id from ctx2)), '1,1', 'empatados dividem a 1ª colocação');

-- ---------- 7. sair na espera, passar o comando, expulsar, lotar, cancelar ----------
insert into public.party_tap values ('c3', public.party_create('e1000000-0000-4000-8000-000000000001', 'partytest', 2, 2, true, 'turns', null, 'out', 600));
create temp table ctx3 as select (v->>'id')::uuid as id, v->>'code' as code from public.party_tap where k = 'c3';
grant all on ctx3 to public;
select ok(public.party_join('e1000000-0000-4000-8000-000000000002', (select code from ctx3)) is not null, 'preparação: party_join');
select throws_ok(format($$select public.party_join('e1000000-0000-4000-8000-000000000003', %L)$$, (select code from ctx3)), '55000', 'duel_full', 'sala lotada recusa');
select is((public.party_leave('e1000000-0000-4000-8000-000000000001', (select id from ctx3)))->>'status', 'waiting', 'criador sai com gente na sala: ela continua');
select is((select created_by::text from public.duels where id = (select id from ctx3)), 'e1000000-0000-4000-8000-000000000002', 'o comando passa para o próximo assento');
select is((select ready from public.duel_players where user_id = 'e1000000-0000-4000-8000-000000000002' and duel_id = (select id from ctx3)), true, 'o novo criador fica pronto');
select is((public.party_join('e1000000-0000-4000-8000-000000000003', (select code from ctx3)))->>'mySeat', '1', 'o assento liberado é reaproveitado');
select throws_ok(format($$select public.party_kick('e1000000-0000-4000-8000-000000000003', %L, 'e1000000-0000-4000-8000-000000000002')$$, (select id from ctx3)), '55000', 'not_creator', 'só o criador expulsa');
select is((select jsonb_array_length(public.party_kick('e1000000-0000-4000-8000-000000000002', (select id from ctx3), 'e1000000-0000-4000-8000-000000000003')->'players')), 1, 'criador expulsa o convidado');
select is((public.party_cancel('e1000000-0000-4000-8000-000000000002', (select id from ctx3)))->>'status', 'cancelled', 'criador cancela a sala');
select is((public.party_leave('e1000000-0000-4000-8000-000000000002', (select id from ctx3)))->>'status', 'cancelled', 'sair de sala cancelada devolve o status');

-- ---------- 8. eliminação por tempo (on_timeout = out) e último em pé ----------
insert into public.party_tap values ('c4', public.party_create('e1000000-0000-4000-8000-000000000001', 'partytest', 3, 3, true, 'turns', 10, 'out', 600));
create temp table ctx4 as select (v->>'id')::uuid as id, v->>'code' as code from public.party_tap where k = 'c4';
grant all on ctx4 to public;
select ok(public.party_join('e1000000-0000-4000-8000-000000000002', (select code from ctx4)) is not null, 'preparação: party_join');
select ok(public.party_join('e1000000-0000-4000-8000-000000000003', (select code from ctx4)) is not null, 'preparação: party_join');
select ok(public.party_ready('e1000000-0000-4000-8000-000000000002', (select id from ctx4)) is not null, 'preparação: party_ready');
select ok(public.party_ready('e1000000-0000-4000-8000-000000000003', (select id from ctx4)) is not null, 'preparação: party_ready');
create temp table roster4 as select public.party_roster((select id from ctx4)) as r;
grant all on roster4 to public;
-- sala lotada e todos prontos: qualquer membro pode largar (a largada automática da Edge)
select is((public.party_launch('e1000000-0000-4000-8000-000000000003', (select id from ctx4), (select r->'roster' from roster4), '{"s":0}'::jsonb, 1))->>'status', 'running', 'sala lotada: um convidado também larga');
update public.duels set starts_at = now() - interval '1 second' where id = (select id from ctx4);
update public.party_games set turn_started_at = now() - interval '11 seconds' where duel_id = (select id from ctx4);
select is((public.party_state('e1000000-0000-4000-8000-000000000001', (select id from ctx4)))->'party'->>'turnSeat', '2', 'on_timeout=out: o assento 1 é eliminado e a vez vai ao 2');
select is((select placement::int from public.duel_players where user_id = 'e1000000-0000-4000-8000-000000000001' and duel_id = (select id from ctx4)), 3, 'eliminado por tempo fica em último');
select is((public.party_resign('e1000000-0000-4000-8000-000000000002', (select id from ctx4)))->>'status', 'finished', 'sobrou um só: a partida acaba');
select is((select winner_id::text from public.duels where id = (select id from ctx4)), 'e1000000-0000-4000-8000-000000000003', 'o último em pé vence');
select is((select string_agg(placement::text, ',' order by seat) from public.duel_players where duel_id = (select id from ctx4)), '3,2,1', 'colocações: 3º, 2º e 1º');

-- ---------- 9. limpeza de partida abandonada ----------
insert into public.party_tap values ('c5', public.party_create('e1000000-0000-4000-8000-000000000004', 'partytest', 2, 2, true, 'turns', null, 'skip', 60));
create temp table ctx5 as select (v->>'id')::uuid as id, v->>'code' as code from public.party_tap where k = 'c5';
grant all on ctx5 to public;
select ok(public.party_join('e1000000-0000-4000-8000-000000000005', (select code from ctx5)) is not null, 'preparação: party_join');
select ok(public.party_ready('e1000000-0000-4000-8000-000000000005', (select id from ctx5)) is not null, 'preparação: party_ready');
create temp table roster5 as select public.party_roster((select id from ctx5)) as r;
grant all on roster5 to public;
select ok(public.party_launch('e1000000-0000-4000-8000-000000000004', (select id from ctx5), (select r->'roster' from roster5), '{"s":0}'::jsonb, 1) is not null, 'preparação: party_launch');
update public.duels set starts_at = now() - interval '10 minutes' where id = (select id from ctx5);
update public.party_games set updated_at = now() - interval '10 minutes' where duel_id = (select id from ctx5);
select is(public.party_cleanup(), 1, 'a limpeza cancela partida parada além do tempo máximo');
select is((select status || ':' || cancel_reason from public.duels where id = (select id from ctx5)), 'cancelled:abandoned', 'motivo registrado como abandonada');

-- ---------- 10. permissões ----------
select is((select has_function_privilege('authenticated', 'public.party_move(uuid, uuid, int, jsonb, int, jsonb, jsonb, text)', 'execute')), false, 'o navegador não executa party_move');
select is((select has_function_privilege('service_role', 'public.party_move(uuid, uuid, int, jsonb, int, jsonb, jsonb, text)', 'execute')), true, 'a Edge executa party_move');
select is((select has_table_privilege('authenticated', 'public.party_games', 'select')), false, 'party_games é fechada ao navegador');
select is((select relrowsecurity from pg_class where oid = 'public.party_games'::regclass), true, 'party_games com RLS');

select * from finish();
rollback;
