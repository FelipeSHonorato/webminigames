-- =====================================================================================================
-- WebMiniGames · excluir a própria conta (LGPD)
--
-- Como aplicar: Supabase > SQL Editor > cole este arquivo inteiro > Run (ou `supabase db push` com a CLI).
-- Rode DEPOIS da migração inicial (20261014000000_init.sql).
--
-- Apaga a linha da conta em auth.users. O "on delete cascade" das chaves estrangeiras leva embora, junto,
-- todo o rastro do jogador: perfil, progressão, pontos, histórico, fases, coins e atividade.
-- O navegador confirma a senha atual antes (signInWithPassword); aqui basta a sessão autenticada — e a
-- função só consegue apagar a PRÓPRIA conta (auth.uid()), nunca a de outra pessoa.
-- =====================================================================================================

-- create or replace: rodar de novo não quebra (aplica os grants abaixo mesmo que a função já exista).
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  delete from auth.users where id = v_uid;
  if not found then raise exception 'account_not_found' using errcode = 'P0002'; end if;
end $$;

-- Só o próprio dono (autenticado) chama; visitante e cliente anônimo não têm EXECUTE.
revoke all on function public.delete_my_account() from public, anon, authenticated;
grant execute on function public.delete_my_account() to authenticated;
