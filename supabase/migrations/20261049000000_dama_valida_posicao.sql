-- ====================================================================================================
-- WebMiniGames · Dama — recusa posição inválida na criação da sala + limpa salas criadas com tabuleiro errado
--
-- Rode DEPOIS de 20261048000000_duel_ready_fix.sql. Idempotente (pode rodar de novo).
--
-- Causa do bug "Estou pronto não funciona para o criador": a Edge `play` chamava o `newGame()` do XADREZ ao criar
-- sala de Dama e gravava `rnbqkbnr/pppppppp/...` em dama_games.position. Ao iniciar, o cliente da Dama recusava
-- a posição ("posição inválida: peça") e o lobby do criador (o 2º a clicar, que dispara o início) travava.
-- O conserto principal está em supabase/functions/play/index.ts (import do newGame da Dama). Esta migração é a
-- segunda camada: o banco passa a recusar posição que não seja de Dama.
-- ====================================================================================================

-- 1. Cancela salas de Dama ainda ativas que nasceram com tabuleiro inválido (não valem pontos: o rating só
--    dispara em 'finished').
update public.duels d
   set status = 'cancelled', cancel_reason = 'bad_position', finished_at = now()
  from public.dama_games g
 where g.duel_id = d.id
   and d.status in ('waiting', 'running')
   and g.position !~ '^[.pPdD-]{8}(/[.pPdD-]{8}){7}$';

-- 2. Criar sala: valida a posição
create or replace function public.dama_create(
  p_uid uuid, p_minutes int, p_color text, p_position text, p_key text, p_open boolean default true
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_duel public.duels;
  v_ms int;
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_minutes is null or p_minutes not in (3, 10, 30, 60) then
    raise exception 'bad_minutes' using errcode = '22023';
  end if;
  if p_color is null or p_color not in ('w', 'b') then
    raise exception 'bad_color' using errcode = '22023';
  end if;
  if p_position is null or p_key is null then
    raise exception 'bad_state' using errcode = '22023';
  end if;
  -- 8 fileiras de 8 casas separadas por "/", só com . - P D p d. Barra posição de OUTRO jogo (ex.: o tabuleiro de
  -- xadrez que a Edge chegou a gravar quando usou o `newGame` errado): a sala nasceria e travaria ao iniciar.
  if p_position !~ '^[.pPdD-]{8}(/[.pPdD-]{8}){7}$' then
    raise exception 'bad_state' using errcode = '22023';
  end if;

  -- UMA sala aberta por vez ('waiting' e ainda não expirada), com lock por usuário.
  perform pg_advisory_xact_lock(hashtextextended('duel_open:' || p_uid::text, 0));
  if (select count(*) from public.duels
      where created_by = p_uid and status = 'waiting' and expires_at > now()) >= 1 then
    raise exception 'too_many_open' using errcode = '55000';
  end if;

  v_ms := p_minutes * 60000;
  v_code := public.duel_gen_code();

  insert into public.duels (
    code, game_id, level, seed, gen, public_view, full_puzzle, rule, kind, max_seconds, created_by, is_open
  ) values (
    v_code, 'dama', 0, 0, 1, null, null, 'turn', 'turn', p_minutes * 60, p_uid, coalesce(p_open, true)
  ) returning * into v_duel;

  insert into public.duel_players (duel_id, user_id, ready)
  values (v_duel.id, p_uid, false);

  insert into public.dama_games (
    duel_id, position, turn, keys, white_id, black_id, white_ms, black_ms
  ) values (
    v_duel.id, p_position, 'w', jsonb_build_array(p_key),
    case when p_color = 'w' then p_uid end,
    case when p_color = 'b' then p_uid end,
    v_ms, v_ms
  );

  return public.dama_json(p_uid, v_duel.id, v_ms, v_ms);
end $$;

revoke all on function public.dama_create(uuid, int, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.dama_create(uuid, int, text, text, text, boolean) to service_role;

-- FIM DA MIGRAÇÃO 20261049000000_dama_valida_posicao.sql
