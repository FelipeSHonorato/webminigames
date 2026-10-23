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
select is((select count(*) from public.games), 7::bigint, 'os 7 jogos estão cadastrados');

-- ---------- visitante (anon): só enxerga a lista de jogos e o ranking ----------
select public.tap_anon();
select is((select count(*) from public.games where enabled), 7::bigint, 'visitante lê a lista de jogos');
select throws_ok('select * from public.profiles',      '42501', null, 'visitante não lê perfis');
select throws_ok('select * from public.scores',        '42501', null, 'visitante não lê pontuações');
select throws_ok('select * from public.runs',          '42501', null, 'visitante não lê fases');
select throws_ok('select * from public.coins',         '42501', null, 'visitante não lê coins');
select throws_ok($$select public.open_phase('11111111-1111-1111-1111-111111111111','zip',0,'{}'::jsonb)$$, '42501', null, 'visitante não serve fases');
select throws_ok($$select public.finalize_win('11111111-1111-1111-1111-111111111111','zip', gen_random_uuid())$$, '42501', null, 'visitante não pontua');
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
-- servir/validar/pontuar é exclusivo do servidor (a Edge Function com service_role); o jogador não chama direto
select throws_ok($$select public.open_phase('11111111-1111-1111-1111-111111111111','zip',0,'{}'::jsonb)$$, '42501', null, 'Ana não serve a própria fase');
select throws_ok($$select public.finalize_win('11111111-1111-1111-1111-111111111111','zip', gen_random_uuid())$$, '42501', null, 'Ana não pontua direto');
select throws_ok($$select public.level_for('11111111-1111-1111-1111-111111111111','zip')$$, '42501', null, 'o nível é decidido no servidor');

-- fase salva (runs): lê, grava e apaga só a própria
select lives_ok($$insert into public.runs (user_id, game_id, state) values ('11111111-1111-1111-1111-111111111111','zip','{"seed":7,"level":0,"solved":false}')$$, 'Ana salva a fase');
select throws_ok($$insert into public.runs (user_id, game_id, state) values ('22222222-2222-2222-2222-222222222222','zip','{}')$$, '42501', null, 'Ana não grava fase em nome do Bob');
select lives_ok($$update public.runs set state = '{"seed":7,"level":0,"solved":false,"moves":3}' where game_id = 'zip'$$, 'Ana atualiza a fase');
select is((select state ->> 'moves' from public.runs where game_id = 'zip'), '3', 'a fase atualizada foi guardada');
select throws_ok($$insert into public.runs (user_id, game_id, state) values ('11111111-1111-1111-1111-111111111111','jogo-inexistente','{}')$$, '23503', null, 'fase de jogo que não existe é recusada');

-- ---------- fase servida + vitórias: quem serve/valida/pontua é o SERVIDOR (aqui chamado como superusuário) ----------
-- O ritmo entre vitórias tem seção própria no fim; aqui zeramos para poder encadear vitórias no mesmo instante.
select public.tap_super();
create or replace function public.phase_min_seconds() returns int language sql immutable set search_path = '' as $$ select 0 $$;

-- abrir a fase gasta 1 coin e o nível vem do servidor
select is((public.open_phase('11111111-1111-1111-1111-111111111111','zip', 7, '{}'::jsonb)) ->> 'level', '0', 'open_phase serve a fase no nível do jogador (Fácil)');
select is((select coins from public.coins where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'zip'), 1, 'abrir a fase gasta 1 dos 2 coins');

insert into public.tap_res select 'w1', public.finalize_win('11111111-1111-1111-1111-111111111111','zip','aaaaaaaa-0000-0000-0000-000000000001');
select is((select v ->> 'wins' from public.tap_res where k = 'w1'), '1', 'vitória: progressão 1');
select is((select v #>> '{score,points}' from public.tap_res where k = 'w1'), '5', 'vitória: o servidor dá os 5 pontos do Fácil');
select is((select v #>> '{coins,coins}' from public.tap_res where k = 'w1'), '1', 'a vitória NÃO gasta coin (o coin já foi cobrado ao abrir)');
select is((select v ->> 'duplicate' from public.tap_res where k = 'w1'), 'false', 'primeira vez não é repetição');

-- MESMA vitória reenviada (fila offline): reconhecida, sem contar de novo
insert into public.tap_res select 'w1b', public.finalize_win('11111111-1111-1111-1111-111111111111','zip','aaaaaaaa-0000-0000-0000-000000000001');

-- 2 dicas reduzem os pontos: 5 − 2 = 3 (a dica é contada no servidor, em use_hint)
select public.open_phase('11111111-1111-1111-1111-111111111111','zip', 8, '{}'::jsonb);
select public.use_hint('11111111-1111-1111-1111-111111111111','zip');
select public.use_hint('11111111-1111-1111-1111-111111111111','zip');
insert into public.tap_res select 'hk', public.finalize_win('11111111-1111-1111-1111-111111111111','zip','aaaaaaaa-0000-0000-0000-000000000002');

-- sem coins, o servidor NÃO serve outra fase (não há vitória de graça)
select throws_ok($$select public.open_phase('11111111-1111-1111-1111-111111111111','zip', 9, '{}'::jsonb)$$, '22023', 'no_coins', 'sem coin não abre fase');
select throws_ok($$select public.finalize_win('11111111-1111-1111-1111-111111111111','nao-existe', gen_random_uuid())$$, '22023', 'unknown_game', 'finalize_win recusa jogo inexistente');
select throws_ok($$select public.open_phase('11111111-1111-1111-1111-111111111111','nao-existe', 0, '{}'::jsonb)$$, '22023', 'unknown_game', 'open_phase também recusa jogo inexistente');

select is((select v ->> 'duplicate' from public.tap_res where k = 'w1b'), 'true', 'vitória reenviada é reconhecida');
select is((select v #>> '{score,points}' from public.tap_res where k = 'hk'), '3', 'a dica reduz os pontos (5 − 2 dicas = 3)');
select is((select points from public.scores where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'zip'), 8, '5 + 3 = 8 pontos');
select is((select wins from public.scores where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'zip'), 2, '2 vitórias');
select is((select coins from public.coins where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'zip'), 0, 'coins zerados, nunca negativos');
select is((select count(*) from public.win_log where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'zip'), 2::bigint, 'histórico tem 2 vitórias');
select is((select count(*) from public.phase_runs where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'zip'), 0::bigint, 'a fase é consumida ao vencer');

-- a dica nunca derruba os pontos abaixo de 1 (jogo à parte, para não mexer nos totais do zip)
select public.open_phase('11111111-1111-1111-1111-111111111111','sopa', 1, '{}'::jsonb);
update public.phase_runs set hints = 99 where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'sopa';
select is((public.finalize_win('11111111-1111-1111-1111-111111111111','sopa', gen_random_uuid())) #>> '{score,points}', '1', 'dica demais ainda vale 1 ponto');
delete from public.win_log       where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'sopa';
delete from public.scores        where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'sopa';
delete from public.game_progress where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'sopa';
delete from public.coins         where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'sopa';
delete from public.phase_runs    where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'sopa';

-- nível sobe a cada 15 vitórias: a pontuação cheia acompanha (5/10/15/20) e o Genius é o último nível
update public.game_progress set wins = 15 where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'zip';
update public.coins set coins = 2, anchor = now() where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'zip';
select is((public.open_phase('11111111-1111-1111-1111-111111111111','zip', 7, '{}'::jsonb)) ->> 'level', '1', 'no Médio, o nível da fase vem do servidor');
select is((public.finalize_win('11111111-1111-1111-1111-111111111111','zip', gen_random_uuid())) #>> '{score,points}', '10', 'Médio: a vitória vale 10 (o cliente não escolhe mais)');
update public.game_progress set wins = 30 where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'zip';
update public.coins set coins = 2, anchor = now() where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'zip';
select public.open_phase('11111111-1111-1111-1111-111111111111','zip', 7, '{}'::jsonb);
select is((public.finalize_win('11111111-1111-1111-1111-111111111111','zip', gen_random_uuid())) #>> '{score,points}', '15', 'Difícil: 15 pontos');
update public.game_progress set wins = 200 where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'zip';
update public.coins set coins = 2, anchor = now() where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'zip';
select public.open_phase('11111111-1111-1111-1111-111111111111','zip', 7, '{}'::jsonb);
select is((public.finalize_win('11111111-1111-1111-1111-111111111111','zip', gen_random_uuid())) #>> '{score,points}', '20', 'Genius: 20 pontos (o nível não passa de Genius)');

-- recarga de coins: 24 h depois volta ao máximo (2) e avança a âncora em dias inteiros
update public.game_progress set wins = 0 where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'zip';   -- volta ao Fácil: a vitória vale 5
update public.coins set coins = 0, anchor = now() - interval '49 hours' where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'zip';
select public.open_phase('11111111-1111-1111-1111-111111111111','zip', 7, '{}'::jsonb);
select is((public.finalize_win('11111111-1111-1111-1111-111111111111','zip', gen_random_uuid())) #>> '{score,points}', '5', 'após a recarga, a fase vale 5 de novo');
select is((select coins from public.coins where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'zip'), 1, 'após 49 h: recarrega para 2 e a fase gasta 1 ao abrir');
select ok((select anchor > now() - interval '25 hours' and anchor <= now() from public.coins where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'zip'), 'a âncora avançou em dias inteiros (2 dias)');

-- ---------- atividade e snapshot ----------
select public.tap_as('11111111-1111-1111-1111-111111111111');
select public.record_play('zip'); select public.record_play('zip');
select throws_ok($$select public.record_play('nao-existe')$$, '22023', 'unknown_game', 'record_play recusa jogo inexistente');
select public.tap_super();
insert into public.tap_res select 'ophase', public.open_phase('11111111-1111-1111-1111-111111111111','canos', 5, '{"n":3,"tiles":[]}'::jsonb);   -- fase servida em aberto
select public.tap_as('11111111-1111-1111-1111-111111111111');
insert into public.tap_res select 'snap', public.my_snapshot();
select public.tap_super();
select is((select v #>> '{activity,zip,plays}' from public.tap_res where k = 'snap'), '2', 'atividade: 2 fases abertas');
select is((select v #>> '{profile,name}' from public.tap_res where k = 'snap'), 'Ana', 'snapshot traz o perfil');
select is((select v #>> '{profile,nickname}' from public.tap_res where k = 'snap'), 'Aninha', 'snapshot traz o apelido');
select is((select v #>> '{runs,zip,seed}' from public.tap_res where k = 'snap'), '7', 'snapshot traz a fase salva (runs)');
select is((select v #>> '{phases,canos,level}' from public.tap_res where k = 'snap'), '0', 'snapshot traz a fase SERVIDA (phases) com o nível');
select is((select v #>> '{phases,canos,puzzle,n}' from public.tap_res where k = 'snap'), '3', 'snapshot traz o puzzle público da fase servida');
select ok((select not (v #> '{phases,canos}' ? 'seed') from public.tap_res where k = 'snap'), 'snapshot NÃO expõe a seed da fase');
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
select public.tap_super();

-- Trocar o nível também reinicia o desafio diário do jogo; o histórico anterior fica.
insert into public.game_progress (user_id, game_id, wins) values ('33333333-3333-3333-3333-333333333333', 'canos', 0)
  on conflict (user_id, game_id) do update set wins = excluded.wins;
insert into public.daily_grants (user_id, game_id, last_day)
  values ('33333333-3333-3333-3333-333333333333', 'canos', public.daily_day())
  on conflict (user_id, game_id) do update set last_day = excluded.last_day;
insert into public.daily_tickets (user_id, day, game_id, slot, level, seed) values
  ('33333333-3333-3333-3333-333333333333', public.daily_day(), 'canos', 1, 0, public.daily_seed(public.daily_day(), 'canos', 0, 1)),
  ('33333333-3333-3333-3333-333333333333', public.daily_day() - 1, 'canos', 1, 0, public.daily_seed(public.daily_day() - 1, 'canos', 0, 1));
insert into public.daily_runs (user_id, day, game_id, slot, level, seed, hints) values
  ('33333333-3333-3333-3333-333333333333', public.daily_day(), 'canos', 1, 0, public.daily_seed(public.daily_day(), 'canos', 0, 1), 0);
insert into public.daily_results (user_id, day, game_id, slot, level, hints, seconds) values
  ('33333333-3333-3333-3333-333333333333', public.daily_day(), 'canos', 2, 0, 0, 30),
  ('33333333-3333-3333-3333-333333333333', public.daily_day() - 1, 'canos', 1, 0, 0, 20);
select public.tap_as('33333333-3333-3333-3333-333333333333');
select is((public.admin_set_level('canos', 1)) ->> 'wins', '15', 'administrador: Médio = 15 vitórias');
select is((select count(*) from public.daily_tickets where user_id = '33333333-3333-3333-3333-333333333333' and game_id = 'canos'), 0::bigint, 'tickets do jogo foram descartados');
select is((select count(*) from public.daily_runs where user_id = '33333333-3333-3333-3333-333333333333' and game_id = 'canos'), 0::bigint, 'tentativas abertas do jogo foram descartadas');
select is((select count(*) from public.daily_results where user_id = '33333333-3333-3333-3333-333333333333' and game_id = 'canos' and day = public.daily_day()), 0::bigint, 'resultados de hoje foram descartados');
select is((select count(*) from public.daily_results where user_id = '33333333-3333-3333-3333-333333333333' and game_id = 'canos' and day = public.daily_day() - 1), 1::bigint, 'histórico anterior foi preservado');
insert into public.tap_res select 'adm_daily', public.daily_status();
select is((select count(*) from public.daily_tickets where user_id = '33333333-3333-3333-3333-333333333333' and game_id = 'canos' and day = public.daily_day()), 2::bigint, 'daily_status recria os cenários de hoje');
select is((select v #>> '{canos,pending,0,level}' from public.tap_res where k = 'adm_daily'), '1', 'os novos tickets já vêm no nível Médio');
select public.tap_super();
select public.open_phase('33333333-3333-3333-3333-333333333333','sudoku', 9, '{}'::jsonb);
insert into public.tap_res select 'adm', public.finalize_win('33333333-3333-3333-3333-333333333333','sudoku', gen_random_uuid());
select is((select coins from public.coins where user_id = '33333333-3333-3333-3333-333333333333' and game_id = 'sudoku'), 99998, 'administrador tem 99999 coins e gasta 1 ao abrir');
select is((select count(*) from public.scores where user_id = '33333333-3333-3333-3333-333333333333' and game_id = 'sudoku'), 0::bigint, 'a vitória do administrador não entra na pontuação');
select is((select count(*) from public.win_log where user_id = '33333333-3333-3333-3333-333333333333' and game_id = 'sudoku'), 0::bigint, 'a vitória do administrador não entra no histórico de tempo');
select public.tap_as('33333333-3333-3333-3333-333333333333');
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
select public.tap_super();
select public.open_phase('22222222-2222-2222-2222-222222222222','sudoku', 1, '{}'::jsonb);
select is((public.finalize_win('22222222-2222-2222-2222-222222222222','sudoku', gen_random_uuid())) #>> '{coins,coins}', '99998', 'recomeça com 99999 coins e gasta 1 ao abrir');
select public.tap_super();
update public.profiles set role = 'user' where id = '22222222-2222-2222-2222-222222222222';
delete from public.win_log where user_id = '22222222-2222-2222-2222-222222222222' and game_id = 'sudoku';
delete from public.scores where user_id = '22222222-2222-2222-2222-222222222222' and game_id = 'sudoku';

-- ---------- ranking ----------
-- Ana: zip 5+3+10+15+20+5, outros: Bob e Carol com 5 em zip; Bob chegou antes de Carol; Carol é do sul como a Ana.
update public.profiles set region = 'sul' where id = '44444444-4444-4444-4444-444444444444';
select public.tap_super();
select public.open_phase('22222222-2222-2222-2222-222222222222','zip', 3, '{}'::jsonb); select public.finalize_win('22222222-2222-2222-2222-222222222222','zip', gen_random_uuid());
select public.open_phase('44444444-4444-4444-4444-444444444444','zip', 3, '{}'::jsonb); select public.finalize_win('44444444-4444-4444-4444-444444444444','zip', gen_random_uuid());
select public.open_phase('44444444-4444-4444-4444-444444444444','patches', 3, '{}'::jsonb); select public.finalize_win('44444444-4444-4444-4444-444444444444','patches', gen_random_uuid());
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
select is((select v #>> '{top,0,points}' from public.tap_res where k = 'rk_all'), '58', 'geral: 5 + 3 + 10 + 15 + 20 + 5 pontos da Ana');
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

-- delete_my_account (migração 20261017000000): o jogador apaga a própria conta e todo o rastro dela
select public.tap_as('22222222-2222-2222-2222-222222222222');
select lives_ok($$select public.delete_my_account()$$, 'o jogador exclui a própria conta');
select public.tap_anon();
select throws_ok($$select public.delete_my_account()$$, '42501', null, 'visitante não exclui conta');
select public.tap_super();
select is((select count(*) from auth.users where id = '22222222-2222-2222-2222-222222222222'), 0::bigint, 'a conta foi apagada de auth.users');
select is((select count(*) from public.profiles where id = '22222222-2222-2222-2222-222222222222'), 0::bigint, 'o perfil foi apagado em cascata');
select is((select count(*) from public.scores where user_id = '22222222-2222-2222-2222-222222222222'), 0::bigint, 'os pontos foram apagados em cascata');

-- ---------- ritmo: no máximo uma vitória por jogo a cada phase_min_seconds (anti-farm) ----------
create or replace function public.phase_min_seconds() returns int language sql immutable set search_path = '' as $$ select 3 $$;
select public.tap_super();
select public.open_phase('11111111-1111-1111-1111-111111111111','patches', 123, '{}'::jsonb);
select throws_ok($$select public.finalize_win('11111111-1111-1111-1111-111111111111','patches','bbbbbbbb-0000-0000-0000-000000000001')$$, 'P0001', 'too_fast', 'fase recém-aberta não pontua na hora');
update public.phase_runs set started_at = now() - interval '10 seconds' where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'patches';
select lives_ok($$select public.finalize_win('11111111-1111-1111-1111-111111111111','patches','bbbbbbbb-0000-0000-0000-000000000001')$$, 'fase com tempo suficiente já pode vencer');
select public.open_phase('11111111-1111-1111-1111-111111111111','patches', 124, '{}'::jsonb);
update public.phase_runs set started_at = now() - interval '10 seconds' where user_id = '11111111-1111-1111-1111-111111111111' and game_id = 'patches';
select throws_ok($$select public.finalize_win('11111111-1111-1111-1111-111111111111','patches','bbbbbbbb-0000-0000-0000-000000000002')$$, 'P0001', 'too_fast', 'duas vitórias coladas no mesmo jogo são recusadas');
-- ---------- desafio diário: tickets, tentativa aberta e ranking por tempo ----------
select public.tap_super();
select is(public.daily_day(), (now() at time zone 'America/Sao_Paulo')::date, 'o dia do desafio é o de Brasília');
select is(public.daily_seed('2026-01-01'::date, 'zip', 1, 1), public.daily_seed('2026-01-01'::date, 'zip', 1, 1), 'a seed do dia é determinística');
select isnt(public.daily_seed('2026-01-01'::date, 'zip', 1, 1), public.daily_seed('2026-01-01'::date, 'zip', 1, 2), 'slots diferentes têm cenários diferentes');
select isnt(public.daily_seed('2026-01-01'::date, 'zip', 1, 1), public.daily_seed('2026-01-01'::date, 'sopa', 1, 1), 'jogos diferentes têm cenários diferentes');

-- Tickets de teste (o dia real pode ser anterior ao lançamento; a concessão automática não é o alvo aqui).
insert into public.daily_grants (user_id, game_id, last_day)
  values ('11111111-1111-1111-1111-111111111111', 'zip', public.daily_day())
  on conflict (user_id, game_id) do update set last_day = excluded.last_day;
insert into public.daily_tickets (user_id, day, game_id, slot, level, seed) values
  ('11111111-1111-1111-1111-111111111111', public.daily_day(), 'zip', 1, 0, public.daily_seed(public.daily_day(), 'zip', 0, 1)),
  ('11111111-1111-1111-1111-111111111111', public.daily_day(), 'zip', 2, 0, public.daily_seed(public.daily_day(), 'zip', 0, 2));

select is((public.daily_open('11111111-1111-1111-1111-111111111111', 'zip', 1, public.daily_day())) ->> 'coins', '1', 'abrir o ticket gasta 1 ticket do dia');
insert into public.tap_res select 'dfirst', public.daily_finish('11111111-1111-1111-1111-111111111111', 'zip', 1, null, public.daily_day());
select is((select v ->> 'duplicate' from public.tap_res where k = 'dfirst'), 'false', 'concluir guarda o tempo do dia');
select is((select (v -> 'score' ->> 'points')::int from public.tap_res where k = 'dfirst') > 0, true, 'concluir o cenário do dia também pontua');
insert into public.tap_res select 'dfin', public.daily_finish('11111111-1111-1111-1111-111111111111', 'zip', 1, null, public.daily_day());
select is((select v ->> 'duplicate' from public.tap_res where k = 'dfin'), 'true', 'reenviar a conclusão do dia não conta duas vezes');
select is((public.daily_open('11111111-1111-1111-1111-111111111111', 'zip', 2, public.daily_day())) ->> 'coins', '0', 'o segundo ticket do dia abre o segundo cenário');
select throws_ok($$select public.daily_open('11111111-1111-1111-1111-111111111111', 'zip', 1, public.daily_day())$$, '22023', 'no_coins', 'sem ticket não abre outro tabuleiro');
select lives_ok($$select public.daily_leaderboard('zip', 0, 'global', 10, public.daily_day())$$, 'o ranking por tempo do dia é lido');
select throws_ok($$select public.daily_open('11111111-1111-1111-1111-111111111111', 'zip', 11, public.daily_day())$$, '22023', 'bad_slot', 'slot acima do máximo é recusado');

-- O cliente (authenticated) não pode escrever a fase do dia direto.
select public.tap_as('11111111-1111-1111-1111-111111111111');
select throws_ok($$select public.daily_open('11111111-1111-1111-1111-111111111111', 'zip', 1, public.daily_day())$$, '42501', null, 'o jogador não abre a fase do dia direto');
select throws_ok('select * from public.daily_results', '42501', null, 'o jogador não lê a tabela do dia direto');
select public.tap_super();

-- ---------- tickets/cenários por dia configuráveis (painel do administrador) ----------
select is(public.coins_cap(), 2, 'sem configuração, valem os 2 tickets por dia padrão');
select public.tap_as('33333333-3333-3333-3333-333333333333');                      -- a conta administradora
select is((public.set_coins_per_day(4)) ->> 'coinsPerDay', '4', 'o administrador muda os tickets por dia');
select throws_ok($$select public.set_coins_per_day(0)$$, '22023', 'invalid_coins', 'valor fora de 1..max é recusado');
select public.tap_super();
select is(public.coins_cap(), 4, 'coins_cap acompanha a configuração');
insert into public.daily_grants (user_id, game_id, last_day)
  values ('44444444-4444-4444-4444-444444444444', 'zip', public.daily_day())
  on conflict (user_id, game_id) do update set last_day = excluded.last_day;
insert into public.daily_tickets (user_id, day, game_id, slot, level, seed)
  values ('44444444-4444-4444-4444-444444444444', public.daily_day(), 'zip', 4, 0, public.daily_seed(public.daily_day(), 'zip', 0, 4));
select is((public.daily_open('44444444-4444-4444-4444-444444444444', 'zip', 4, public.daily_day())) ->> 'slots', '4', 'há 4 cenários quando há 4 tickets por dia');
select throws_ok($$select public.daily_open('44444444-4444-4444-4444-444444444444', 'zip', 5, public.daily_day())$$, '22023', 'no_coins', 'não existe ticket para o 5º cenário');
select public.tap_as('11111111-1111-1111-1111-111111111111');                      -- jogador comum
select throws_ok($$select public.set_coins_per_day(3)$$, '42501', null, 'só o administrador muda a configuração');
select public.tap_super();

select * from finish();
rollback;
