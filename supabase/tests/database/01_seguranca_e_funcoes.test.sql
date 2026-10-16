-- Testes do banco (pgTAP). Rodam com `supabase test db` (CLI do Supabase) e não deixam nada no banco: tudo é desfeito no fim.
begin;
select no_plan();

-- ---------- ajudas do teste: "entrar" como um papel do Supabase (o que o PostgREST faz a cada requisição) ----------
create function public.tap_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function public.tap_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
end $$;
create function public.tap_super() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;
create function public.tap_rows(p_sql text) returns bigint language plpgsql as $$      -- quantas linhas um UPDATE/DELETE alcançou (0 = a RLS bloqueou)
declare n bigint;
begin execute p_sql; get diagnostics n = row_count; return n; end $$;
create table public.tap_res (k text primary key, v jsonb);          -- guarda respostas de funções entre papéis
grant all on public.tap_res to public;

-- ---------- contas de teste (o que o Supabase Auth cria no cadastro) ----------
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'ana@teste.com',          '{"name":"Ana","region":"sul"}'),
  ('22222222-2222-2222-2222-222222222222', 'bob@teste.com',          '{"name":"  Bob  ","region":"marte"}'),   -- região inválida vira nula; nome é aparado
  ('33333333-3333-3333-3333-333333333333', 'admin@teste.com',        '{"name":"Admin"}'),
  ('44444444-4444-4444-4444-444444444444', 'carol.silva@teste.com',  '{}');                                    -- sem nome: usa a parte do e-mail
update public.profiles set role = 'admin' where id = '33333333-3333-3333-3333-333333333333';

select is((select count(*) from public.profiles), 4::bigint, 'cada conta nova ganha um perfil');
select is((select region from public.profiles where id = '11111111-1111-1111-1111-111111111111'), 'sul', 'região válida é guardada');
select is((select region from public.profiles where id = '22222222-2222-2222-2222-222222222222'), null, 'região inválida vira nula');
select is((select name from public.profiles where id = '22222222-2222-2222-2222-222222222222'), 'Bob', 'nome é aparado');
select is((select name from public.profiles where id = '44444444-4444-4444-4444-444444444444'), 'carol.silva', 'sem nome: usa o começo do e-mail');
select is((select role from public.profiles where id = '11111111-1111-1111-1111-111111111111'), 'user', 'conta nova é jogador comum');
select is((select count(*) from public.games), 6::bigint, 'os 6 jogos estão cadastrados');

-- ---------- visitante (anon): só enxerga a lista de jogos e o ranking ----------
select public.tap_anon();
select is((select count(*) from public.games where enabled), 6::bigint, 'visitante lê a lista de jogos');
select throws_ok('select * from public.profiles',      '42501', null, 'visitante não lê perfis');
select throws_ok('select * from public.scores',        '42501', null, 'visitante não lê pontuações');
select throws_ok('select * from public.runs',          '42501', null, 'visitante não lê fases');
select throws_ok('select * from public.coins',         '42501', null, 'visitante não lê coins');
select throws_ok($$select public.submit_win('zip', 5)$$, '42501', null, 'visitante não pontua');
select throws_ok($$select public.my_snapshot()$$,        '42501', null, 'visitante não tem snapshot');
select lives_ok($$select public.ranking('zip')$$, 'visitante vê o ranking');
select public.tap_super();

-- ---------- Ana: o que ela pode e não pode ----------
select public.tap_as('11111111-1111-1111-1111-111111111111');
select is((select count(*) from public.profiles), 1::bigint, 'Ana só enxerga o próprio perfil');
select lives_ok($$update public.profiles set nickname = 'Aninha' where id = '11111111-1111-1111-1111-111111111111'$$, 'Ana define o apelido');
select throws_ok($$update public.profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111'$$, '42501', null, 'Ana NÃO vira administradora');
select throws_ok($$update public.profiles set nickname = 'ab' where id = '11111111-1111-1111-1111-111111111111'$$, '23514', null, 'apelido curto demais é recusado');
select throws_ok($$update public.profiles set nickname = '<b>' where id = '11111111-1111-1111-1111-111111111111'$$, '23514', null, 'apelido com < > é recusado');
select throws_ok($$update public.profiles set avatar = 'http://x/y.png' where id = '11111111-1111-1111-1111-111111111111'$$, '23514', null, 'foto precisa ser data:image');
select lives_ok($$update public.profiles set avatar = 'data:image/jpeg;base64,AAAA' where id = '11111111-1111-1111-1111-111111111111'$$, 'foto data:image é aceita');
select is(public.tap_rows($$update public.profiles set name = 'Hack' where id = '22222222-2222-2222-2222-222222222222'$$), 0::bigint, 'Ana não altera o perfil do Bob');
select throws_ok($$update public.scores set points = 999$$,                                        '42501', null, 'Ana não escreve pontos direto');
select throws_ok($$insert into public.scores (user_id, game_id, points, wins) values ('11111111-1111-1111-1111-111111111111','zip',999,1)$$, '42501', null, 'Ana não insere pontos');
select throws_ok($$insert into public.game_progress (user_id, game_id, wins) values ('11111111-1111-1111-1111-111111111111','zip',99)$$,    '42501', null, 'Ana não escreve progressão');
select throws_ok($$insert into public.coins (user_id, game_id, coins, anchor) values ('11111111-1111-1111-1111-111111111111','zip',99,now())$$, '42501', null, 'Ana não se dá coins');
select throws_ok($$delete from public.win_log$$,                                                   '42501', null, 'Ana não apaga o histórico');
select throws_ok($$select public.coins_apply('11111111-1111-1111-1111-111111111111','zip',false)$$, '42501', null, 'coins_apply é interna');
select is(public.tap_rows($$update public.games set enabled = false where id = 'zip'$$), 0::bigint, 'Ana não desliga jogos');

-- fase salva (runs): lê, grava e apaga só a própria
select lives_ok($$insert into public.runs (user_id, game_id, state) values ('11111111-1111-1111-1111-111111111111','zip','{"seed":7,"level":0,"solved":false}')$$, 'Ana salva a fase');
select throws_ok($$insert into public.runs (user_id, game_id, state) values ('22222222-2222-2222-2222-222222222222','zip','{}')$$, '42501', null, 'Ana não grava fase em nome do Bob');
select lives_ok($$update public.runs set state = '{"seed":7,"level":0,"solved":false,"moves":3}' where game_id = 'zip'$$, 'Ana atualiza a fase');
select is((select state ->> 'moves' from public.runs where game_id = 'zip'), '3', 'a fase atualizada foi guardada');
select throws_ok($$insert into public.runs (user_id, game_id, state) values ('11111111-1111-1111-1111-111111111111','jogo-inexistente','{}')$$, '23503', null, 'fase de jogo que não existe é recusada');

-- ---------- vitórias: pontos, progressão, coins e idempotência ----------
select public.tap_as('11111111-1111-1111-1111-111111111111');
insert into public.tap_res select 'w1', public.submit_win('zip', 5, 'aaaaaaaa-0000-0000-0000-000000000001');
select public.tap_super();
select is((select v ->> 'wins' from public.tap_res where k = 'w1'), '1', 'vitória: progressão 1');
select is((select v #>> '{score,points}' from public.tap_res where k = 'w1'), '5', 'vitória: 5 pontos no Fácil');
select is((select v #>> '{coins,coins}' from public.tap_res where k = 'w1'), '1', 'vitória gasta 1 dos 2 coins');
select is((select v ->> 'duplicate' from public.tap_res where k = 'w1'), 'false', 'primeira vez não é repetição');

select public.tap_as('11111111-1111-1111-1111-111111111111');
insert into public.tap_res select 'w1b', public.submit_win('zip', 5, 'aaaaaaaa-0000-0000-0000-000000000001');   -- MESMA vitória reenviada
select throws_ok($$select public.submit_win('zip', 6)$$,  '22023', 'invalid_points', 'Fácil: 6 pontos é recusado');
select throws_ok($$select public.submit_win('zip', 0)$$,  '22023', 'invalid_points', '0 ponto é recusado');
select throws_ok($$select public.submit_win('zip', -3)$$, '22023', 'invalid_points', 'ponto negativo é recusado');
select throws_ok($$select public.submit_win('zip', null)$$, '22023', 'invalid_points', 'ponto nulo é recusado');
select throws_ok($$select public.submit_win('nao-existe', 5)$$, '22023', 'unknown_game', 'jogo inexistente é recusado');
select public.tap_super();
select is((select v ->> 'duplicate' from public.tap_res where k = 'w1b'), 'true', 'vitória reenviada é reconhecida');
select is((select points from public.scores where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'zip'), 5, 'reenviar não soma pontos de novo');
select is((select coins from public.coins where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'zip'), 1, 'reenviar não gasta outro coin');
select is((select count(*) from public.win_log where user_id = '11111111-1111-1111-1111-111111111111'), 1::bigint, 'histórico tem 1 vitória');

select public.tap_as('11111111-1111-1111-1111-111111111111');
select public.submit_win('zip', 3, 'aaaaaaaa-0000-0000-0000-000000000002');   -- 2ª vitória, com dica (3 pontos): gasta o 2º coin
select public.submit_win('zip', 3, 'aaaaaaaa-0000-0000-0000-000000000003');   -- 3ª: sem coin, mas a vitória conta
select public.tap_super();
select is((select points from public.scores where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'zip'), 11, '5 + 3 + 3 = 11 pontos');
select is((select wins from public.game_progress where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'zip'), 3, '3 vitórias de progressão');
select is((select coins from public.coins where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'zip'), 0, 'coins zerados, nunca negativos');

-- nível sobe a cada 15 vitórias: o teto de pontos acompanha (5/10/15/20), e o Genius é o último nível
update public.game_progress set wins = 15  where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'zip';
select public.tap_as('11111111-1111-1111-1111-111111111111');
select throws_ok($$select public.submit_win('zip', 11)$$, '22023', 'invalid_points', 'Médio: 11 pontos é recusado');
select lives_ok($$select public.submit_win('zip', 10, gen_random_uuid())$$, 'Médio: 10 pontos é aceito');
select public.tap_super();
update public.game_progress set wins = 30 where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'zip';
select public.tap_as('11111111-1111-1111-1111-111111111111');
select throws_ok($$select public.submit_win('zip', 16)$$, '22023', 'invalid_points', 'Difícil: 16 pontos é recusado');
select lives_ok($$select public.submit_win('zip', 15, gen_random_uuid())$$, 'Difícil: 15 pontos é aceito');
select public.tap_super();
update public.game_progress set wins = 200 where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'zip';
select public.tap_as('11111111-1111-1111-1111-111111111111');
select throws_ok($$select public.submit_win('zip', 21)$$, '22023', 'invalid_points', 'Genius: 21 pontos é recusado (o nível não passa de Genius)');
select lives_ok($$select public.submit_win('zip', 20, gen_random_uuid())$$, 'Genius: 20 pontos é aceito');
select public.tap_super();

-- recarga de coins: 24 h depois volta ao máximo (2) e avança a âncora em dias inteiros
update public.coins set coins = 0, anchor = now() - interval '49 hours' where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'zip';
select public.tap_as('11111111-1111-1111-1111-111111111111');
insert into public.tap_res select 'refill', public.submit_win('zip', 5, gen_random_uuid());
select public.tap_super();
select is((select v #>> '{coins,coins}' from public.tap_res where k = 'refill'), '1', 'após 49 h: recarrega para 2 e a vitória gasta 1');
select ok((select anchor > now() - interval '25 hours' and anchor <= now() from public.coins where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'zip'), 'a âncora avançou em dias inteiros (2 dias)');

-- ---------- atividade e snapshot ----------
select public.tap_as('11111111-1111-1111-1111-111111111111');
select public.record_play('zip'); select public.record_play('zip');
select throws_ok($$select public.record_play('nao-existe')$$, '22023', 'unknown_game', 'record_play recusa jogo inexistente');
insert into public.tap_res select 'snap', public.my_snapshot();
select public.tap_super();
select is((select v #>> '{activity,zip,plays}' from public.tap_res where k = 'snap'), '2', 'atividade: 2 fases abertas');
select is((select v #>> '{profile,name}' from public.tap_res where k = 'snap'), 'Ana', 'snapshot traz o perfil');
select is((select v #>> '{profile,nickname}' from public.tap_res where k = 'snap'), 'Aninha', 'snapshot traz o apelido');
select is((select v #>> '{runs,zip,seed}' from public.tap_res where k = 'snap'), '7', 'snapshot traz a fase salva');
select ok((select (v #> '{scores,zip,points}')::int > 0 and v #> '{wins,zip}' is not null and v #> '{coins,zip}' is not null from public.tap_res where k = 'snap'), 'snapshot traz pontos, vitórias e coins');
select ok((select not (v #> '{profile}' ? 'email') from public.tap_res where k = 'snap'), 'snapshot não expõe e-mail');

-- ---------- administrador ----------
select public.tap_as('11111111-1111-1111-1111-111111111111');
select throws_ok($$select public.admin_set_level('zip', 3)$$, '42501', 'forbidden', 'jogador comum não escolhe nível');
select public.tap_super();

insert into public.runs (user_id, game_id, state) values ('33333333-3333-3333-3333-333333333333', 'sudoku', '{"seed":1}');
select public.tap_as('33333333-3333-3333-3333-333333333333');
select is((select count(*) from public.profiles), 4::bigint, 'o administrador enxerga todos os perfis');
select is((public.admin_set_level('sudoku', 3)) ->> 'wins', '45', 'administrador: Genius = 45 vitórias');
select is((select count(*) from public.runs where game_id = 'sudoku'), 0::bigint, 'a fase salva do administrador foi descartada');
select throws_ok($$select public.admin_set_level('sudoku', 4)$$,  '22023', 'invalid_level', 'nível 4 não existe');
select throws_ok($$select public.admin_set_level('sudoku', -1)$$, '22023', 'invalid_level', 'nível -1 não existe');
select throws_ok($$select public.admin_set_level('xx', 1)$$,      '22023', 'unknown_game',   'jogo inexistente');
select lives_ok($$select public.admin_set_level('sudoku', 0)$$, 'administrador volta ao Fácil');
insert into public.tap_res select 'adm', public.submit_win('sudoku', 5, gen_random_uuid());
select is((select v #>> '{coins,coins}' from public.tap_res where k = 'adm'), '99998', 'administrador tem 99999 coins e gasta 1');
select lives_ok($$update public.games set enabled = false where id = 'patches'$$, 'administrador desliga um jogo');
select public.tap_super();
select is((select enabled from public.games where id = 'patches'), false, 'o jogo ficou desligado');
update public.games set enabled = true;

-- promote_admin: só o dono do projeto; a conta promovida recomeça com os coins do administrador
select public.tap_as('11111111-1111-1111-1111-111111111111');
select throws_ok($$select public.promote_admin('bob@teste.com')$$, '42501', null, 'jogador comum não promove ninguém');
select public.tap_anon();
select throws_ok($$select public.promote_admin('bob@teste.com')$$, '42501', null, 'visitante não promove ninguém');
select public.tap_super();
select throws_ok($$select public.promote_admin('ninguem@teste.com')$$, 'P0002', null, 'e-mail inexistente é recusado');
select lives_ok($$select public.promote_admin('  BOB@teste.com ')$$, 'o dono promove (e-mail sem diferenciar maiúsculas)');
select is((select role from public.profiles where id = '22222222-2222-2222-2222-222222222222'), 'admin', 'Bob virou administrador');
select is((select count(*) from public.coins where user_id = '22222222-2222-2222-2222-222222222222'), 0::bigint, 'coins antigos descartados');
select public.tap_as('22222222-2222-2222-2222-222222222222');
select is((public.submit_win('sudoku', 5, gen_random_uuid())) #>> '{coins,coins}', '99998', 'recomeça com 99999 coins e gasta 1');
select public.tap_super();
update public.profiles set role = 'user' where id = '22222222-2222-2222-2222-222222222222';
delete from public.win_log where user_id = '22222222-2222-2222-2222-222222222222' and game_id = 'sudoku';
delete from public.scores where user_id = '22222222-2222-2222-2222-222222222222' and game_id = 'sudoku';

-- ---------- ranking ----------
-- Ana: zip 11+10+15+20+5, outros: Bob e Carol com 5 em zip; Bob chegou antes de Carol; Carol é do sul como a Ana.
update public.profiles set region = 'sul' where id = '44444444-4444-4444-4444-444444444444';
select public.tap_as('22222222-2222-2222-2222-222222222222'); select public.submit_win('zip', 5, gen_random_uuid()); select public.tap_super();
select public.tap_as('44444444-4444-4444-4444-444444444444'); select public.submit_win('zip', 5, gen_random_uuid()); select public.submit_win('patches', 5, gen_random_uuid()); select public.tap_super();
update public.scores set updated_at = now() - interval '2 hours' where user_id = '22222222-2222-2222-2222-222222222222';   -- Bob chegou primeiro
update public.scores set updated_at = now() - interval '1 hour'  where user_id = '44444444-4444-4444-4444-444444444444' and game_id = 'zip';

select public.tap_as('11111111-1111-1111-1111-111111111111');
insert into public.tap_res select 'rk_global', public.ranking('zip', 'global', 10);
insert into public.tap_res select 'rk_region', public.ranking('zip', 'region', 10);
insert into public.tap_res select 'rk_all',    public.ranking(null, 'global', 10);
select public.tap_as('22222222-2222-2222-2222-222222222222');
insert into public.tap_res select 'rk_bob_lim1', public.ranking('zip', 'global', 1);
insert into public.tap_res select 'rk_bob_region', public.ranking('zip', 'region', 10);
select public.tap_anon();
insert into public.tap_res select 'rk_anon', public.ranking('zip');
select public.tap_super();

select is((select v ->> 'total' from public.tap_res where k = 'rk_global'), '3', 'ranking do zip: 3 jogadores com pontos (o administrador, sem pontos, fica de fora)');
select is((select v #>> '{top,0,name}' from public.tap_res where k = 'rk_global'), 'Aninha', '1º: Ana, exibida pelo apelido');
select is((select v #>> '{top,1,name}' from public.tap_res where k = 'rk_global'), 'Bob', '2º: Bob (empate de pontos: chegou primeiro)');
select is((select v #>> '{top,2,name}' from public.tap_res where k = 'rk_global'), 'carol.silva', '3º: Carol');
select is((select v #>> '{top,0,isMe}' from public.tap_res where k = 'rk_global'), 'true', 'a Ana vê a si mesma marcada');
select is((select v #>> '{top,1,isMe}' from public.tap_res where k = 'rk_global'), 'false', 'e não marca os outros');
select is((select v #>> '{top,0,avatar}' from public.tap_res where k = 'rk_global'), 'data:image/jpeg;base64,AAAA', 'o ranking traz a foto');
select ok((select not (v #> '{top,0}' ? 'email') from public.tap_res where k = 'rk_global'), 'o ranking nunca expõe e-mail');
select is((select v ->> 'total' from public.tap_res where k = 'rk_region'), '2', 'ranking regional (sul): Ana e Carol');
select is((select v #>> '{top,1,rank}' from public.tap_res where k = 'rk_region'), '2', 'no regional a posição é recontada');
select is((select v #>> '{top,0,points}' from public.tap_res where k = 'rk_all'), '61', 'geral: 11 + 10 + 15 + 20 + 5 pontos da Ana');
select is((select v #>> '{top,0,name}' from public.tap_res where k = 'rk_all'), 'Aninha', 'geral: Ana lidera');
select is((select jsonb_array_length(v -> 'top') from public.tap_res where k = 'rk_bob_lim1'), 1, 'limite 1: só o primeiro');
select is((select v #>> '{me,rank}' from public.tap_res where k = 'rk_bob_lim1'), '2', 'fora do top, "me" traz a posição do Bob');
select is((select v ->> 'total' from public.tap_res where k = 'rk_bob_region'), '0', 'sem região, o ranking regional é vazio');
select is((select v ->> 'me' from public.tap_res where k = 'rk_anon'), null, 'visitante não tem "me"');
select is((select v ->> 'total' from public.tap_res where k = 'rk_anon'), '3', 'visitante vê o ranking global');
select is((select v #>> '{top,0,isMe}' from public.tap_res where k = 'rk_anon'), 'false', 'visitante: ninguém é "você"');

-- ---------- isolamento entre jogadores e remoção de conta ----------
select public.tap_as('22222222-2222-2222-2222-222222222222');
select is((select count(*) from public.win_log), 1::bigint, 'Bob só vê o próprio histórico');
select is((select count(*) from public.runs), 0::bigint, 'Bob não vê fases dos outros');
select is((select count(*) from public.scores), 1::bigint, 'Bob só vê as próprias pontuações');
select public.tap_super();
delete from auth.users where id = '44444444-4444-4444-4444-444444444444';
select is((select count(*) from public.scores where user_id = '44444444-4444-4444-4444-444444444444'), 0::bigint, 'apagar a conta apaga os dados do jogador');

select * from finish();
rollback;
