/* Ligação com o Supabase (https://supabase.com/dashboard > seu projeto > Project Settings > API).
   Deixe os dois valores vazios para rodar em MODO LOCAL (tudo no navegador, como no protótipo).
   Preenchidos, as contas e os registros passam a ficar no Supabase. Passo a passo: docs/SUPABASE.md.

   Estes dois valores são PÚBLICOS por projeto (vão no navegador de qualquer jeito). A proteção dos dados está nas
   regras (RLS) e funções do banco, em supabase/migrations. NUNCA coloque aqui a chave "service_role" / "secret". */
export const SUPABASE_URL = "https://vizpjhrkuztzgqiqjwom.supabase.co";        // ex.: "https://abcdefghijklmnop.supabase.co"
export const SUPABASE_ANON_KEY = "sb_publishable_u7VuWwoougpClBpYqZlOnA_R8onR5CZ";   // chave "anon" (eyJ...) ou "publishable" (sb_publishable_...)

/** Biblioteca do Supabase, do próprio repositório (vendor/supabase-js.mjs, versão fixa); carregada só quando a nuvem está ligada. */
export const SUPABASE_SDK = new URL("../../vendor/supabase-js.mjs", import.meta.url).href;
